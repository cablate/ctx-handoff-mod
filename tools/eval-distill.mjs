#!/usr/bin/env node
// 背景整理（專案筆記）的評估：把真實對話切成整理會看到的片段當題目，用 mod 自己的整理提示與驗證程式跑一次，
// 再由評審列出這段對話值得記下的事、整理記到幾件、記錯幾件。比較兩版提示用 compare（兩份一起評、正反兩個順序）。
// 題目與結果是使用者各專案的真實對話，放在 <claude>/ctx-handoff-eval/distill/，不進 repo。
// 用法：
//   node tools/eval-distill.mjs build [--per-workspace 4] [--size 30]   切片段建題目（每 size 則使用者訊息一段，和整理的時機相同）
//   node tools/eval-distill.mjs run --label L [--hooks DIR] [--only id,id] [--jobs 3] [--redo]
//                                                                       用 DIR（預設本 repo 的 hooks/）的整理提示跑每一題，存 out/<label>/
//   node tools/eval-distill.mjs judge --label L [--only id,id] [--jobs 3] [--redo]
//                                                                       單份評審 out/<label>/（看現況、校準評審用），存 results/<label>/
//   node tools/eval-distill.mjs compare --pair X,Y [--only id,id] [--redo]
//                                                                       out/X 與 out/Y 兩兩比較，存 compare/X-vs-Y/；比提示用這個
//   node tools/eval-distill.mjs report --label L                        彙整單份評審
// 每一輪的設定（指令、模型、提示全文、題目）存在 runs/；結果與題目都不刪，數字與結論記在 docs/eval-log.md。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { EVAL_MODEL, EVAL_ROOT, argsOf, claudeWith, parseVerdict, pool, readRows, resultText, saveRun as saveRunIn, textOf } from './eval-lib.mjs'
import { claudeDir } from './lib.mjs'

register('./ts-resolve.mjs', import.meta.url)

const C = claudeDir()
const DIR = `${EVAL_ROOT}/distill`
const REPO_HOOKS = new URL('../hooks/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const args = process.argv.slice(2)
const cmd = args[0]
const { opt, flag } = argsOf(args)
const saveRun = (kind, info) => saveRunIn(DIR, kind, info)
const MODEL = opt('model', EVAL_MODEL)
// mod 的整理用 effort low；Haiku 不設 effort，換成 Sonnet 等模型時用 --effort low 對齊
const EFFORT = opt('effort', undefined)
const PREFIX = /^The ctx-handoff plugin sent a message:\s*/

// mod 的模組（整理提示、驗證、套用、對話轉文字）：比不同版本的提示時指向不同的 hooks 資料夾
const modOf = async hooks => {
  const at = f => pathToFileURL(`${hooks.replace(/\/?$/, '/')}${f}`).href
  return { distill: await import(at('distill.ts')), notes: await import(at('notes.ts')), transcript: await import(at('transcript.ts')) }
}

// 對話檔的列 → mod 的 $.session.messages() 形狀（Row）：使用者文字、助理文字與工具呼叫（結果依 tool_use_id 接回）
export function rowsOf(lines) {
  const rows = []
  const byId = new Map()
  for (const o of lines) {
    if (o.isMeta || (o.type !== 'user' && o.type !== 'assistant')) continue
    const c = o.message?.content
    if (o.type === 'user') {
      if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_result' && byId.has(x.tool_use_id)) {
        const u = byId.get(x.tool_use_id)
        u.text = resultText(x.content)
        if (x.is_error) u.isError = true
      }
      const text = textOf(c).replace(PREFIX, '')
      if (text.trim()) rows.push({ role: 'user', text, toolUses: [], at: o.timestamp })
      continue
    }
    const toolUses = []
    if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_use') { const u = { tool: x.name, input: x.input ?? {} }; byId.set(x.id, u); toolUses.push(u) }
    const text = textOf(c)
    if (text.trim() || toolUses.length) rows.push({ role: 'assistant', text, toolUses, at: o.timestamp })
  }
  return rows
}

