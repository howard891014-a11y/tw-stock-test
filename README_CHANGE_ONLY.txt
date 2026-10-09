Stockzone v2.6.7.2 — W3 合併版 + 500D 精簡資料既有歷史修復
本包包含 v2.6.7.1 所有未部署的修改，不需先部署舊包。
新增 lib/research-500d-backfill.js 及 api/sync-status.js 的手動修復入口。
POST /api/sync-status?action=research-500d-backfill-manual
需同站請求，header x-stockzone-manual-history: 1；每次最多處理 8 個來源日期，可重複執行。
此功能只恢復既有 market_business_xy2_topic_daily 中已計算但研究表缺漏的日期，不會偽造歷史 XY。
重要：不能保證立即補滿 500D；更早日期需要官方歷史行情/法人/信用資料下載及歷史 XY 重算管線，目前尚未完成。
目前原始保留期限：股價/法人 120D，信用 90D，研究精簡 500D，不更改。
未修改 W3 正式門檻；不會在部署時自動執行任何資料庫寫入。
