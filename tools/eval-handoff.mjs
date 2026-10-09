#!/usr/bin/env node
// 交接摘要的評估：拿真實交接當題目、交接之後新對話實際發生的事當答案，由評審模型列出摘要漏了或寫錯什麼。
// 題目與結果是使用者各專案的真實對話，放在 <claude>/ctx-handoff-eval/handoff/，不進 repo。
// 用法：
//   node tools/eval-handoff.mjs build [--min-after 3]                掃對話檔建題目（交接之後至少 N 則使用者訊息）
//   node tools/eval-handoff.mjs regen --label L --prompt-file F [--only id,id] [--jobs 2]
//                                                                   從交接前的對話用 F 的提示重新產生摘要，存 regen/<label>/
//   node tools/eval-handoff.mjs judge [--label L] [--handoffs L] [--model M] [--only id,id] [--jobs 3] [--redo]
//                                                                   評審每一題，結果存 results/<label>/；--handoffs 改評 regen/<L>/ 的摘要
//   node tools/eval-handoff.mjs compare --pair X,Y [--only id,id] [--redo]
//                                                                   regen/X 與 regen/Y 兩兩比較（正反兩個順序），存 compare/X-vs-Y/；比提示用這個
//   node tools/eval-handoff.mjs report [--label L]                  彙整分數與缺漏
// 每一輪的設定（指令、模型、提示全文、題目）存在 runs/；結果與題目都不刪，數字與結論記在 docs/eval-log.md。
// 評審用 claude -p：不帶工具、不接 MCP、不讀使用者設定（不載入 ctx-handoff，也不寫它的 store），在空資料夾執行。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { BASE, EVAL_MODEL, EVAL_ROOT, claudeWith, parseVerdict, readRows, resultText, runClaude, saveRun as saveRunIn, textOf } from './eval-lib.mjs'
import { claudeDir } from './lib.mjs'

const C = claudeDir()
const DIR = `${EVAL_ROOT}/handoff`
const args = process.argv.slice(2)
const cmd = args[0]
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : args[i + 1] }
const flag = name => args.includes(`--${name}`)

