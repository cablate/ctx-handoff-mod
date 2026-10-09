// 守門：把反覆被提醒的規則變成工具呼叫前的比對。型別、提示、模型提案的驗證與比對（純函式，不碰 $）
import { t } from './i18n'
import { ACTIONS_END, ACTIONS_START } from './distill'
import { NOTE_TAG, PROJECT_DECLINED, inProject, projectOf, promotedAtOf, ruleText } from './notes'
import type { Rule } from './notes'
import { clip } from './transcript'

// ---------- 守門：反覆被提醒的規則，改成工具呼叫前的機械檢查 ----------
// 模型只提草稿（proposed），使用者 /handoff guard on N 核准才生效；依工作區存在 $.store，不進經驗檔
export const GUARD_MIN_COUNT = 3
// 每段新對話開頭最多請 AI 問幾條草稿：開頭的 context 有限（和放進專案的 PROMOTE_ITEMS 同理），其餘留給之後的對話
export const GUARD_ASK_ITEMS = 3
const GUARD_PATTERN_MAX = 300
export const GUARD_MODES = ['deny', 'remind'] as const
// tool.call 輸入裡不屬於工具參數的鍵
const RESERVED_KEYS = new Set(['tool', 'tool_use_id', 'consent', 'agentId'])

export type GuardMode = typeof GUARD_MODES[number]
export type GuardState = 'proposed' | 'on' | 'off'
export type Guard = {
  id: number; rule: string; tool: string; match: string; unless?: string; message: string
  mode: GuardMode; state: GuardState; at: number
  // 提案時驗證過的範例：bad 會被擋、good 會放行
  bad?: string; good?: string
  // 提案時試比對這段對話已跑過的工具呼叫：命中幾次、總共幾次
  replay?: { hits: number; calls: number }
  // 放進專案：「已在 <位置>」（個人這份停用）或「不放」
  project?: string
}
// 命中次數不存在守門資料裡：每次命中都改同一筆，會和面板核准互蓋（$.store 同一個鍵的讀改寫，見 CLAUDE.md 平台事實）。
// 改記在統計 stats:<工作區> 的 guard.hit.<編號>，顯示時才併進來
export type GuardView = Guard & { hits: number }
export const guardHitKey = (id: number) => `guard.hit.${id}`
export const withHits = (guards: Guard[], counts: Record<string, number> = {}): GuardView[] =>
  guards.map(g => ({ ...g, hits: counts[guardHitKey(g.id)] ?? 0 }))

// 比對對象：工具參數裡的字串值（Bash 就是 command），其他值轉成 JSON，以換行串起來
export function inputText(input: Record<string, unknown>) {
  return Object.entries(input)
    .filter(([k, v]) => !RESERVED_KEYS.has(k) && v !== undefined)
    .map(([, v]) => (typeof v === 'string' ? v : JSON.stringify(v)))
    .join('\n')
}

const toolMatches = (pattern: string, tool: string) =>
  pattern.endsWith('*') ? tool.startsWith(pattern.slice(0, -1)) : pattern === tool

export function guardHits(g: Pick<Guard, 'tool' | 'match' | 'unless'>, tool: string, text: string) {
  if (!toolMatches(g.tool, tool)) return false
  try {
    if (!new RegExp(g.match, 'i').test(text)) return false
    return g.unless === undefined || !new RegExp(g.unless, 'i').test(text)
  } catch {
    return false
  }
}

