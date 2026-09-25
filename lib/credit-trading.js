// StockZone v2.6.5.9 — official credit-trading history layer.
// Sources: TWSE MI_MARGN/TWT93U + TPEx margin_balance/margin_sbl.
// Stored quantities are normalized to shares so TWSE/TPEx use one unit.

function getSql() { return require('./db').getSql(); }
function syncHelpers() { return require('./sync-common'); }

const TWSE_MARGIN = 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN';
const TWSE_SBL_PRIMARY = 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U';
const TWSE_SBL_FALLBACK = 'https://www.twse.com.tw/exchangeReport/TWT93U';
const TPEX_MARGIN = 'https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php';
const TPEX_SBL = 'https://www.tpex.org.tw/web/stock/margin_trading/margin_sbl/margin_sbl_result.php';

const SOURCE_BY_MARKET = {
  '上市': 'credit_trading_twse',
  '上櫃': 'credit_trading_tpex'
};

function clean(v) {
  return String(v ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\u3000/g, ' ').trim();
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(clean(v).replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(n) ? n : null;
}

function lotsToShares(v) {
  const n = num(v);
  return n === null ? null : Math.round(n * 1000);
}

function rawShares(v) {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function cleanCode(v) {
  return clean(v).replace(/^=|"/g, '').replace(/"$/g, '');
}

function ymdToIso(v) {
  const s = String(v || '').replace(/\D/g, '');
  return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : '';
}

function rocToIso(v) {
  const s = clean(v).replace(/[.年月]/g, '/').replace(/日/g, '').replace(/-/g, '/');
  let m = s.match(/^(\d{3})\/?(\d{2})\/?(\d{2})$/);
  if (m) return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})\/?(\d{2})\/?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{3})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${Number(m[1]) + 1911}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  return '';
}

function isoToYmd(iso) { return String(iso || '').replace(/-/g, ''); }
function isoToRocSlash(iso) {
  const [y,m,d] = String(iso || '').split('-');
  return y && m && d ? `${Number(y)-1911}/${m}/${d}` : '';
}

function taipeiTodayIso() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoAddDays(iso, delta) {
  const [y,m,d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0,10);
}

function isWeekend(iso) {
  const [y,m,d] = String(iso).split('-').map(Number);
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  return day === 0 || day === 6;
}

function recentWeekdays(max = 10, anchor = taipeiTodayIso()) {
  const out = [];
  for (let i = 0, iso = anchor; out.length < max && i < max + 16; i++, iso = isoAddDays(anchor, -i)) {
    if (!isWeekend(iso)) out.push(iso);
  }
  return out;
}

async function fetchJson(url, { timeoutMs = 9000, retries = 1 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (StockZone/2.6.5.9; Taiwan credit trading)',
          'Accept': 'application/json,text/javascript,text/plain,*/*',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.6',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': String(url).includes('tpex.org.tw') ? 'https://www.tpex.org.tw/' : 'https://www.twse.com.tw/'
        }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (!text.trim()) throw new Error('empty payload');
      return JSON.parse(text);
    } catch (e) {
      lastError = e;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('official request failed');
}

function twseDetailTable(payload) {
  const tables = Array.isArray(payload?.tables) ? payload.tables : [];
  return tables.find(t => Array.isArray(t?.data) && t.data.length && Array.isArray(t?.data?.[0]) && t.data[0].length >= 16)
    || tables[1]
    || null;
}

