// 放進專案：證實多次的規則與啟用中的守門，交代 AI 寫進 repo，AI 用工具回報
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { cmd, startSession, NOTES, distillNow, pushGuard, world } from './test-world'

// ---------- 放進專案：證實多次的規則與啟用中的守門，交代 AI 寫進 repo，AI 用工具回報 ----------
const PROMOTE_NOTES = [
  '# ctx-handoff 專案經驗',
  '',
  '## 記憶',
  '- [feedback] 舊 A',
  '',
  '## 規則',
  '',
  '### 正式站刪除要斷言筆數（4 次）',
  '- 規則：DELETE 前先在 DO 區塊斷言筆數',
  '',
  '### 規則二（2 次）',
  '- 規則：做 Y',
  '',
].join('\n')
const PROMOTE_TOOL_NAME = 'mcp__ctx-handoff__mark_in_project'
const promoteBlockOf = async ($: Engine) =>
  (await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'ctxHandoffPromote')?.text
const markInProject = ($: Engine, items: unknown[]) => $.tool.call({ tool: PROMOTE_TOOL_NAME, items } as never)

// 2026-10-07 實際專案：session 重開（resume）後回合數不是 0，舊程式就不註冊，引擎把工具撤掉，AI 只好直接改 store 檔
test('放進專案：已經有對話紀錄的 session（重開或熱重載）也照樣註冊工具並交代', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 4)
  w.files.set(NOTES, PROMOTE_NOTES)
  w.files.set('C:/proj/.git', '')
  await startSession($)
  expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
  expect(String((await markInProject($, [{ rule: '正式站刪除要斷言筆數', where: 'AGENTS.md' }])).result)).toContain('已在 AGENTS.md')
})

test('放進專案：git repo 裡，出現 3 次以上的規則與啟用中的守門在新對話開頭交代；不到 3 次的不交代', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'guards:C--proj': [pushGuard('on'), { ...pushGuard('proposed'), id: 2 }] })
  w.files.set(NOTES, PROMOTE_NOTES)
  w.files.set('C:/proj/.git', '')
  await startSession($)
  const text = (await promoteBlockOf($)) ?? ''
  expect(text).toContain('請在這一輪回覆結束前處理：先做完使用者這次交代的事')
  expect(text).toContain('不要 commit 或 push')
  expect(text).toContain(PROMOTE_TOOL_NAME)
  expect(text).toContain('- 規則「正式站刪除要斷言筆數」（4 次）：DELETE 前先在 DO 區塊斷言筆數')
  expect(text).toContain('- 守門 #1（擋下）：推送前先跑 preflight')
  expect(text).not.toContain('規則二')
  expect(text).not.toContain('守門 #2')
  expect(Object.keys(w.get('promote:C--proj') as object).sort()).toEqual(['g:1', 'r:正式站刪除要斷言筆數'])
})

test('放進專案：不是 git repo（例如在家目錄開的 session）就不交代', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, PROMOTE_NOTES)
  await startSession($)
  expect(await promoteBlockOf($)).toBeUndefined()
})

test('放進專案：交代過的 6 小時內不再交代，同一條最多交代 2 次', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, PROMOTE_NOTES)
  w.files.set('C:/proj/.git', '')
  await startSession($)
  expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
  expect(await promoteBlockOf($)).toBeUndefined()
  await w.clock.advance(6 * 60 * 60_000)
  expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
  await w.clock.advance(6 * 60 * 60_000)
  expect(await promoteBlockOf($)).toBeUndefined()
})

test('放進專案：AI 回報放好後，規則記「已在」、不再帶入也不再交代；守門停用個人這份', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'guards:C--proj': [pushGuard('on')] })
  w.files.set(NOTES, PROMOTE_NOTES)
  w.files.set('C:/proj/.git', '')
  await startSession($)
  await promoteBlockOf($)
  const r = await markInProject($, [
    { rule: '正式站刪除要斷言筆數', where: 'AGENTS.md' },
    { guard: 1, where: '.claude/hooks/push-guard.mjs' },
  ])
  expect(String(r.result)).toContain('規則「正式站刪除要斷言筆數」：已在 AGENTS.md')
  expect(String(r.result)).toContain('守門 #1：已在 .claude/hooks/push-guard.mjs')
  expect(w.files.get(NOTES) ?? '').toContain('### 正式站刪除要斷言筆數（4 次）\n- 規則：DELETE 前先在 DO 區塊斷言筆數\n- 專案：已在 AGENTS.md')
  const g = (w.get('guards:C--proj') as { state: string; project?: string }[])[0]
  expect(g?.state).toBe('off')
  expect(g?.project).toBe('已在 .claude/hooks/push-guard.mjs')
  expect(w.get('promote:C--proj')).toEqual({})
  await w.clock.advance(7 * 60 * 60_000)
  const blocks = (await $.prompt.context({ blocks: [] })).blocks
  expect(blocks.find(b => b.name === 'ctxHandoffPromote')).toBeUndefined()
  expect(blocks.find(b => b.name === 'ctxHandoffProject')?.text ?? '').not.toContain('正式站刪除要斷言筆數')
})

test('放進專案：使用者不要就記「不放」，照常帶入、不再交代；缺 where 或找不到的回報給 AI', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, PROMOTE_NOTES.replace('### 規則二（2 次）', '### 規則二（3 次）'))
  w.files.set('C:/proj/.git', '')
  await startSession($)
  const r = await markInProject($, [
    { rule: '正式站刪除要斷言筆數', declined: true },
    { rule: '規則二' },
    { rule: '沒有這條', where: 'AGENTS.md' },
  ])
  expect(String(r.result)).toContain('規則「正式站刪除要斷言筆數」：不放')
  expect(String(r.result)).toContain('規則「規則二」：缺少 where')
  expect(String(r.result)).toContain('規則「沒有這條」：經驗檔裡沒有這條')
  expect(w.files.get(NOTES) ?? '').toContain('- 專案：不放')
  const blocks = (await $.prompt.context({ blocks: [] })).blocks
  expect(blocks.find(b => b.name === 'ctxHandoffProject')?.text ?? '').toContain('正式站刪除要斷言筆數')
  const promote = blocks.find(b => b.name === 'ctxHandoffPromote')?.text ?? ''
  expect(promote).not.toContain('正式站刪除要斷言筆數')
  expect(promote).toContain('規則「規則二」')
})

test('放進專案：已在專案的規則不會再被提議成個人守門，整理提示也標出 repo 才是正本', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, PROMOTE_NOTES.replace('- 規則：DELETE 前先在 DO 區塊斷言筆數', '- 規則：DELETE 前先在 DO 區塊斷言筆數\n- 專案：已在 AGENTS.md'))
  expect((await cmd($, 'guard suggest')).text).toContain('沒有出現 3 次以上、還沒有守門的規則')
  await distillNow($)
  expect(w.forks.at(-1) ?? '').toContain('正式站刪除要斷言筆數｜出現 4 次｜DELETE 前先在 DO 區塊斷言筆數｜已在 AGENTS.md（repo 裡的才是正本，不要 update_rule）')
})
