import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { PanelData, PanelSetting, PanelUi } from '../types'
import { panelTree, showSetting } from './panel'
import type { PanelActions } from './panel'
import { getLang, pickLang, setLang, t } from './i18n'
import type { Lang } from './i18n'
import { applyActions, distillPrompt, latestProgress, parseActions, squash } from './distill'
import { progressForPrompt, progressKey, progressOffer, withOffered } from './progress'
import type { Progress, ProgressFields } from './progress'
import { GUARD_MIN_COUNT, applyGuardChange, guardCandidatesOf, guardChangeOf, guardHits, guardListText, guardPrompt, guardSummaryText, inputText, parseGuards, withProposals } from './guards'
import type { Guard, GuardMode } from './guards'
import { NOTE_TAG, contextText, localStamp, memHead, noteBlock, parseNotes, renderNotes, tag } from './notes'
import type { Notes } from './notes'
import { encodeProject, isAbs, resolveDots, slash } from './paths'
import { anchorOf, transcriptOf } from './transcript'
import type { Row } from './transcript'
import { DISTILL_EFFORT, DISTILL_EVERY, DISTILL_GRACE_MS, DISTILL_MAX_TOKENS, DISTILL_TIMEOUT_MS, GUARD_MAX_TOKENS, HANDOFF_TIMEOUT_MS, KEEP, DEFER_CAP_EXTRA, DEFER_CAP_RATIO, RELOAD_GRACE_MS, RETRY_MS, RETRY_TURNS, SETTINGS, STOPPED, cfg, optionsOf, resetConfig, resolveConfig, settingSource, settingValue, specOf, stepSetting, thresholdOf } from './config'
import { resetRuntime, rt } from './runtime'
import { doneCheck, freshWork, noteCall, trackFailure } from './loops'
import { clearNext, noteStep, peekNext, resolveReplyLang, takePending } from './lang'
import { awayKey, describeUsage, pendingKey, pruneSeen } from './records'
import type { Away, DistillError, DistillLast, HandoffError, Kind, Saved, Usage } from './records'
import { HANDOFF_PROMPT, forkFailure, heldBlock } from './handoff'
import { PROMOTE_DESCRIPTION, PROMOTE_SCHEMA, PROMOTE_TOOL, applyInProject, markAsked, promoteItems, promoteReport, promoteText } from './promote'
import type { PromoteAsk } from './promote'
import { backupPath, keepMemory, panelSnapshot, withoutNote } from './panel-data'
import { distillStatusText, statusText, usageText } from './status'

// 讀本 plugin 的設定：面板存在 store 的 settings 優先，其次 settings.json 的 pluginConfigs["ctx-handoff@<marketplace>"].options
async function readSettings($: EngineInterface) {
  let options: Record<string, unknown> = {}
  try {
    options = optionsOf((await $.settings.read()).pluginConfigs as Record<string, { options?: Record<string, unknown> }> | undefined)
  } catch {}
  const panel = ((await $.store.get('settings')) as Record<string, unknown> | undefined) ?? {}
  return { options, panel }
}

async function loadConfig($: EngineInterface) {
  const { options, panel } = await readSettings($)
  Object.assign(cfg, resolveConfig(options, panel))
}

// 重讀設定（送出新訊息、面板改值）：別的 session 在面板改的值也在這時生效；語言、閒置計時、回覆語言跟著換
async function reloadConfig($: EngineInterface) {
  const before = { ...cfg }
  await loadConfig($)
  if (cfg.replyLanguage !== before.replyLanguage) rt.replyTarget = undefined
  if (cfg.language !== before.language) {
    rt.langReady = undefined
    await initLang($)
  }
  if (cfg.idleMs !== before.idleMs && rt.idle !== undefined) await schedule($)
  if (cfg.minTokens !== before.minTokens) await showDistillStatus($)
}

async function isRefreshOn($: EngineInterface) {
  return (await $.store.get('refresh')) !== false
}

// 最多等 ms：逾時回 fallback（原本的 promise 照樣跑完，只是不再等它）
async function within<T, F>($: EngineInterface, p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: Timer | undefined
  const late = new Promise<F>(resolve => { timer = $.clock.after(ms, () => resolve(fallback)) })
  try {
    return await Promise.race([p, late])
  } finally {
    timer?.cancel()
  }
}

type ForkResult = Awaited<ReturnType<EngineInterface['model']['fork']>>
type ForkOutcome = ForkResult | { isAnswered: false; reason: 'timeout' }
const forkWithin = ($: EngineInterface, prompt: string, ms: number): Promise<ForkOutcome> =>
  within($, $.model.fork({ prompt }), ms, { isAnswered: false as const, reason: 'timeout' as const })

// 工作區鍵：經驗檔所在目錄的名稱（<claude>/projects/<這一層>/memory/ctx-handoff.md）
async function projectKey($: EngineInterface) {
  const file = await notesFile($)
  return file?.split('/').at(-3) ?? 'unknown'
}

// 每個 session 一把的鍵第一次出現的時間，給清理用；已記錄過的不再重寫
async function touchSeen($: EngineInterface, key: string) {
  if (rt.seenKnown.has(key)) return
  rt.seenKnown.add(key)
  const seen = ((await $.store.get('seen')) as Record<string, number> | undefined) ?? {}
  if (seen[key] === undefined) await $.store.set('seen', { ...seen, [key]: await $.clock.now() })
}

// 失敗寫進 store 讓 /handoff 看得到；在場交接失敗還要擋一陣子才重試
async function recordFailure($: EngineInterface, kind: Kind, tokens: number | null, reason: string, sid?: string) {
  const at = await $.clock.now()
  const turns = await $.session.turns()
  const err: HandoffError = { at, sessionId: sid ?? await $.session.id(), kind, reason, tokens, turns }
  await $.store.set(`handoff:error:${await projectKey($)}`, err)
  if (kind === 'present' || kind === 'manual') rt.retryAfter = { turns, at }
}

async function makeHandoff($: EngineInterface, kind: Kind, tokens: number | null) {
  const started = await $.clock.now()
  const r = await forkWithin($, HANDOFF_PROMPT, HANDOFF_TIMEOUT_MS)
  if (!r.isAnswered) {
    $.ui.log(t().handoff.failedLog(forkFailure(r.reason)))
    $.ui.toast(t().handoff.failedToast)
    await recordFailure($, kind, tokens, t().handoff.failGenerate(forkFailure(r.reason)))
    return undefined
  }
  const at = await $.clock.now()
  const usage: Usage = {
    input: r.usage.input_tokens,
    cacheRead: r.usage.cache_read_input_tokens,
    cacheCreation: r.usage.cache_creation_input_tokens,
    output: r.usage.output_tokens,
    ms: at - started,
  }
  const saved: Saved = { at, sessionId: await $.session.id(), kind, tokens, text: r.text, usage }
  const handoffsKey = `handoffs:${await projectKey($)}`
  const list = ((await $.store.get(handoffsKey)) as Saved[] | undefined) ?? []
  await $.store.set(handoffsKey, [...list, saved].slice(-KEEP))
  rt.lastHandoff = { text: r.text }
  $.ui.log(t().handoff.savedLog(kind, describeUsage(usage)))
  return r.text
}

// $.prompt.submit 被別的 hook 丟棄時只回 { drop }、不會丟例外：沒送進對話，當成失敗
async function submitText($: EngineInterface, text: string) {
  const r = await $.prompt.submit({ text })
  if (r.drop !== undefined) throw new Error(t().handoff.dropped(r.drop))
}

