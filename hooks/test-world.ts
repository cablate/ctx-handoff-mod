// 測試共用的模擬世界與小工具：各 *.test.ts 都從這裡匯入（檔名不是 *.test.ts，測試執行器不會當成測試跑）
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const usage = (tokens: number) =>
  ({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0 })

// 一行一個 JSON 動作；包在 ACTIONS／END 標記之間
export const actionsReply = (...lines: (string | object)[]) =>
  ['=== ACTIONS ===', ...lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))), '=== END ==='].join('\n')
// 背景整理 fork 的預設回覆
export const DISTILL_REPLY = actionsReply(
  { op: 'add_memory', type: 'project', title: '使用者決定交接門檻維持 600k', evidence: '討論門檻後決定' },
  { op: 'add_memory', type: 'project', title: 'api_key=abc123 不該被寫入', evidence: '測試' },
  { op: 'add_rule', name: '先實測再下結論', rule: '宣稱現行行為前先跑一次最小實測', applies: 'API 行為不確定時', not_applies: '文件已明確保證時', evidence: 'fork 能否讀寫靠實測才確定' },
)

// 會被測試改寫的世界狀態：ES module 的 let 匯出不能被匯入端重新指派，所以放進一個可變物件，每個 world() 開頭整個重設
const fresh = () => ({
  // 背景整理 fork 的回覆；個別測試可以換掉，onFork 可以模擬 fork 期間發生的事
  distillReply: DISTILL_REPLY,
  onFork: undefined as (() => void | Promise<void>) | undefined,
  // 整理請求回 aborted（引擎依 timeoutMs 放棄）
  completeAborts: false,
  takenCommands: new Set<string>(),
  registered: [] as string[],
  // 每個 fork 都會等它：用來讓 fork 停在半空中，測試並行與交接期間的行為
  forkGate: undefined as (() => Promise<void>) | undefined,
  // 只擋整理 fork／只擋交接 fork
  distillGate: undefined as (() => Promise<void>) | undefined,
  handoffGate: undefined as (() => Promise<void>) | undefined,
  // 寫入這個路徑時失敗（模擬磁碟錯誤）
  failWrite: undefined as string | undefined,
  // $.session.repo()：依目前工作目錄回答（會跟著 cd 變）
  curRepo: null as { root: string; remote: string | null; internal: boolean; name: string } | null,
  // 交接 fork（不是整理）回傳失敗
  failHandoff: false,
  // 接下來幾次 prompt.submit 丟出例外
  failSubmits: 0,
  // /clear 執行時順便做的事（模擬 /clear 與送出之間到的訊息）
  onClear: undefined as (() => void | Promise<void>) | undefined,
  // 下層 Stop hook 要求繼續（例如另一個 plugin 擋下停止）
  stopBlock: undefined as string | undefined,
  // tool.call 底層的工具回覆：回 undefined 就是成功（{ result: 'ok' }）；測試用它模擬工具失敗
  toolReply: undefined as ((e: { tool: string; command?: string }) => { isError: true; result: string; text: string } | undefined) | undefined,
  // turn.step 底層的模型回應（回覆語言提醒的測試用）
  stepReply: { answer: '', toolUses: [] as { name: string; input: unknown }[] },
  // 底層收到的 turn.step 請求（確認本 plugin 沒有改 model、effort）
  stepSeen: undefined as { model: string; effort?: unknown } | undefined,
  curSid: 'S1',
  // session 啟動資料夾（P1）與目前工作目錄
  curRoot: 'C:\\proj',
  curCwd: 'C:/proj',
  // $.env.get 的回答；world() 重設成 Windows 環境，POSIX 的測試在 world() 之後改它
  envVars: { USERPROFILE: 'C:\\Users\\u' } as Record<string, string>,
  // /config 裡本 plugin 的欄位（ctx-handoff.<欄位>）；測試開始前可以先放值，模擬使用者設定過
  configValues: {} as Record<string, unknown>,
  // settings.json 的 pluginConfigs["ctx-handoff@…"].options（clone 載入或 claude -p 時只有這個來源）
  pluginOptions: {} as Record<string, unknown>,
})
export const ctl = fresh()

