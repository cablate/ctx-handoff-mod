// 把對話轉成給整理模型看的純文字：截短工具輸入與結果、找錨點、限制總長
// 對話片段的字數上限（超過時保留最新的部分）；單一工具輸入／結果各自截短
const TRANSCRIPT_MAX_CHARS = 300_000
const TOOL_INPUT_CHARS = 300
const TOOL_RESULT_CHARS = 500

export const anchorOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 30)

export type Row = { role: 'user' | 'assistant'; text: string; toolUses: readonly { tool: string; input: Record<string, unknown>; text?: string; isError?: true }[] }
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…（截短，原長 ${s.length} 字）` : s)

// 上次整理到的錨點（使用者訊息開頭）之後的對話，轉成純文字；找不到錨點就用全部。
// 工具呼叫只留名稱、截短的輸入與結果；太長時保留最新的部分
export function transcriptOf(rows: readonly Row[], anchor: string | undefined) {
  let start = 0
  let found = false
  if (anchor) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if (r?.role === 'user' && r.text.replace(/\s+/g, ' ').includes(anchor)) { start = i + 1; found = true; break }
    }
  }
  const lines: string[] = []
  for (const r of rows.slice(start)) {
    if (r.role === 'user') { if (r.text.trim()) lines.push(`【使用者】${r.text.trim()}`); continue }
    if (r.text.trim()) lines.push(`【助理】${r.text.trim()}`)
    for (const u of r.toolUses) {
      const out = u.text === undefined ? '' : ` → ${u.isError ? '錯誤：' : ''}${clip(u.text.replace(/\s+/g, ' '), TOOL_RESULT_CHARS)}`
      lines.push(`　〔工具 ${u.tool}〕${clip(JSON.stringify(u.input), TOOL_INPUT_CHARS)}${out}`)
    }
  }
  let text = lines.join('\n')
  if (text.length > TRANSCRIPT_MAX_CHARS) text = `（前面省略 ${text.length - TRANSCRIPT_MAX_CHARS} 字）\n${text.slice(-TRANSCRIPT_MAX_CHARS)}`
  return { text, found }
}
