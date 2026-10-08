# tools

開發與驗證用的指令。都用 Node 22 執行，不需要安裝套件。

| 工具 | 用途 | 誕生事件 | 觸發訊號 |
|---|---|---|---|
| `check.mjs [資料夾] [--skip-tsc]` | 一次跑 plugin validate、plugin test、tsc、`node --test tools/*.test.mjs`、公開資訊掃描（追蹤中的檔案與所有分支的 git 歷史）；只印每步一行，失敗才印細節 | 每次驗證都要手動設 Git Bash 路徑、分開跑三個指令，tsc 設定兩度指向已刪除的 worktree；推送前的個資檢查靠手動 grep（2026-10-05） | `FAIL` 行；`public` 抓到的檔案與行號 |
| `wt.mjs new\|land <分支>` | 在暫存 worktree 改 mod，`land` 時先跑 `check.mjs`，通過才 fast-forward 回主資料夾 | 修改熱重載中的 mod 時手動建 worktree、複製型別檔、合併，前後做了 3 次（2026-10-04～05） | `land` 拒絕合併（未 commit、檢查沒過、主資料夾有變更） |
| `status.mjs [--logs N]` | 唯讀：各專案經驗檔大小與帶入量、最近一次整理與失敗、累計統計（交接、整理、離席選擇、攔下的訊息、守門命中）、每個執行中 session 最後一次熱重載與最後幾則 ctx-handoff 訊息 | 查「其他 session 有沒有整理、卡在哪」時每次手寫 node 腳本讀 store 與對話檔（2026-10-05 一天 4 次）；第一次執行就抓到 `/handoff` 被使用者 skill 佔用的問題 | 輸出裡的失敗原因、沒有熱重載紀錄的 session |
| `notes.mjs list\|apply\|roundtrip` | 以條目為單位查看與修改經驗檔：刪除（記憶、規則、流程）、取代、剪掉片段、補充、規則縮成一行、跨專案搬移；預設預演，`--write` 才寫並備份。`roundtrip` 是回歸檢查：每份真實經驗檔解析再輸出要逐位元相同，改解析或輸出後跑 | 收斂經驗檔時同一天手寫 4 支形狀相同的改檔腳本（2026-10-05） | 「比對到 N 條」停止訊息；`.ctx-handoff-backup/` 裡的備份；`roundtrip` 的 `DIFF` 行 |
| `docs.mjs check|release <版本>` | `check`：英文正本與繁中版（`X.md` ↔ `X.zh-TW.md`）的章節、清單、表格、圖片、程式碼區塊、連結與行內程式碼要對上；`release`：從兩份 CHANGELOG 產生 GitHub Release 內文（英文在前、繁中在後、附比較連結）。不依賴本 repo，可以整個檔案複製到別的專案 | 雙語文件改了一邊忘了另一邊、Release 只有英文（2026-10-08 決定所有對外文件雙語） | `check` 的 `✗` 行；`release` 說找不到版本 |
| `eval-handoff.mjs build\|judge\|report` | 交接摘要的評估：真實交接當題目，交接之後新對話實際發生的事（使用者補充或糾正、AI 重查、做錯）當答案，評審模型（`claude -p`，不帶工具、不載入 mod）列出摘要漏了或寫錯什麼並打 1–5 分；`--label` 分開比較新舊提示詞。題目與結果是真實對話，放在 `<claude>/ctx-handoff-eval/`，不進 repo | 使用者反映交接摘要資訊量偏少，但沒有方法知道少了什麼、改提示詞後有沒有變好（2026-10-09 北極星討論） | 平均分數下降；同一種缺漏反覆出現 |

`lib.mjs` 是共用的經驗檔解析（和 `hooks/notes.ts` 的 `parseNotes` 同規則），`notes.test.mjs` 是 `notes.mjs` 的固定測試。
