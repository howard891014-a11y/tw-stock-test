# StockZone D 模擬交易第二階段（2026-10-24）

> **研究模組與測試已完成；未部署、未啟動排程、沒有寫入 Neon 或 Vercel Blob，亦沒有實際交易。**
> 設計目標：保留原版 V4／W3；使 D 與原版 V4 使用同一個 T 日資訊集合，獨立保存不可覆蓋的推薦與 T+1 交易流水。正式網站仍使用 `original_all`。

## 凍結公式來源及變更邊界

原始JS雜湊未變：

- `lib/w3-d111.js`: `4ddfdef510a20aa34a9d776799d31fdaba2c8a3b1fb561130ccbcfcaba8ab69a`
- `lib/w3-d112.js`: `1dc77d4e8b9cdfcf61bc4502e7ae0348d1f5c6c3e3ff5a72a11036484c9a1403`
- `lib/v4-stage3-first.js`: `64146c116129565e9f2851e03be2cb60f2cadfebdfeb41a12cae62d17b21afe6`
- `lib/v4-research-R1-UNMODIFIED.js`: `1bf0b6dbf3e65a76c27aede9530414b17c7e788d414b3a1d3d63a7b4bb550b0d`
- `lib/s2-r3-four-state.js`: `6e5e0973e688ccc11b3d76ec272e7c87f6edc64d32c5e2f2ac154da041963a08`

Stage2 only extends Stage1 adapter with optional `withBaseline: true`, preserving default API behavior; other new files are `lib/stockzone-d-paper*.js`, `scripts/stockzone-d-paper-cli.js`, `scripts/validate-stockzone-d-paper.js`, this doc, and `package.json` script additions. No change to W3/V4 selection formulas, official API routes, deployment config, or cron.

## How immutable simulation works

1. **T close** after 15:00 Asia/Taipei: `getDPreview({withBaseline:true})` runs original W3-D.1.2 and V4 with current Neon as-of T. D strategy and original V4 control both use the same T-day feature rows. The original V4 control uses `original_all` top-five **CORE only** (EXTENDED watch-only); D preserves the frozen ON 4+1 / WARNING 2+3 / OFF empty rule.
2. `makeSignal` emits one sealed JSON with SHA256, full T-day pick evidence and exact `capturedAt`. Production-target persistence is **private Vercel Blob**, deterministic key `stockzone/d-forward/v1/signals/T.json`, `allowOverwrite:false`, `addRandomSuffix:false`. First write wins; subsequent calls return the existing record. **No Neon writes.**
3. **Next actual trading session E=T+1**: AFTER official EOD for E has been stored, read Neon `market_daily_history` for the earliest `trade_date > T`. The signal is discarded as executable evidence if its actual capture timestamp >= **09:00 Asia/Taipei on E**. Weekend and holidays are resolved by actual exchange-dated Neon EOD records, not by assuming weekdays.
4. The paper-ledger simulates E opening fills with the actual official opening price, no re-dating, no invented execution. If missing open/previous close, or an abnormal open-to-previous-close gap exceeds 15%, do not fill and log the anomaly; blocked sell positions remain owned, and no new entries are allowed until they are sold. One immutable execution file per E (`executions/E.json`) contains the full event and ledger-state hash chain.
5. Two completely independent paper accounts (`D`, `V4`) start with **NT$1,000,000 each**, budget **20% of available full-round equity per eligible slot**; shortfalls stay cash. Buy cost estimate 0.3%, sell cost 0.3%; **fractional shares** and no slippage are research assumptions, not market-executable board lots.
6. ON trades exit the open following the 20th complete trading session; WARNING trades exit the open following the first complete trading session; OFF exits at next opening. Early risk-state changes also close positions at next opening. A new eligible signal may enter after all outstanding positions have exited. A day missing from the append-only chain makes the next fill refuse, rather than quietly skipping a session.
7. Realized cash, NAV at each settlement day's close, return, closed-stock win rate, drawdown, and D–V4 differences are derived from the immutable executions. **Dual success** follows the previously frozen definition: stock net return > 0 **AND** stock net return > TAIEX return for the identical entry-open to exit-open period. Neon currently does not store a verified TAIEX *opening* quote for every day, so this metric is explicitly **null / not verified** until an official TAIEX opening feed is connected. **Never fabricate or substitute close-to-close returns** to make the metric appear complete.

## CLI for post-deployment (not activated)

Requires valid Neon `DB_URL` / `DATABASE_URL` and existing **private** Vercel Blob `BLOB_READ_WRITE_TOKEN`. Do not put credentials in ZIP, terminal output or browser.

```
node scripts/stockzone-d-paper-cli.js preview
node scripts/stockzone-d-paper-cli.js capture
node scripts/stockzone-d-paper-cli.js settle YYYY-MM-DD
node scripts/stockzone-d-paper-cli.js report
```

`preview` is read-only and **does not** freeze. `capture` does write one private Blob object when invoked. `settle` writes execution only after the next official EOD session and preopen timestamp proof; idempotent retries do not replace stored results. `report` only reads stored execution files. None of the above is automatically called by production code, and no API route or Vercel Cron was added.

## Acceptance tests (local/offline, real frozen V4/W3 formulas intact)

```
npm run validate:d-policy
npm run validate:d-paper
npm run validate:all
```

`validate:d-paper` includes immutable recommendation record, SHA256 tamper detection, double-write first-wins, replay hash chain, time-of-day and missed-day anti-lookahead, official price/fill gating, failure-to-sell barrier, abnormal split/capital-reduction price gap flag, 20-session ON and 1-session Warning, OFF exit, 20% unfilled cash, realistic two-sided estimated fees, separate V4 control accounting, benchmark double-success null when not supported, and injected read-only Neon + Blob adapters. Tests use fictional future sessions/stocks and MUST NOT be described as real investment outcomes.

## Risks and Stage3 acceptance gates

- Need to wire a **restricted internal server-side** capture/settle trigger and deterministic operational schedule; **not** a public write endpoint. Fail-closed until W3 and Neon completed T-day features are available **before E 09:00**. In 2026/10/22 the actual W3 latest save was after 10/23 open: this day is **not eligible for retroactive execution**.
- Need to verify official daily TAIEX opening index source for dual-success percentages (leave null until verified).
- If Neon modifies T's feature data after T+1 open, signal content must remain frozen; no hindsight changes. Missing/late T snapshots should be counted as an **observation gap**, never reintroduced as simulated T+1 trades.
- Corporate actions >15% gap are flagged for independent verification. Smaller corporate actions are not guaranteed to be detected: **do not treat this provisional guard as a complete action-adjustment engine**.
- Compare actual next-live ON/WARNING production-born V4 picks and D picks against original JS, then enable paper journal **without changing original featured route**. No live next-session trades, net P/L, or dual win rate exist as of delivery.
