// 防呆提醒：同樣的失敗連續兩次、說完成了卻沒驗證
import { expect, test } from 'claude-code/testing'
import { claimsDone, doneCheck, failureSignature, freshWork, isCheckCommand, noteCall, trackFailure } from './loops'
import type { Streak, Work } from './loops'
import { cmd, ctl, say, stop, world } from './test-world'

const fail = (text: string) => ({ isError: true as const, result: text, text })
const NUDGE = '連續兩次因同樣原因失敗'

// ---------- 純函式 ----------

test('失敗簽名：路徑、數字、空白不同但原因相同的錯誤視為同一個', () => {
  const a = failureSignature('Error: ENOENT  C:\\work\\a\\x.ts line 12\n  at foo (/srv/a/b.js:3:4)')
  const b = failureSignature('Error: ENOENT D:/other/y.ts line 99 at foo (/tmp/c.js:7:8)')
  expect(a).toBe(b)
  expect(failureSignature('Error: A')).not.toBe(failureSignature('Error: B'))
  expect(failureSignature('x'.repeat(500)).length).toBe(200)
  expect(failureSignature(undefined)).toBe('')
})

test('連續失敗：第 2 次相同簽名才提醒、每段只提醒一次、成功與換錯誤重新算', () => {
  const m = new Map<string, Streak>()
  const call = (isError: boolean, text?: string) => trackFailure(m, 'Bash', 'Bash', isError, text)
  expect(call(true, 'boom 1')).toBeUndefined()
  expect(call(true, 'boom 2')).toContain(NUDGE)
  expect(call(true, 'boom 3')).toBeUndefined()
  expect(call(false)).toBeUndefined()
  expect(call(true, 'boom 4')).toBeUndefined()
  expect(call(true, 'other error')).toBeUndefined()
  expect(call(true, 'other error')).toContain(NUDGE)
  // 使用者自己中斷的不算失敗
  expect(call(true, "The user doesn't want to proceed with this tool use")).toBeUndefined()
  expect(call(true, "The user doesn't want to proceed with this tool use")).toBeUndefined()
})

test('連續失敗：提醒帶工具名與簡短錯誤；不同工具分開算', () => {
  const m = new Map<string, Streak>()
  expect(trackFailure(m, 'Read', 'Read', true, 'no such file\nmore')).toBeUndefined()
  expect(trackFailure(m, 'Bash', 'Bash', true, 'no such file\nmore')).toBeUndefined()
  const n = trackFailure(m, 'Read', 'Read', true, 'no such file\nmore')
  expect(n).toStartWith('[ctx-handoff] ')
  expect(n).toContain('Read')
  expect(n).toContain('no such file')
  expect(n).not.toContain('more')
})

test('驗證指令：測試、檢查、建置算；只是看檔案的不算', () => {
  for (const c of ['npm test', 'node --test', 'pytest -q', 'go test ./...', 'cargo test', 'cd x && npx tsc -p .', 'node tools/check.mjs', 'npm run build', 'make lint'])
    expect(isCheckCommand(c)).toBe(true)
  for (const c of ['ls tests/', 'cat test.js', 'git commit -m "add tests"', 'grep -rn check src', 'echo done', 'node run.js', ''])
    expect(isCheckCommand(c)).toBe(false)
})

test('完成的說法：保守判斷，否定、提問、已說明沒驗證的不算', () => {
  for (const m of ['已經改好了，完成了。', '都好了', '修好了', 'All done.', "I've fixed it", 'It is now fixed and working.', '全部完成'])
    expect(claimsDone(m)).toBe(true)
  for (const m of ['還沒完成，我再看看', '尚未完成', '我先看過程式碼', '要我完成嗎？', 'Is it done?', '完成了，但我沒有跑測試', 'Done, though I could not run the tests', undefined, ''])
    expect(claimsDone(m)).toBe(false)
})

