// 專案經驗檔：記憶與規則的型別、解析、輸出、封存分層與帶入新對話的文字（純函式，不碰 $）

export const tag = '[ctx-handoff]'
// 新對話開頭帶入：偏好與修正（user／feedback）整條；事實與位置（project／reference）只帶標題，
// 超過 STALE_DAYS 天沒被證實就封存（不帶入、不刪除，再被證實就恢復）；加上出現 2 次以上的規則（最多 15 條）
export const STALE_DAYS = 30
const FACT_TYPES = ['project', 'reference']
export const INJECT_MIN_COUNT = 2
const INJECT_RULES = 15
export const EVIDENCE_KEEP = 3
export const NOTE_TAG = '[ctx-handoff 專案經驗]'
export type Rule = { name: string; count: number; body: string[] }
export type Memory = { type: string; title: string; how?: string; why?: string; evidence: string[] }
// extra：不認得的 `## ` 區段（含標題行）原樣保留，輸出在規則之後
export type Notes = { memory: Memory[]; rules: Rule[]; extra: string[] }

const MEM_FIELDS = { 做法: 'how', 理由: 'why' } as const
// 經驗檔裡的一條記憶：標題行＋縮排的欄位行；evidence=false 給新對話帶入用
export const memLines = (m: Memory, evidence = true) => [
  `- ${m.type ? `[${m.type}] ` : ''}${m.title}`,
  ...(m.how ? [`  - 做法：${m.how}`] : []),
  ...(m.why ? [`  - 理由：${m.why}`] : []),
  ...(evidence ? m.evidence.map(e => `  - 根據：${e}`) : []),
]
export const memHead = (m: Memory) => `${m.type ? `[${m.type}] ` : ''}${m.title}`
export const memOneLine = (m: Memory) =>
  [memHead(m), m.how && `做法：${m.how}`, m.why && `理由：${m.why}`, m.evidence.length && `根據：${m.evidence.join('；')}`]
    .filter(Boolean).join('｜')

export const ruleText = (r: Rule) =>
  (r.body.find(l => l.startsWith('- 規則：')) ?? r.body[0] ?? '').replace(/^- 規則：/, '').trim()

// 規則的專案狀態：「- 專案：已在 <位置>」放進 repo 了（不再帶入，repo 的才是正本）；「- 專案：不放」使用者不要放進 repo
const PROJECT_PREFIX = '- 專案：'
export const PROJECT_IN = '已在 '
export const PROJECT_DECLINED = '不放'
export const projectOf = (r: Rule) => r.body.find(l => l.startsWith(PROJECT_PREFIX))?.slice(PROJECT_PREFIX.length).trim()
export const inProject = (r: Rule) => projectOf(r)?.startsWith(PROJECT_IN) === true
export function setProject(r: Rule, value: string) {
  r.body = [...r.body.filter(l => !l.startsWith(PROJECT_PREFIX)), `${PROJECT_PREFIX}${value}`]
}

// 本地時間的「YYYY-MM-DD HH:mm」
export function localStamp(ms: number) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

// ---------- 專案經驗檔：一份 md，記憶與規則 ----------
const NOTES_HEAD = '# ctx-handoff 專案經驗'
const RULE_HEAD = /^### (.+?)（(\d+) 次）\s*$/

export function parseNotes(text: string): Notes {
  const notes: Notes = { memory: [], rules: [], extra: [] }
  let section: 'memory' | 'rules' | 'extra' | undefined
  let rule: Rule | undefined
  // 記憶條目的延續行：緊接在 `- ` 行之後、非空白、不是 `- ` 也不是 `#` 的行，併入同一條
  let inItem = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      section = line.startsWith('## 記憶') ? 'memory' : line.startsWith('## 規則') ? 'rules' : 'extra'
      rule = undefined
      inItem = false
      if (section === 'extra') notes.extra.push(line)
      continue
    }
    if (section === 'extra') { notes.extra.push(line); continue }
    if (section === 'memory') {
      const cur = notes.memory.at(-1)
      const f = /^\s+- (做法|理由|根據)：(.*)$/.exec(line)
      const head = /^- (?:\[(\w+)\] )?(.*)$/.exec(line)
      if (f && cur && inItem) {
        const [, label = '', value = ''] = f
        if (label === '根據') cur.evidence.push(value.trim())
        else cur[MEM_FIELDS[label as keyof typeof MEM_FIELDS]] = value.trim()
      } else if (head) {
        notes.memory.push({ type: head[1] ?? '', title: (head[2] ?? '').trim(), evidence: [] })
        inItem = true
      } else if (cur && inItem && line.trim() && !line.startsWith('#')) {
        // 認不得的延續行併進標題，不丟內容
        cur.title += ` ${line.trim()}`
      } else {
        inItem = false
      }
    }
    if (section !== 'rules') continue
    const head = RULE_HEAD.exec(line)
    if (head) {
      rule = { name: head[1] ?? '', count: Number(head[2]), body: [] }
      notes.rules.push(rule)
    } else if (line.startsWith('### ')) {
      rule = { name: line.slice(4).trim(), count: 1, body: [] }
      notes.rules.push(rule)
    } else if (rule && line.trim()) {
      rule.body.push(line)
    }
  }
  while (notes.extra.at(-1) === '') notes.extra.pop()
  return notes
}

