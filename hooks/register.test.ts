import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const usage = (tokens: number) =>
  ({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0 })

// 背景整理 fork 的回覆；個別測試可以換掉，onFork 可以模擬 fork 期間發生的事
// 一行一個 JSON 動作；包在 ACTIONS／END 標記之間
const actionsReply = (...lines: (string | object)[]) =>
  ['=== ACTIONS ===', ...lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))), '=== END ==='].join('\n')
const DISTILL_REPLY = actionsReply(
  { op: 'add_memory', type: 'project', title: '使用者決定交接門檻維持 600k', evidence: '討論門檻後決定' },
  { op: 'add_memory', type: 'project', title: 'api_key=abc123 不該被寫入', evidence: '測試' },
  { op: 'add_rule', name: '先實測再下結論', rule: '宣稱現行行為前先跑一次最小實測', applies: 'API 行為不確定時', not_applies: '文件已明確保證時', evidence: 'fork 能否讀寫靠實測才確定' },
)
let distillReply = DISTILL_REPLY
let onFork: (() => void | Promise<void>) | undefined
// 整理請求回 aborted（引擎依 timeoutMs 放棄）
let completeAborts = false
let takenCommands = new Set<string>()
let registered: string[] = []
// 每個 fork 都會等它：用來讓 fork 停在半空中，測試並行與交接期間的行為
let forkGate: (() => Promise<void>) | undefined
// 只擋整理 fork／只擋交接 fork
let distillGate: (() => Promise<void>) | undefined
let handoffGate: (() => Promise<void>) | undefined
// $.session.repo()：依目前工作目錄回答（會跟著 cd 變）
// 寫入這個路徑時失敗（模擬磁碟錯誤）
let failWrite: string | undefined
let curRepo: { root: string; remote: string | null; internal: boolean; name: string } | null = null
// 交接 fork（不是整理）回傳失敗
let failHandoff = false
// 接下來幾次 prompt.submit 丟出例外
let failSubmits = 0
// /clear 執行時順便做的事（模擬 /clear 與送出之間到的訊息）
let onClear: (() => void | Promise<void>) | undefined
// 下層 Stop hook 要求繼續（例如另一個 plugin 擋下停止）
let stopBlock: string | undefined
let curSid = 'S1'
// session 啟動資料夾（P1）與目前工作目錄
let curRoot = 'C:\\proj'
let curCwd = 'C:/proj'

// 引擎底下的世界：用量、fork、/clear、送出、檔案，全部記下來
const world = (on: On, tokens: number, window = 1_000_000, store: Record<string, unknown> = {}, agents: { id: string; status: string }[] = [], turns: number | (() => number) = 0) => {
  const turnsOf = typeof turns === 'function' ? turns : () => turns
  const forks: string[] = []
  const completes: { model: string; effort?: string; system?: string; prompt: string; timeoutMs?: number }[] = []
  const rows: { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown>; text?: string }[] }[] = []
  const commands: string[] = []
  const submits: string[] = []
  const contexts: (readonly string[] | undefined)[] = []
  const toasts: string[] = []
  const files = new Map<string, string>([['C:/Users/u/.claude/projects/C--proj/S1.jsonl', '']])
  const logs: string[] = []
  distillReply = DISTILL_REPLY
  onFork = undefined
  completeAborts = false
  takenCommands = new Set()
  registered = []
  forkGate = undefined
  distillGate = undefined
  handoffGate = undefined
  curRepo = null
  failWrite = undefined
  failHandoff = false
  failSubmits = 0
  onClear = undefined
  stopBlock = undefined
  curSid = 'S1'
  curRoot = 'C:\\proj'
  curCwd = 'C:/proj'
  const clock = mock.clock(on)
  on('ui.log', (_$, e: unknown) => { logs.push(JSON.stringify(e)); return { value: undefined } })
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e: { text?: string }) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', (_$, e: unknown) => { toasts.push(JSON.stringify(e)); return { value: undefined } })
  // 自己的 store：測試要直接讀寫（$.store 不在測試引擎的 $ 上）；值經過 JSON 來回，和真的一樣
  const kv = new Map<string, unknown>(Object.entries(store))
  on('store.get', (_$, e: { key: string }) => ({ value: kv.has(e.key) ? JSON.parse(JSON.stringify(kv.get(e.key))) : undefined }))
  on('store.set', (_$, e: { key: string; value: unknown }) => { kv.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
  on('store.delete', (_$, e: { key: string }) => { kv.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...kv.keys()] }))
  const get = (key: string) => kv.get(key)
  const put = (key: string, value: unknown) => { kv.set(key, value) }
  mock.env(on, { USERPROFILE: 'C:\\Users\\u' })
  on('session.id', () => ({ value: curSid }))
  on('session.turns', () => ({ value: turnsOf() }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window }, rateLimits: [] } }))
  on('session.repo', () => ({ value: curRepo }))
  on('session.root', () => ({ value: curRoot }))
  on('session.cwd', () => ({ value: curCwd }))
  // 工具本身：什麼都不做，只讓 tool.call 能走到本 plugin 的 hook
  on('tool.call', () => ({ result: 'ok' }))
  // 引擎會把路徑轉成原生格式（Windows 反斜線），比對前先統一成斜線
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')
  on('fs.exists', (_$, e: { path: string }) => ({ value: files.has(norm(e.path)) }))
  on('fs.list', (_$, e: { path: string }) => {
    const dir = `${norm(e.path).replace(/\/+$/, '')}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const p of files.keys()) {
      if (!p.startsWith(dir)) continue
      const rest = p.slice(dir.length)
      const i = rest.indexOf('/')
      names.set(i === -1 ? rest : rest.slice(0, i), i === -1 ? 'file' : 'dir')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  const reads: string[] = []
  on('fs.read', (_$, e: { path: string }) => {
    reads.push(norm(e.path))
    return files.has(norm(e.path)) ? { value: files.get(norm(e.path)) ?? '' } : { deny: 'missing' }
  })
  const writes: string[] = []
  on('fs.write', (_$, e: { path: string; text: string }) => {
    writes.push(norm(e.path))
    if (failWrite === norm(e.path)) return { deny: 'disk full' }
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('model.fork', async (_$, e: { prompt: string }) => {
    forks.push(e.prompt)
    const isDistill = e.prompt.includes('=== ACTIONS ===')
    if (isDistill) await onFork?.()
    await forkGate?.()
    if (isDistill) await distillGate?.()
    else await handoffGate?.()
    if (!isDistill && failHandoff) return { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
    const text = isDistill ? distillReply : 'HANDOFF: 測試'
    return { value: { isAnswered: true as const, text, usage: usage(tokens) } }
  })
  // 背景整理走 model.complete：記進同一個 forks 清單（系統提示＋訊息），測試照舊比對內容與次數
  on('model.complete', async (_$, e: { model: string; effort?: string; system?: string; prompt: string; timeoutMs?: number }) => {
    completes.push(e)
    forks.push(`${e.system ?? ''}\n${e.prompt}`)
    // timeoutMs 由引擎計時；completeAborts 模擬到時回 aborted
    if (completeAborts) return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: usage(0) } }
    await onFork?.()
    await forkGate?.()
    await distillGate?.()
    return { value: { isAnswered: true as const, text: distillReply, usage: usage(0) } }
  })
  // 主對話的訊息：送進對話的人類訊息依序當成使用者訊息，另外可以塞助理訊息
  on('session.messages', () => ({ value: [...rows] as never }))
  // takenCommands：已被使用者自己的指令或 skill 佔用的名稱
  on('command.register', (_$, e: { name: string }) => {
    registered.push(e.name)
    return takenCommands.has(e.name) ? { deny: `"/${e.name}" refused: it is the user's /${e.name}` } : { value: { command: e.name } }
  })
  on('session.start', (_$, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.context', (_$, e) => ({ blocks: [...e.blocks] }))
  on('command.run', async (_$, e: { command: string }) => {
    commands.push(e.command)
    await onClear?.()
    return { text: '' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => (stopBlock !== undefined ? { block: stopBlock } : {}))
  on('agent.list', () => ({ value: agents.map(a => ({ ...a, description: '', type: 'general-purpose' })) as never }))
  on('prompt.submit', (_$, e: { text?: string; context?: readonly string[] }) => {
    // 送不進對話：被丟棄（hook 丟例外只會被引擎略過，不會讓 $.prompt.submit 失敗）
    if (failSubmits > 0) { failSubmits -= 1; return { drop: 'submit boom' } }
    submits.push(e.text ?? '')
    contexts.push(e.context)
    rows.push({ role: 'user', text: e.text ?? '', toolUses: [] })
    return { text: e.text ?? '', context: e.context }
  })
  return { clock, forks, commands, submits, contexts, toasts, files, logs, get, put, reads, writes, completes, rows, statuses }
}

const NOTE_TAG = '[ctx-handoff 專案經驗]'
const DAY = 24 * 60 * 60_000
const presentation = { isFullscreen: false, columns: 80 }
const composer = { kind: 'composer' as const }
const cmd = ($: Engine, args: string) =>
  $.command.run({ command: 'handoff', args, origin: composer, presentation })
const resume = ($: Engine) => cmd($, 'resume')
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: composer, wait: false })
const startSession = ($: Engine) => $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
const task = (status = 'running') => ({ id: 'b1', type: 'shell', status, description: 'sleep 999' })
const cron = (recurring: boolean) => ({ id: 'c1', schedule: '0 9 * * *', recurring, prompt: 'check' })

const endTurn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

// 主對話停下來：門檻交接在這裡判斷（含背景工作與排程快照）
const stop = ($: Engine, extra: Partial<Parameters<Engine['classic']['Stop']>[0]> = {}) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [], ...extra })

test('達 600k：產生 handoff → /clear → 送出', async ($, on) => {
  const w = world(on, 650_000)
  await stop($)
  await w.clock.advance(0)
  expect(w.forks.length).toBe(1)
  expect(w.commands).toEqual(['clear'])
  expect(w.submits.length).toBe(1)
  expect(w.submits[0]).toContain('HANDOFF: 測試')
})

test('200k 視窗：門檻降為 160k', async ($, on) => {
  const w = world(on, 170_000, 200_000)
  await stop($)
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
})

