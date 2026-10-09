// 回覆語言判斷（純函式）：夾英文術語的中文不能誤判，幾乎全英文或簡體的要抓到
import { expect, test } from 'claude-code/testing'
import { PAIRS, SIMPLIFIED_ONLY, TRADITIONAL_ONLY, clearNext, countOf, freshReply, isReplyLangSetting, judge, noteStep, peekNext, proseOf, replyLangOfSetting, reminderText, resolveReplyLang, takePending } from './lang'

// 繁體中文、夾少量英文術語
const TW_MIXED = '我把 `watchCall` 改成在 turn.step 之後設定 pending flag，下一個 tool result 會帶上提醒。這樣主對話的回覆如果不是繁體中文，只會提醒一次，之後有一步符合語言才會重算。測試也補好了：mid-turn、final answer、subagent 三種情況都有覆蓋，`node tools/check.mjs` 全部通過。'
// 繁體中文、英文術語很多（實際會這樣寫）
const TW_HEAVY = '這次的 refactor 把 session.start 的 tool registration 拆成獨立的 helper，hot reload 時 engine 會 retract 沒有重新 register 的 tool，所以每次 session.start 都要 register 同一份 definition。另外 prompt cache 不受影響，因為 deferred tools 只多一筆 hint，不動 prefix。'
const CN = '我把 watchCall 改成在 turn.step 之后设置标记，下一个工具结果会带上提醒。这样如果主对话的回复不是简体中文，只会提醒一次，之后有一步符合语言才会重新计算。测试也已经补好了，三种情况都有覆盖，所有检查都通过了。'
const CN_HEAVY = '这次的 refactor 把 session.start 的 tool registration 拆成独立的 helper，hot reload 时 engine 会 retract 没有重新 register 的 tool，所以每次都要 register 同一份 definition。另外 prompt cache 不受影响，因为 deferred tools 只多一笔 hint。'
const EN = 'I updated the hook so that it sets a pending flag after each step. When the reply is not in the configured language, the reminder is attached to the next tool result, once per streak. All checks pass, and I added tests for the mid-turn and final answer cases.'
const JA = 'フックを更新して、各ステップの後に保留フラグを設定するようにしました。返信が設定した言語でない場合は、次のツール結果にリマインダーを一度だけ付けます。テストも追加して、すべてのチェックが通っています。'
const JA_HEAVY = 'この変更で session.start の tool registration を helper に分けました。hot reload のときに engine が retract する tool を、毎回同じ definition で register します。cache には影響しません。ただし deferred tools の hint が一件増えるので、prefix は変わらないことを確認してください。'
const KO = '훅을 수정해서 각 단계가 끝난 뒤에 보류 플래그를 설정하도록 했습니다. 응답이 설정한 언어가 아니면 다음 도구 결과에 알림을 한 번만 붙입니다. 테스트도 추가했고 모든 검사가 통과했습니다.'

// ---------- 字表 ----------

test('簡繁字表：一對一、互不重疊、沒有兩個字相同', () => {
  expect(SIMPLIFIED_ONLY.size).toBe(PAIRS.length)
  expect(TRADITIONAL_ONLY.size).toBe(PAIRS.length)
  for (const p of PAIRS) {
    expect([...p].length).toBe(2)
    expect(p[0]).not.toBe(p[1])
    expect(TRADITIONAL_ONLY.has(p[0])).toBe(false)
    expect(SIMPLIFIED_ONLY.has(p[1])).toBe(false)
  }
  // 兩種字形共用或繁體也在用的字不能放進去
  for (const shared of '理后台里只干云复于内周冲并听异党厂面出文件行用除修入存程') {
    expect(SIMPLIFIED_ONLY.has(shared)).toBe(false)
    expect(TRADITIONAL_ONLY.has(shared)).toBe(false)
  }
  expect(PAIRS.length).toBeGreaterThanOrEqual(150)
})

// ---------- 設定對應 ----------

