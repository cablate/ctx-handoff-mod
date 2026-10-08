#!/usr/bin/env node
// 雙語文件：檢查英文正本與繁中版（X.md ↔ X.zh-TW.md）有沒有對上，並從兩份 CHANGELOG 產生 GitHub Release 的內文。
// 用法：
//   node tools/docs.mjs check [資料夾]       找出所有有 .zh-TW.md 對應檔的 Markdown，比對結構；不一致就列出並以 1 結束
//   node tools/docs.mjs release <版本> [資料夾] 印出該版的 Release 內文（英文在前、繁中在後、附比較連結）
// 不需要安裝套件，可以整個檔案複製到別的專案用。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ZH = '.zh-TW.md'
// Keep a Changelog 的分類與繁中名稱；繁中 CHANGELOG 用右邊的名稱
const CATEGORIES = { Added: '新增', Changed: '變更', Deprecated: '棄用', Removed: '移除', Fixed: '修正', Security: '安全性' }
const UNRELEASED = { en: 'Unreleased', zh: '未發布' }

// ---------- 解析 ----------

// 把一份 Markdown 拆成段落（每個標題一段，第一個標題前也算一段），記下比對要用的數量
export function skeleton(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const sections = [{ level: 0, title: '', bullets: 0, rows: 0, images: 0, code: 0 }]
  const links = new Set()
  const spans = new Set()
  let fence = false
  for (const line of lines) {
    const cur = sections[sections.length - 1]
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fence) cur.code += 1
      fence = !fence
      continue
    }
    if (fence) continue
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      sections.push({ level: h[1].length, title: h[2].trim(), bullets: 0, rows: 0, images: 0, code: 0 })
      continue
    }
    if (/^(- |\* |\d+\. )/.test(line)) cur.bullets += 1
    if (/^\|/.test(line) && !/^\|[\s:|-]+\|\s*$/.test(line)) cur.rows += 1
    cur.images += (line.match(/<img\s|!\[/g) ?? []).length
    for (const m of line.matchAll(/\]\(([^)\s]+)\)|(?:href|src)="([^"]+)"/g)) {
      const target = m[1] ?? m[2]
      if (target && !target.startsWith('#')) links.add(target)
    }
    // 連結定義（[0.5.0]: https://…）
    const def = /^\[[^\]]+\]:\s*(\S+)/.exec(line)
    if (def?.[1]) links.add(def[1])
    // 佔位文字（<project path>／<專案路徑>）本來就要翻譯，比對時視為同一個
    for (const m of line.matchAll(/`([^`]+)`/g)) if (m[1]) spans.add(sameTarget(m[1].replace(/<[^<>]+>/g, '<…>')))
  }
  return { sections, links, spans }
}

// CHANGELOG 標題的比對鍵：版本號、未發布、分類（英繁對應到同一個鍵）
function changelogKey(title) {
  const v = /\[?(\d+\.\d+\.\d+[^\]\s]*)\]?/.exec(title)
  if (v) return `v${v[1]}`
  if (title.includes(UNRELEASED.en) || title.includes(UNRELEASED.zh)) return 'unreleased'
  for (const [en, zh] of Object.entries(CATEGORIES)) if (title === en || title === zh) return en
  return title
}

// 互相連到對方語言的檔案不算差異：X.zh-TW.md 與 X.md 視為同一個目標
// 錨點（#settings／#設定）跟著標題翻譯，只比到檔案為止
const sameTarget = t => t.replace(/#.*$/, '').replace(/\.zh-TW\.md$/, '.md')

// ---------- 比對 ----------

export function compare(en, zh, { changelog = false } = {}) {
  const a = skeleton(en)
  const b = skeleton(zh)
  const problems = []
  const name = s => s.title || '(開頭)'
  if (a.sections.length !== b.sections.length) {
    problems.push(`標題數不同：英文 ${a.sections.length - 1} 個、繁中 ${b.sections.length - 1} 個`)
  }
  const n = Math.min(a.sections.length, b.sections.length)
  for (let i = 0; i < n; i++) {
    const x = a.sections[i]
    const y = b.sections[i]
    if (x.level !== y.level) {
      problems.push(`第 ${i} 個標題層級不同：「${name(x)}」(h${x.level}) ↔ 「${name(y)}」(h${y.level})`)
      break
    }
    // 檔名標題（h1）本來就要翻譯，只比版本與分類
    if (changelog && x.level >= 2 && changelogKey(x.title) !== changelogKey(y.title)) {
      problems.push(`CHANGELOG 標題對不上：「${name(x)}」↔「${name(y)}」`)
      break
    }
    for (const [k, label] of [['bullets', '清單項目'], ['rows', '表格列'], ['images', '圖片'], ['code', '程式碼區塊']]) {
      if (x[k] !== y[k]) problems.push(`「${name(x)}」↔「${name(y)}」的${label}數不同：${x[k]} ↔ ${y[k]}`)
    }
  }
  const la = new Set([...a.links].map(sameTarget))
  const lb = new Set([...b.links].map(sameTarget))
  for (const l of la) if (!lb.has(l)) problems.push(`繁中缺少連結：${l}`)
  for (const l of lb) if (!la.has(l)) problems.push(`英文缺少連結：${l}`)
  for (const s of a.spans) if (!b.spans.has(s)) problems.push(`繁中缺少程式碼片段：\`${s}\``)
  for (const s of b.spans) if (!a.spans.has(s)) problems.push(`英文缺少程式碼片段：\`${s}\``)
  return problems
}

