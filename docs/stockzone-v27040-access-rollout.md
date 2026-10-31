# StockZone v2.7.0.40｜專屬授權連結、安全啟用流程

## 版本與範圍

- 原始程式：v2.7.0.39；本版：v2.7.0.40。
- 固定 Production 網址：`https://tw-stock-test.vercel.app`，**不更改網域**。
- 保留原本 XY、W3、五年回測、持股資料與 Vercel Cron 23 筆配置；原有 8 個 API 透過統一驗證入口保護。
- 一般使用者無需註冊、登入 Email 或使用 Vercel；管理員使用自己設定在 Vercel 的啟用密鑰，授權瀏覽器後可直接操作。
- 邀請連結是一次性、預設 48 小時有效；啟用後以安全 HttpOnly Cookie 保存授權，會在 365 天後到期，需重新授權。個別邀請與個別裝置均可撤銷。
- 本版新增一個 `/api/access` Vercel Function、`proxy.js`，並加入一張管理頁與一張使用者授權頁。
- **預設不封鎖**：只有 `SZ_ACCESS_ENFORCED=1` 時才會真正保護主站，避免首次部署鎖住網站。

## 部署前：先保護舊的 Preview／部署網址

在 Vercel → `tw-stock-test` → Security → Deployment Protection，選擇 Vercel Authentication 的 **Standard Protection**。它保護 Preview 與非主要 Production 網域，對外使用者仍能透過正式 Production 網址使用我們自行建立的裝置授權。請特別確認不能選 All Deployments，否則訪客會被 Vercel 自身登入頁攔住（與免登入需求衝突）。

## 步驟 1：Neon（只新增授權資料表，不改原本股票資料）

在 StockZone 連接的**正式 Neon 資料庫**的 SQL Editor 執行 `docs/stockzone-v27040-access-schema.sql` 內容。它只做 `CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`，不觸及行情、法人、分類、持股、W3 或 XY 表。

若在 Neon 使用多個 Project／Branch，先核對 Vercel Production 的資料庫連線所指向的 Project 與 Branch；不要執行在研究用 Supabase 或不相關的 Neon Branch。

## 步驟 2：Vercel Production 環境變數

在 Vercel → `tw-stock-test` → Settings → Environment Variables 新增（只選 **Production**）：

| Key | Value | 用途 |
|---|---|---|
| `CRON_SECRET` | 自行產生至少 16 位、建議 32 字節以上的隨機密鑰 | Vercel 會在排程請求加上 `Authorization: Bearer ...`；現有同步 API 開始驗證 |
| `SZ_ACCESS_ADMIN_SECRET` | 自行產生至少 32 個字元的**不同**高強度隨機密鑰 | 管理員第一次取得管理權 |
| `SZ_ACCESS_ENFORCED` | `0` | 第一輪先不上鎖 |

不要把任何密鑰貼進聊天室、Git、ZIP 或網站 HTML。可用可信的密碼管理器產生、備份密鑰。新的 Production 環境變數要在**下一次 Production 部署後**才會被新執行個體使用。

## 步驟 3：第一次部署（不上鎖）

- 依你已部署的版本，將對應 CHANGE ONLY ZIP 覆蓋（保留目錄階層）並部署到同一個 Vercel 專案 `tw-stock-test`，不要建立新專案。
- 網址 `https://tw-stock-test.vercel.app` 保持不變；此時 `SZ_ACCESS_ENFORCED=0`，老使用者仍可正常使用。
- 檢查行情、W3、XY、Neon 讀取；到 Vercel → Cron Jobs／Runtime Logs 核對 23 個排程路由未被誤擋（完整定時運作需到相應交易日才能確認）。

## 步驟 4：讓自己取得管理員授權