function parseTwseMargin(payload, requestedIso) {
  if (!payload || String(payload.stat || '').toUpperCase() !== 'OK') return [];
  const reportIso = ymdToIso(payload.date) || requestedIso;
  if (reportIso !== requestedIso) throw new Error(`TWSE MI_MARGN 日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  const table = twseDetailTable(payload);
  const data = Array.isArray(table?.data) ? table.data : [];
  return data.map(r => {
    const code = cleanCode(r?.[0]);
    if (!code || code.toLowerCase() === 'total') return null;
    const marginBalance = lotsToShares(r?.[6]);
    const marginLimit = lotsToShares(r?.[7]);
    const shortBalance = lotsToShares(r?.[12]);
    const shortLimit = lotsToShares(r?.[13]);
    return {
      trade_date: reportIso, stock_code: code, stock_name: clean(r?.[1]), market: '上市',
      margin_buy: lotsToShares(r?.[2]), margin_sell: lotsToShares(r?.[3]), margin_cash_repay: lotsToShares(r?.[4]),
      margin_prev_balance: lotsToShares(r?.[5]), margin_balance: marginBalance, margin_limit: marginLimit,
      margin_usage_pct: marginBalance !== null && marginLimit > 0 ? marginBalance / marginLimit * 100 : null,
      short_buy: lotsToShares(r?.[8]), short_sell: lotsToShares(r?.[9]), short_stock_repay: lotsToShares(r?.[10]),
      short_prev_balance: lotsToShares(r?.[11]), short_balance: shortBalance, short_limit: shortLimit,
      short_usage_pct: shortBalance !== null && shortLimit > 0 ? shortBalance / shortLimit * 100 : null,
      offsetting: lotsToShares(r?.[14]), note: clean(r?.[15]),
      margin_source: 'TWSE MI_MARGN'
    };
  }).filter(Boolean);
}

function parseTwseSbl(payload, requestedIso) {
  if (!payload) return [];
  const stat = clean(payload.stat || '');
  if (stat && stat.toUpperCase() !== 'OK') return [];
  const reportIso = ymdToIso(payload.date) || requestedIso;
  if (reportIso !== requestedIso) throw new Error(`TWSE TWT93U 日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  let data = Array.isArray(payload.data) ? payload.data : [];
  if (!data.length && Array.isArray(payload.tables)) {
    const table = payload.tables.find(t => Array.isArray(t?.data) && t.data.length && Array.isArray(t.data[0]) && t.data[0].length >= 14);
    data = Array.isArray(table?.data) ? table.data : [];
  }
  return data.map(r => {
    const code = cleanCode(r?.[0]);
    if (!code || code.toLowerCase() === 'total') return null;
    return {
      trade_date: reportIso, stock_code: code, stock_name: clean(r?.[1]), market: '上市',
      sbl_prev_balance: rawShares(r?.[8]), sbl_sell: rawShares(r?.[9]), sbl_return: rawShares(r?.[10]),
      sbl_adjustment: rawShares(r?.[11]), sbl_balance: rawShares(r?.[12]), sbl_next_limit: rawShares(r?.[13]),
      sbl_source: 'TWSE TWT93U'
    };
  }).filter(Boolean);
}

function parseTpexMargin(payload, requestedIso) {
  if (!payload || !Array.isArray(payload.aaData)) return [];
  const reportIso = rocToIso(payload.reportDate) || requestedIso;
  if (reportIso !== requestedIso) throw new Error(`TPEx margin 日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  return payload.aaData.map(r => {
    const code = cleanCode(r?.[0]);
    if (!code) return null;
    return {
      trade_date: reportIso, stock_code: code, stock_name: clean(r?.[1]), market: '上櫃',
      margin_prev_balance: lotsToShares(r?.[2]), margin_buy: lotsToShares(r?.[3]), margin_sell: lotsToShares(r?.[4]),
      margin_cash_repay: lotsToShares(r?.[5]), margin_balance: lotsToShares(r?.[6]), margin_usage_pct: num(r?.[8]), margin_limit: lotsToShares(r?.[9]),
      short_prev_balance: lotsToShares(r?.[10]), short_sell: lotsToShares(r?.[11]), short_buy: lotsToShares(r?.[12]),
      short_stock_repay: lotsToShares(r?.[13]), short_balance: lotsToShares(r?.[14]), short_usage_pct: num(r?.[16]), short_limit: lotsToShares(r?.[17]),
      offsetting: lotsToShares(r?.[18]), note: clean(r?.[19]), margin_source: 'TPEx margin_balance'
    };
  }).filter(Boolean);
}

function parseTpexSbl(payload, requestedIso) {
  if (!payload || !Array.isArray(payload.aaData)) return [];
  const reportIso = rocToIso(payload.reportDate) || requestedIso;
  if (reportIso !== requestedIso) throw new Error(`TPEx SBL 日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  return payload.aaData.map(r => {
    const code = cleanCode(r?.[0]);
    if (!code) return null;
    return {
      trade_date: reportIso, stock_code: code, stock_name: clean(r?.[1]), market: '上櫃',
      sbl_prev_balance: rawShares(r?.[8]), sbl_sell: rawShares(r?.[9]), sbl_return: rawShares(r?.[10]),
      sbl_adjustment: rawShares(r?.[11]), sbl_balance: rawShares(r?.[12]), sbl_next_limit: rawShares(r?.[13]),
      sbl_source: 'TPEx margin_sbl'
    };
  }).filter(Boolean);
}

function mergeCreditRows(marginRows, sblRows) {
  const map = new Map();
  for (const row of [...(marginRows || []), ...(sblRows || [])]) {
    const key = `${row.market}:${row.trade_date}:${row.stock_code}`;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }
  return [...map.values()];
}

async function fetchTwseCreditDay(iso) {
  const ymd = isoToYmd(iso);
  const marginUrl = `${TWSE_MARGIN}?date=${ymd}&selectType=ALL&response=json`;
  const sblUrls = [
    `${TWSE_SBL_PRIMARY}?date=${ymd}&response=json`,
    `${TWSE_SBL_FALLBACK}?date=${ymd}&response=json`
  ];
  const marginRows = parseTwseMargin(await fetchJson(marginUrl, { retries: 1 }), iso);
  let sblRows = [], sblError = null;
  for (const url of sblUrls) {
    try {
      sblRows = parseTwseSbl(await fetchJson(url, { retries: 0 }), iso);
      if (sblRows.length) break;
    } catch (e) { sblError = e; }
  }
  if (!marginRows.length && !sblRows.length) {
    if (sblError) throw sblError;
    return [];
  }
  return mergeCreditRows(marginRows, sblRows);
}

async function fetchTpexCreditDay(iso) {
  const roc = isoToRocSlash(iso);
  const q = `l=zh-tw&o=json&d=${encodeURIComponent(roc)}&s=0,asc,0`;
  const [marginResult, sblResult] = await Promise.allSettled([
    fetchJson(`${TPEX_MARGIN}?${q}`, { retries: 1 }),
    fetchJson(`${TPEX_SBL}?${q}`, { retries: 1 })
  ]);
  const marginRows = marginResult.status === 'fulfilled' ? parseTpexMargin(marginResult.value, iso) : [];
  const sblRows = sblResult.status === 'fulfilled' ? parseTpexSbl(sblResult.value, iso) : [];
  if (!marginRows.length && !sblRows.length) {
    const err = marginResult.status === 'rejected' ? marginResult.reason : sblResult.status === 'rejected' ? sblResult.reason : null;
    if (err) throw err;
    return [];
  }
  return mergeCreditRows(marginRows, sblRows);
}

let schemaReady = false;
async function ensureCreditTradingSchema() {
  if (schemaReady) return;
  const sql = getSql();
  await sql.query(`
    CREATE TABLE IF NOT EXISTS credit_trading_daily (
      trade_date date NOT NULL,
      stock_code text NOT NULL,
      stock_name text,
      market text NOT NULL,
      margin_prev_balance bigint,
      margin_buy bigint,
      margin_sell bigint,
      margin_cash_repay bigint,
      margin_balance bigint,
      margin_limit bigint,
      margin_usage_pct numeric,
      short_prev_balance bigint,
      short_sell bigint,
      short_buy bigint,
      short_stock_repay bigint,
      short_balance bigint,
      short_limit bigint,
      short_usage_pct numeric,
      offsetting bigint,
      sbl_prev_balance bigint,
      sbl_sell bigint,
      sbl_return bigint,
      sbl_adjustment bigint,
      sbl_balance bigint,
      sbl_next_limit bigint,
      note text,
      margin_source text,
      sbl_source text,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, stock_code, market)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS credit_trading_daily_code_date_idx ON credit_trading_daily (stock_code, trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS credit_trading_daily_market_date_idx ON credit_trading_daily (market, trade_date DESC)`);
  schemaReady = true;
}

async function upsertCreditTradingRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  await ensureCreditTradingSchema();
  const sql = getSql();
  const payload = JSON.stringify(rows);
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        trade_date date, stock_code text, stock_name text, market text,
        margin_prev_balance bigint, margin_buy bigint, margin_sell bigint, margin_cash_repay bigint,
        margin_balance bigint, margin_limit bigint, margin_usage_pct numeric,
        short_prev_balance bigint, short_sell bigint, short_buy bigint, short_stock_repay bigint,
        short_balance bigint, short_limit bigint, short_usage_pct numeric, offsetting bigint,
        sbl_prev_balance bigint, sbl_sell bigint, sbl_return bigint, sbl_adjustment bigint,
        sbl_balance bigint, sbl_next_limit bigint, note text, margin_source text, sbl_source text
      )
    )
    INSERT INTO credit_trading_daily (
      trade_date,stock_code,stock_name,market,
      margin_prev_balance,margin_buy,margin_sell,margin_cash_repay,margin_balance,margin_limit,margin_usage_pct,
      short_prev_balance,short_sell,short_buy,short_stock_repay,short_balance,short_limit,short_usage_pct,offsetting,
      sbl_prev_balance,sbl_sell,sbl_return,sbl_adjustment,sbl_balance,sbl_next_limit,note,margin_source,sbl_source,updated_at
    )
    SELECT trade_date,stock_code,stock_name,market,
      margin_prev_balance,margin_buy,margin_sell,margin_cash_repay,margin_balance,margin_limit,margin_usage_pct,
      short_prev_balance,short_sell,short_buy,short_stock_repay,short_balance,short_limit,short_usage_pct,offsetting,
      sbl_prev_balance,sbl_sell,sbl_return,sbl_adjustment,sbl_balance,sbl_next_limit,note,margin_source,sbl_source,NOW()
    FROM incoming
    ON CONFLICT (trade_date,stock_code,market) DO UPDATE SET
      stock_name=COALESCE(NULLIF(EXCLUDED.stock_name,''),credit_trading_daily.stock_name),
      margin_prev_balance=COALESCE(EXCLUDED.margin_prev_balance,credit_trading_daily.margin_prev_balance),
      margin_buy=COALESCE(EXCLUDED.margin_buy,credit_trading_daily.margin_buy),
      margin_sell=COALESCE(EXCLUDED.margin_sell,credit_trading_daily.margin_sell),
      margin_cash_repay=COALESCE(EXCLUDED.margin_cash_repay,credit_trading_daily.margin_cash_repay),
      margin_balance=COALESCE(EXCLUDED.margin_balance,credit_trading_daily.margin_balance),
      margin_limit=COALESCE(EXCLUDED.margin_limit,credit_trading_daily.margin_limit),
      margin_usage_pct=COALESCE(EXCLUDED.margin_usage_pct,credit_trading_daily.margin_usage_pct),
      short_prev_balance=COALESCE(EXCLUDED.short_prev_balance,credit_trading_daily.short_prev_balance),
      short_sell=COALESCE(EXCLUDED.short_sell,credit_trading_daily.short_sell),
      short_buy=COALESCE(EXCLUDED.short_buy,credit_trading_daily.short_buy),
      short_stock_repay=COALESCE(EXCLUDED.short_stock_repay,credit_trading_daily.short_stock_repay),
      short_balance=COALESCE(EXCLUDED.short_balance,credit_trading_daily.short_balance),
      short_limit=COALESCE(EXCLUDED.short_limit,credit_trading_daily.short_limit),
      short_usage_pct=COALESCE(EXCLUDED.short_usage_pct,credit_trading_daily.short_usage_pct),
      offsetting=COALESCE(EXCLUDED.offsetting,credit_trading_daily.offsetting),
      sbl_prev_balance=COALESCE(EXCLUDED.sbl_prev_balance,credit_trading_daily.sbl_prev_balance),
      sbl_sell=COALESCE(EXCLUDED.sbl_sell,credit_trading_daily.sbl_sell),
      sbl_return=COALESCE(EXCLUDED.sbl_return,credit_trading_daily.sbl_return),
      sbl_adjustment=COALESCE(EXCLUDED.sbl_adjustment,credit_trading_daily.sbl_adjustment),
      sbl_balance=COALESCE(EXCLUDED.sbl_balance,credit_trading_daily.sbl_balance),
      sbl_next_limit=COALESCE(EXCLUDED.sbl_next_limit,credit_trading_daily.sbl_next_limit),
      note=COALESCE(NULLIF(EXCLUDED.note,''),credit_trading_daily.note),
      margin_source=COALESCE(EXCLUDED.margin_source,credit_trading_daily.margin_source),
      sbl_source=COALESCE(EXCLUDED.sbl_source,credit_trading_daily.sbl_source),
      updated_at=NOW()
  `, [payload]);
  return rows.length;
}

async function latestStoredDate(market) {
  await ensureCreditTradingSchema();
  const sql = getSql();
  const rows = await sql.query(`SELECT MAX(trade_date)::text AS d FROM credit_trading_daily WHERE market=$1`, [market]);
  return String(rows?.[0]?.d || '').slice(0,10);
}

async function syncLatestMarket(market) {
  const source = SOURCE_BY_MARKET[market];
  const { markAttempt, markSuccess, markError } = syncHelpers();
  await markAttempt(source);
  try {
    const fetchDay = market === '上市' ? fetchTwseCreditDay : fetchTpexCreditDay;
    let selectedDate = '', rows = [];
    for (const iso of recentWeekdays(8)) {
      try {
        const got = await fetchDay(iso);
        if (got.length) { selectedDate = iso; rows = got; break; }
      } catch (e) {
        // Keep checking older weekdays. Official sources can publish at different times.
        console.warn(`[credit] ${market} ${iso} failed`, e?.message || e);
      }
    }
    if (!rows.length) throw new Error(`${market} 近期無可用官方信用交易資料`);
    const count = await upsertCreditTradingRows(rows);
    await markSuccess(source, count);
    return { ok: true, market, tradeDate: selectedDate, rows: count };
  } catch (e) {
    try { await markError(source, e); } catch {}
    return { ok: false, market, preservedLastGood: true, error: String(e?.message || e) };
  }
}

async function runCreditTradingSync() {
  await ensureCreditTradingSchema();
  const results = await Promise.all([syncLatestMarket('上市'), syncLatestMarket('上櫃')]);
  const ok = results.some(x => x.ok);
  return {
    httpStatus: ok ? 200 : 502,
    body: { ok, source: 'credit_trading_daily', markets: results, partial: results.some(x => !x.ok) }
  };
}

async function existingCreditDates(market) {
  await ensureCreditTradingSchema();
  const sql = getSql();
  const rows = await sql.query(`SELECT DISTINCT trade_date::text AS d FROM credit_trading_daily WHERE market=$1 ORDER BY trade_date DESC LIMIT 40`, [market]);
  return new Set(rows.map(x => String(x.d).slice(0,10)));
}

async function runCreditTradingBackfill({ maxNewDays = 4, scanCalendarDays = 70, maxRunMs = 42000 } = {}) {
  await ensureCreditTradingSchema();
  const started = Date.now();
  const existing = { '上市': await existingCreditDates('上市'), '上櫃': await existingCreditDates('上櫃') };
  const addedDates = { '上市': [], '上櫃': [] }, errors = [];
  let iso = taipeiTodayIso();
  for (let scanned = 0; scanned < scanCalendarDays; scanned++, iso = isoAddDays(iso, -1)) {
    if (Date.now() - started > maxRunMs) break;
    if (isWeekend(iso)) continue;
    for (const market of ['上市','上櫃']) {
      if (addedDates[market].length >= maxNewDays || existing[market].has(iso)) continue;
      if (Date.now() - started > maxRunMs) break;
      try {
        const rows = market === '上市' ? await fetchTwseCreditDay(iso) : await fetchTpexCreditDay(iso);
        if (!rows.length) continue;
        await upsertCreditTradingRows(rows);
        existing[market].add(iso);
        addedDates[market].push({ tradeDate: iso, rows: rows.length });
      } catch (e) {
        errors.push({ market, tradeDate: iso, error: String(e?.message || e) });
      }
    }
    if (addedDates['上市'].length >= maxNewDays && addedDates['上櫃'].length >= maxNewDays) break;
  }
  return {
    ok: addedDates['上市'].length > 0 || addedDates['上櫃'].length > 0 || errors.length === 0,
    source: 'credit_trading_backfill', addedDates, errors: errors.slice(0,12), elapsedMs: Date.now() - started
  };
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dailyDelta(row, key, prevKey) {
  const a = toNumberOrNull(row?.[key]), b = toNumberOrNull(row?.[prevKey]);
  return a === null || b === null ? null : a - b;
}

function periodDelta(rows, count, key, prevKey) {
  const used = rows.slice(0, count);
  let total = 0, valid = 0;
  for (const row of used) {
    const d = dailyDelta(row, key, prevKey);
    if (d !== null) { total += d; valid++; }
  }
  return { daysUsed: used.length, complete: used.length >= count, value: valid ? total : null };
}

function creditPeriods(rows) {
  const out = {};
  for (const days of [1,5,10,20]) {
    out[String(days)] = {
      daysUsed: Math.min(rows.length, days),
      complete: rows.length >= days,
      marginChange: periodDelta(rows, days, 'margin_balance', 'margin_prev_balance').value,
      shortChange: periodDelta(rows, days, 'short_balance', 'short_prev_balance').value,
      sblChange: periodDelta(rows, days, 'sbl_balance', 'sbl_prev_balance').value
    };
  }
  return out;
}

async function readCreditTradingForStock(code, market = '') {
  await ensureCreditTradingSchema();
  const sql = getSql();
  const params = [cleanCode(code)];
  let marketSql = '';
  if (/上櫃|otc|tpex|two/i.test(String(market))) { params.push('上櫃'); marketSql = ' AND market=$2'; }
  else if (/上市|twse|sii/i.test(String(market))) { params.push('上市'); marketSql = ' AND market=$2'; }
  const rows = await sql.query(`
    SELECT trade_date::text AS trade_date,stock_code,stock_name,market,
      margin_prev_balance,margin_buy,margin_sell,margin_cash_repay,margin_balance,margin_limit,margin_usage_pct,
      short_prev_balance,short_sell,short_buy,short_stock_repay,short_balance,short_limit,short_usage_pct,offsetting,
      sbl_prev_balance,sbl_sell,sbl_return,sbl_adjustment,sbl_balance,sbl_next_limit,note,margin_source,sbl_source
    FROM credit_trading_daily
    WHERE stock_code=$1${marketSql}
    ORDER BY trade_date DESC
    LIMIT 20
  `, params);
  if (!rows.length) return { available: false, historyCount: 0, periods: {}, history: [] };
  const numericFields = [
    'margin_prev_balance','margin_buy','margin_sell','margin_cash_repay','margin_balance','margin_limit','margin_usage_pct',
    'short_prev_balance','short_sell','short_buy','short_stock_repay','short_balance','short_limit','short_usage_pct','offsetting',
    'sbl_prev_balance','sbl_sell','sbl_return','sbl_adjustment','sbl_balance','sbl_next_limit'
  ];
  const normalized = rows.map(row => {
    const x = { ...row, trade_date: String(row.trade_date).slice(0,10) };
    for (const key of numericFields) x[key] = toNumberOrNull(x[key]);
    x.margin_change = dailyDelta(x, 'margin_balance', 'margin_prev_balance');
    x.short_change = dailyDelta(x, 'short_balance', 'short_prev_balance');
    x.sbl_change = dailyDelta(x, 'sbl_balance', 'sbl_prev_balance');
    x.short_margin_ratio = x.margin_balance > 0 && x.short_balance !== null ? x.short_balance / x.margin_balance * 100 : null;
    return x;
  });
  let price5dPct = null;
  try {
    const prices = await sql.query(`SELECT trade_date::text AS trade_date,close_price FROM market_daily_history WHERE stock_code=$1 ORDER BY trade_date DESC LIMIT 6`, [cleanCode(code)]);
    if (prices.length >= 6) {
      const now = Number(prices[0].close_price), prev = Number(prices[5].close_price);
      if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) price5dPct = (now / prev - 1) * 100;
    }
  } catch {}
  const latest = normalized[0];
  return {
    available: true,
    unit: 'shares',
    asOfDate: latest.trade_date,
    historyCount: normalized.length,
    latest,
    periods: creditPeriods(normalized),
    price5dPct,
    history: normalized,
    source: [latest.margin_source, latest.sbl_source].filter(Boolean).join(' + ')
  };
}

function pctFromChange(balance, change) {
  const b = Number(balance), c = Number(change);
  const prior = b - c;
  return Number.isFinite(b) && Number.isFinite(c) && Math.abs(prior) > 0 ? c / Math.abs(prior) * 100 : null;
}

function buildCreditSignal(credit, institutionalPayload = null) {
  if (!credit?.available || !credit.latest) return { label: '資料不足', tone: 'neutral', reasons: [] };
  const p5 = credit.periods?.['5'];
  const margin5 = Number(p5?.marginChange), short5 = Number(p5?.shortChange), sbl5 = Number(p5?.sblChange);
  const margin5Pct = pctFromChange(credit.latest.margin_balance, margin5);
  const price5 = Number(credit.price5dPct);
  const inst5 = Number(institutionalPayload?.periods?.['5']?.total);
  let score = 0;
  const reasons = [];
  if (Number.isFinite(inst5) && Number.isFinite(price5) && Number.isFinite(margin5)) {
    if (inst5 > 0 && price5 > 0 && margin5 < 0) { score += 2; reasons.push('法人近5日偏買、股價走強且融資下降，籌碼較沉澱'); }
    if (inst5 < 0 && price5 < 0 && margin5 > 0) { score -= 2; reasons.push('法人近5日偏賣、股價走弱但融資增加，出現攤平型籌碼壓力'); }
  }
  if (Number.isFinite(margin5Pct) && Number.isFinite(price5) && price5 >= 5 && margin5Pct >= 5) {
    score -= 1; reasons.push('股價與融資近5日同步快速增加，追價熱度偏高');
  }
  if (Number.isFinite(short5) && Number.isFinite(price5) && short5 > 0 && price5 > 0) {
    score += .5; reasons.push('融券增加但股價仍強，保留軋空可能，不直接視為利空');
  }
  if (Number.isFinite(sbl5) && Number.isFinite(price5) && Number.isFinite(inst5) && sbl5 > 0 && price5 < 0 && inst5 < 0) {
    score -= 1; reasons.push('借券賣出餘額增加，且股價與法人方向同步偏弱');
  }
  if (!reasons.length) reasons.push('信用籌碼目前沒有出現明顯的追價、攤平或軋空組合');
  let label = '中性', tone = 'neutral';
  if (score >= 1.5) { label = '籌碼健康'; tone = 'good'; }
  else if (score <= -1.5) { label = '籌碼偏弱'; tone = 'bad'; }
  else if (score < 0) { label = '偏熱／需觀察'; tone = 'watch'; }
  else if (score > 0) { label = '偏健康'; tone = 'good'; }
  return { label, tone, score, reasons: reasons.slice(0,3), margin5Pct };
}

module.exports = {
  ensureCreditTradingSchema, upsertCreditTradingRows, runCreditTradingSync, runCreditTradingBackfill,
  readCreditTradingForStock, buildCreditSignal,
  _test: {
    num, lotsToShares, rawShares, ymdToIso, rocToIso, recentWeekdays,
    parseTwseMargin, parseTwseSbl, parseTpexMargin, parseTpexSbl, mergeCreditRows, creditPeriods, pctFromChange
  }
};
