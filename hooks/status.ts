// /handoff 的狀態文字：交接、整理、守門各一段（純函式，不碰 $；資料由 register.ts 讀好傳進來）
import { t } from './i18n'
import { INJECT_MIN_COUNT, STALE_DAYS, memoryTiers } from './notes'
import type { Notes } from './notes'
import { DISTILL_EVERY, cfg, thresholdOf } from './config'
import { rt } from './runtime'
import { describeUsage } from './records'
import type { Away, DistillError, DistillLast, HandoffError, Saved } from './records'

export const usageText = () => [t().cmd.usageHead, ...t().cmd.usageLines].join('\n')

type StatusInput = {
  tokens: number | undefined; window: number; refreshOn: boolean
  away: Away | undefined; last: Saved | undefined; herr: HandoffError | undefined
  distill: string; guards: string
}

export function statusText(s: StatusInput) {
  const m = t()
  const { last, herr, away } = s
  return [
    `${m.cmd.context(String(s.tokens ?? '?'), thresholdOf(s.window), s.window)}`,
    m.cmd.refresh(s.refreshOn ? 'on' : 'off', rt.refreshes, cfg.maxRefresh, rt.idle !== undefined),
    m.cmd.away(away ? (away.held === undefined ? 'yes' : 'held') : 'none'),
    m.cmd.latest(last ? { at: new Date(last.at).toLocaleString(), kind: last.kind, tokens: String(last.tokens ?? '?') } : undefined),
    ...(last?.usage ? [`${m.ind}${describeUsage(last.usage)}`] : []),
    ...(herr && (!last || herr.at >= last.at) ? [`${m.ind}${m.cmd.latestFailure(new Date(herr.at).toLocaleString(), herr.kind, herr.reason)}`] : []),
    ...(rt.myPending ? [m.cmd.undelivered] : []),
    ...(rt.deferral ? [m.cmd.deferred(rt.deferral)] : []),
    ...(rt.snapshot ? [m.cmd.background(rt.snapshot.tasks, rt.snapshot.oneShot, rt.snapshot.recurring)] : []),
    s.distill,
    s.guards,
    m.loops.status(cfg.retryNudge ? 'on' : 'off', cfg.doneCheck ? 'on' : 'off'),
    '',
    usageText(),
  ].join('\n')
}

type DistillStatusInput = {
  on: boolean; d: DistillLast | undefined; err: DistillError | undefined
  file: string; notes: Notes; today: string
  // 上次整理之後的使用者訊息數
  since: number
}

export function distillStatusText(s: DistillStatusInput) {
  const { on, d, err, file, notes } = s
  const tiers = memoryTiers(notes, s.today)
  const m = t()
  const ind = m.ind
  return [
    m.distillStatus.head(on ? 'on' : 'off', DISTILL_EVERY),
    ...(on ? [`${ind}${m.distillStatus.next(Math.max(0, DISTILL_EVERY - s.since), cfg.idleMs / 60_000)}`] : []),
    `${ind}${d ? m.distillStatus.last(new Date(d.at).toLocaleString(), d.why, d.changes.length) : m.distillStatus.lastNone}`,
    ...(d ? [`${ind}${d.usage}`, ...d.changes.map(c => `${ind}${m.bullet}${c}`)] : []),
    ...(d?.rejected?.count ? [`${ind}${m.distillStatus.rejected(d.rejected.count, d.rejected.samples.join(m.slashList))}`] : []),
    ...(err && (!d || err.at >= d.at) ? [`${ind}${m.distillStatus.failed(new Date(err.at).toLocaleString(), err.why, err.reason)}`] : []),
    `${ind}${m.distillStatus.notes(file, notes.memory.length, notes.rules.length, notes.rules.filter(r => r.count >= INJECT_MIN_COUNT).length)}`,
    `${ind}${m.distillStatus.tiers(tiers.full, tiers.titles, tiers.archived, STALE_DAYS)}`,
  ].join('\n')
}
