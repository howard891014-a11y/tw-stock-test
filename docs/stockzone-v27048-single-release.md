# StockZone v2.7.0.48 — 單次正式部署啟用授權

- 以 `.46` 直接升級 `.48`；`.47` 內容已合併。
- 正式 Neon 只增加 `sz_access_invites.role` 欄位；原始股價、W3、XY、R1 完全不變。
- 事先將 Vercel Production 設好 `CRON_SECRET`、`SZ_ACCESS_ADMIN_SECRET`、`SZ_ACCESS_ENFORCED=1`。所有值由平台保管，不放入 ZIP。
- 先經本機驗證，再部署到 `tw-stock-test` Production 一次。
- 部署後由管理員使用一次性管理員啟用連結，開啟 `/access.html#invite=...` 取得 365 天瀏覽器授權。
- 管理員開 `/access-admin.html`，產生給朋友的單次邀請；朋友啟用後不必登入。
- 一次性管理員連結必須在有效期內使用，不可轉傳。清除 Cookie 或更換瀏覽器需重新授權。
- 新增 API 必須沿用統一伺服器授權，不能直接繞過。
- Cron 仍需正式環境實測執行紀錄，不能以本機測試宣稱已百分百驗證。緊急狀態可回滾上一個 READY Production，沒有必要重新修改股票資料。
- Standard Deployment Protection 保護舊部署及 Preview；Production 網址由 StockZone 自己的 session 授權保護。
