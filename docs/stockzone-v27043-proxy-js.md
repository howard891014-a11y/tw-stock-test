# StockZone v2.7.0.43｜proxy.js 正式入口

本版由 v2.7.0.42 改版，因部分 Android 裝置將 `.ts` 視為 MPEG Transport Stream 影片，改用 `.js` 作為 Vercel proxy 入口。

## 版本修改

- 根目錄 `proxy.ts` **改名**為 `proxy.js`（逐位元組相同，程式邏輯無修改）。
- `vercel.json` 的 `proxy.entrypoint` 改為 `proxy.js`。
- `index.html`、`app.js`、`package.json` 統一版本為 v2.7.0.43。
- 將既有校驗腳本、操作文件同步更新，新增 `validate:v27043` 和 `validate:release43`。
- 五年 R1、XY、W3、共振、API、資料庫和排程未調整。

## 重要：上傳 GitHub 時必須刪除舊檔

CHANGE ONLY 是新增/覆蓋檔案，**無法自動刪除 GitHub 已存在的舊檔**。

1. 上傳 .42 → .43 CHANGE ONLY 中的所有檔案，保留相對目錄。
2. **在 GitHub 儲存庫根目錄，刪除舊 `proxy.ts`。若仍有 `proxy.mjs`，也要刪掉。**
3. 最終確認根目錄僅有 `proxy.js` 一個 proxy 入口，`vercel.json` 指向 `proxy.js`。
4. 推送到 main 後查看 Vercel 最新 Production 建置是否 READY。
5. 專屬授權尚未完成端到端驗證前，維持 `SZ_ACCESS_ENFORCED=0`，不可提前封鎖。

變更網址、Neon 資料和 API 端點都不需要。
