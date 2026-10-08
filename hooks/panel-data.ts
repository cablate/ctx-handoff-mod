// 面板的資料快照與刪除／保留記憶的筆記變換（純函式，不碰 $；讀寫檔案與 store 在 register.ts）
import type { PanelData, PanelSetting } from '../types'
import { guardCandidatesOf } from './guards'
import type { GuardView } from './guards'
import { EVIDENCE_KEEP, STALE_DAYS, isArchived, memHead, memLines, projectOf } from './notes'
import type { Memory, Notes } from './notes'
import type { DistillLast } from './records'

const PANEL_MEMORY = 8

export function panelSnapshot(file: string, notes: Notes, guards: GuardView[], d: DistillLast | undefined, today: string, settings: PanelSetting[] = []): PanelData {
  return {
    file,
    settings,
    guards,
    candidates: guardCandidatesOf(notes.rules, guards).length,
    ...(d ? { lastDistill: { at: new Date(d.at).toLocaleString(), why: d.why, changes: d.changes } } : {}),
    // 封存的另外列在封存區，這裡不重複
    memory: notes.memory.filter(m => !isArchived(m, today)).slice(-PANEL_MEMORY).map(m => ({ head: memHead(m), detail: memLines(m).slice(1).map(l => l.replace(/^\s+- /, '')) })),
    memoryTotal: notes.memory.length,
    archived: notes.memory.filter(m => isArchived(m, today)).map(memHead),
    staleDays: STALE_DAYS,
    rules: [...notes.rules].sort((a, b) => b.count - a.count).map(r => ({ name: r.name, count: r.count, ...(projectOf(r) ? { project: projectOf(r) } : {}) })),
    procedures: [...notes.procedures].sort((a, b) => b.count - a.count).map(p => ({ name: p.name, count: p.count, ...(projectOf(p) ? { project: projectOf(p) } : {}) })),
  }
}

// 封存的記憶按「留下」：加一筆今天的根據，等於人工證實一次（直接改 m）
export function keepMemory(m: Memory, day: string) {
  m.evidence = [...m.evidence, `${day}｜在面板確認留下`].slice(-EVIDENCE_KEEP)
}

// 刪一條記憶（m:<原文>）、規則（r:<名稱>）或流程（p:<名稱>）；找不到回 undefined
export function withoutNote(notes: Notes, key: string) {
  const target = key.slice(2)
  const updated = key.startsWith('m:')
    ? { ...notes, memory: notes.memory.filter(m => memHead(m) !== target) }
    : key.startsWith('p:')
      ? { ...notes, procedures: notes.procedures.filter(p => p.name !== target) }
      : { ...notes, rules: notes.rules.filter(r => r.name !== target) }
  const total = (n: Notes) => n.memory.length + n.rules.length + n.procedures.length
  if (total(updated) === total(notes)) return undefined
  return { updated, target }
}

// 刪除前備份原檔的位置：經驗檔旁邊的 .ctx-handoff-backup/
export const backupPath = (dir: string, now: number) =>
  `${dir}/.ctx-handoff-backup/${new Date(now).toISOString().slice(0, 19).replace(/:/g, '-')}-ctx-handoff.md`
