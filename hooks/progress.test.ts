// 進度備忘：整理順手產生 set_progress、依工作區存在 $.store、下一段對話開頭提供一次
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { latestProgress, parseActions } from './distill'
import { parseNotes } from './notes'
import { agoText, progressOffer } from './progress'
import type { Progress } from './progress'
import { DAY, NOTE_TAG, NOTES, actionsReply, cmd, ctl, distillNow, say, stop, world } from './test-world'

const HOUR = 60 * 60_000
const PROGRESS = {
  op: 'set_progress', task: '修好登入頁的逾時', state: 'in_progress', verified: 'npm test：12 項通過',
  next: '補 refresh token 過期的測試', files: ['src/auth/login.ts', 'src/auth/login.test.ts'],
}
const KEY = 'progress:C--proj'
// 別的 session（S0）留下的進度，at=0（mock 時鐘從 0 開始）
const OLD: Progress = { sid: 'S0', at: 0, task: '搬資料庫設定', state: 'blocked', next: '等使用者給連線字串', files: ['config/db.ts'] }
const blockOf = async ($: Engine) => (await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'ctxHandoffProgress')?.text

// ---------- 解析與驗證 ----------

const parse = (...lines: (string | object)[]) => parseActions(actionsReply(...lines), parseNotes(''))

test('set_progress：有效的收下；done 可以沒有下一步；同一批取最後一個有效的', () => {
  const ok = parse(PROGRESS)
  expect(ok.rejected.count).toBe(0)
  expect(latestProgress(ok.actions)).toEqual({
    task: PROGRESS.task, state: 'in_progress', verified: PROGRESS.verified, next: PROGRESS.next, files: PROGRESS.files,
  })
  expect(latestProgress(parse({ op: 'set_progress', task: '發版', state: 'done' }).actions)).toEqual({ task: '發版', state: 'done', files: [] })
  const two = parse(PROGRESS, { ...PROGRESS, task: '第二個' }, { ...PROGRESS, task: '壞的', state: '??' })
  expect(latestProgress(two.actions)?.task).toBe('第二個')
  expect(two.rejected.count).toBe(1)
  expect(latestProgress(parse().actions)).toBeUndefined()
})

test('set_progress：缺欄位、狀態無效、太長、檔案太多、總長超過、疑似金鑰都整行丟棄', () => {
  const bad = (o: object) => {
    const r = parse({ ...PROGRESS, ...o })
    expect(latestProgress(r.actions)).toBeUndefined()
    return r.rejected
  }
  expect(bad({ task: undefined }).count).toBe(1)
  expect(bad({ next: undefined }).count).toBe(1)
  expect(bad({ state: 'finished' }).samples[0]).toContain('finished')
  expect(bad({ task: 'x'.repeat(81) }).samples[0]).toContain('task')
  expect(bad({ verified: 'x'.repeat(121) }).count).toBe(1)
  expect(bad({ next: 'x'.repeat(121) }).count).toBe(1)
  expect(bad({ files: ['a', 'b', 'c', 'd', 'e', 'f'] }).samples[0]).toContain('files')
  expect(bad({ files: ['x'.repeat(81)] }).count).toBe(1)
  expect(bad({ files: 'src/a.ts' }).samples[0]).toContain('files')
  expect(bad({ task: '改 api_key=abc123 的讀法' }).samples[0]).not.toContain('abc123')
})

test('set_progress：每個欄位都沒超過但加起來超過 600 字才丟棄，剛好 600 字收下', () => {
  const full = { task: 'a'.repeat(80), verified: 'b'.repeat(120), next: 'c'.repeat(120) }
  const atLimit = parse({ ...PROGRESS, ...full, files: ['d'.repeat(80), 'e'.repeat(80), 'f'.repeat(80), 'g'.repeat(40)] })
  expect(atLimit.rejected.count).toBe(0)
  expect(latestProgress(atLimit.actions)?.files.length).toBe(4)
  const over = parse({ ...PROGRESS, ...full, files: ['d'.repeat(80), 'e'.repeat(80), 'f'.repeat(80), 'g'.repeat(41)] })
  expect(over.rejected.count).toBe(1)
  expect(over.rejected.samples[0]).toContain('600')
  expect(latestProgress(over.actions)).toBeUndefined()
})

test('提供的條件：不同 session、24 小時內、沒交接、還沒提供過', () => {
  const p: Progress = { ...OLD, at: 1000 }
  expect(progressOffer(p, 'S1', 1000 + HOUR)).toContain('1 小時前')
  expect(progressOffer(p, 'S0', 1000 + HOUR)).toBeUndefined()
  expect(progressOffer(p, 'S1', 1000 + 24 * HOUR)).toBeDefined()
  expect(progressOffer(p, 'S1', 1000 + 24 * HOUR + 1)).toBeUndefined()
  expect(progressOffer({ ...p, handed: true }, 'S1', 2000)).toBeUndefined()
  expect(progressOffer({ ...p, offered: ['S1'] }, 'S1', 2000)).toBeUndefined()
  expect(progressOffer({ ...p, offered: ['S1'] }, 'S2', 2000)).toBeDefined()
  expect(progressOffer(undefined, 'S1', 2000)).toBeUndefined()
  expect([0, 20_000, 5 * 60_000, 59 * 60_000, 90 * 60_000, 23 * HOUR].map(agoText)).toEqual(['剛才', '剛才', '5 分鐘前', '59 分鐘前', '2 小時前', '23 小時前'])
})

