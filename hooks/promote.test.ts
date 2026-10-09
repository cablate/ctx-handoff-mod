// 放進專案：證實多次的規則與啟用中的守門，交代 AI 寫進 repo；AI 不用回報，背景整理從對話認出放在哪
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { actionsReply, cmd, ctl, startSession, NOTES, distillNow, lastOf, pushGuard, say, world } from './test-world'

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
const promoteBlockOf = async ($: Engine) =>
  (await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'ctxHandoffPromote')?.text
const endSession = ($: Engine, sid: string) => $.session.end({ reason: 'clear', sessionId: sid, resume: { id: sid } })
// git repo 裡、有一條 4 次的規則
const repoWorld = (on: Parameters<typeof world>[0], store: Record<string, unknown> = {}) => {
  const w = world(on, 100_000, 1_000_000, store, [], 5)
  w.files.set(NOTES, PROMOTE_NOTES)
  w.files.set('C:/proj/.git', '')
  return w
}

test('放進專案：git repo 裡，出現 3 次以上的規則與啟用中的守門在新對話開頭交代；不到 3 次的不交代；不用呼叫工具回報', async ($, on) => {
  const w = repoWorld(on, { 'guards:C--proj': [pushGuard('on'), { ...pushGuard('proposed'), id: 2 }] })
  await startSession($)
  const text = (await promoteBlockOf($)) ?? ''
  expect(text).toContain('請在這一輪回覆結束前處理：先做完使用者這次交代的事')
  expect(text).toContain('不要 commit 或 push')
  expect(text).toContain('不用呼叫任何工具回報')
  expect(text).not.toContain('mark_in_project')
  expect(text).toContain('- 規則「正式站刪除要斷言筆數」（4 次）：DELETE 前先在 DO 區塊斷言筆數')
  expect(text).toContain('- 守門 #1（擋下）：推送前先跑 preflight')
  expect(text).not.toContain('規則二')
  expect(text).not.toContain('守門 #2')
  // 草稿 #2 不在放進 repo 的交代裡，另由守門詢問（q:2）問使用者要不要採用
  expect(Object.keys(w.get('promote:C--proj') as object).sort()).toEqual(['g:1', 'q:2', 'r:正式站刪除要斷言筆數'])
  expect((w.get('promote:C--proj') as Record<string, { sid: string }>)['g:1']?.sid).toBe('S1')
})

test('放進專案：不是 git repo（例如在家目錄開的 session）就不交代', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, PROMOTE_NOTES)
  await startSession($)
  expect(await promoteBlockOf($)).toBeUndefined()
})

// 舊程式：交代 2 次沒回報就永遠不再交代，也沒人知道（2026-10-09 一個實際專案的 3 條守門卡住）
test('放進專案：交給的對話還在時不交給別的對話；它結束就收回，下一段再交代，沒有次數上限', async ($, on) => {
  const w = repoWorld(on)
  await startSession($)
  expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
  // S1 還在進行：另一段對話不交代
  ctl.curSid = 'S2'
  expect(await promoteBlockOf($)).toBeUndefined()
  for (const [ended, next] of [['S1', 'S3'], ['S3', 'S4'], ['S4', 'S5']] as const) {
    await endSession($, ended)
    expect(w.get('promote:C--proj')).toEqual({})
    ctl.curSid = next
    expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
  }
})

test('放進專案：整理看過交代之後的對話卻沒看到放好，就收回，下一段新對話再交代', async ($, on) => {
  const w = repoWorld(on)
  await startSession($)
  expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
  await w.clock.advance(60_000)
  ctl.distillReply = actionsReply()
  await distillNow($)
  expect(w.get('promote:C--proj')).toEqual({})
  ctl.curSid = 'S2'
  expect(await promoteBlockOf($)).toContain('正式站刪除要斷言筆數')
})

test('放進專案：整理提示列出還沒放進 repo 的項目與 in_project 的寫法', async ($, on) => {
  const w = repoWorld(on, { 'guards:C--proj': [pushGuard('on')] })
  await distillNow($)
  const prompt = w.forks.at(-1) ?? ''
  const section = prompt.slice(prompt.indexOf('五、放進 repo'), prompt.indexOf('- 附上的對話裡，AI 實際'))
  expect(section.split('\n').slice(1).filter(Boolean)).toEqual(['G1 推送前先跑 preflight', 'R1 正式站刪除要斷言筆數'])
  expect(prompt).toContain('{"op":"in_project","id":"R2","where":"CLAUDE.md"}')
})