// /clear → 把完整文字送進新對話。送出前先存成 pendingSubmit:<舊 session id>，成功才刪；
// 失敗時回傳階段與原因（clear 失敗＝還在舊對話，pending 已刪；submit 失敗＝pending 留著給 /handoff resend）
async function clearAndSubmit($: EngineInterface, text: string) {
  const sid = await $.session.id()
  const key = pendingKey(sid)
  await $.store.set(key, text)
  await touchSeen($, key)
  rt.myPending = { sid }
  rt.pendingToasted = false
  // 新對話第一則訊息（就是這份 handoff）開頭不要再提供同一段的進度備忘：先標記，/clear 失敗再還原
  await markHanded($, sid, true)
  try {
    await $.command.run({ command: 'clear' })
  } catch (err) {
    await $.store.delete(key)
    rt.myPending = undefined
    await markHanded($, sid, false)
    return { stage: 'clear', reason: String(err) }
  }
  try {
    await submitText($, text)
  } catch (err) {
    return { stage: 'submit', reason: String(err) }
  }
  await $.store.delete(key)
  rt.myPending = undefined
  return undefined
}

// ---------- 背景整理：位置與流程 ----------

async function claudeDir($: EngineInterface) {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return slash(custom)
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  return `${slash(home)}/.claude`
}

async function readText($: EngineInterface, path: string) {
  try { return await $.fs.read(path) } catch { return '' }
}

// 工作區：session 啟動的資料夾；從 git worktree 啟動時算主工作樹（.git 是檔案：gitdir: <主工作樹>/.git/worktrees/<名稱>）。
// 不用 $.session.repo()：它依目前工作目錄判斷，會跟著 Bash 的 cd 變
async function workspace($: EngineInterface) {
  const root = slash(await $.session.root())
  const m = /^gitdir:\s*(.+?)\/\.git\/worktrees\/[^/]+\s*$/m.exec(slash(await readText($, `${root}/.git`)))
  if (!m?.[1]) return root
  const main = slash(m[1])
  return isAbs(main) ? main : resolveDots(`${root}/${main}`)
}

// 經驗檔：<claude>/projects/<編碼後的工作區路徑>/memory/ctx-handoff.md；每個工作區只有這一份。
// 不寫 MEMORY.md：那是內建 auto memory 的索引，開啟 auto memory 時會被載入兩次、也會被它改寫
async function notesFile($: EngineInterface) {
  return `${await claudeDir($)}/projects/${encodeProject(await workspace($))}/memory/ctx-handoff.md`
}

async function isDistillOn($: EngineInterface) {
  return (await $.store.get('distill')) !== false
}

// 整理上次之後新增的對話：先讀好對話片段（之後 /clear 也不影響），再交給設定的整理模型
// queue=false：交接前整理，之後會 /clear，不排入差異
async function distill($: EngineInterface, why: string, queue = true) {
  if (rt.distilling) return undefined
  const sid = await $.session.id()
  const key = `distill:${sid}`
  const prev = (await $.store.get(key)) as { turn: number; anchor?: string } | undefined
  const turns = await $.session.turns()
  if (turns <= (prev?.turn ?? 0)) return undefined
  rt.distilling = true
  rt.distillFailed = false
  await showDistillStatus($, why)
  const fail = async (reason: string) => {
    rt.distillFailed = true
    $.ui.log(t().distill.failLog(why, reason))
    await $.store.set(`distill:error:${await projectKey($)}`, { at: await $.clock.now(), why, reason })
  }
  try {
    // 這次整理到使用者最後一則訊息為止；下次從它之後開始
    const anchor = (await $.store.get(`last:${sid}`)) as string | undefined
    const rows = (await $.session.messages()) as readonly Row[]
    const transcript = transcriptOf(rows, prev?.anchor)
    // quote 的比對對象：使用者自己送出的訊息（本程式注入的經驗與 handoff 不算）
    const userText = squash(rows.filter(r => r.role === 'user' && !r.text.startsWith(NOTE_TAG) && !r.text.startsWith(tag)).map(r => r.text).join('\n'))
    const file = await notesFile($)
    const original = await readText($, file)
    const notes = parseNotes(original)
    const started = await $.clock.now()
    const r = await $.model.complete({
      model: cfg.notesModel,
      effort: DISTILL_EFFORT,
      maxTokens: DISTILL_MAX_TOKENS,
      timeoutMs: DISTILL_TIMEOUT_MS,
      system: distillPrompt(transcript.found ? prev?.anchor : undefined, notes, localStamp(started).slice(0, 10), progressForPrompt(await loadProgress($), started)),
      prompt: `=== 對話紀錄 ===\n${transcript.text || '（沒有新的對話內容）'}\n=== 對話紀錄結束 ===\n\n依系統指示輸出 ACTIONS。`,
    })
    if (!r.isAnswered) {
      const reason = r.reason === 'api-error' ? `api-error ${r.status ?? ''} ${r.error}`.replace(/\s+/g, ' ')
        : r.reason === 'aborted' ? t().distill.timeout(DISTILL_TIMEOUT_MS / 60_000) : r.reason
      await fail(reason)
      return r
    }
    const now = await $.clock.now()
    const stamp = localStamp(now)
    const { actions, rejected } = parseActions(r.text, notes, userText)
    // 整理期間經驗檔被改過：編號對不上，這次不寫也不推進進度，下次重新整理同一段
    if ((await readText($, file)) !== original) {
      const reason = t().distill.edited(file)
      $.ui.log(t().distill.skipLog(why, reason))
      await $.store.set(`distill:error:${await projectKey($)}`, { at: now, why, reason })
      rt.distillFailed = true
      return r
    }
    const { notes: updated, changes } = applyActions(actions, notes, stamp.slice(0, 10), sid)
    if (changes.length > 0) await $.fs.write(file, renderNotes(updated, stamp))
    // 進度備忘（沒有實際進展時模型不輸出，前一份保留）
    const progress = latestProgress(actions)
    if (progress) await saveProgress($, sid, progress, now)
    await $.store.set(key, { turn: turns, at: now, anchor })
    await touchSeen($, key)
    const usage = describeUsage({ input: r.usage.input_tokens, cacheRead: r.usage.cache_read_input_tokens, cacheCreation: r.usage.cache_creation_input_tokens, output: r.usage.output_tokens, ms: now - started })
    await $.store.set(`distill:last:${await projectKey($)}`, { at: now, why, changes, file, usage, rejected } satisfies DistillLast)
    await refreshPanel($)
    $.ui.log(t().distill.doneLog(why, changes.length, rejected.count, file))
    // 先寫檔再排入；差異跟著下一則真正送進對話的訊息帶入（見 prompt.submit）
    if (changes.length > 0 && queue) {
      rt.pendingNotes.set(sid, { changes: [...(rt.pendingNotes.get(sid)?.changes ?? []), ...changes], file })
      $.ui.log(t().distill.queued(changes.length))
    }
    // 讓使用者看得到：寫了哪份檔案（完整路徑），不送訊息、不花 token
    if (changes.length > 0) {
      $.ui.toast(t().distill.toast(changes.length, queue, file))
    }
    return r
  } catch (err) {
    await fail(t().distill.writeFailed(String(err)))
    return undefined
  } finally {
    rt.distilling = false
    await showDistillStatus($)
  }
}

// 狀態列：整理中顯示原因，平常顯示距離下次「每 N 則」整理還差幾則；handoff 延後時讓給延後訊息
async function showDistillStatus($: EngineInterface, running?: string) {
  if (rt.deferral) return
  if (!(await isDistillOn($))) return $.ui.status(undefined)
  if (running) return $.ui.status(t().status.running)
  const left = DISTILL_EVERY - (await sinceDistill($))
  if (left > 0) return $.ui.status(t().status.left(left))
  $.ui.status(((await $.session.usage()).context.tokens ?? 0) < cfg.minTokens ? t().status.short : t().status.next)
}

