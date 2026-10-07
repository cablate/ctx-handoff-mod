// 交接的提示與文字（純函式，不碰 $；產生交接與送出在 register.ts）
import { t } from './i18n'

// 段落依接手最容易出錯的地方排：把沒驗證的當成做完、重試失敗過的做法、不知道有東西在跑、忘了使用者這次的限制
export const HANDOFF_PROMPT = [
  '為接手這段工作的新對話寫一份 handoff，第一行寫「HANDOFF:」加一句話的目標，全文不超過 1800 字。',
  '依序寫：',
  '1. 目標',
  '2. 已驗證：實際跑過並看到結果的檢查（測試、建置、指令輸出），寫出結果',
  '3. 已做但未驗證：改了還沒跑檢查、或只憑推論的部分',
  '4. 試過但失敗的做法與原因（接手者不要再試）',
  '5. 還在跑或沒收尾的東西：背景程序、dev server、未 commit 或未存的改動、暫存檔',
  '6. 已做的決定與理由，以及使用者在這次工作中給的限制（例如不能推送、要先問）',
  '7. 相關檔案路徑與指令',
  '8. 下一步：一個具體動作',
  '9. 待使用者回答的問題',
  '只寫接手需要的事實，沒有的項目寫「無」，不要寒暄。',
  '用使用者在對話裡使用的語言撰寫；程式碼、指令、路徑與錯誤訊息維持原文。',
].join('\n')

// fork 失敗的原因；nothing-to-fork 多半是剛重新啟動（含自動更新）或剛 /clear，主對話回應一次就能用
export function forkFailure(reason: string) {
  if (reason === 'timeout') return t().fork.timeout
  return reason === 'nothing-to-fork' ? t().fork.nothingToFork : reason
}

export const heldBlock = (items: string[]) => `${t().handoff.heldHead}\n${items.join('\n\n')}`
