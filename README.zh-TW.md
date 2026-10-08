# ctx-handoff

[English](README.md)

[![check](https://github.com/cablate/ctx-handoff-mod/actions/workflows/check.yml/badge.svg)](https://github.com/cablate/ctx-handoff-mod/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**讓 Claude Code 的長對話自己接續下去，並記住你教過它的事。**

用 Claude Code 做長時間的工作，常會遇到三件麻煩事：

- 對話越來越長，回答變慢、變貴、開始忘東忘西，你得自己寫摘要、`/clear`、再把摘要貼回去。
- 離開座位一小時，回來後第一則訊息要重新讀完整段對話，又慢又貴。
- 同一件事在不同對話裡講了三次，開新對話它還是忘了。

ctx-handoff 在背景處理這些事，平常不需要打任何指令：

| 情境 | 原本 | 裝了 ctx-handoff |
|---|---|---|
| 對話快滿了 | 自己寫摘要、清空、貼回去 | 自動寫好交接摘要、清空對話，新對話先說明它理解的進度，再等你指示 |
| 離開一段時間 | 回來後整段重讀 | 離開期間保持對話快取有效（最多約 4 小時）；更久就先存好交接摘要，等你回來選要接續還是開新對話 |
| 重複交代同一件事 | 新對話又忘了 | 整理成這個專案的筆記，下次開對話自動帶入 |

<img src="docs/distill-demo.gif" width="300" alt="示範：同一件事講了三次，開新對話後被忘記；ctx-handoff 把它整理成一條規則，下一段對話就記得了">

## 適合你嗎

**適合**：用 Claude 訂閱登入、常開很長的 session（例如 1M context 模型），並且習慣在專案資料夾裡開 Claude Code 的人。

**不太適合**：

- 用 API key、Bedrock 或 Vertex 的人：對話快取只保留 5 分鐘，「離開時保持快取」這項功能幫不上忙，需要關掉（見[限制](#限制)）。其他功能照常可用。
- 希望筆記跨專案共用的人：筆記依專案資料夾分開存。

**目前狀態**：實驗性。它使用 Claude Code 還在測試中的 mod 功能，Claude Code 更新後可能需要跟著調整。系統語系（或 Claude Code 的 `language` 設定）是中文時，介面訊息用繁體中文，其他情況用英文。專案筆記與交接摘要用你在對話裡使用的語言撰寫；筆記檔的區段標題仍是中文。

## 快速開始

需要 Claude Code 2.1.287 以上（從這版起 mod 預設開啟），已測試到 2.1.292。

```sh
claude plugin marketplace add cablate/ctx-handoff-mod
claude plugin install ctx-handoff@ctx-handoff-mod
```

開一個新 session 輸入 `/handoff`，看到類似下面的狀態就代表裝好了：

```
context 12034 / 門檻 600000（視窗 1000000）
快取刷新 on，本次閒置已刷新 0/3，計時器未啟動
```

**更新**不會自動進行。執行 `claude plugin update ctx-handoff@ctx-handoff-mod`，或在 `/plugin` 的 **Marketplaces** 開啟自動更新。

**想改程式，** 改用 clone 載入，存檔就會生效：

```sh
git clone https://github.com/cablate/ctx-handoff-mod ~/.claude/mods/ctx-handoff
claude --plugin-dir ~/.claude/mods/ctx-handoff
```

想讓 clone 的版本在每個 session 都自動載入，在 `~/.claude/settings.json` 的 `env` 加上絕對路徑（Windows 多個路徑用 `;` 分隔，macOS／Linux 用 `:`）：

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/you/.claude/mods/ctx-handoff" }
```

## 它會做什麼

### 對話快滿時自動交接

context 達到 600k token（視窗較小時是 80%）後，等 Claude 回完這一輪、手邊的背景工作和子代理也結束，就寫一份交接摘要、清空對話，把摘要送進新對話。新對話會先回報它理解的進度，再等你下一步指示。

摘要會分開寫「實際驗證過的」（跑過測試、看過結果）和「只改了還沒驗證的」，列出試過失敗的做法以免重試，記下還在跑或還沒存的東西，並保留你在這次工作中給的限制，例如「推送前先問」。

如果背景工作一直沒結束（例如開著 dev server），最晚在超過門檻 150k token 時（且不超過視窗 90%）也會交接；想提早交接就打 `/handoff now`。

交接時你正在打的訊息不會不見，會跟摘要一起送進新對話。圖片等附件無法暫存，畫面會提醒你重新貼上。

### 離開時保持快取

閒置約 55 分鐘時，送一個極小的請求讓對話快取保持有效，最多 3 次（約 4 小時）。再久就存一份交接摘要但**不清空**對話。你回來打第一則訊息時，它會先停下來讓你選：

- `/handoff resume`：開新對話，帶上摘要和你剛打的訊息
- `/handoff continue`：留在原本的對話繼續

### 專案筆記

你糾正過、交代過的事，會整理成這個專案的筆記，開新對話時自動帶入。

**什麼時候整理**：每 30 則訊息、閒置 55 分鐘、交接前，或打 `/handoff distill`。狀態列會顯示「再 18 則整理筆記」，整理時顯示「正在整理筆記…」。對話不到 30k token 不整理。

- **記憶**：偏好、修正、事實、位置。偏好和修正整條帶入（必須是你說過的話）；事實和位置只帶標題，要用時 Claude 再去讀。事實和位置 30 天沒被證實就封存，不帶入但不刪。
- **規則**：重複出現的做法，例如「Bash 路徑用正斜線（3 次）」。出現 2 次以上才帶入，最多 15 條。
- **流程**：你讓 Claude 重複做過的多步驟做法，例如「發版：改版本號 → 更新 changelog → 打 tag → 建立 GitHub release」。流程不帶入新對話（讓 context 保持小），而是做成專案的 skill，見下方。

筆記就是一個 Markdown 檔：`~/.claude/projects/<專案路徑>/memory/ctx-handoff.md`，可以直接改。

**規則會移進你的 repo。** 一條規則出現 3 次、或守門已啟用後，下次在 git repo 裡開新對話，Claude 會先做完你交代的事，再把它放進專案存放規則的地方（AGENTS.md、CLAUDE.md 或現有的 hook）。Claude 會檢查有沒有重複、不會 commit，並在回覆最後用一句話說明加了什麼、加在哪，你看平常的 diff 就會看到。之後規則存在 repo 裡，換電腦、換工具都用得到，ctx-handoff 也不再帶入自己那份。不想要就直接說，Claude 會還原改動，之後不再提。同一條最多問兩次。

**流程會變成專案的 skill。** 一個流程出現 3 次後，處理方式和規則一樣，只是 Claude 會把它建成 skill：`.claude/skills/<名稱>/SKILL.md`，`description` 寫什麼時候該用，內文依序列出步驟。如果已有 skill 或文件涵蓋同一個流程，Claude 會補充它，不另開重複的。Claude 不會 commit，會告訴你 skill 放在哪，ctx-handoff 也不在新對話帶入自己那份。不想要就直接說，Claude 會還原改動，之後不再提。

整理只送上次之後的新對話給 Sonnet 5.5（effort low），短對話約 1,200 token、1.6 秒。像金鑰、密碼的內容不會寫進筆記。

### 停在哪裡

自動交接只涵蓋自動的情況。你自己打 `/clear`、Claude Code 當掉、或單純開了新對話，新的對話不知道上一段做到哪。所以每次整理筆記時，會順手替這個專案留一份很短的「目前進度」：任務、狀態（完成、進行中、卡住）、最後一次驗證的結果、一個下一步，以及最多 5 個相關檔案（全部約 600 字以內）。它和筆記在同一個請求裡產生，不多花請求；如果這次整理發現沒有實際的工作進展，就保留上一份。

同一個資料夾的下一段對話，開頭會被提醒一次（是給 Claude 看的提示）：「上一段對話（2 小時前）停在：任務…、狀態…、下一步…、相關檔案…」。你想接續，Claude 就從這裡開始；你在做別的事，它會忽略、不會主動提起。超過 24 小時、是同一段對話留下的、或那段對話已經自動交接過（交接摘要已涵蓋），就不提醒。`/handoff` 會顯示最近一份。設定：`resume_hint`。需要開著背景整理。

### 守門

同一條規則出現 3 次以上，`/handoff guard suggest` 會把它寫成工具呼叫的檢查，例如「git push 前沒跑測試」，可設成擋下或提醒。**要你 `/handoff guard on N` 核准才生效**；檢查本身出錯就放行。

### 三個防呆提醒

預設都開；都只是對 Claude 說一句話，不會擋你的工具。

- **重複失敗：** 同一個工具連續兩次因同樣原因失敗時，第二次的結果會附一句話，請 Claude 先找出原因、換個做法，不要原樣重試。每一段連續失敗只提醒一次，該工具成功就重新算。設定：`retry_nudge`。
- **說完成卻沒驗證：** Claude 說做完了、這一輪改過程式檔、之後沒跑任何測試、建置或檢查時，會請它先驗證並附上結果（沒辦法驗證就說明哪些沒驗證），一個回合最多一次。只改文件（`.md`、`.txt`）或你中斷的回合不算。Claude Code 會把這個請求顯示成「Stop hook feedback」，並可能提示 Stop hook error，那就是這個提醒，不是出錯。設定：`done_check`。
- **回覆語言：** Claude 的說明大部分不是你用的語言（繁體中文、簡體中文、英文或日文）時，會請它改用那個語言說明一次；程式碼、指令、路徑、連結、引用行、專有名詞與很短的句子都不算，所以夾英文術語的中文沒問題。提醒跟著下一個工具結果；那段回覆是最終回答的話，就跟著你的下一則訊息。每一段只提醒一次，有一則回覆符合語言就重新算。`auto` 跟著 Claude Code 的 `language` 設定（沒設，或只寫「中文」沒分繁簡，就不提醒）。你要它寫別種語言的內容（例如翻譯）時，也可能提醒一次。設定：`reply_language`。

### 面板

`/handoff panel` 在輸入框上方開面板，可以核准守門、看最近整理改了什麼、刪掉記錯的筆記（按兩次確認，會先備份）、把封存的記憶留下、調整設定。ctrl+x tab 後按 1–5 切分頁，再打一次指令關閉。

<img src="docs/panel.png" width="560" alt="輸入框上方的面板，停在規則分頁：上方是守門 4、記憶 52、規則 7、最近整理四個分頁，下面列出各條規則與出現次數，例如宣稱正式站版本前先讀實際部署的版本">

## 指令

平常用不到。如果 `/handoff` 已經被你自己的指令或 skill 佔用，會改成 `/ctx-handoff`。

| 指令 | 用途 |
|---|---|
| `/handoff` | 查看 context 用量、各功能狀態與最近的錯誤 |
| `/handoff now` | 立刻交接（會清空目前對話） |
| `/handoff dry` | 試寫一份交接摘要並顯示花費，不清空對話 |
| `/handoff distill` | 立刻整理一次專案筆記 |
| `/handoff resume` | 離開後回來：用交接摘要開新對話 |
| `/handoff continue` | 離開後回來：留在原本的對話 |
| `/handoff resend` | 交接摘要沒送到新對話時，再送一次 |
| `/handoff refresh on\|off` | 開關「離開時保持快取」 |
| `/handoff distill on\|off` | 開關專案筆記 |
| `/handoff panel` | 開關輸入框上方的面板 |
| `/handoff guard` | 列出守門；`suggest` 提草稿，`on\|off\|drop N` 核准／停用／刪除，`mode N deny\|remind` 切換擋下或提醒 |

## 調整設定

在面板的「設定」分頁調整（`/handoff panel` 後按 5）：數字用 `−`／`＋` 一格一格調，開關與選項按「切換」，「還原」拿掉面板的值。每一列標出值從哪來（面板、settings.json 或預設），按「展開」看說明。改了這個 session 馬上生效，其他 session 在下一則訊息套用。面板的值所有專案共用，更新 plugin 不會被覆蓋。這些設定不放在 `/config`，免得清單越來越長。

看不到面板的地方（VS Code 擴充功能），或想把設定寫在檔案裡，就加進 `~/.claude/settings.json`；面板設過的值優先於檔案：

```json
"pluginConfigs": { "ctx-handoff@ctx-handoff-mod": { "options": { "threshold": 400000, "idle_minutes": 50 } } }
```

用 clone 的話，鍵改成 `ctx-handoff@inline`。

| 設定 | 預設 | 意思 |
|---|---|---|
| `threshold` | `600000` | context 到多少 token 時交接 |
| `window_ratio` | `0.8` | 視窗較小時，改用「視窗 × 這個比例」當門檻 |
| `idle_minutes` | `55` | 閒置幾分鐘後保持快取（5–59） |
| `max_refresh` | `3` | 每段閒置最多保持幾次，之後改存交接摘要 |
| `min_tokens` | `30000` | 對話小於這個值時，不保持快取、不產生離席交接、不整理筆記 |
| `notes_model` | `claude-sonnet-5-5` | 整理筆記用的模型：Sonnet 5.5 或 Opus 5.5 |
| `language` | `auto` | 介面語言：`auto`、`en` 或 `zh-TW` |
| `retry_nudge` | `true` | 同一個失敗連續兩次時，請 Claude 換個做法 |
| `done_check` | `true` | Claude 改了檔案、沒跑測試或檢查就說完成時，請它先驗證一次 |
| `reply_language` | `auto` | 請 Claude 用你的語言說明：`auto`（跟著 Claude Code 的 `language`）、`off`、`zh-TW`、`zh-CN`、`en` 或 `ja` |
| `resume_hint` | `true` | 新對話開頭告訴 Claude 這個資料夾上一段對話停在哪（一天內的） |

超出允許範圍的值會被拉回範圍內。保持快取與專案筆記的開關在面板切換，或用 `/handoff refresh on|off`、`/handoff distill on|off`。

**門檻怎麼選**：一般經驗是模型品質在 200k～300k token 左右開始下滑。預設 600k 是為了少交接幾次；如果你發現交接前模型已經開始變差，就調低它。

## 費用、隱私與權限

**會花多少。** 所有請求都用你自己的 Claude Code 登入，和其他請求一樣計入用量：

- **交接：** 一次請求，讀整段對話（大多從快取讀）並寫出摘要；800k token 的對話約 30 秒。
- **離開時保持快取：** 每次是一個很小的請求，從快取讀整段對話，價格約是一般輸入的十分之一。每段閒置最多 3 次。
- **專案筆記：** 只送新增的對話給 Sonnet 5.5（effort low），短的一次約 1,200 token。「停在哪裡」的進度在同一個請求裡一起產生。

**哪些資料會送出去。** 只會經由 Claude Code 送到 Anthropic，和你的對話本身去的地方相同。整理筆記時會送出你的訊息、Claude 的回覆與工具呼叫（每個輸入取前 300 字、結果取前 500 字），總長最多 30 萬字。看起來像金鑰或密碼的筆記，寫檔前就會丟掉。

**存在本機的檔案：**

| 內容 | 位置 |
|---|---|
| 專案筆記 | `~/.claude/projects/<專案路徑>/memory/ctx-handoff.md` |
| 從面板刪除的筆記備份 | 筆記檔旁邊的 `.ctx-handoff-backup/` |
| 最近的交接摘要、最近一份「停在哪裡」的進度、錯誤紀錄與設定 | `~/.claude/plugins/store/ctx-handoff_*.json` |

**它能做哪些事。** mod 沒有沙箱，這個 mod 用你的權限執行。不用執行就能檢查它用了什麼：`claude plugin validate <ctx-handoff 資料夾>` 會印出 `hooks:`（它接收的事件）與 `calls:`（程式呼叫了什麼）兩行。對 ctx-handoff 來說：

| 輸出裡的項目 | 用途 |
|---|---|
| `tool.call` | 套用你核准的守門（沒核准就不擋）；留意工具是否連續兩次失敗，以及這一輪改了哪些檔案、跑了哪些測試；附上回覆語言提醒 |
| `turn.step` | 讀主對話每則回覆的可見文字，只用來判斷語言；不改請求、模型或回覆 |
| `prompt.submit`、`prompt.context` | 交接中暫存你的訊息；把專案筆記與上一段對話停在哪帶入新對話 |
| `$.session.messages`、`$.model.complete`、`$.model.fork` | 讀對話來寫筆記與交接摘要 |
| `$.fs.read`、`$.fs.write`、`$.fs.exists` | 讀寫筆記檔與備份；確認專案是不是 git repo |
| `$.prompt.submit`、`$.command.run` | 把摘要送進新對話；執行 `/clear` |
| `$.env.get` | 讀三個環境變數 `CLAUDE_CONFIG_DIR`、`HOME`、`USERPROFILE`，只用來找到你的 `~/.claude` 資料夾，不需要另外設定 |
| `$.tool.register` | 給 Claude 一個工具 `mark_in_project`，用來回報規則或流程放進 repo 的哪裡 |
| `$.settings.read`、`config.set` | 讀 Claude Code 的 `language` 設定與這個 plugin 在 `pluginConfigs` 的設定；你改 Claude Code 的設定時跟著更新 |
| 其餘：`session.start`、`turn.complete`、`classic.Stop`、`command.run`、`$.command.register`、`ui.render`、`$.store`、`$.state`、`$.clock`、`$.ui`、`$.agent.list`、`$.session.*` | 日常運作：計時、`/handoff` 指令、狀態列、面板與提示、自己的儲存空間，交接前確認 Claude 和子代理都做完了，以及 Claude 說完成卻沒跑檢查時請它先驗證一次 |

它自己不發網路請求，也不啟動其他程式（沒有 `$.http` 或 `$.process` 呼叫）。想在不載入它或任何 mod 的情況下開 session，用 `claude --safe-mode` 啟動。另見 [`SECURITY.md`](SECURITY.md)。

## 疑難排解

先輸入 `/handoff`：它會顯示 context 用量、各功能是否開啟，以及背景最近一次的錯誤。

| 狀況 | 怎麼查 |
|---|---|
| 沒有 `/handoff` 指令 | mod 沒載入。執行 `claude plugin list` 並確認 Claude Code 版本；clone 的版本要確認路徑是絕對路徑。如果你自己有 `/handoff`，改用 `/ctx-handoff`。 |
| 行為怪怪的，懷疑是 mod 造成 | 用 `claude --safe-mode` 啟動（不載入任何已安裝的 mod），看問題是否消失。 |
| 新對話沒收到交接摘要 | 執行 `/handoff resend`。 |
| 筆記一直沒更新 | 小於 30k token 的對話會跳過。執行 `/handoff distill`，再用 `/handoff` 看有沒有錯誤。 |
| 指令沒有回應 | 用 `/handoff` 看最近的錯誤，附上輸出[開一個 issue](https://github.com/cablate/ctx-handoff-mod/issues/new/choose)。 |

## 移除

1. 從 marketplace 安裝的：執行 `claude plugin uninstall ctx-handoff@ctx-handoff-mod`。用 clone 的：從 `~/.claude/settings.json` 的 `CLAUDE_CODE_PLUGIN_DIRS` 拿掉路徑（或不再加 `--plugin-dir`），再刪掉資料夾。
2. 可選：刪除[存在本機的檔案](#費用隱私與權限)，解除安裝不會刪掉它們。專案筆記是一般的 Markdown，也可以留著自己用。

只想暫時關掉，在 `/plugin` 停用就好。

## 在哪裡能用

Claude Code 大多數執行環境都會載入 mod，但只有終端機和 Desktop 會畫出 mod 的畫面（[Claude Code 文件](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run)）。

| 環境 | 背景功能（交接、筆記、守門） | 狀態列與面板 | 確認方式 |
|---|---|---|---|
| 終端機裡的 `claude`（含編輯器內建終端機、JetBrains） | 可以 | 可以 | 實測 |
| `claude -p` | 可以；`/handoff` 以文字回覆 | 不行 | 實測 |
| Desktop 的 Code 分頁 | 可以 | 可以 | 依官方文件 |
| VS Code 擴充功能的聊天面板 | 可以 | 不行 | 依官方文件 |
| Desktop 的 WSL session | 不行（那裡不載入 plugin） | 不行 | 依官方文件 |

## 限制

- **5 分鐘快取的使用者請關掉保持快取。** 用 API key、Bedrock、Vertex，或訂閱額度用完、開始扣 usage credits 時，快取只有 5 分鐘，55 分鐘後的請求反而要重寫整段快取。請執行 `/handoff refresh off`，它不會自動判斷。
- **筆記跟著啟動的資料夾走。** 在家目錄開 Claude Code 處理別的專案，筆記會記在家目錄。
- **「停在哪裡」只跟著最近一次整理一樣新。** 整理是每 30 則訊息、閒置 55 分鐘、交接前，或打 `/handoff distill` 才跑（不到 30k token 的對話不整理），所以短對話或當機後，進度可能沒有、或落後幾則訊息。想要精準，`/clear` 之前先打 `/handoff distill`。
- **同一個資料夾開兩個對話會互看到進度。** 較晚開的對話會被告知另一個對話的進度，像是已經結束的一樣；不符合你在做的事時，Claude 會被要求忽略。
- **交接中更新 mod 或改設定，暫存的訊息可能遺失。** 保持快取的計時不受影響。

## 版本紀錄

見 [`CHANGELOG.md`](CHANGELOG.md)（英文），包含從 0.1 升級要注意的事。

## 參與開發

問題回報與想法歡迎開 [issue](https://github.com/cablate/ctx-handoff-mod/issues/new/choose)。想改程式請看 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 授權

[MIT](LICENSE)
