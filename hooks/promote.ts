// 放進專案：挑出要交代 AI 的規則、流程與守門、組交代文字、處理 AI 回報的結果（純函式，不碰 $；讀寫 store 與檔案在 register.ts）
import { str } from './distill'
import type { Guard } from './guards'
import { NOTE_TAG, PROJECT_DECLINED, PROJECT_IN, procSteps, procWhen, projectOf, ruleText, setProject } from './notes'
import type { Notes } from './notes'

// 放進專案：出現這麼多次的規則、流程與啟用中的守門，在新對話開頭交代 AI 寫進 repo（AI 判斷放哪、檢查重複、不 commit；流程做成專案的 skill），
// 完成後呼叫本 plugin 的工具回報。同一條最多交代幾次、多久內不交代給別的對話、一次最多幾條
const PROMOTE_MIN_COUNT = 3
const PROMOTE_MAX_ASKS = 2
const PROMOTE_COOLDOWN_MS = 6 * 60 * 60_000
const PROMOTE_ITEMS = 3
export const PROMOTE_TOOL = 'mark_in_project'

export const PROMOTE_DESCRIPTION = 'Record where a ctx-handoff rule, procedure or guard now lives in this repo (after you wrote it into AGENTS.md, CLAUDE.md, a project skill or a project hook), or that the user declined. ctx-handoff then stops loading its own copy.'
export const PROMOTE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: '規則名稱，照抄「」裡的文字' },
          procedure: { type: 'string', description: '流程名稱，照抄「」裡的文字' },
          guard: { type: 'number', description: '守門編號' },
          where: { type: 'string', description: '放在 repo 的哪裡，例如 AGENTS.md、.claude/hooks/guard.mjs 或 .claude/skills/release/SKILL.md' },
          declined: { type: 'boolean', description: '使用者不要放進 repo' },
        },
      },
    },
  },
  required: ['items'],
}

export type PromoteAsk = { asks: number; at: number }

// 這次要交代的：交代過的隔一段時間、最多幾次，一次最多 PROMOTE_ITEMS 條
export function promoteItems(guardList: Guard[], notes: Notes, asked: Record<string, PromoteAsk>, now: number) {
  const ready = (key: string) => {
    const a = asked[key]
    return !a || (a.asks < PROMOTE_MAX_ASKS && now - a.at >= PROMOTE_COOLDOWN_MS)
  }
  const guards = guardList.filter(g => g.state === 'on' && g.project === undefined).map(g => ({
    key: `g:${g.id}`,
    line: `- 守門 #${g.id}（${g.mode === 'deny' ? '擋下' : '提醒'}）：${g.rule}｜工具 ${g.tool}｜符合 /${g.match}/${g.unless ? `，除非 /${g.unless}/` : ''}｜訊息：${g.message}`,
  }))
  const rules = notes.rules.filter(r => r.count >= PROMOTE_MIN_COUNT && projectOf(r) === undefined)
    .sort((a, b) => b.count - a.count)
    .map(r => ({ key: `r:${r.name}`, line: `- 規則「${r.name}」（${r.count} 次）：${ruleText(r)}` }))
  const procedures = notes.procedures.filter(p => p.count >= PROMOTE_MIN_COUNT && projectOf(p) === undefined)
    .sort((a, b) => b.count - a.count)
    .map(p => ({ key: `p:${p.name}`, line: `- 流程「${p.name}」（${p.count} 次）：${procWhen(p)}｜步驟：${procSteps(p).map((s, i) => `${i + 1}. ${s}`).join('；')}` }))
  return [...guards, ...rules, ...procedures].filter(c => ready(c.key)).slice(0, PROMOTE_ITEMS)
}

// 記下這次交代了哪幾條（直接改 asked）
export function markAsked(asked: Record<string, PromoteAsk>, items: { key: string }[], now: number) {
  for (const c of items) asked[c.key] = { asks: (asked[c.key]?.asks ?? 0) + 1, at: now }
}

