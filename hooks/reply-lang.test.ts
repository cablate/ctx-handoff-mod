// 回覆語言提醒（經由 turn.step、tool.call、prompt.submit、/handoff 狀態）
import { expect, test } from 'claude-code/testing'
import { NOTE_TAG, cmd, ctl, distillNow, say, step, world } from './test-world'

const TW = '我把這個 hook 改成在每一步之後檢查說明的語言，如果不是繁體中文，就在下一個工具結果後面附一段提醒。這樣主對話可以及早收到通知，而且每一段只會提醒一次，測試也都補好了。'
const EN = 'I changed the hook so that it checks the language of the explanation after every step. If it is not the configured language, a reminder is attached to the next tool result, once per streak, and tests are added.'
const CN = '我把这个 hook 改成在每一步之后检查说明的语言，如果不是简体中文，就在下一个工具结果后面附一段提醒。这样主对话可以及早收到通知，而且每一段只会提醒一次，测试也都补好了。'
const REMIND_TW = '你剛才那段說明不是繁體中文'
const toolCall = ($: Parameters<typeof step>[0], agentId?: string) =>
  $.tool.call({ tool: 'Bash', command: 'ls', ...(agentId ? { agentId } : {}) } as never)

test('回覆語言：步驟的回應原封不動往下傳（不改 model、effort、答案與工具）', async ($, on) => {
  world(on, 1000)
  const r = await step($, EN, { tools: 2 })
  expect(r.answer).toBe(EN)
  expect(r.toolUses.length).toBe(2)
  expect(r.stopReason).toBe('tool_use')
  expect(ctl.stepSeen?.model).toBe('m')
  expect(ctl.stepSeen?.effort).toBeUndefined()
})

test('回覆語言：這步不是繁體中文又要呼叫工具，下一個工具結果附一次提醒', async ($, on) => {
  world(on, 1000)
  await step($, EN, { tools: 1 })
  const r1 = await toolCall($)
  expect(r1.context?.[0]).toStartWith('[ctx-handoff] ')
  expect(r1.context?.[0]).toContain(REMIND_TW)
  expect(r1.context?.[0]).toContain('程式碼、指令、路徑與專有名詞維持原文')
  // 提醒只附在一個結果上
  expect((await toolCall($)).context).toBeUndefined()
  // 同一段連續不符合：不再提醒
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
})

test('回覆語言：符合目標語言的步驟不提醒；一步符合後，下一段不符合再提醒', async ($, on) => {
  world(on, 1000)
  await step($, TW, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context?.[0]).toContain(REMIND_TW)
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
  await step($, TW, { tools: 1 })
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context?.[0]).toContain(REMIND_TW)
})

