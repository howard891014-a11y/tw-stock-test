# StockZone Business Tag Engine v1

這份規格是智慧選股「資金流向」的第一層資料基礎。

## 核心原則

1. **公司先掛業務標籤，市場每天再用強勢股反推正在交易的業務。**
2. 科技 / 電子採細粒度標籤，例如 `CoWoS`、`ASIC`、`CPO`、`液冷散熱`；不以「半導體」這種大類直接參與 Top N 投票。
3. 傳產 / 金融不追求過細，直接以 `金融`、`航運`、`鋼鐵`、`水泥` 等大產業作為可投票標籤。
4. `voteEligible=false` 的標籤只做分類與導覽，**不能進每日市場業務 Top 5 / Top 10**。
5. 公司永久標籤不會因某一天市場焦點而刪除；每日運算只建立「當日有效標籤」。

## 每日資金主線預定流程

1. 找出當日有效強勢股。
2. 把每檔強勢股的永久業務標籤全部暫時打勾。
3. 只統計 `voteEligible=true` 的標籤。
4. 依「命中數 + 命中率 + 強勢程度」校正，而非只看票數。
5. 取市場 Top 5 / Top 10 業務。
6. 回頭把每檔股票不在 Top N 的暫時標籤取消。
7. 得出當日真正的業務資金主線。
8. 再回查所有具有該業務標籤的公司，區分領漲 / 跟漲 / 尚未發動，供近期精選使用。

## 標籤欄位

- `id`: 穩定機器 ID，之後公司資料只存這個值。
- `name`: 正式顯示名稱。
- `parent`: 類別父節點。
- `kind`: `sector` / `subsector` / `business`。
- `resolution`: `fine` / `coarse`。
- `voteEligible`: 是否允許進入每日市場業務投票。
- `aliases`: 同義詞與常見寫法，避免 CoWoS / CoWoS封裝被視為不同標籤。
- `note`: 保留說明欄。

## 公司標籤下一步資料格式

下一階段的公司業務資料建議使用：

```json
{
  "code": "6187",
  "name": "萬潤",
  "tags": [
    { "tagId": "cowos", "importance": "core" },
    { "tagId": "advanced_packaging_equipment", "importance": "core" },
    { "tagId": "semiconductor_automation_equipment", "importance": "important" }
  ]
}
```

`importance` 第一版只用：

- `core`：核心業務 / 高度曝險
- `important`：重要業務
- `related`：有實際業務關聯但不是主要來源

第一版不硬估營收百分比；有公司正式揭露後再補精準權重。