// ---------- 整理時存下 ----------

test('整理：存在工作區的鍵（session、時間、內容），不寫進經驗檔、不算變動、不跳 toast', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.distillReply = actionsReply(PROGRESS)
  await w.clock.advance(5000)
  await distillNow($)
  const { op: _op, ...fields } = PROGRESS
  expect(w.get(KEY)).toEqual({ ...fields, sid: 'S1', at: 5000 })
  expect(w.files.get(NOTES)).toBeUndefined()
  expect(lastChanges(w)).toEqual([])
  expect(w.toasts).toEqual([])
})

const lastChanges = (w: ReturnType<typeof world>) => (w.get('distill:last:C--proj') as { changes: string[] }).changes

test('整理：工作區不同、鍵就不同（從 git worktree 啟動算主工作樹）', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.curRoot = 'D:/repos/alpha'
  ctl.distillReply = actionsReply(PROGRESS)
  await distillNow($)
  expect(w.get('progress:D--repos-alpha')).toBeDefined()
  expect(w.get(KEY)).toBeUndefined()
})

test('整理：模型沒輸出 set_progress 或輸出無效的，前一份進度保留；有新的就整份取代', async ($, on) => {
  let turns = 5
  const w = world(on, 100_000, 1_000_000, { [KEY]: { ...OLD, offered: ['S9'] } }, [], () => turns)
  const round = async (reply: string) => { turns += 5; ctl.distillReply = reply; await distillNow($) }
  await round(actionsReply())
  expect(w.completes.length).toBe(1)
  expect(w.get(KEY)).toEqual({ ...OLD, offered: ['S9'] })
  await round(actionsReply({ ...PROGRESS, state: 'bad' }))
  expect(w.completes.length).toBe(2)
  expect(w.get(KEY)).toEqual({ ...OLD, offered: ['S9'] })
  await round(actionsReply(PROGRESS))
  const saved = w.get(KEY) as Progress
  expect(saved.task).toBe(PROGRESS.task)
  expect(saved.sid).toBe('S1')
  expect(saved.offered).toBeUndefined()
})

test('整理提示：附上目前的進度讓模型接著更新；沒有就寫（無）；超過一天的當作沒有', async ($, on) => {
  let turns = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => turns)
  ctl.distillReply = actionsReply(PROGRESS)
  await distillNow($)
  expect(w.completes[0]?.system).toContain('目前的進度：（無）')
  expect(w.completes[0]?.system).toContain('set_progress')
  turns += 5
  await distillNow($)
  expect(w.completes[1]?.system).toContain(`目前的進度：剛才：任務「${PROGRESS.task}」`)
  await w.clock.advance(25 * HOUR)
  turns += 5
  await distillNow($)
  expect(w.completes[2]?.system).toContain('目前的進度：（無）')
})

// ---------- 新對話開頭提供 ----------

test('不同 session、24 小時內：開頭提供一次（相對時間、任務、狀態、驗證、下一步、檔案）', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { [KEY]: { ...OLD, verified: '跑過 migrate 乾跑' } })
  await w.clock.advance(2 * HOUR)
  const text = await blockOf($)
  expect(text).toBe([
    `${NOTE_TAG} 上一段對話（2 小時前）停在：任務「搬資料庫設定」、狀態卡住了、最後驗證：跑過 migrate 乾跑、下一步：等使用者給連線字串、相關檔案：config/db.ts。`,
    '這是背景整理留下的簡短備忘，可能落後幾則訊息。使用者要接續時以此為起點，動手前先看實際的檔案與 git 狀態；使用者在做別的事就忽略，不要主動提起。',
  ].join('\n'))
  // 帶在 prompt.context 的獨立區塊，不影響經驗區塊
  expect((await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })).blocks.map(b => b.name)).toEqual(['currentDate'])
})

test('同一段對話只提供一次（compaction 後 prompt.context 重算也不重複）；另一段新對話還是會提供', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { [KEY]: OLD })
  expect(await blockOf($)).toContain('搬資料庫設定')
  expect(await blockOf($)).toBeUndefined()
  expect((w.get(KEY) as Progress).offered).toEqual(['S1'])
  ctl.curSid = 'S2'
  expect(await blockOf($)).toContain('搬資料庫設定')
  expect((w.get(KEY) as Progress).offered).toEqual(['S1', 'S2'])
})

