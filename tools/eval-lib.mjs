// 評估工具共用：讀對話檔、呼叫 claude -p（評審與重產）、存每一輪的設定、解析評審回覆。
// 評估資料是使用者各專案的真實對話，一律放在 <claude>/ctx-handoff-eval/，不進 repo
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { claudeDir } from './lib.mjs'

// 評估一律用 Haiku：測的是提示詞與流程，不是模型（維護者 2026-10-09 決定；第一次評估用 Opus 重產交接摘要、
// Sonnet 評審，碰到方案用量上限）。要換模型用各工具的 --model
export const EVAL_MODEL = 'claude-haiku-4-5-20251001'

export const EVAL_ROOT = `${claudeDir()}/ctx-handoff-eval`

export const readRows = file => readFileSync(file, 'utf8').split('\n').flatMap(l => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } })
export const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '')
export const resultText = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n') : '')

// 從回覆抓出 JSON 物件（模型偶爾會包在圍欄裡）
export function parseVerdict(text) {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s === -1 || e <= s) return undefined
  try { return JSON.parse(text.slice(s, e + 1)) } catch { return undefined }
}

// 不帶工具、不接 MCP、不讀使用者設定（不載入 ctx-handoff，也不寫它的 store）
export const BASE = ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json']

export function runClaude(argv, cwd, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', argv, { cwd, env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' } })
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

// 系統提示寫成檔案再傳（多行文字放在命令列參數會被 shell 弄亂）；每次呼叫一個檔名，同時跑的幾個不互蓋
let promptSeq = 0
export function claudeWith(dir, { model, system, input, effort }) {
  const empty = `${dir}/empty`
  mkdirSync(`${dir}/tmp`, { recursive: true })
  mkdirSync(empty, { recursive: true })
  const file = `${dir}/tmp/system-${process.pid}-${promptSeq++}.txt`
  writeFileSync(file, system)
  return runClaude([...BASE, '--setting-sources', 'project,local', '--model', model, '--system-prompt-file', file, ...(effort ? ['--effort', effort] : [])], empty, input)
}

// 每一輪的設定（指令、參數、模型、用到的提示全文、題目）存到 runs/：結果資料夾會被 --redo 覆寫，
// 沒有這份就看不出某一輪用的是哪一版提示與評分標準
export function saveRun(dir, kind, info) {
  mkdirSync(`${dir}/runs`, { recursive: true })
  const at = new Date().toISOString()
  writeFileSync(`${dir}/runs/${at.replace(/[:.]/g, '-')}-${kind}.json`, JSON.stringify({ at, kind, argv: process.argv.slice(2), ...info }, null, 2))
}

// 同時跑 jobs 個
export async function pool(items, jobs, fn) {
  const queue = [...items]
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x)
  }))
}

export const argsOf = argv => ({
  opt: (name, def) => { const i = argv.indexOf(`--${name}`); return i === -1 ? def : argv[i + 1] },
  flag: name => argv.includes(`--${name}`),
})