// 每 size 則使用者訊息切一段（整理每 30 則跑一次）：這段從第 k*size 則開始，到下一段第一則之前；錨點是前一段最後一則
export function segmentsOf(rows, size) {
  const users = rows.map((r, i) => (r.role === 'user' ? i : -1)).filter(i => i >= 0)
  const out = []
  for (let k = 0; k * size < users.length; k++) {
    const from = users[k * size]
    const to = users[(k + 1) * size] ?? rows.length
    const n = Math.min(size, users.length - k * size)
    if (n < size / 2) break
    out.push({ k, from, to, users: n, anchorRow: k === 0 ? undefined : rows[users[k * size - 1]] })
  }
  return out
}

// 片段日期之前的經驗檔：根據最早一筆日期在片段之前的才留（根據只留最近 3 筆，最早一筆可能比實際建立晚，少數舊條目會被當成新的）
const DATE = /(\d{4}-\d{2}-\d{2})/
const earliest = lines => lines.map(l => DATE.exec(l)?.[1]).filter(Boolean).sort()[0]
export function notesBefore(notes, day) {
  const keep = d => d === undefined || d < day
  return {
    ...notes,
    memory: notes.memory.filter(m => keep(earliest(m.evidence))),
    rules: notes.rules.filter(r => keep(earliest(r.body.filter(l => l.includes('根據'))))),
    procedures: notes.procedures.filter(p => keep(earliest(p.body.filter(l => l.includes('根據'))))),
  }
}

async function build() {
  const size = Number(opt('size', 30))
  const per = Number(opt('per-workspace', 4))
  const mod = await modOf(REPO_HOOKS)
  mkdirSync(`${DIR}/cases`, { recursive: true })
  let total = 0
  for (const d of readdirSync(`${C}/projects`)) {
    const notesFile = `${C}/projects/${d}/memory/ctx-handoff.md`
    if (!existsSync(notesFile)) continue
    const notes = mod.notes.parseNotes(readFileSync(notesFile, 'utf8'))
    const all = []
    for (const f of readdirSync(`${C}/projects/${d}`).filter(x => x.endsWith('.jsonl'))) {
      const file = `${C}/projects/${d}/${f}`
      const rows = rowsOf(readRows(file))
      for (const s of segmentsOf(rows, size)) all.push({ file, sid: f.replace(/\.jsonl$/, ''), rows, s, at: rows[s.from].at })
    }
    // 依時間平均挑 per 段，涵蓋不同時期
    all.sort((a, b) => a.at.localeCompare(b.at))
    const pick = all.length <= per ? all : Array.from({ length: per }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / per)])
    for (const p of pick) {
      const seg = p.rows.slice(p.s.from, p.s.to)
      const day = p.at.slice(0, 10)
      const before = notesBefore(notes, day)
      // quote 比對的對象和 mod 一樣：這個 session 到這段結束為止使用者自己送出的訊息（mod 的注入不算）
      const userText = mod.distill.squash(p.rows.slice(0, p.s.to).filter(r => r.role === 'user' && !r.text.startsWith(mod.notes.NOTE_TAG) && !r.text.startsWith(mod.notes.tag)).map(r => r.text).join('\n'))
      const id = `${p.sid.slice(0, 8)}-${p.s.k}`
      writeFileSync(`${DIR}/cases/${id}.json`, JSON.stringify({
        id, workspace: d, file: p.file, sid: p.sid, k: p.s.k, day, users: p.s.users,
        anchor: p.s.anchorRow ? mod.transcript.anchorOf(p.s.anchorRow.text) : undefined,
        transcript: mod.transcript.transcriptOf(seg, undefined).text,
        notes: mod.notes.renderNotes(before, `${day} 00:00`),
        userText,
      }, null, 2))
      total++
    }
    console.log(`${d}：片段 ${all.length}，挑 ${pick.length}`)
  }
  console.log(`題目 ${total} 題 → ${DIR}/cases`)
}

// 那段對話的工作區與使用者的 CLAUDE.md（和 register.ts 的 guidesText 同格式）。用現在的版本，不是當時的：
// 之後才寫進去的事會被當成「已有」，新舊提示遇到的一樣，不影響比較
const guidesCache = new Map()
function guidesOf(c) {
  if (!guidesCache.has(c.id)) {
    const cwd = readRows(c.file).find(r => r.cwd)?.cwd?.replace(/\\/g, '/')
    const parts = []
    for (const [label, path] of [['工作區', cwd && `${cwd}/CLAUDE.md`], ['使用者', `${C}/CLAUDE.md`]]) {
      const text = path && existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
      if (text) parts.push(`--- ${label}：${path} ---\n${text}`)
    }
    guidesCache.set(c.id, parts.join('\n\n'))
  }
  return guidesCache.get(c.id)
}