// 交接送進新對話的那則：引擎在前面加一行「The ctx-handoff plugin sent a message:」
const PREFIX = /^The ctx-handoff plugin sent a message:\s*/
// 不算使用者自己打的：指令與 skill 注入、hook 回饋、mod 注入
const NOT_HUMAN = /^(<|\[ctx-handoff|Base directory for this skill|Stop hook feedback|Caveat:)/
// 新對話取多少當答案：夠看出缺漏，不把整段後續都送給評審
export const FUTURE_USER_MAX = 12
export const FUTURE_CHARS_MAX = 80_000
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…（截短）` : s)
const brief = v => clip(typeof v === 'string' ? v : JSON.stringify(v), 300)

// 一個對話檔 → 題目（沒有交接就回 undefined）。純函式，測試直接餵列
export function caseOf(rows) {
  let handoff, at, kind
  const future = []
  let users = 0
  let chars = 0
  for (const o of rows) {
    if (o.type !== 'user' && o.type !== 'assistant') continue
    if (o.isMeta) continue
    const c = o.message?.content
    if (handoff === undefined) {
      if (o.type !== 'user') continue
      const t = textOf(c).replace(PREFIX, '')
      if (!t.startsWith('[ctx-handoff]') || t.length < 500) continue
      handoff = t
      at = o.timestamp
      kind = /閒置|went idle/.test(t.slice(0, 160)) ? 'resume' : /交接期間|while handing off/.test(t.slice(0, 200)) ? 'held' : 'present'
      continue
    }
    const parts = []
    if (o.type === 'user') {
      const raw = textOf(c)
      if (raw && !PREFIX.test(raw) && !NOT_HUMAN.test(raw.trimStart())) { parts.push(`【使用者】${clip(raw, 3000)}`); users++ }
      if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_result') parts.push(`【工具結果${x.is_error ? '・失敗' : ''}】${clip(resultText(x.content), 400)}`)
    } else if (Array.isArray(c)) {
      for (const x of c) {
        if (x.type === 'text' && x.text.trim()) parts.push(`【AI】${clip(x.text, 2000)}`)
        if (x.type === 'tool_use') parts.push(`【AI 呼叫 ${x.name}】${brief(x.input)}`)
      }
    }
    for (const p of parts) { future.push(p); chars += p.length }
    if (users >= FUTURE_USER_MAX || chars >= FUTURE_CHARS_MAX) break
  }
  if (handoff === undefined) return undefined
  return { at, kind, handoff, users, future: future.join('\n\n') }
}

// 交接前的舊對話：同一個專案資料夾裡，最後一列在交接前 15 分鐘內、最接近交接的對話檔；
// 記下它的 session id、工作目錄、模型與交接時的 context（最後一次主對話回應的輸入用量）
function beforeOf(c, dir) {
  const at = Date.parse(c.at)
  let best
  for (const g of readdirSync(dir).filter(x => x.endsWith('.jsonl'))) {
    const p = `${dir}/${g}`
    if (p === c.file || statSync(p).mtimeMs < at - 6 * 3600_000) continue
    const rs = readRows(p).filter(r => !Number.isNaN(Date.parse(r.timestamp)) && Date.parse(r.timestamp) <= at)
    const last = rs.at(-1)
    if (!last || at - Date.parse(last.timestamp) > 15 * 60_000) continue
    if (best && Date.parse(last.timestamp) <= best.last) continue
    const main = rs.filter(r => r.type === 'assistant' && !r.isSidechain && r.message?.usage)
    const u = main.at(-1)?.message.usage
    best = {
      last: Date.parse(last.timestamp), file: p, sessionId: g.replace(/.jsonl$/, ''),
      cwd: rs.find(r => r.cwd)?.cwd, model: main.at(-1)?.message.model,
      ctx: u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0,
    }
  }
  return best
}


function build() {
  const minAfter = Number(opt('min-after', 3))
  mkdirSync(`${DIR}/cases`, { recursive: true })
  let n = 0
  let skipped = 0
  for (const d of readdirSync(`${C}/projects`)) {
    let files
    try { files = readdirSync(`${C}/projects/${d}`).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const file = `${C}/projects/${d}/${f}`
      if (!readFileSync(file, 'utf8').includes('[ctx-handoff]')) continue
      const c = caseOf(readRows(file))
      if (!c) continue
      if (c.users < minAfter) { skipped++; continue }
      const id = f.slice(0, 8)
      const before = beforeOf({ ...c, file }, `${C}/projects/${d}`)
      writeFileSync(`${DIR}/cases/${id}.json`, JSON.stringify({ id, project: d, file, ...c, before }, null, 2))
      n++
    }
  }
  console.log(`題目 ${n} 題（交接之後使用者訊息少於 ${minAfter} 則的略過 ${skipped} 題）→ ${DIR}/cases`)
}

export const JUDGE_PROMPT = `你是評審，評估一份「交接摘要（handoff）」的品質。

背景：AI 助手的對話 context 快滿或使用者離開時，會產生一份交接摘要、清掉對話，把摘要送進新對話讓它接著做。好的摘要讓新對話像沒中斷一樣接續：使用者不用重講背景，AI 不用重查交接前已經知道的事，也不會因為摘要漏寫或寫錯而做錯。

你會拿到：
1. 交接摘要原文。
2. 交接之後新對話實際發生的事（使用者訊息、AI 回覆、工具呼叫與結果的摘錄）。這是答案：新對話需要、但摘要沒給的資訊，會表現成使用者補充或糾正、AI 回頭重查（讀檔、搜尋、跑指令去找交接前就已知的狀態）、或 AI 做錯。

判斷原則：
- 只算交接前就已經知道的資訊。新的需求、新發生的事、本來就要做的新調查都不算缺漏。
- 使用者轉去做不相關的新工作之後的內容不算。
- 重查要能從內容看出是在找交接前已知的事（例如重讀摘要提過但沒寫清楚的檔案、重新確認已驗證過的狀態）；正常往下做的讀檔不算。
- 不確定是不是缺漏的不要列。每一條都要引用新對話裡的原文當根據。

只輸出一個 JSON 物件，不要其他文字：
{
  "continued": true 或 false（新對話是否接續摘要裡的工作）,
  "gaps": [{ "kind": "missing" | "wrong" | "unclear", "what": "摘要缺了、寫錯或寫得不清楚的是什麼（一句）", "effect": "user_explained" | "ai_rechecked" | "ai_mistake", "evidence": "新對話裡的原文，200 字內", "keywords": ["2–4 個字串：如果交接前的對話已經知道這件事，它的原文裡一定會出現的檔名、函式名、指令、編號、數字或專有名詞（照原樣、不翻譯，避免一般用字）"] }],
  "useful": ["新對話實際用上的摘要內容，各一句，最多 5 條"],
  "score": 1 到 5 的整數；continued 為 false 時給 null,
  "reason": "一兩句說明分數"
}

分數：5 接續順暢、沒有缺漏；4 小缺漏，一兩步就補回；3 明顯缺漏，使用者或 AI 花了幾輪補；2 主要脈絡缺漏或寫錯，造成做錯或大量重查；1 摘要幾乎沒用。`

const judgeInput = c => `=== 交接摘要 ===\n${c.handoff}\n=== 交接摘要結束 ===\n\n=== 交接之後的新對話 ===\n${c.future}\n=== 新對話結束 ===\n\n依系統指示輸出 JSON。`

export { parseVerdict }
const judgeClaude = (model, system, input) => claudeWith(DIR, { model, system, input })
const saveRun = (kind, info) => saveRunIn(DIR, kind, info)

async function judge() {
  const label = opt('label', 'baseline')
  const model = opt('model', EVAL_MODEL)
  const only = opt('only', '')?.split(',').filter(Boolean)
  const jobs = Number(opt('jobs', 3))
  const from = opt('handoffs', '')
  const outDir = `${DIR}/results/${label}`
  mkdirSync(outDir, { recursive: true })
  const ids = readdirSync(`${DIR}/cases`).map(f => f.replace(/\.json$/, ''))
    .filter(id => (only.length === 0 || only.includes(id)) && (flag('redo') || !existsSync(`${outDir}/${id}.json`)))
    .filter(id => !from || existsSync(`${DIR}/regen/${from}/${id}.json`))
  saveRun('judge', { label, model, handoffs: from || undefined, prompt: JUDGE_PROMPT, ids })
  console.log(`評審 ${ids.length} 題（${model}，同時 ${jobs} 個）→ ${outDir}`)
  let cost = 0
  const queue = [...ids]
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const c = JSON.parse(readFileSync(`${DIR}/cases/${id}.json`, 'utf8'))
      try {
        if (from) c.handoff = JSON.parse(readFileSync(`${DIR}/regen/${from}/${id}.json`, 'utf8')).text
        const r = await judgeClaude(model, JUDGE_PROMPT, judgeInput(c))
        const verdict = parseVerdict(r.result ?? '')
        if (verdict) markKnown(verdict.gaps ?? [], c)
        cost += r.total_cost_usd ?? 0
        writeFileSync(`${outDir}/${id}.json`, JSON.stringify({ id, model, cost: r.total_cost_usd, verdict, raw: verdict ? undefined : r.result }, null, 2))
        console.log(`${id}\t${verdict ? `分數 ${verdict.score ?? '—'}，缺漏 ${verdict.gaps?.length ?? 0}` : '無法解析'}\t$${(r.total_cost_usd ?? 0).toFixed(3)}`)
      } catch (err) {
        console.log(`${id}\t失敗：${String(err).slice(0, 200)}`)
      }
    }
  }))
  console.log(`合計 $${cost.toFixed(2)}`)
}

// 從交接前的對話重新產生摘要：接續那個 session 的副本（--fork-session，不留檔），送出提示，和 mod 的 fork 一樣沒有工具。
// 回報的花費與用量包含原本那段對話的累計（--resume 接回舊 session 的帳），不是這一次的花費
async function regen() {
  const label = opt('label', '')
  const promptFile = opt('prompt-file', '')
  if (!label || !promptFile) { console.log('regen 要 --label 與 --prompt-file'); return }
  const prompt = readFileSync(promptFile, 'utf8')
  // 真實交接用主對話的模型，但評估比的是提示詞：預設 Haiku，兩版用同一個模型就公平
  const model = opt('model', EVAL_MODEL)
  const only = opt('only', '')?.split(',').filter(Boolean)
  const jobs = Number(opt('jobs', 2))
  const outDir = `${DIR}/regen/${label}`
  mkdirSync(outDir, { recursive: true })
  const cases = readdirSync(`${DIR}/cases`).map(f => JSON.parse(readFileSync(`${DIR}/cases/${f}`, 'utf8')))
    .filter(c => (only.length === 0 || only.includes(c.id)) && c.before?.cwd && (flag('redo') || !existsSync(`${outDir}/${c.id}.json`)))
  saveRun('regen', { label, model, prompt, ids: cases.map(c => c.id) })
  console.log(`重新產生 ${cases.length} 份（同時 ${jobs} 個）→ ${outDir}`)
  let cost = 0
  const queue = [...cases]
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
      const b = c.before
      try {
        const r = await runClaude([...BASE, '--setting-sources', 'local', '--model', model, '--resume', b.sessionId, '--fork-session', '--max-turns', '1'], b.cwd, prompt)
        cost += r.total_cost_usd ?? 0
        // 接續舊 session 時 --tools 不一定生效（2026-10-09 實測模型查了網路）：只收一輪就寫完的
        if (r.num_turns !== 1 || r.subtype !== 'success') throw new Error(`不是一輪寫完（${r.subtype}，${r.num_turns} 輪，$${(r.total_cost_usd ?? 0).toFixed(2)}）`)
        writeFileSync(`${outDir}/${c.id}.json`, JSON.stringify({ id: c.id, model, ctx: b.ctx, cost: r.total_cost_usd, usage: r.modelUsage, text: r.result ?? '' }, null, 2))
        console.log(`${c.id}	${Math.round(b.ctx / 1000)}k → ${(r.result ?? '').length} 字	${(r.total_cost_usd ?? 0).toFixed(2)}`)
      } catch (err) {
        console.log(`${c.id}	失敗：${String(err).slice(0, 300)}`)
      }
    }
  }))
  console.log(`合計 ${cost.toFixed(2)}`)
}

// 交接前的對話（純文字，含工具輸入與結果）：缺漏的關鍵字在裡面找得到，才算摘要本來可以寫的；
// 找不到的多半是交接後才發現的事，改提示詞也補不了
const beforeText = new Map()
function textBefore(c) {
  if (!c.before?.file) return ''
  if (!beforeText.has(c.id)) {
    const at = Date.parse(c.at)
    const parts = []
    for (const o of readRows(c.before.file)) {
      if (Date.parse(o.timestamp) > at) break
      const ct = o.message?.content
      if (typeof ct === 'string') parts.push(ct)
      else if (Array.isArray(ct)) for (const x of ct) parts.push(x.type === 'text' ? x.text : x.type === 'tool_use' ? JSON.stringify(x.input) : x.type === 'tool_result' ? resultText(x.content) : '')
    }
    beforeText.set(c.id, parts.join('\n').toLowerCase())
  }
  return beforeText.get(c.id)
}

export function markKnown(gaps, c, text = textBefore(c)) {
  for (const g of gaps) {
    const kws = (g.keywords ?? []).filter(k => typeof k === 'string' && k.trim().length >= 2)
    g.known = kws.length === 0 ? null : kws.some(k => text.includes(k.trim().toLowerCase()))
  }
}

// 兩兩比較：同一題的兩份摘要一起給評審，逐項判斷新對話需要的事各自有沒有寫。
// 分開打分時，評審對寫得多的摘要挑得比較細（2026-10-09：同樣沒寫的事，短摘要 0 個缺漏、長摘要被挑 3 個），所以比較要放在一起看
export const COMPARE_PROMPT = `你是評審，比較同一次交接的兩份「交接摘要（handoff）」A 與 B。

背景：AI 助手的對話 context 快滿或使用者離開時，會產生交接摘要、清掉對話，把摘要送進新對話讓它接著做。好的摘要讓新對話像沒中斷一樣接續：使用者不用重講背景，AI 不用重查交接前已經知道的事，也不會因為摘要漏寫或寫錯而做錯。

你會拿到兩份摘要，以及交接之後新對話實際發生的事（新對話當時拿到的是另一份摘要，和 A、B 都不同）。從新對話找出它需要、而且交接前就已經知道的資訊：使用者補充或糾正的背景、AI 回頭重查的已知狀態、AI 因為不知道而做錯的事。新的需求、新發生的事、本來就要做的新調查不算。

對每一項需要，判斷 A、B 各自有沒有寫到（意思寫到就算，不必一字不差）。另外列出 A、B 各自寫錯、而新對話顯示是錯的內容。最後說哪一份比較能讓新對話順利接續。不要因為長短本身加減分。

只輸出一個 JSON 物件，不要其他文字：
{
  "needs": [{ "what": "新對話需要的一件事（一句）", "evidence": "新對話裡的原文，150 字內", "a": true 或 false, "b": true 或 false }],
  "wrong_a": ["A 寫錯的內容，各一句"],
  "wrong_b": ["B 寫錯的內容，各一句"],
  "better": "A" 或 "B" 或 "same",
  "reason": "一兩句"
}`

const compareInput = (c, a, b) => `=== 摘要 A ===\n${a}\n=== 摘要 A 結束 ===\n\n=== 摘要 B ===\n${b}\n=== 摘要 B 結束 ===\n\n=== 交接之後的新對話 ===\n${c.future}\n=== 新對話結束 ===\n\n依系統指示輸出 JSON。`

// 兩個順序都跑（X 在 A、Y 在 B，再對調），抵消評審偏好前面那份的傾向；結果換回 X／Y
async function compare() {
  const [x, y] = (opt('pair', '') ?? '').split(',')
  if (!x || !y) { console.log('compare 要 --pair X,Y（regen 的兩個 label）'); return }
  const model = opt('model', EVAL_MODEL)
  const only = opt('only', '')?.split(',').filter(Boolean)
  const jobs = Number(opt('jobs', 4))
  const outDir = `${DIR}/compare/${x}-vs-${y}`
  mkdirSync(outDir, { recursive: true })
  const tasks = []
  for (const f of readdirSync(`${DIR}/cases`)) {
    const c = JSON.parse(readFileSync(`${DIR}/cases/${f}`, 'utf8'))
    if (only.length > 0 && !only.includes(c.id)) continue
    if (!existsSync(`${DIR}/regen/${x}/${c.id}.json`) || !existsSync(`${DIR}/regen/${y}/${c.id}.json`)) continue
    for (const order of ['xy', 'yx']) if (flag('redo') || !existsSync(`${outDir}/${c.id}-${order}.json`)) tasks.push({ c, order })
  }
  saveRun('compare', { pair: [x, y], model, prompt: COMPARE_PROMPT, tasks: tasks.map(t => `${t.c.id}-${t.order}`) })
  console.log(`比較 ${tasks.length} 次（${x} vs ${y}，兩個順序）→ ${outDir}`)
  let cost = 0
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let t = tasks.shift(); t !== undefined; t = tasks.shift()) {
      const { c, order } = t
      const tx = JSON.parse(readFileSync(`${DIR}/regen/${x}/${c.id}.json`, 'utf8')).text
      const ty = JSON.parse(readFileSync(`${DIR}/regen/${y}/${c.id}.json`, 'utf8')).text
      const [a, b] = order === 'xy' ? [tx, ty] : [ty, tx]
      try {
        const r = await judgeClaude(model, COMPARE_PROMPT, compareInput(c, a, b))
        cost += r.total_cost_usd ?? 0
        const v = parseVerdict(r.result ?? '')
        if (!v) throw new Error(`無法解析：${String(r.result).slice(0, 200)}`)
        const swap = order === 'yx'
        const out = {
          id: c.id, order, cost: r.total_cost_usd,
          needs: (v.needs ?? []).map(n => ({ what: n.what, evidence: n.evidence, x: swap ? n.b : n.a, y: swap ? n.a : n.b })),
          wrongX: swap ? v.wrong_b : v.wrong_a, wrongY: swap ? v.wrong_a : v.wrong_b,
          better: v.better === 'same' ? 'same' : (v.better === 'A') !== swap ? x : y, reason: v.reason,
        }
        writeFileSync(`${outDir}/${c.id}-${order}.json`, JSON.stringify(out, null, 2))
        const n = out.needs
        console.log(`${c.id} ${order}\t需要 ${n.length}：${x} 有 ${n.filter(m => m.x).length}、${y} 有 ${n.filter(m => m.y).length}｜寫錯 ${out.wrongX?.length ?? 0}／${out.wrongY?.length ?? 0}｜較好 ${out.better}`)
      } catch (err) {
        console.log(`${c.id} ${order}\t失敗：${String(err).slice(0, 200)}`)
      }
    }
  }))
  // 彙整：兩個順序都算
  const rs = readdirSync(outDir).map(f => JSON.parse(readFileSync(`${outDir}/${f}`, 'utf8')))
  const needs = rs.flatMap(r => r.needs)
  const sum = k => rs.reduce((s, r) => s + (r[k]?.length ?? 0), 0)
  const pick = rs.reduce((m, r) => { m[r.better] = (m[r.better] ?? 0) + 1; return m }, {})
  console.log(`\n## ${x} vs ${y}（${rs.length} 次評審，每題兩個順序）`)
  console.log(`新對話需要的事 ${needs.length} 項：${x} 寫到 ${needs.filter(n => n.x).length}、${y} 寫到 ${needs.filter(n => n.y).length}（只有 ${x} ${needs.filter(n => n.x && !n.y).length}、只有 ${y} ${needs.filter(n => n.y && !n.x).length}、都沒有 ${needs.filter(n => !n.x && !n.y).length}）`)
  console.log(`寫錯：${x} ${sum('wrongX')}、${y} ${sum('wrongY')}｜評審認為較好：${JSON.stringify(pick)}｜本次花費 $${cost.toFixed(2)}`)
}

