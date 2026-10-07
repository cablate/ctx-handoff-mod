// 流程：背景整理學到的多步驟固定做法。存進經驗檔的「## 流程」、不帶入新對話，次數夠多時交給 AI 做成專案的 skill
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { actionsReply, cmd, ctl, distillNow, lastOf, NOTES, NOTES_PATH, openPanel, startSession, world } from './test-world'
import { parseNotes, renderNotes } from './notes'

const RELEASE = {
  name: '發版',
  when: '要發新版本時',
  steps: ['改 plugin.json 的版本號', '把 Unreleased 移到新版本', '打 tag', '建立 GitHub release'],
}
const addRelease = { op: 'add_procedure', ...RELEASE, evidence: '這段對話發了兩次版' }

// 一份有記憶、規則、流程與自訂區段的經驗檔（次數可調）
const withProcedure = (count: number, extraLines: string[] = []) => [
  '# ctx-handoff 專案經驗',
  '',
  '## 記憶',
  '- [feedback] 舊 A',
  '',
  '## 規則',
  '',
  '### 規則一（1 次）',
  '- 規則：做 X',
  '',
  '## 流程',
  '',
  `### 發版（${count} 次）`,
  '- 時機：要發新版本時',
  '- 步驟：',
  '  1. 改 plugin.json 的版本號',
  '  2. 打 tag',
  '  3. 建立 GitHub release',
  '- 根據：1970-01-01 做過兩次',
  ...extraLines,
  '',
].join('\n')

const PROMOTE_TOOL_NAME = 'mcp__ctx-handoff__mark_in_project'
const promoteBlockOf = async ($: Engine) =>
  (await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'ctxHandoffPromote')?.text
const mark = ($: Engine, items: unknown[]) => $.tool.call({ tool: PROMOTE_TOOL_NAME, items } as never)

test('流程：解析再輸出逐位元相同；沒有流程的舊檔不多出一段；自訂區段仍保留在後面', () => {
  const text = withProcedure(3, ['- 專案：已在 .claude/skills/release/SKILL.md', '', '## 自訂區段', '原樣保留'])
  const notes = parseNotes(text)
  expect(notes.procedures).toHaveLength(1)
  expect(notes.procedures[0]).toMatchObject({ name: '發版', count: 3 })
  expect(notes.rules.map(r => r.name)).toEqual(['規則一'])
  expect(notes.extra).toEqual(['## 自訂區段', '原樣保留'])
  const stamp = '2026-10-08 10:00'
  const out = renderNotes(notes, stamp)
  // 流程段落原樣輸出在規則之後、自訂區段之前
  expect(out).toContain(text.slice(text.indexOf('## 流程')))
  expect(out.indexOf('## 規則')).toBeLessThan(out.indexOf('## 流程'))
  expect(renderNotes(parseNotes(out), stamp)).toBe(out)
  expect(parseNotes(out)).toEqual(notes)
  // 沒有流程：不輸出「## 流程」
  expect(renderNotes({ ...notes, procedures: [] }, stamp)).not.toContain('## 流程')
})

