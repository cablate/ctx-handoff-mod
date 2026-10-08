#!/usr/bin/env node
// 交接摘要的評估：拿真實交接當題目、交接之後新對話實際發生的事當答案，由評審模型列出摘要漏了或寫錯什麼。
// 題目與結果是使用者各專案的真實對話，放在 <claude>/ctx-handoff-eval/handoff/，不進 repo。
// 用法：
//   node tools/eval-handoff.mjs build [--min-after 3]                掃對話檔建題目（交接之後至少 N 則使用者訊息）
//   node tools/eval-handoff.mjs judge [--label L] [--model M] [--only id,id] [--jobs 3] [--redo]
//                                                                   評審每一題，結果存 results/<label>/
//   node tools/eval-handoff.mjs report [--label L]                  彙整分數與缺漏
// 評審用 claude -p：不帶工具、不接 MCP、不讀使用者設定（不載入 ctx-handoff，也不寫它的 store），在空資料夾執行。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { claudeDir } from './lib.mjs'

const C = claudeDir()
const DIR = `${C}/ctx-handoff-eval/handoff`
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
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '')
const brief = v => clip(typeof v === 'string' ? v : JSON.stringify(v), 300)
const resultText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n') : '')

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

const readRows = file => readFileSync(file, 'utf8').split('\n').flatMap(l => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })

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
      writeFileSync(`${DIR}/cases/${id}.json`, JSON.stringify({ id, project: d, file, ...c }, null, 2))
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
  "gaps": [{ "kind": "missing" | "wrong" | "unclear", "what": "摘要缺了、寫錯或寫得不清楚的是什麼（一句）", "effect": "user_explained" | "ai_rechecked" | "ai_mistake", "evidence": "新對話裡的原文，200 字內" }],
  "useful": ["新對話實際用上的摘要內容，各一句，最多 5 條"],
  "score": 1 到 5 的整數；continued 為 false 時給 null,
  "reason": "一兩句說明分數"
}

分數：5 接續順暢、沒有缺漏；4 小缺漏，一兩步就補回；3 明顯缺漏，使用者或 AI 花了幾輪補；2 主要脈絡缺漏或寫錯，造成做錯或大量重查；1 摘要幾乎沒用。`

const judgeInput = c => `=== 交接摘要 ===\n${c.handoff}\n=== 交接摘要結束 ===\n\n=== 交接之後的新對話 ===\n${c.future}\n=== 新對話結束 ===\n\n依系統指示輸出 JSON。`

// 從回覆抓出 JSON 物件（模型偶爾會包在圍欄裡）
export function parseVerdict(text) {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s === -1 || e <= s) return undefined
  try { return JSON.parse(text.slice(s, e + 1)) } catch { return undefined }
}

function runClaude(model, system, input) {
  const empty = `${DIR}/empty`
  mkdirSync(empty, { recursive: true })
  writeFileSync(`${DIR}/judge-prompt.txt`, system)
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', model, '--system-prompt-file', `${DIR}/judge-prompt.txt`, '--tools', '', '--strict-mcp-config',
      '--setting-sources', 'project,local', '--no-session-persistence', '--output-format', 'json'], {
      cwd: empty,
      env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' },
    })
    let out = ''
    let err = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', reject)
    p.on('close', code => {
      try { resolve(JSON.parse(out)) } catch { reject(new Error(`claude 結束碼 ${code}：${(err || out).slice(0, 300)}`)) }
    })
    p.stdin.end(input)
  })
}

async function judge() {
  const label = opt('label', 'baseline')
  const model = opt('model', 'claude-sonnet-5-5')
  const only = opt('only', '')?.split(',').filter(Boolean)
  const jobs = Number(opt('jobs', 3))
  const outDir = `${DIR}/results/${label}`
  mkdirSync(outDir, { recursive: true })
  const ids = readdirSync(`${DIR}/cases`).map(f => f.replace(/\.json$/, ''))
    .filter(id => (only.length === 0 || only.includes(id)) && (flag('redo') || !existsSync(`${outDir}/${id}.json`)))
  console.log(`評審 ${ids.length} 題（${model}，同時 ${jobs} 個）→ ${outDir}`)
  let cost = 0
  const queue = [...ids]
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const c = JSON.parse(readFileSync(`${DIR}/cases/${id}.json`, 'utf8'))
      try {
        const r = await runClaude(model, JUDGE_PROMPT, judgeInput(c))
        const verdict = parseVerdict(r.result ?? '')
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
  console.log(`缺漏 ${gaps.length} 條｜種類 ${JSON.stringify(count(gaps, 'kind'))}｜後果 ${JSON.stringify(count(gaps, 'effect'))}`)
  console.log(`評審花費 $${rs.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(2)}`)
  console.log('\n## 每題')
  for (const r of scored.sort((a, b) => a.verdict.score - b.verdict.score)) {
    const c = cases[r.id]
    console.log(`\n${r.id}（${c?.kind}，摘要 ${c?.handoff.length} 字）分數 ${r.verdict.score}：${r.verdict.reason}`)
    for (const g of r.verdict.gaps ?? []) console.log(`  - [${g.kind}/${g.effect}] ${g.what}`)
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  if (cmd === 'build') build()
  else if (cmd === 'judge') await judge()
  else if (cmd === 'report') report()
  else console.log('用法：node tools/eval-handoff.mjs build | judge | report（說明見檔頭）')
}
