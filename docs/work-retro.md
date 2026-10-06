# 檢討紀錄

依 work-retro 的格式只留現況。每次檢討先從「待結案項目」逐項標記結果。

## 1. 待結案項目

| 項目 | 上線 | 怎麼驗證 | 訊號 |
|---|---|---|---|
| 整理改用 `model.complete`（Sonnet 5.5 low）、只送錨點之後的片段 | 2026-10-05 | 看幾次真實整理的變動數、丟棄行數、輸入／輸出 token 與秒數，和舊 fork（輸入 20～33 萬、輸出 2.6k～10.9k、29～108 秒）比較；變動內容是否合理 | `node tools/status.mjs` 的 `distill:last`／`distill:error` |
| 交接前整理跨過 `/clear`（只等 5 秒） | 2026-10-05 | 下一次在場交接後，`交接前` 那次整理有沒有寫進經驗檔，或記成 `aborted` | `distill:error` 出現 `交接前`＋`timeout`／`aborted` 就要改回等待 |
| `/handoff` 被佔用時改用 `/ctx-handoff` | 2026-10-05 | 在有 `handoff` skill 的資料夾開 session，`/ctx-handoff` 可用 | 對話檔有「改用 /ctx-handoff」訊息 |
| 一個工作區一份經驗檔（拿掉跨專案分檔、搬移、已知專案清單） | 2026-10-05 | 各工作區開的 session 只寫自己的經驗檔；不再出現分錯專案或寫進別的 repo 的變動 | `node tools/status.mjs` 的經驗檔清單與 `distill:last` 寫入路徑 |
| 面板只讀 `$.state` 快照、分頁熱鍵 1–4 | 2026-10-06 | 在大經驗檔的工作區開面板，連續切分頁、展開、刪除，按了立刻有反應 | 使用者再回報卡住；對話檔出現 `ui.render (AbovePrompt)` 的 refused／threw |
| 熱重載後接回閒置計時 | 2026-10-06 | 回合中改 mod、land 後離開 1 小時以上，回來前對話檔有 `快取刷新 1/3` | 熱重載後超過 55 分鐘閒置卻沒有 `快取刷新` 紀錄 |
| `tools/`（check、wt、status、notes） | 2026-10-05 | 下次改 mod 時全程用 `wt.mjs new/land`、改經驗檔用 `notes.mjs`，不再手寫一次性腳本 | 對話裡出現新的臨時改檔或查詢腳本就算沒生效 |

## 2. 待採用佇列

無。維護者決定背景整理維持自動寫入（2026-10-05）。

## 3. 上次量到的規模（2026-10-07）

| 層 | 規模 |
|---|---|
| 經驗檔（每次對話載入） | 家目錄 15 條記憶／2 條規則（8.5 KB，帶入約 2.4k token）；ctx-handoff 專案 2／0（1.8 KB）；另三個專案 86／17（36.1 KB，約 6.6k token）、33／13（44.9 KB，約 10.3k token）、4／2（3.4 KB） |
| repo 追蹤檔 | 21 個（2026-10-05 為 22；這次刪掉重複的示範 MP4，roundtrip 併進 `notes.mjs`，fixture 併進測試檔）；`hooks/register.ts` 1754 行、`hooks/panel.tsx` 238 行；測試 89 個 |
| repo 外的 ctx-handoff 檔案 | `settings.json` 的 `CLAUDE_CODE_PLUGIN_DIRS`、store 一個檔（舊機制的鍵已清除）、各工作區經驗檔；舊的 dev-mods 連結、探測 mod 與備份資料夾已清除 |

## 4. 本專案改過的預設值

無。
