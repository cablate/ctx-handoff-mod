// 兩個防呆提醒的純邏輯（不碰 $）：同樣的失敗連續兩次、說完成了卻沒驗證。
// 狀態放在 runtime.ts 的 rt（熱重載會清掉；清掉只是少一次提醒，可以接受）
import { tag } from './notes'

// ---------- A：同一個工具連續兩次因同樣原因失敗 ----------

export type Streak = { sig: string; count: number; nudged: boolean }

const MAX_SIG = 200
// 終端機顏色碼（用建構式寫，避免控制字元直接出現在樣式裡）
const ANSI = new RegExp(String.raw`${String.fromCharCode(27)}\[[0-9;]*[A-Za-z]`, 'g')
const MAX_STREAKS = 200
// 使用者自己中斷或拒絕的不是「工具失敗」，不提醒
const USER_STOP = /doesn't want to proceed|user rejected|interrupted by user|request interrupted|user denied/i

// 錯誤文字的簽名：去掉顏色碼、路徑、數字（行號、時間、id）與空白差異，取前 200 字
export function failureSignature(text: string | undefined): string {
  return (text ?? '')
    .replace(ANSI, '')
    .replace(/[A-Za-z]:[\\/][^\s'"`)>\]]*/g, '<p>')
    .replace(/(?:\.{0,2}\/)?(?:[\w.@~-]+\/)+[\w.@~-]*/g, '<p>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SIG)
}

// 給模型看的簡短錯誤：第一個非空行，最多 80 字
const briefOf = (text: string | undefined) => {
  const line = (text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

export const retryNudgeText = (tool: string, text: string | undefined) =>
  `${tag} 這個工具（${tool}）連續兩次因同樣原因失敗（${briefOf(text) || '沒有錯誤文字'}）。先找出原因並換一個做法，不要原樣重試。`

// 記下一次工具結果；第 2 次相同簽名的失敗回傳要附給模型的提醒（每段連續失敗只提醒一次）。
// key：呼叫的範圍＋工具名；成功就清掉這個工具的紀錄
export function trackFailure(streaks: Map<string, Streak>, key: string, tool: string, isError: boolean, text: string | undefined): string | undefined {
  if (!isError) { streaks.delete(key); return undefined }
  if (USER_STOP.test(text ?? '')) { streaks.delete(key); return undefined }
  const sig = failureSignature(text)
  const prev = streaks.get(key)
  if (!prev || prev.sig !== sig) {
    // 簽名換了就是新的一段；上限只防無限長大
    if (!prev && streaks.size >= MAX_STREAKS) streaks.clear()
    streaks.set(key, { sig, count: 1, nudged: false })
    return undefined
  }
  prev.count += 1
  if (prev.count < 2 || prev.nudged) return undefined
  prev.nudged = true
  return retryNudgeText(tool, text)
}

// ---------- B：說完成了，但改檔之後沒有任何驗證 ----------

// 這一輪的工作紀錄：seq 是已完成的工具呼叫序號；lastEdit／lastCheck 是最後一次改檔／驗證的序號（0＝沒有）
export type Work = { seq: number; lastEdit: number; lastCheck: number; reminded: boolean }
export const freshWork = (): Work => ({ seq: 0, lastEdit: 0, lastCheck: 0, reminded: false })

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// 說明文件的修改不需要跑測試
const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i
// 這些指令只是看或搬東西，不算驗證
const NOT_RUNNING = new Set(['ls', 'cat', 'echo', 'grep', 'rg', 'find', 'head', 'tail', 'git', 'cd', 'mkdir', 'rm', 'cp', 'mv', 'sed', 'awk', 'type', 'wc', 'diff', 'open', 'pwd', 'which', 'printf'])
const CHECK_WORDS = /\b(tests?|pytest|unittest|jest|vitest|mocha|rspec|phpunit|tsc|typecheck|lint|eslint|biome|ruff|mypy|pyright|flake8|clippy|check|build|compile|verify|validate|vet)\b/i

// 這個 Bash／PowerShell 指令看起來是在跑測試、檢查或建置（任何一段指令符合就算）
export function isCheckCommand(command: string | undefined): boolean {
  return (command ?? '').split(/&&|\|\||;|\||\n/).some(seg => {
    const words = seg.trim().split(/\s+/)
    const first = (words[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase()
    return first !== '' && !NOT_RUNNING.has(first) && CHECK_WORDS.test(seg)
  })
}

type CallInput = Record<string, unknown>

// 記下一個「已經執行完」的工具呼叫。failed：工具回報錯誤（改檔失敗不算改檔；測試跑失敗仍算跑過）
export function noteCall(work: Work, tool: string, input: CallInput, failed: boolean) {
  work.seq += 1
  if (EDIT_TOOLS.has(tool)) {
    if (failed) return
    const file = [input.file_path, input.notebook_path, input.path].find((p): p is string => typeof p === 'string')
    if (file && DOC_FILE.test(file)) return
    work.lastEdit = work.seq
  } else if ((tool === 'Bash' || tool === 'PowerShell') && typeof input.command === 'string' && isCheckCommand(input.command)) {
    work.lastCheck = work.seq
  }
}

// 「完成了」的說法：只看開頭與結尾，排除否定（未／沒／不／尚）與提問
const CLAIM = /(?<![未沒不尚])(完成了|已完成|已經完成|做好了|都好了|已修好|修好了|已經修好|搞定了?|全部完成|都處理好了)|\b(all done|all set|i(?:'ve| have) (?:finished|completed|fixed)|(?:is|are|now|it's) (?:done|fixed|complete(?:d)?|finished)|fixed it|everything (?:is )?(?:done|working|fixed))\b/i
// 已經誠實說明沒驗證的，不再提醒
const HONEST = /沒有?(?:跑|執行|做)?(?:驗證|測試|檢查)|未(?:經)?(?:驗證|測試)|無法(?:驗證|測試)|沒辦法(?:驗證|測試)|not (?:been )?(?:tested|verified)|couldn't (?:run|verify|test)|could not (?:run|verify|test)|unable to (?:run|verify|test)|haven't (?:run|tested|verified)/i

export function claimsDone(message: string | undefined): boolean {
  const text = (message ?? '').trim()
  if (!text || /[?？]$/.test(text)) return false
  const ends = text.length <= 600 ? text : `${text.slice(0, 200)}\n${text.slice(-400)}`
  return CLAIM.test(ends) && !HONEST.test(ends)
}

export const doneCheckText = () =>
  `${tag} 你說完成了，但這一輪改了檔案之後沒有跑任何測試或檢查。請跑相關的驗證並附上結果；如果沒辦法驗證，改口說明哪些沒驗證。`

// 回合結束時要不要擋下停止、請模型先驗證。每個回合最多一次；stopHookActive＝這次停止已經被別的 hook 擋過一次
export function doneCheck(work: Work, message: string | undefined, stopHookActive: boolean): string | undefined {
  if (work.reminded || stopHookActive) return undefined
  if (work.lastEdit === 0 || work.lastCheck > work.lastEdit) return undefined
  if (!claimsDone(message)) return undefined
  work.reminded = true
  return doneCheckText()
}
