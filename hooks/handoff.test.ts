// 交接主流程：門檻、閒置刷新、離席 handoff、交接期間訊息不遺失、背景工作與排程、store 鍵分專案
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { NOTE_TAG, DAY, presentation, composer, cmd, resume, say, startSession, task, cron, endTurn, stop, NOTES, distillNow, ctl, world } from './test-world'

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

// ---------- S1：交接期間訊息不遺失 ----------

test('S1 門檻交接期間：人類訊息被攔下，最終送出的文字包含它', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  // 交接 fork 產生摘要期間送出
  ctl.handoffGate = async () => { await say($, '中途訊息') }
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
  ctl.onClear = async () => { await say($, '晚到的訊息') }
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
  ctl.forkGate = () => gate
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
  ctl.forkGate = () => gate
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
  ctl.failHandoff = true
  ctl.onFork = async () => { await say($, '中途訊息') }
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual([])
  expect(w.submits).toEqual(['中途訊息'])
})

test('S1 交接 fork 與交接前整理同時發出', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  ctl.forkGate = () => gate
  await stop($)
  await w.clock.settle()
  // 兩個 fork 都還沒回來就都已經發出
  expect(w.forks.length).toBe(2)
  expect(w.commands).toEqual([])
  release()
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
})

// 舊程式：整理一次只能跑一個，交接撞上正在跑的整理就直接跳過交接前整理；
// 正在跑的那次只讀到它開始時的對話，到交接之間的最後一段永遠沒被整理（/clear 後新對話從頭算）
test('S1 交接時已有整理在跑：交接前先讀好最後一段，等那次整理結束再補整理', async ($, on) => {
  let turns = 5
  const w = world(on, 650_000, 1_000_000, {}, [], () => turns)
  w.rows.push({ role: 'user', text: '第一段的對話', toolUses: [] })
  let release: () => void = () => {}
  const gate = new Promise<void>(r => { release = r })
  ctl.distillGate = () => gate
  const first = distillNow($)
  await w.clock.settle()
  expect(w.completes.length).toBe(1)
  // 整理還在跑，對話往前走並到門檻
  w.rows.push({ role: 'user', text: '最後一段：之後一律先跑測試', toolUses: [] })
  turns = 8
  // /clear 之後是新對話：換 session、訊息清空
  ctl.onClear = () => { ctl.curSid = 'S2'; w.rows.length = 0 }
  await stop($)
  await w.clock.settle()
  // 不等整理就交接
  expect(w.commands).toEqual(['clear'])
  expect(w.logs.some(l => l.includes('排在它之後'))).toBe(true)
  release()
  await first
  await w.clock.settle()
  expect(w.completes.length).toBe(2)
  expect(w.completes[1]?.prompt).toContain('最後一段：之後一律先跑測試')
  // 記在舊 session 的進度：下次不重複整理同一段
  expect((w.get('distill:S1') as { turn: number }).turn).toBe(8)
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
  ctl.takenCommands = new Set(['handoff'])
  await startSession($)
  expect(ctl.registered).toEqual(['handoff', 'ctx-handoff'])
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
  ctl.stopBlock = '繼續工作'
  await stop($)
  await w.clock.advance(0)
  expect(w.forks).toEqual([])
  expect(w.commands).toEqual([])
  ctl.stopBlock = undefined
  await stop($, { stop_hook_active: true })
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
})

test('S2 下層 hook 丟棄訊息：差異不被消耗，下一則才帶入', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await distillNow($)
  ctl.failSubmits = 1
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

// 2026-10-08：交接摘要要分開已驗證與未驗證、列出失敗過的做法、還在跑的東西與使用者的限制，避免接手時做錯
test('交接提示：要求分開已驗證與未驗證、失敗做法、沒收尾的東西、使用者限制', async ($, on) => {
  const w = world(on, 650_000)
  await stop($)
  await w.clock.advance(0)
  const prompt = w.forks.find(p => p.includes('HANDOFF:')) ?? ''
  for (const part of ['已驗證', '未驗證', '試過但失敗', '還在跑', '使用者在這次工作中給的限制', '一個具體動作']) expect(prompt).toContain(part)
})
