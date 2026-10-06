#!/usr/bin/env node
// 以條目為單位查看或修改經驗檔（ctx-handoff.md），不整份重寫。
// 用法：
//   node tools/notes.mjs list <專案目錄名或檔案路徑>        列出編號與每條開頭
//   node tools/notes.mjs apply <ops.json> [--write]           預設只預演；--write 才寫（寫前備份）
//   node tools/notes.mjs roundtrip                           回歸檢查：每份真實經驗檔解析再輸出要逐位元相同（改解析或輸出後跑）
// ops.json 是陣列，每項指定 file（專案目錄名或路徑）與 mem 或 rule（條目裡唯一的一段文字；rule 比對標題）：
//   { "file": "C--Users-user", "mem": "某段文字", "op": "delete" }
//   { "file": "...", "mem": "...", "op": "replace", "text": "- [user] 新內容" }
//   { "file": "...", "mem": "...", "op": "cut", "cut": "要刪掉的片段" }
//   { "file": "...", "mem": "...", "op": "append", "text": "接在句尾的補充" }
//   { "file": "...", "rule": "標題片段", "op": "delete" | "oneLine", "text": "單行規則（oneLine 用）" }
//   { "file": "...", "rule": "標題片段", "op": "appendBody", "text": "- 補充：…" }
//   { "file": "...", "mem" 或 "rule": "...", "op": "moveTo", "to": "另一個專案" }
// 每項都必須恰好比對到一條；任何一項不符就整批不寫。寫入前再讀一次，期間被改過就中止。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import { claudeDir, notesFiles, parseNotes, NOTES_NAME } from './lib.mjs'

const [cmd, arg] = process.argv.slice(2)
const fileOf = f => (existsSync(f) ? f.replace(/\\/g, '/') : `${claudeDir()}/projects/${f}/memory/${NOTES_NAME}`)
const fail = m => { console.error(`停止：${m}`); process.exit(1) }

// 保留檔頭（標題與說明）與結尾的其他區段，只重排記憶與規則
function load(file) {
  if (!existsSync(file)) fail(`沒有這個檔案：${file}`)
  const text = readFileSync(file, 'utf8')
  const head = text.replace(/\r/g, '').split('\n## ')[0].replace(/\n+$/, '').split('\n')
  return { file, text, crlf: text.includes('\r\n'), head, notes: parseNotes(text) }
}
function render(d) {
  const n = d.notes
  const out = [...d.head, '', '## 記憶', ...n.memory, '', '## 規則',
    ...n.rules.flatMap(r => ['', `### ${r.name}（${r.count} 次）`, ...r.body]),
    ...(n.extra.length ? ['', ...n.extra] : []), ''].join('\n')
  return d.crlf ? out.replace(/\n/g, '\r\n') : out
}

if (cmd === 'list') {
  if (!arg) fail('用法：node tools/notes.mjs list <專案目錄名或檔案>')
  const { notes } = load(fileOf(arg))
  notes.memory.forEach((m, i) => console.log(`M${i + 1} ${m.split('\n')[0].slice(0, 110)}`))
  notes.rules.forEach((r, i) => console.log(`R${i + 1} ${r.name}（${r.count} 次）`))
} else if (cmd === 'apply') {
  if (!arg) fail('用法：node tools/notes.mjs apply <ops.json> [--write]')
  const ops = JSON.parse(readFileSync(arg, 'utf8'))
  const docs = new Map()
  const doc = f => { const p = fileOf(f); if (!docs.has(p)) docs.set(p, load(p)); return docs.get(p) }
  const pick = (list, key, find, label) => {
    const hits = list.map((x, i) => (x !== undefined && key(x).includes(find) ? i : -1)).filter(i => i >= 0)
    if (hits.length !== 1) fail(`${label}「${find}」比對到 ${hits.length} 條（要恰好 1 條）`)
    return hits[0]
  }
  for (const o of ops) {
    const d = doc(o.file)
    if (o.mem !== undefined) {
      const i = pick(d.notes.memory, m => m, o.mem, '記憶')
      const m = d.notes.memory[i]
      if (o.op === 'delete') d.notes.memory[i] = undefined
      else if (o.op === 'replace') d.notes.memory[i] = o.text
      else if (o.op === 'append') d.notes.memory[i] = `${m.replace(/[。\s]*$/, '')}。${o.text}`
      else if (o.op === 'cut') { if (m.split(o.cut).length !== 2) fail(`cut 片段不在「${o.mem}」裡或不只一處`); d.notes.memory[i] = m.replace(o.cut, '').replace(/\s+$/, '') }
      else if (o.op === 'moveTo') { const t = doc(o.to); if (!t.notes.memory.includes(m)) t.notes.memory.push(m); d.notes.memory[i] = undefined }
      else fail(`記憶不支援 op ${o.op}`)
    } else if (o.rule !== undefined) {
      const i = pick(d.notes.rules, r => r.name, o.rule, '規則')
      const r = d.notes.rules[i]
      if (o.op === 'delete') d.notes.rules[i] = undefined
      else if (o.op === 'oneLine') r.body = [`- 規則：${o.text}`]
      else if (o.op === 'appendBody') r.body.push(o.text)
      else if (o.op === 'moveTo') {
        const t = doc(o.to)
        const same = t.notes.rules.find(x => x && x.name === r.name)
        if (same) same.count += r.count; else t.notes.rules.push(r)
        d.notes.rules[i] = undefined
      } else fail(`規則不支援 op ${o.op}`)
    } else fail(`第 ${ops.indexOf(o) + 1} 項沒有 mem 或 rule`)
  }
  for (const d of docs.values()) {
    const before = parseNotes(d.text)
    d.notes.memory = d.notes.memory.filter(m => m !== undefined)
    d.notes.rules = d.notes.rules.filter(r => r !== undefined)
    console.log(`${d.file}：記憶 ${before.memory.length} → ${d.notes.memory.length}，規則 ${before.rules.length} → ${d.notes.rules.length}`)
  }
  if (!process.argv.includes('--write')) { console.log('預演完成；加 --write 才寫入'); process.exit(0) }
  for (const d of docs.values()) if (readFileSync(d.file, 'utf8') !== d.text) fail(`${d.file} 在這段期間被改過，重跑一次`)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  for (const d of docs.values()) {
    const bk = `${dirname(d.file)}/.ctx-handoff-backup`
    mkdirSync(bk, { recursive: true })
    writeFileSync(`${bk}/${stamp}-${basename(d.file)}`, d.text)
    writeFileSync(d.file, render(d))
  }
  console.log(`已寫入；原檔備份在各檔旁的 .ctx-handoff-backup/${stamp}-${NOTES_NAME}`)
} else if (cmd === 'roundtrip') {
  let bad = 0
  for (const { dir, file } of notesFiles()) {
    const d = load(file)
    const same = render(d) === d.text
    if (!same) bad += 1
    console.log(`${same ? 'SAME' : 'DIFF'} ${dir}`)
  }
  process.exit(bad ? 1 : 0)
} else fail('用法：node tools/notes.mjs list|apply|roundtrip …')
