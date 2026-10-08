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

- **整理用不帶歷史的單次請求**：`$.model.complete`（設定的 `notes_model`，預設 Sonnet 5.5，effort low），只送上次錨點之後的對話片段（`$.session.messages()` 轉成純文字，工具輸入／結果截短，總長有上限），由程式驗證 JSONL 動作再寫檔。整理一開始就讀好片段，所以交接只等幾秒就能 `/clear`。不要改回 fork：fork 一定用主模型、整段前綴，快取一過期就全價重送。模型最低用 Sonnet 5.5 effort low（維護者決定，不用更小的模型）。
- **交接仍用 `$.model.fork`**：handoff 需要整段 context。fork 沒有工具、沒有取消參數，時限只能用 `$.clock.after`＋`Promise.race`（原本的 fork 仍在背景跑完）。
- **不自動送訊息通知 AI**：會多一次整段 context 的請求，離席時也會讓離席 handoff 被當成過時刪掉。整理有變動只跳 toast（寫完整路徑），差異用 `prompt.submit` 的 `context` 跟著下一則人類訊息帶入；不用 `session.append`（會插進進行中的回合）。
- **一個工作區一份經驗檔，不跨專案**：工作區是 session 啟動的資料夾（依 `$.session.root()`；`$.session.repo()` 會跟著 Bash `cd` 變），從 git worktree 啟動時算主工作樹。經驗檔在 `<claude>/projects/<編碼後的工作區路徑>/memory/ctx-handoff.md`，整理只寫它、新對話只帶入它；不追蹤 session 碰過的其他 repo，也不做跨檔搬移（維護者 2026-10-05 決定：多專案分檔造成分錯專案、worktree 對應、多個 session 互改別人檔案等問題）。不寫 `MEMORY.md`（內建 auto memory 開啟時會重複載入或改寫）。
- **不留相容舊格式的程式**：格式或機制改了就直接改，不寫遷移或雙格式判斷；舊資料用 `tools/notes.mjs` 一次手動整理。
- **背景失敗原因寫進 `$.store`** 並在 `/handoff` 狀態顯示：`$.ui.log` 在 `/clear` 之後不會留在對話檔。手動指令沒有回答時不要回報「完成」。
- **記憶分成給人看與給整理看兩層**（維護者 2026-10-06 定案）：整理輸出 `title`（一句結論，提示 40 字、程式擋 60 字）、`how`／`why`（各一句，擋 100 字）、`evidence`；寫檔時排成標題行加縮排的 `做法／理由／根據` 行，根據由程式補日期與 session 前 8 碼，最多留 3 筆。`user`／`feedback` 一定要附 `quote`，程式比對這段對話裡使用者自己送出的訊息（`[ctx-handoff` 開頭的注入不算），比對不到就丟掉，防止把助理的做法記成使用者要求。面板預設只顯示標題。
- **帶入依類型，不設條數上限；平常自動，人只管不可逆的事**（維護者 2026-10-06 決定，不改成字數上限）：`user`／`feedback` 整條帶入（標題、做法、理由）；`project`／`reference` 只帶標題，細節由 AI 需要時讀正本；事實類超過 `STALE_DAYS`（30）天沒有新根據就封存（不帶入、不刪），整理用 `confirm_memory` 加根據會恢復。整理不因條數多而刪除，只在被推翻或重複時刪或合併。刪除與啟用守門才需要人；面板的「留下」是選擇性的人工證實。規則目前只加字數上限（名稱 40、規則 150）。
- **守門只採用使用者核准的**：`/handoff guard suggest` 把出現 3 次以上的規則交給整理模型（`notes_model`）提草稿（工具名、match／unless regex、deny 或 remind），程式驗證格式並試比對這段對話已跑過的工具呼叫，存成草稿；`/handoff guard on N` 才生效。設定依工作區存在 `$.store`（`guards:<工作區>`），不寫進經驗檔（不佔新對話 context）。`tool.call` hook 出錯時放行，不擋正常工作。
- **面板只放要人判斷、按一下的事**：`/handoff panel` 開關輸入框上方的面板（`AbovePrompt`，畫面在 `hooks/panel.tsx`；不用 `Pane`，終端機全螢幕版面的 Pane 一定停靠側邊，維護者要放在輸入框上方），列守門草稿與核准、最近一次整理的變動、刪掉記錯的記憶或規則（按兩次確認，寫檔前備份到 `.ctx-handoff-backup/`）、調整設定（見下面「設定在面板調」）。狀態數字（快取、花費、context）留給 status line，不放面板（維護者 2026-10-06 決定）。render hook 只讀 `$.state` 的 `panelUi`（分頁、展開、確認中）與 `panelData`（資料快照），不讀檔也不讀 store；快照在開面板、按動作、`/handoff guard`、整理寫檔、守門觸發、回合結束時重算。每次重畫都讀檔會讓按鈕等 I/O，面板像卡死（2026-10-06）。
- **`$.state` 放熱重載後還要接得上的 session 狀態**：面板與閒置計時（到期時間、刷新次數）。熱重載清掉計時器，`session.start` 依 `idle` 照原本的到期時間重排，過期超過 5 分鐘就不補。契約在 `types/index.d.ts`，加新的值要先宣告。跨 session 的資料仍放 `$.store`。
- **證實過的規則放進 repo：AI 來做，mod 只交代與記帳**（維護者 2026-10-07 決定，不分個人或專案）：出現 `PROMOTE_MIN_COUNT`（3）次以上的規則與啟用中的守門，在 git repo 開的新對話由 `prompt.context` 交代 AI：先做完使用者的事，再依專案慣例放進 repo、檢查重複、不 commit，完成後呼叫 `mcp__ctx-handoff__mark_in_project`。mod 不自己寫 repo：放哪、有沒有重複、hook 有沒有效都要判斷，而且 mod 寫檔會繞過權限確認。規則記 `- 專案：已在 <位置>`（之後不帶入、不提議守門）或 `- 專案：不放`；守門記 `project` 並停用。交代紀錄在 `$.store` 的 `promote:<工作區>`：同一條 6 小時內不交給別的對話、最多交代 2 次。工具每次 `session.start` 都註冊同一份定義（2026-10-07 一個實際專案的事故：曾經只在第一個請求前註冊，session 重開後回合數不是 0 就沒註冊，引擎把工具撤掉，AI 只好直接改 store 檔）。
- **重複的多步驟做法記成「流程」，累積 3 次後交給 AI 做成專案 skill，不帶入新對話**（維護者 2026-10-08 決定）：整理多一種項目 `procedure`（`add／confirm／update／delete_procedure`，編號 `P<n>`）：name（40 字）、when（一行，100 字）、steps（2–8 步、每步 80 字，編號由程式排）、次數與根據，格式和規則同形（標題行 `### 名稱（N 次）`＋body），存在經驗檔的 `## 流程` 區段（沒有流程就不輸出這一段，舊檔逐位元不變；`tools/lib.mjs` 與 `tools/notes.mjs` 同規則）。提示要求很保守：同一種工作被做了不只一次、至少 3 步才收，單一規則仍寫成規則。流程不進 `contextText`（省 context）；次數達 `PROMOTE_MIN_COUNT` 且 session 根目錄是 git repo 時，走原本的放進專案流程（`promoteItems` 加 `p:<名稱>`、同一套 6 小時與 2 次上限），交代文字多一條：建 `.claude/skills/<kebab-name>/SKILL.md`（frontmatter `name`、`description`）或補充已有的 skill／文件、查重、不 commit；`mark_in_project` 的 `items` 多收 `procedure`，記 `- 專案：已在 <位置>` 或 `不放`。同樣由 AI 做、mod 只交代與記帳。面板的規則分頁在規則下面列流程（可刪，鍵 `p:<名稱>`），`/handoff` 狀態多一行流程數。經驗檔檔頭說明文字不動（改了會讓舊檔與 `notes-file` 的逐位元回歸測試對不上）。
- **設定在面板調，不放 `/config`**（維護者 2026-10-07 決定不放原始碼；2026-10-08 決定 `/config` 不再加列，全部搬到面板）：`plugin.json` 不宣告 `userConfig`。每個設定的型別、範圍、間距、選項在 `hooks/config.ts` 的 `SETTINGS`，讀值（`resolveConfig`、`settingValue`：超出範圍拉回、型別不對或不在選項裡用預設；`notes_model` 是 `free`，settings.json 可寫清單外的模型）與面板（`stepSetting`）都照它。值的來源依序：面板存在 `$.store` 的 `settings`（所有工作區共用）、使用者 `settings.json` 的 `pluginConfigs["ctx-handoff@<marketplace>"].options`（VS Code 擴充功能看不到面板，要靠它；project／local 範圍不讀）、預設。第一次用到時（`initLang`）讀進 `cfg`；每則人類訊息（`prompt.submit`）與面板改值時 `reloadConfig` 重讀，換語言、重排閒置計時、清回覆語言目標，所以別的 session 在面板改的值下一則訊息就生效。面板的「設定」分頁（第 5 個）列出所有設定加上保持快取、專案筆記兩個開關（仍存在 store 的 `refresh`／`distill`，和 `/handoff refresh|distill on|off` 共用），每列標出來源（面板／settings.json／預設），數字用 −／＋、開關與選項按一下換下一個，面板設過的可以「還原」。不用 `$.config.set`：要清單裡有那一列才寫得進去，clone 載入或 `claude -p` 時沒有。`config.set` hook 只用來在使用者改 Claude Code 自己的設定時清掉回覆語言目標。
- **重複失敗提醒：只提醒，不擋**（維護者決定，2026-10-08）：同一個工具連續兩次因同樣原因失敗（錯誤文字去掉路徑、數字、空白後取前 200 字當簽名），在第 2 次的結果 `context` 附一句 `[ctx-handoff]` 開頭的話，請模型找原因並換做法；每段連續失敗只提醒一次，該工具成功或簽名換了就重算，使用者自己中斷或拒絕的不算。判斷在 `tool.call` 的 `next(e)` 之後（`watchCall`），任何錯誤都放行原結果。狀態放 `rt.streaks`（模組變數）：熱重載會清掉，清掉只是少一次提醒，所以不佔 `$.state`。提醒文字給模型看，維持中文。設定 `retry_nudge`（預設開）。
- **說完成卻沒驗證：擋下停止一次**（維護者決定，2026-10-08）：回合結束（`classic.Stop`）時，若最後一則訊息說完成了（`claimsDone`，只看開頭 200＋結尾 400 字，排除否定、提問與已說明沒驗證的）、這一輪成功改過檔（Edit／Write／MultiEdit／NotebookEdit，改 `.md`／`.txt` 等文件不算），且最後一次改檔之後沒有跑過看起來像測試、檢查或建置的 Bash／PowerShell 指令（失敗也算跑過），就用 `block` 擋下這次停止並附 `[ctx-handoff]` 理由，模型會接著驗證。紀錄在 `tool.call` 結束時累計（`rt.work`，序號比較先後），不讀 `$.session.messages()`。每回合最多擋一次（`reminded`，加上引擎給的 `stop_hook_active`）；別的 Stop hook 已經擋下、子代理的停止都不處理；擋下時不判斷門檻交接。回合結束、下一則人類訊息或被中斷的 `turn.complete` 都會清掉紀錄。設定 `done_check`（預設開）。未實機驗證：模組的 `classic.Stop` 回 `block` 是否真的讓模型接著做、`stop_hook_active` 在第二次停止是否為 true。
- **回覆語言提醒：只提醒，不改請求**（維護者決定，2026-10-08）：Claude 的說明不是使用者的語言時（長對話裡模型常漂成英文），提醒一次。`turn.step` 串流 hook（`const r = yield* next(e)`，只看 `e.agentId === undefined` 的主對話，`e` 原封不動往下傳，不碰 model／effort，所以不影響快取），在 `watchReply` 對 `r.answer` 呼叫 `hooks/lang.ts` 的 `noteStep`。判斷只看說明文字：先去掉圍欄與行內程式碼、引用行、網址、路徑、@提及、斜線指令、`a.b` 形式的檔名與識別字；再數漢字、假名、韓文與英文單字（2 字母以上、全小寫或首字大寫，縮寫與駝峰不算）。漢字／假名／韓文少於 `MIN_CJK`（40）且英文單字少於 `MIN_LATIN`（16）就不判斷（英文旁白很常見）。單位：英文 1 字、中日韓 2 字（平均詞長）；某種文字占單位超過 `DOMINANT`（0.6）才算主導：zh-TW／zh-CN 被英文主導，或簡繁專用字（`PAIRS`，約 190 對，只放繁體文章不會出現的簡體字，用本 repo 約 1.4 萬繁體字驗證過沒有誤中）至少 3 個且占漢字超過 6%，或假名多到像日文；en 被中日韓主導；ja 被英文或韓文主導，或有大量漢字卻幾乎沒有假名。不是目標語言就排一次提醒，每段連續不符合只一次，有一步符合（短句不算）才重算：這步還要呼叫工具，提醒（`rt.reply.pending`）附在主對話下一個工具結果的 `context`（`watchCall`，子代理的結果不拿）；最終回答沒有工具結果可附，就放 `rt.reply.next`，跟著使用者下一則真正送進對話的訊息（`prompt.submit`，和整理的差異一起，被丟棄就保留）。這輪被中斷沒附出去的 pending 也改跟下一則訊息。提醒用目標語言寫（zh-TW 用繁中），開頭 `[ctx-handoff]`。設定 `reply_language`（auto／off／zh-TW／zh-CN／en／ja，預設 auto）：auto 讀 Claude Code 的 `language` 設定，含繁體／Traditional／zh-TW／zh-Hant 為 zh-TW，含简体／Simplified／zh-CN 為 zh-CN，English、Japanese／日本語 對應 en、ja；沒設、只寫「中文」或認不得就不提醒（分不出繁簡寧可不動）。目標語言存 `rt.replyTarget`，任何 `config.set` 或重讀設定時值變了都清掉重算。`/handoff` 在防呆提醒那行顯示設定與 auto 解析的結果。狀態在模組變數（`rt`）：熱重載清掉只是少一次提醒。已知限制：使用者要它寫別種語言的內容（翻譯、英文文件）時也會提醒一次。未實機驗證：真實回應的 `r.answer` 是否只含可見文字、提醒附在工具結果 `context` 後模型是否真的改回該語言。
- **停在哪裡的進度備忘：整理順手產生，新對話提供一次**（維護者決定，2026-10-08）：自動交接只涵蓋自動的情況；使用者自己 `/clear`、程序當掉、單純開新對話時，新對話不知道上一段做到哪。背景整理的同一個 `$.model.complete`（不多一次請求）多輸出一個 `set_progress`（task、state=done／in_progress／blocked、verified、next、files≤5，欄位各有上限、整份 ≤ `PROGRESS_TOTAL_MAX` 600 字，程式驗證，無效整行丟棄）；片段沒有實際工作進展時模型不輸出，前一份保留（提示裡附上目前的進度讓它接著更新）。存在 `$.store` 的 `progress:<工作區鍵>`（一個工作區一份，多個 session 同時整理時最後寫的為準），**不進經驗檔**（暫時性，不佔新對話的常駐 context），不算整理的「變動」、不跳 toast。`prompt.context` 在新對話第一則訊息提供一次（獨立區塊 `ctxHandoffProgress`，以 `NOTE_TAG` 開頭，整理看得出是注入的）：條件是產生它的 session 不是這個 session、`PROGRESS_MAX_AGE_MS`（24 小時）內、沒被 handoff 取代、`offered` 沒有這個 session（以新 session id 記，compaction 後不重複，但另一段新對話仍會再提供一次）。`/clear` 後 `$.session.id()` 會換（`session.end` 的 `reason: 'clear'` 文件：同一個 process 換新 id、不觸發 `session.start`），所以「不同 session」就涵蓋使用者自己 `/clear`。自動交接與 `/handoff resume` 走 `clearAndSubmit`：`/clear` 之前先標記 `handed`（存進該筆紀錄，並記在 `rt.handed` 讓 `/clear` 之後才跑完的整理不再寫入），`/clear` 失敗就還原；不用「有 handoff 存檔就取代」判斷，因為離席 handoff 只在原 session 提供，使用者若改開新對話反而要靠進度備忘。設定 `resume_hint`（預設開）；`/handoff` 狀態顯示最近一份（時間與任務）。已知限制：進度只跟著整理的時機（每 30 則、閒置 55 分、交接前、手動；不到 `min_tokens` 不整理），短對話或當機前可能沒有或落後；同工作區同時開兩個 session 會互看到。未實機驗證：`/clear` 之後 `prompt.context` 在新對話第一則真的重算、區塊文字模型實際怎麼處理。
- **交接不接續 /goal**（維護者 2026-10-08 決定）：交接的 `/clear` 會清掉進行中的 goal。做過接續（交接前讀條件、新對話摘要回合結束後用 `$.command.run` 重設），但無頭模式測不到「goal 進行中觸發交接」：排隊的輸入要等 goal 跑完，撐大 context 又會在設 goal 前就交接；實機驗證不了就不放進來。要重做先讀下面的平台事實。
- **指令名稱**：`/handoff` 被使用者自己的指令或 skill 佔用時，改註冊 `/ctx-handoff`。
- **介面語言兩種（設定的 `language`，字串在 `hooks/i18n.ts`）**：`auto` 先看 Claude Code 的 `language` 設定，沒設就看系統語系（`Intl`），`zh` 開頭用繁體中文，其餘英文；不讀 `LANG`：Windows 的 Git Bash 常設 `en_US`，和系統顯示語言不一致（維護者 2026-10-07 決定）；每個 hook 進來先 `await initLang($)`，之後 `t()` 同步取字串。只翻給人看的文字（狀態列、toast、紀錄、指令回覆、面板、交接提示）；狀態列、toast、紀錄、指令回覆與 drop 提示都不加 `[ctx-handoff]`（引擎會加 `ctx-handoff:`；維護者 2026-10-07 看到面板開啟回覆重複後決定）；送進對話的交接訊息與守門提醒仍以 `[ctx-handoff]` 開頭，整理提示靠它辨認。給模型的提示、經驗檔格式與標記（`NOTE_TAG`、標題、`做法／理由／根據`）、帶入新對話的記憶區塊不翻譯：它們是資料，改了舊檔讀不了，又不寫雙格式判斷，所以英文介面下經驗檔的標題與標記仍是中文；記憶與交接摘要的內容則由提示要求「用使用者在對話裡使用的語言撰寫」。新字串兩種語言一起加；測試的 `world()` 用 `settings.read` 把 Claude Code 的 `language` 釘成繁體中文，`ctl.panelSettings` 模擬面板存的設定（store 的 `settings` 還沒被寫過時讀它）（系統語系假造不了，判斷邏輯直接測 `pickLang`），不然結果跟著執行測試那台機器的語系。

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
| 工具註冊與重開 | `$.tool.register` 的工具跟著模組：熱重載或 session 重開（對話檔有 `SessionStart:resume`，新 process、回合數接續）時沒再註冊，引擎就撤掉它（`deferred_tools_delta` 的 `retractedTools`，cause `not_configured`）。MCP 工具延後載入時，中途註冊只多一筆可用工具提示，不動快取前綴 |
| `userConfig` 與 `/config` | 實測（2.1.292）：clone 載入（`--plugin-dir`、`CLAUDE_CODE_PLUGIN_DIRS`）與 `claude -p`（含 marketplace 安裝）時，`$.config.list()` 沒有本 plugin 的列；`$.settings.read().pluginConfigs` 讀得到 `--settings` 與 `settings.json` 的值。project／local 範圍的 settings 不讀 `pluginConfigs`（debug 紀錄明說） |
| `classic.Stop` 回 `block` | 實測（2.1.292，`claude -p`）：模型接著再做一輪，看到的是使用者訊息「Stop hook feedback:
<理由>」；第二次停止時沒有再擋（`reminded` 與 `stop_hook_active`）。引擎把它記成 `hookErrors`，畫面跳「Stop hook error occurred」通知，無法改 |
| `tool.call` 結果的 `context` | 實測：附在工具結果後送給模型，模型回覆裡提到「hook 提醒不要原樣重試」，之後沒再跑同一個指令 |
| `/goal` 與 `/clear`（2.1.293 實測） | `/clear` 會清掉進行中的 goal。`$.command.run({ command: 'goal', args: '' })` 回 `Goal active: <條件> (N turns)` 或 `No goal set.`，並在對話檔多寫幾行；`args` 帶條件則回 `Goal set: …` 並立刻開始一個回合；`$.prompt.submit('/goal …')` 會被拒絕；`claude -p` 單次模式下 `$.command.run` 丟例外。goal 迴圈每一回合都觸發 `classic.Stop`；stream-json 模式下 goal 的所有回合算同一個 result，排隊的輸入等它跑完才執行 |
| 對話檔的 `goal_status`（2.1.293 實測） | JSONL 有 `attachment.type === 'goal_status'` 的列：設定 `{met:false, sentinel:true, condition}`、每次檢查 `{met:false, condition, reason}`、達成 `{met:true, …}`、清除 `{met:true, sentinel:true, condition}`；最後一列沒達成＝進行中。`$.session.messages()` 不含這些列 |
| 保持快取 | 實機紀錄：第 2、3 次刷新（閒置 110、165 分鐘）`cache_creation=0`，整段從快取讀，刷新確實延長了快取 |
| 跨檔案傳 `$` | `$` 只能在同一檔案裡往下傳（plugin 載入時的靜態檢查，tsc 看不出來）：把 `$` 傳給從別的檔案 import 的函式，plugin 會載入失敗（`$ is followed only into a function declared in this same file`）。碰 `$` 的流程都留在 `register.ts`，拆檔只搬純函式（資料進、資料出；`rt` 狀態、`cfg` 設定與 `t()` 這類不碰 `$` 的可以跨檔案） |