test('放進專案：整理認出放好了，規則記「已在」、不再帶入也不再交代；守門停用 ctx-handoff 自己這份', async ($, on) => {
  const w = repoWorld(on, { 'guards:C--proj': [pushGuard('on')] })
  w.files.set('C:/proj/AGENTS.md', '# agents')
  w.files.set('C:/proj/.claude/hooks/push-guard.mjs', '')
  await startSession($)
  await promoteBlockOf($)
  ctl.distillReply = actionsReply(
    { op: 'in_project', id: 'R1', where: 'AGENTS.md' },
    // 絕對路徑改成 repo 裡的路徑
    { op: 'in_project', id: 'G1', where: 'C:/proj/.claude/hooks/push-guard.mjs' },
  )
  await w.clock.advance(60_000)
  await distillNow($)
  // 記下放進去時是第幾次：之後次數再增加，就是寫成文字後又被糾正，該升級成守門
  expect(w.files.get(NOTES) ?? '').toContain('### 正式站刪除要斷言筆數（4 次）\n- 規則：DELETE 前先在 DO 區塊斷言筆數\n- 專案：已在 AGENTS.md（第 4 次時）\n')
  const g = (w.get('guards:C--proj') as { state: string; project?: string }[])[0]
  expect(g?.state).toBe('off')
  expect(g?.project).toBe('已在 .claude/hooks/push-guard.mjs')
  expect(w.get('promote:C--proj')).toEqual({})
  expect(lastOf(w).changes).toEqual(['已放進 repo：正式站刪除要斷言筆數 → AGENTS.md', '已放進 repo：推送前先跑 preflight → .claude/hooks/push-guard.mjs'])
  ctl.curSid = 'S2'
  const blocks = (await $.prompt.context({ blocks: [] })).blocks
  expect(blocks.find(b => b.name === 'ctxHandoffPromote')).toBeUndefined()
  expect(blocks.find(b => b.name === 'ctxHandoffProject')?.text ?? '').not.toContain('正式站刪除要斷言筆數')
})

test('放進專案：repo 裡沒有那個檔案、編號不是待放的項目，都丟掉並記進丟棄樣本', async ($, on) => {
  const w = repoWorld(on)
  ctl.distillReply = actionsReply(
    { op: 'in_project', id: 'R1', where: 'AGENTS.md' },
    { op: 'in_project', id: 'R2', where: 'CLAUDE.md' },
  )
  w.files.set('C:/proj/CLAUDE.md', '')
  await distillNow($)
  expect(w.files.get(NOTES)).toBe(PROMOTE_NOTES)
  const last = lastOf(w)
  expect(last.rejected.count).toBe(2)
  expect(last.rejected.samples.join('\n')).toContain('repo 裡沒有 AGENTS.md')
  expect(last.rejected.samples.join('\n')).toContain('沒有編號 R2')
})

test('放進專案：使用者說不要就記「不放」（要附使用者原話），照常帶入、不再交代', async ($, on) => {
  const w = repoWorld(on)
  await say($, '斷言筆數那條不要放進 repo')
  ctl.distillReply = actionsReply({ op: 'not_in_project', id: 'R1', quote: '不要放進 repo' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('- 專案：不放')
  expect(lastOf(w).changes).toEqual(['使用者不要放進 repo：正式站刪除要斷言筆數'])
  const blocks = (await $.prompt.context({ blocks: [] })).blocks
  expect(blocks.find(b => b.name === 'ctxHandoffProject')?.text ?? '').toContain('正式站刪除要斷言筆數')
  expect(blocks.find(b => b.name === 'ctxHandoffPromote')).toBeUndefined()
})

test('放進專案：「不放」找不到使用者原話就丟掉', async ($, on) => {
  const w = repoWorld(on)
  ctl.distillReply = actionsReply({ op: 'not_in_project', id: 'R1', quote: '不要放進 repo' })
  await distillNow($)
  expect(w.files.get(NOTES)).toBe(PROMOTE_NOTES)
  expect(lastOf(w).rejected.count).toBe(1)
})

test('放進專案：已在專案的規則不會再被提議成個人守門，整理提示也標出 repo 才是正本', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, PROMOTE_NOTES.replace('- 規則：DELETE 前先在 DO 區塊斷言筆數', '- 規則：DELETE 前先在 DO 區塊斷言筆數\n- 專案：已在 AGENTS.md'))
  expect((await cmd($, 'guard suggest')).text).toContain('沒有寫進 repo 後又被糾正、或不放進 repo 卻講了 3 次以上、還沒有守門的規則')
  await distillNow($)
  expect(w.forks.at(-1) ?? '').toContain('正式站刪除要斷言筆數｜出現 4 次｜DELETE 前先在 DO 區塊斷言筆數｜已在 AGENTS.md（repo 裡的才是正本，不要 update_rule；AI 又犯而被使用者糾正時照樣 confirm_rule）')
})
