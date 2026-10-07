# ctx-handoff 開發指引

> Development notes for maintainers and AI assistants, in Traditional Chinese. Contributors: start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

給在這個 repo 工作的 AI 與開發者。使用說明在 `README.md`／`README.zh-TW.md`；本檔只寫改程式時要知道的事。

## 開發流程

mod 用 `CLAUDE_CODE_PLUGIN_DIRS` 載入時，主資料夾的檔案一變，所有開著的 session 立刻熱重載，可能跑到改到一半的程式。所以一律在暫存 worktree 改：

```
node tools/wt.mjs new <分支>      # 建 worktree、複製型別檔
# 在 worktree 改程式、補測試、git commit
node tools/wt.mjs land <分支>     # 跑 tools/check.mjs，通過才 fast-forward 回主資料夾
node tools/status.mjs             # 確認各 session 已熱重載、看整理與失敗紀錄
```

- 推送前一定跑 `node tools/check.mjs`：plugin validate、plugin test、tsc、公開資訊掃描（`<git 共用目錄>/info/private-words` 放不能出現在公開 repo 的詞，不進版本控制）。
- 每個真的發生過的事故，補一個在舊程式上會失敗的固定測試。
- 改經驗檔用 `node tools/notes.mjs`（以條目為單位、預設預演），不要手寫一次性腳本。工具一覽在 `tools/README.md`。
- 做完一段工作後的檢討紀錄在主資料夾的 `docs/work-retro.md`（不進版本控制），先結案上面的待結案項目。
- 使用者看得到的改動要同步雙語 README，並在 `CHANGELOG.md` 的 Unreleased 加一行。

## 設計決定（改之前先讀）

