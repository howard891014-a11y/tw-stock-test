# D第三階段：排程API與私有日記工作流技術備忘

`vercel.json`：原7次任務保持；新增 `/api/market-dynamic-refresh?paper=stage3`, `15 22 * * 1-5`。

既有 `api/market-dynamic-refresh.js` 僅在明確 `paper=stage3` 時執行 `lib/stockzone-d-paper-cron.js`。要求 GET、固定排程標頭、Vercel cron UA、常數時間比較 `CRON_SECRET` Bearer、特徵旗標以及私有 Blob token。未啟用/環境不足直接200回傳 `D_PAPER_DISABLED`（零讀寫）；啟用後未授權401；寫入流程一律 Fail Closed。

日內流程 `runDailyCycle()`：讀Neon最新股票歷史交易日(至少1500檔有效價)、前一交易日、列出私有Blob既存訊號與成交日期。新日 E 若已有前一交易日 T=Prev(E) 的封存訊號，先透過第二階段 `settleNext` 完成E日開盤模擬成交。若不存在此前訊號且有舊執行/訊號鏈則停止；只有完全全新空日記容許首次初始化。再從當天原始 JS 完整預覽凍結今日T日新訊號。缺任一資料則報錯／停止。

每日Cron於收盤後次日臺北06:15執行，並沒有在當日股市收盤立即產生推薦的強制保證。如果官方資料在次日開盤前仍不到齊，不能再將晚到訊號追認為前日已知。

`STOCKZONE_D_PAPER_ENABLED` 和 `CRON_SECRET` 尚未設置於Vercel，故交付時**不可宣稱系統已自動在跑**。

預期保留: `stockzone/d-forward/v1/signals/YYYY-MM-DD.json`, `executions/YYYY-MM-DD.json`（private Blob），開啟後僅記研究日記、無Neon writes/no stock orders。

指數開盤價尚無可獨立核實的官方資料來源，未接入；報表雙重成功率NULL。V4模擬對照組CORE 5，EXTENDED 5只觀察，跟D策略ON 4+1／WARNING 2+3同日平行。

現有的 `api/market-dynamic-refresh.js` 正常 cron（兩個W3更新時點）與既有 `api/capital-flow.js` 正式推薦 **無變更選股路徑**。