export function guardPrompt(rules: Rule[], tools: string[]) {
  return [
    '你替一個 Claude Code 工作區設計「守門」：在 AI 呼叫工具之前，用正規表達式比對工具參數，攔下違反規則的呼叫。',
    '下面是這個工作區被反覆提醒的規則。逐條判斷：違規時，工具參數裡有沒有明確、可比對的特徵？',
    '',
    '只在這些情況提出守門：',
    '- 違規一定經過某個工具，參數有明確特徵（指令、工具名稱、SQL 關鍵字、路徑）',
    '- 有 unless 可以排除「照規則做」的正確寫法，例如改用規則指定的工具或包裝腳本',
    '不要提出：規則講的是回答裡的說法、判斷順序、寫作內容，或特徵太模糊會擋到正常工作的。',
    '',
    '比對方式：',
    '- tool：工具名稱原樣，例如 Bash、Edit、mcp__supabase__execute_sql；結尾 * 表示前綴',
    '- 比對文字：工具參數的字串值以換行串起來（Bash 就是 command 本身）；不分大小寫的 JavaScript 正規表達式',
    `- match／unless 各不超過 ${GUARD_PATTERN_MAX} 字；寧可窄、不要寬，不要寫成什麼都命中的樣式`,
    '- 特殊字元要跳脫：比對字面的 $$ 要寫 \\$\\$，. 寫 \\.；寫進 JSON 時每個反斜線再寫成 \\\\',
    '- MCP 的 SQL 工具參數含 project_id：規則只管正式站時，用它分辨正式站和測試環境',
    '- bad：一段違規的比對文字範例（要被 match 命中、不被 unless 排除）；good：一段照規則做、也用同一個工具的正確範例（不能被擋）。程式會實際比對，不符就丟掉',
    '- mode：deny（執行前擋下）只用在不可逆、正式環境或代價高的錯誤；其他用 remind（照常執行，之後提醒）',
    '- message：給 AI 看的一句話，說該改成怎麼做（引用規則裡的工具或指令）',
    '',
    `這個對話用過的工具：${tools.length ? tools.join(', ') : '（無紀錄）'}`,
    '',
    `輸出：在 ${ACTIONS_START} 與 ${ACTIONS_END} 之間，每行一個 JSON，每條規則最多一個；沒有適合的就兩行標記之間留空。`,
    '{"rule":"<規則名稱，原樣>","tool":"Bash","match":"<regex>","unless":"<regex，可省略>","mode":"remind","message":"<一句話>","bad":"<違規範例>","good":"<正確範例>"}',
    '',
    '=== 規則 ===',
    ...rules.flatMap(r => [`### ${r.name}`, ...r.body]),
  ].join('\n')
}

type ProposedGuard = Pick<Guard, 'rule' | 'tool' | 'match' | 'unless' | 'mode' | 'message' | 'bad' | 'good'>

export function parseGuards(text: string, names: Set<string>) {
  const out: ProposedGuard[] = []
  const rejected: string[] = []
  const start = text.indexOf(ACTIONS_START)
  const end = text.indexOf(ACTIONS_END, start + 1)
  const p = t().guard.parse
  if (start === -1 || end === -1) return { out, rejected: [p.noMarker] }
  for (const line of text.slice(start + ACTIONS_START.length, end).split('\n')) {
    if (!line.trim()) continue
    try {
      const g = JSON.parse(line) as Record<string, unknown>
      const str = (k: string) => (typeof g[k] === 'string' && (g[k] as string).trim() ? (g[k] as string) : undefined)
      const rule = str('rule'), tool = str('tool'), match = str('match'), message = str('message')
      const unless = str('unless')
      const mode = GUARD_MODES.find(m => m === g.mode)
      if (!rule || !names.has(rule)) throw new Error(p.notCandidate)
      if (!tool || !/^[\w.-]+\*?$/.test(tool)) throw new Error(p.badTool)
      if (!match || !message || !mode) throw new Error(p.missingFields)
      for (const pattern of [match, unless]) {
        if (pattern === undefined) continue
        if (pattern.length > GUARD_PATTERN_MAX) throw new Error(p.tooLong)
        new RegExp(pattern, 'i')
      }
      // 範例驗證：違規的要擋、正確的要放行；擋不到或什麼都擋的樣式在這裡被丟掉
      const bad = str('bad'), good = str('good')
      if (!bad || !good) throw new Error(p.missingExamples)
      const probe = { tool, match, ...(unless ? { unless } : {}) }
      const self = tool.replace(/\*$/, '')
      if (!guardHits(probe, self, bad)) throw new Error(p.badNotBlocked)
      if (guardHits(probe, self, good)) throw new Error(p.goodBlocked)
      if (out.some(o => o.rule === rule)) throw new Error(p.duplicate)
      out.push({ ...probe, rule, mode, message, bad, good })
    } catch (err) {
      rejected.push(p.wrap(clip(line.trim(), 80), err instanceof Error ? err.message : String(err)))
    }
  }
  return { out, rejected }
}

