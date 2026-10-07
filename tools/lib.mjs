// 工具共用：Claude 設定目錄、經驗檔解析與帶入量估算（和 hooks/notes.ts 的 parseNotes／contextText 同規則）
import { homedir } from 'node:os'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const claudeDir = () => (process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')).replace(/\\/g, '/')

export const NOTES_NAME = 'ctx-handoff.md'

export function parseNotes(text) {
  const notes = { memory: [], rules: [], extra: [] }
  let section, rule, inItem = false
  for (const raw of text.replace(/\r/g, '').split('\n')) {
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
      if (line.startsWith('- ')) { notes.memory.push(line); inItem = true }
      else if (inItem && line.trim() && !line.startsWith('#')) notes.memory[notes.memory.length - 1] += `\n${line}`
      else inItem = false
    }
    if (section !== 'rules') continue
    const head = /^### (.+?)（(\d+) 次）\s*$/.exec(line)
    if (head) { rule = { name: head[1], count: Number(head[2]), body: [] }; notes.rules.push(rule) }
    else if (line.startsWith('### ')) { rule = { name: line.slice(4).trim(), count: 1, body: [] }; notes.rules.push(rule) }
    else if (rule && line.trim()) rule.body.push(line)
  }
  while (notes.extra.at(-1) === '') notes.extra.pop()
  return notes
}

// 新對話開頭帶入的字數：最新 40 條記憶＋出現 2 次以上的前 15 條規則（只算規則句）
export function injectedChars(notes) {
  const ruleText = r => (r.body.find(l => l.startsWith('- 規則：')) ?? r.body[0] ?? '')
  const rules = notes.rules.filter(r => r.count >= 2).sort((a, b) => b.count - a.count).slice(0, 15)
  return notes.memory.slice(-40).join('\n').length + rules.map(ruleText).join('\n').length
}

// 所有專案的經驗檔：{ dir, file }
export function notesFiles() {
  const base = `${claudeDir()}/projects`
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(`${base}/${d.name}/memory/${NOTES_NAME}`))
    .map(d => ({ dir: d.name, file: `${base}/${d.name}/memory/${NOTES_NAME}` }))
}

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

// 本地時間「MM-DD HH:mm」
export const local = ms => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(5, 16).replace('T', ' ')
}