test('Claude Code 的 language 設定對應到目標語言；只寫中文分不出繁簡就不提醒', () => {
  const cases: [unknown, string | undefined][] = [
    ['繁體中文', 'zh-TW'], ['Traditional Chinese', 'zh-TW'], ['zh-TW', 'zh-TW'], ['zh-Hant', 'zh-TW'], ['zh_HK', 'zh-TW'], ['台灣中文', 'zh-TW'],
    ['简体中文', 'zh-CN'], ['簡體中文', 'zh-CN'], ['Simplified Chinese', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh-Hans', 'zh-CN'],
    ['English', 'en'], ['english', 'en'], ['en', 'en'], ['en-US', 'en'],
    ['Japanese', 'ja'], ['日本語', 'ja'], ['ja', 'ja'], ['ja-JP', 'ja'],
    ['中文', undefined], ['Chinese', undefined], ['zh', undefined], ['Français', undefined], ['', undefined], ['  ', undefined], [undefined, undefined], [42, undefined],
  ]
  for (const [setting, want] of cases) expect(replyLangOfSetting(setting)).toBe(want)
})

test('設定值：auto 跟著 language、off 關閉、指定語言直接用', () => {
  expect(resolveReplyLang('auto', '繁體中文')).toBe('zh-TW')
  expect(resolveReplyLang('auto', undefined)).toBeUndefined()
  expect(resolveReplyLang('off', '繁體中文')).toBeUndefined()
  expect(resolveReplyLang('ja', '繁體中文')).toBe('ja')
  expect(isReplyLangSetting('zh-CN')).toBe(true)
  expect(isReplyLangSetting('fr')).toBe(false)
  expect(isReplyLangSetting(true)).toBe(false)
})

// ---------- 去掉不算說明的部分 ----------

test('proseOf：程式碼、網址、路徑、@提及、斜線指令、檔名都不算說明', () => {
  const text = [
    '看一下 `const veryLongIdentifier = 1` 與 https://example.com/some/page?q=1 還有 C:\\work\\a\\b.ts、hooks/loops.ts、./x/y、@someone，',
    '跑 /handoff 和 config.test.ts。',
    '```ts',
    'const english = "this is a long english sentence inside a fenced block"',
    '```',
    '> 引用的英文 quoted english text from a tool',
    '結尾',
  ].join('\n')
  const c = countOf(proseOf(text))
  expect(c.latin).toBe(0)
  expect(c.han).toBeGreaterThanOrEqual(8)
  // 沒有收尾的圍欄：後面全部略過
  expect(countOf(proseOf('說明\n```\nhello world this is code')).latin).toBe(0)
  // ~~~ 也是圍欄
  expect(countOf(proseOf('~~~\nhello world\n~~~\n')).latin).toBe(0)
})

test('英文單字只算自然單字：縮寫、駝峰、底線、夾數字的不算', () => {
  expect(countOf('API JSON CI watchCall snake_case 30ms v2 I a OK').latin).toBe(0)
  expect(countOf('The cache stays warm for an hour').latin).toBe(7)
  expect(countOf("I'll check what isn't there").latin).toBe(4)
})

// ---------- 不該觸發（繁體中文） ----------

test('zh-TW：夾英文術語的繁體中文不觸發', () => {
  expect(judge(TW_MIXED, 'zh-TW')).toBe('on')
  expect(judge(TW_HEAVY, 'zh-TW')).toBe('on')
})

test('zh-TW：專有名詞、程式碼、指令、路徑、網址、表格不觸發', () => {
  const table = ['| 檔案 | 說明 |', '|---|---|', '| `hooks/lang.ts` | 判斷語言的純函式，不碰 session 狀態 |', '| `hooks/register.ts` | 註冊 hook，並在工具結果附上提醒 |'].join('\n')
  expect(judge(`${table}\n\n以上是這次動到的檔案，其他地方都沒有改。`, 'zh-TW')).toBe('on')
  const code = '我把判斷語言的函式拆到獨立的檔案，這樣不用碰 session 狀態也能測，修好了，改動如下：\n```ts\nexport function judge(text: string, target: ReplyLang): Verdict {\n  const prose = proseOf(text)\n  return prose.length > 40 ? "on" : "short"\n}\n```\n再執行 `node tools/check.mjs`，結果全部通過，另外也補了固定測試，請你看一下 https://example.com/pull/12 這個連結，有問題再跟我說。'
  expect(judge(code, 'zh-TW')).toBe('on')
  // 只有程式碼區塊或指令清單：沒有說明可判斷
  expect(judge('```\nI updated the hook so that it sets a pending flag after each step and the reply language is checked\n```', 'zh-TW')).toBe('short')
  expect(judge('/handoff guard on 3 @user hooks/lang.ts `npm test` API JSON CI TS HTTP URL SQL CLI SDK OK', 'zh-TW')).toBe('short')
})

test('太短的不判斷：一兩句英文旁白、很短的中文', () => {
  expect(judge('Let me read the file.', 'zh-TW')).toBe('short')
  expect(judge("I'll check the tests first, then update the config and the docs.", 'zh-TW')).toBe('short')
  expect(judge('Now let me update the config and then check the docs for the new setting.', 'zh-TW')).toBe('short')
  expect(judge('好的，我來看一下。', 'en')).toBe('short')
  expect(judge('', 'zh-TW')).toBe('short')
  expect(judge('   \n', 'ja')).toBe('short')
})

test('zh-TW：偶爾混進一兩個簡體字（引用、打字）不觸發', () => {
  expect(judge(`${TW_MIXED} 使用者原話是「这样可以」。`, 'zh-TW')).toBe('on')
})

// ---------- 該觸發 ----------

test('zh-TW：幾乎全英文、簡體中文、日文會觸發', () => {
  expect(judge(EN, 'zh-TW')).toBe('off')
  expect(judge(CN, 'zh-TW')).toBe('off')
  expect(judge(CN_HEAVY, 'zh-TW')).toBe('off')
  expect(judge(JA, 'zh-TW')).toBe('off')
  expect(judge(`${EN}\n\n${EN}`, 'zh-TW')).toBe('off')
  // 英文為主、夾一點中文
  expect(judge('Done. 完成了. I updated register.ts and added tests for the new hook, and all of the checks pass now.', 'zh-TW')).toBe('off')
})

test('zh-CN：繁體中文與英文會觸發，簡體夾術語不觸發', () => {
  expect(judge(TW_MIXED, 'zh-CN')).toBe('off')
  expect(judge(TW_HEAVY, 'zh-CN')).toBe('off')
  expect(judge(EN, 'zh-CN')).toBe('off')
  expect(judge(CN, 'zh-CN')).toBe('on')
  expect(judge(CN_HEAVY, 'zh-CN')).toBe('on')
})

test('en：中文、日文、韓文為主會觸發；英文夾一點中文不觸發', () => {
  expect(judge(TW_MIXED, 'en')).toBe('off')
  expect(judge(CN, 'en')).toBe('off')
  expect(judge(JA, 'en')).toBe('off')
  expect(judge(KO, 'en')).toBe('off')
  expect(judge(EN, 'en')).toBe('on')
  expect(judge(`${EN} The Chinese UI text 「提醒」 and 「完成」 stays as is, and so do the file names in the report.`, 'en')).toBe('on')
})

test('ja：中文、韓文、英文會觸發；日文夾英文術語不觸發', () => {
  expect(judge(TW_MIXED, 'ja')).toBe('off')
  expect(judge(CN, 'ja')).toBe('off')
  expect(judge(EN, 'ja')).toBe('off')
  expect(judge(KO, 'ja')).toBe('off')
  expect(judge(JA, 'ja')).toBe('on')
  expect(judge(JA_HEAVY, 'ja')).toBe('on')
})

// ---------- 狀態 ----------

test('提醒狀態：不是目標語言才排；有工具排 pending，沒有工具排 next；每段只一次、符合後重算', () => {
  const s = freshReply()
  noteStep(s, TW_MIXED, true, 'zh-TW')
  noteStep(s, 'Let me look.', true, 'zh-TW')
  expect(s.pending).toBeUndefined()
  expect(s.next).toBeUndefined()
  noteStep(s, EN, true, 'zh-TW')
  expect(s.pending).toBe(reminderText('zh-TW'))
  expect(takePending(s)).toBe(reminderText('zh-TW'))
  expect(takePending(s)).toBeUndefined()
  // 同一段連續不符合：不再排；中間只是短句也不重算
  noteStep(s, EN, true, 'zh-TW')
  noteStep(s, 'Let me look.', true, 'zh-TW')
  noteStep(s, EN, false, 'zh-TW')
  expect(s.pending).toBeUndefined()
  expect(s.next).toBeUndefined()
  // 一步符合就重算
  noteStep(s, TW_MIXED, true, 'zh-TW')
  noteStep(s, EN, false, 'zh-TW')
  expect(s.pending).toBeUndefined()
  expect(peekNext(s)).toEqual([reminderText('zh-TW')])
  clearNext(s)
  expect(peekNext(s)).toEqual([])
})

test('提醒狀態：沒附出去的 pending 會跟著使用者的下一則訊息，兩個一樣的只帶一次', () => {
  const s = freshReply()
  noteStep(s, EN, true, 'zh-TW')
  expect(peekNext(s)).toEqual([reminderText('zh-TW')])
  s.next = reminderText('zh-TW')
  expect(peekNext(s)).toEqual([reminderText('zh-TW')])
})

test('提醒文字：用目標語言寫，帶 [ctx-handoff] 開頭並點名語言', () => {
  expect(reminderText('zh-TW')).toBe('[ctx-handoff] 你剛才那段說明不是繁體中文。之後的說明請用繁體中文（程式碼、指令、路徑與專有名詞維持原文）。使用者要你寫的其他語言內容（翻譯、英文文件等）照原本的要求寫。')
  expect(reminderText('zh-CN')).toContain('简体中文')
  expect(reminderText('en')).toContain('English')
  expect(reminderText('ja')).toContain('日本語')
  for (const l of ['zh-TW', 'zh-CN', 'en', 'ja'] as const) expect(reminderText(l)).toStartWith('[ctx-handoff] ')
})
