// 面板：輸入框上方的分頁、守門核准、刪除記憶與規則
import { expect, test } from 'claude-code/testing'
import { cmd, NOTES_PATH, pushGuard, BAND_MOUNT, openPanel, PANEL_NOTES, world } from './test-world'

// ---------- 面板 ----------

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
  // 引擎會在指令回覆前加 ctx-handoff:，回覆自己再加 [ctx-handoff] 就重複了（2026-10-07 面板截圖）
  const opened = (await cmd($, 'panel')).text
  expect(opened).toContain('面板已開')
  expect(opened).not.toContain('[ctx-handoff]')
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