- 開啟 `https://tw-stock-test.vercel.app/access-admin.html`。
- 在「管理員啟用密鑰」輸入自己在 Vercel 設定的 `SZ_ACCESS_ADMIN_SECRET`，按「驗證管理員」。
- 看到「產生一次性專屬連結」及授權清單，代表管理員角色已正常建立；密鑰不要傳送給一般使用者。
- 管理員裝置的 Cookie 也有 365 天期限；遺失時可用原管理密鑰從自己的新瀏覽器重新取得管理權。

## 步驟 5：真正啟用封鎖

- 以上項目確認後，將 Vercel Production 環境變數 `SZ_ACCESS_ENFORCED` 改成 `1`。
- **重新部署 Production** 讓設定生效，不是只改環境變數就完成。
- 新的無痕瀏覽器開啟正式網址，應看到「此裝置尚未授權」，`/api/quote` 未帶 Cookie 應回傳 HTTP 401。
- 舊的管理員瀏覽器仍應可進入管理頁與 StockZone。
- 用新裝置測試一條一次性邀請連結：首次啟用成功 → 再用相同連結啟用其他瀏覽器失敗 → 已授權裝置能正常看股票資料 → 在管理頁撤銷 → 下次請求被拒絕。
- 一般使用者對原本手動更新的 POST API 應收到 403；管理員仍能執行正常管理操作。再次檢查 Cron Logs 沒有 401／503（要等待實際排程或安全地對照日誌，不需要手動強制觸發股票更新）。

## 步驟 6：邀請指定朋友

進入 `https://tw-stock-test.vercel.app/access-admin.html` → 輸入「備註」（例如朋友 A 的手機）→ 指定有效時間（預設 48 小時）→「產生一次性專屬連結」→「複製連結」→ 私訊給指定的人。朋友打開連結、按「啟用這台裝置」，日後直接開同一個 Production 網址即可。

「一次性」指連結只能被啟用一次；啟用的是**此瀏覽器的 Cookie**，不是真正無法複製的硬體身分。換裝置、清空 Cookie、改網址需重新授權；已啟用的瀏覽器授權有效期限 365 天，也可提前撤銷。

## 若出現異常

- 未授權的人仍能看到主頁：先檢查 `SZ_ACCESS_ENFORCED` 是否真的設為 `1` 且重新部署的是 Production，並檢查 Deployment Protection 是否至少為 Standard。
- 所有受保護 API 回 503：先確定正式 Neon 中授權表存在，檢查 Production 的 Neon 連線與 runtime logs；授權採用失敗即拒絕，不會放行。
- Cron 回 401：確認 `CRON_SECRET` 在 Production 設好且符合長度；不要把它加到 Git 或 URL；檢查當次 Cron 排程 URI 與 `vercel.json` 一致。
- 管理員失去裝置：重新開啟 `/access-admin.html`，使用保管的管理密鑰取得新管理員 Cookie。
- 緊急恢復：將 `SZ_ACCESS_ENFORCED` 設回 `0` 並重新部署**同一版本**，即可關閉授權閘門；這會重新開放原本網站，僅供應急排錯。
- 任何不可預期的 Vercel Routing Middleware 行為，必須先經實際 Preview／Production 驗證；本機 Node 測試不能代替正式 Vercel 端到端測試。

## 技術備註

- 原本的 `.39` 核心公式原始檔不變；此版只處理授權與版本號。
- DB 僅新增兩張授權表：`sz_access_invites` 與 `sz_access_sessions`。
- Token 使用 32 bytes CSPRNG，Neon 僅存 SHA-256 雜湊；Cookie `__Host-` 前綴、`Secure`、`HttpOnly`、`SameSite=Lax`。
- `proxy.js` 是對靜態頁面、JS 與 API 的保護層；每個既有 API 還有獨立、共用的伺服器端驗證，避免只靠 UI 保護。
- 每次請求都從 Neon 查有效會話，支援立即撤銷；這會增加一些 Neon 查詢與傳輸，正式啟用後應監控費用與延遲。
- 若有未加入此 Vercel 專案的其他外部入口或歷史獨立網域，也必須另外檢查；僅保護目前專案不代表已保護所有外部副本。