- **整理用不帶歷史的單次請求**：`$.model.complete`（`DISTILL_MODEL`，effort low），只送上次錨點之後的對話片段（`$.session.messages()` 轉成純文字，工具輸入／結果截短，總長有上限），由程式驗證 JSONL 動作再寫檔。整理一開始就讀好片段，所以交接只等幾秒就能 `/clear`。不要改回 fork：fork 一定用主模型、整段前綴，快取一過期就全價重送。模型最低用 Sonnet 5.5 effort low（維護者決定，不用更小的模型）。
- **交接仍用 `$.model.fork`**：handoff 需要整段 context。fork 沒有工具、沒有取消參數，時限只能用 `$.clock.after`＋`Promise.race`（原本的 fork 仍在背景跑完）。
- **不自動送訊息通知 AI**：會多一次整段 context 的請求，離席時也會讓離席 handoff 被當成過時刪掉。整理有變動只跳 toast（寫完整路徑），差異用 `prompt.submit` 的 `context` 跟著下一則人類訊息帶入；不用 `session.append`（會插進進行中的回合）。
- **一個工作區一份經驗檔，不跨專案**：工作區是 session 啟動的資料夾（依 `$.session.root()`；`$.session.repo()` 會跟著 Bash `cd` 變），從 git worktree 啟動時算主工作樹。經驗檔在 `<claude>/projects/<編碼後的工作區路徑>/memory/ctx-handoff.md`，整理只寫它、新對話只帶入它；不追蹤 session 碰過的其他 repo，也不做跨檔搬移（維護者 2026-10-05 決定：多專案分檔造成分錯專案、worktree 對應、多個 session 互改別人檔案等問題）。不寫 `MEMORY.md`（內建 auto memory 開啟時會重複載入或改寫）。
- **不留相容舊格式的程式**：格式或機制改了就直接改，不寫遷移或雙格式判斷；舊資料用 `tools/notes.mjs` 一次手動整理。
- **背景失敗原因寫進 `$.store`** 並在 `/handoff` 狀態顯示：`$.ui.log` 在 `/clear` 之後不會留在對話檔。手動指令沒有回答時不要回報「完成」。
- **記憶分成給人看與給整理看兩層**（維護者 2026-10-06 定案）：整理輸出 `title`（一句結論，提示 40 字、程式擋 60 字）、`how`／`why`（各一句，擋 100 字）、`evidence`；寫檔時排成標題行加縮排的 `做法／理由／根據` 行，根據由程式補日期與 session 前 8 碼，最多留 3 筆。`user`／`feedback` 一定要附 `quote`，程式比對這段對話裡使用者自己送出的訊息（`[ctx-handoff` 開頭的注入不算），比對不到就丟掉，防止把助理的做法記成使用者要求。面板預設只顯示標題。
- **帶入依類型，不設條數上限；平常自動，人只管不可逆的事**（維護者 2026-10-06 決定，不改成字數上限）：`user`／`feedback` 整條帶入（標題、做法、理由）；`project`／`reference` 只帶標題，細節由 AI 需要時讀正本；事實類超過 `STALE_DAYS`（30）天沒有新根據就封存（不帶入、不刪），整理用 `confirm_memory` 加根據會恢復。整理不因條數多而刪除，只在被推翻或重複時刪或合併。刪除與啟用守門才需要人；面板的「留下」是選擇性的人工證實。規則目前只加字數上限（名稱 40、規則 150）。
- **守門只採用使用者核准的**：`/handoff guard suggest` 把出現 3 次以上的規則交給 `DISTILL_MODEL` 提草稿（工具名、match／unless regex、deny 或 remind），程式驗證格式並試比對這段對話已跑過的工具呼叫，存成草稿；`/handoff guard on N` 才生效。設定依工作區存在 `$.store`（`guards:<工作區>`），不寫進經驗檔（不佔新對話 context）。`tool.call` hook 出錯時放行，不擋正常工作。
- **面板只放要人判斷、按一下的事**：`/handoff panel` 開關輸入框上方的面板（`AbovePrompt`，畫面在 `hooks/panel.tsx`；不用 `Pane`，終端機全螢幕版面的 Pane 一定停靠側邊，維護者要放在輸入框上方），列守門草稿與核准、最近一次整理的變動、刪掉記錯的記憶或規則（按兩次確認，寫檔前備份到 `.ctx-handoff-backup/`）。狀態數字（快取、花費、context）留給 status line，不放面板（維護者 2026-10-06 決定）。render hook 只讀 `$.state` 的 `panelUi`（分頁、展開、確認中）與 `panelData`（資料快照），不讀檔也不讀 store；快照在開面板、按動作、`/handoff guard`、整理寫檔、守門觸發、回合結束時重算。每次重畫都讀檔會讓按鈕等 I/O，面板像卡死（2026-10-06）。
- **`$.state` 放熱重載後還要接得上的 session 狀態**：面板與閒置計時（到期時間、刷新次數）。熱重載清掉計時器，`session.start` 依 `idle` 照原本的到期時間重排，過期超過 5 分鐘就不補。契約在 `types/index.d.ts`，加新的值要先宣告。跨 session 的資料仍放 `$.store`。
- **證實過的規則放進 repo：AI 來做，mod 只交代與記帳**（維護者 2026-10-07 決定，不分個人或專案）：出現 `PROMOTE_MIN_COUNT`（3）次以上的規則與啟用中的守門，在 git repo 開的新對話由 `prompt.context` 交代 AI：先做完使用者的事，再依專案慣例放進 repo、檢查重複、不 commit，完成後呼叫 `mcp__ctx-handoff__mark_in_project`。mod 不自己寫 repo：放哪、有沒有重複、hook 有沒有效都要判斷，而且 mod 寫檔會繞過權限確認。規則記 `- 專案：已在 <位置>`（之後不帶入、不提議守門）或 `- 專案：不放`；守門記 `project` 並停用。交代紀錄在 `$.store` 的 `promote:<工作區>`：同一條 6 小時內不交給別的對話、最多交代 2 次。工具只在第一個請求之前註冊：工具清單在快取前綴裡，熱重載進已經開始的對話時中途加工具會讓整段快取重寫；熱重載時已註冊過的就用 `$.tool.list()` 接回，沒有就不交代。
- **指令名稱**：`/handoff` 被使用者自己的指令或 skill 佔用時，改註冊 `/ctx-handoff`。
- **介面語言兩種（`UI_LANG`，字串在 `hooks/i18n.ts`）**：`auto` 先看 Claude Code 的 `language` 設定，沒設就看系統語系（`Intl`），`zh` 開頭用繁體中文，其餘英文；不讀 `LANG`：Windows 的 Git Bash 常設 `en_US`，和系統顯示語言不一致（維護者 2026-10-07 決定）；每個 hook 進來先 `await initLang($)`，之後 `t()` 同步取字串。只翻給人看的文字（狀態列、toast、紀錄、指令回覆、面板、交接提示）；狀態列、toast、紀錄、指令回覆與 drop 提示都不加 `[ctx-handoff]`（引擎會加 `ctx-handoff:`；維護者 2026-10-07 看到面板開啟回覆重複後決定）；送進對話的交接訊息與守門提醒仍以 `[ctx-handoff]` 開頭，整理提示靠它辨認。給模型的提示、經驗檔格式與標記（`NOTE_TAG`、標題、`做法／理由／根據`）、帶入新對話的記憶區塊不翻譯：它們是資料，改了舊檔讀不了，又不寫雙格式判斷，所以英文介面下經驗檔的標題與標記仍是中文；記憶與交接摘要的內容則由提示要求「用使用者在對話裡使用的語言撰寫」。新字串兩種語言一起加；測試的 `world()` 用 `settings.read` 把 `language` 釘成繁體中文（系統語系假造不了，判斷邏輯直接測 `pickLang`），不然結果跟著執行測試那台機器的語系。