test('門檻以下閒置：刷新 3 次後存離席 handoff，不 /clear', async ($, on) => {
  const w = world(on, 100_000)
  await endTurn($)
  await w.clock.advance(0)
  expect(w.commands).toEqual([])
  for (let i = 1; i <= 3; i++) {
    await w.clock.advance(55 * 60_000)
    expect(w.forks).toEqual(Array(i).fill('只回覆 OK'))
  }
  await w.clock.advance(55 * 60_000)
  expect(w.forks.length).toBe(4)
  expect(w.forks[3]).toContain('HANDOFF')
  expect(w.commands).toEqual([])
  expect(w.submits).toEqual([])
  // 之後不再排計時器
  await w.clock.advance(5 * 60 * 60_000)
  expect(w.forks.length).toBe(4)
  // 存下的離席 handoff 能用 /handoff resume 取回
  await resume($)
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
  expect(w.submits[0]).toContain('HANDOFF: 測試')
})

// 事故（2026-10-06）：回合結束後才熱重載，計時器被清掉，到下個回合前都不刷新，快取過期
// 熱重載後的新模組沒有計時器，只看得到 $.state 裡的紀錄，session.start 再跑一次
// 熱重載前留下的紀錄：第一次讀 idle 時給它，之後交給引擎
const savedIdle = (on: On, value: { due: number; refreshes: number }) => {
  let given = false
  on('state.get', (_$, e, next) => {
    if (given || e.key !== 'idle') return next(e)
    given = true
    return { value: { value, version: 1 } } as never
  })
}

test('熱重載後接回閒置計時：照原本的到期時間刷新，刷新次數接著算', async ($, on) => {
  const w = world(on, 100_000)
  savedIdle(on, { due: 25 * 60_000, refreshes: 1 })
  await startSession($)
  await w.clock.advance(25 * 60_000)
  expect(w.forks).toEqual(['只回覆 OK'])
  await w.clock.advance(55 * 60_000)
  expect(w.forks.length).toBe(2)
  await w.clock.advance(55 * 60_000)
  expect(w.forks[2]).toContain('HANDOFF')
})

test('熱重載時計時早已過期：不補刷新', async ($, on) => {
  const w = world(on, 100_000)
  await w.clock.set(70 * 60_000)
  savedIdle(on, { due: 55 * 60_000, refreshes: 0 })
  await startSession($)
  await w.clock.advance(2 * 60 * 60_000)
  expect(w.forks).toEqual([])
})

test('刷新關閉：閒置 55 分鐘直接存離席 handoff', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { refresh: false })
  await endTurn($)
  await w.clock.advance(55 * 60_000)
  expect(w.forks.length).toBe(1)
  expect(w.forks[0]).toContain('HANDOFF')
})

test('context 太小：不刷新也不產生 handoff', async ($, on) => {
  const w = world(on, 10_000)
  await endTurn($)
  await w.clock.advance(5 * 60 * 60_000)
  expect(w.forks).toEqual([])
})

test('handoff resume：/clear 後送出 handoff 和被攔下的訊息', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'HANDOFF: 測試', held: '我回來了' } })
  await resume($)
  await w.clock.advance(0)
  expect(w.commands).toContain('clear')
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  expect(w.submits[0]).toContain('我回來了')
  // 用過就刪：再跑一次不會再 /clear
  await resume($)
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
})

test('子代理還在跑：延後 handoff', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [{ id: 'a1', status: 'running' }])
  await stop($)
  await w.clock.advance(0)
  expect(w.commands).toEqual([])
})

test('handoff dry：產生 handoff 並回報用量，不 /clear', async ($, on) => {
  const w = world(on, 650_000)
  const r = await cmd($, 'dry')
  expect(w.forks.length).toBe(1)
  expect(w.commands).toEqual([])
  expect(r.text).toContain('HANDOFF: 測試')
  expect(r.text).toContain('快取讀 650,000')
  const s = await cmd($, '')
  // 用法裡也有 dry，所以比對狀態行的格式
  expect(s.text).toContain(' dry，context')
  expect(s.text).toContain('輸出 1')
})

test('handoff：不帶參數顯示狀態和用法，不認得的子指令只回用法、不動作', async ($, on) => {
  const w = world(on, 650_000)
  const s = await cmd($, '')
  expect(s.text).toContain('門檻')
  expect(s.text).toContain('/handoff now')
  expect(s.text).toContain('/handoff resend')
  const u = await cmd($, 'nwo')
  expect(u.text).toContain('不認得「nwo」')
  expect(w.forks.length).toBe(0)
  expect(w.commands).toEqual([])
})

const NOTES = 'C:/Users/u/.claude/projects/C--proj/memory/ctx-handoff.md'
const distillNow = ($: Engine) => cmd($, 'distill')

test('狀態列顯示整理進度：平常是距離下次幾則，整理中顯示原因，整理完歸零', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await endTurn($)
  expect(w.statuses.at(-1)).toBe('[ctx-handoff] 整理 5/30')
  expect((await cmd($, '')).text).toContain('下次：再 25 則訊息')
  await distillNow($)
  expect(w.statuses).toContain('[ctx-handoff] 整理中（手動）')
  expect(w.statuses.at(-1)).toBe('[ctx-handoff] 整理 0/30')
  await cmd($, 'distill off')
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('閒置刷新順便整理：寫入專案經驗檔、濾掉疑似金鑰、差異排入下一則訊息，沒新訊息就只刷新', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await $.prompt.submit({ text: '請幫我  整理\n這段對話', origin: composer, wait: false })
  await endTurn($)
  await w.clock.advance(55 * 60_000)
  // 刷新是只回 OK 的 fork，整理是另一個 complete 請求，附上這段對話
  expect(w.forks.length).toBe(2)
  expect(w.forks[0]).toBe('只回覆 OK')
  expect(w.forks[1]).toContain('範圍：整段對話')
  expect(w.forks[1]).toContain('【使用者】請幫我  整理\n這段對話')
  expect(w.completes[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' })
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('## 記憶\n- [project] 使用者決定交接門檻維持 600k')
  expect(notes).not.toContain('api_key')
  expect(notes).toContain('### 先實測再下結論（1 次）')
  expect(notes).toContain('- 根據：1970-01-01 fork 能否讀寫靠實測才確定')
  const status = await cmd($, '')
  expect(status.text).toContain('新增記憶：[project] 使用者決定交接門檻維持 600k')
  // 第二次刷新：沒有新訊息，只回 OK
  await w.clock.advance(55 * 60_000)
  expect(w.forks.slice(2)).toEqual(['只回覆 OK'])
  // 差異不用 session.append，而是跟著下一則送進對話的訊息
  await say($, '下一則')
  expect(w.contexts[1]?.[0]).toContain(NOTE_TAG)
  expect(w.contexts[1]?.[0]).toContain('新增記憶：[project] 使用者決定交接門檻維持 600k')
})

test('交接前整理一次，再 /clear', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  await stop($)
  await w.clock.advance(0)
  expect(w.forks.length).toBe(2)
  expect(w.forks.some(f => f.includes('=== ACTIONS ==='))).toBe(true)
  expect(w.commands).toEqual(['clear'])
  expect(w.files.get(NOTES) ?? '').toContain('600k')
})

const EXISTING = [
  '# ctx-handoff 專案經驗',
  '',
  '## 記憶',
  '- [feedback] 舊 A',
  '- [project] 舊 B',
  '',
  '## 規則',
  '',
  '### 規則一（1 次）',
  '- 規則：做 X',
  '- 根據：1970-01-01 第一次',
  '',
  '### 規則二（2 次）',
  '- 規則：做 Y',
  '',
].join('\n')

test('依編號套用新增／更新／刪除／確認，超出範圍的忽略；錨點接續上次', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'distill:S1': { turn: 3, anchor: '上次最後一則訊息' } }, [], 6)
  w.files.set(NOTES, EXISTING)
  distillReply = actionsReply(
    { op: 'update_memory', id: 'M1', type: 'feedback', title: '改過的 A', quote: '上次最後一則訊息' },
    { op: 'delete_memory', id: 'M2', reason: '已過時' },
    { op: 'add_memory', type: 'user', title: '新的偏好', how: '照做', evidence: '使用者提過', quote: '更早的…訊息' },
    { op: 'delete_memory', id: 'M9', reason: '超出範圍' },
    { op: 'confirm_rule', id: 'R1', evidence: '又被證實一次' },
    { op: 'delete_rule', id: 'R2', reason: '被推翻' },
    { op: 'confirm_rule', id: 'R9', evidence: '超出範圍' },
    { op: 'add_rule', name: '沒有規則內容的條目', evidence: '缺規則，應丟棄' },
  )
  w.rows.push(
    { role: 'user', text: '更早的訊息', toolUses: [] },
    { role: 'user', text: '上次最後一則訊息', toolUses: [] },
    { role: 'assistant', text: '好的', toolUses: [{ tool: 'Bash', input: { command: 'ls' }, text: 'a.ts' }] },
  )
  await distillNow($)
  expect(w.forks[0]).toContain('使用者說「上次最後一則訊息」')
  // 只附上錨點之後的對話；工具呼叫留名稱、輸入與結果
  expect(w.forks[0]).toContain('【助理】好的')
  expect(w.forks[0]).toContain('〔工具 Bash〕{"command":"ls"} → a.ts')
  expect(w.forks[0]).not.toContain('更早的訊息')
  expect(w.forks[0]).toContain('M1 [feedback] 舊 A')
  expect(w.forks[0]).toContain('R2 規則二｜出現 2 次｜做 Y')
  const notes = w.files.get(NOTES) ?? ''
  // 根據由程式補日期與 session；原話可用 … 省略中間
  expect(notes).toContain([
    '- [feedback] 改過的 A',
    '  - 根據：1970-01-01 S1｜使用者原話：「上次最後一則訊息」',
    '- [user] 新的偏好',
    '  - 做法：照做',
    '  - 根據：1970-01-01 S1｜使用者提過｜使用者原話：「更早的…訊息」',
  ].join('\n'))
  expect(notes).not.toContain('舊 B')
  expect(notes).toContain('### 規則一（2 次）\n- 規則：做 X\n- 根據：1970-01-01 第一次\n- 根據：1970-01-01 又被證實一次')
  expect(notes).not.toContain('規則二')
  expect(notes).not.toContain('沒有規則內容')
})

