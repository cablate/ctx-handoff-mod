// 使用者設定的型別、預設值、範圍檢查，以及固定參數（純函式，不碰 $；讀設定在 register.ts）
import type { Lang } from './i18n'
import { REPLY_LANG_SETTINGS } from './lang'
import type { ReplyLangSetting } from './lang'

// 使用者設定：在面板「設定」分頁調整，存在 $.store 的 settings（所有工作區共用）；
// settings.json 的 pluginConfigs["ctx-handoff@<marketplace>"].options 寫了也讀，面板的值優先。
// 不宣告 userConfig：/config 一列一個設定會越來越長（維護者 2026-10-08 決定）。第一次用到、送出新訊息、面板改值時重讀
type Config = {
  // 在場 handoff：context 達 min(threshold, 視窗 × windowRatio) 時產生 handoff → /clear → 送出
  threshold: number; windowRatio: number
  // 1 小時快取：最後一次用到快取後 idleMs 刷新，最多 maxRefresh 次，之後改產生離席 handoff
  idleMs: number; maxRefresh: number
  // 太小的 context 重建很便宜，不值得刷新、產生離席 handoff 或整理
  minTokens: number
  // 背景整理用的模型：不帶歷史的單次請求，只送上次整理之後的新對話（最低 Sonnet 5.5）
  notesModel: string
  // 介面語言（狀態列、toast、紀錄、指令回覆、面板）：auto 先看 Claude Code 的 language 設定，沒設就看系統語系
  language: 'auto' | Lang
  // 防呆提醒：同樣的失敗連續兩次就提醒換做法；說完成了卻沒驗證就擋一次
  retryNudge: boolean; doneCheck: boolean
  // 回覆語言提醒：Claude 的說明不是這個語言時，在工具結果或下一則訊息提醒一次（auto 跟著 Claude Code 的 language 設定）
  replyLanguage: ReplyLangSetting
  // 新對話開頭提供上一段對話停在哪（背景整理留下的進度備忘）
  resumeHint: boolean
}

// 每個設定的型別與範圍：讀值時檢查、面板照它畫列與調整（數字每按一下加減 step，選項依序輪）
export type SettingSpec =
  | { key: string; kind: 'num'; min: number; max: number; step: number; d: number }
  | { key: string; kind: 'bool'; d: boolean }
  | { key: string; kind: 'choice'; options: readonly string[]; d: string; free?: boolean }
export const SETTINGS: readonly SettingSpec[] = [
  { key: 'threshold', kind: 'num', min: 50_000, max: 2_000_000, step: 50_000, d: 600_000 },
  { key: 'window_ratio', kind: 'num', min: 0.3, max: 0.95, step: 0.05, d: 0.8 },
  { key: 'idle_minutes', kind: 'num', min: 5, max: 59, step: 5, d: 55 },
  { key: 'max_refresh', kind: 'num', min: 0, max: 10, step: 1, d: 3 },
  { key: 'min_tokens', kind: 'num', min: 0, max: 500_000, step: 10_000, d: 30_000 },
  // free：settings.json 可以寫清單外的模型名稱；面板只在清單裡輪
  { key: 'notes_model', kind: 'choice', options: ['claude-sonnet-5-5', 'claude-opus-5-5'], d: 'claude-sonnet-5-5', free: true },
  { key: 'language', kind: 'choice', options: ['auto', 'zh-TW', 'en'], d: 'auto' },
  { key: 'reply_language', kind: 'choice', options: REPLY_LANG_SETTINGS, d: 'auto' },
  { key: 'retry_nudge', kind: 'bool', d: true },
  { key: 'done_check', kind: 'bool', d: true },
  { key: 'resume_hint', kind: 'bool', d: true },
]
export const specOf = (key: string) => SETTINGS.find(s => s.key === key)

// 檢查一個值：超出範圍的拉回範圍內，型別不對或不在選項裡就用預設值
export function settingValue(spec: SettingSpec, v: unknown): number | boolean | string {
  if (spec.kind === 'num') return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : spec.d
  if (spec.kind === 'bool') return typeof v === 'boolean' ? v : spec.d
  if (spec.free) return typeof v === 'string' && v.trim() ? v.trim() : spec.d
  return typeof v === 'string' && spec.options.includes(v) ? v : spec.d
}

