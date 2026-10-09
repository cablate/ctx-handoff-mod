// 守門：deny／remind 規則、草稿與核准、tool.call 攔截
import { expect, test } from 'claude-code/testing'
import { cmd, NOTES_PATH, pushGuard, actionsReply, ctl, world } from './test-world'

// ---------- 守門 ----------

test('守門：啟用的 deny 擋下違規、放行符合 unless 的寫法，並記觸發次數', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('on')] })
  const blocked = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  expect(blocked.deny).toContain('守門 #1')
  expect(blocked.deny).toContain('/handoff guard off 1')
  const ok = await $.tool.call({ tool: 'Bash', command: 'node cli.mjs preflight && git push' })
  expect(ok.deny).toBeUndefined()
  const other = await $.tool.call({ tool: 'Read', file_path: 'git push.md' })
  expect(other.deny).toBeUndefined()
  expect((w.get('stats:C--proj') as { counts: Record<string, number> }).counts['guard.hit.1']).toBe(1)
})

test('守門：草稿與停用的不生效', async ($, on) => {
  world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed'), { ...pushGuard('off'), id: 2 }] })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(r.deny).toBeUndefined()
})

test('守門：remind 照常執行，結果後面附提醒', async ($, on) => {
  world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('on', 'remind')] })
  const r = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(r.deny).toBeUndefined()
  expect(r.context?.[0]).toContain('先跑 preflight 再推')
})

// 2026-10-09 維護者決定：寫成文字還擋不住的才升級成守門
test('守門：suggest 只送寫進 repo 後又被糾正、或不放進 repo 卻講了 3 次以上的規則，驗證草稿並試比對這段對話', async ($, on) => {
  const w = world(on, 1000)
  w.files.set(NOTES_PATH, [
    '# ctx-handoff 專案經驗', '', '## 記憶', '', '## 規則', '',
    '### 推送前先跑 preflight（4 次）', '- 規則：git push 前先跑 preflight', '- 專案：已在 CLAUDE.md（第 3 次時）', '',
    '### 放進去後沒再犯（3 次）', '- 規則：不該送給模型', '- 專案：已在 CLAUDE.md（第 3 次時）', '',
    '### 還沒處理放進 repo（5 次）', '- 規則：先走放進 repo', '',
    '### 不放進 repo 的（3 次）', '- 規則：也該送', '- 專案：不放',
  ].join('\n'))
  w.rows.push({ role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'git push' } }, { tool: 'Bash', input: { command: 'ls' } }] })
  ctl.distillReply = actionsReply(
    { rule: '推送前先跑 preflight', tool: 'Bash', match: 'git\\s+push', unless: 'preflight', mode: 'deny', message: '先跑 preflight', bad: 'git push origin main', good: 'node cli.mjs preflight && git push' },
    { rule: '推送前先跑 preflight', tool: 'Bash', match: 'push', mode: 'remind', message: '沒有範例' },
    { rule: '不存在的規則', tool: 'Bash', match: 'x', mode: 'deny', message: 'x', bad: 'x', good: 'y' },
    { rule: '推送前先跑 preflight', tool: 'Bash', match: '(', mode: 'deny', message: '壞 regex', bad: '(', good: 'y' },
    // 什麼都擋的樣式：正確範例也被擋
    { rule: '推送前先跑 preflight', tool: 'Bash', match: '[\\s\\S]', mode: 'remind', message: '太寬', bad: 'git push', good: 'node cli.mjs preflight && git push' },
    // $ 沒跳脫：$$ 變成字串結尾，擋不到違規範例
    { rule: '推送前先跑 preflight', tool: 'Bash', match: 'do\\s+$$', mode: 'remind', message: '沒跳脫', bad: 'do $$ delete from x $$', good: 'ls' },
  )
  const r = await cmd($, 'guard suggest')
  expect(w.completes[0]?.system).toContain('### 推送前先跑 preflight')
  expect(w.completes[0]?.system).toContain('### 不放進 repo 的')
  expect(w.completes[0]?.system).not.toContain('放進去後沒再犯')
  expect(w.completes[0]?.system).not.toContain('還沒處理放進 repo')
  const guards = w.get('guards:C--proj') as { id: number; state: string; replay: { hits: number; calls: number } }[]
  expect(guards.length).toBe(1)
  expect(guards[0]).toMatchObject({ id: 1, state: 'proposed', replay: { hits: 1, calls: 2 } })
  expect(r.text).toContain('丟棄 5 行')
  expect(r.text).toContain('缺 bad／good 範例')
  expect(r.text).toContain('正確範例也會被擋')
  expect(r.text).toContain('違規範例沒有被擋')
  expect(r.text).toContain('2 次工具呼叫中會命中 1 次')
  expect(r.text).toContain('範例：擋「git push origin main」，放行「node cli.mjs preflight && git push」')
  // 已有守門（任何狀態）的規則不再提
  const again = await cmd($, 'guard suggest')
  expect(w.completes.length).toBe(2)
  expect(w.completes[1]?.system).not.toContain('### 推送前先跑 preflight')
})

test('守門：/handoff guard on|mode|drop 改狀態', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('proposed')] })
  await cmd($, 'guard on 1')
  expect((w.get('guards:C--proj') as { state: string }[])[0]?.state).toBe('on')
  await cmd($, 'guard mode 1 remind')
  expect((w.get('guards:C--proj') as { mode: string }[])[0]?.mode).toBe('remind')
  const missing = await cmd($, 'guard on 9')
  expect(missing.text).toContain('沒有守門 #9')
  await cmd($, 'guard drop 1')
  expect(w.get('guards:C--proj')).toEqual([])
})

// 2026-10-09 實測：$.store 同一個鍵的讀改寫會互蓋。命中若改守門資料，會蓋掉另一個 session 剛在面板按的核准
test('守門：命中只記在統計、不改守門資料；列表照樣顯示觸發次數', async ($, on) => {
  const w = world(on, 1000, 1_000_000, { 'guards:C--proj': [pushGuard('on')] })
  const before = JSON.stringify(w.get('guards:C--proj'))
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  await $.tool.call({ tool: 'Bash', command: 'git push origin dev' })
  expect(JSON.stringify(w.get('guards:C--proj'))).toBe(before)
  expect((await cmd($, 'guard')).text).toContain('已觸發 2 次')
})