test('新對話開頭帶入記憶與出現 2 次以上的規則', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, EXISTING)
  const r = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
  const block = r.blocks.find(b => b.name === 'ctxHandoffProject')
  expect(r.blocks[0]?.name).toBe('currentDate')
  expect(block?.text).toContain('- [feedback] 舊 A')
  expect(block?.text).toContain('- 規則二（2 次）：做 Y')
  expect(block?.text).not.toContain('規則一')
})

test('沒有經驗檔：新對話開頭不帶入', async ($, on) => {
  world(on, 100_000)
  const r = await $.prompt.context({ blocks: [] })
  expect(r.blocks).toEqual([])
})

test('整理期間檔案被手動修改：不套用、不排入，下次重新整理同一段', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, EXISTING)
  onFork = () => { w.files.set(NOTES, `${EXISTING}\n- [user] 使用者剛手動加的\n`) }
  const r = await distillNow($)
  expect(r.text).toContain('整理期間經驗檔被修改')
  expect(w.files.get(NOTES) ?? '').toContain('使用者剛手動加的')
  await say($, '下一則')
  expect(w.contexts[0]).toBeUndefined()
  // 沒有推進進度：下次還會整理
  onFork = undefined
  await distillNow($)
  expect(w.forks.length).toBe(2)
})

test('每 30 則訊息整理一次；不到 30 則不整理', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 30)
  await endTurn($)
  await w.clock.advance(0)
  expect(w.forks.length).toBe(1)
  // 再結束一個回合：上次已整理到第 30 則，不再觸發
  await endTurn($)
  await w.clock.advance(0)
  expect(w.forks.length).toBe(1)
})

test('重複整理：同一條記憶不會重複寫入，沒有變動就不排入', async ($, on) => {
  let n = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => n)
  await distillNow($)
  n = 9
  distillReply = actionsReply({ op: 'add_memory', type: 'project', text: '使用者決定交接門檻維持 600k' })
  await distillNow($)
  const notes = w.files.get(NOTES) ?? ''
  expect(notes.split('使用者決定交接門檻維持 600k').length).toBe(2)
  expect(notes.split('## 記憶').length).toBe(2)
  // 只有第一次的變動被排入：帶入一次，內容不重複
  await say($, '下一則')
  expect((w.contexts[0]?.[0] ?? '').split('新增記憶').length).toBe(2)
})

test('錨點：記下使用者最後一則訊息，下次整理從它之後開始', async ($, on) => {
  let n = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => n)
  await $.prompt.submit({ text: '請幫我  整理\n這段對話', origin: composer, wait: false })
  await $.prompt.submit({ text: '/handoff', origin: composer, wait: false })
  await distillNow($)
  expect(w.forks[0]).toContain('範圍：整段對話')
  n = 9
  await distillNow($)
  expect(w.forks[1]).toContain('使用者說「請幫我 整理 這段對話」')
})

// ---------- S1：交接期間訊息不遺失 ----------

test('S1 門檻交接期間：人類訊息被攔下，最終送出的文字包含它', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  onFork = async () => { await say($, '中途訊息') }
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
  // 中途訊息沒有在舊對話送出，而是包進交接的文字
  expect(w.submits.length).toBe(1)
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  expect(w.submits[0]).toContain('交接期間收到的使用者訊息')
  expect(w.submits[0]).toContain('中途訊息')
})

test('S1 /clear 完成後、送出前到的訊息：另外接在 handoff 之後送出', async ($, on) => {
  const w = world(on, 650_000)
  onClear = async () => { await say($, '晚到的訊息') }
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
  expect(w.submits.length).toBe(2)
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  expect(w.submits[0]).not.toContain('晚到的訊息')
  expect(w.submits[1]).toBe('晚到的訊息')
})

test('S1 /handoff dry 進行中：人類訊息不被攔下', async ($, on) => {
  const w = world(on, 100_000)
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  forkGate = () => gate
  const run = cmd($, 'dry')
  await w.clock.settle()
  expect(w.forks.length).toBe(1)
  await say($, '人類訊息')
  expect(w.submits).toEqual(['人類訊息'])
  release()
  await run
})

test('S1 離席 handoff 產生中：不被 S1 攔下', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { refresh: false })
  await endTurn($)
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  forkGate = () => gate
  await w.clock.advance(55 * 60_000)
  expect(w.forks.length).toBe(1)
  await say($, '人類訊息')
  expect(w.submits).toEqual(['人類訊息'])
  release()
  await w.clock.settle()
  expect(w.get('away:S1')).toBeDefined()
})

test('S1 handoff fork 失敗：攔下的訊息在舊對話重新送出', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  failHandoff = true
  onFork = async () => { await say($, '中途訊息') }
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual([])
  expect(w.submits).toEqual(['中途訊息'])
})

test('S1 交接 fork 與交接前整理同時發出', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  forkGate = () => gate
  await stop($)
  await w.clock.settle()
  // 兩個 fork 都還沒回來就都已經發出
  expect(w.forks.length).toBe(2)
  expect(w.commands).toEqual([])
  release()
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
})

// ---------- S2：差異跟著下一則送進對話的訊息 ----------

test('S2 被攔下的訊息與斜線指令不消耗排入的差異，下一則真正送出的才帶入、再下一則不帶', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'H' } }, [], 5)
  await distillNow($)
  // 離席 handoff 攔下第一則：不帶入
  await say($, '被攔下的訊息')
  expect(w.submits).toEqual([])
  // 斜線指令：不帶入
  await say($, '/handoff')
  expect(w.submits).toEqual(['/handoff'])
  expect(w.contexts[0]).toBeUndefined()
  // 再送一次＝繼續舊對話：真正進入對話，帶入差異
  await say($, '被攔下的訊息')
  expect(w.contexts[1]?.[0]).toContain(NOTE_TAG)
  expect(w.contexts[1]?.[0]).toContain('新增記憶')
  // 已經用掉
  await say($, '再下一則')
  expect(w.contexts[2]).toBeUndefined()
})

test('S2 交接前整理不排入差異', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  await stop($)
  await w.clock.settle()
  expect(w.files.get(NOTES) ?? '').toContain('600k')
  await say($, '新對話第一則')
  expect(w.contexts.at(-1)).toBeUndefined()
})

// ---------- S3、S4：整理提示 ----------

test('S3 整理提示：找不到錨點而改看整段時不得 CONFIRM', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'distill:S1': { turn: 1, anchor: '某則訊息' } }, [], 5)
  await distillNow($)
  expect(w.forks[0]).toContain('找不到錨點而改看整段時，只能 add／update／delete，不得 confirm_rule')
})

test('S4 整理提示：開頭是 [ctx-handoff] 的訊息只是 handoff 摘要，不當證據', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await distillNow($)
  expect(w.forks[0]).toContain('開頭是 [ctx-handoff] 的訊息是 handoff 摘要，只能參考，不能當作證據，也不能 confirm_rule')
})

// ---------- S5：store 鍵分專案、清理 ----------

const saved = (kind: string, tokens: number) => ({ at: 5, sessionId: 'S1', kind, tokens, text: 'x' })

test('S5 狀態只顯示目前專案的資訊', async ($, on) => {
  world(on, 100_000, 1_000_000, {
    handoffs: [saved('present', 999)],
    'handoffs:OTHER': [saved('manual', 888)],
    'handoffs:C--proj': [saved('away', 123)],
    'distill:last': { at: 1, why: '舊全域', changes: [], file: 'f', usage: 'u' },
    'distill:last:OTHER': { at: 1, why: '別的專案', changes: [], file: 'f', usage: 'u' },
    'distill:error': { at: 9, why: '舊全域錯誤', reason: 'r1' },
    'handoff:error:OTHER': { at: 9, sessionId: 'Z', kind: 'present', reason: '別的專案的失敗', tokens: 1, turns: 1 },
  })
  const s = (await cmd($, '')).text
  expect(s).toContain(' away，context 123')
  expect(s).not.toContain('999')
  expect(s).not.toContain('888')
  expect(s).not.toContain('舊全域')
  expect(s).not.toContain('別的專案')
})

test('使用者已有 /handoff：改註冊 /ctx-handoff，指令照常可用，啟動時的整理照跑', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'last:OLD': 'x' })
  takenCommands = new Set(['handoff'])
  await startSession($)
  expect(registered).toEqual(['handoff', 'ctx-handoff'])
  // 啟動時的 store 清理照跑：每 session 的鍵記進 seen
  expect((w.get('seen') as Record<string, number>)['last:OLD']).toBeDefined()
  const r = await $.command.run({ command: 'ctx-handoff', args: '', origin: composer, presentation })
  expect(r.text).toContain('背景整理')
})

const staleAway = { handoff: 'H', held: '攔下的訊息' }

test('S5 清理：舊字串值與 away 不被改寫，只記下第一次看到的時間', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'last:x': '舊的字串錨點', 'away:y': staleAway })
  await startSession($)
  expect(w.get('last:x')).toBe('舊的字串錨點')
  expect(w.get('away:y')).toEqual(staleAway)
  const seen = (w.get('seen')) as Record<string, number>
  expect(Object.keys(seen).sort()).toEqual(['away:y', 'last:x'])
})

test('S5 清理：第一次看到超過 30 天的刪除、1 天的保留', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'last:x': '舊的字串錨點', 'away:y': staleAway, seen: { 'last:x': 0, 'away:y': 30 * DAY } })
  await w.clock.set(31 * DAY)
  await startSession($)
  expect(w.get('last:x')).toBeUndefined()
  expect(w.get('away:y')).toEqual(staleAway)
  expect(Object.keys((w.get('seen')) as Record<string, number>)).toEqual(['away:y'])
})

test('S5 新程式建立的每 session 鍵也記進 seen；已經記錄的時間不重寫', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { seen: { 'last:S1': 1 } }, [], 5)
  await w.clock.set(5 * DAY)
  await say($, '一則訊息')
  await distillNow($)
  const seen = w.get('seen') as Record<string, number>
  expect(seen['last:S1']).toBe(1)
  expect(seen['distill:S1']).toBe(5 * DAY)
})