// 上次整理之後的使用者訊息數
async function sinceDistill($: EngineInterface) {
  const last = ((await $.store.get(`distill:${await $.session.id()}`)) as { turn: number } | undefined)?.turn ?? 0
  return Math.max(0, (await $.session.turns()) - last)
}

async function distillStatus($: EngineInterface) {
  const on = await isDistillOn($)
  const pk = await projectKey($)
  const d = (await $.store.get(`distill:last:${pk}`)) as DistillLast | undefined
  const err = (await $.store.get(`distill:error:${pk}`)) as DistillError | undefined
  const file = await notesFile($)
  const notes = parseNotes(await readText($, file))
  const today = localStamp(await $.clock.now()).slice(0, 10)
  return distillStatusText({ on, d, err, file, notes, today, since: on ? await sinceDistill($) : 0 })
}

// 到期時間與刷新次數另存 $.state：熱重載會清掉計時器與模組變數，session.start 依它重排
const idleState = atom({ plugin: 'ctx-handoff', key: 'idle' } as const, null)

async function schedule($: EngineInterface, delay = cfg.idleMs) {
  rt.idle?.cancel()
  rt.idle = $.clock.after(delay, () => void onIdle($))
  const due = (await $.clock.now()) + delay
  await update($, idleState, () => ({ due, refreshes: rt.refreshes }))
}

async function resumeSchedule($: EngineInterface) {
  const saved = await read($, idleState)
  if (!saved || rt.idle) return
  const left = saved.due - (await $.clock.now())
  if (left < -RELOAD_GRACE_MS) return
  rt.refreshes = saved.refreshes
  await schedule($, Math.max(0, left))
}

async function onIdle($: EngineInterface) {
  await initLang($)
  rt.idle = undefined
  await update($, idleState, () => null)
  if (rt.busy) return
  const { context } = await $.session.usage()
  const tokens = context.tokens ?? 0
  if (tokens < cfg.minTokens) return

  if ((await isRefreshOn($)) && rt.refreshes < cfg.maxRefresh) {
    // 刷新用最便宜的 fork（只回 OK）讀一次快取；整理是另一個不帶歷史的請求，有新對話才跑
    const r = await forkWithin($, '只回覆 OK', HANDOFF_TIMEOUT_MS)
    if (await isDistillOn($)) await distill($, t().distill.why.idle)
    rt.refreshes += 1
    $.ui.log(r.isAnswered
      ? t().idle.refresh(rt.refreshes, cfg.maxRefresh, r.usage.cache_read_input_tokens, r.usage.cache_creation_input_tokens)
      : t().idle.refreshFailed(rt.refreshes, cfg.maxRefresh, r.reason))
    await schedule($)
    return
  }

  rt.busy = true
  try {
    if (await isDistillOn($)) await distill($, t().distill.why.away)
    const handoff = await makeHandoff($, 'away', tokens)
    if (handoff === undefined) return
    const key = awayKey(await $.session.id())
    await $.store.set(key, { handoff } satisfies Away)
    await touchSeen($, key)
    $.ui.log(t().idle.awaySavedLog(tokens))
    $.ui.toast(t().idle.awaySavedToast)
  } finally {
    rt.busy = false
  }
}

// 在場交接開始：同步設好旗標，之後的使用者訊息先攔下
function beginPresent() {
  rt.busy = true
  rt.presenting = true
  rt.held = []
  rt.presentStartedAt = undefined
  rt.idle?.cancel()
  rt.idle = undefined
}

async function present($: EngineInterface, tokens: number | null, kind: 'present' | 'manual', note?: string) {
  const startedAt = await $.clock.now()
  rt.presentStartedAt = startedAt
  const sid = await $.session.id()
  // rt.held 已處理到第幾則：之前的已包進送出的文字，或已另外送出
  let delivered = 0
  const drain = async (send: (batch: string) => Promise<void>) => {
    while (rt.held.length > delivered) {
      const batch = rt.held.slice(delivered).join('\n\n')
      delivered = rt.held.length
      await send(batch)
    }
  }
  const resubmit = async (batch: string) => {
    try { await submitText($, batch) } catch (err) { $.ui.log(t().handoff.resubmitFailed(String(err))) }
  }
  try {
    // 交接 fork 和 /clear 前的最後整理同時發出：快取都熱著
    const lastDistill = isDistillOn($).then(on => on ? distill($, t().distill.why.before, false) : undefined).catch(() => undefined)
    const handoff = await makeHandoff($, kind, tokens)
    if (handoff === undefined) { await drain(resubmit); return }
    // 整理一開始就讀好對話片段：從交接開始最多等 DISTILL_GRACE_MS 就 /clear，
    // 整理在背景跑完照樣寫檔（它不排入差異）
    const left = startedAt + DISTILL_GRACE_MS - (await $.clock.now())
    if (left > 0) await within($, lastDistill, left, undefined)
    const why = kind === 'manual' ? t().handoff.whyManual : t().handoff.whyTokens(tokens ?? 0)
    const included = [...rt.held]
    delivered = included.length
    const intro = `${tag} ${included.length === 0 ? t().handoff.intro(why) : t().handoff.introHeld(why)}`
    const text = `${intro}${note ? t().handoff.note(note) : ''}\n\n${handoff}${included.length ? `\n\n${heldBlock(included)}` : ''}`
    const failed = await clearAndSubmit($, text)
    if (failed?.stage === 'clear') {
      $.ui.log(t().handoff.clearFailedLog(failed.reason))
      await recordFailure($, kind, tokens, t().handoff.reasonClear(failed.reason), sid)
      delivered = 0
      await drain(resubmit)
    } else if (failed) {
      $.ui.log(t().handoff.submitFailedLog(failed.reason))
      $.ui.toast(t().handoff.submitFailedToast)
      await recordFailure($, kind, tokens, t().handoff.reasonSubmit(failed.reason), sid)
      // 文字建好之後才到的訊息：補進這份 pendingSubmit，重送時一起送
      let pending = text
      await drain(async batch => {
        pending += included.length === 0 && pending === text ? `\n\n${heldBlock([batch])}` : `\n\n${batch}`
        await $.store.set(pendingKey(sid), pending)
      })
    } else {
      rt.retryAfter = undefined
      rt.refreshes = 0
      // 文字建好之後才到的訊息：接在 handoff 那一輪之後送出
      await drain(resubmit)
    }
  } catch (err) {
    $.ui.log(t().handoff.failedAll(String(err)))
    try {
      await recordFailure($, kind, tokens, t().handoff.reasonException(String(err)), sid)
      delivered = 0
      await drain(resubmit)
    } catch (err2) {
      $.ui.log(t().handoff.failedCleanup(String(err2)))
    }
  } finally {
    rt.presenting = false
    rt.held = []
    rt.busy = false
  }
}