## 平台事實（實測過）

| 主題 | 事實 |
|---|---|
| `$.model.fork` | 沒有工具；這個 process 還沒有主對話回應時回 `nothing-to-fork`（新 session 第一次請求前、`/clear` 之後、process 重啟接續同一 session）。結果的 `aborted` 只在發起 fork 的回合被中斷時出現 |
| fork 子代理 | `$.agent.spawn({ subagentType: 'fork' })` 有工具，第一個請求快取命中約 99%，但每次工具呼叫都重讀整個前綴；`model` 參數對它無效 |
| 快取與換模型 | `turn.step` 改 model 或 effort 會讓 prompt cache 失效。對繼承主對話快取的請求換模型前，先比較「原模型讀快取（約 0.1 倍輸入價）× 前綴」與「新模型輸入價 × 前綴＋寫快取」 |
| 權限攔截 | 從指令 handler spawn 的子代理，`tool.call`／`turn.step` 攔得到；從 `$.clock.after` 計時器 spawn 的完全攔不到。用 hook 限權時每條啟動路徑都要實測 |
| `turn.step` | 串流 hook：`async function* ($, e, next) { const r = yield* next(e); …; return r }`，用量在 `r.usage` |
| `prompt.context` | 每段對話只在第一則訊息觸發一次（compaction、`/clear` 或 `$.ui.invalidate("prompt.context")` 才重算） |
| `prompt.submit` | `attachments` 只有 `type`、`mediaType`、`filename`，沒有內容，mod 不能暫存或重送圖片 |
| `$.store` | 所有 session 與 process 共用一個 JSON 檔（`<claude>/plugins/store/ctx-handoff_*.json`），鍵要依專案或 session 分開 |
| `$.fs.write` | 會自動建立上層目錄 |
| 時區 | 執行環境有本地時區：`toLocaleString` 是本地、`toISOString` 是 UTC |
| 熱重載 | 對話檔留下 `ctx-handoff: reloaded (N hooks: …)`；回合中存的檔要等回合結束才重載（落在 `turn.complete` 之後）。會清掉模組變數與計時器（攔下的訊息、排入的差異），`$.state` 保留，`register` 與 `session.start` 重跑 |
| `$.state` | session 範圍；render hook 讀了就訂閱，寫入只重畫讀它的地方，不用 `$.ui.invalidate`；render 裡不能寫，要從按鈕 handler 或其他事件用 `update()` 寫 |
| 耗時 | handoff fork 在 800k context 約 28 秒 |
| `$.tool.register` | `session.start` 註冊，回傳完整名稱 `mcp__<plugin>__<name>`；同一個 `tool.call` hook 依 `e.tool` 接手，回 `{ result: 字串 }`（回物件會被輸出格式檢查擋掉）。輸入參數直接展開在 `e` 上（`e.items`），不在 `e.input` |
| 保持快取 | 實機紀錄：第 2、3 次刷新（閒置 110、165 分鐘）`cache_creation=0`，整段從快取讀，刷新確實延長了快取 |

## 測試引擎的限制

- 同一個 hook 在一個測試裡只能註冊一次（`registered twice`），第一次呼叫 `$` 之後不能再 `on()`；要測多種情況就在頂層用 `for (…) test(…)` 展開。
- `mock.clock` 從 0 開始，不能拿 0 當「尚未開始」的哨兵值。
- 沒有 `session.append` 的實作；`classic.Stop` 與 `turn.complete` 只在測試主動觸發時才跑、沒有先後，這些要靠實機驗證。
- mock 收不到事件時，先另寫一個暫時的 `*.test.ts`，分別從測試的 `$` 直接呼叫與經由 plugin 呼叫，確認引擎行為再改測試。
- 測試的 `$` 沒有 `$.state`；要放「熱重載前留下的值」，用 `on('state.get')` 回 `{ value: { value, version } }`。測試檔 import 到的模組和 plugin 不是同一份，不能拿來重設 plugin 的模組變數。
- 要用沒實測過的 API（spawn、串流 hook、權限攔截）時，先做一個獨立的探測 mod，把逐步數據寫進 `$.store` 再分析，確認後才改這個 mod。
