const { getSql } = require('./db');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (StockZone/2.6.2.17; Taiwan market snapshot)',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.6'
};

function taipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${obj.year}-${obj.month}-${obj.day}`, weekday: obj.weekday,
    hour: Number(obj.hour), minute: Number(obj.minute) };
}

function clean(v) {
  return String(v ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\u3000/g, ' ').trim();
}

function numberOrNull(v) {
  const s = clean(v).replace(/,/g, '');
  if (!s || /^(?:--|---|X|N\/A|null)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rocToIso(v) {
  const s = clean(v).replace(/[.年月]/g, '/').replace(/日/g, '').replace(/-/g, '/');
  let m = s.match(/^(\d{3})\/?(\d{2})\/?(\d{2})$/);
  if (m) return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})\/?(\d{2})\/?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{3})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${Number(m[1]) + 1911}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return '';
}

function parsePeriod(value = '', fallback = '') {
  const s = `${clean(value)} ${clean(fallback)}`;
  let m = s.match(/(\d{3})[\/. -]?(\d{1,2})[\/. -]?(\d{1,2})\s*[~～至－—-]\s*(\d{3})[\/. -]?(\d{1,2})[\/. -]?(\d{1,2})/);
  if (m) return {
    start: `${Number(m[1]) + 1911}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`,
    end: `${Number(m[4]) + 1911}-${String(m[5]).padStart(2, '0')}-${String(m[6]).padStart(2, '0')}`
  };
  const dates = [...s.matchAll(/(\d{3})年(\d{1,2})月(\d{1,2})日/g)];
  if (dates.length >= 2) {
    const a = dates[0], b = dates.at(-1);
    return {
      start: `${Number(a[1]) + 1911}-${String(a[2]).padStart(2, '0')}-${String(a[3]).padStart(2, '0')}`,
      end: `${Number(b[1]) + 1911}-${String(b[2]).padStart(2, '0')}-${String(b[3]).padStart(2, '0')}`
    };
  }
  return { start: '', end: '' };
}

async function fetchJson(url, { retries = 1, timeoutMs = 12000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      clearTimeout(timer);
      return json;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('fetch failed');
}

function normalizeTableJson(json) {
  if (Array.isArray(json)) return { fields: [], data: json, rawArray: true };
  if (!json || typeof json !== 'object') return { fields: [], data: [], rawArray: false };
  if (Array.isArray(json.fields) && Array.isArray(json.data)) return { fields: json.fields, data: json.data, rawArray: false };
  const tables = Array.isArray(json.tables) ? json.tables : [];
  for (const t of tables) {
    if (Array.isArray(t?.fields) && Array.isArray(t?.data)) return { fields: t.fields, data: t.data, rawArray: false };
  }
  return { fields: [], data: [], rawArray: false };
}

function rowObject(fields, row) {
  if (row && !Array.isArray(row) && typeof row === 'object') return row;
  const out = {};
  fields.forEach((f, i) => { out[f] = row?.[i]; });
  return out;
}

function first(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && clean(obj[k]) !== '') return obj[k];
  }
  return '';
}

function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers?.authorization === `Bearer ${secret}`;
}

async function markAttempt(source) {
  const sql = getSql();
  await sql.query(`
    INSERT INTO sync_status (source,last_attempt_at,status,error_message,updated_at)
    VALUES ($1,NOW(),'running',NULL,NOW())
    ON CONFLICT (source) DO UPDATE SET
      last_attempt_at=NOW(), status='running', error_message=NULL, updated_at=NOW()
  `, [source]);
}

async function markSuccess(source, rowCount) {
  const sql = getSql();
  await sql.query(`
    INSERT INTO sync_status (source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at)
    VALUES ($1,NOW(),NOW(),'success',$2,NULL,NOW())
    ON CONFLICT (source) DO UPDATE SET
      last_attempt_at=NOW(), last_success_at=NOW(), status='success', row_count=$2,
      error_message=NULL, updated_at=NOW()
  `, [source, rowCount]);
}

async function markError(source, error) {
  const sql = getSql();
  const msg = String(error?.message || error || 'unknown error').slice(0, 800);
  await sql.query(`
    INSERT INTO sync_status (source,last_attempt_at,status,error_message,updated_at)
    VALUES ($1,NOW(),'error',$2,NOW())
    ON CONFLICT (source) DO UPDATE SET
      last_attempt_at=NOW(), status='error', error_message=$2, updated_at=NOW()
  `, [source, msg]);
}

let marketHistorySchemaReady = false;

async function ensureMarketHistorySchema() {
  if (marketHistorySchemaReady) return;
  const sql = getSql();
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_daily_history (
      trade_date date NOT NULL,
      stock_code text NOT NULL,
      stock_name text,
      market text NOT NULL,
      open_price numeric,
      high_price numeric,
      low_price numeric,
      close_price numeric NOT NULL,
      previous_close numeric,
      change_amount numeric,
      change_pct numeric,
      trade_volume bigint,
      trade_value numeric(24,0),
      transaction_count bigint,
      source text,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, stock_code)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_daily_history_code_date_idx ON market_daily_history (stock_code, trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_daily_history_market_date_idx ON market_daily_history (market, trade_date DESC)`);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_activity_daily (
      trade_date date NOT NULL,
      stock_code text NOT NULL,
      stock_name text,
      market text NOT NULL,
      trade_value numeric(24,0),
      change_pct numeric,
      avg_value_prev20 numeric,
      value_ratio_20 numeric,
      recent_value_avg_5 numeric,
      prior_value_avg_15 numeric,
      value_trend_5_15 numeric,
      up_value_share_5 numeric,
      positive_days_5 smallint,
      return_5_pct numeric,
      return_20_pct numeric,
      baseline_days_20 smallint NOT NULL DEFAULT 0,
      recent_days_5 smallint NOT NULL DEFAULT 0,
      activity_ready boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, stock_code)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_activity_daily_code_date_idx ON market_activity_daily (stock_code, trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_activity_daily_market_date_idx ON market_activity_daily (market, trade_date DESC)`);
  marketHistorySchemaReady = true;
}

function rowsPayload(rows) {
  if (!rows.length) throw new Error('股價來源解析後為 0 筆，拒絕寫入');
  return JSON.stringify(rows);
}

async function upsertMarketHistoryRows(rows) {
  await ensureMarketHistorySchema();
  const sql = getSql();
  const payload = rowsPayload(rows);
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        stock_code text, stock_name text, market text, trade_date date, close_price numeric,
        previous_close numeric, open_price numeric, high_price numeric, low_price numeric,
        quote_time timestamptz, source text, change_amount numeric, change_pct numeric,
        trade_volume bigint, trade_value numeric, transaction_count bigint
      )
    )
    INSERT INTO market_daily_history
      (trade_date,stock_code,stock_name,market,open_price,high_price,low_price,close_price,
       previous_close,change_amount,change_pct,trade_volume,trade_value,transaction_count,source,updated_at)
    SELECT trade_date,stock_code,stock_name,market,open_price,high_price,low_price,close_price,
           previous_close,change_amount,change_pct,trade_volume,trade_value,transaction_count,source,NOW()
    FROM incoming
    ON CONFLICT (trade_date,stock_code) DO UPDATE SET
      stock_name=EXCLUDED.stock_name, market=EXCLUDED.market, open_price=EXCLUDED.open_price,
      high_price=EXCLUDED.high_price, low_price=EXCLUDED.low_price, close_price=EXCLUDED.close_price,
      previous_close=EXCLUDED.previous_close, change_amount=EXCLUDED.change_amount, change_pct=EXCLUDED.change_pct,
      trade_volume=EXCLUDED.trade_volume, trade_value=EXCLUDED.trade_value,
      transaction_count=EXCLUDED.transaction_count, source=EXCLUDED.source, updated_at=NOW()
  `, [payload]);
}