// classic.Stop：每次主對話停下來時判斷要不要交接。快照裡有背景工作與排程，
// 背景工作和一次性排程會再叫醒這個 session，先不 /clear；循環排程不算
async function onStop($: EngineInterface, e: { agent_id?: string; background_tasks?: { status: string }[]; session_crons?: { recurring: boolean }[] }) {
  if (e.agent_id !== undefined) return
  const tasks = (e.background_tasks ?? []).filter(t => !STOPPED.has(t.status)).length
  const crons = e.session_crons ?? []
  const oneShot = crons.filter(c => !c.recurring).length
  rt.snapshot = { tasks, oneShot, recurring: crons.length - oneShot }
  if (rt.busy) return
  const { context } = await $.session.usage()
  const tokens = context.tokens
  const threshold = thresholdOf(context.window)
  if (tokens === undefined || tokens < threshold) {
    rt.deferral = undefined
    rt.deferToasted = false
    return
  }
  const agents = (await $.agent.list()).filter(a => a.status === 'running').length
  const parts = [tasks && t().stop.tasks(tasks), oneShot && t().stop.oneShot(oneShot), agents && t().stop.agents(agents)].filter(Boolean)
  const partsText = parts.join(t().list)
  let note: string | undefined
  if (parts.length > 0) {
    const cap = Math.min(Math.floor(context.window * DEFER_CAP_RATIO), threshold + DEFER_CAP_EXTRA)
    if (tokens < cap) {
      rt.deferral = t().stop.deferral(partsText, cap)
      $.ui.status(t().status.deferred(partsText))
      $.ui.log(t().stop.deferLog(tokens, partsText))
      if (!rt.deferToasted) { rt.deferToasted = true; $.ui.toast(t().status.deferred(partsText)) }
      return
    }
    note = t().stop.note(partsText, cap)
    $.ui.log(t().stop.capLog(tokens, cap, partsText))
  }
  // 上次失敗不久：先不重試
  if (rt.retryAfter && (await $.session.turns()) - rt.retryAfter.turns < RETRY_TURNS && (await $.clock.now()) - rt.retryAfter.at < RETRY_MS) {
    $.ui.log(t().stop.retryLog(tokens))
    return
  }
  rt.deferral = undefined
  rt.deferToasted = false
  $.ui.status(undefined)
  beginPresent()
  $.clock.after(0, () => void present($, tokens, 'present', note))
}

// 設定與介面語言：第一次用到時讀一次就記住（熱重載會重算）。每個 hook 一進來先等它，之後 cfg、t() 同步取用
const initLang = ($: EngineInterface) =>
  (rt.langReady ??= loadConfig($).then(() => detectLang($)).then(setLang, () => setLang('en')))

async function detectLang($: EngineInterface): Promise<Lang> {
  if (cfg.language !== 'auto') return cfg.language
  let setting: unknown
  try { setting = (await $.settings.read()).language } catch {}
  let locale: string | undefined
  try { locale = Intl.DateTimeFormat().resolvedOptions().locale } catch {}
  return pickLang(setting, locale)
}

async function prune($: EngineInterface) {
  const now = await $.clock.now()
  const seen = ((await $.store.get('seen')) as Record<string, number> | undefined) ?? {}
  const { changed, expired } = pruneSeen(await $.store.keys(), seen, now)
  for (const k of expired) await $.store.delete(k)
  if (changed) await $.store.set('seen', seen)
}

// ---------- 守門：狀態與流程（型別、提示、比對在 guards.ts） ----------
// 模型只提草稿（proposed），使用者 /handoff guard on N 核准才生效；依工作區存在 $.store，不進經驗檔
// 每次工具呼叫都會用到：工作區在 process 內不變，算一次就記住（熱重載會重算）
const guardsKey = async ($: EngineInterface) => (rt.guardsKeyCache ??= `guards:${await projectKey($)}`)
async function loadGuards($: EngineInterface) {
  return ((await $.store.get(await guardsKey($))) as Guard[] | undefined) ?? []
}

async function guardCandidates($: EngineInterface) {
  const guards = await loadGuards($)
  const notes = parseNotes(await readText($, await notesFile($)))
  return guardCandidatesOf(notes.rules, guards)
}

async function suggestGuards($: EngineInterface) {
  const candidates = await guardCandidates($)
  if (candidates.length === 0) return { text: `${t().guard.noCandidates(GUARD_MIN_COUNT)}\n${await guardList($)}` }
  const rows = (await $.session.messages()) as readonly Row[]
  const calls = rows.flatMap(r => r.toolUses)
  const r = await $.model.complete({
    model: cfg.notesModel,
    effort: DISTILL_EFFORT,
    maxTokens: GUARD_MAX_TOKENS,
    timeoutMs: DISTILL_TIMEOUT_MS,
    system: guardPrompt(candidates, [...new Set(calls.map(c => c.tool))]),
    prompt: '依系統指示輸出 ACTIONS。',
  })
  if (!r.isAnswered) return { text: `${t().guard.suggestFailed(r.reason)}` }
  const { out, rejected } = parseGuards(r.text, new Set(candidates.map(c => c.name)))
  const guards = await loadGuards($)
  const added = withProposals(out, guards, calls, await $.clock.now())
  await $.store.set(await guardsKey($), [...guards, ...added])
  return {
    text: [
      `${t().guard.suggested(candidates.length, added.length)}`,
      ...(rejected.length ? [`${t().ind}${t().guard.droppedLines(rejected.length, rejected.join(t().slashList))}`] : []),
      '',
      await guardList($),
    ].join('\n'),
  }
}

const guardList = async ($: EngineInterface) => guardListText(await loadGuards($))

async function guardCommand($: EngineInterface, args: string[]) {
  const [action = '', idText = '', modeText = ''] = args
  if (action === '') return { text: await guardList($) }
  if (action === 'suggest') return suggestGuards($)
  const usage = `${t().guard.usage}`
  const change = guardChangeOf(action, modeText)
  if (change === undefined || !idText) return { text: usage }
  const g = await changeGuard($, Number(idText), change)
  if (!g) return { text: `${t().guard.missing(idText)}\n${await guardList($)}` }
  return { text: `${t().guard.changed(g.id, change === 'drop')}\n${await guardList($)}` }
}

// 啟用／停用／刪除／換模式；回傳改到的那一條，找不到回 undefined
async function changeGuard($: EngineInterface, id: number, change: 'on' | 'off' | 'drop' | GuardMode) {
  const r = applyGuardChange(await loadGuards($), id, change)
  if (!r) return undefined
  await $.store.set(await guardsKey($), r.updated)
  return r.g
}

// /handoff panel：開或關輸入框上方的面板（再打一次就關）
async function togglePanel($: EngineInterface) {
  const open = !(await read($, panelUi)).open
  // 先備好資料再打開，畫面一出來就有內容
  if (open) {
    const data = await loadPanelData($)
    await update($, panelData, () => data)
  }
  await update($, panelUi, u => ({ open, tab: u.tab, expanded: u.expanded, suggesting: u.suggesting }))
  return {
    text: `${open ? t().panelCmd.opened : t().panelCmd.closed}`,
  }
}

async function guardSummary($: EngineInterface) {
  return guardSummaryText(await loadGuards($), (await guardCandidates($)).length)
}

async function recordHit($: EngineInterface, id: number) {
  const guards = await loadGuards($)
  await $.store.set(await guardsKey($), guards.map(g => (g.id === id ? { ...g, hits: g.hits + 1 } : g)))
  await refreshPanel($)
}

// ---------- 面板：/handoff panel，看最近整理的變動、刪掉記錯的筆記、核准守門 ----------
// 畫在輸入框上方（AbovePrompt），不用 Pane：終端機全螢幕版面的 Pane 一定停靠在側邊
// 畫面只讀 $.state 裡的快照：重畫不碰檔案與 store，按鈕不會等 I/O 才有反應
const panelUi = atom({ plugin: 'ctx-handoff', key: 'panelUi' } as const, { open: false, tab: 'guard', expanded: [], suggesting: false })
const panelData = atom({ plugin: 'ctx-handoff', key: 'panelData' } as const, null)

async function loadPanelData($: EngineInterface): Promise<PanelData> {
  const file = await notesFile($)
  const notes = parseNotes(await readText($, file))
  const guards = await loadGuards($)
  const d = (await $.store.get(`distill:last:${await projectKey($)}`)) as DistillLast | undefined
  return panelSnapshot(file, notes, guards, d, localStamp(await $.clock.now()).slice(0, 10), await settingRows($))
}

// 設定分頁的列：SETTINGS 的值加上兩個用指令也能切的開關（保持快取、專案筆記，存在 store 的 refresh／distill），依主題排
const SETTING_ORDER = ['threshold', 'window_ratio', 'refresh', 'idle_minutes', 'max_refresh', 'distill', 'min_tokens', 'notes_model', 'resume_hint', 'retry_nudge', 'done_check', 'reply_language', 'language']
const STORE_SWITCHES = new Set(['refresh', 'distill'])