test('流程：整理新增、確認、更新、刪除，格式與次數、根據都由程式維護', async ($, on) => {
  let n = 5
  const w = world(on, 100_000, 1_000_000, {}, [], () => n)
  ctl.distillReply = actionsReply(addRelease, { ...addRelease, name: '發版（2 次）' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain([
    '## 流程',
    '',
    '### 發版（1 次）',
    '- 時機：要發新版本時',
    '- 步驟：',
    '  1. 改 plugin.json 的版本號',
    '  2. 把 Unreleased 移到新版本',
    '  3. 打 tag',
    '  4. 建立 GitHub release',
    '- 根據：1970-01-01 這段對話發了兩次版',
  ].join('\n'))
  // 同名（含模型自己加的「（2 次）」）只留一條
  expect((w.files.get(NOTES) ?? '').match(/### 發版/g)).toHaveLength(1)
  expect(lastOf(w).changes).toEqual(['新流程：發版（4 步，出現 1 次）'])

  n = 40
  ctl.distillReply = actionsReply(
    { op: 'confirm_procedure', id: 'P1', evidence: '又發了一次版' },
    { op: 'update_procedure', id: 'P1', steps: ['1. 改版本號', '2) 打 tag', '建立 release'] },
  )
  await distillNow($)
  // 整理提示列出現有流程
  expect(w.forks.at(-1) ?? '').toContain('P1 發版｜出現 1 次｜時機：要發新版本時｜步驟：改 plugin.json 的版本號 → 把 Unreleased 移到新版本 → 打 tag → 建立 GitHub release')
  const after = w.files.get(NOTES) ?? ''
  expect(after).toContain([
    '### 發版（2 次）',
    '- 時機：要發新版本時',
    '- 步驟：',
    '  1. 改版本號',
    '  2. 打 tag',
    '  3. 建立 release',
    '- 根據：1970-01-01 這段對話發了兩次版',
    '- 根據：1970-01-01 又發了一次版',
  ].join('\n'))
  expect(lastOf(w).changes).toEqual(['流程確認：發版 → 出現 2 次', '更新流程：發版'])

  n = 80
  ctl.distillReply = actionsReply({ op: 'delete_procedure', id: 'P1', reason: '不再這樣發版' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').not.toContain('發版')
})

test('流程：欄位不合格的整條丟掉並記下原因（步驟數、空步驟、長度、缺欄位、編號）', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, withProcedure(1))
  const bad = (patch: object) => ({ ...addRelease, name: `壞${Math.random()}`, ...patch })
  ctl.distillReply = actionsReply(
    bad({ steps: ['只有一步'] }),
    bad({ steps: Array.from({ length: 9 }, (_, i) => `步驟${i}`) }),
    bad({ steps: ['甲', ''] }),
    bad({ steps: '甲 → 乙' }),
    bad({ steps: ['甲', '長'.repeat(81)] }),
    bad({ when: undefined }),
    bad({ name: '長'.repeat(41) }),
    { op: 'confirm_procedure', id: 'P2', evidence: '沒有這個編號' },
    { op: 'confirm_procedure', id: 'R1', evidence: '編號種類不對' },
    { op: 'update_procedure', id: 'P1' },
    { op: 'delete_procedure', id: 'P1' },
    { op: 'add_procedure', name: '合格', when: '什麼時候', steps: ['甲', '乙'], evidence: '有證據' },
  )
  await distillNow($)
  const { rejected, changes } = lastOf(w)
  expect(rejected.count).toBe(11)
  expect(rejected.samples).toEqual([
    expect.stringMatching(/^steps 要是 2 到 8 個非空字串/),
    expect.stringMatching(/^steps 要是 2 到 8 個非空字串/),
    expect.stringMatching(/^steps 要是 2 到 8 個非空字串/),
  ])
  expect(changes).toEqual(['新流程：合格（2 步，出現 1 次）'])
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('### 發版（1 次）')
  expect(notes).not.toContain('壞')
  expect(notes).toContain('  1. 甲\n  2. 乙')
  // 舊檔的其他區段不受影響
  expect(notes).toContain('### 規則一（1 次）\n- 規則：做 X')
})

test('流程：已放進專案的在整理提示標出 repo 才是正本；上限與編號種類另有原因', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, withProcedure(3, ['- 專案：已在 .claude/skills/release/SKILL.md']))
  ctl.distillReply = actionsReply({ op: 'confirm_procedure', id: 'R1', evidence: 'x' }, { op: 'confirm_procedure', id: 'P3', evidence: 'x' })
  await distillNow($)
  expect(w.forks[0] ?? '').toContain('｜已在 .claude/skills/release/SKILL.md（repo 裡的才是正本，不要 update_procedure）')
  expect(lastOf(w).rejected.samples).toEqual(['id 不是 P#：{"op":"confirm_procedure","id":"R1","evidence":"x"}', '沒有編號 P3：{"op":"confirm_procedure","id":"P3","evidence":"x"}'])
})

test('流程：不帶入新對話（只有流程時連專案經驗區塊都沒有）', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, withProcedure(5))
  const r = await $.prompt.context({ blocks: [] })
  const text = r.blocks.find(b => b.name === 'ctxHandoffProject')?.text ?? ''
  expect(text).toContain('舊 A')
  expect(text).not.toContain('發版')
  expect(text).not.toContain('plugin.json')
  w.files.set(NOTES, ['# ctx-handoff 專案經驗', '', '## 記憶', '', '## 規則', '', '## 流程', '', '### 發版（5 次）', '- 時機：要發新版本時', ''].join('\n'))
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
})

test('流程：git repo 裡出現 3 次以上就交代 AI 做成 skill；不到 3 次、不是 git repo 不交代', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set('C:/proj/.git', '')
  w.files.set(NOTES, withProcedure(2))
  await startSession($)
  expect(await promoteBlockOf($)).toBeUndefined()
  w.files.set(NOTES, withProcedure(3))
  const text = (await promoteBlockOf($)) ?? ''
  expect(text).toContain('- 流程「發版」（3 次）：要發新版本時｜步驟：1. 改 plugin.json 的版本號；2. 打 tag；3. 建立 GitHub release')
  expect(text).toContain('.claude/skills/<kebab-case 名稱>/SKILL.md')
  expect(text).toContain('frontmatter 有 name')
  expect(text).toContain('description')
  expect(text).toContain('不要另開重複的')
  expect(text).toContain('不要 commit 或 push')
  expect(text).toContain(`${PROMOTE_TOOL_NAME}`)
  expect(text).toContain('流程用 procedure')
  expect(Object.keys(w.get('promote:C--proj') as object)).toEqual(['p:發版'])
})

