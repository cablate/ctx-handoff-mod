// node --test tools/：eval-distill.mjs（對話檔轉成整理看到的片段、還原片段當時的經驗檔）的固定測試
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notesBefore, rowsOf, segmentsOf } from './eval-distill.mjs'

const user = (text, extra = {}) => ({ type: 'user', timestamp: '2026-10-05T00:00:00Z', message: { content: text }, ...extra })
const ai = content => ({ type: 'assistant', timestamp: '2026-10-05T00:00:01Z', message: { content } })

test('對話檔 → Row：工具結果依 id 接回助理的工具呼叫；meta 列與只有工具結果的列不算使用者訊息；引擎加的前綴去掉', () => {
  const rows = rowsOf([
    user('先看 a.md'),
    ai([{ type: 'text', text: '好' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.md' } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', content: '內容', is_error: true }]),
    user('meta', { isMeta: true }),
    user('The ctx-handoff plugin sent a message:\n[ctx-handoff] 交接'),
  ])
  assert.deepEqual(rows.map(r => [r.role, r.text]), [['user', '先看 a.md'], ['assistant', '好'], ['user', '[ctx-handoff] 交接']])
  assert.deepEqual(rows[1].toolUses, [{ tool: 'Read', input: { file_path: 'a.md' }, text: '內容', isError: true }])
})

test('切片段：每 size 則使用者訊息一段，錨點是前一段最後一則；不到半段的尾巴不收', () => {
  const rows = Array.from({ length: 9 }, (_, i) => [{ role: 'user', text: `u${i}` }, { role: 'assistant', text: `a${i}`, toolUses: [] }]).flat()
  const segs = segmentsOf(rows, 4)
  assert.deepEqual(segs.map(s => [s.k, s.from, s.to, s.users, s.anchorRow?.text]), [[0, 0, 8, 4, undefined], [1, 8, 16, 4, 'u3']])
})

test('還原當時的經驗檔：根據最早一筆在片段之前的才留；沒有日期的保留', () => {
  const notes = {
    memory: [
      { type: 'user', title: '舊', evidence: ['2026-10-01 aaaa｜x', '2026-10-09 bbbb｜y'] },
      { type: 'user', title: '新', evidence: ['2026-10-06 cccc｜z'] },
      { type: 'project', title: '沒日期', evidence: [] },
    ],
    rules: [{ name: '規則', count: 3, body: ['- 規則：做 X', '- 根據：2026-10-07 dddd｜w'] }],
    procedures: [],
    extra: [],
  }
  const b = notesBefore(notes, '2026-10-05')
  assert.deepEqual(b.memory.map(m => m.title), ['舊', '沒日期'])
  assert.deepEqual(b.rules, [])
})