async function upsertPriceAndHistoryRows(rows) {
  await ensureMarketHistorySchema();
  const sql = getSql();
  const payload = rowsPayload(rows);
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        stock_code text, stock_name text, market text, trade_date date, close_price numeric,
        previous_close numeric, open_price numeric, high_price numeric, low_price numeric,
        quote_time timestamptz, source text, change_amount numeric, change_pct numeric,
        trade_volume bigint, trade_value numeric, transaction_count bigint
      )
    ), history_upsert AS (
      INSERT INTO market_daily_history
        (trade_date,stock_code,stock_name,market,open_price,high_price,low_price,close_price,
         previous_close,change_amount,change_pct,trade_volume,trade_value,transaction_count,source,updated_at)
      SELECT trade_date,stock_code,stock_name,market,open_price,high_price,low_price,close_price,
             previous_close,change_amount,change_pct,trade_volume,trade_value,transaction_count,source,NOW()
      FROM incoming
      ON CONFLICT (trade_date,stock_code) DO UPDATE SET
        stock_name=EXCLUDED.stock_name, market=EXCLUDED.market, open_price=EXCLUDED.open_price,
        high_price=EXCLUDED.high_price, low_price=EXCLUDED.low_price, close_price=EXCLUDED.close_price,
        previous_close=EXCLUDED.previous_close, change_amount=EXCLUDED.change_amount, change_pct=EXCLUDED.change_pct,
        trade_volume=EXCLUDED.trade_volume, trade_value=EXCLUDED.trade_value,
        transaction_count=EXCLUDED.transaction_count, source=EXCLUDED.source, updated_at=NOW()
      RETURNING stock_code
    )
    INSERT INTO price_snapshot
      (stock_code,stock_name,market,trade_date,close_price,previous_close,open_price,high_price,low_price,quote_time,source,updated_at)
    SELECT stock_code,stock_name,market,trade_date,close_price,previous_close,open_price,high_price,low_price,quote_time,source,NOW()
    FROM incoming
    ON CONFLICT (stock_code) DO UPDATE SET
      stock_name=EXCLUDED.stock_name, market=EXCLUDED.market, trade_date=EXCLUDED.trade_date,
      close_price=EXCLUDED.close_price, previous_close=EXCLUDED.previous_close,
      open_price=EXCLUDED.open_price, high_price=EXCLUDED.high_price, low_price=EXCLUDED.low_price,
      quote_time=EXCLUDED.quote_time, source=EXCLUDED.source, updated_at=NOW()
    WHERE price_snapshot.trade_date IS NULL OR EXCLUDED.trade_date >= price_snapshot.trade_date
  `, [payload]);
}

async function refreshMarketActivityFactors() {
  await ensureMarketHistorySchema();
  const sql = getSql();
  await sql.query(`
    WITH bounds AS (
      SELECT MAX(trade_date) AS max_date FROM market_daily_history
    ), base AS (
      SELECT h.*,
        COUNT(trade_value) OVER w20 AS baseline_days_20,
        AVG(trade_value) OVER w20 AS avg_value_prev20,
        COUNT(trade_value) OVER w5 AS recent_days_5,
        AVG(trade_value) OVER w5 AS recent_value_avg_5,
        COUNT(trade_value) OVER w15prior AS prior_days_15,
        AVG(trade_value) OVER w15prior AS prior_value_avg_15,
        SUM(CASE WHEN change_pct > 0 THEN trade_value ELSE 0 END) OVER w5 AS up_value_5,
        SUM(trade_value) OVER w5 AS total_value_5,
        COUNT(*) FILTER (WHERE change_pct > 0) OVER w5 AS positive_days_5,
        LAG(close_price,5) OVER wcode AS close_5_ago,
        LAG(close_price,20) OVER wcode AS close_20_ago
      FROM market_daily_history h, bounds b
      WHERE b.max_date IS NOT NULL AND h.trade_date >= b.max_date - INTERVAL '75 days'
      WINDOW
        wcode AS (PARTITION BY stock_code ORDER BY trade_date),
        w20 AS (PARTITION BY stock_code ORDER BY trade_date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING),
        w5 AS (PARTITION BY stock_code ORDER BY trade_date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW),
        w15prior AS (PARTITION BY stock_code ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND 5 PRECEDING)
    ), metrics AS (
      SELECT *,
        CASE WHEN baseline_days_20=20 AND avg_value_prev20>0 AND trade_value IS NOT NULL
          THEN trade_value/avg_value_prev20 ELSE NULL END AS value_ratio_20,
        CASE WHEN recent_days_5=5 AND prior_days_15=15 AND prior_value_avg_15>0
          THEN recent_value_avg_5/prior_value_avg_15 ELSE NULL END AS value_trend_5_15,
        CASE WHEN recent_days_5=5 AND total_value_5>0
          THEN up_value_5/total_value_5 ELSE NULL END AS up_value_share_5,
        CASE WHEN close_5_ago>0 THEN (close_price/close_5_ago-1)*100 ELSE NULL END AS return_5_pct,
        CASE WHEN close_20_ago>0 THEN (close_price/close_20_ago-1)*100 ELSE NULL END AS return_20_pct
      FROM base
    )
    INSERT INTO market_activity_daily
      (trade_date,stock_code,stock_name,market,trade_value,change_pct,avg_value_prev20,value_ratio_20,
       recent_value_avg_5,prior_value_avg_15,value_trend_5_15,up_value_share_5,positive_days_5,
       return_5_pct,return_20_pct,baseline_days_20,recent_days_5,activity_ready,updated_at)
    SELECT trade_date,stock_code,stock_name,market,trade_value,change_pct,avg_value_prev20,value_ratio_20,
           recent_value_avg_5,prior_value_avg_15,value_trend_5_15,up_value_share_5,positive_days_5,
           return_5_pct,return_20_pct,baseline_days_20,recent_days_5,
           (baseline_days_20=20 AND value_ratio_20 IS NOT NULL),NOW()
    FROM metrics
    ON CONFLICT (trade_date,stock_code) DO UPDATE SET
      stock_name=EXCLUDED.stock_name, market=EXCLUDED.market, trade_value=EXCLUDED.trade_value,
      change_pct=EXCLUDED.change_pct, avg_value_prev20=EXCLUDED.avg_value_prev20,
      value_ratio_20=EXCLUDED.value_ratio_20, recent_value_avg_5=EXCLUDED.recent_value_avg_5,
      prior_value_avg_15=EXCLUDED.prior_value_avg_15, value_trend_5_15=EXCLUDED.value_trend_5_15,
      up_value_share_5=EXCLUDED.up_value_share_5, positive_days_5=EXCLUDED.positive_days_5,
      return_5_pct=EXCLUDED.return_5_pct, return_20_pct=EXCLUDED.return_20_pct,
      baseline_days_20=EXCLUDED.baseline_days_20, recent_days_5=EXCLUDED.recent_days_5,
      activity_ready=EXCLUDED.activity_ready, updated_at=NOW()
  `);
}


let companyProfileSchemaReady = false;

async function ensureCompanyProfileSchema() {
  if (companyProfileSchemaReady) return;
  const sql = getSql();
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_company_profile (
      stock_code text PRIMARY KEY,
      stock_name text NOT NULL,
      market text NOT NULL,
      industry_code text,
      industry text,
      report_date date,
      source text,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  // Existing v2.6.2.14/15 tables did not have industry_code. Safe idempotent migration.
  await sql.query(`ALTER TABLE market_company_profile ADD COLUMN IF NOT EXISTS industry_code text`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_company_profile_market_industry_idx ON market_company_profile (market, industry)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_company_profile_industry_code_idx ON market_company_profile (industry_code)`);
  companyProfileSchemaReady = true;
}

