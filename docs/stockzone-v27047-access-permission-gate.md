# StockZone v2.7.0.47｜專屬授權連結啟用前安全整合

## 本次修正

- 現有授權核心（一次性連結、Neon 授權紀錄、HttpOnly Cookie、撤銷）繼續沿用 .46，不建立第二套授權。
- 同一個 `lib/access-server.js` 統一檢查一般使用者的唯讀 API，避免把 GET 當成全部安全：一般使用者的資料重建、歷史補掃、Cron 端點與開發者維護操作一律拒絕。
- 保留管理員原本的權限，以及原本的 Cron 身分驗證流程；沒有修改 `vercel.json` 的 23 個排程／3 個 Rewrite。
- 五年 R1、W3、XY、共振與股價資料的演算法、輸入資料均不修改。

## 已完成的正式 Neon 準備（2026-10-31）

- `stockzone-db` 已建立 `public.sz_access_invites` 與 `public.sz_access_sessions`。
- 只新增專用資料表和索引，沒有修改既有股票資料表。
- 不必再次執行 2.7.0.40 的 schema SQL。

## 啟用步驟：嚴格兩階段

1. Vercel `tw-stock-test` 專案的 Environment Variables → Production 新增 `CRON_SECRET`（獨立隨機值 32+ 字元）、`SZ_ACCESS_ADMIN_SECRET`（另一組 32+ 字元）；再設定 `SZ_ACCESS_ENFORCED=0`。
2. 部署 .47，確認正常；開啟正式網域 `/access-admin.html`，使用自己設定的管理員密鑰登入，取得管理員 Cookie，建立／撤銷一筆測試邀請。
3. 對照 Vercel Cron Jobs 最近實際執行紀錄與回傳結果；重要：原程式的正式排程既有 `x-vercel-cron-schedule` 路由辨識，Vercel 官方目前只明確保證會提供 `Authorization: Bearer CRON_SECRET`，不能僅靠本地測試宣布全部 23 個 Cron 已安全通過。
4. 保護舊版 Preview 與自動生成部署網域：Vercel Authentication 的 Standard Protection；正式網域持續由 StockZone 自己驗證，不能將 All Deployments 打開，否則朋友會被要求使用 Vercel 帳號。
5. **前三步及無痕／跨裝置測試確認前，絕對不要將 `SZ_ACCESS_ENFORCED` 改成 `1`。** 否則可能使 Cron 或正式網站無法存取。
6. 最後確認無痕／未授權 HTTP 401、管理員使用正常、一次性邀請使用後失效、受邀使用者不能呼叫資料維護 API、撤銷後無法繼續使用，再啟用正式封鎖。

## 注意

- 密鑰只在 Vercel 控制台輸入，不要貼到聊天、原始碼或 ZIP。
- 「裝置授權」是同一瀏覽器的安全 Cookie，不是硬體 ID；清 Cookie、換手機或到期需要重新授權。
- 任何重新部署都不需要重新發送已啟用的邀請；只要沿用相同的 Production 網址、Neon 授權表與環境變數。
- 本次 CHANGE ONLY 覆蓋 .46，不包含原始資料搬遷或 Neon schema 重建。
