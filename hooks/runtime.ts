// 這個 process 內 register.ts 用的可變狀態（熱重載會清掉；要接得上的放 $.state）。集中成一個物件，不碰 $
import type { Timer } from 'claude-code'
import type { Change } from './notes'
import { freshWork } from './loops'
import type { Streak, Work } from './loops'
import { freshReply } from './lang'
import type { ReplyLang, ReplyState } from './lang'

export const rt = {
  idle: undefined as Timer | undefined,
  refreshes: 0,
  // 互斥：同一時間只處理一個 handoff（不攔訊息）
  busy: false,
  // 在場交接進行中（門檻或 /handoff now）：使用者訊息先攔下，交接後一併送出
  presenting: false,
  held: [] as string[],
  // 這次在場交接開始的時間（undefined＝還沒開始計時），給攔訊息的提示與等整理的上限用
  presentStartedAt: undefined as number | undefined,
  // 背景整理的差異：依 session id 暫存，跟著下一則真正送進對話的訊息帶入
  pendingNotes: new Map<string, { changes: Change[]; file: string }>(),
  // 這個 process 送出失敗、尚未送達的 handoff（舊 session id）
  myPending: undefined as { sid: string } | undefined,
  pendingToasted: false,
  // 這個 process 最近產生的 handoff，/handoff resend 沒有未送達紀錄時用
  lastHandoff: undefined as { text: string } | undefined,
  retryAfter: undefined as { turns: number; at: number } | undefined,
  // classic.Stop 的最近快照；deferral 是目前延後 handoff 的原因
  snapshot: undefined as { tasks: number; oneShot: number; recurring: number } | undefined,
  deferral: undefined as string | undefined,
  deferToasted: false,
  seenKnown: new Set<string>(),
  distilling: false,
  // 正在跑的整理結束時 resolve：交接前整理撞上它時排在它之後
  distillDone: undefined as Promise<void> | undefined,
  // 統計寫入排隊（writeStat 不丟例外，鏈不會斷）
  statQueue: Promise.resolve() as Promise<void>,
  // 上一次整理有沒有失敗（有回答但沒套用也算），給 /handoff distill 判斷
  distillFailed: false,
  // 放進專案的工具完整名稱（mcp__<plugin>__<name>），以註冊結果為準；這個 process 沒註冊就是 undefined
  // 守門的 store 鍵：工作區在 process 內不變，算一次就記住（熱重載會重算）
  guardsKeyCache: undefined as string | undefined,
  // 設定與介面語言：第一次用到時讀一次就記住（熱重載會重算）
  langReady: undefined as Promise<void> | undefined,
  // 防呆提醒：各工具最近一段連續失敗，與這一輪的改檔／驗證紀錄。熱重載會清掉，清掉只是少一次提醒
  streaks: new Map<string, Streak>(),
  work: freshWork() as Work,
  // 回覆語言提醒：目標語言快取（undefined＝還沒算；{ lang: undefined }＝不提醒）與提醒進度。熱重載會清掉，清掉只是少一次提醒
  replyTarget: undefined as { lang: ReplyLang | undefined } | undefined,
  reply: freshReply() as ReplyState,
  // 已經用 handoff 交接出去的 session（熱重載會清掉）：它的進度備忘不再提供，之後才寫完的整理也不存
  handed: new Set<string>(),
}

// 重設程序內狀態（模組重新載入或測試重跑時）；distilling、distillFailed、presentStartedAt 沿用原本不重設的行為
export function resetRuntime() {
  rt.idle?.cancel()
  rt.idle = undefined
  rt.refreshes = 0
  rt.busy = false
  rt.presenting = false
  rt.held = []
  rt.pendingNotes.clear()
  rt.myPending = undefined
  rt.pendingToasted = false
  rt.lastHandoff = undefined
  rt.retryAfter = undefined
  rt.snapshot = undefined
  rt.deferral = undefined
  rt.deferToasted = false
  rt.seenKnown.clear()
  rt.guardsKeyCache = undefined
  rt.langReady = undefined
  rt.streaks.clear()
  rt.work = freshWork()
  rt.replyTarget = undefined
  rt.reply = freshReply()
  rt.handed.clear()
}