// 引擎底下的世界：用量、fork、/clear、送出、檔案，全部記下來
export const world = (on: On, tokens: number, window = 1_000_000, store: Record<string, unknown> = {}, agents: { id: string; status: string }[] = [], turns: number | (() => number) = 0,
  // 介面語言由 Claude Code 的 language 設定決定；測試預設釘在繁體中文，不看執行測試那台機器的系統語系
  language: unknown = '繁體中文') => {
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
  Object.assign(ctl, fresh())
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
  on('env.get', (_$, e: { name: string }) => ({ value: ctl.envVars[e.name] }))
  on('settings.read', () => ({ value: { language, pluginConfigs: { 'ctx-handoff@ctx-handoff-mod': { options: ctl.pluginOptions } } } }) as never)
  on('config.list', () => ({ value: Object.entries(ctl.configValues).map(([key, value]) => ({ key, value, label: key, kind: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text', provider: { plugin: 'ctx-handoff', tier: 'user' }, isLocked: false })) }) as never)
  on('config.set', (_$, e: { key: string; value: unknown }) => { ctl.configValues[e.key] = e.value; return { value: e.value } as never })
  on('session.id', () => ({ value: ctl.curSid }))
  on('session.turns', () => ({ value: turnsOf() }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window }, rateLimits: [] } }))
  on('session.repo', () => ({ value: ctl.curRepo }))
  on('session.root', () => ({ value: ctl.curRoot }))
  on('session.cwd', () => ({ value: ctl.curCwd }))
  // 工具本身：什麼都不做，只讓 tool.call 能走到本 plugin 的 hook
  on('tool.call', (_$, e) => ctl.toolReply?.(e as { tool: string; command?: string }) ?? { result: 'ok' })
  // 引擎會把路徑轉成原生格式（Windows 反斜線），比對前先統一成斜線。
  // POSIX 上引擎把 C:/... 當相對路徑，前面接工作目錄（/w/C:/...）；測試資料用 Windows 路徑，所以去掉磁碟代號前面的部分；反過來，Windows 上引擎替 /home/... 這種 POSIX 路徑補上磁碟代號（C:/home/...），也去掉
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/').replace(/^.*?\/(?=[A-Za-z]:\/)/, '').replace(/^[A-Za-z]:(?=\/(?:home|opt)\/)/, '')
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
    if (ctl.failWrite === norm(e.path)) return { deny: 'disk full' }
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('model.fork', async (_$, e: { prompt: string }) => {
    forks.push(e.prompt)
    const isDistill = e.prompt.includes('=== ACTIONS ===')
    if (isDistill) await ctl.onFork?.()
    await ctl.forkGate?.()
    if (isDistill) await ctl.distillGate?.()
    else await ctl.handoffGate?.()
    if (!isDistill && ctl.failHandoff) return { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
    const text = isDistill ? ctl.distillReply : 'HANDOFF: 測試'
    return { value: { isAnswered: true as const, text, usage: usage(tokens) } }
  })
  // 背景整理走 model.complete：記進同一個 forks 清單（系統提示＋訊息），測試照舊比對內容與次數
  on('model.complete', async (_$, e: { model: string; effort?: string; system?: string; prompt: string; timeoutMs?: number }) => {
    completes.push(e)
    forks.push(`${e.system ?? ''}\n${e.prompt}`)
    // timeoutMs 由引擎計時；ctl.completeAborts 模擬到時回 aborted
    if (ctl.completeAborts) return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: usage(0) } }
    await ctl.onFork?.()
    await ctl.forkGate?.()
    await ctl.distillGate?.()
    return { value: { isAnswered: true as const, text: ctl.distillReply, usage: usage(0) } }
  })
  // 主對話的訊息：送進對話的人類訊息依序當成使用者訊息，另外可以塞助理訊息
  on('session.messages', () => ({ value: [...rows] as never }))
  // ctl.takenCommands：已被使用者自己的指令或 skill 佔用的名稱
  on('command.register', (_$, e: { name: string }) => {
    ctl.registered.push(e.name)
    return ctl.takenCommands.has(e.name) ? { deny: `"/${e.name}" refused: it is the user's /${e.name}` } : { value: { command: e.name } }
  })
  on('session.start', (_$, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e: { name: string }) => ({ value: { tool: `mcp__ctx-handoff__${e.name}` } }) as never)
  on('prompt.context', (_$, e) => ({ blocks: [...e.blocks] }))
  on('command.run', async (_$, e: { command: string }) => {
    commands.push(e.command)
    await ctl.onClear?.()
    return { text: '' }
  })
  // 串流 hook 底層：不吐任何片段，直接回傳整個回應
  // biome-ignore lint/correctness/useYield: 底層不需要 yield
  on('turn.step', async function* (_$, e) {
    ctl.stepSeen = e
    const { answer, toolUses } = ctl.stepReply
    return { turnId: 't1', index: 0, answer, toolUses, stopReason: toolUses.length > 0 ? ('tool_use' as const) : ('end_turn' as const), usage: null }
  })
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => (ctl.stopBlock !== undefined ? { block: ctl.stopBlock } : {}))
  on('agent.list', () => ({ value: agents.map(a => ({ ...a, description: '', type: 'general-purpose' })) as never }))
  on('prompt.submit', (_$, e: { text?: string; context?: readonly string[] }) => {
    // 送不進對話：被丟棄（hook 丟例外只會被引擎略過，不會讓 $.prompt.submit 失敗）
    if (ctl.failSubmits > 0) { ctl.failSubmits -= 1; return { drop: 'submit boom' } }
    submits.push(e.text ?? '')
    contexts.push(e.context)
    rows.push({ role: 'user', text: e.text ?? '', toolUses: [] })
    return { text: e.text ?? '', context: e.context }
  })
  return { clock, forks, commands, submits, contexts, toasts, files, logs, get, put, reads, writes, completes, rows, statuses }
}

export const NOTE_TAG = '[ctx-handoff 專案經驗]'
export const DAY = 24 * 60 * 60_000
export const presentation = { isFullscreen: false, columns: 80 }
export const composer = { kind: 'composer' as const }
export const cmd = ($: Engine, args: string) =>
  $.command.run({ command: 'handoff', args, origin: composer, presentation })
export const resume = ($: Engine) => cmd($, 'resume')
export const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: composer, wait: false })
export const startSession = ($: Engine) => $.session.start({ cwd: 'C:/proj', surface: null, isInteractive: true })
export const task = (status = 'running') => ({ id: 'b1', type: 'shell', status, description: 'sleep 999' })
export const cron = (recurring: boolean) => ({ id: 'c1', schedule: '0 9 * * *', recurring, prompt: 'check' })

