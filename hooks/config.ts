// 使用者設定（userConfig）的型別、預設值、範圍檢查，以及固定參數（純函式，不碰 $；讀設定在 register.ts）
import type { Lang } from './i18n'

// 使用者設定：plugin.json 的 userConfig，值存在使用者自己 settings.json 的 pluginConfigs，更新 plugin 不會覆蓋。
// 這裡是預設值；第一次用到時讀，使用者在 /config 改了（config.set）再讀。兩個開關（保持快取、專案筆記）仍用指令存在 store
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
}
const CONFIG_DEFAULTS: Config = {
  threshold: 600_000, windowRatio: 0.8, idleMs: 55 * 60_000, maxRefresh: 3, minTokens: 30_000,
  notesModel: 'claude-sonnet-5-5', language: 'auto',
}
export const CONFIG_PREFIX = 'ctx-handoff.'
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

// 超出範圍的拉回範圍內，型別不對就用預設值。rows 是 /config 清單（有這一列時以它為準），
// changed：剛改、可能還沒寫進檔案的那一欄
export function resolveConfig(
  rows: readonly { key: string; value: unknown }[],
  options: Record<string, unknown>,
  changed?: { key: string; value: unknown },
): Config {
  const get = (field: string) =>
    changed?.key === CONFIG_PREFIX + field ? changed.value : rows.find(r => r.key === CONFIG_PREFIX + field)?.value ?? options[field]
  const num = (field: string, min: number, max: number, d: number) => {
    const v = get(field)
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
  }
  const d = CONFIG_DEFAULTS
  const model = get('notes_model')
  const lang = get('language')
  return {
    threshold: num('threshold', 50_000, 2_000_000, d.threshold),
    windowRatio: num('window_ratio', 0.3, 0.95, d.windowRatio),
    idleMs: num('idle_minutes', 5, 59, d.idleMs / 60_000) * 60_000,
    maxRefresh: Math.round(num('max_refresh', 0, 10, d.maxRefresh)),
    minTokens: num('min_tokens', 0, 500_000, d.minTokens),
    notesModel: typeof model === 'string' && model.trim() ? model.trim() : d.notesModel,
    language: lang === 'en' || lang === 'zh-TW' ? lang : 'auto',
  }
}
