> **後續版本注意：v2.7.0.43 已把有效入口由 `proxy.ts` 改為 `proxy.js`；下文是 .42 當時的歷史記錄，不適用於 .43 的部署操作。**

# StockZone v2.7.0.42｜部署 Schema 根因修正

本版以 v2.7.0.41 為基準，修復 Vercel 建置錯誤：`proxy.entrypoint` 不接受 `.mjs`；官方 Schema 僅允許 `.js`／`.ts`／`.py`。

## 更正內容

- 將 `proxy.mjs` 正式改名成 `proxy.ts`，原始授權流程內容不變。
- `vercel.json` 的 `proxy.entrypoint` 同步變更為 `proxy.ts`。
- 補上 `validate:v27042`：使用 Vercel 官方 Schema 的 entrypoint 正則，核對檔案存在、既有 Cron 與 API rewrites 未遺失。
- 修復歷史測試腳本的硬編碼版本號；五年 R1 回測公式校驗改成固定的原始版雜湊值，不依賴 ZIP 之外的 v40 資料夾。
- 沒有更動任何 W3、XY、原 R1 回測計算公式、Neon 與 23 筆排程定義。

## 目前 GitHub 已上傳 .41 時（重要）

**CHANGE ONLY 是覆蓋式更新，無法自行刪除舊檔。** 請先在 GitHub 刪除專案根目錄的 `proxy.mjs`，再按原目錄上傳本版 CHANGE ONLY 的新增與修改檔案，確認根目錄只剩 `proxy.ts`。

若改用完整 ZIP 重新建立來源目錄，該包本身沒有 `proxy.mjs`。

Vercel 的 build failed 部署不會取代上一個 READY Production。部署成功後再檢查 Cron、授權及股票功能；在啟用封鎖前 `SZ_ACCESS_ENFORCED` 應為 `0`。
