// node --test tools/：eval-handoff.mjs（從對話檔建交接評估題目、解析評審回覆）的固定測試
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { caseOf, parseVerdict, FUTURE_USER_MAX } from './eval-handoff.mjs'

const HANDOFF = `[ctx-handoff] 上一段對話因context 達 630080 tokens，已自動 /clear。以下是 handoff：\n\nHANDOFF: ${'x'.repeat(600)}`
const user = (text, extra = {}) => ({ type: 'user', timestamp: '2026-10-04T00:00:00Z', message: { content: text }, ...extra })
const ai = content => ({ type: 'assistant', message: { content } })

test('題目：交接那則（引擎加的前綴去掉）之後才算答案；注入、指令與 meta 列不算使用者訊息', () => {
  const c = caseOf([
    user('交接之前的話'),
    user(`The ctx-handoff plugin sent a message:\n${HANDOFF}`),
    ai([{ type: 'text', text: '我理解的現況' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.md' } }]),
    user([{ type: 'tool_result', content: '檔案內容', is_error: true }]),
    user('<command-name>/clear</command-name>'),
    user('[ctx-handoff 專案經驗] 注入'),
    user('meta', { isMeta: true }),
    user('繼續做 B'),
  ])
  assert.equal(c?.kind, 'present')
  assert.ok(c?.handoff.startsWith('[ctx-handoff]'))
  assert.equal(c?.users, 1)
  assert.equal(c?.future, ['【AI】我理解的現況', '【AI 呼叫 Read】{"file_path":"a.md"}', '【工具結果・失敗】檔案內容', '【使用者】繼續做 B'].join('\n\n'))
})

test('題目：沒有交接就不是題目；答案最多取前幾則使用者訊息', () => {
  assert.equal(caseOf([user('一般對話'), ai([{ type: 'text', text: '好' }])]), undefined)
  const many = Array.from({ length: FUTURE_USER_MAX + 5 }, (_, i) => user(`第 ${i} 則`))
  assert.equal(caseOf([user(HANDOFF), ...many])?.users, FUTURE_USER_MAX)
})

test('評審回覆：包在圍欄裡也抓得到 JSON；不是 JSON 回 undefined', () => {
  assert.deepEqual(parseVerdict('```json\n{"score": 4, "gaps": []}\n```'), { score: 4, gaps: [] })
  assert.equal(parseVerdict('沒有 JSON'), undefined)
})