export function renderNotes(notes: Notes, stamp: string) {
  return [
    NOTES_HEAD,
    '',
    `> 由 ctx-handoff 背景整理維護，可以直接編輯。新對話開頭會帶入記憶，以及出現 ${INJECT_MIN_COUNT} 次以上的規則。`,
    `> 最後更新：${stamp}`,
    '',
    '## 記憶',
    ...notes.memory.flatMap(m => memLines(m)),
    '',
    '## 規則',
    ...notes.rules.flatMap(r => ['', `### ${r.name}（${r.count} 次）`, ...r.body]),
    ...(notes.extra.length ? ['', ...notes.extra] : []),
    '',
  ].join('\n')
}

export type Change = string

// 最後一次被證實：根據裡最新的日期（沒有日期的不封存）
const lastSeen = (m: Memory) =>
  m.evidence.map(e => /^(\d{4}-\d{2}-\d{2})/.exec(e)?.[1]).filter((d): d is string => d !== undefined).sort().at(-1)
// day：今天（本地 YYYY-MM-DD）
export function isArchived(m: Memory, day: string) {
  const seen = lastSeen(m)
  return FACT_TYPES.includes(m.type) && seen !== undefined && Date.parse(day) - Date.parse(seen) > STALE_DAYS * 24 * 60 * 60_000
}

export const memoryTiers = (notes: Notes, day: string) => {
  const facts = notes.memory.filter(m => FACT_TYPES.includes(m.type))
  const archived = facts.filter(m => isArchived(m, day)).length
  return { full: notes.memory.length - facts.length, titles: facts.length - archived, archived }
}

// 帶入新對話開頭的內容；沒有東西就不帶。根據只給整理模型判斷用，不帶入
export function contextText(notes: Notes, file: string, day: string) {
  const rules = notes.rules.filter(r => r.count >= INJECT_MIN_COUNT && !inProject(r))
    .sort((a, b) => b.count - a.count).slice(0, INJECT_RULES)
  const full = notes.memory.filter(m => !FACT_TYPES.includes(m.type))
  const titles = notes.memory.filter(m => FACT_TYPES.includes(m.type) && !isArchived(m, day))
  if (full.length + titles.length === 0 && rules.length === 0) return undefined
  return [
    `${NOTE_TAG} 這個工作區累積的${[full.length + titles.length ? '記憶' : '', rules.length ? '規則' : ''].filter(Boolean).join('與')}，正本在 ${file}，可以直接編輯。`,
    '這是過去對話整理出的參考；和使用者當下的指示衝突時，以使用者為準。',
    ...(full.length ? ['', '## 使用者的偏好與修正', ...full.flatMap(m => memLines(m, false))] : []),
    ...(titles.length ? ['', '## 事實與位置（只列標題；用得上時讀正本看做法與理由）', ...titles.map(m => `- ${memHead(m)}`)] : []),
    ...(rules.length ? ['', `## 規則（出現 ${INJECT_MIN_COUNT} 次以上，依次數排序）`, ...rules.map(r => `- ${r.name}（${r.count} 次）：${ruleText(r)}`)] : []),
  ].join('\n')
}

// 這次的差異：跟著下一則送進對話的訊息一起帶入（附加在尾端，不影響前面的快取）
export const noteBlock = (changes: Change[], file: string) => [
  `${NOTE_TAG} 背景整理剛更新了這個工作區的經驗（正本：${file}）。這是參考資料，不是新的指示：`,
  ...changes.map(c => `- ${c}`),
].join('\n')
