#!/usr/bin/env node
// 唯讀查看 ctx-handoff 的實際狀況：各專案經驗檔大小與帶入量、最近一次整理與失敗、
// 每個執行中 session 載入的是哪一版（最後一次熱重載）與最後幾則 ctx-handoff 訊息。
// 用法：node tools/status.mjs [--logs N]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { claudeDir, notesFiles, parseNotes, injectedChars, readJson, local } from './lib.mjs'

const logsArg = process.argv.indexOf('--logs')
const LOGS = logsArg === -1 ? 2 : Number(process.argv[logsArg + 1] ?? 2)
const C = claudeDir()

console.log('## 經驗檔（帶入量以 1.6 字／token 估算）')
for (const { dir, file } of notesFiles()) {
  const n = parseNotes(readFileSync(file, 'utf8'))
  const chars = injectedChars(n)
  console.log(`${dir}\t記憶 ${n.memory.length}\t規則 ${n.rules.length}\t${(statSync(file).size / 1024).toFixed(1)} KB\t帶入約 ${Math.round(chars / 1.6)} token`)
}

const storeDir = `${C}/plugins/store`
const storeFile = existsSync(storeDir) && readdirSync(storeDir).find(f => f.startsWith('ctx-handoff_'))
if (storeFile) {
  const raw = readJson(`${storeDir}/${storeFile}`)
  const s = raw.data ?? raw
  console.log('\n## 最近一次整理與失敗（store）')
  for (const k of Object.keys(s).filter(k => /^distill:(last|error):/.test(k)).sort()) {
    const v = s[k]
    const detail = k.startsWith('distill:last') ? `${v.changes?.length ?? 0} 項變動${v.rejected?.count ? `、丟棄 ${v.rejected.count} 行` : ''}｜${v.usage ?? ''}` : v.reason
    console.log(`${k}\t${local(v.at)}\t${v.why}\t${detail}`)
  }
  const away = Object.keys(s).filter(k => k.startsWith('away:'))
  const handoffs = Object.keys(s).filter(k => k.startsWith('handoffs:')).map(k => `${k.slice(9)} ${s[k].length}`)
  console.log(`離席 handoff：${away.length}｜handoff 紀錄：${handoffs.join('、') || '無'}`)

  // 累計統計（docs/north-star.md 的量測用）：次數、最近的失敗與守門命中
  console.log('\n## 累計統計（store 的 stats:）')
  const stats = Object.keys(s).filter(k => k.startsWith('stats:')).sort()
  if (stats.length === 0) console.log('還沒有統計')
  for (const k of stats) {
    const v = s[k]
    const counts = Object.entries(v.counts ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([n, c]) => `${n} ${c}`)
    console.log(`${k.slice(6)}（${local(v.since)} 起）：${counts.join('、') || '無'}`)
    for (const f of (v.failures ?? []).slice(-3)) console.log(`  失敗 ${local(f.at)} ${f.what}：${f.detail.slice(0, 120)}`)
    for (const h of (v.hits ?? []).slice(-3)) console.log(`  守門 ${local(h.at)} ${h.detail.slice(0, 120)}`)
  }
}

// session 檔 → 對話檔：找最後一次熱重載與最後幾則 ctx-handoff 訊息
const sessDir = `${C}/sessions`
const projects = `${C}/projects`
const transcriptOf = sid => {
  for (const d of readdirSync(projects)) {
    const f = `${projects}/${d}/${sid}.jsonl`
    if (existsSync(f)) return f
  }
}
console.log('\n## 執行中的 session')
for (const f of existsSync(sessDir) ? readdirSync(sessDir).filter(f => f.endsWith('.json')) : []) {
  let info
  try { info = readJson(`${sessDir}/${f}`) } catch { continue }
  const t = transcriptOf(info.sessionId)
  const msgs = []
  let reload
  if (t) {
    for (const line of readFileSync(t, 'utf8').split('\n')) {
      if (!line.includes('"ctx-handoff')) continue
      let o
      try { o = JSON.parse(line) } catch { continue }
      if (o.type !== 'system' || typeof o.content !== 'string' || !o.content.startsWith('ctx-handoff')) continue
      const at = local(Date.parse(o.timestamp))
      if (o.content.startsWith('ctx-handoff: reloaded')) reload = at
      else msgs.push(`${at} ${o.content.slice(0, 140)}`)
    }
  }
  console.log(`pid ${info.pid}\t${info.sessionId.slice(0, 8)}\t${info.cwd}\t最後熱重載 ${reload ?? '（無紀錄）'}`)
  for (const m of msgs.slice(-LOGS)) console.log(`　${m}`)
}