async function settingRows($: EngineInterface): Promise<PanelSetting[]> {
  const { options, panel } = await readSettings($)
  const rows: PanelSetting[] = []
  for (const key of SETTING_ORDER) {
    if (STORE_SWITCHES.has(key)) {
      const stored = await $.store.get(key)
      rows.push({ key, kind: 'bool', value: stored !== false, source: stored === undefined ? 'default' : 'panel' })
      continue
    }
    const spec = specOf(key)
    if (!spec) continue
    const shown = key === 'reply_language' && cfg.replyLanguage === 'auto' ? (await replyTarget($)) ?? 'off'
      : key === 'language' && cfg.language === 'auto' ? getLang() : undefined
    rows.push({ key, kind: spec.kind, value: settingValue(spec, panel[key] ?? options[key]), source: settingSource(key, panel, options), ...(shown ? { shown } : {}) })
  }
  return rows
}

// 面板改一個設定：數字加減一格、開關反過來、選項往後輪；存進 store 後馬上重讀（其他 session 在下一則訊息重讀）
async function changeSetting($: EngineInterface, key: string, dir: 1 | -1) {
  const name = t().panel.settingName[key] ?? key
  if (STORE_SWITCHES.has(key)) {
    const on = (await $.store.get(key)) !== false
    await $.store.set(key, !on)
    if (key === 'distill') await showDistillStatus($)
    return t().panelCmd.settingSet(name, on ? t().panel.offValue : t().panel.on)
  }
  const spec = specOf(key)
  if (!spec) return t().panelCmd.notFound
  const { options, panel } = await readSettings($)
  const value = stepSetting(spec, panel[key] ?? options[key], dir)
  await $.store.set('settings', { ...panel, [key]: value })
  await reloadConfig($)
  return t().panelCmd.settingSet(name, showSetting(key, value))
}

// 還原：拿掉面板存的值，回到 settings.json 或預設
async function resetSetting($: EngineInterface, key: string) {
  const name = t().panel.settingName[key] ?? key
  if (STORE_SWITCHES.has(key)) {
    await $.store.delete(key)
    if (key === 'distill') await showDistillStatus($)
    return t().panelCmd.settingReset(name, t().panel.on)
  }
  const spec = specOf(key)
  if (!spec) return t().panelCmd.notFound
  const { options, panel } = await readSettings($)
  const { [key]: _drop, ...rest } = panel
  await $.store.set('settings', rest)
  await reloadConfig($)
  return t().panelCmd.settingReset(name, showSetting(key, settingValue(spec, options[key])))
}

// 面板開著才重算快照；失敗寫進提示列，不影響呼叫的地方
async function refreshPanel($: EngineInterface) {
  if (!(await read($, panelUi)).open) return
  try {
    const data = await loadPanelData($)
    await update($, panelData, () => data)
  } catch (err) {
    await setNote($, t().panelCmd.readFailed(String(err)))
  }
}

// 換掉提示列（undefined 清掉），順便清掉等待確認的刪除
const setNote = ($: EngineInterface, note: string | undefined) =>
  update($, panelUi, ({ confirming: _c, note: _n, ...u }) => (note ? { ...u, note } : u))

// 刪一條記憶（m:<原文>）或規則（r:<名稱>）：重讀經驗檔、比對原文，寫檔前把原檔備份到旁邊的 .ctx-handoff-backup/
// 封存的記憶按「留下」：加一筆今天的根據，等於人工證實一次（不刪內容，不用備份）
async function keepNote($: EngineInterface, head: string) {
  if (rt.distilling) return t().panelCmd.busyKeep
  const file = await notesFile($)
  const notes = parseNotes(await readText($, file))
  const m = notes.memory.find(x => memHead(x) === head)
  if (!m) return t().panelCmd.notFound
  const now = await $.clock.now()
  keepMemory(m, localStamp(now).slice(0, 10))
  await $.fs.write(file, renderNotes(notes, localStamp(now)))
  return t().panelCmd.kept(m.title)
}

async function dropNote($: EngineInterface, key: string) {
  if (rt.distilling) return t().panelCmd.busyDrop
  const file = await notesFile($)
  const original = await readText($, file)
  const notes = parseNotes(original)
  const removed = withoutNote(notes, key)
  if (!removed) return t().panelCmd.notFound
  const now = await $.clock.now()
  const dir = file.slice(0, file.lastIndexOf('/'))
  await $.fs.write(backupPath(dir, now), original)
  await $.fs.write(file, renderNotes(removed.updated, localStamp(now)))
  return t().panelCmd.deleted(key.startsWith('m:') ? 'm' : key.startsWith('p:') ? 'p' : 'r', removed.target, dir)
}

// ---------- 進度備忘：整理順手留下「停在哪」，下一段對話開頭提供一次（型別、文字在 progress.ts） ----------
// 依工作區存一份在 $.store（暫時性的，不進經驗檔）；同一工作區的多個 session 同時整理時，最後寫的那份為準
const progressKeyOf = async ($: EngineInterface) => progressKey(await projectKey($))
const loadProgress = async ($: EngineInterface) => (await $.store.get(await progressKeyOf($))) as Progress | undefined

// 已經交接出去的 session 之後才跑完的整理不存（handoff 摘要已涵蓋）
async function saveProgress($: EngineInterface, sid: string, p: ProgressFields, at: number) {
  if (rt.handed.has(sid)) return
  await $.store.set(await progressKeyOf($), { ...p, sid, at } satisfies Progress)
}

// 自動交接（/clear 之後把 handoff 送進新對話）：這個 session 的進度備忘不再提供；on=false 還原。
// 進度只是附帶的，失敗不影響交接
async function markHanded($: EngineInterface, sid: string, on: boolean) {
  try {
    if (on) rt.handed.add(sid)
    else rt.handed.delete(sid)
    const p = await loadProgress($)
    if (p?.sid !== sid) return
    const { handed: _h, ...rest } = p
    await $.store.set(await progressKeyOf($), on ? { ...rest, handed: true as const } : rest)
  } catch {}
}

// 這段對話開頭要提供的進度：不是這個 session 留下的、一天內、沒被 handoff 取代、還沒提供給這個 session
async function progressBlock($: EngineInterface) {
  if (!cfg.resumeHint) return undefined
  const p = await loadProgress($)
  const sid = await $.session.id()
  const text = progressOffer(p, sid, await $.clock.now())
  if (!text || !p) return undefined
  await $.store.set(await progressKeyOf($), withOffered(p, sid))
  return text
}

// ---------- 放進專案 ----------
const promoteKey = async ($: EngineInterface) => `promote:${await projectKey($)}`
const loadAsked = async ($: EngineInterface) => ((await $.store.get(await promoteKey($))) as Record<string, PromoteAsk> | undefined) ?? {}

// 這段對話開頭要交代的：session 啟動資料夾是 git repo 才交代
async function promoteBlock($: EngineInterface, notes: Notes) {
  if (rt.promoteTool === undefined) return undefined
  const root = slash(await $.session.root())
  if (!(await $.fs.exists(`${root}/.git`))) return undefined
  const asked = await loadAsked($)
  const now = await $.clock.now()
  const items = promoteItems(await loadGuards($), notes, asked, now)
  if (items.length === 0) return undefined
  markAsked(asked, items, now)
  await $.store.set(await promoteKey($), asked)
  return promoteText(items, rt.promoteTool)
}

