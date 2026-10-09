// 經驗檔：手動編輯不被吃掉、POSIX 路徑、記憶的格式（標題、根據、原話）
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { cmd, say, NOTES, distillNow, EXISTING, CLAUDE_PROJECTS, lastOf, openPanel, actionsReply, ctl, world } from './test-world'

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
  ctl.distillReply = actionsReply({ op: 'add_memory', type: 'project', title: '暫時的一條', evidence: '測試' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('暫時的一條')
  n = 9
  ctl.distillReply = actionsReply({ op: 'delete_memory', id: `M${items + 1}`, reason: '還原' })
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
  ctl.distillReply = actionsReply(
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

// ---------- POSIX 路徑（Linux／macOS）：HOME=/home/u、工作區 /home/u/proj ----------
// 其他測試用 Windows 路徑；這幾個確保 /home/... 也對得到經驗檔，不依賴磁碟代號
const POSIX_PROJECTS = '/home/u/.claude/projects'
const posixWorld = (on: On) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.envVars = { HOME: '/home/u' }
  ctl.curRoot = '/home/u/proj'
  ctl.curCwd = '/home/u/proj'
  return w
}

test('POSIX：經驗檔在 <HOME>/.claude/projects/<-home-u-proj>/memory，整理寫進去', async ($, on) => {
  const w = posixWorld(on)
  await distillNow($)
  expect(w.files.get(`${POSIX_PROJECTS}/-home-u-proj/memory/ctx-handoff.md`) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.get('distill:last:-home-u-proj')).toBeDefined()
})

test('POSIX：CLAUDE_CONFIG_DIR 優先於 HOME', async ($, on) => {
  const w = posixWorld(on)
  ctl.envVars = { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/opt/claude-cfg' }
  await distillNow($)
  expect(w.files.get('/opt/claude-cfg/projects/-home-u-proj/memory/ctx-handoff.md') ?? '').toContain('使用者決定交接門檻維持 600k')
})

test('POSIX：從 git worktree 啟動，經驗檔跟著主工作樹（絕對路徑 gitdir）', async ($, on) => {
  const w = posixWorld(on)
  const MAIN_NOTES = `${POSIX_PROJECTS}/-home-u-main/memory/ctx-handoff.md`
  w.files.set('/home/u/proj/.git', 'gitdir: /home/u/main/.git/worktrees/feat\n')
  w.files.set(MAIN_NOTES, EXISTING)
  await distillNow($)
  expect(w.files.get(MAIN_NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
  expect(w.files.has(`${POSIX_PROJECTS}/-home-u-proj/memory/ctx-handoff.md`)).toBe(false)
})

test('POSIX：worktree 的 gitdir 是相對路徑，仍對到主工作樹', async ($, on) => {
  const w = posixWorld(on)
  const MAIN_NOTES = `${POSIX_PROJECTS}/-home-u-main/memory/ctx-handoff.md`
  w.files.set('/home/u/proj/.git', 'gitdir: ../main/.git/worktrees/feat\n')
  w.files.set(MAIN_NOTES, EXISTING)
  await distillNow($)
  expect(w.files.get(MAIN_NOTES) ?? '').toContain('使用者決定交接門檻維持 600k')
})

test('整理有變動：跳出提示，寫出項數與經驗檔的完整路徑；沒有變動不提示', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.distillReply = actionsReply(
    { op: 'add_memory', type: 'project', title: '第一條新記憶', evidence: 'x' },
    { op: 'add_memory', type: 'project', title: '第二條新記憶', evidence: 'x' },
  )
  await distillNow($)
  const toast = w.toasts.find(t => t.includes('經驗已更新'))
  expect(toast).toContain('經驗已更新 2 項，會跟著你下一則訊息帶入')
  expect(toast).toContain(NOTES)
  ctl.distillReply = actionsReply()
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

// ---------- 記憶的格式：給人看的標題＋給整理看的根據 ----------
test('記憶：user／feedback 要附使用者訊息裡找得到的原話；本程式注入的訊息不算', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.rows.push(
    { role: 'user', text: '以後回報都用條列', toolUses: [] },
    { role: 'user', text: '[ctx-handoff] 上一段對話的 handoff：使用者要求每次都跑全套測試', toolUses: [] },
  )
  ctl.distillReply = actionsReply(
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
  ctl.distillReply = actionsReply(
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
  expect(text).toContain(['## 使用者的偏好與修正（照做，不用再問使用者）', '- [feedback] 回報用條列', '  - 做法：一點一行', '  - 理由：好讀'].join('\n'))
  expect(text).toContain(['- [project] 新鮮的事實', '- [project] 沒有日期的事實'].join('\n'))
  expect(text).not.toContain('細節只在正本')
  expect(text).not.toContain('很久沒證實的位置')
  expect(text).not.toMatch(/根據|使用者原話/)
})

test('記憶確認：confirm_memory 加一筆根據，封存的因此恢復帶入；整理提示標出封存', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  w.files.set(NOTES, TIERED_NOTES)
  ctl.distillReply = actionsReply({ op: 'confirm_memory', id: 'M3', evidence: '這次又查了一次位置' })
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
  ctl.distillReply = actionsReply({ op: 'add_memory', type: 'project', title: '有日期的根據', evidence: '1970-01-01｜PR #1 實測' })
  await distillNow($)
  expect(w.files.get(NOTES) ?? '').toContain('  - 根據：1970-01-01 S1｜PR #1 實測')
})