const caseIds = only => readdirSync(`${DIR}/cases`).map(f => f.replace(/\.json$/, '')).filter(id => only.length === 0 || only.includes(id))
const loadCase = id => JSON.parse(readFileSync(`${DIR}/cases/${id}.json`, 'utf8'))
const onlyOf = () => (opt('only', '') ?? '').split(',').filter(Boolean)
const gitHead = dir => { try { return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return undefined } }
const gitDirty = dir => { try { return execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().length > 0 } catch { return undefined } }

// 和 register.ts 的整理一樣：同樣的系統提示、同樣的對話格式、程式驗證與套用；模型預設 Haiku（測提示，不測模型）
async function run() {
  const label = opt('label', '')
  if (!label) { console.log('run 要 --label'); return }
  const hooks = opt('hooks', REPO_HOOKS)
  const mod = await modOf(hooks)
  const outDir = `${DIR}/out/${label}`
  mkdirSync(outDir, { recursive: true })
  const ids = caseIds(onlyOf()).filter(id => flag('redo') || !existsSync(`${outDir}/${id}.json`))
  saveRun('run', { label, hooks, commit: gitHead(hooks), dirty: gitDirty(hooks), model: MODEL, effort: EFFORT, ids })
  console.log(`整理 ${ids.length} 題（${hooks}）→ ${outDir}`)
  let cost = 0
  await pool(ids, Number(opt('jobs', 3)), async id => {
    const c = loadCase(id)
    const notes = mod.notes.parseNotes(c.notes)
    // 舊版的 distillPrompt 沒有第 6 個參數，多傳的會被忽略
    const system = mod.distill.distillPrompt(c.anchor, notes, c.day, undefined, [], guidesOf(c))
    const input = `=== 對話紀錄 ===\n${c.transcript || '（沒有新的對話內容）'}\n=== 對話紀錄結束 ===\n\n依系統指示輸出 ACTIONS。`
    try {
      const r = await claudeWith(DIR, { model: MODEL, system, input, effort: EFFORT })
      cost += r.total_cost_usd ?? 0
      const parsed = mod.distill.parseActions(r.result ?? '', notes, c.userText, [])
      const { changes } = mod.distill.applyActions(parsed.actions, notes, c.day, c.sid)
      writeFileSync(`${outDir}/${id}.json`, JSON.stringify({ id, cost: r.total_cost_usd, system, actions: parsed.actions, rejected: parsed.rejected, changes, raw: r.result }, null, 2))
      console.log(`${id}\t動作 ${parsed.actions.length}、丟棄 ${parsed.rejected.count}、變動 ${changes.length}\t$${(r.total_cost_usd ?? 0).toFixed(3)}`)
    } catch (err) {
      console.log(`${id}\t失敗：${String(err).slice(0, 200)}`)
    }
  })
  console.log(`合計 $${cost.toFixed(2)}`)
}

// 給評審看的整理結果：每個動作一行（進度備忘不算筆記，另外標出）
const actionsText = o => (o.actions.length === 0 ? '（沒有任何動作）' : o.actions.map((a, i) => `${i + 1}. ${JSON.stringify(a)}`).join('\n'))