test('完成前驗證：改檔後沒驗證才擋、每回合一次', () => {
  const run = (setup: (w: Work) => void, msg = '完成了', active = false) => {
    const w = freshWork()
    setup(w)
    return { w, reason: doneCheck(w, msg, active) }
  }
  const edit = (w: Work) => noteCall(w, 'Edit', { file_path: 'a.ts' }, false)
  const test_ = (w: Work) => noteCall(w, 'Bash', { command: 'npm test' }, false)
  expect(run(edit).reason).toContain('[ctx-handoff]')
  // 沒改檔、改了文件、改檔失敗：不擋
  expect(run(() => {}).reason).toBeUndefined()
  expect(run(w => noteCall(w, 'Edit', { file_path: 'README.md' }, false)).reason).toBeUndefined()
  expect(run(w => noteCall(w, 'Edit', { file_path: 'a.ts' }, true)).reason).toBeUndefined()
  // 改檔後有跑（失敗也算跑過）；跑完又改才算沒驗證
  expect(run(w => { edit(w); test_(w) }).reason).toBeUndefined()
  expect(run(w => { edit(w); noteCall(w, 'Bash', { command: 'npm test' }, true) }).reason).toBeUndefined()
  expect(run(w => { edit(w); test_(w); edit(w) }).reason).toContain('[ctx-handoff]')
  // 沒說完成、別的 hook 已擋過：不擋
  expect(run(edit, '我改了 a.ts，接下來請你看看').reason).toBeUndefined()
  expect(run(edit, '完成了', true).reason).toBeUndefined()
  // 同一回合第二次不擋
  const w = freshWork()
  edit(w)
  expect(doneCheck(w, '完成了', false)).toBeDefined()
  expect(doneCheck(w, '完成了', false)).toBeUndefined()
  // 其他寫檔工具
  for (const tool of ['Write', 'NotebookEdit', 'MultiEdit']) {
    const x = freshWork()
    noteCall(x, tool, { file_path: 'a.py', notebook_path: 'a.ipynb' }, false)
    expect(doneCheck(x, 'fixed it', false)).toBeDefined()
  }
})

// ---------- A：重複失敗提醒（經由 tool.call） ----------

test('重複失敗：第 2 次同樣的失敗在結果後面附提醒，之後同一段不再提醒', async ($, on) => {
  world(on, 1000)
  ctl.toolReply = e => (e.tool === 'Bash' ? fail('Exit code 1\nmodule not found: foo') : undefined)
  const r1 = await $.tool.call({ tool: 'Bash', command: 'node a.js' })
  expect(r1.context).toBeUndefined()
  const r2 = await $.tool.call({ tool: 'Bash', command: 'node a.js' })
  expect(r2.isError).toBe(true)
  expect(r2.context?.[0]).toStartWith('[ctx-handoff] ')
  expect(r2.context?.[0]).toContain(NUDGE)
  expect(r2.context?.[0]).toContain('Bash')
  const r3 = await $.tool.call({ tool: 'Bash', command: 'node a.js' })
  expect(r3.context).toBeUndefined()
})

test('重複失敗：錯誤不同、中間成功過、別的工具成功都不算連續同樣的失敗', async ($, on) => {
  world(on, 1000)
  let reply: ReturnType<NonNullable<typeof ctl.toolReply>>
  ctl.toolReply = () => reply
  const call = async (tool: string, r: typeof reply) => { reply = r; return (await $.tool.call({ tool: tool as 'Bash', command: 'x' })).context }
  expect(await call('Bash', fail('error A'))).toBeUndefined()
  expect(await call('Bash', fail('error B'))).toBeUndefined()
  // 成功清掉紀錄，之後同樣的錯誤重新算
  expect(await call('Bash', undefined)).toBeUndefined()
  expect(await call('Bash', fail('error B'))).toBeUndefined()
  // 別的工具的成功不影響這個工具的連續失敗
  expect(await call('Read', undefined)).toBeUndefined()
  expect((await call('Bash', fail('error B')))?.[0]).toContain(NUDGE)
})

test('重複失敗：和守門提醒並存，守門的 deny 不受影響', async ($, on) => {
  world(on, 1000, 1_000_000, { 'guards:C--proj': [
    { id: 1, rule: '別碰 foo', tool: 'Bash', match: 'foo', message: '不要', mode: 'remind', state: 'on', hits: 0, at: 0 },
    { id: 2, rule: '禁止 rm', tool: 'Bash', match: 'rm -rf', message: '不可', mode: 'deny', state: 'on', hits: 0, at: 0 },
  ] })
  ctl.toolReply = () => fail('same failure')
  await $.tool.call({ tool: 'Bash', command: 'foo' })
  const r = await $.tool.call({ tool: 'Bash', command: 'foo' })
  expect(r.context?.length).toBe(2)
  expect(r.context?.[0]).toContain('守門 #1')
  expect(r.context?.[1]).toContain(NUDGE)
  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf x' })).deny).toContain('守門 #2')
})

test('重複失敗：retry_nudge 關閉時不提醒', async ($, on) => {
  world(on, 1000)
  ctl.panelSettings.retry_nudge = false
  ctl.toolReply = () => fail('same failure')
  await $.tool.call({ tool: 'Bash', command: 'x' })
  const r = await $.tool.call({ tool: 'Bash', command: 'x' })
  expect(r.isError).toBe(true)
  expect(r.context).toBeUndefined()
})