// AI 回報放進 repo 的結果：記進經驗檔與守門，回給 AI 一段結果
async function markInProject($: EngineInterface, raw: unknown) {
  const file = await notesFile($)
  const notes = parseNotes(await readText($, file))
  const guards = await loadGuards($)
  const asked = await loadAsked($)
  const { done, failed, notesChanged, guardsChanged } = applyInProject(raw, notes, guards, asked)
  if (notesChanged) await $.fs.write(file, renderNotes(notes, localStamp(await $.clock.now())))
  if (guardsChanged) await $.store.set(await guardsKey($), guards)
  if (notesChanged || guardsChanged) await $.store.set(await promoteKey($), asked)
  await refreshPanel($)
  return promoteReport(done, failed)
}

function panelActions($: EngineInterface): PanelActions {
  // 讀寫檔的動作在背景跑（不讓按鍵等它），跑完重算快照、結果寫進提示列；只改畫面狀態的直接寫 $.state
  const run = (work: () => Promise<string | undefined>) => {
    void work()
      .catch(err => t().panelCmd.failed(String(err)))
      .then(async note => { await refreshPanel($); await setNote($, note) })
  }
  const setUi = (fn: (u: PanelUi) => PanelUi) => update($, panelUi, fn)
  return {
    guard: (id, action) => run(async () => {
      const g = await changeGuard($, id, action)
      return g ? t().guard.panelDone(id, action) : t().guard.missing(String(id))
    }),
    suggest: () => run(async () => {
      if ((await read($, panelUi)).suggesting) return undefined
      await setUi(u => ({ ...u, suggesting: true }))
      try { return (await suggestGuards($)).text.split('\n')[0]?.replace(``, '') }
      finally { await setUi(u => ({ ...u, suggesting: false })) }
    }),
    tab: tab => setUi(({ confirming: _c, note: _n, ...u }) => ({ ...u, tab })),
    toggle: key => setUi(u => ({ ...u, expanded: u.expanded.includes(key) ? u.expanded.filter(k => k !== key) : [...u.expanded, key] })),
    ask: key => setUi(({ confirming: _c, note: _n, ...u }) => (key ? { ...u, confirming: key } : u)),
    drop: key => run(() => dropNote($, key)),
    setting: (key, dir) => run(() => changeSetting($, key, dir)),
    resetSetting: key => run(() => resetSetting($, key)),
    keep: head => run(() => keepNote($, head)),
    close: () => setUi(u => ({ ...u, open: false })),
  }
}

// 工具呼叫結束後的觀察（不碰 $，失敗一律放行原結果，絕不丟例外、不擋呼叫）：
// A 同一個工具連續兩次因同樣原因失敗，在第 2 次的結果後面附一段提醒（context，模型看得到、使用者看不到）；
// B 記下這一輪的改檔與驗證，給回合結束時的檢查用；
// C 主對話上一步的說明不是目標語言（watchReply 排的），在這個結果後面附回覆語言提醒
function watchCall<R extends { deny?: string; isError?: boolean; text?: string; result?: unknown; context?: readonly string[] }>(
  e: { tool: string },
  r: R,
): R {
  try {
    if (r.deny !== undefined) return r
    const failed = r.isError === true
    const agent = (e as { agentId?: string }).agentId ?? ''
    // 只記主對話自己的呼叫：子代理（含還在背景跑的）改檔或驗證不算主對話這一輪（2026-10-08 實機誤判）
    if (cfg.doneCheck && agent === '') noteCall(rt.work, e.tool, e as Record<string, unknown>, failed)
    const extra: string[] = []
    if (cfg.retryNudge) {
      const text = r.text ?? (typeof r.result === 'string' ? r.result : undefined)
      const nudge = trackFailure(rt.streaks, `${agent}|${e.tool}`, e.tool, failed, text)
      if (nudge) extra.push(nudge)
    }
    // 回覆語言：主對話上一步的說明不是目標語言，這個工具結果帶出提醒（子代理的結果不帶）
    const reply = agent === '' ? takePending(rt.reply) : undefined
    if (reply) extra.push(reply)
    return extra.length ? { ...r, context: [...(r.context ?? []), ...extra] } : r
  } catch {
    return r
  }
}

// 回覆語言的目標：設定指定的語言；auto 跟著 Claude Code 的 language 設定，沒設或認不得就是 undefined（不提醒）。
// 算一次就記住，設定改了（config.set）或熱重載才重算
async function replyTarget($: EngineInterface) {
  if (rt.replyTarget) return rt.replyTarget.lang
  let setting: unknown
  if (cfg.replyLanguage === 'auto') {
    try { setting = (await $.settings.read()).language } catch { return undefined }
  }
  const lang = resolveReplyLang(cfg.replyLanguage, setting)
  rt.replyTarget = { lang }
  return lang
}

// turn.step 之後：主對話這一步的說明不是目標語言就排一次提醒（絕不丟例外、不改這一步的結果）。
// 這步還要呼叫工具，提醒跟著下一個工具結果（watchCall）；最終回答則跟著使用者的下一則訊息（prompt.submit）
async function watchReply($: EngineInterface, r: { answer: string; toolUses: readonly unknown[] }) {
  try {
    await initLang($)
    if (cfg.replyLanguage === 'off' || !r.answer) return
    const target = await replyTarget($)
    if (target) noteStep(rt.reply, r.answer, r.toolUses.length > 0, target)
  } catch {}
}

// 回合結束時說完成了，但這一輪改檔之後沒有跑任何測試或檢查：回傳要擋下停止的理由（每回合最多一次）。
// 紀錄用完就清；擋下的那次保留 reminded，之後同一回合的停止不再擋。使用者中斷的回合 Stop 不會觸發，
// 紀錄由 turn.complete（isAborted）與下一則人類訊息清掉
function doneReason(e: { stop_hook_active?: boolean; last_assistant_message?: string }): string | undefined {
  try {
    if (cfg.doneCheck) {
      const reason = doneCheck(rt.work, e.last_assistant_message, e.stop_hook_active === true)
      if (reason) return reason
    }
  } catch {}
  rt.work = freshWork()
  return undefined
}

