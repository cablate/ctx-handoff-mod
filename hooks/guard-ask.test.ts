// 守門的升級流程（維護者 2026-10-09 決定）：寫成文字還擋不住的規則，背景自動起草守門，
// 下一段新對話請 AI 問使用者要不要採用，使用者在對話裡的回答由背景整理記下
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { NOTES, actionsReply, ctl, distillNow, pushGuard, say, startSession, world } from './test-world'

// 寫進 CLAUDE.md 時是第 3 次，之後又被糾正一次（4 次）
const NOTES_ESCALATED = [
  '# ctx-handoff 專案經驗', '', '## 記憶', '', '## 規則', '',
  '### 推送前先跑 preflight（4 次）', '- 規則：git push 前先跑 preflight', '- 專案：已在 CLAUDE.md（第 3 次時）', '',
].join('\n')
const DRAFT = { rule: '推送前先跑 preflight', tool: 'Bash', match: 'git\\s+push', unless: 'preflight', mode: 'remind', message: '先跑 preflight 再推', bad: 'git push origin main', good: 'node cli.mjs preflight && git push' }
const askOf = async ($: Engine) => (await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'ctxHandoffGuardAsk')?.text
const guardsOf = (w: ReturnType<typeof world>) => (w.get('guards:C--proj') ?? []) as { id: number; state: string }[]

test('守門升級：放進 repo 之後又被糾正的規則，整理完背景起草守門；次數沒再增加就不重起草', async ($, on) => {
  let turns = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => turns)
  w.files.set(NOTES, NOTES_ESCALATED)
  ctl.distillReply = actionsReply(DRAFT)
  await distillNow($)
  expect(w.completes.length).toBe(2)
  expect(w.completes[1]?.system).toContain('### 推送前先跑 preflight')
  expect(guardsOf(w)).toMatchObject([{ id: 1, state: 'proposed' }])
  expect(w.get('guardTried:C--proj')).toEqual({ '推送前先跑 preflight': 4 })
  // 模型判斷寫不成守門：記下次數，不重試
  w.put('guards:C--proj', [])
  turns = 6
  await w.clock.advance(60_000)
  await distillNow($)
  // 只有整理，沒有再起草
  expect(w.completes.length).toBe(3)
})

test('守門升級：放進 repo 時記下是第幾次；之後沒再被糾正的不起草', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, NOTES_ESCALATED.replace('（4 次）', '（3 次）'))
  ctl.distillReply = actionsReply(DRAFT)
  await distillNow($)
  expect(w.completes.length).toBe(1)
  expect(guardsOf(w)).toEqual([])
})

test('守門詢問：新對話開頭請 AI 做完使用者的事再問要不要採用；交給的對話還在時不問別段，它結束再問', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed', 'remind')] })
  w.files.set(NOTES, NOTES_ESCALATED)
  await startSession($)
  const text = (await askOf($)) ?? ''
  expect(text).toContain('先做完使用者這次交代的事，再在回覆最後用一兩句白話問使用者要不要採用')
  expect(text).toContain('- 守門 #1（提醒）：規則「推送前先跑 preflight」（使用者提過 4 次；git push 前先跑 preflight）｜工具 Bash 符合 /git\\s+push/，除非 /preflight/時，告訴 AI：先跑 preflight 再推')
  expect(text).toContain('不用呼叫任何工具，背景整理會從對話記下')
  ctl.curSid = 'S2'
  expect(await askOf($)).toBeUndefined()
  await $.session.end({ reason: 'clear', sessionId: 'S1', resume: { id: 'S1' } })
  ctl.curSid = 'S3'
  expect(await askOf($)).toContain('守門 #1')
})

for (const [label, op, state, change] of [
  ['採用', 'approve_guard', 'on', '使用者採用守門 #1：推送前先跑 preflight'],
  ['不要', 'decline_guard', 'off', '使用者不要守門 #1：推送前先跑 preflight'],
] as const) {
  test(`守門詢問：使用者說${label}，整理從對話記下（要附使用者原話），之後不再問`, async ($, on) => {
    const w = world(on, 100_000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed', 'remind')] }, [], 5)
    w.files.set(NOTES, NOTES_ESCALATED)
    await startSession($)
    await askOf($)
    await say($, `守門那條${label}`)
    ctl.distillReply = actionsReply({ op, id: 'G1', quote: `守門那條${label}` })
    await w.clock.advance(60_000)
    await distillNow($)
    expect(w.completes[0]?.system).toContain('六、守門草稿')
    expect(w.completes[0]?.system).toContain('G1 推送前先跑 preflight')
    expect(guardsOf(w)[0]?.state).toBe(state)
    expect((w.get('distill:last:C--proj') as { changes: string[] }).changes).toContain(change)
    expect(Object.keys(w.get('promote:C--proj') as object)).not.toContain('q:1')
    ctl.curSid = 'S2'
    expect(await askOf($)).toBeUndefined()
  })
}

test('守門詢問：找不到使用者原話、或不是待問的草稿，都不算', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed', 'remind'), { ...pushGuard('on'), id: 2 }] }, [], 5)
  w.files.set(NOTES, NOTES_ESCALATED)
  ctl.distillReply = actionsReply({ op: 'approve_guard', id: 'G1', quote: '好啊採用' }, { op: 'approve_guard', id: 'G2', quote: '好啊採用' })
  await distillNow($)
  expect(guardsOf(w).map(g => g.state)).toEqual(['proposed', 'on'])
  expect((w.get('distill:last:C--proj') as { rejected: { count: number } }).rejected.count).toBe(2)
})