test('重複失敗：設定走 pluginConfigs 也能關閉', async ($, on) => {
  world(on, 1000)
  ctl.pluginOptions = { retry_nudge: false }
  ctl.toolReply = () => fail('same failure')
  await $.tool.call({ tool: 'Bash', command: 'x' })
  expect((await $.tool.call({ tool: 'Bash', command: 'x' })).context).toBeUndefined()
})

// ---------- B：說完成了卻沒驗證（經由 classic.Stop） ----------

const claim = { last_assistant_message: '已經改好了，完成了。' }

test('完成前驗證：改了檔案、沒跑任何檢查就說完成，擋下停止並說明原因', async ($, on) => {
  const w = world(on, 1000)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  const out = await stop($, claim)
  expect(out.block).toStartWith('[ctx-handoff] ')
  expect(out.block).toContain('沒有跑任何測試或檢查')
  expect(w.logs.some(l => l.includes('先驗證'))).toBe(true)
  // 同一回合再停一次不擋
  expect((await stop($, claim)).block).toBeUndefined()
})

test('完成前驗證：擋下時不做門檻交接（回合還沒結束）', async ($, on) => {
  const w = world(on, 650_000)
  await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: 'x' })
  expect((await stop($, claim)).block).toBeDefined()
  await w.clock.advance(0)
  expect(w.forks.length).toBe(0)
  // 模型驗證後再停：回合真的結束，照常交接
  expect((await stop($, { ...claim, stop_hook_active: true })).block).toBeUndefined()
  await w.clock.advance(0)
  expect(w.forks.length).toBeGreaterThan(0)
})

test('完成前驗證：改檔之後跑過測試、沒改檔、沒說完成、只改文件都不擋', async ($, on) => {
  world(on, 1000)
  expect((await stop($, claim)).block).toBeUndefined()
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  expect((await stop($, { last_assistant_message: '我改了 a.ts，請看看' })).block).toBeUndefined()
  // 上面那次停止結束了這一回合：紀錄清掉，下一回合重算
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect((await stop($, claim)).block).toBeUndefined()
  await $.tool.call({ tool: 'Edit', file_path: 'README.md', old_string: 'a', new_string: 'b' })
  expect((await stop($, claim)).block).toBeUndefined()
})

test('完成前驗證：改檔失敗不算改檔、跑失敗的測試也算跑過', async ($, on) => {
  world(on, 1000)
  ctl.toolReply = e => (e.tool === 'Edit' || e.command === 'npm test' ? fail('boom') : undefined)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  expect((await stop($, claim)).block).toBeUndefined()
  ctl.toolReply = e => (e.command === 'npm test' ? fail('1 failed') : undefined)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect((await stop($, claim)).block).toBeUndefined()
})

test('完成前驗證：使用者的新訊息、被中斷的回合都重新算這一輪', async ($, on) => {
  world(on, 1000)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await say($, '算了，換個問題')
  expect((await stop($, claim)).block).toBeUndefined()
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect((await stop($, claim)).block).toBeUndefined()
})

test('完成前驗證：別的 Stop hook 已經要求繼續時不插手；子代理的停止不看', async ($, on) => {
  world(on, 1000)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  ctl.stopBlock = '別的 hook 的理由'
  expect((await stop($, claim)).block).toBe('別的 hook 的理由')
  ctl.stopBlock = undefined
  expect((await stop($, { ...claim, agent_id: 'sub1' })).block).toBeUndefined()
  expect((await stop($, claim)).block).toContain('[ctx-handoff]')
})

// 2026-10-08 實機誤判：背景子代理改檔被算進主對話的這一輪，主對話改檔後明明跑過檢查，仍被要求先驗證
test('完成前驗證：子代理（含背景子代理）的改檔與檢查不算主對話的這一輪', async ($, on) => {
  world(on, 1000)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'node tools/check.mjs .' })
  await $.tool.call({ tool: 'Edit', file_path: 'b.ts', old_string: 'a', new_string: 'b', agentId: 'bg1' } as never)
  expect((await stop($, claim)).block).toBeUndefined()
  // 子代理跑的檢查也不能替主對話的改檔作證
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'bg1' } as never)
  expect((await stop($, claim)).block).toContain('[ctx-handoff]')
})

test('完成前驗證：done_check 關閉時不擋', async ($, on) => {
  world(on, 1000)
  ctl.panelSettings.done_check = false
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
  expect((await stop($, claim)).block).toBeUndefined()
})

test('防呆提醒：/handoff 狀態顯示兩個開關', async ($, on) => {
  world(on, 1000)
  ctl.panelSettings.done_check = false
  expect((await cmd($, '')).text).toContain('防呆提醒：重複失敗 on，完成前驗證 off')
})
