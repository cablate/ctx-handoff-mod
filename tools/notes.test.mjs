// node --test tools/：notes.mjs 的固定測試（暫存的 CLAUDE_CONFIG_DIR，不碰真的經驗檔）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const tool = join(import.meta.dirname, 'notes.mjs')
const A = ['# ctx-handoff 專案經驗', '', '> 說明', '', '## 記憶', '- [user] 甲 一', '  延續行', '- [project] 乙 二', '', '## 規則', '', '### 規則一（2 次）', '- 規則：做 X', '- 根據：某天', ''].join('\r\n')
const B = ['# ctx-handoff 專案經驗', '', '## 記憶', '- [user] 丙', '', '## 規則', '', '### 規則一（3 次）', '- 規則：做 X', ''].join('\n')

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'notes-test-'))
  for (const [p, t] of [['A', A], ['B', B]]) {
    mkdirSync(join(root, 'projects', p, 'memory'), { recursive: true })
    writeFileSync(join(root, 'projects', p, 'memory', 'ctx-handoff.md'), t)
  }
  const run = (ops, write) => {
    const f = join(root, 'ops.json')
    writeFileSync(f, JSON.stringify(ops))
    return spawnSync(process.execPath, [tool, 'apply', f, ...(write ? ['--write'] : [])], { env: { ...process.env, CLAUDE_CONFIG_DIR: root }, encoding: 'utf8' })
  }
  const read = p => readFileSync(join(root, 'projects', p, 'memory', 'ctx-handoff.md'), 'utf8')
  return { root, run, read }
}

test('沒有變動的套用：內容與行尾原樣保留', () => {
  const { run, read } = setup()
  const r = run([{ file: 'A', mem: '甲', op: 'append', text: '補充' }, { file: 'A', mem: '甲', op: 'cut', cut: '。補充' }], true)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read('A'), A)
})

test('預演不寫；--write 寫入並備份；搬移的同名規則次數相加', () => {
  const { root, run, read } = setup()
  const ops = [{ file: 'A', mem: '乙', op: 'moveTo', to: 'B' }, { file: 'A', rule: '規則一', op: 'moveTo', to: 'B' }]
  assert.equal(run(ops, false).status, 0)
  assert.equal(read('A'), A)
  const r = run(ops, true)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!read('A').includes('乙 二') && !read('A').includes('### 規則一'))
  assert.ok(read('B').includes('- [project] 乙 二') && read('B').includes('### 規則一（5 次）'))
  assert.ok(read('A').includes('- [user] 甲 一\r\n  延續行'))
  assert.equal(readdirSync(join(root, 'projects', 'A', 'memory', '.ctx-handoff-backup')).length, 1)
})

test('比對到 0 條或多條：整批不寫', () => {
  const { root, run, read } = setup()
  // B 的那項有效，A 的那項比對到 2 條：兩份都不能寫
  const r = run([{ file: 'B', mem: '丙', op: 'delete' }, { file: 'A', mem: '[', op: 'delete' }], true)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /比對到 2 條/)
  assert.equal(read('A'), A)
  assert.equal(read('B'), B)
  assert.ok(!existsSync(join(root, 'projects', 'A', 'memory', '.ctx-handoff-backup')))
})

// 流程（## 流程）：解析、原樣輸出、刪除，和 hooks/notes.ts 同規則
const P = ['# ctx-handoff 專案經驗', '', '## 記憶', '- [user] 丁', '', '## 規則', '', '### 規則一（1 次）', '- 規則：做 X', '', '## 流程', '', '### 發版（3 次）', '- 時機：要發新版本時', '- 步驟：', '  1. 改版本號', '  2. 打 tag', '- 根據：某天', '', '### 備份（1 次）', '- 時機：每週', '', '## 自訂', '原樣保留', ''].join('\n')

test('流程：沒有變動的套用原樣輸出；list 列出流程；刪除流程只動那一條', () => {
  const { root, run, read } = setup()
  mkdirSync(join(root, 'projects', 'P', 'memory'), { recursive: true })
  writeFileSync(join(root, 'projects', 'P', 'memory', 'ctx-handoff.md'), P)
  const env = { ...process.env, CLAUDE_CONFIG_DIR: root }
  const listed = spawnSync(process.execPath, [tool, 'list', 'P'], { env, encoding: 'utf8' })
  assert.match(listed.stdout, /P1 發版（3 次）/)
  assert.match(listed.stdout, /P2 備份（1 次）/)
  assert.equal(spawnSync(process.execPath, [tool, 'roundtrip'], { env, encoding: 'utf8' }).stdout.includes('DIFF P'), false)
  assert.equal(run([{ file: 'P', mem: '丁', op: 'append', text: '補' }, { file: 'P', mem: '丁', op: 'cut', cut: '。補' }], true).status, 0)
  assert.equal(read('P'), P)
  const r = run([{ file: 'P', proc: '備份', op: 'delete' }], true)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read('P'), P.replace('### 備份（1 次）\n- 時機：每週\n\n', ''))
  assert.match(r.stdout, /流程 2 → 1/)
})

// 2026-10-09：守門升級要知道規則放進 repo 時是第幾次，舊條目沒記，要補
test('規則的 project：換掉「- 專案：」那一行；沒有就加上', () => {
  const { run, read } = setup()
  const r = run([{ file: 'B', rule: '規則一', op: 'project', text: '已在 CLAUDE.md（第 3 次時）' }], true)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(read('B').includes('### 規則一（3 次）\n- 規則：做 X\n- 專案：已在 CLAUDE.md（第 3 次時）\n'))
  run([{ file: 'B', rule: '規則一', op: 'project', text: '不放' }], true)
  assert.ok(read('B').includes('- 規則：做 X\n- 專案：不放\n') && !read('B').includes('已在 CLAUDE.md'))
})
