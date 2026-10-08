// 交接的失敗與時間：失敗可見可重送、重試間隔、fork 卡住與逾時、搬移、專案鍵
import { expect, test } from 'claude-code/testing'
import { composer, cmd, say, stop, NOTES, distillNow, EXISTING, CLAUDE_PROJECTS, ALPHA, ALPHA_NOTES, repo, lastOf, actionsReply, ctl, world } from './test-world'

// ---------- S6：失敗可見、可重送、重試有間隔 ----------

test('S6 交接失敗：記錄原因、下一則不重試、3 則之後重試', async ($, on) => {
  let turns = 10
  const w = world(on, 650_000, 1_000_000, { distill: false }, [], () => turns)
  ctl.failHandoff = true
  await stop($)
  await w.clock.settle()
  expect(w.forks.length).toBe(1)
  const err = (w.get('handoff:error:C--proj')) as { reason: string; sessionId: string; turns: number; kind: string }
  expect(err.reason).toContain('產生失敗')
  expect(err.sessionId).toBe('S1')
  expect(err.turns).toBe(10)
  expect(err.kind).toBe('present')
  expect((await cmd($, '')).text).toContain('最近失敗')
  ctl.failHandoff = false
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
  ctl.failHandoff = true
  await stop($)
  await w.clock.settle()
  ctl.failHandoff = false
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
  ctl.failSubmits = 1
  await stop($)
  await w.clock.settle()
  expect(typeof (w.get('pendingSubmit:S1'))).toBe('string')
  ctl.curSid = 'S2'
  await cmd($, 'now')
  await w.clock.settle()
  expect(w.submits.length).toBe(1)
  expect(w.get('pendingSubmit:S2')).toBeUndefined()
  expect(typeof (w.get('pendingSubmit:S1'))).toBe('string')
})

test('S6 攔下訊息＋/clear 成功＋送出失敗：/handoff resend 送出 handoff 與訊息，刪掉 pending', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  ctl.failSubmits = 1
  ctl.onFork = async () => { await say($, '中途訊息') }
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

// ---------- 交接時間、逾時、搬移、專案鍵 ----------

const hang = () => new Promise<void>(() => {})
const gate = () => {
  let release: () => void = () => {}
  const wait = new Promise<void>(r => { release = r })
  return { wait: () => wait, release: () => release() }
}

test('交接 fork 卡住：5 分鐘後放棄並記錄，攔下的訊息送回舊對話，之後不再攔', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  ctl.handoffGate = hang
  await stop($)
  await w.clock.advance(0)
  await say($, '等很久的訊息')
  expect(w.submits).toEqual([])
  await w.clock.advance(3 * 60_000)
  expect(w.submits).toEqual([])
  await w.clock.advance(2 * 60_000)
  expect(w.commands).toEqual([])
  expect(w.submits).toEqual(['等很久的訊息'])
  const err = w.get('handoff:error:C--proj') as { reason: string }
  expect(err.reason).toContain('timeout')
  await say($, '之後的訊息')
  expect(w.submits.at(-1)).toBe('之後的訊息')
})

test('交接前整理很慢：對話片段先讀好，handoff 一好就 /clear，不等整理；整理之後照樣寫檔、不排入', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  const g = gate()
  ctl.distillGate = g.wait
  await stop($)
  await w.clock.advance(0)
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
  ctl.completeAborts = true
  await distillNow($)
  expect(w.completes[0]?.timeoutMs).toBe(8 * 60_000)
  const err = w.get('distill:error:C--proj') as { reason: string }
  expect(err.reason).toContain('timeout')
  ctl.completeAborts = false
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
})

test('交接期間：提示寫出已進行秒數；相同訊息只暫存一次；只有圖片的訊息不暫存並提示重貼', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  const g = gate()
  ctl.handoffGate = g.wait
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
  ctl.distillReply = actionsReply(
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
  ctl.curRepo = { root: ALPHA, remote: null, internal: false, name: 'alpha' }
  ctl.curCwd = ALPHA
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.files.get(ALPHA_NOTES)).toBe(EXISTING)
  expect(w.get('distill:last:C--proj')).toBeDefined()
  expect(w.get('distill:last:D--repos-alpha')).toBeUndefined()
})

test('/handoff resume 時 /clear 失敗：離席 handoff 與攔下的訊息放回去，可以再選', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'H', held: '回來的訊息' } })
  ctl.onClear = () => { throw new Error('clear boom') }
  await cmd($, 'resume')
  await w.clock.advance(0)
  expect(w.submits).toEqual([])
  expect(w.get('away:S1')).toEqual({ handoff: 'H', held: '回來的訊息' })
})

test('疑似金鑰用 JSON 跳脫寫法：仍整行丟棄，樣本與狀態都不帶內容', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.distillReply = actionsReply('{"op":"add_memory","type":"user","text":"db \\u0073ecret= hunter2-PLAINTEXT"}')
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
  ctl.distillReply = actionsReply(
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