const GOAL = `背景：AI 助手在背景定期「整理」對話，把值得記住的事寫進這個專案的筆記（經驗檔），新對話開頭會帶入。目的是同樣的話使用者不用講第二次：使用者說過的偏好、要求與糾正，做過的決定與理由，以後會再用到的專案事實（位置、指令、限制、坑），重複出現的做法，都應該留下；新對話因此不會再犯同樣的錯、不用重問。

標準（維護者 2026-10-09 校準）：
值得記的：使用者明講的偏好、要求、糾正與溝通方式（例如不耐煩冗長的過程、可逆的事直接做）；有理由的決定，就算已經寫進程式也算（理由從程式碼看不出來）；以後會再用到、從程式碼看不出來的事實與坑；同樣的做法重複出現。
不值得記的：進度與待辦；只跟眼前這件工作有關的決定（例如這次先用哪個樣式、某個 PR 先放著；這些交給進度備忘 set_progress，不評）；這次改了哪些程式；某次實驗的數字；推測；金鑰；「已有的指引」（CLAUDE.md）已經寫過的事。已經在既有筆記裡、這段對話沒有新根據的，不算該記。
「已有的指引」寫過、AI 卻又違反而被使用者糾正：應該用規則記下這次再犯（add_rule 或 confirm_rule，累積後會做成守門）；改成新增一條記憶算 duplicate。
確認（confirm）的標準：user、feedback 記憶與規則，只有使用者在這段對話又說了一次、或 AI 又犯而被使用者糾正才算；AI 照著做、使用者沒說話卻 confirm，算 wrong。project、reference 要這段對話實際用到而且證實仍正確才算；只是提到就 confirm，算 wrong。
助理提出、使用者只回「好」「可以」「定案」的是決定，該記成 project；記成 user 或 feedback 算 misattributed。

動作說明：add／update／delete／confirm_memory 是記憶（type：user 使用者偏好、feedback 使用者的糾正、project 決定與事實、reference 位置）；add／update／confirm_rule 是規則（count 是出現次數）；procedure 是多步驟做法；set_progress 是進度備忘（不算筆記，不評）。user／feedback 一定附 quote，程式比對過原話確實出自使用者，但意思是否相符要你判斷。`

export const JUDGE_PROMPT = `你是評審，評估背景整理從一段對話記下的專案筆記。

${GOAL}

你會拿到：已有的指引（CLAUDE.md）、整理前已有的筆記、這段對話、整理輸出的動作（已通過程式驗證）。

1. 從對話列出值得記下的事，每項判斷整理有沒有記到（意思記到就算）。
2. 檢查整理的每個動作，有問題的列出：wrong（內容錯或和對話不符）、misattributed（把助理的做法記成使用者的要求）、not_durable（進度、一次性的細節）、duplicate（既有筆記已經有卻又新增）、vague（太籠統，新對話用不上）。
不確定的不要列。每一項都要引用對話原文當根據。

只輸出一個 JSON 物件，不要其他文字：
{
  "should": [{ "what": "值得記下的事（一句）", "kind": "preference" | "correction" | "decision" | "fact" | "procedure", "evidence": "對話原文，150 字內", "captured": "yes" | "partial" | "no" }],
  "bad": [{ "action": 動作編號, "problem": "wrong" | "misattributed" | "not_durable" | "duplicate" | "vague", "why": "一句" }],
  "score": 1 到 5 的整數,
  "reason": "一兩句"
}

分數：5 該記的都記到、沒有記錯；4 漏一兩件次要的或有一個小問題；3 漏了重要的（使用者的糾正或偏好）或有明顯記錯；2 大部分該記的沒記到或記錯不少；1 幾乎沒用或有害。`

const guidesBlock = c => `=== 已有的指引（CLAUDE.md，新對話本來就會讀到）===\n${guidesOf(c) || '（無）'}\n=== 指引結束 ===\n\n`
const judgeInput = (c, o) => `${guidesBlock(c)}=== 整理前已有的筆記 ===\n${c.notes}\n=== 筆記結束 ===\n\n=== 這段對話 ===\n${c.transcript}\n=== 對話結束 ===\n\n=== 整理輸出的動作 ===\n${actionsText(o)}\n=== 動作結束 ===\n\n依系統指示輸出 JSON。`

async function judge() {
  const label = opt('label', '')
  const outDir = `${DIR}/results/${label}`
  mkdirSync(outDir, { recursive: true })
  const ids = caseIds(onlyOf()).filter(id => existsSync(`${DIR}/out/${label}/${id}.json`) && (flag('redo') || !existsSync(`${outDir}/${id}.json`)))
  saveRun('judge', { label, model: MODEL, prompt: JUDGE_PROMPT, ids })
  console.log(`評審 ${ids.length} 題 → ${outDir}`)
  let cost = 0
  await pool(ids, Number(opt('jobs', 3)), async id => {
    const c = loadCase(id)
    const o = JSON.parse(readFileSync(`${DIR}/out/${label}/${id}.json`, 'utf8'))
    try {
      const r = await claudeWith(DIR, { model: MODEL, system: JUDGE_PROMPT, input: judgeInput(c, o) })
      cost += r.total_cost_usd ?? 0
      const verdict = parseVerdict(r.result ?? '')
      writeFileSync(`${outDir}/${id}.json`, JSON.stringify({ id, cost: r.total_cost_usd, verdict, raw: verdict ? undefined : r.result }, null, 2))
      const s = verdict?.should ?? []
      console.log(`${id}\t${verdict ? `分數 ${verdict.score}，該記 ${s.length}（記到 ${s.filter(x => x.captured === 'yes').length}），有問題 ${verdict.bad?.length ?? 0}` : '無法解析'}\t$${(r.total_cost_usd ?? 0).toFixed(3)}`)
    } catch (err) {
      console.log(`${id}\t失敗：${String(err).slice(0, 200)}`)
    }
  })
  console.log(`合計 $${cost.toFixed(2)}`)
}

