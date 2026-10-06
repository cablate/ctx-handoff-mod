# tools

開發與驗證用的指令。都用 Node 22 執行，不需要安裝套件。

| 工具 | 用途 | 誕生事件 | 觸發訊號 |
|---|---|---|---|
| `check.mjs [資料夾] [--skip-tsc]` | 一次跑 plugin validate、plugin test、tsc、`node --test tools/*.test.mjs`、公開資訊掃描；只印每步一行，失敗才印細節 | 每次驗證都要手動設 Git Bash 路徑、分開跑三個指令，tsc 設定兩度指向已刪除的 worktree；推送前的個資檢查靠手動 grep（2026-10-05） | `FAIL` 行；`public` 抓到的檔案與行號 |
| `wt.mjs new\|land <分支>` | 在暫存 worktree 改 mod，`land` 時先跑 `check.mjs`，通過才 fast-forward 回主資料夾 | 修改熱重載中的 mod 時手動建 worktree、複製型別檔、合併，前後做了 3 次（2026-10-04～05） | `land` 拒絕合併（未 commit、檢查沒過、主資料夾有變更） |
| `status.mjs [--logs N]` | 唯讀：各專案經驗檔大小與帶入量、最近一次整理與失敗、每個執行中 session 最後一次熱重載與最後幾則 ctx-handoff 訊息 | 查「其他 session 有沒有整理、卡在哪」時每次手寫 node 腳本讀 store 與對話檔（2026-10-05 一天 4 次）；第一次執行就抓到 `/handoff` 被使用者 skill 佔用的問題 | 輸出裡的失敗原因、沒有熱重載紀錄的 session |
| `notes.mjs list\|apply\|roundtrip` | 以條目為單位查看與修改經驗檔：刪除、取代、剪掉片段、補充、規則縮成一行、跨專案搬移；預設預演，`--write` 才寫並備份。`roundtrip` 是回歸檢查：每份真實經驗檔解析再輸出要逐位元相同，改解析或輸出後跑 | 收斂經驗檔時同一天手寫 4 支形狀相同的改檔腳本（2026-10-05） | 「比對到 N 條」停止訊息；`.ctx-handoff-backup/` 裡的備份；`roundtrip` 的 `DIFF` 行 |

`lib.mjs` 是共用的經驗檔解析（和 `hooks/register.ts` 的 `parseNotes` 同規則），`notes.test.mjs` 是 `notes.mjs` 的固定測試。