function report() {
  const label = opt('label', 'baseline')
  const outDir = `${DIR}/results/${label}`
  const rs = readdirSync(outDir).map(f => JSON.parse(readFileSync(`${outDir}/${f}`, 'utf8'))).filter(r => r.verdict)
  const cases = Object.fromEntries(readdirSync(`${DIR}/cases`).map(f => { const c = JSON.parse(readFileSync(`${DIR}/cases/${f}`, 'utf8')); return [c.id, c] }))
  const scored = rs.filter(r => r.verdict.continued && typeof r.verdict.score === 'number')
  const avg = scored.reduce((s, r) => s + r.verdict.score, 0) / (scored.length || 1)
  const count = (list, key) => {
    const m = {}
    for (const x of list) m[x[key]] = (m[x[key]] ?? 0) + 1
    return m
  }
  const gaps = scored.flatMap(r => r.verdict.gaps ?? [])
  console.log(`## ${label}：${rs.length} 題有結果，${scored.length} 題有接續（其餘轉去做別的）`)
  console.log(`平均 ${avg.toFixed(2)}｜分數分布 ${JSON.stringify(count(scored.map(r => ({ s: r.verdict.score })), 's'))}`)
  const known = gaps.filter(g => g.known === true)
  console.log(`交接前就知道的缺漏（摘要本來可以寫）${known.length} 條｜後果 ${JSON.stringify(count(known, 'effect'))}｜交接前對話找不到關鍵字 ${gaps.filter(g => g.known === false).length} 條｜沒附關鍵字 ${gaps.filter(g => g.known == null).length} 條`)
  console.log(`缺漏 ${gaps.length} 條｜種類 ${JSON.stringify(count(gaps, 'kind'))}｜後果 ${JSON.stringify(count(gaps, 'effect'))}`)
  console.log(`評審花費 $${rs.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(2)}`)
  console.log('\n## 每題')
  for (const r of scored.sort((a, b) => a.verdict.score - b.verdict.score)) {
    const c = cases[r.id]
    console.log(`\n${r.id}（${c?.kind}，摘要 ${c?.handoff.length} 字）分數 ${r.verdict.score}：${r.verdict.reason}`)
    for (const g of r.verdict.gaps ?? []) console.log(`  - [${g.kind}/${g.effect}${g.known === true ? '/交接前已知' : g.known === false ? '/交接前找不到' : ''}] ${g.what}`)
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  if (cmd === 'build') build()
  else if (cmd === 'judge') await judge()
  else if (cmd === 'regen') await regen()
  else if (cmd === 'compare') await compare()
  else if (cmd === 'report') report()
  else console.log('用法：node tools/eval-handoff.mjs build | judge | report（說明見檔頭）')
}