async function upsertCompanyProfileRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('公司基本資料解析後為 0 筆，拒絕寫入');
  await ensureCompanyProfileSchema();
  const sql = getSql();
  const payload = JSON.stringify(rows);
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        stock_code text, stock_name text, market text, industry_code text, industry text, report_date date, source text
      )
    ), upserted AS (
      INSERT INTO market_company_profile
        (stock_code,stock_name,market,industry_code,industry,report_date,source,updated_at)
      SELECT stock_code,stock_name,market,industry_code,industry,report_date,source,NOW()
      FROM incoming
      ON CONFLICT (stock_code) DO UPDATE SET
        stock_name=EXCLUDED.stock_name, market=EXCLUDED.market, industry_code=EXCLUDED.industry_code, industry=EXCLUDED.industry,
        report_date=EXCLUDED.report_date, source=EXCLUDED.source, updated_at=NOW()
      RETURNING stock_code
    )
    DELETE FROM market_company_profile p
    WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.stock_code=p.stock_code)
  `,[payload]);
}

// 保留舊函式名稱供既有程式相容；新的同步流程同時寫 snapshot + history。
async function upsertPriceRows(rows) {
  return upsertPriceAndHistoryRows(rows);
}

async function replaceDisposalMarket(market, rows) {
  const sql = getSql();
  const payload = JSON.stringify(rows);
  // 一個 SQL statement 內先刪再寫；statement 失敗時不會留下「先刪後失敗」的半套狀態。
  await sql.query(`
    WITH deleted AS (
      DELETE FROM disposal_snapshot WHERE market=$1 RETURNING 1
    ), incoming AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
        stock_code text, stock_name text, announcement_date date, start_date date,
        end_date date, reason text, raw_data jsonb
      )
    )
    INSERT INTO disposal_snapshot
      (market,stock_code,stock_name,announcement_date,start_date,end_date,reason,raw_data,updated_at)
    SELECT $1,stock_code,stock_name,announcement_date,start_date,end_date,reason,raw_data,NOW()
    FROM incoming
    ON CONFLICT (market,stock_code,start_date,end_date) DO UPDATE SET
      stock_name=EXCLUDED.stock_name, announcement_date=EXCLUDED.announcement_date,
      reason=EXCLUDED.reason, raw_data=EXCLUDED.raw_data, updated_at=NOW()
  `, [market, payload]);
}

module.exports = {
  clean, numberOrNull, rocToIso, parsePeriod, fetchJson, normalizeTableJson, rowObject,
  first, taipeiDateParts, isCronAuthorized, markAttempt, markSuccess, markError,
  ensureMarketHistorySchema, ensureCompanyProfileSchema, upsertCompanyProfileRows,
  upsertPriceRows, upsertPriceAndHistoryRows, upsertMarketHistoryRows, refreshMarketActivityFactors, replaceDisposalMarket
};