// ---------- S6：失敗可見、可重送、重試有間隔 ----------

test('S6 交接失敗：記錄原因、下一則不重試、3 則之後重試', async ($, on) => {
  let turns = 10
  const w = world(on, 650_000, 1_000_000, { distill: false }, [], () => turns)
  failHandoff = true
  await stop($)
  await w.clock.settle()
  expect(w.forks.length).toBe(1)
  const err = (w.get('handoff:error:C--proj')) as { reason: string; sessionId: string; turns: number; kind: string }
  expect(err.reason).toContain('產生失敗')
  expect(err.sessionId).toBe('S1')
  expect(err.turns).toBe(10)
  expect(err.kind).toBe('present')
  expect((await cmd($, '')).text).toContain('最近失敗')
  failHandoff = false
  turns = 11
  await stop($)
  await w.clock.settle()
  expect(w.forks.length).toBe(1)
  turns = 13
  await stop($)
  await w.clock.settle()
  expect(w.forks.length).toBe(2)
  expect(w.commands).toEqual(['clear'])
})

test('S6 交接失敗：滿 10 分鐘也會重試', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, { distill: false })
  failHandoff = true
  await stop($)
  await w.clock.settle()
  failHandoff = false
  await stop($)
  await w.clock.settle()
  expect(w.forks.length).toBe(1)
  await w.clock.advance(10 * 60_000)
  await stop($)
  await w.clock.settle()
  expect(w.forks.length).toBe(2)
  expect(w.commands).toEqual(['clear'])
})

test('S6 兩個 session 各寫自己的 pendingSubmit：第二個成功只刪自己的', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, { distill: false })
  failSubmits = 1
  await stop($)
  await w.clock.settle()
  expect(typeof (w.get('pendingSubmit:S1'))).toBe('string')
  curSid = 'S2'
  await cmd($, 'now')
  await w.clock.settle()
  expect(w.submits.length).toBe(1)
  expect(w.get('pendingSubmit:S2')).toBeUndefined()
  expect(typeof (w.get('pendingSubmit:S1'))).toBe('string')
})

test('S6 攔下訊息＋/clear 成功＋送出失敗：/handoff resend 送出 handoff 與訊息，刪掉 pending', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  failSubmits = 1
  onFork = async () => { await say($, '中途訊息') }
  await stop($)
  await w.clock.settle()
  expect(w.submits).toEqual([])
  const pending = (w.get('pendingSubmit:S1')) as string
  expect(pending).toContain('HANDOFF: 測試')
  expect(pending).toContain('中途訊息')
  expect((await cmd($, '')).text).toContain('未送達的 handoff')
  await cmd($, 'resend')
  await w.clock.settle()
  expect(w.submits.length).toBe(1)
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  expect(w.submits[0]).toContain('中途訊息')
  expect(w.get('pendingSubmit:S1')).toBeUndefined()
  expect((await cmd($, '')).text).not.toContain('未送達的 handoff')
  // /clear 只有交接那一次，resend 不再 /clear
  expect(w.commands).toEqual(['clear'])
})

test('S6 新 process 的 resend：不送別的 session 的 pending；有本 process 產生的 handoff 才重送它', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'pendingSubmit:OTHER': '別的 session 的文字' })
  const r = await cmd($, 'resend')
  expect(r.text).toContain('沒有可以重送')
  await w.clock.settle()
  expect(w.submits).toEqual([])
  await cmd($, 'dry')
  await cmd($, 'resend')
  await w.clock.settle()
  expect(w.submits.length).toBe(1)
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  expect(w.submits[0]).not.toContain('別的 session')
  expect(typeof (w.get('pendingSubmit:OTHER'))).toBe('string')
})

// ---------- S7：經驗檔手動編輯不被吃掉 ----------

// 依真實專案經驗檔的結構產生的範例（內容已去識別化，行數與每行的標記格式和原檔相同）：
// 測試用它確認解析與輸出不會吃掉手動內容；測試的 fs 是模擬的，不要在測試裡讀寫真正的 ctx-handoff.md
const NOTES_FIXTURE: string = [
  "# ctx-handoff 專案經驗",
  "",
  "> 由 ctx-handoff 背景整理維護，可以直接編輯。新對話開頭會帶入記憶，以及出現 2 次以上的規則。",
  "> 最後更新：2026-10-03 23:10",
  "",
  "## 記憶",
  "- [project] 範例記憶 7：內容已去識別化",
  "- [user] 範例記憶 8：內容已去識別化",
  "- [project] 範例記憶 9：內容已去識別化",
  "- [project] 範例記憶 10：內容已去識別化",
  "- [project] 範例記憶 11：內容已去識別化",
  "- [reference] 範例記憶 12：內容已去識別化",
  "- [project] 範例記憶 13：內容已去識別化",
  "- [user] 範例記憶 14：內容已去識別化",
  "- [project] 範例記憶 15：內容已去識別化",
  "- [project] 範例記憶 16：內容已去識別化",
  "- [project] 範例記憶 17：內容已去識別化",
  "- [project] 範例記憶 18：內容已去識別化",
  "- [project] 範例記憶 19：內容已去識別化",
  "- [project] 範例記憶 20：內容已去識別化",
  "- [project] 範例記憶 21：內容已去識別化",
  "- [project] 範例記憶 22：內容已去識別化",
  "- [project] 範例記憶 23：內容已去識別化",
  "- [project] 範例記憶 24：內容已去識別化",
  "- [project] 範例記憶 25：內容已去識別化",
  "- [project] 範例記憶 26：內容已去識別化",
  "- [project] 範例記憶 27：內容已去識別化",
  "- [project] 範例記憶 28：內容已去識別化",
  "- [user] 範例記憶 29：內容已去識別化",
  "- [user] 範例記憶 30：內容已去識別化",
  "- [reference] 範例記憶 31：內容已去識別化",
  "- [reference] 範例記憶 32：內容已去識別化",
  "- [reference] 範例記憶 33：內容已去識別化",
  "- [project] 範例記憶 34：內容已去識別化",
  "- [project] 範例記憶 35：內容已去識別化",
  "- [feedback] 範例記憶 36：內容已去識別化",
  "- [project] 範例記憶 37：內容已去識別化",
  "- [project] 範例記憶 38：內容已去識別化",
  "- [project] 範例記憶 39：內容已去識別化",
  "- [project] 範例記憶 40：內容已去識別化",
  "- [project] 範例記憶 41：內容已去識別化",
  "- [reference] 範例記憶 42：內容已去識別化",
  "- [project] 範例記憶 43：內容已去識別化",
  "- [project] 範例記憶 44：內容已去識別化",
  "- [user] 範例記憶 45：內容已去識別化",
  "",
  "## 規則",
  "",
  "### 範例規則 49（1 次）",
  "- 規則：範例內容 50",
  "- 適用：範例內容 51",
  "- 根據：範例內容 52",
  "",
  "### 範例規則 54（1 次）",
  "- 規則：範例內容 55",
  "- 適用：範例內容 56",
  "- 根據：範例內容 57",
  "",
  "### 範例規則 59（2 次）",
  "- 規則：範例內容 60",
  "- 適用：範例內容 61",
  "- 根據：範例內容 62",
  "- 根據：範例內容 63",
  "",
  "### 範例規則 65（1 次）",
  "- 規則：範例內容 66",
  "- 適用：範例內容 67",
  "- 做法：範例內容 68",
  "- 根據：範例內容 69",
  "",
  "### 範例規則 71（1 次）",
  "- 規則：範例內容 72",
  "- 適用：範例內容 73",
  "- 根據：範例內容 74",
  "",
  "### 範例規則 76（2 次）",
  "- 規則：範例內容 77",
  "- 適用：範例內容 78",
  "- 根據：範例內容 79",
  "- 根據：範例內容 80",
  "",
  "### 範例規則 82（1 次）",
  "- 規則：範例內容 83",
  "- 適用：範例內容 84",
  "- 根據：範例內容 85",
  "",
  "### 範例規則 87（1 次）",
  "- 規則：範例內容 88",
  "- 適用：範例內容 89",
  "- 根據：範例內容 90",
  "",
  "### 範例規則 92（1 次）",
  "- 規則：範例內容 93",
  "- 適用：範例內容 94",
  "- 根據：範例內容 95",
  "",
  "### 範例規則 97（2 次）",
  "- 規則：範例內容 98",
  "- 適用：範例內容 99",
  "- 根據：範例內容 100",
  "- 根據：範例內容 101",
  "",
  "### 範例規則 103（4 次）",
  "- 規則：範例內容 104",
  "- 適用：範例內容 105",
  "- 根據：範例內容 106",
  "- 根據：範例內容 107",
  "- 根據：範例內容 108",
  "",
  "### 範例規則 110（2 次）",
  "- 規則：範例內容 111",
  "- 適用：範例內容 112",
  "- 根據：範例內容 113",
  "- 根據：範例內容 114",
  "",
  "### 範例規則 116（2 次）",
  "- 規則：範例內容 117",
  "- 適用：範例內容 118",
  "- 根據：範例內容 119",
  "- 根據：範例內容 120",
  "",
  "### 範例規則 122（1 次）",
  "- 規則：範例內容 123",
  "- 適用：範例內容 124",
  "- 根據：範例內容 125",
  "",
  "### 範例規則 127（1 次）",
  "- 規則：範例內容 128",
  "- 適用：範例內容 129",
  "- 根據：範例內容 130",
  "",
  "### 範例規則 132（1 次）",
  "- 規則：範例內容 133",
  "- 適用：範例內容 134",
  "- 根據：範例內容 135",
  "",
  "### 範例規則 137（1 次）",
  "- 規則：範例內容 138",
  "- 適用：範例內容 139",
  "- 根據：範例內容 140",
  "",
  "### 範例規則 142（1 次）",
  "- 規則：範例內容 143",
  "- 適用：範例內容 144",
  "- 根據：範例內容 145",
  "",
  "### 範例規則 147（1 次）",
  "- 規則：範例內容 148",
  "- 適用：範例內容 149",
  "- 根據：範例內容 150",
  "",
  "### 範例規則 152（1 次）",
  "- 規則：範例內容 153",
  "- 適用：範例內容 154",
  "- 根據：範例內容 155",
  "",
  "### 範例規則 157（1 次）",
  "- 規則：範例內容 158",
  "- 適用：範例內容 159",
  "- 根據：範例內容 160",
  "",
  "### 範例規則 162（1 次）",
  "- 規則：範例內容 163",
  "- 適用：範例內容 164",
  "- 根據：範例內容 165",
  "",
  "### 範例規則 167（1 次）",
  "- 規則：範例內容 168",
  "- 適用：範例內容 169",
  "- 根據：範例內容 170",
  "",
  "### 範例規則 172（1 次）",
  "- 規則：範例內容 173",
  "- 適用：範例內容 174",
  "- 根據：範例內容 175",
  "",
  "### 範例規則 177（1 次）",
  "- 規則：範例內容 178",
  "- 適用：範例內容 179",
  "- 根據：範例內容 180",
  "",
].join('\n')