// 面板按一下的下一個值：數字加減一個 step（去掉浮點誤差），開關反過來，選項往後輪（清單外的值從第一個開始）
export function stepSetting(spec: SettingSpec, now: unknown, dir: 1 | -1) {
  const v = settingValue(spec, now)
  if (spec.kind === 'num') return settingValue(spec, Math.round(((v as number) + dir * spec.step) * 100) / 100)
  if (spec.kind === 'bool') return !v
  const i = spec.options.indexOf(v as string)
  return spec.options[(i + dir + spec.options.length) % spec.options.length] as string
}

// 值從哪來：面板（store）、settings.json，或都沒設用預設
export const settingSource = (key: string, panel: Record<string, unknown>, options: Record<string, unknown>) =>
  panel[key] !== undefined ? 'panel' : options[key] !== undefined ? 'file' : 'default'

const CONFIG_DEFAULTS: Config = {
  threshold: 600_000, windowRatio: 0.8, idleMs: 55 * 60_000, maxRefresh: 3, minTokens: 30_000,
  notesModel: 'claude-sonnet-5-5', language: 'auto', retryNudge: true, doneCheck: true, replyLanguage: 'auto', resumeHint: true,
}
// 目前的設定：只改欄位、不換物件，各檔 import 到的是同一份
export const cfg: Config = { ...CONFIG_DEFAULTS }
export const resetConfig = () => { Object.assign(cfg, CONFIG_DEFAULTS) }

export const KEEP = 5
// fork 沒有取消參數：超過時限就不再等（交接放棄、攔下的訊息送回舊對話），它在背景跑完也不採用
export const HANDOFF_TIMEOUT_MS = 3 * 60_000
export const DISTILL_TIMEOUT_MS = 8 * 60_000
// 交接前整理和 handoff 同時發出；整理一開始就讀好對話片段，之後不依賴這段對話，
// 所以只等它讀完片段（幾秒）就 /clear，請求留在背景跑完
export const DISTILL_GRACE_MS = 5_000
export const DISTILL_EFFORT = 'low'
export const DISTILL_MAX_TOKENS = 32_000
export const GUARD_MAX_TOKENS = 4_000
// 背景整理（閒置刷新、離席、交接前、每 N 則）：把上次整理之後的對話片段和現有經驗交給小模型比對，
// 輸出新增／更新／刪除／確認，由程式寫回這個工作區的一份 md；之後帶入對話，越用越聰明
export const DISTILL_EVERY = 30
// 門檻 handoff 失敗後，至少再 3 則使用者訊息或 10 分鐘才重試
export const RETRY_TURNS = 3
export const RETRY_MS = 10 * 60_000
// 背景工作或一次性排程還在時延後 handoff；超過這個上限就照樣交接
export const DEFER_CAP_EXTRA = 150_000
export const DEFER_CAP_RATIO = 0.9
export const STOPPED = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled', 'canceled', 'error'])
// 熱重載時已過期多久還補刷新：超過就當快取已失效（TTL 60 分、刷新排在 55 分）
export const RELOAD_GRACE_MS = 5 * 60_000

export const thresholdOf = (window: number) => Math.min(cfg.threshold, Math.floor(window * cfg.windowRatio))

// settings.json 的 pluginConfigs 裡本 plugin 的 options（key 是 "ctx-handoff@<marketplace>"）
export function optionsOf(all: Record<string, { options?: Record<string, unknown> }> | undefined) {
  const id = Object.keys(all ?? {}).find(k => k.startsWith('ctx-handoff@'))
  return (id && all?.[id]?.options) || {}
}

// 面板存的值優先，其次 settings.json，每個值都照 SETTINGS 檢查
export function resolveConfig(options: Record<string, unknown>, panel: Record<string, unknown> = {}): Config {
  const get = (key: string) => {
    const spec = specOf(key)
    if (!spec) throw new Error(`unknown setting ${key}`)
    return settingValue(spec, panel[key] ?? options[key])
  }
  return {
    threshold: get('threshold') as number,
    windowRatio: get('window_ratio') as number,
    idleMs: (get('idle_minutes') as number) * 60_000,
    maxRefresh: Math.round(get('max_refresh') as number),
    minTokens: get('min_tokens') as number,
    notesModel: get('notes_model') as string,
    language: get('language') as Config['language'],
    retryNudge: get('retry_nudge') as boolean,
    doneCheck: get('done_check') as boolean,
    replyLanguage: get('reply_language') as ReplyLangSetting,
    resumeHint: get('resume_hint') as boolean,
  }
}
