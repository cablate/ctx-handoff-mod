// 介面語言（繁體中文與英文）與使用者設定（/config、pluginConfigs）
import { expect, test } from 'claude-code/testing'
import { pickLang } from './i18n'
import { cmd, resume, say, startSession, endTurn, stop, NOTES, distillNow, pushGuard, openPanel, PANEL_NOTES, ctl, world } from './test-world'

// ---------- 介面語言：繁體中文與英文 ----------
const EN = 'English'
const HAS_CJK = /[\u3400-\u9fff\uff00-\uffef]/

test('英文：狀態列、紀錄與 toast 沒有 [ctx-handoff] 前綴', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5, EN)
  await endTurn($)
  expect(w.statuses.at(-1)).toBe('25 more messages until notes update')
  await distillNow($)
  expect(w.statuses).toContain('Updating notes…')
  expect(w.statuses.at(-1)).toBe('30 more messages until notes update')
  const toast = w.toasts.find(t => t.includes('Notes updated'))
  expect(toast).toContain('Notes updated: 2 changes, sent along with your next message')
  expect(toast).toContain(NOTES)
  await cmd($, 'distill off')
  expect(w.statuses.at(-1)).toBeUndefined()
  expect([...w.statuses, ...w.toasts, ...w.logs].filter(x => x?.includes('[ctx-handoff]'))).toEqual([])
})

test('英文：對話還短時的狀態列', async ($, on) => {
  const w = world(on, 10_000, 1_000_000, {}, [], 30, EN)
  await endTurn($)
  expect(w.statuses.at(-1)).toBe('Conversation is short, notes not updated yet')
})

test('英文：/handoff 狀態與用法回覆不加 [ctx-handoff]（引擎會加 ctx-handoff:），內文沒有中文', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 5, EN)
  const s = await cmd($, '')
  expect(s.text).toStartWith('context 650000 / threshold 600000 (window 1000000)')
  expect(s.text).toContain('Cache refresh on')
  expect(s.text).toContain('/handoff now')
  expect(s.text).toContain('Guards: 0 on, 0 draft, 0 off')
  expect(s.text).not.toMatch(HAS_CJK)
  const u = await cmd($, 'nwo')
  expect(u.text).toContain('Unknown subcommand "nwo"')
  expect(w.forks.length).toBe(0)
})

test('英文：離席與交接的提示', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, { 'away:S1': { handoff: 'HANDOFF: test' } }, [], 0, EN)
  const r = await say($, 'hello')
  expect(r.drop).toContain('There is an away handoff')
  expect(r.drop).not.toMatch(HAS_CJK)
  await resume($)
  await w.clock.advance(0)
  expect(w.submits[0]).toContain('The previous conversation went idle')
  expect(w.submits[0]).toContain('HANDOFF: test')
})

test('英文：交接出錯時的 toast 與紀錄', async ($, on) => {
  const w = world(on, 650_000, 1_000_000, {}, [], 0, EN)
  ctl.failHandoff = true
  await stop($)
  await w.clock.advance(0)
  expect(w.toasts.some(t => t.includes('Handoff failed'))).toBe(true)
  expect(w.logs.some(l => l.includes('handoff failed: nothing-to-fork: '))).toBe(true)
})

test('英文：面板與守門清單', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed')] }, [], 0, EN)
  w.files.set(NOTES, PANEL_NOTES)
  const ui = await openPanel($)
  expect(await ui.find({ type: 'Text', text: /draft/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Approve/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Project notes and guards/ })).toBeDefined()
  expect((await cmd($, 'guard')).text).toContain('[draft · block]')
})