const stripStamp = (s: string) => s.replace(/^> 最後更新：.*$/m, '')

test('S7 真實經驗檔複本：解析再輸出（扣掉更新時間）完全相同', async ($, on) => {
  let n = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => n)
  w.files.set(NOTES, NOTES_FIXTURE)
  const items = NOTES_FIXTURE.split('\n').filter(l => l.startsWith('- [')).length
  // 先加一條再刪掉：兩次都經過 parse → render，結果要回到原樣
  distillReply = actionsReply({ op: 'add_memory', type: 'project', title: '暫時的一條', evidence: '測試' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('暫時的一條')
  n = 9
  distillReply = actionsReply({ op: 'delete_memory', id: `M${items + 1}`, reason: '還原' })
  await distillNow($)
  const out = w.files.get(NOTES) ?? ''
  expect(out).not.toContain('暫時的一條')
  expect(stripStamp(out)).toBe(stripStamp(NOTES_FIXTURE))
})

test('S7 記憶的欄位原樣保留、認不得的延續行併進標題、自訂區段原樣保留；同名規則的 ADD 略過', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, [
    '# ctx-handoff 專案經驗',
    '',
    '> 由 ctx-handoff 背景整理維護，可以直接編輯。新對話開頭會帶入記憶，以及出現 2 次以上的規則。',
    '> 最後更新：2026-01-01 00:00',
    '',
    '## 記憶',
    '- [user] 第一條',
    '  延續行 A',
    '  - 縮排子項',
    '- [project] 第二條',
    '  - 做法：照做',
    '  - 理由：因為',
    '  - 根據：2026-01-01 abc｜發生過',
    '',
    '## 規則',
    '',
    '### 規則甲（2 次）',
    '- 規則：做甲',
    '- 根據：2026-01-01 一',
    '',
    '## 備註',
    '手動備註第一行',
    '- 備註清單',
    '',
  ].join('\n'))
  distillReply = actionsReply(
    { op: 'add_memory', type: 'project', title: '新增的一條', evidence: '新的' },
    { op: 'add_rule', name: '規則甲', rule: '重複的內容', applies: 'x', not_applies: 'y', evidence: '重複' },
    { op: 'add_rule', name: '規則乙', rule: '做乙', applies: 'x', not_applies: 'y', evidence: '新的' },
  )
  await distillNow($)
  expect(w.forks[0]).toContain('M1 [user] 第一條 延續行 A - 縮排子項\nM2 [project] 第二條｜做法：照做｜理由：因為｜根據：2026-01-01 abc｜發生過')
  const out = w.files.get(NOTES) ?? ''
  expect(out).toContain([
    '## 記憶',
    '- [user] 第一條 延續行 A - 縮排子項',
    '- [project] 第二條',
    '  - 做法：照做',
    '  - 理由：因為',
    '  - 根據：2026-01-01 abc｜發生過',
    '- [project] 新增的一條',
    '  - 根據：1970-01-01 S1｜新的',
    '',
  ].join('\n'))
  expect(out).toContain('### 規則甲（2 次）\n- 規則：做甲\n- 根據：2026-01-01 一\n')
  expect(out).not.toContain('重複的內容')
  expect(out.split('### 規則甲').length).toBe(2)
  expect(out).toContain('### 規則乙（1 次）')
  expect(out).toContain('## 備註\n手動備註第一行\n- 備註清單\n')
  // 自訂區段在規則之後
  expect(out.indexOf('## 備註')).toBeGreaterThan(out.indexOf('### 規則乙'))
})

// mock.clock 從 0 開始：今天是 1970-01-01，超過 30 天前的根據就算封存
const TIERED_NOTES = [
  '# ctx-handoff 專案經驗', '', '## 記憶',
  '- [feedback] 回報用條列', '  - 做法：一點一行', '  - 理由：好讀', '  - 根據：1969-01-01 abc｜使用者原話：「用條列」',
  '- [project] 新鮮的事實', '  - 做法：細節只在正本', '  - 根據：1969-12-20 abc｜最近證實過',
  '- [reference] 很久沒證實的位置', '  - 根據：1969-11-01 abc｜很久以前',
  '- [project] 沒有日期的事實',
  '', '## 規則',
].join('\n')

test('S7 記憶依類型帶入：狀態顯示整條、只帶標題、封存各幾條（不再因條數多而不帶入）', async ($, on) => {
  const w = world(on, 100_000)
  const memory = Array.from({ length: 42 }, (_, i) => `- [project] 第 ${i + 1} 條`)
  w.files.set(NOTES, TIERED_NOTES.replace('\n\n## 規則', ['', ...memory, '', '## 規則'].join('\n')))
  const s = (await cmd($, '')).text
  expect(s).toContain('記憶帶入：偏好與修正 1 條整條、事實與位置 44 條只帶標題、封存 1 條')
})

// ---------- S8：背景工作與排程（classic.Stop） ----------

test('S8 背景 shell 還在跑：不 /clear，狀態看得到原因，只提醒一次；結束後的 Stop 才交接', async ($, on) => {
  const w = world(on, 650_000)
  await stop($, { background_tasks: [task()] })
  await w.clock.advance(0)
  expect(w.commands).toEqual([])
  await stop($, { background_tasks: [task()] })
  await w.clock.advance(0)
  expect(w.commands).toEqual([])
  expect(w.toasts.filter(t => t.includes('延後')).length).toBe(1)
  expect((await cmd($, '')).text).toContain('handoff 延後')
  await stop($, { background_tasks: [task('completed')] })
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
})

test('S8 別的 Stop hook 要求繼續：這次不交接，真正停下的那次才交接', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, { distill: false })
  stopBlock = '繼續工作'
  await stop($)
  await w.clock.advance(0)
  expect(w.forks).toEqual([])
  expect(w.commands).toEqual([])
  stopBlock = undefined
  await stop($, { stop_hook_active: true })
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
})

test('S2 下層 hook 丟棄訊息：差異不被消耗，下一則才帶入', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await distillNow($)
  failSubmits = 1
  const r = await say($, '被下層丟棄')
  expect((r as { drop?: string }).drop).toBe('submit boom')
  await say($, '下一則')
  expect(w.contexts[0]?.[0]).toContain(NOTE_TAG)
})

test('S8 一次性排程還在：不 /clear', async ($, on) => {
  const w = world(on, 650_000)
  await stop($, { session_crons: [cron(false)] })
  await w.clock.advance(0)
  expect(w.commands).toEqual([])
})

test('S8 只有循環排程：照常 /clear', async ($, on) => {
  const w = world(on, 650_000)
  await stop($, { session_crons: [cron(true)] })
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
})

test('S8 超過上限：背景工作還在也交接，並在開頭註明', async ($, on) => {
  // 視窗 1M：門檻 600k，上限 min(900k, 750k) = 750k
  const w = world(on, 760_000)
  await stop($, { background_tasks: [task()] })
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
  expect(w.submits[0]).toContain('交接時仍有1 個背景工作在執行')
})

// ---------- S9：離席流程 ----------

test('S9 離席：第二則不同文字的訊息連同先前攔下的一起送進舊對話；相同文字則照原樣', async ($, on) => {
  const away = { handoff: 'H', held: '第一則' }
  const w = world(on, 100_000, 1_000_000, { 'away:S1': away })
  await say($, '第二則')
  expect(w.submits).toEqual(['第一則\n\n第二則'])
  expect(w.get('away:S1')).toBeUndefined()
  w.put('away:S1', away)
  await say($, '第一則')
  expect(w.submits[1]).toBe('第一則')
  expect(w.get('away:S1')).toBeUndefined()
})

test('S9 離席 handoff 存好後主對話又完成回合：沒有攔下訊息就刪掉離席狀態', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'H' } })
  await endTurn($)
  expect(w.get('away:S1')).toBeUndefined()
})

test('S9 已攔下訊息的離席狀態不會因回合完成被刪', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'H', held: '我回來了' } })
  await endTurn($)
  expect(w.get('away:S1')).toBeDefined()
})

// ---------- S10：長路徑專案 ----------

// ---------- JSONL 動作與工作區經驗檔 ----------

const CLAUDE_PROJECTS = 'C:/Users/u/.claude/projects'
const ALPHA = 'D:/repos/alpha'
const ALPHA_NOTES = `${CLAUDE_PROJECTS}/D--repos-alpha/memory/ctx-handoff.md`
type World = ReturnType<typeof world>
// 把 D:/repos/<name> 變成有 .git 的 repo
const repo = (w: World, dir: string) => { w.files.set(`${dir}/.git`, '') }
const read = ($: Engine, file: string) => $.tool.call({ tool: 'Read', file_path: file })
const lastOf =(w: World) => w.get('distill:last:C--proj') as { changes: string[]; rejected: { count: number; samples: string[] } }

test('JSONL 一行壞掉、一個不認得的 op：有效的照套用，記下丟棄 2 行與樣本，狀態看得到', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply(
    { op: 'add_memory', type: 'project', title: '有效的一條', evidence: 'x' },
    '{這不是 JSON',
    { op: 'explode', text: '不認得的 op' },
    '',
    { op: 'add_rule', name: '有效規則', rule: '做 Z', applies: 'a', not_applies: 'b', evidence: 'c' },
  )
  const r = await distillNow($)
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('- [project] 有效的一條')
  expect(notes).toContain('### 有效規則（1 次）\n- 規則：做 Z\n- 適用：a｜不適用：b\n- 根據：1970-01-01 c')
  const last = lastOf(w)
  expect(last.rejected.count).toBe(2)
  // 樣本帶丟棄原因，事後查得出是哪一種
  expect(last.rejected.samples[0]).toStartWith('JSON 格式錯誤（')
  expect(last.rejected.samples[0]).toEndWith('）：{這不是 JSON')
  expect(last.rejected.samples[1]).toBe('不認得的 op（explode）：{"op":"explode","text":"不認得的 op"}')
  expect(r.text).toContain('丟棄 2 行無效輸出')
})