// 資料夾裡（含 docs/ 與 .github/）有繁中對應檔的 Markdown
export function pairs(dir) {
  const out = []
  for (const sub of ['', 'docs', '.github']) {
    const d = join(dir, sub)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      if (!f.endsWith(ZH)) continue
      const en = join(d, f.slice(0, -ZH.length) + '.md')
      out.push({ en, zh: join(d, f), exists: existsSync(en) })
    }
  }
  return out
}

// ---------- Release 內文 ----------

// 取出某一版的內文（版本標題的下一行到下一個同層標題之前），連結定義另外回傳
export function versionSection(text, version) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(l => /^## /.test(l) && changelogKey(l.slice(3)) === `v${version}`)
  if (start < 0) return undefined
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end).filter(l => !/^\[[^\]]+\]:\s*\S+/.test(l)).join('\n').trim()
  const def = lines.find(l => l.startsWith(`[${version}]:`))
  const link = def ? def.slice(version.length + 3).trim() : undefined
  return { body, link }
}

export function releaseNotes(enText, zhText, version) {
  const en = versionSection(enText, version)
  const zh = versionSection(zhText, version)
  if (!en || !zh) return undefined
  // Release 內文的分類比 CHANGELOG 低一層，免得和 GitHub Release 的標題搶層級
  const demote = s => s.replace(/^### /gm, '#### ')
  return [
    demote(en.body),
    '',
    '---',
    '',
    '### 繁體中文',
    '',
    demote(zh.body),
    ...(en.link ? ['', `**Full changelog / 完整差異：** ${en.link}`] : []),
    '',
  ].join('\n')
}

// ---------- 指令 ----------

const [cmd, ...rest] = process.argv.slice(2)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (cmd === 'check') {
    const dir = resolve(rest[0] ?? '.')
    let bad = 0
    const found = pairs(dir)
    for (const p of found) {
      const rel = p.zh.slice(dir.length + 1)
      if (!p.exists) { console.log(`✗ ${rel}：沒有英文正本`); bad += 1; continue }
      const problems = compare(readFileSync(p.en, 'utf8'), readFileSync(p.zh, 'utf8'), { changelog: /CHANGELOG/i.test(p.en) })
      if (problems.length) {
        bad += 1
        console.log(`✗ ${rel}`)
        for (const x of problems) console.log(`  ${x}`)
      } else console.log(`✓ ${rel}`)
    }
    for (const f of ['README.md', 'CHANGELOG.md']) {
      if (existsSync(join(dir, f)) && !existsSync(join(dir, f.replace(/\.md$/, ZH)))) { console.log(`✗ ${f}：沒有繁中版`); bad += 1 }
    }
    console.log(bad ? `${bad} 份不一致` : `${found.length} 組雙語文件一致`)
    process.exit(bad ? 1 : 0)
  } else if (cmd === 'release' && rest[0]) {
    const dir = resolve(rest[1] ?? '.')
    const out = releaseNotes(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), readFileSync(join(dir, `CHANGELOG${ZH}`), 'utf8'), rest[0])
    if (!out) { console.error(`兩份 CHANGELOG 都要有 ${rest[0]} 這一版`); process.exit(1) }
    process.stdout.write(out)
  } else {
    console.error('用法：node tools/docs.mjs check [資料夾] | release <版本> [資料夾]')
    process.exit(2)
  }
}