export const register: Register = on => {
  resetRuntime()
  resetConfig()
  setLang('en')

  on('session.start', async ($, e, next) => {
    await initLang($)
    const description = t().start.description
    // 專案或使用者已有同名的 /handoff（例如自己的 skill）時，改用 /ctx-handoff
    try {
      await $.command.register({ name: 'handoff', description })
    } catch (err) {
      try {
        await $.command.register({ name: 'ctx-handoff', description })
        $.ui.log(t().start.taken(String(err)))
      } catch (err2) {
        $.ui.log(t().start.registerFailed(String(err2)))
      }
    }
    // 每次都註冊同一份定義：熱重載或重開 session（resume）時沒註冊，引擎會把工具撤掉（not_configured），
    // 工具清單反而變了，AI 也沒得回報。延後載入的 MCP 工具中途加入只多一筆可用提示，不動快取前綴
    try {
      rt.promoteTool = (await $.tool.register({ name: PROMOTE_TOOL, description: PROMOTE_DESCRIPTION, inputSchema: PROMOTE_SCHEMA })).tool
    } catch (err) {
      $.ui.log(t().start.toolFailed(String(err)))
    }
    try {
      await showDistillStatus($)
    } catch {}
    // 熱重載也會跑到這裡：接回被清掉的閒置計時
    try {
      await resumeSchedule($)
    } catch (err) {
      $.ui.log(t().start.resumeFailed(String(err)))
    }
    try {
      await prune($)
    } catch (err) {
      $.ui.log(t().start.pruneFailed(String(err)))
    }
    return next(e)
  })

  // 回覆語言提醒：只看主對話的步驟，不改請求（model、effort 原封不動往下傳，不影響快取）
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined) await watchReply($, r)
    return r
  })

  // 使用者在 /config 改了 Claude Code 的設定（例如 language）：回覆語言 auto 要重新解析
  on('config.set', async ($, e, next) => {
    const out = await next(e)
    if (out.deny === undefined) rt.replyTarget = undefined
    return out
  })

  // 每段新對話（含 /clear 之後）開頭帶入這個工作區的經驗；只在開頭一次，不影響之後的快取
  on('prompt.context', async ($, e, next) => {
    const out = await next(e)
    await initLang($)
    try {
      const file = await notesFile($)
      const notes = parseNotes(await readText($, file))
      const text = contextText(notes, file, localStamp(await $.clock.now()).slice(0, 10))
      const promote = await promoteBlock($, notes)
      // 進度備忘出錯不影響經驗與放進專案的交代
      const progress = await progressBlock($).catch(() => undefined)
      const blocks = [
        ...(text ? [{ name: 'ctxHandoffProject', text }] : []),
        ...(promote ? [{ name: 'ctxHandoffPromote', text: promote }] : []),
        ...(progress ? [{ name: 'ctxHandoffProgress', text: progress }] : []),
      ]
      return blocks.length ? { ...out, blocks: [...out.blocks, ...blocks] } : out
    } catch {
      return out
    }
  })

  // 守門：只有使用者核准（on）的才比對；hook 自己出錯時放行，不擋正常工作
  on('tool.call', async ($, e, next) => {
    if (rt.promoteTool !== undefined && e.tool === rt.promoteTool) {
      await initLang($)
      return { result: await markInProject($, (e as { items?: unknown }).items) }
    }
    let hit: Guard | undefined
    try {
      const text = inputText(e as Record<string, unknown>)
      hit = (await loadGuards($)).find(g => g.state === 'on' && guardHits(g, e.tool, text))
    } catch (err) {
      await initLang($)
      $.ui.log(t().guard.checkFailed(String(err)))
    }
    await initLang($)
    if (!hit) return watchCall(e, await next(e))
    await recordHit($, hit.id)
    const head = `${tag} ${t().guard.head(hit.id, hit.rule, hit.message)}`
    if (hit.mode === 'deny') {
      $.ui.toast(t().guard.denyToast(hit.id, e.tool, hit.rule))
      return { deny: `${head}\n${t().guard.denyHint(hit.id)}` }
    }
    const r = await next(e)
    return watchCall(e, r.deny === undefined ? { ...r, context: [...(r.context ?? []), head] } : r)
  })

  // 面板沒開、或問卷佔著輸入框上方時，交給下層（其他 plugin 或引擎自己的）
  // 只讀 $.state（讀了就訂閱，寫入時自動重畫），不讀檔
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await initLang($)
    const ui = await read($, panelUi)
    const data = ui.open && !e.props.hasSurvey ? await read($, panelData) : null
    return data
      ? panelTree($.ui.resolve(e), { ...data, ...ui, columns: e.props.bodyColumns }, panelActions($))
      : next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await initLang($)
    const out = await next(e)
    // 被中斷的回合沒有 Stop：清掉這一輪的改檔紀錄，免得算到下一輪
    if (e.agentId === undefined && e.isAborted) rt.work = freshWork()
    if (e.agentId !== undefined || rt.busy) return out
    // 別的 session 可能改了經驗檔或守門：每個回合結束重算一次面板快照（面板沒開時只讀一個 state）
    await refreshPanel($)
    // 主對話又往前走了：沒有被攔下訊息的離席 handoff 已經過時
    const away = (await $.store.get(awayKey(await $.session.id()))) as Away | undefined
    if (away !== undefined && away.held === undefined) {
      await $.store.delete(awayKey(await $.session.id()))
      $.ui.log(t().idle.outdated)
    }
    // 每個回合都用到快取，TTL 從這裡重算
    await schedule($)
    if (e.reason !== 'answer') return out
    const { context } = await $.session.usage()
    // 到門檻的交接由 classic.Stop 判斷；這裡只處理還沒到門檻的整理
    if (context.tokens !== undefined && context.tokens >= thresholdOf(context.window)) return out
    // 每 DISTILL_EVERY 則使用者訊息，趁快取熱整理一次
    if ((context.tokens ?? 0) >= cfg.minTokens && !rt.distilling && (await isDistillOn($)) && (await sinceDistill($)) >= DISTILL_EVERY) {
      $.clock.after(0, () => void distill($, t().distill.why.every(DISTILL_EVERY)))
    }
    if (!rt.distilling) await showDistillStatus($)
    return out
  })

  on('classic.Stop', async ($, e, next) => {
    await initLang($)
    const out = await next(e)
    // 別的 Stop hook 要求繼續：回合其實沒結束，等它真正停下的那次 Stop 再判斷
    if (out.block !== undefined) return out
    // 說完成了卻沒驗證：擋下這次停止，回合還沒結束，不判斷交接
    const reason = e.agent_id === undefined ? doneReason(e) : undefined
    if (reason !== undefined) {
      $.ui.log(t().loops.doneLog)
      return { ...out, block: reason }
    }
    try {
      await onStop($, e)
    } catch (err) {
      $.ui.log(t().stop.stopFailed(String(err)))
    }
    return out
  })

  on('prompt.submit', async ($, e, next) => {
    const isHuman = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isHuman) return next(e)
    await initLang($)
    try { await reloadConfig($) } catch {}
    const isSlash = e.text.trimStart().startsWith('/')
    // 交接進行中：訊息先攔下，建好的文字或交接後一起送進新對話
    const hasAttachments = (e.attachments?.length ?? 0) > 0
    if (rt.presenting && !isSlash && (e.text.trim() || hasAttachments)) {
      const elapsed = rt.presentStartedAt === undefined ? 0 : Math.round(((await $.clock.now()) - rt.presentStartedAt) / 1000)
      const wait = t().submit.wait(elapsed, Math.round(Math.max(HANDOFF_TIMEOUT_MS, DISTILL_GRACE_MS) / 60_000))
      // 只能暫存文字：mod 拿不到附件內容
      const attachNote = hasAttachments ? t().submit.attach : ''
      if (!e.text.trim()) return { drop: `${t().submit.busy(wait, attachNote)}` }
      // 以為卡住而重送：同樣的內容只送一次
      if (rt.held.some(h => h.trim() === e.text.trim())) {
        return { drop: `${t().submit.dup(wait, attachNote)}` }
      }
      rt.held.push(e.text)
      return { drop: `${t().submit.held(wait, attachNote)}` }
    }
    rt.idle?.cancel()
    rt.idle = undefined
    rt.refreshes = 0
    // 新的一輪從使用者的新訊息開始：改檔與驗證紀錄重算
    rt.work = freshWork()
    await update($, idleState, () => null)
    const sid = await $.session.id()
    // 背景整理的錨點：下次從這則訊息之後開始
    if (!isSlash && e.text.trim()) {
      await $.store.set(`last:${sid}`, anchorOf(e.text))
      await touchSeen($, `last:${sid}`)
    }
    if (rt.myPending && !rt.busy && !rt.pendingToasted) {
      rt.pendingToasted = true
      $.ui.toast(t().submit.pendingToast)
    }
    if (isSlash) return next(e)

    const key = awayKey(sid)
    const away = (await $.store.get(key)) as Away | undefined
    let msg = e
    if (away !== undefined) {
      if (away.held === undefined) {
        // 只有附件、沒有文字：沒有可以暫存的內容，先請使用者選擇
        if (!e.text.trim()) {
          return { drop: `${t().submit.awayAttach}` }
        }
        await $.store.set(key, { ...away, held: e.text } satisfies Away)
        return { drop: `${t().submit.awayHeld(hasAttachments)}` }
      }
      // 再送一次＝選擇繼續舊對話；文字不同就把先前攔下的那則一起帶上
      await $.store.delete(key)
      if (e.text !== away.held) msg = { ...e, text: `${away.held}\n\n${e.text}` }
    }
    // 背景整理的差異：只有訊息真的進了對話才帶入並清掉
    // 回覆語言提醒也一樣：上一則回答不是目標語言的話，跟著這則訊息帶入
    const pend = rt.pendingNotes.get(sid)
    const reply = peekNext(rt.reply)
    if (!pend && reply.length === 0) return next(msg)
    const r = await next({ ...msg, context: [...(msg.context ?? []), ...(pend ? [noteBlock(pend.changes, pend.file)] : []), ...reply] })
    if ((r as { drop?: string }).drop === undefined) {
      rt.pendingNotes.delete(sid)
      clearNext(rt.reply)
    }
    return r
  })

  // 只有一個指令 /handoff（被佔用時是 /ctx-handoff），用子指令區分；不帶參數就顯示狀態和用法
  for (const command of ['handoff', 'ctx-handoff']) on('command.run', { command }, async ($, e) => {
    await initLang($)
    const [sub = '', arg = '', ...rest] = e.args.trim().split(/\s+/)
    switch (sub) {
      case '': return { text: await status($) }
      case 'now': return handoffNow($)
      case 'dry': return handoffDry($)
      case 'distill': return distillCommand($, arg)
      case 'resume': return resume($)
      case 'continue': return keepOld($)
      case 'resend': return resend($)
      case 'refresh': return refreshCommand($, arg)
      case 'guard': {
        const r = await guardCommand($, [arg, ...rest])
        await refreshPanel($)
        return r
      }
      case 'panel': return togglePanel($)
      default: return { text: `${t().cmd.unknown(sub)}\n${usageText()}` }
    }
  })
}