test('JSONL 樣本最多 3 個；長的行保留頭 100 字與尾 50 字', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply('x'.repeat(300), 'b', 'c', 'd')
  await distillNow($)
  const { rejected } = lastOf(w)
  expect(rejected.count).toBe(4)
  expect(rejected.samples.length).toBe(3)
  expect(rejected.samples[0]).toEndWith(`：${'x'.repeat(100)}…${'x'.repeat(50)}`)
  expect(rejected.samples[0]?.length).toBeLessThan(260)
  expect(rejected.samples[2]).toEndWith('：c')
})

test('疑似金鑰的動作整行丟棄（任何欄位），樣本不記內容', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply(
    { op: 'add_memory', type: 'project', title: '正常的一條', evidence: 'x' },
    { op: 'add_memory', type: 'project', title: '金鑰 ghp_abcdefghijklmnop', evidence: 'x' },
    { op: 'add_rule', name: '規則', rule: '做事', applies: 'a', not_applies: 'b', evidence: 'password=hunter2' },
    { op: 'delete_memory', id: 'M1', reason: 'token: abc' },
    '這行不是 JSON 但有 api_key=zzz',
  )
  w.files.set(NOTES, EXISTING)
  await distillNow($)
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('- [project] 正常的一條')
  expect(notes).toContain('舊 A')
  expect(notes).not.toMatch(/ghp_|hunter2|api_key/)
  const { rejected } = lastOf(w)
  expect(rejected.count).toBe(4)
  expect(JSON.stringify(rejected.samples)).not.toMatch(/ghp_|hunter2|api_key|token/)
})

test('欄位裡的換行會收成一個空格，不會寫出多行或新標題', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply({ op: 'add_memory', type: 'project', title: '第一行\n## 假標題\n第三行', evidence: 'x' })
  await distillNow($)
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('- [project] 第一行 ## 假標題 第三行')
  expect(notes.match(/^## 記憶/gm)?.length).toBe(1)
})

test('動作的 type 不在 user|feedback|project|reference、缺必要欄位：丟棄', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply(
    { op: 'add_memory', type: 'bogus', text: '類型不對' },
    { op: 'add_memory', text: '沒有類型' },
    { op: 'add_memory', type: 'user' },
    { op: 'add_rule', name: '缺欄位', rule: 'r', applies: 'a', evidence: 'e' },
    { op: 'delete_rule', id: 'R1' },
  )
  w.files.set(NOTES, EXISTING)
  await distillNow($)
  expect(lastOf(w).rejected.count).toBe(5)
  expect(w.files.get(NOTES) ?? '').toBe(EXISTING)
})

test('整理提示：繁體中文指示、只有這個工作區的記憶與規則編號、JSONL 輸出格式；別的 repo 的經驗不列入', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, EXISTING)
  w.files.set(ALPHA_NOTES, '# x\n\n## 記憶\n- [user] alpha 的記憶\n\n## 規則\n\n### alpha 規則（3 次）\n- 規則：做 A\n')
  repo(w, ALPHA)
  await read($, `${ALPHA}/a.ts`)
  await distillNow($)
  const p = w.forks[0] ?? ''
  expect(p).toContain('一律用繁體中文（台灣）撰寫；程式碼、指令、路徑、錯誤訊息與專有名詞維持原文')
  expect(p).toContain('不要用他、她等代名詞猜性別')
  expect(p).toContain('M2 [project] 舊 B')
  expect(p).toContain('R1 規則一｜出現 1 次｜做 X')
  expect(p).not.toContain('alpha')
  expect(p).not.toContain('P2')
  expect(p).toContain('=== ACTIONS ===')
  expect(p).toContain('=== END ===')
  expect(p).toContain('{"op":"add_memory","type":"feedback","title":"…","how":"…","why":"…","evidence":"…","quote":"…"}')
  expect(p).toContain('{"op":"delete_rule","id":"R4","reason":"…"}')
  // 碰過別的 repo 也只寫這個工作區的經驗檔
  expect(w.files.get(ALPHA_NOTES) ?? '').not.toContain('使用者決定交接門檻維持 600k')
  expect(w.files.get(NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
})

test('沒有 ACTIONS 標記的輸出：不套用，記一行丟棄；空的 ACTIONS 區塊視為沒有變動', async ($, on) => {
  let n = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => n)
  distillReply = '我覺得沒什麼好整理的'
  await distillNow($)
  expect(w.files.has(NOTES)).toBe(false)
  expect(lastOf(w).rejected.count).toBe(1)
  n = 9
  distillReply = actionsReply()
  await distillNow($)
  expect(w.files.has(NOTES)).toBe(false)
  expect(lastOf(w).rejected.count).toBe(0)
})

// ---------- 交接時間、逾時、搬移、專案鍵 ----------

const hang = () => new Promise<void>(() => {})
const gate = () => {
  let release: () => void = () => {}
  const wait = new Promise<void>(r => { release = r })
  return { wait: () => wait, release: () => release() }
}

test('交接 fork 卡住：3 分鐘後放棄並記錄，攔下的訊息送回舊對話，之後不再攔', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  handoffGate = hang
  await stop($)
  await w.clock.advance(0)
  await say($, '等很久的訊息')
  expect(w.submits).toEqual([])
  await w.clock.advance(3 * 60_000)
  expect(w.commands).toEqual([])
  expect(w.submits).toEqual(['等很久的訊息'])
  const err = w.get('handoff:error:C--proj') as { reason: string }
  expect(err.reason).toContain('timeout')
  await say($, '之後的訊息')
  expect(w.submits.at(-1)).toBe('之後的訊息')
})

test('交接前整理很慢：handoff 好了，從交接開始最多等 5 秒就 /clear；整理之後照樣寫檔、不排入', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  const g = gate()
  distillGate = g.wait
  await stop($)
  await w.clock.advance(0)
  expect(w.commands).toEqual([])
  await w.clock.advance(4_000)
  expect(w.commands).toEqual([])
  await w.clock.advance(1_000)
  expect(w.commands).toEqual(['clear'])
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  g.release()
  await w.clock.advance(0)
  expect(w.files.get(NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  await say($, '新對話第一則')
  expect(w.contexts.at(-1)).toBeUndefined()
})

test('整理請求逾時：時限 8 分鐘交給引擎，回 aborted 就記錄，之後的整理不會被擋住', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  completeAborts = true
  await distillNow($)
  expect(w.completes[0]?.timeoutMs).toBe(8 * 60_000)
  const err = w.get('distill:error:C--proj') as { reason: string }
  expect(err.reason).toContain('timeout')
  completeAborts = false
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
})

test('交接期間：提示寫出已進行秒數；相同訊息只暫存一次；只有圖片的訊息不暫存並提示重貼', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  const g = gate()
  handoffGate = g.wait
  await stop($)
  await w.clock.advance(0)
  await w.clock.advance(5_000)
  const r1 = await say($, '同一則')
  expect(JSON.stringify(r1)).toContain('已進行 5 秒')
  const r2 = await say($, ' 同一則 ')
  expect(JSON.stringify(r2)).toContain('不會重複送出')
  const r3 = await $.prompt.submit({ text: '', attachments: [{ type: 'image', mediaType: 'image/png' }], origin: composer, wait: false })
  expect(JSON.stringify(r3)).toContain('重新貼上')
  const r4 = await $.prompt.submit({ text: '附圖的訊息', attachments: [{ type: 'image' }], origin: composer, wait: false })
  expect(JSON.stringify(r4)).toContain('已暫存')
  expect(JSON.stringify(r4)).toContain('重新貼上')
  g.release()
  await w.clock.advance(0)
  expect(w.submits.length).toBe(1)
  expect((w.submits[0] ?? '').split('同一則').length - 1).toBe(1)
  expect(w.submits[0]).toContain('附圖的訊息')
})

test('離席：只有圖片的第一則訊息不記成攔下的訊息，提示先選擇再重貼', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'H' } })
  const r = await $.prompt.submit({ text: '', attachments: [{ type: 'image' }], origin: composer, wait: false })
  expect(JSON.stringify(r)).toContain('重新貼上')
  expect(w.get('away:S1')).toEqual({ handoff: 'H' })
})


test('丟棄樣本寫出原因：舊格式編號、不認得的 op、type 無效', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, EXISTING)
  distillReply = actionsReply(
    { op: 'delete_memory', id: 'P1-M1', reason: 'x' },
    { op: 'move_memory', id: 'M1', project: 'P2' },
    { op: 'add_memory', type: 'misc', text: 'y' },
  )
  await distillNow($)
  const { rejected } = lastOf(w)
  expect(rejected.count).toBe(3)
  expect(rejected.samples[0]).toStartWith('id 不是 M#：')
  expect(rejected.samples[1]).toStartWith('不認得的 op（move_memory）：')
  expect(rejected.samples[2]).toStartWith('type 無效（misc）：')
  expect(w.files.get(NOTES) ?? '').toContain('- [feedback] 舊 A')
})

test('Bash cd 進別的 repo：P1 與 store 的專案鍵仍是 session 啟動資料夾', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(ALPHA_NOTES, EXISTING)
  repo(w, ALPHA)
  // $.session.repo() 依目前工作目錄回答：cd 進 alpha 之後就是 alpha
  curRepo = { root: ALPHA, remote: null, internal: false, name: 'alpha' }
  curCwd = ALPHA
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.files.get(ALPHA_NOTES)).toBe(EXISTING)
  expect(w.get('distill:last:C--proj')).toBeDefined()
  expect(w.get('distill:last:D--repos-alpha')).toBeUndefined()
})