test('不提供：超過 24 小時、同一個 session 留下的、已交接的、設定關閉', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { [KEY]: OLD })
  await w.clock.advance(DAY)
  expect(await blockOf($)).toContain('24 小時前')
  await w.clock.advance(1)
  expect(await blockOf($)).toBeUndefined()
  w.put(KEY, { ...OLD, at: w.clock.now() })
  ctl.curSid = 'S0'
  expect(await blockOf($)).toBeUndefined()
  ctl.curSid = 'S1'
  w.put(KEY, { ...OLD, at: w.clock.now(), handed: true })
  expect(await blockOf($)).toBeUndefined()
})

test('設定 resume_hint 關閉：不提供，也不記成已提供', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { [KEY]: OLD })
  ctl.pluginOptions = { resume_hint: false }
  expect(await blockOf($)).toBeUndefined()
  expect(w.get(KEY)).toEqual(OLD)
  expect((await cmd($, '')).text).toContain('resume_hint 已關')
})

test('面板改 resume_hint：改回開啟後，下一則訊息起就提供', async ($, on) => {
  world(on, 100_000, 1_000_000, { [KEY]: OLD })
  ctl.panelSettings = { resume_hint: false }
  expect(await blockOf($)).toBeUndefined()
  ctl.panelSettings = { resume_hint: true }
  await say($, '繼續')
  expect(await blockOf($)).toContain('搬資料庫設定')
})

// ---------- /clear 與自動交接 ----------

test('使用者自己 /clear：session id 換了，剛整理出來的進度在新對話開頭提供', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.distillReply = actionsReply(PROGRESS)
  await distillNow($)
  expect(await blockOf($)).toBeUndefined()
  // 還在同一段對話：不提供給自己
  ctl.curSid = 'S2'
  await w.clock.advance(10 * 60_000)
  const text = await blockOf($)
  expect(text).toContain('上一段對話（10 分鐘前）停在：任務「修好登入頁的逾時」、狀態進行中')
  expect(text).toContain('最後驗證：npm test：12 項通過')
  expect(text).toContain('下一步：補 refresh token 過期的測試')
  expect(text).toContain('相關檔案：src/auth/login.ts、src/auth/login.test.ts')
})

test('自動交接 /clear：handoff 摘要已涵蓋，新對話不再提供進度', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  ctl.distillReply = actionsReply(PROGRESS)
  ctl.onClear = () => { ctl.curSid = 'S2' }
  await stop($)
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
  expect(w.submits[0]).toContain('HANDOFF: 測試')
  expect((w.get(KEY) as Progress).task).toBe(PROGRESS.task)
  expect((w.get(KEY) as Progress).handed).toBe(true)
  expect(await blockOf($)).toBeUndefined()
  // 之後 S2 自己整理出的新進度，不受影響
  ctl.curSid = 'S3'
  expect(await blockOf($)).toBeUndefined()
})

// 舊程式：/clear 之後才跑完的整理不存進度，留下的是更早、別的 session 的進度，新對話反而拿到過時的那份
test('自動交接：整理慢，/clear 之後才跑完：存成最新進度但標記已交接，不提供', async ($, on) => {
  // 別的 session 留下的舊進度
  const w = world(on, 650_000, 1_000_000, { [KEY]: { ...PROGRESS, task: '更早的任務', sid: 'S0', at: 0 } }, [], 5)
  let release: () => void = () => {}
  const wait = new Promise<void>(r => { release = r })
  ctl.distillGate = () => wait
  ctl.distillReply = actionsReply(PROGRESS)
  ctl.onClear = () => { ctl.curSid = 'S2' }
  await stop($)
  await w.clock.advance(0)
  expect(w.commands).toEqual(['clear'])
  release()
  await w.clock.advance(0)
  expect((w.get(KEY) as Progress).task).toBe(PROGRESS.task)
  expect((w.get(KEY) as Progress).handed).toBe(true)
  expect(await blockOf($)).toBeUndefined()
})

test('自動交接時 /clear 失敗：還原交接標記，之後開的新對話仍會提供', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5)
  ctl.distillReply = actionsReply(PROGRESS)
  ctl.onClear = () => { throw new Error('clear boom') }
  await stop($)
  await w.clock.advance(0)
  expect(w.submits).toEqual([])
  expect((w.get(KEY) as Progress).handed).toBeUndefined()
  ctl.curSid = 'S2'
  expect(await blockOf($)).toContain(PROGRESS.task)
})

// ---------- 狀態 ----------

test('/handoff 狀態：顯示最近一份進度（時間與任務）；沒有就不顯示', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  expect((await cmd($, '')).text).not.toContain('最近進度')
  ctl.distillReply = actionsReply(PROGRESS)
  await distillNow($)
  const line = ((await cmd($, ''))?.text ?? '').split(/\r?\n/).find(l => l.startsWith('最近進度：')) ?? ''
  expect(line).toContain('修好登入頁的逾時（進行中）')
  expect(line).not.toContain('resume_hint')
  expect(w.get(KEY)).toBeDefined()
})
