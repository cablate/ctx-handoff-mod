// 交接的提示與文字（純函式，不碰 $；產生交接與送出在 register.ts）
import { t } from './i18n'

export const HANDOFF_PROMPT = [
  '為接手這段工作的新對話寫一份 handoff，第一行寫「HANDOFF:」加一句話的目標，全文不超過 1500 字。',
  '依序寫：1. 目標 2. 目前狀態（已完成／進行中） 3. 已做的決定與理由 4. 相關檔案路徑與指令 5. 下一步 6. 待使用者回答的問題。',
  '只寫接手需要的事實，沒有的項目寫「無」，不要寒暄。',
  '用使用者在對話裡使用的語言撰寫；程式碼、指令、路徑與錯誤訊息維持原文。',
].join('\n')

// fork 失敗的原因；nothing-to-fork 多半是剛重新啟動（含自動更新）或剛 /clear，主對話回應一次就能用
export function forkFailure(reason: string) {
  if (reason === 'timeout') return t().fork.timeout
  return reason === 'nothing-to-fork' ? t().fork.nothingToFork : reason
}

export const heldBlock = (items: string[]) => `${t().handoff.heldHead}\n${items.join('\n\n')}`