// 模型回應一步：answer 是這步的說明文字，tools 是這步要呼叫幾個工具；agentId 有值＝子代理的步驟
export const step = async ($: Engine, answer: string, opts: { tools?: number; agentId?: string } = {}) => {
  ctl.stepReply = { answer, toolUses: Array.from({ length: opts.tools ?? 0 }, () => ({ name: 'Read', input: {} })) }
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, ...(opts.agentId ? { agentId: opts.agentId } : {}) })
  // 讀到結束：generator 的回傳值就是這步的回應
  for (;;) {
    const it = await stream.next()
    if (it.done) return it.value
  }
}

export const endTurn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

// 主對話停下來：門檻交接在這裡判斷（含背景工作與排程快照）
export const stop = ($: Engine, extra: Partial<Parameters<Engine['classic']['Stop']>[0]> = {}) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [], ...extra })

export const NOTES = 'C:/Users/u/.claude/projects/C--proj/memory/ctx-handoff.md'
export const distillNow = ($: Engine) => cmd($, 'distill')

export const EXISTING = [
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

export const CLAUDE_PROJECTS = 'C:/Users/u/.claude/projects'
export const ALPHA = 'D:/repos/alpha'
export const ALPHA_NOTES = `${CLAUDE_PROJECTS}/D--repos-alpha/memory/ctx-handoff.md`
export type World = ReturnType<typeof world>
// 把 D:/repos/<name> 變成有 .git 的 repo
export const repo = (w: World, dir: string) => { w.files.set(`${dir}/.git`, '') }
export const lastOf =(w: World) => w.get('distill:last:C--proj') as { changes: string[]; rejected: { count: number; samples: string[] } }

export const NOTES_PATH = 'C:/Users/u/.claude/projects/C--proj/memory/ctx-handoff.md'
export const pushGuard = (state: string, mode = 'deny') => ({
  id: 1, rule: '推送前先跑 preflight', tool: 'Bash', match: 'git\\s+push', unless: 'preflight', message: '先跑 preflight 再推',
  mode, state, hits: 0, at: 0,
})

// 面板畫在輸入框上方（AbovePrompt）；/handoff panel 打開後才畫
export const BAND_MOUNT = { plugin: 'ctx-handoff', surface: 'terminal' as const, component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} } }
// tab：打開後切到哪個分頁（預設守門）
export const openPanel = async ($: Engine, tab?: string) => {
  await cmd($, 'panel')
  const ui = await $.ui.mount(BAND_MOUNT)
  if (tab) await ui.press({ key: `tab:${tab}` })
  return ui
}
export const PANEL_NOTES = ['# ctx-handoff 專案經驗', '', '## 記憶', '- [project] 舊的記憶', '- [feedback] 使用者要求每次都先跑測試', '', '## 規則', '', '### 推送前先跑 preflight（3 次）', '- 規則：先跑 preflight'].join('\n')
