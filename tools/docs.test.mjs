// node --test tools/：docs.mjs（雙語文件比對、Release 內文）的固定測試
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compare, releaseNotes } from './docs.mjs'

const EN = ['# Tool', '', '[繁體中文](README.zh-TW.md)', '', '## Use', '', '- Run `tool go`', '- See [docs](docs/a.md)', '', '| A | B |', '|---|---|', '| 1 | 2 |', ''].join('\n')
const ZH = ['# 工具', '', '[English](README.md)', '', '## 用法', '', '- 執行 `tool go`', '- 看[文件](docs/a.md)', '', '| A | B |', '|---|---|', '| 1 | 2 |', ''].join('\n')

test('README：結構、連結與程式碼片段都對上就沒有問題；互連對方語言不算差異', () => {
  assert.deepEqual(compare(EN, ZH), [])
})

test('README：少一個清單項目、少一個表格列、少一個程式碼片段都會被抓到', () => {
  const zh = ZH.replace('- 看[文件](docs/a.md)\n', '').replace('| 1 | 2 |\n', '').replace('`tool go`', 'tool go')
  const problems = compare(EN, zh).join('\n')
  assert.match(problems, /清單項目數不同：2 ↔ 1/)
  assert.match(problems, /表格列數不同：2 ↔ 1/)
  assert.match(problems, /繁中缺少連結：docs\/a\.md/)
  assert.match(problems, /繁中缺少程式碼片段：`tool go`/)
})

test('README：多一個章節會被抓到；佔位文字可以翻譯', () => {
  assert.match(compare(EN, `${ZH}\n## 多的\n`).join('\n'), /標題數不同/)
  assert.deepEqual(compare('- `a/<name>/b`', '- `a/<名稱>/b`'), [])
})

const CL_EN = ['# Changelog', '', '## [Unreleased]', '', '## [1.1.0] - 2026-01-02', '', 'Faster.', '', '### Added', '', '- **X:** does x.', '', '### Fixed', '', '- y', '', '## [1.0.0] - 2026-01-01', '', 'First.', '', '[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0', ''].join('\n')
const CL_ZH = ['# 更新紀錄', '', '## [未發布]', '', '## [1.1.0] - 2026-01-02', '', '更快。', '', '### 新增', '', '- **X：** 做 x。', '', '### 修正', '', '- y', '', '## [1.0.0] - 2026-01-01', '', '第一版。', '', '[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0', ''].join('\n')

test('CHANGELOG：版本與分類用英繁對應比對', () => {
  assert.deepEqual(compare(CL_EN, CL_ZH, { changelog: true }), [])
  const swapped = CL_ZH.replace('### 修正', '### 變更')
  assert.match(compare(CL_EN, swapped, { changelog: true }).join('\n'), /標題對不上：「Fixed」↔「變更」/)
  const missing = CL_ZH.replace('- y\n', '')
  assert.match(compare(CL_EN, missing, { changelog: true }).join('\n'), /「Fixed」↔「修正」的清單項目數不同/)
})

test('Release 內文：英文在前、繁中在後，分類降一層，附比較連結；沒有這一版回 undefined', () => {
  const out = releaseNotes(CL_EN, CL_ZH, '1.1.0') ?? ''
  assert.ok(out.startsWith('Faster.'))
  assert.ok(out.indexOf('#### Added') < out.indexOf('### 繁體中文'))
  assert.ok(out.includes('#### 新增'))
  assert.ok(!out.includes('[1.1.0]:'))
  assert.ok(!out.includes('1.0.0] -'))
  assert.match(out, /完整差異：\*\* https:\/\/example\.com\/compare\/v1\.0\.0\.\.\.v1\.1\.0/)
  assert.equal(releaseNotes(CL_EN, CL_ZH, '9.9.9'), undefined)
})