test('/handoff resume 時 /clear 失敗：離席 handoff 與攔下的訊息放回去，可以再選', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'H', held: '回來的訊息' } })
  onClear = () => { throw new Error('clear boom') }
  await cmd($, 'resume')
  await w.clock.advance(0)
  expect(w.submits).toEqual([])
  expect(w.get('away:S1')).toEqual({ handoff: 'H', held: '回來的訊息' })
})

test('疑似金鑰用 JSON 跳脫寫法：仍整行丟棄，樣本與狀態都不帶內容', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply('{"op":"add_memory","type":"user","text":"db \\u0073ecret= hunter2-PLAINTEXT"}')
  const r = await distillNow($)
  const last = lastOf(w)
  expect(last.rejected.samples).toEqual(['疑似金鑰：（內容不記錄）'])
  expect(JSON.stringify(last)).not.toContain('hunter2')
  expect(r.text).not.toContain('hunter2')
  expect(w.files.get(NOTES) ?? '').not.toContain('hunter2')
})

test('從 git worktree 啟動：經驗檔與專案鍵跟著主工作樹', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  const MAIN_NOTES = `${CLAUDE_PROJECTS}/D--main/memory/ctx-handoff.md`
  w.files.set('C:/proj/.git', 'gitdir: D:/main/.git/worktrees/feat\n')
  w.files.set(MAIN_NOTES, EXISTING)
  await distillNow($)
  expect(w.files.get(MAIN_NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.files.get(NOTES)).toBeUndefined()
  expect(w.get('distill:last:D--main')).toBeDefined()
})

test('巢狀值裡的疑似金鑰：整行丟棄，樣本不帶內容', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply(
    '{"op":"add_memory","type":"bad","meta":{"k":"\\u0073k-HUNTER2XYZ"}}',
    '{"op":"add_memory","type":"user","text":["\\u0073ecret= hunter3"]}',
  )
  await distillNow($)
  const last = lastOf(w)
  expect(last.rejected.samples).toEqual(['疑似金鑰：（內容不記錄）', '疑似金鑰：（內容不記錄）'])
  expect(JSON.stringify(last)).not.toContain('HUNTER2')
  expect(JSON.stringify(last)).not.toContain('hunter3')
})

test('worktree 的 gitdir 是相對路徑：仍對到主工作樹', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  const MAIN_NOTES = `${CLAUDE_PROJECTS}/C--main/memory/ctx-handoff.md`
  w.files.set('C:/proj/.git', 'gitdir: ../main/.git/worktrees/feat\r\n')
  w.files.set(MAIN_NOTES, EXISTING)
  await distillNow($)
  expect(w.files.get(MAIN_NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.get('distill:last:C--main')).toBeDefined()
})

test('整理有變動：跳出提示，寫出項數與經驗檔的完整路徑；沒有變動不提示', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply(
    { op: 'add_memory', type: 'project', title: '第一條新記憶', evidence: 'x' },
    { op: 'add_memory', type: 'project', title: '第二條新記憶', evidence: 'x' },
  )
  await distillNow($)
  const toast = w.toasts.find(t => t.includes('經驗已更新'))
  expect(toast).toContain('經驗已更新 2 項，會跟著你下一則訊息帶入')
  expect(toast).toContain(NOTES)
  distillReply = actionsReply()
  await say($, '再一則')
  const before = w.toasts.length
  await distillNow($)
  expect(w.toasts.slice(before).some(t => t.includes('經驗已更新'))).toBe(false)
})

test('從 worktree 啟動、主工作樹還沒有經驗檔：建在主工作樹，不建在 worktree 的對話檔目錄', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  const MAIN_NOTES = `${CLAUDE_PROJECTS}/D--main/memory/ctx-handoff.md`
  w.files.set('C:/proj/.git', 'gitdir: D:/main/.git/worktrees/feat\n')
  await distillNow($)
  expect(w.files.get(MAIN_NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.files.has(NOTES)).toBe(false)
})

// ---------- 守門 ----------
const NOTES_PATH = 'C:/Users/u/.claude/projects/C--proj/memory/ctx-handoff.md'
const pushGuard = (state: string, mode = 'deny') => ({
  id: 1, rule: '推送前先跑 preflight', tool: 'Bash', match: 'git\\s+push', unless: 'preflight', message: '先跑 preflight 再推',
  mode, state, hits: 0, at: 0,
})

test('守門：啟用的 deny 擋下違規、放行符合 unless 的寫法，並記觸發次數', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('on')] })
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(blocked.deny).toContain('守門 #1')
  expect(blocked.deny).toContain('/handoff guard off 1')
  const ok = await $.tool.call({ tool: 'Bash', command: 'node cli.mjs preflight && git push' })
  expect(ok.deny).toBeUndefined()
  const other = await $.tool.call({ tool: 'Read', file_path: 'git push.md' })
  expect(other.deny).toBeUndefined()
  expect((w.get('guards:C--proj') as { hits: number }[])[0]?.hits).toBe(1)
})

test('守門：草稿與停用的不生效', async ($, on) => {
  world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed'), { ...pushGuard('off'), id: 2 }] })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(r.deny).toBeUndefined()
})

test('守門：remind 照常執行，結果後面附提醒', async ($, on) => {
  world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('on', 'remind')] })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(r.deny).toBeUndefined()
  expect(r.context?.[0]).toContain('先跑 preflight 再推')
})

test('守門：suggest 只送 3 次以上的規則，驗證草稿並試比對這段對話', async ($, on) => {
  const w = world(on, 1000)
  w.files.set(NOTES_PATH, [
    '# ctx-handoff 專案經驗', '', '## 記憶', '', '## 規則', '',
    '### 推送前先跑 preflight（3 次）', '- 規則：git push 前先跑 preflight', '',
    '### 只出現一次的規則（1 次）', '- 規則：不該送給模型',
  ].join('\n'))
  w.rows.push({ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'git push' } }, { tool: 'Bash', input: { command: 'ls' } }] })
  distillReply = actionsReply(
    { rule: '推送前先跑 preflight', tool: 'Bash', match: 'git\\s+push', unless: 'preflight', mode: 'deny', message: '先跑 preflight', bad: 'git push origin main', good: 'node cli.mjs preflight && git push' },
    { rule: '推送前先跑 preflight', tool: 'Bash', match: 'push', mode: 'remind', message: '沒有範例' },
    { rule: '不存在的規則', tool: 'Bash', match: 'x', mode: 'deny', message: 'x', bad: 'x', good: 'y' },
    { rule: '推送前先跑 preflight', tool: 'Bash', match: '(', mode: 'deny', message: '壞 regex', bad: '(', good: 'y' },
    // 什麼都擋的樣式：正確範例也被擋
    { rule: '推送前先跑 preflight', tool: 'Bash', match: '[\\s\\S]', mode: 'remind', message: '太寬', bad: 'git push', good: 'node cli.mjs preflight && git push' },
    // $ 沒跳脫：$$ 變成字串結尾，擋不到違規範例
    { rule: '推送前先跑 preflight', tool: 'Bash', match: 'do\\s+$$', mode: 'remind', message: '沒跳脫', bad: 'do $$ delete from x $$', good: 'ls' },
  )
  const r = await cmd($, 'guard suggest')
  expect(w.completes[0]?.system).toContain('### 推送前先跑 preflight')
  expect(w.completes[0]?.system).not.toContain('只出現一次的規則')
  const guards = w.get('guards:C--proj') as { id: number; state: string; replay: { hits: number; calls: number } }[]
  expect(guards.length).toBe(1)
  expect(guards[0]).toMatchObject({ id: 1, state: 'proposed', replay: { hits: 1, calls: 2 } })
  expect(r.text).toContain('丟棄 5 行')
  expect(r.text).toContain('缺 bad／good 範例')
  expect(r.text).toContain('正確範例也會被擋')
  expect(r.text).toContain('違規範例沒有被擋')
  expect(r.text).toContain('2 次工具呼叫中會命中 1 次')
  expect(r.text).toContain('範例：擋「git push origin main」，放行「node cli.mjs preflight && git push」')
  // 已有守門（任何狀態）的規則不再提
  const again = await cmd($, 'guard suggest')
  expect(again.text).toContain('沒有出現 3 次以上、還沒有守門的規則')
  expect(w.completes.length).toBe(1)
})

test('守門：/handoff guard on|mode|drop 改狀態', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed')] })
  await cmd($, 'guard on 1')
  expect((w.get('guards:C--proj') as { state: string }[])[0]?.state).toBe('on')
  await cmd($, 'guard mode 1 remind')
  expect((w.get('guards:C--proj') as { mode: string }[])[0]?.mode).toBe('remind')
  const missing = await cmd($, 'guard on 9')
  expect(missing.text).toContain('沒有守門 #9')
  await cmd($, 'guard drop 1')
  expect(w.get('guards:C--proj')).toEqual([])
})

// ---------- 面板 ----------
// 面板畫在輸入框上方（AbovePrompt）；/handoff panel 打開後才畫
const BAND_MOUNT = { plugin: 'ctx-handoff', surface: 'terminal' as const, component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} } }
// tab：打開後切到哪個分頁（預設守門）
const openPanel = async ($: Engine, tab?: string) => {
  await cmd($, 'panel')
  const ui = await $.ui.mount(BAND_MOUNT)
  if (tab) await ui.press({ key: `tab:${tab}` })
  return ui
}
const PANEL_NOTES = ['# ctx-handoff 專案經驗', '', '## 記憶', '- [project] 舊的記憶', '- [feedback] 使用者要求每次都先跑測試', '', '## 規則', '', '### 推送前先跑 preflight（3 次）', '- 規則：先跑 preflight'].join('\n')