export const promoteText = (items: { key: string; line: string }[], tool: string) => [
  `${NOTE_TAG} 下面這些做法已在過去的對話裡被證實多次，但還沒寫進這個 repo。請在這一輪回覆結束前處理：先做完使用者這次交代的事，再順手把它們放進 repo，不用先問使用者；只有使用者明說正在處理緊急問題時才延到之後的回合。`,
  ...[
    '依專案慣例選位置（AGENTS.md、CLAUDE.md，或既有的 .claude/hooks、守門腳本）。先讀現有內容：已有相同的規則就不要重複寫，只回報它在哪。',
    '守門（會擋下或提醒的工具呼叫）優先併進專案既有的 hook；寫成 hook 時實際觸發一次，確認有效。',
    ...(items.some(c => c.key.startsWith('p:'))
      ? ['流程（多個步驟的固定做法）做成專案的 skill：建立 .claude/skills/<kebab-case 名稱>/SKILL.md，frontmatter 有 name（和資料夾同名）與 description（一句話說明什麼情況下該用，讓之後的對話判斷要不要載入），內文依序寫步驟，保留指令與檔名。先找 .claude/skills 和 README、CONTRIBUTING、CLAUDE.md：已有 skill 或文件涵蓋同一個流程，就補充它並回報位置，不要另開重複的。']
      : []),
    '只改檔，不要 commit 或 push。',
    `完成後呼叫 ${tool} 回報每條放在哪（規則用 rule、流程用 procedure、守門用 guard，where 填檔案位置），並在回覆最後用一句話告訴使用者放了什麼、放在哪。`,
    `使用者說不要，就還原改動，再用 ${tool} 標記 declined。`,
  ].map((l, i) => `${i + 1}. ${l}`),
  '',
  ...items.map(c => c.line),
].join('\n')

// AI 回報放進 repo 的結果：規則寫「- 專案：」行，守門記 project 並停用個人這份（直接改 notes、guards、asked）
export function applyInProject(raw: unknown, notes: Notes, guards: Guard[], asked: Record<string, PromoteAsk>) {
  const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  const done: string[] = []
  const failed: string[] = []
  let notesChanged = false
  let guardsChanged = false
  for (const it of items) {
    const declined = it.declined === true
    const where = str(it.where)
    const label = typeof it.rule === 'string' ? `規則「${it.rule}」` : typeof it.procedure === 'string' ? `流程「${it.procedure}」` : typeof it.guard === 'number' ? `守門 #${it.guard}` : JSON.stringify(it)
    if (!declined && !where) { failed.push(`${label}：缺少 where`); continue }
    const value = declined ? PROJECT_DECLINED : `${PROJECT_IN}${where}`
    if (typeof it.rule === 'string') {
      const r = notes.rules.find(x => x.name === (it.rule as string).trim())
      if (!r) { failed.push(`${label}：經驗檔裡沒有這條`); continue }
      setProject(r, value)
      notesChanged = true
      delete asked[`r:${r.name}`]
      done.push(`${label}：${value}`)
    } else if (typeof it.procedure === 'string') {
      const p = notes.procedures.find(x => x.name === (it.procedure as string).trim())
      if (!p) { failed.push(`${label}：經驗檔裡沒有這條`); continue }
      setProject(p, value)
      notesChanged = true
      delete asked[`p:${p.name}`]
      done.push(`${label}：${value}`)
    } else if (typeof it.guard === 'number') {
      const g = guards.find(x => x.id === it.guard)
      if (!g) { failed.push(`${label}：沒有這個守門`); continue }
      g.project = value
      if (!declined) g.state = 'off'
      guardsChanged = true
      delete asked[`g:${g.id}`]
      done.push(`${label}：${value}${declined ? '' : '（ctx-handoff 自己這份已停用）'}`)
    } else {
      failed.push(`${label}：要有 rule、procedure 或 guard`)
    }
  }
  return { done, failed, notesChanged, guardsChanged }
}

// 回給 AI 的結果文字
export const promoteReport = (done: string[], failed: string[]) => [
  ...(done.length ? ['已記下：', ...done] : []),
  ...(failed.length ? ['沒有記下：', ...failed] : []),
].join('\n') || '沒有收到任何項目'