// 語言的判斷：language 設定優先（空白當成沒設），沒設就看系統語系；系統語系在測試裡假造不了，所以直接測 pickLang
const PICK_CASES: { name: string; setting: unknown; locale: string | undefined; want: 'zh-TW' | 'en' }[] = [
  { name: '系統語系 zh-TW', setting: undefined, locale: 'zh-TW', want: 'zh-TW' },
  { name: '系統語系 zh-Hant-TW', setting: undefined, locale: 'zh-Hant-TW', want: 'zh-TW' },
  { name: '系統語系 zh-CN', setting: undefined, locale: 'zh-CN', want: 'zh-TW' },
  { name: '系統語系 en-US', setting: undefined, locale: 'en-US', want: 'en' },
  { name: '系統語系 ja-JP', setting: undefined, locale: 'ja-JP', want: 'en' },
  { name: '讀不到系統語系', setting: undefined, locale: undefined, want: 'en' },
  { name: 'language 設定是中文、系統英文', setting: 'Traditional Chinese', locale: 'en-US', want: 'zh-TW' },
  { name: 'language 設定是繁體中文', setting: '繁體中文', locale: 'en-US', want: 'zh-TW' },
  { name: 'language 設定是日文、系統中文', setting: 'japanese', locale: 'zh-TW', want: 'en' },
  { name: 'language 設定空白：看系統語系', setting: '  ', locale: 'zh-TW', want: 'zh-TW' },
]
for (const c of PICK_CASES) {
  test(`語言判斷：${c.name} → ${c.want}`, async () => {
    expect(pickLang(c.setting, c.locale)).toBe(c.want)
  })
}

// 經由 plugin：language 設定決定狀態列的語言
for (const [language, want] of [['繁體中文', '再 25 則整理筆記'], ['English', '25 more messages until notes update']] as const) {
  test(`語言判斷經由 plugin：language=${language}`, async ($, on) => {
    const w = world(on, 100_000, 1_000_000, {}, [], 5, language)
    await endTurn($)
    expect(w.statuses.at(-1)).toBe(want)
  })
}

// ---------- 使用者設定：/config（plugin.json 的 userConfig），不用改原始碼 ----------
test('設定：/config 裡的門檻會生效', async ($, on) => {
  world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.configValues = { 'ctx-handoff.threshold': 200_000 }
  expect((await cmd($, '')).text).toContain('context 100000 / 門檻 200000')
})

test('設定：超出範圍的值拉回範圍內（門檻最低 50000）', async ($, on) => {
  world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.configValues = { 'ctx-handoff.threshold': 10 }
  expect((await cmd($, '')).text).toContain('context 100000 / 門檻 50000')
})

// 2026-10-07 實測：clone 載入（--plugin-dir、CLAUDE_CODE_PLUGIN_DIRS）或 claude -p 時，/config 清單沒有本 plugin 的列，
// 值只在 settings.json 的 pluginConfigs；只讀清單的版本在那裡完全吃不到設定
test('設定：/config 清單沒有本 plugin 的列時，讀 settings.json 的 pluginConfigs', async ($, on) => {
  world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.pluginOptions = { threshold: 200_000, idle_minutes: 30 }
  const text = (await cmd($, '')).text
  expect(text).toContain('context 100000 / 門檻 200000')
  expect(text).toContain('閒置 30 分')
})

test('設定：關閉保持快取的訊息照設定的閒置分鐘數', async ($, on) => {
  world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.pluginOptions = { idle_minutes: 20 }
  expect((await cmd($, 'refresh off')).text).toContain('快取刷新已設為 off（閒置 20 分鐘')
})

test('設定：使用者在 /config 改語言，介面文字跟著換', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await startSession($)
  await $.config.set({ key: 'ctx-handoff.language', value: 'en' } as never)
  await endTurn($)
  expect(w.statuses.at(-1)).toBe('25 more messages until notes update')
})

test('設定：/config 的閒置分鐘數決定多久後保持快取', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  ctl.configValues = { 'ctx-handoff.idle_minutes': 10 }
  await startSession($)
  await endTurn($)
  await w.clock.advance(10 * 60_000)
  expect(w.logs.some(l => l.includes('快取刷新 1/3'))).toBe(true)
})
