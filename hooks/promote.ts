// 放進專案：挑出要交代 AI 的規則、流程與守門、組交代文字、記下交代給哪段對話（純函式，不碰 $；讀寫 store 與檔案在 register.ts）
// AI 放好之後不用回報：背景整理從對話看出放在哪（in_project），程式確認檔案存在才記上
import type { Guard } from './guards'
import { NOTE_TAG, procSteps, procWhen, projectOf, ruleText } from './notes'
import type { Notes } from './notes'

// 出現這麼多次的規則、流程與啟用中的守門，在新對話開頭交代 AI 寫進 repo（AI 判斷放哪、檢查重複、不 commit；流程做成專案的 skill）。
// 一次最多交代幾條：每段新對話開頭的 context 有限，其餘的留給之後的對話
export const PROMOTE_MIN_COUNT = 3
const PROMOTE_ITEMS = 3

// 交代給哪段對話、什麼時候。那段對話還在進行時不交給別的對話（避免兩邊重複放）；
// 它結束（session.end），或整理看過交代之後的內容卻沒看到放好，就刪掉這筆，下一段新對話再交代
export type PromoteAsk = { sid: string; at: number }

// 還沒放進 repo（也沒被使用者拒絕）的項目：鍵、給整理看的編號、交代用的一行
export function promoteCandidates(guardList: Guard[], notes: Notes) {
  const guards = guardList.filter(g => g.state === 'on' && g.project === undefined).map(g => ({
    key: `g:${g.id}`,
    id: `G${g.id}`,
    name: g.rule,
    line: `- 守門 #${g.id}（${g.mode === 'deny' ? '擋下' : '提醒'}）：${g.rule}｜工具 ${g.tool}｜符合 /${g.match}/${g.unless ? `，除非 /${g.unless}/` : ''}｜訊息：${g.message}`,
  }))
  const rules = notes.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.count >= PROMOTE_MIN_COUNT && projectOf(r) === undefined)
    .sort((a, b) => b.r.count - a.r.count)
    .map(({ r, i }) => ({ key: `r:${r.name}`, id: `R${i + 1}`, name: r.name, line: `- 規則「${r.name}」（${r.count} 次）：${ruleText(r)}` }))
  const procedures = notes.procedures.map((p, i) => ({ p, i })).filter(({ p }) => p.count >= PROMOTE_MIN_COUNT && projectOf(p) === undefined)
    .sort((a, b) => b.p.count - a.p.count)
    .map(({ p, i }) => ({ key: `p:${p.name}`, id: `P${i + 1}`, name: p.name, line: `- 流程「${p.name}」（${p.count} 次）：${procWhen(p)}｜步驟：${procSteps(p).map((s, k) => `${k + 1}. ${s}`).join('；')}` }))
  return [...guards, ...rules, ...procedures]
}

// 這次要交代的：沒有交給別段對話的，一次最多 PROMOTE_ITEMS 條
export const promoteItems = (guardList: Guard[], notes: Notes, asked: Record<string, PromoteAsk>) =>
  promoteCandidates(guardList, notes).filter(c => asked[c.key] === undefined).slice(0, PROMOTE_ITEMS)

// 記下這次交代給哪段對話（直接改 asked）
export function markAsked(asked: Record<string, PromoteAsk>, items: { key: string }[], sid: string, now: number) {
  for (const c of items) asked[c.key] = { sid, at: now }
}

// 交給這段對話的收回來（before：只收回這個時間之前交代的）；回傳有沒有改（直接改 asked）
export function releaseAsked(asked: Record<string, PromoteAsk>, sid: string, before = Number.POSITIVE_INFINITY) {
  let changed = false
  for (const [k, a] of Object.entries(asked)) {
    if (a.sid === sid && a.at < before) { delete asked[k]; changed = true }
  }
  return changed
}

export const promoteText = (items: { key: string; line: string }[]) => [
  `${NOTE_TAG} 下面這些做法已在過去的對話裡被證實多次，但還沒寫進這個 repo。請在這一輪回覆結束前處理：先做完使用者這次交代的事，再順手把它們放進 repo，不用先問使用者；只有使用者明說正在處理緊急問題時才延到之後的回合。`,
  ...[
    '依專案慣例選位置（AGENTS.md、CLAUDE.md，或既有的 .claude/hooks、守門腳本）。先讀現有內容：已有相同的規則就不要重複寫。',
    '守門（會擋下或提醒的工具呼叫）優先併進專案既有的 hook；寫成 hook 時實際觸發一次，確認有效。',
    ...(items.some(c => c.key.startsWith('p:'))
      ? ['流程（多個步驟的固定做法）做成專案的 skill：建立 .claude/skills/<kebab-case 名稱>/SKILL.md，frontmatter 有 name（和資料夾同名）與 description（一句話說明什麼情況下該用，讓之後的對話判斷要不要載入），內文依序寫步驟，保留指令與檔名。先找 .claude/skills 和 README、CONTRIBUTING、CLAUDE.md：已有 skill 或文件涵蓋同一個流程，就補充它，不要另開重複的。']
      : []),
    '只改檔，不要 commit 或 push。',
    '完成後在回覆最後用一句話告訴使用者每條放在哪個檔案（寫出 repo 裡的路徑）；已經有的也說它在哪個檔案。不用呼叫任何工具回報，背景整理會從對話記下。',
    '使用者說不要，就還原改動，並在回覆說明使用者不要放。',
  ].map((l, i) => `${i + 1}. ${l}`),
  '',
  ...items.map(c => c.line),
].join('\n')
