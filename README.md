# 台股目標價提醒 v2.5.1（Vercel 部署修正版）

請將本資料夾中的內容直接放在 GitHub Repository 根目錄：

- index.html
- app.js
- style.css
- package.json
- vercel.json
- README.md
- api/quote.mjs
- api/targets.mjs

Vercel 設定：
- Framework Preset：Other
- Root Directory：留空
- Build Command：留空
- Output Directory：留空

部署後先測試：
- `/api/quote?code=3017`
- `/api/targets?code=3017&name=奇鋐`

兩個網址都應回傳 JSON，而不是 404 頁面。


## v2.5.1 修正
- 移除 vercel.json 內不適用於官方 Node.js Runtime 的 runtime 設定。
- /api 內的 .mjs 檔會由 Vercel 自動辨識為 Node.js Functions。


## v2.5.2 部署修正
- API 改為 Vercel 最穩定辨識的 `api/*.js` CommonJS Functions。
- 移除 `vercel.json`，改用 Vercel Zero Config 自動偵測。
- GitHub 根目錄必須直接看到 `index.html`、`app.js`、`style.css`、`package.json`、`README.md` 與 `api` 資料夾。