async function status($: EngineInterface) {
  const { context } = await $.session.usage()
  const away = (await $.store.get(awayKey(await $.session.id()))) as Away | undefined
  const pk = await projectKey($)
  const list = ((await $.store.get(`handoffs:${pk}`)) as Saved[] | undefined) ?? []
  const herr = (await $.store.get(`handoff:error:${pk}`)) as HandoffError | undefined
  return statusText({
    tokens: context.tokens, window: context.window, refreshOn: await isRefreshOn($), away, last: list.at(-1), herr,
    distill: await distillStatus($), guards: await guardSummary($), progress: await progressStatus($), replyLang: await replyLangLabel($),
  })
}

// /handoff 狀態裡的回覆語言：auto 一併顯示解析出的結果
async function replyLangLabel($: EngineInterface) {
  if (cfg.replyLanguage !== 'auto') return cfg.replyLanguage
  return `auto → ${(await replyTarget($)) ?? 'off'}`
}

async function progressStatus($: EngineInterface) {
  const p = await loadProgress($)
  return p && t().progress.status(new Date(p.at).toLocaleString(), p.task, t().progress.states[p.state] ?? p.state, !cfg.resumeHint)
}

async function handoffNow($: EngineInterface) {
  if (rt.busy) return { text: `${t().cmd.busy}` }
  const { context } = await $.session.usage()
  const tokens = context.tokens ?? null
  beginPresent()
  $.clock.after(0, () => void present($, tokens, 'manual'))
  return { text: `${t().cmd.nowStarted}` }
}

async function handoffDry($: EngineInterface) {
  if (rt.busy) return { text: `${t().cmd.busy}` }
  const { context } = await $.session.usage()
  rt.busy = true
  try {
    const text = await makeHandoff($, 'dry', context.tokens ?? null)
    if (text === undefined) return { text: `${t().cmd.dryFailed}` }
    const list = ((await $.store.get(`handoffs:${await projectKey($)}`)) as Saved[] | undefined) ?? []
    const usage = list.at(-1)?.usage
    return {
      text: `${t().cmd.dryDone(String(context.tokens ?? '?'))}\n` +
        `${usage ? describeUsage(usage) : ''}\n\n${text}`,
    }
  } finally {
    rt.busy = false
  }
}

async function distillCommand($: EngineInterface, arg: string) {
  if (arg === 'on' || arg === 'off') {
    await $.store.set('distill', arg === 'on')
    await showDistillStatus($)
    return { text: t().cmd.distillSet(arg) }
  }
  if (arg !== '') return { text: `${t().cmd.distillUsage}` }
  if (rt.distilling) return { text: `${t().cmd.distilling}` }
  const r = await distill($, t().distill.why.manual)
  if (r === undefined || !r.isAnswered || rt.distillFailed) {
    return { text: `${t().cmd.distillNone}\n${await distillStatus($)}` }
  }
  return { text: `${t().cmd.distillDone}\n${await distillStatus($)}` }
}

async function refreshCommand($: EngineInterface, arg: string) {
  if (arg !== 'on' && arg !== 'off') return { text: `${t().cmd.refreshNow((await isRefreshOn($)) ? 'on' : 'off')}` }
  await $.store.set('refresh', arg === 'on')
  return { text: t().cmd.refreshSet(arg, cfg.idleMs / 60_000) }
}

async function resume($: EngineInterface) {
  const key = awayKey(await $.session.id())
  const away = (await $.store.get(key)) as Away | undefined
  if (away === undefined) return { text: `${t().cmd.noAway}` }
  await $.store.delete(key)
  const intro = `${tag} ${away.held === undefined ? t().cmd.resumeIntro : t().cmd.resumeIntroHeld}`
  const handoff = away.held === undefined ? away.handoff : `${away.handoff}\n\n${t().cmd.resumeHeld}\n${away.held}`
  rt.busy = true
  const sid = await $.session.id()
  $.clock.after(0, () => {
    void clearAndSubmit($, `${intro}

${handoff}`)
      .then(async failed => {
        if (!failed) return
        $.ui.log(t().cmd.resumeFailedLog(failed.reason))
        await recordFailure($, 'away', null, t().handoff.reasonStage(failed.stage, failed.reason), sid)
        // 還在舊對話：放回離席 handoff（連同攔下的訊息），可以再 /handoff resume 或 continue
        if (failed.stage === 'clear') {
          await $.store.set(key, away)
          $.ui.toast(t().cmd.resumeClearFailed)
        }
      })
      .catch(err => $.ui.log(t().cmd.resumeFailedLog(String(err))))
      .finally(() => { rt.busy = false })
  })
  return { text: `${t().cmd.resuming}` }
}

// 重新送出沒送達的 handoff：只用這個 process 自己的紀錄，不碰其他 session 的 pendingSubmit；不 /clear
async function resend($: EngineInterface) {
  let text: string | undefined
  let key: string | undefined
  if (rt.myPending) {
    key = pendingKey(rt.myPending.sid)
    const stored = await $.store.get(key)
    text = typeof stored === 'string' ? stored : undefined
  }
  if (text === undefined && rt.lastHandoff) {
    text = `${tag} ${t().cmd.resendIntro}

${rt.lastHandoff.text}`
  }
  if (text === undefined) return { text: `${t().cmd.nothingToResend}` }
  const body = text
  $.clock.after(0, () => {
    void submitText($, body)
      .then(async () => {
        if (key !== undefined) await $.store.delete(key)
        rt.myPending = undefined
      })
      .catch(err => $.ui.log(t().cmd.resendFailed(String(err))))
  })
  return { text: `${t().cmd.resending}` }
}

async function keepOld($: EngineInterface) {
  const key = awayKey(await $.session.id())
  const away = (await $.store.get(key)) as Away | undefined
  if (away === undefined) return { text: `${t().cmd.noAway}` }
  await $.store.delete(key)
  const msg = away.held
  if (msg === undefined) return { text: `${t().cmd.discarded}` }
  $.clock.after(0, () => void submitText($, msg).catch(err => $.ui.log(t().cmd.sendHeldFailed(String(err)))))
  return { text: `${t().cmd.discardedSend}` }
}
