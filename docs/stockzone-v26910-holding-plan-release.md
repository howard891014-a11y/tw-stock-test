# StockZone v2.6.9.10｜持股清單交易計畫最小改版

來源：使用者 2026-10-28 上傳 `tw-stock-test-main (1).zip`（package version 2.6.9.9）。此交付是本機修改，**尚未部署 Vercel**、**未寫入 Neon／Supabase**。

## 部署／覆蓋

覆蓋：`app.js`、`index.html`、`package.json`、`lib/resonance-lab-v1.js`。
新增：`lib/holding-trade-plans.js`、`scripts/validate-v26910-holding-plans.js`、`docs/stockzone-v26910-holding-plan-release.md`。

保留其餘目錄；不要刪除 W3、共振公式、智慧選股、資料庫或 API 檔案。完成 Git 上傳後正常觸發 Vercel 部署。

## 互動

1. 加入持股清單：只加入股票，不建立交易計畫。
2. 未輸入成本或股數：不能建立；輸入不合法時中止且不存入。
3. 點「建立計畫」：需要先開啟該股票並等待原有玩法／共振分析。成功時一次保存原始玩法、主要／次要共振參考、買賣建議、初始成本和股數。
4. 已建立：按鈕變「取消計畫」「修改計畫」；修改只改當前持股成本與股數，不覆蓋原始快照。
5. 按 X 或「取消計畫」：彈出「是否取消計畫？」；選否保留、選是移除持股、封存已取消計畫（不當作已賣出成交）。未建立計畫者可直接 X 移除。
6. 每當原版個股共振／買賣決策產生新輸出：只更新當前建議、差異與時間；玩法若與原始不同，停止將另一玩法的目標當成本次目標；原始目標永不自動覆寫。
7. 如果缺少主／次共振目標，原始欄位明示「資料不足」，不捏造數字；尚無共振／玩法資料時不允許建單。

## 儲存與實測

沿用 `stockzone_holdings_v2`、`stockzone_auto_trade_plans_v2692`。舊版自動持股追蹤資料保留為歷史，不再因加入清單自動建單；取消計畫也不宣稱真實出清。原有 `sz_resonance_lab_r1_plans` 研究資料保留，舊自動產生的活動標籤在接管時解除。

僅 browser localStorage，同瀏覽器保留；**不是跨裝置同步／真實下單／回測認證**。微動態只承接原版共振輸出的「當前參考」，幅度尚未做 A/B 校準，不改任何價格公式。

已通過：`npm run validate:holding-plans`、`npm run validate:app-version`、`npm run validate:browser-storage`、`npm run validate:layout`，以及離線 Chromium 互動測試（未建、建單、修改、取消確認、歷史保留）。

專案原有 `npm run validate:v4-play` 在**原始上傳 v2.6.9.9** 已因 `V4.3-CANDIDATE` 斷言失敗，本次沒有更動 V4 公式，該既有測試錯誤也未在本改版修復。