export const COMPARE_PROMPT = `你是評審，比較同一段對話的兩份背景整理結果 A 與 B。

${GOAL}

你會拿到：已有的指引（CLAUDE.md）、整理前已有的筆記、這段對話、A 與 B 各自輸出的動作（都已通過程式驗證）。

1. 從對話列出值得記下的事，每項判斷 A、B 各自有沒有記到（意思記到就算）。
2. 列出 A、B 各自有問題的動作：wrong、misattributed、not_durable、duplicate、vague（意思同上）。
3. 說哪一份比較能讓使用者以後不用講第二次、又不帶入錯的東西。不要因為動作多寡本身加減分。
不確定的不要列。

只輸出一個 JSON 物件，不要其他文字：
{
  "should": [{ "what": "值得記下的事（一句）", "kind": "preference" | "correction" | "decision" | "fact" | "procedure", "evidence": "對話原文，150 字內", "a": true 或 false, "b": true 或 false }],
  "bad_a": [{ "action": 動作編號, "problem": "…", "why": "一句" }],
  "bad_b": [{ "action": 動作編號, "problem": "…", "why": "一句" }],
  "better": "A" 或 "B" 或 "same",
  "reason": "一兩句"
}`

const compareInput = (c, a, b) => `${guidesBlock(c)}=== 整理前已有的筆記 ===\n${c.notes}\n=== 筆記結束 ===\n\n=== 這段對話 ===\n${c.transcript}\n=== 對話結束 ===\n\n=== A 的動作 ===\n${actionsText(a)}\n=== A 結束 ===\n\n=== B 的動作 ===\n${actionsText(b)}\n=== B 結束 ===\n\n依系統指示輸出 JSON。`

