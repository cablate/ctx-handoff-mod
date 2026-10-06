# ctx-handoff

[English](README.md)

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

**目前狀態**：實驗性。它使用 Claude Code 還在測試中的 mod 功能，Claude Code 更新後可能需要跟著調整。介面訊息是繁體中文。

## 快速開始

需要支援 mod（function hooks）的 Claude Code，已在 2.1.287～2.1.289 測試。

```sh
git clone https://github.com/cablate/ctx-handoff-mod ~/.claude/mods/ctx-handoff
claude --plugin-dir ~/.claude/mods/ctx-handoff
```

在開啟的 session 輸入 `/handoff`，看到類似下面的狀態就代表裝好了：

```
[ctx-handoff] context 12034 / 門檻 600000（視窗 1000000）
快取刷新 on，本次閒置已刷新 0/3，計時器未啟動
```

想讓每個 session 都自動載入，在 `~/.claude/settings.json` 的 `env` 加上絕對路徑（Windows 多個路徑用 `;` 分隔，macOS／Linux 用 `:`）：

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/you/.claude/mods/ctx-handoff" }
```

## 它會做什麼

### 對話快滿時自動交接

context 達到 600k token（視窗較小時是 80%）後，等 Claude 回完這一輪、手邊的背景工作和子代理也結束，就寫一份交接摘要、清空對話，把摘要送進新對話。新對話會先回報它理解的進度，再等你下一步指示。

如果背景工作一直沒結束（例如開著 dev server），最晚在超過門檻 150k token 時（且不超過視窗 90%）也會交接；想提早交接就打 `/handoff now`。

交接時你正在打的訊息不會不見，會跟摘要一起送進新對話。圖片等附件無法暫存，畫面會提醒你重新貼上。

### 離開時保持快取

閒置約 55 分鐘時，送一個極小的請求讓對話快取保持有效，最多 3 次（約 4 小時）。再久就存一份交接摘要但**不清空**對話。你回來打第一則訊息時，它會先停下來讓你選：

- `/handoff resume`：開新對話，帶上摘要和你剛打的訊息
- `/handoff continue`：留在原本的對話繼續

### 專案筆記

每隔一段對話，它會把你糾正過、交代過的事整理成這個專案的筆記，開新對話時自動帶入：

- **記憶**：分成偏好、修正、事實、位置四類。偏好與修正（要找得到你親口說過的話才算）整條帶入；事實與位置只帶標題，Claude 需要時再打開筆記看細節。事實與位置超過 30 天沒再被證實就封存：不帶入、不刪除，之後再被證實會自動恢復。
- **規則**：重複出現的做法，例如「Bash 路徑用正斜線（3 次）」。出現 2 次以上的才帶入，最多 15 條。

筆記是一般的 Markdown 檔，位置是 `~/.claude/projects/<專案路徑>/memory/ctx-handoff.md`，可以直接打開修改。有變動時會跳出提示，寫出改了幾項和檔案位置。

整理只送出上次整理之後的新對話，交給 Sonnet 5.5（effort low）處理。一段短對話的實測是約 1,200 token 輸入、1.6 秒。看起來像金鑰或密碼的內容會被擋下，不會寫進筆記。

### 守門：把常犯的錯變成自動檢查

同一條規則出現 3 次以上，可以打 `/handoff guard suggest`，請模型把它寫成工具呼叫的檢查（例如「git push 前沒跑測試」），選擇直接擋下或只提醒。草稿會先拿這段對話跑過的工具呼叫試比對，**你核准（`/handoff guard on N`）才會生效**。檢查本身出錯時一律放行，不會擋住正常工作。

### 面板

`/handoff panel` 在輸入框上方開一個面板，分成守門、記憶、規則、最近整理四頁：

- 核准、停用或刪除守門草稿
- 看最近一次整理改了什麼
- 刪掉記錯的記憶或規則（要按兩次確認，刪之前會備份原檔）
- 封存的記憶按「留下」就恢復帶入

可以直接用滑鼠點，或按 ctrl+x tab 讓面板接收鍵盤，再按 1–4 切換分頁。再打一次 `/handoff panel` 就關閉。

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

設定是 [`hooks/register.ts`](hooks/register.ts) 開頭的常數，改完存檔就會生效。

| 常數 | 預設 | 意思 |
|---|---|---|
| `THRESHOLD` | `600_000` | context 到多少 token 時交接 |
| `WINDOW_RATIO` | `0.8` | 視窗較小時，改用「視窗 × 這個比例」當門檻 |
| `IDLE_MS` | 55 分鐘 | 閒置多久後保持快取 |
| `MAX_REFRESH` | `3` | 最多保持幾次，之後改存交接摘要 |
| `MIN_TOKENS` | `30_000` | 對話小於這個值時，不保持快取、不整理筆記 |
| `DISTILL_MODEL` | `claude-sonnet-5-5` | 整理筆記用的模型 |

**門檻怎麼選**：一般經驗是模型品質在 200k～300k token 左右開始下滑。預設 600k 是為了少交接幾次；如果你發現交接前模型已經開始變差，就調低它。

## 限制

- **5 分鐘快取的使用者請關掉保持快取。** 用 API key、Bedrock、Vertex，或訂閱額度用完、開始扣 usage credits 時，快取只有 5 分鐘，55 分鐘後的請求反而要重寫整段快取。請執行 `/handoff refresh off`，它不會自動判斷。
- **保持快取的效果尚未完全確認。** 目前還不確定這個請求能否真正延長主對話的快取。
- **筆記跟著啟動的資料夾走。** 在家目錄開 Claude Code 處理別的專案，筆記會記在家目錄。
- **交接進行中更新 mod 或改設定，暫存的訊息可能遺失。** 離開時保持快取的計時不受影響，更新後照原本的時間接著跑。

## 從 0.1 升級

0.2 改成每個專案資料夾只有一份筆記，不再把筆記寫進 session 中途碰到的其他 repo。舊版放錯位置的筆記不會自動搬移，可以手動搬，或用 `node tools/notes.mjs`（見 [`tools/README.md`](tools/README.md)）。

## 參與開發

開發流程與設計說明在 [`CLAUDE.md`](CLAUDE.md)，工具一覽在 [`tools/README.md`](tools/README.md)。送出修改前請跑 `node tools/check.mjs`。

## 授權

[MIT](LICENSE)