// ---------- 守門的資料變換與列表文字（register.ts 負責讀寫 store） ----------
// 寫成文字還擋不住的才升級成守門（維護者 2026-10-09）：放進 repo 之後使用者又糾正了（次數比放進去時多），
// 或使用者不要放進 repo、卻已經講了 GUARD_MIN_COUNT 次。還沒處理放進 repo 的先走放進 repo；已有守門（任何狀態，含使用者說不要的）不再提
const escalated = (r: Rule) => {
  if (inProject(r)) { const at = promotedAtOf(r); return at !== undefined && r.count > at }
  return projectOf(r) === PROJECT_DECLINED && r.count >= GUARD_MIN_COUNT
}
export const guardCandidatesOf = (rules: Rule[], guards: Guard[]) =>
  rules.filter(r => escalated(r) && !guards.some(g => g.rule === r.name))

// 新對話開頭請 AI 問使用者要不要採用的守門草稿：AI 做完使用者的事再問，使用者的回答由背景整理從對話記下
export const guardAskText = (drafts: { guard: Guard; rule: Rule | undefined }[]) => [
  `${NOTE_TAG} 下面這些規則已經寫成文字，AI 還是一再違反，ctx-handoff 起草了守門：在 AI 呼叫工具之前比對參數，違規時提醒或擋下。先做完使用者這次交代的事，再在回覆最後用一兩句白話問使用者要不要採用：說明它在什麼情況會出現、會做什麼。使用者正在處理緊急問題就不要問。`,
  ...drafts.map(({ guard: g, rule: r }) => `- 守門 #${g.id}（${g.mode === 'deny' ? '擋下' : '提醒'}）：規則「${g.rule}」${r ? `（使用者提過 ${r.count} 次；${ruleText(r)}）` : ''}｜工具 ${g.tool} 符合 /${g.match}/${g.unless ? `，除非 /${g.unless}/` : ''}時，告訴 AI：${g.message}`),
  '使用者想討論就回答問題，例如會不會擋到正常工作、要提醒還是擋下。使用者說要或不要，不用呼叫任何工具，背景整理會從對話記下；使用者沒回應就不要追問。',
].join('\n')

// 模型提的草稿加上編號、狀態與試比對（這段對話已跑過的工具呼叫命中幾次）
export function withProposals(out: ReturnType<typeof parseGuards>['out'], guards: Guard[], calls: { tool: string; input: Record<string, unknown> }[], at: number) {
  let id = guards.reduce((n, g) => Math.max(n, g.id), 0)
  return out.map(g => ({
    ...g, id: ++id, state: 'proposed' as const, at,
    replay: { hits: calls.filter(c => guardHits(g, c.tool, inputText(c.input))).length, calls: calls.length },
  }))
}

export function guardListText(guards: GuardView[]) {
  const m = t()
  if (guards.length === 0) return m.guard.none(GUARD_MIN_COUNT)
  return [
    m.guard.listHead,
    ...guards.flatMap(g => [
      m.guard.entry(g.id, m.guard.state[g.state], m.guard.mode[g.mode], g.rule, g.hits),
      `${m.ind}${m.guardMatch(g.tool, g.match, g.unless)}`,
      `${m.ind}→ ${g.message}`,
      ...(g.bad && g.good ? [`${m.ind}${m.guard.example(clip(g.bad, 80), clip(g.good, 80))}`] : []),
      ...(g.replay ? [`${m.ind}${m.guard.replay(g.replay.calls, g.replay.hits)}`] : []),
    ]),
  ].join('\n')
}

export function guardSummaryText(guards: Guard[], candidates: number) {
  const count = (s: GuardState) => guards.filter(g => g.state === s).length
  return t().guard.summary(count('on'), count('proposed'), count('off')) +
    (candidates ? t().guard.summaryMore(candidates, GUARD_MIN_COUNT) : '')
}

// /handoff guard 的子指令換成要做的改動：on／off／drop 原樣，mode 要帶合法的模式，其他回 undefined
export const guardChangeOf = (action: string, modeText: string) =>
  action === 'on' || action === 'off' || action === 'drop' ? action
    : action === 'mode' ? GUARD_MODES.find(m => m === modeText) : undefined

// 啟用／停用／刪除／換模式；回傳改到的那一條與新的清單，找不到回 undefined
export function applyGuardChange(guards: Guard[], id: number, change: 'on' | 'off' | 'drop' | GuardMode) {
  const g = guards.find(x => x.id === id)
  if (!g) return undefined
  const updated = change === 'drop' ? guards.filter(x => x !== g)
    : guards.map(x => (x !== g ? x : change === 'on' || change === 'off' ? { ...x, state: change } : { ...x, mode: change }))
  return { g, updated }
}