async function compare() {
  const [x, y] = (opt('pair', '') ?? '').split(',')
  if (!x || !y) { console.log('compare 要 --pair X,Y'); return }
  const outDir = `${DIR}/compare/${x}-vs-${y}`
  mkdirSync(outDir, { recursive: true })
  const tasks = caseIds(onlyOf())
    .filter(id => existsSync(`${DIR}/out/${x}/${id}.json`) && existsSync(`${DIR}/out/${y}/${id}.json`))
    .flatMap(id => ['xy', 'yx'].map(order => ({ id, order })))
    .filter(t => flag('redo') || !existsSync(`${outDir}/${t.id}-${t.order}.json`))
  saveRun('compare', { pair: [x, y], model: MODEL, prompt: COMPARE_PROMPT, tasks: tasks.map(t => `${t.id}-${t.order}`) })
  console.log(`比較 ${tasks.length} 次（${x} vs ${y}，兩個順序）→ ${outDir}`)
  let cost = 0
  await pool(tasks, Number(opt('jobs', 4)), async ({ id, order }) => {
    const c = loadCase(id)
    const ox = JSON.parse(readFileSync(`${DIR}/out/${x}/${id}.json`, 'utf8'))
    const oy = JSON.parse(readFileSync(`${DIR}/out/${y}/${id}.json`, 'utf8'))
    const swap = order === 'yx'
    try {
      const r = await claudeWith(DIR, { model: MODEL, system: COMPARE_PROMPT, input: compareInput(c, swap ? oy : ox, swap ? ox : oy) })
      cost += r.total_cost_usd ?? 0
      const v = parseVerdict(r.result ?? '')
      if (!v) throw new Error(`無法解析：${String(r.result).slice(0, 200)}`)
      const out = {
        id, order, cost: r.total_cost_usd,
        should: (v.should ?? []).map(n => ({ ...n, a: undefined, b: undefined, x: swap ? n.b : n.a, y: swap ? n.a : n.b })),
        badX: swap ? v.bad_b : v.bad_a, badY: swap ? v.bad_a : v.bad_b,
        better: v.better === 'same' ? 'same' : (v.better === 'A') !== swap ? x : y, reason: v.reason,
      }
      writeFileSync(`${outDir}/${id}-${order}.json`, JSON.stringify(out, null, 2))
      console.log(`${id} ${order}\t該記 ${out.should.length}：${x} ${out.should.filter(n => n.x).length}、${y} ${out.should.filter(n => n.y).length}｜有問題 ${out.badX?.length ?? 0}／${out.badY?.length ?? 0}｜較好 ${out.better}`)
    } catch (err) {
      console.log(`${id} ${order}\t失敗：${String(err).slice(0, 200)}`)
    }
  })
  const rs = readdirSync(outDir).map(f => JSON.parse(readFileSync(`${outDir}/${f}`, 'utf8')))
  const should = rs.flatMap(r => r.should)
  const pick = {}
  for (const r of rs) pick[r.better] = (pick[r.better] ?? 0) + 1
  const bad = k => rs.reduce((s, r) => s + (r[k]?.length ?? 0), 0)
  console.log(`\n## ${x} vs ${y}（${rs.length} 次評審）`)
  console.log(`該記的 ${should.length} 件：${x} 記到 ${should.filter(n => n.x).length}、${y} 記到 ${should.filter(n => n.y).length}（只有 ${x} ${should.filter(n => n.x && !n.y).length}、只有 ${y} ${should.filter(n => n.y && !n.x).length}、都沒有 ${should.filter(n => !n.x && !n.y).length}）`)
  console.log(`有問題的動作：${x} ${bad('badX')}、${y} ${bad('badY')}｜較好：${JSON.stringify(pick)}｜本次花費 $${cost.toFixed(2)}`)
}

function report() {
  const label = opt('label', '')
  const outDir = `${DIR}/results/${label}`
  const rs = readdirSync(outDir).map(f => JSON.parse(readFileSync(`${outDir}/${f}`, 'utf8'))).filter(r => r.verdict)
  const count = (list, key) => { const m = {}; for (const x of list) m[x[key]] = (m[x[key]] ?? 0) + 1; return m }
  const should = rs.flatMap(r => r.verdict.should ?? [])
  const bad = rs.flatMap(r => r.verdict.bad ?? [])
  const avg = rs.reduce((s, r) => s + (r.verdict.score ?? 0), 0) / (rs.length || 1)
  console.log(`## ${label}：${rs.length} 題，平均 ${avg.toFixed(2)}｜分數分布 ${JSON.stringify(count(rs.map(r => ({ s: r.verdict.score })), 's'))}`)
  console.log(`該記的 ${should.length} 件：記到 ${should.filter(x => x.captured === 'yes').length}、部分 ${should.filter(x => x.captured === 'partial').length}、沒記 ${should.filter(x => x.captured === 'no').length}｜種類 ${JSON.stringify(count(should, 'kind'))}`)
  console.log(`沒記到的種類 ${JSON.stringify(count(should.filter(x => x.captured === 'no'), 'kind'))}`)
  console.log(`有問題的動作 ${bad.length}｜${JSON.stringify(count(bad, 'problem'))}｜評審花費 $${rs.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(2)}`)
  console.log('\n## 每題')
  for (const r of rs.sort((a, b) => a.verdict.score - b.verdict.score)) {
    console.log(`\n${r.id} 分數 ${r.verdict.score}：${r.verdict.reason}`)
    for (const s of r.verdict.should ?? []) if (s.captured !== 'yes') console.log(`  - [沒記${s.captured === 'partial' ? '全' : ''}/${s.kind}] ${s.what}`)
    for (const b of r.verdict.bad ?? []) console.log(`  - [記錯/${b.problem}] #${b.action} ${b.why}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (cmd === 'build') await build()
  else if (cmd === 'run') await run()
  else if (cmd === 'judge') await judge()
  else if (cmd === 'compare') await compare()
  else if (cmd === 'report') report()
  else console.log('用法：node tools/eval-distill.mjs build | run | judge | compare | report（說明見檔頭）')
}
