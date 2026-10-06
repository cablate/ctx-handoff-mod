// ctx-handoff 放在 $.state 的值（session 範圍，熱重載不會清掉）：只有面板用
export type PanelTab = 'guard' | 'memory' | 'rules' | 'distill'

export type PanelGuard = {
  id: number; rule: string; tool: string; match: string; unless?: string; message: string
  mode: 'deny' | 'remind'; state: 'proposed' | 'on' | 'off'; hits: number
  replay?: { hits: number; calls: number }
  bad?: string; good?: string
}

// 面板要顯示的資料快照：開面板、按動作、整理寫檔、指令改守門、回合結束時重算；畫面只讀這份，不讀檔
export type PanelData = {
  file: string
  guards: PanelGuard[]
  candidates: number
  lastDistill?: { at: string; why: string; changes: string[] }
  // head：[類型] 標題；detail：做法、理由、根據各一行（展開才顯示）
  memory: { head: string; detail: string[] }[]
  memoryTotal: number
  // 超過 staleDays 天沒被證實、不帶入新對話的事實類記憶（[類型] 標題）
  archived: string[]
  staleDays: number
  rules: { name: string; count: number }[]
}

// 面板的操作狀態
export type PanelUi = {
  open: boolean
  tab: PanelTab
  // 展開全文的項目（m:<記憶原文>／g<守門編號>／changes）
  expanded: string[]
  suggesting: boolean
  // 等待確認刪除的項目（m:<記憶原文>／r:<規則名稱>）
  confirming?: string
  // 上一個動作的結果
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-handoff': { panelUi: PanelUi; panelData: PanelData | null }
  }
}