test('流程：沒有流程的交代文字不提 skill', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set('C:/proj/.git', '')
  w.files.set(NOTES, ['# x', '', '## 規則', '', '### 規則三（3 次）', '- 規則：做 Z', ''].join('\n'))
  await startSession($)
  const text = (await promoteBlockOf($)) ?? ''
  expect(text).toContain('規則三')
  expect(text).not.toContain('SKILL.md')
  expect(text).toContain('4. 完成後呼叫')
})

test('流程：不是 git repo 不交代；交代過的 6 小時內不再交代，最多 2 次', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, withProcedure(3))
  await startSession($)
  expect(await promoteBlockOf($)).toBeUndefined()
  w.files.set('C:/proj/.git', '')
  expect(await promoteBlockOf($)).toContain('流程「發版」')
  expect(await promoteBlockOf($)).toBeUndefined()
  await w.clock.advance(6 * 60 * 60_000)
  expect(await promoteBlockOf($)).toContain('流程「發版」')
  await w.clock.advance(6 * 60 * 60_000)
  expect(await promoteBlockOf($)).toBeUndefined()
})

test('流程：AI 回報 skill 位置後記「已在」，不再交代；不放就記「不放」；找不到的回報給 AI', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set('C:/proj/.git', '')
  w.files.set(NOTES, withProcedure(3).replace('## 流程\n', '## 流程\n\n### 備份資料（4 次）\n- 時機：每週\n- 步驟：\n  1. 匯出\n  2. 上傳\n  3. 驗證\n'))
  await startSession($)
  expect(await promoteBlockOf($)).toContain('流程「備份資料」')
  const r = await mark($, [
    { procedure: '發版', where: '.claude/skills/release/SKILL.md' },
    { procedure: '備份資料', declined: true },
    { procedure: '備份資料2', where: 'x' },
    { procedure: '發版2' },
  ])
  const result = String(r.result)
  expect(result).toContain('流程「發版」：已在 .claude/skills/release/SKILL.md')
  expect(result).toContain('流程「備份資料」：不放')
  expect(result).toContain('流程「備份資料2」：經驗檔裡沒有這條')
  expect(result).toContain('流程「發版2」：缺少 where')
  const notes = w.files.get(NOTES) ?? ''
  expect(notes).toContain('  3. 建立 GitHub release\n- 根據：1970-01-01 做過兩次\n- 專案：已在 .claude/skills/release/SKILL.md')
  expect(notes).toContain('  3. 驗證\n- 專案：不放')
  expect(w.get('promote:C--proj')).toEqual({})
  await w.clock.advance(7 * 60 * 60_000)
  expect(await promoteBlockOf($)).toBeUndefined()
})

test('流程：面板在規則分頁列出次數與「已在」，刪除要按兩次並備份原檔', async ($, on) => {
  const w = world(on, 1000)
  const text = withProcedure(3, ['- 專案：已在 .claude/skills/release/SKILL.md'])
  w.files.set(NOTES_PATH, text)
  const ui = await openPanel($, 'rules')
  expect(await ui.find({ type: 'Text', text: /流程 1 條/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 次 發版.*已在 \.claude\/skills\/release\/SKILL\.md/ })).toBeDefined()
  await ui.press({ key: 'del:p:發版' })
  await w.clock.advance(0)
  expect(w.files.get(NOTES_PATH)).toBe(text)
  await ui.press({ key: 'yes:p:發版' })
  await w.clock.advance(0)
  const after = w.files.get(NOTES_PATH) ?? ''
  expect(after).not.toContain('發版')
  expect(after).not.toContain('## 流程')
  expect(after).toContain('### 規則一（1 次）')
  const backup = [...w.files.keys()].find(p => p.includes('/memory/.ctx-handoff-backup/'))
  expect(backup && w.files.get(backup)).toBe(text)
  expect(await ui.find({ type: 'Text', text: /已刪除流程「發版」/ })).toBeDefined()
})

test('流程：/handoff 狀態列出流程條數與已放進專案的條數；沒有流程就沒有這一行', async ($, on) => {
  const w = world(on, 100_000)
  w.files.set(NOTES, withProcedure(3, ['- 專案：已在 .claude/skills/release/SKILL.md']))
  expect((await cmd($, '')).text).toContain('工作區流程：1 條（已放進專案 skill 或文件 1 條；流程不帶入新對話）')
  w.files.set(NOTES, '# x\n\n## 記憶\n\n## 規則\n')
  expect((await cmd($, '')).text).not.toContain('工作區流程')
})
