// store 裡紀錄的型別（交接、整理）、紀錄的鍵與清理規則，以及用量的描述文字（純函式，不碰 $）
import { t } from './i18n'
import type { Rejected } from './distill'
import type { Change } from './notes'

export type Kind = 'present' | 'away' | 'manual' | 'dry'
export type Usage = { input: number; cacheRead: number; cacheCreation: number; output: number; ms: number }
export type Saved = { at: number; sessionId: string; kind: Kind; tokens: number | null; text: string; usage?: Usage }

export function describeUsage(u: Usage) {
  const total = u.input + u.cacheRead + u.cacheCreation
  const ratio = total === 0 ? 0 : (u.cacheRead / total) * 100
  const n = (v: number) => v.toLocaleString('en-US')
  return t().usage(n(total), n(u.cacheRead), ratio.toFixed(2), n(u.cacheCreation), n(u.input), n(u.output), (u.ms / 1000).toFixed(1))
}
export type Away = { handoff: string; held?: string }
// 交接失敗紀錄：kind 是那次 handoff 的種類，reason 開頭註明失敗階段
export type HandoffError = { at: number; sessionId: string; kind: Kind; reason: string; tokens: number | null; turns: number }

export const awayKey = (sessionId: string) => `away:${sessionId}`
export const pendingKey = (sessionId: string) => `pendingSubmit:${sessionId}`

export type DistillLast = { at: number; why: string; changes: Change[]; file: string; usage: string; rejected?: Rejected }
export type DistillError = { at: number; why: string; reason: string }

// 每個 session 一把的鍵（值不改寫）：第一次看到的時間記在 seen，超過 30 天的刪掉
const PRUNE_MS = 30 * 24 * 60 * 60_000
const isSessionKey = (k: string) => /^(?:distill|away|last|pendingSubmit):[^:]+$/.test(k)

// 把還沒記錄的鍵記進 seen（直接改它），回傳是否有變動與該刪的鍵（同時從 seen 移除）
export function pruneSeen(keys: readonly string[], seen: Record<string, number>, now: number) {
  let changed = false
  const expired: string[] = []
  for (const k of keys) {
    if (isSessionKey(k) && seen[k] === undefined) { seen[k] = now; changed = true }
  }
  for (const [k, at] of Object.entries(seen)) {
    if (now - at <= PRUNE_MS) continue
    expired.push(k)
    delete seen[k]
    changed = true
  }
  return { changed, expired }
}

// 累計統計（docs/north-star.md 的量測用）：一個工作區一份，只記帳、不改行為。
// counts：事件次數；failures：最近的失敗原因；hits：最近的守門命中（指令片段，評估時再判斷擋得對不對）
export type StatEvent = { at: number; what: string; detail: string }
export type Stats = { since: number; counts: Record<string, number>; failures: StatEvent[]; hits: StatEvent[] }
// 只防無限長大，不是品質上限
export const STATS_RECENT = 20
export const STATS_DETAIL_MAX = 200
export const statsKey = (projectKey: string) => `stats:${projectKey}`

export function addStat(prev: Stats | undefined, now: number, what: string, n = 1, event?: { failure?: string; hit?: string }): Stats {
  const s: Stats = prev ?? { since: now, counts: {}, failures: [], hits: [] }
  const push = (list: StatEvent[], detail: string) => [...list, { at: now, what, detail: detail.slice(0, STATS_DETAIL_MAX) }].slice(-STATS_RECENT)
  return {
    since: s.since,
    counts: { ...s.counts, [what]: (s.counts[what] ?? 0) + n },
    failures: event?.failure === undefined ? s.failures : push(s.failures, event.failure),
    hits: event?.hit === undefined ? s.hits : push(s.hits, event.hit),
  }
}