test('面板：/handoff panel 在輸入框上方開關；問卷佔著時讓出；按關閉也會收起', async ($, on) => {
  const w = world(on, 1000)
  w.files.set(NOTES_PATH, PANEL_NOTES)
  // 下層（引擎或其他 plugin）自己畫的內容
  on('ui.render', () => h('Text', null, '下層的內容') as never)
  const closed = await $.ui.mount(BAND_MOUNT)
  expect(await closed.find({ type: 'Text', text: '下層的內容' })).toBeDefined()
  expect(await closed.find({ type: 'Text', text: /守門/ })).toBeUndefined()
  await closed.unmount()
  const r = await cmd($, 'panel')
  expect(r.text).toContain('面板已開在輸入框上方')
  const ui = await $.ui.mount(BAND_MOUNT)
  expect(await ui.find({ type: 'Text', text: 'ctx-handoff' })).toBeDefined()
  await ui.unmount()
  const survey = await $.ui.mount({ ...BAND_MOUNT, props: { ...BAND_MOUNT.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Text', text: 'ctx-handoff' })).toBeUndefined()
  await survey.unmount()
  const again = await $.ui.mount(BAND_MOUNT)
  await again.press({ key: 'close' })
  expect(await again.find({ type: 'Text', text: 'ctx-handoff' })).toBeUndefined()
  await again.unmount()
  await cmd($, 'panel')
  expect((await cmd($, 'panel')).text).toContain('面板已關閉')
})

test('面板：列出守門與記憶，按核准後守門生效', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [{ ...pushGuard('proposed'), replay: { hits: 1, calls: 4 } }] })
  w.files.set(NOTES_PATH, PANEL_NOTES)
  const ui = await openPanel($)
  expect(await ui.find({ type: 'Text', text: /草稿.*#1・擋下.*推送前先跑 preflight/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /4 次工具呼叫中命中 1 次/ })).toBeDefined()
  await ui.press({ key: 'on1' })
  await w.clock.advance(0)
  expect((w.get('guards:C--proj') as { state: string }[])[0]?.state).toBe('on')
  expect(await ui.find({ type: 'Text', text: /守門 #1 已核准/ })).toBeDefined()
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(blocked.deny).toContain('守門 #1')
  await ui.press({ key: 'tab:memory' })
  expect(await ui.find({ type: 'Text', text: /使用者要求每次都先跑測試/ })).toBeDefined()
})

test('面板：刪除記憶要按兩次，寫檔前備份原檔', async ($, on) => {
  const w = world(on, 1000)
  w.files.set(NOTES_PATH, PANEL_NOTES)
  const ui = await openPanel($, 'memory')
  const key = 'm:[feedback] 使用者要求每次都先跑測試'
  await ui.press({ key: `del:${key}` })
  await w.clock.advance(0)
  // 第一次只標記，不寫檔
  expect(w.files.get(NOTES_PATH)).toBe(PANEL_NOTES)
  await ui.press({ key: `yes:${key}` })
  await w.clock.advance(0)
  const after = w.files.get(NOTES_PATH) ?? ''
  expect(after).not.toContain('使用者要求每次都先跑測試')
  expect(after).toContain('舊的記憶')
  expect(after).toContain('### 推送前先跑 preflight（3 次）')
  const backup = [...w.files.keys()].find(p => p.includes('/memory/.ctx-handoff-backup/'))
  expect(backup && w.files.get(backup)).toBe(PANEL_NOTES)
  expect(await ui.find({ type: 'Text', text: /已刪除記憶/ })).toBeDefined()
})

test('面板：長記憶依寬度截成一行，按展開才顯示全文', async ($, on) => {
  const w = world(on, 1000)
  const long = `- [reference] ${'很長的記憶內容'.repeat(40)}結尾`
  w.files.set(NOTES_PATH, ['# ctx-handoff 專案經驗', '', '## 記憶', long, '', '## 規則'].join('\n'))
  const ui = await openPanel($, 'memory')
  const row = await ui.find({ type: 'Text', text: /很長的記憶內容/ })
  expect(row?.text).toContain('…')
  expect(row?.text).not.toContain('結尾')
  // 中文一字兩格：截短後不超過面板寬度
  expect([...(row?.text ?? '')].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1), 0)).toBeLessThanOrEqual(120)
  await ui.press({ key: `t:m:${long.slice(2)}` })
  expect(await ui.find({ type: 'Text', text: /結尾$/ })).toBeDefined()
  await ui.press({ key: `t:m:${long.slice(2)}` })
  expect(await ui.find({ type: 'Text', text: /結尾$/ })).toBeUndefined()
})

// 事故（2026-10-06）：每次重畫都重讀經驗檔與 store，切分頁卡住點不動
test('面板：切分頁、展開與重畫只讀快照不讀檔；指令改了守門，面板跟著更新', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed')] })
  w.files.set(NOTES_PATH, PANEL_NOTES)
  const ui = await openPanel($)
  w.reads.length = 0
  for (const tab of ['memory', 'rules', 'distill', 'guard']) await ui.press({ key: `tab:${tab}` })
  await ui.press({ key: 'tab:memory' })
  expect(await ui.find({ type: 'Text', text: /使用者要求每次都先跑測試/ })).toBeDefined()
  await ui.unmount()
  const again = await $.ui.mount(BAND_MOUNT)
  expect(await again.find({ type: 'Text', text: /使用者要求每次都先跑測試/ })).toBeDefined()
  expect(w.reads).toEqual([])
  await again.press({ key: 'tab:guard' })
  await cmd($, 'guard on 1')
  expect(await again.find({ type: 'Text', text: /啟用.*#1/ })).toBeDefined()
})

// ---------- 記憶的格式：給人看的標題＋給整理看的根據 ----------
test('記憶：user／feedback 要附使用者訊息裡找得到的原話；本程式注入的訊息不算', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.rows.push(
    { role: 'user', text: '以後回報都用條列', toolUses: [] },
    { role: 'user', text: '[ctx-handoff] 上一段對話的 handoff：使用者要求每次都跑全套測試', toolUses: [] },
  )
  distillReply = actionsReply(
    { op: 'add_memory', type: 'user', title: '回報用條列', evidence: '使用者說的', quote: '以後回報 都用條列' },
    { op: 'add_memory', type: 'feedback', title: '沒有原話', evidence: 'x' },
    { op: 'add_memory', type: 'user', title: '捏造的原話', evidence: 'x', quote: '每次都要寫測試' },
    { op: 'add_memory', type: 'feedback', title: '引用 handoff', evidence: 'x', quote: '每次都跑全套測試' },
  )
  await distillNow($)
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('- [user] 回報用條列')
  expect(notes).toContain('使用者原話：「以後回報 都用條列」')
  expect(notes).not.toMatch(/沒有原話|捏造的原話|引用 handoff/)
  const { rejected } = lastOf(w)
  expect(rejected.count).toBe(3)
  expect(rejected.samples[0]).toStartWith('feedback 類缺少使用者原話 quote')
  expect(rejected.samples[1]).toStartWith('quote 不在使用者訊息裡')
})

test('記憶與規則：超過字數上限整條丟掉，記下原因', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply(
    { op: 'add_memory', type: 'project', title: '長'.repeat(61), evidence: 'x' },
    { op: 'add_memory', type: 'project', title: '剛好', how: '做'.repeat(101), evidence: 'x' },
    { op: 'add_rule', name: '規則', rule: '步'.repeat(151), applies: 'a', not_applies: 'b', evidence: 'c' },
    { op: 'add_memory', type: 'project', title: '長'.repeat(60), evidence: 'x' },
  )
  await distillNow($)
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain(`- [project] ${'長'.repeat(60)}`)
  expect(notes).not.toContain('剛好')
  const { rejected } = lastOf(w)
  expect(rejected.count).toBe(3)
  expect(rejected.samples).toEqual([
    expect.stringMatching(/^title 超過 60 字/),
    expect.stringMatching(/^how 超過 100 字/),
    expect.stringMatching(/^rule 超過 150 字/),
  ])
})

test('記憶帶入新對話：偏好與修正整條、事實只帶標題、封存的不帶，都不帶根據', async ($, on) => {
  const w = world(on, 1000)
  w.files.set(NOTES, TIERED_NOTES)
  const r = await $.prompt.context({ blocks: [] })
  const text = r.blocks.find(b => b.name === 'ctxHandoffProject')?.text ?? ''
  expect(text).toContain(['## 使用者的偏好與修正', '- [feedback] 回報用條列', '  - 做法：一點一行', '  - 理由：好讀'].join('\n'))
  expect(text).toContain(['- [project] 新鮮的事實', '- [project] 沒有日期的事實'].join('\n'))
  expect(text).not.toContain('細節只在正本')
  expect(text).not.toContain('很久沒證實的位置')
  expect(text).not.toMatch(/根據|使用者原話/)
})

test('記憶確認：confirm_memory 加一筆根據，封存的因此恢復帶入；整理提示標出封存', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, TIERED_NOTES)
  distillReply = actionsReply({ op: 'confirm_memory', id: 'M3', evidence: '這次又查了一次位置' })
  await distillNow($)
  expect(w.forks[0]).toContain('M3 [reference] 很久沒證實的位置｜根據：1969-11-01 abc｜很久以前（已封存：超過 30 天沒被證實）')
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain(['- [reference] 很久沒證實的位置', '  - 根據：1969-11-01 abc｜很久以前', '  - 根據：1970-01-01 S1｜這次又查了一次位置'].join('\n'))
  expect(lastOf(w).changes).toEqual(['記憶確認：[reference] 很久沒證實的位置'])
  const r = await $.prompt.context({ blocks: [] })
  expect(r.blocks.find(b => b.name === 'ctxHandoffProject')?.text).toContain('- [reference] 很久沒證實的位置')
})

test('面板：封存的記憶另列一區，按留下就加一筆今天的根據並恢復', async ($, on) => {
  const w = world(on, 1000)
  w.files.set(NOTES, TIERED_NOTES)
  const ui = await openPanel($, 'memory')
  expect(await ui.find({ type: 'Text', text: /封存 1 條：超過 30 天沒被證實/ })).toBeDefined()
  await ui.press({ key: 'keep:[reference] 很久沒證實的位置' })
  await w.clock.advance(0)
  expect(w.files.get(NOTES) ?? '').toContain('  - 根據：1970-01-01｜在面板確認留下')
  expect(await ui.find({ type: 'Text', text: /^封存 \d+ 條/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /已留下：很久沒證實的位置/ })).toBeDefined()
})

test('記憶的根據：模型自己在開頭寫的日期去掉，只留程式補的那一個', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  distillReply = actionsReply({ op: 'add_memory', type: 'project', title: '有日期的根據', evidence: '1970-01-01｜PR #1 實測' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('  - 根據：1970-01-01 S1｜PR #1 實測')
})