test('回覆語言：英文旁白和夾英文術語的繁體中文不提醒', async ($, on) => {
  world(on, 1000)
  await step($, 'Let me read the file first.', { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
  await step($, '我先把 `watchCall` 的 context 拆開，再看 turn.step 的 result 怎麼接 tool result，確認 prompt cache 不會因為多一段 hint 而失效，然後補上對應的 fixed test。', { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
})

test('回覆語言：最終回答不是目標語言（沒有工具），提醒跟著使用者的下一則訊息，只一次', async ($, on) => {
  const w = world(on, 1000)
  await step($, EN)
  // 沒有工具結果可以附，也不會自己送訊息
  expect((await toolCall($)).context).toBeUndefined()
  expect(w.submits.length).toBe(0)
  await say($, '好，繼續')
  expect(w.contexts[0]?.[0]).toContain(REMIND_TW)
  await say($, '再一個問題')
  expect(w.contexts[1]).toBeUndefined()
})

test('回覆語言：附在訊息上的提醒和背景整理的差異並存，各是一段', async ($, on) => {
  const w = world(on, 100_000, 1_000_000, {}, [], 5)
  await say($, '請幫我整理這段對話')
  await distillNow($)
  await step($, EN)
  await say($, '下一則')
  expect(w.contexts[1]?.length).toBe(2)
  expect(w.contexts[1]?.[0]).toContain(NOTE_TAG)
  expect(w.contexts[1]?.[1]).toContain(REMIND_TW)
})

test('回覆語言：訊息被丟棄時提醒保留到真的送進對話', async ($, on) => {
  const w = world(on, 1000)
  await step($, EN)
  ctl.failSubmits = 1
  await say($, '第一則')
  expect(w.contexts.length).toBe(0)
  await say($, '第二則')
  expect(w.contexts[0]?.[0]).toContain(REMIND_TW)
})

test('回覆語言：這輪被中斷、提醒沒附出去，改跟著使用者的下一則訊息', async ($, on) => {
  const w = world(on, 1000)
  await step($, EN, { tools: 1 })
  await say($, '算了，換個問題')
  expect(w.contexts[0]?.[0]).toContain(REMIND_TW)
  expect((await toolCall($)).context).toBeUndefined()
})

test('回覆語言：子代理的步驟不看，子代理的工具結果也不帶走主對話的提醒', async ($, on) => {
  const w = world(on, 1000)
  await step($, EN, { tools: 1, agentId: 'sub1' })
  expect((await toolCall($)).context).toBeUndefined()
  await step($, EN, { agentId: 'sub1' })
  await say($, '嗨')
  expect(w.contexts[0]).toBeUndefined()
  // 主對話排的提醒不被子代理的工具結果拿走
  await step($, EN, { tools: 1 })
  expect((await toolCall($, 'sub1')).context).toBeUndefined()
  expect((await toolCall($)).context?.[0]).toContain(REMIND_TW)
})

test('回覆語言：沒有說明文字（只呼叫工具）不判斷', async ($, on) => {
  world(on, 1000)
  await step($, '', { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
})

test('回覆語言：reply_language 設 off 不提醒', async ($, on) => {
  const w = world(on, 1000)
  ctl.panelSettings.reply_language = 'off'
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
  await step($, EN)
  await say($, '嗨')
  expect(w.contexts[0]).toBeUndefined()
})

test('回覆語言：設定走 pluginConfigs 也生效；指定語言不看 language 設定，提醒用該語言寫', async ($, on) => {
  world(on, 1000)
  ctl.pluginOptions = { reply_language: 'en' }
  // 中文說明在 en 目標下不符合
  await step($, TW, { tools: 1 })
  const r = await toolCall($)
  expect(r.context?.[0]).toContain('Your last explanation was not in English')
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
})

test('回覆語言：不合法的設定值回到 auto', async ($, on) => {
  world(on, 1000)
  ctl.panelSettings.reply_language = 'klingon'
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context?.[0]).toContain(REMIND_TW)
})

test('回覆語言：auto 跟著 Claude Code 的 language 設定', async ($, on) => {
  world(on, 1000, 1_000_000, {}, [], 0, 'English')
  await step($, TW, { tools: 1 })
  expect((await toolCall($)).context?.[0]).toContain('Your last explanation was not in English')
})

test('回覆語言：auto 遇到簡體中文設定，抓出繁體中文', async ($, on) => {
  world(on, 1000, 1_000_000, {}, [], 0, '简体中文')
  await step($, CN, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
  await step($, TW, { tools: 1 })
  expect((await toolCall($)).context?.[0]).toContain('你刚才那段说明不是简体中文')
})

// 同一個 hook 在一個測試裡只能註冊一次，所以每種設定一個測試
for (const language of [null, '中文', 'Chinese', 'Français']) {
  test(`回覆語言：auto 遇到 language 是 ${JSON.stringify(language)}，不提醒`, async ($, on) => {
    world(on, 1000, 1_000_000, {}, [], 0, language)
    await step($, EN, { tools: 1 })
    expect((await toolCall($)).context).toBeUndefined()
  })
}

test('回覆語言：設定改了，下一則訊息起目標語言跟著換', async ($, on) => {
  world(on, 1000)
  await step($, TW, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
  ctl.panelSettings.reply_language = 'ja'
  await say($, '換成日文')
  await step($, TW, { tools: 1 })
  expect((await toolCall($)).context?.[0]).toContain('日本語')
  ctl.panelSettings.reply_language = 'off'
  await say($, '關掉')
  await step($, EN, { tools: 1 })
  expect((await toolCall($)).context).toBeUndefined()
})

test('回覆語言：和重複失敗提醒並存，兩段都帶上', async ($, on) => {
  world(on, 1000)
  ctl.toolReply = () => ({ isError: true as const, result: 'same failure', text: 'same failure' })
  await toolCall($)
  await step($, EN, { tools: 1 })
  const r = await toolCall($)
  expect(r.context?.length).toBe(2)
  expect(r.context?.[0]).toContain('連續兩次因同樣原因失敗')
  expect(r.context?.[1]).toContain(REMIND_TW)
})

test('回覆語言：/handoff 狀態在防呆提醒那行顯示設定與解析結果', async ($, on) => {
  world(on, 1000)
  expect((await cmd($, '')).text).toContain('防呆提醒：重複失敗 on，完成前驗證 on，回覆語言 auto → zh-TW')
  ctl.panelSettings.reply_language = 'ja'
  await say($, '換成日文')
  expect((await cmd($, '')).text).toContain('回覆語言 ja')
  ctl.panelSettings.reply_language = 'off'
  await say($, '關掉')
  expect((await cmd($, '')).text).toContain('回覆語言 off')
})

test('回覆語言：/handoff 狀態在 language 沒設時顯示 auto → off', async ($, on) => {
  world(on, 1000, 1_000_000, {}, [], 0, null)
  expect((await cmd($, '')).text).toContain('回覆語言 auto → off')
})