## 測試引擎的限制

- 同一個 hook 在一個測試裡只能註冊一次（`registered twice`），第一次呼叫 `$` 之後不能再 `on()`；要測多種情況就在頂層用 `for (…) test(…)` 展開。
- `mock.clock` 從 0 開始，不能拿 0 當「尚未開始」的哨兵值。
- 沒有 `session.append` 的實作；`classic.Stop` 與 `turn.complete` 只在測試主動觸發時才跑、沒有先後，這些要靠實機驗證。
- mock 收不到事件時，先另寫一個暫時的 `*.test.ts`，分別從測試的 `$` 直接呼叫與經由 plugin 呼叫，確認引擎行為再改測試。
- 測試的 `$` 沒有 `$.state`；要放「熱重載前留下的值」，用 `on('state.get')` 回 `{ value: { value, version } }`。測試檔 import 到的模組和 plugin 不是同一份，不能拿來重設 plugin 的模組變數。
- `turn.step` 底層要自己提供回應：test-world 的底層 hook 是不吐片段的 generator（`ctl.stepReply` 決定回應、`ctl.stepSeen` 記下收到的請求），用 `step()` 小工具驅動；讀回傳值要用 `stream.next()` 讀到 `done`，`for await` 之後的 `stream.result` 實測得到 undefined。
- 要用沒實測過的 API（spawn、串流 hook、權限攔截）時，先做一個獨立的探測 mod，把逐步數據寫進 `$.store` 再分析，確認後才改這個 mod。
