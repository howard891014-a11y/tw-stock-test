# StockZone v2.6.8.23：產業異動整合公司行動（審核與資料界線）

## 偵測與資料儲存

- 原有上市／上櫃／更名／官方產業／營業項目異動，候選資訊維持在 `stockzone/industry-change/v1/` Vercel Private Blob，不變動 Neon 正式分類。
- 新增上市與上櫃公司行動候選紀錄，儲存在 Neon `market_company_action_candidate`；本版本僅從原有五種官方歷史 API 偵測 **增資（有除權價資訊的現增）、減資、面額變更／分割、股票股利除權**。純除息不放入此候選清單。不能涵蓋所有非除權現金增資、配售及沒有官方參考價的事件。
- 例行掃描範圍：**台北日期的當月＋上個月**；不是完整歷史掃描。原研究 500D 公司行動掃描及 Y 校正流程 **獨立保留在程式中**，其時間上限沒有被本功能改寫。
- 每個來源都獨立驗證，失敗會顯示「未完成」，不會以零事件視為成功。已取得的有效來源候選可以先暫存。
- 同一 ID 重複掃描只保留一筆；事件參考價改動產生新 ID，須重新審核。
- 自動掃描 **只新增待驗證候選**，不改正式產業、不修改 K 線、不校正股價、不修改 XY／500D 報酬或 Y。

## SZ-鐵證模式正式導入 Neon

掃描第一次執行會安全建立空的 `market_company_action_candidate` 以及 `market_company_action_release` 兩張表。**`release` 從不被自動掃描或網頁上的按鈕填入**，只供完成 SZ-鐵證外部逐筆審核後，使用有權限的管理工具手動寫入。

審核時應以事件本身、官方公告、參考價、換股比例等為準，尤其是「面額變更」不等同於必然拆股；「權／息」需確認是否含權。

人工確認後，Neon 寫入範例（值需替換為真正已核對的候選 ID 與獨立證據，不可直接拿這個例子填入資料庫）：

```sql
INSERT INTO market_company_action_release
  (candidate_id,event_date,stock_code,stock_name,market,industry,action,
   source,old_close,reference_close,note,evidence,verified_by)
SELECT candidate_id,event_date,stock_code,stock_name,market,industry,action,
  source,old_close,reference_close,note,$2::text,'SZ-鐵證模式'
FROM market_company_action_candidate
WHERE candidate_id = $1::text
  AND length(trim($2::text)) >= 10
ON CONFLICT(candidate_id) DO NOTHING;
```

- `$1` = 已審核的候選 ID；`$2` = 已完成官方證據核對的可追溯說明。操作前核對 `SELECT` 實際匹配 **剛好一筆**，確認與審核結果一致。
- 網頁上的「已導入」是指**正式事件稽核紀錄已寫入 Neon**，不等於自動校正技術圖／報酬率。不同產品模組後續是否使用事件，要獨立研討與測試。
- 匯出 JSON 包含候選 ID 與需要核實的資訊，方便在聊天中啟動 SZ-鐵證模式。
- 點擊「更新 XY / 分類快照」會照舊根據 Neon 正式分類做 XY 快照更新，然後增量掃描近期公司行動並重新讀取候選、正式審核狀態。**首次安裝這份程式需要部署一次**；往後只需操作 Neon 正式發布 + 更新按鈕，不需要為了單筆導入再重新部署。
- 僅 `已導入` 候選可刪；點 × 刪除 `market_company_action_candidate` 的該筆**暫存**，而 `market_company_action_release` **永久保留**。同一 ID 後續掃描不會重新出現。
- 原產業候選同樣只會刪 Private Blob 暫存，不會刪除 Neon 正式的 `market_taxonomy_release` 與會員分類。兩種來源明確不同，請勿以為所有候選都在 Neon。

## 已知範圍限制

- 實測限離線模擬 + 程式碼檢查；未在此次修改作業中成功取得各官方服務的 2026/10 即時回應，**不可宣稱官方來源全部實際通過**。正式部署後，首次執行「立即偵測」，若顯示部分失敗，先排除來源格式／阻擋問題，再認定覆蓋能力。
- Vercel function 最長 60s。掃描任何超時／格式不符應提示，不以零事件冒充掃描完成。
- 當月與上月之前的歷史公司行動**不會出現在此待審核清單**，除非之後另行補掃；不冒充 500D 全歷史覆蓋。
