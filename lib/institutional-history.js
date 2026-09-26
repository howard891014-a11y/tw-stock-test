// StockZone v2.6.5.17 — persisted official institutional-flow history layer with adaptive accelerated 250/500D research backfill.
// Sources: TWSE T86 + TPEx daily institutional report.
// Quantities are normalized to shares.  The table is append/upsert-only: an
// upstream failure never deletes the previous good snapshot.

function getSql() { return require('./db').getSql(); }
function syncHelpers() { return require('./sync-common'); }

const TWSE_T86 = 'https://www.twse.com.tw/rwd/zh/fund/T86';
const TPEX_DAILY = 'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade';
const TPEX_DAILY_LEGACY = 'https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php';

const SOURCE_BY_MARKET = {
  '上市': 'institutional_flow_twse',
  '上櫃': 'institutional_flow_tpex'
};

function clean(v) {
  return String(v ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\u3000/g, ' ').trim();
}

function cleanCode(v) {
  return clean(v).replace(/^=|"/g, '').replace(/"$/g, '').replace(/\.(TW|TWO)$/i, '');
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(clean(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
}

function ymdToIso(v) {
  const s = String(v || '').replace(/\D/g, '');
  return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : '';
}

function rocToIso(v) {
  const raw = clean(v);
  const digits = raw.replace(/\D/g, '');
  if (/^\d{7}$/.test(digits)) return `${Number(digits.slice(0,3)) + 1911}-${digits.slice(3,5)}-${digits.slice(5,7)}`;
  const m = raw.match(/(\d{2,3})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  return `${Number(m[1]) + 1911}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
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
  const [y,m,d] = String(iso || '').split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0,10);
}

function isWeekend(iso) {
  const [y,m,d] = String(iso || '').split('-').map(Number);
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  return day === 0 || day === 6;
}

function recentWeekdays(max = 10, anchor = taipeiTodayIso()) {
  const out = [];
  let iso = anchor;
  for (let i = 0; out.length < max && i < max + 18; i++, iso = isoAddDays(anchor, -(i + 1))) {
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
          'User-Agent': 'Mozilla/5.0 (StockZone/2.6.5.17; Taiwan institutional flow)',
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

function normField(s) {
  return clean(s).replace(/[\s　]/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')');
}

function fieldIndex(fields, names) {
  const wanted = new Set(names.map(normField));
  return (fields || []).findIndex(x => wanted.has(normField(x)));
}

function valueAt(row, idx) { return idx >= 0 ? num(row?.[idx]) : null; }

function parseTwseAll(payload, requestedIso) {
  if (!payload || String(payload.stat || '').toUpperCase() !== 'OK' || !Array.isArray(payload.data)) return [];
  const reportIso = ymdToIso(payload.date) || requestedIso;
  if (requestedIso && reportIso !== requestedIso) throw new Error(`TWSE T86 日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const codeIdx = fieldIndex(fields, ['證券代號']);
  const nameIdx = fieldIndex(fields, ['證券名稱']);
  const foreignIdx = fieldIndex(fields, ['外陸資買賣超股數(不含外資自營商)', '外陸資買賣超股數（不含外資自營商）']);
  const foreignDealerIdx = fieldIndex(fields, ['外資自營商買賣超股數']);
  const trustIdx = fieldIndex(fields, ['投信買賣超股數']);
  const dealerIdx = fieldIndex(fields, ['自營商買賣超股數']);
  const dealerPropIdx = fieldIndex(fields, ['自營商買賣超股數(自行買賣)', '自營商買賣超股數（自行買賣）']);
  const dealerHedgeIdx = fieldIndex(fields, ['自營商買賣超股數(避險)', '自營商買賣超股數（避險）']);
  const totalIdx = fieldIndex(fields, ['三大法人買賣超股數']);
  return payload.data.map(row => {
    const code = cleanCode(row?.[codeIdx >= 0 ? codeIdx : 0]);
    if (!/^\d{4,6}[A-Z]?$/.test(code)) return null;
    const foreign = valueAt(row, foreignIdx >= 0 ? foreignIdx : 4);
    const trust = valueAt(row, trustIdx >= 0 ? trustIdx : 10);
    const dealer = valueAt(row, dealerIdx >= 0 ? dealerIdx : 11);
    if (foreign === null || trust === null || dealer === null) return null;
    const totalRaw = valueAt(row, totalIdx >= 0 ? totalIdx : 18);
    return {
      date: reportIso, code, name: clean(row?.[nameIdx >= 0 ? nameIdx : 1]), market: '上市',
      foreign, foreignDealer: valueAt(row, foreignDealerIdx >= 0 ? foreignDealerIdx : 7), trust, dealer,
      dealerProprietary: valueAt(row, dealerPropIdx >= 0 ? dealerPropIdx : 14),
      dealerHedge: valueAt(row, dealerHedgeIdx >= 0 ? dealerHedgeIdx : 17),
      total: totalRaw === null ? foreign + trust + dealer : totalRaw,
      source: 'TWSE T86'
    };
  }).filter(Boolean);
}

function parseTpexModernAll(payload, requestedIso) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  const data = Array.isArray(table?.data) ? table.data : [];
  if (!data.length) return [];
  const responseDate = clean(table?.date || payload?.date || '');
  const reportIso = rocToIso(responseDate) || requestedIso;
  if (requestedIso && reportIso !== requestedIso) throw new Error(`TPEx 法人日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  return data.map(row => {
    const code = cleanCode(row?.[0]);
    if (!/^\d{4,6}[A-Z]?$/.test(code) || row.length < 24) return null;
    const foreign = num(row[4]), trust = num(row[13]), dealer = num(row[22]);
    if (foreign === null || trust === null || dealer === null) return null;
    const totalRaw = num(row[23]);
    return {
      date: reportIso, code, name: clean(row[1]), market: '上櫃',
      foreign, foreignDealer: num(row[7]), trust, dealer,
      dealerProprietary: num(row[16]), dealerHedge: num(row[19]),
      total: totalRaw === null ? foreign + trust + dealer : totalRaw,
      source: 'TPEx 三大法人日報'
    };
  }).filter(Boolean);
}

function parseTpexLegacyAll(payload, requestedIso) {
  const data = Array.isArray(payload?.aaData) ? payload.aaData : [];
  if (!data.length) return [];
  const reportIso = rocToIso(payload.reportDate) || requestedIso;
  if (requestedIso && reportIso !== requestedIso) throw new Error(`TPEx 法人日期錯位：要求 ${requestedIso}，實得 ${reportIso}`);
  return data.map(row => {
    const code = cleanCode(row?.[0]);
    if (!/^\d{4,6}[A-Z]?$/.test(code) || row.length < 24) return null;
    const foreign = num(row[4]), trust = num(row[13]), dealer = num(row[22]);
    if (foreign === null || trust === null || dealer === null) return null;
    const totalRaw = num(row[23]);
    return {
      date: reportIso, code, name: clean(row[1]), market: '上櫃',
      foreign, foreignDealer: num(row[7]), trust, dealer,
      dealerProprietary: num(row[16]), dealerHedge: num(row[19]),
      total: totalRaw === null ? foreign + trust + dealer : totalRaw,
      source: 'TPEx 三大法人日報'
    };
  }).filter(Boolean);
}

async function fetchTwseInstitutionalDay(iso) {
  const url = `${TWSE_T86}?response=json&date=${isoToYmd(iso)}&selectType=ALLBUT0999`;
  return parseTwseAll(await fetchJson(url, { retries: 1 }), iso);
}

async function fetchTpexInstitutionalDay(iso) {
  const roc = isoToRocSlash(iso);
  const modern = new URLSearchParams({ type: 'Daily', sect: 'EW', date: roc, id: '', response: 'json' });
  try {
    const rows = parseTpexModernAll(await fetchJson(`${TPEX_DAILY}?${modern.toString()}`, { retries: 1 }), iso);
    if (rows.length) return rows;
  } catch (e) {
    console.warn(`[institutional-history] TPEx modern ${iso} failed`, e?.message || e);
  }
  const legacy = new URLSearchParams({ l: 'zh-tw', o: 'json', se: 'EW', t: 'D', d: roc, s: '0,asc' });
  return parseTpexLegacyAll(await fetchJson(`${TPEX_DAILY_LEGACY}?${legacy.toString()}`, { retries: 1 }), iso);
}

let schemaReady = false;
async function ensureInstitutionalHistorySchema() {
  if (schemaReady) return;
  const sql = getSql();
  await sql.query(`
    CREATE TABLE IF NOT EXISTS institutional_trading_daily (
      trade_date date NOT NULL,
      stock_code text NOT NULL,
      stock_name text,
      market text NOT NULL,
      foreign_net bigint,
      foreign_dealer_net bigint,
      trust_net bigint,
      dealer_net bigint,
      dealer_proprietary_net bigint,
      dealer_hedge_net bigint,
      total_net bigint,
      source text,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date,stock_code,market)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS institutional_trading_daily_code_date_idx ON institutional_trading_daily (stock_code,trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS institutional_trading_daily_market_date_idx ON institutional_trading_daily (market,trade_date DESC)`);
  schemaReady = true;
}

function normalizeWriteRows(rows) {
  return (rows || []).map(row => ({
    trade_date: String(row.date || row.trade_date || '').slice(0,10),
    stock_code: cleanCode(row.code || row.stock_code), stock_name: clean(row.name || row.stock_name),
    market: row.market || '', foreign_net: num(row.foreign ?? row.foreign_net),
    foreign_dealer_net: num(row.foreignDealer ?? row.foreign_dealer_net), trust_net: num(row.trust ?? row.trust_net),
    dealer_net: num(row.dealer ?? row.dealer_net), dealer_proprietary_net: num(row.dealerProprietary ?? row.dealer_proprietary_net),
    dealer_hedge_net: num(row.dealerHedge ?? row.dealer_hedge_net), total_net: num(row.total ?? row.total_net),
    source: clean(row.source)
  })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.trade_date) && /^\d{4,6}[A-Z]?$/.test(row.stock_code) && ['上市','上櫃'].includes(row.market));
}

async function upsertInstitutionalRows(rows) {
  const incoming = normalizeWriteRows(rows);
  if (!incoming.length) return 0;
  await ensureInstitutionalHistorySchema();
  const sql = getSql();
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        trade_date date,stock_code text,stock_name text,market text,
        foreign_net bigint,foreign_dealer_net bigint,trust_net bigint,dealer_net bigint,
        dealer_proprietary_net bigint,dealer_hedge_net bigint,total_net bigint,source text
      )
    )
    INSERT INTO institutional_trading_daily (
      trade_date,stock_code,stock_name,market,foreign_net,foreign_dealer_net,trust_net,dealer_net,
      dealer_proprietary_net,dealer_hedge_net,total_net,source,updated_at
    )
    SELECT trade_date,stock_code,stock_name,market,foreign_net,foreign_dealer_net,trust_net,dealer_net,
      dealer_proprietary_net,dealer_hedge_net,total_net,source,NOW()
    FROM incoming
    ON CONFLICT (trade_date,stock_code,market) DO UPDATE SET
      stock_name=COALESCE(NULLIF(EXCLUDED.stock_name,''),institutional_trading_daily.stock_name),
      foreign_net=COALESCE(EXCLUDED.foreign_net,institutional_trading_daily.foreign_net),
      foreign_dealer_net=COALESCE(EXCLUDED.foreign_dealer_net,institutional_trading_daily.foreign_dealer_net),
      trust_net=COALESCE(EXCLUDED.trust_net,institutional_trading_daily.trust_net),
      dealer_net=COALESCE(EXCLUDED.dealer_net,institutional_trading_daily.dealer_net),
      dealer_proprietary_net=COALESCE(EXCLUDED.dealer_proprietary_net,institutional_trading_daily.dealer_proprietary_net),
      dealer_hedge_net=COALESCE(EXCLUDED.dealer_hedge_net,institutional_trading_daily.dealer_hedge_net),
      total_net=COALESCE(EXCLUDED.total_net,institutional_trading_daily.total_net),
      source=COALESCE(NULLIF(EXCLUDED.source,''),institutional_trading_daily.source),updated_at=NOW()
  `, [JSON.stringify(incoming)]);
  return incoming.length;
}

async function readInstitutionalForStock(code, market = '', limit = 20) {
  await ensureInstitutionalHistorySchema();
  const sql = getSql();
  const params = [cleanCode(code)];
  let marketSql = '';
  if (/上櫃|otc|tpex|two/i.test(String(market))) { params.push('上櫃'); marketSql = ' AND market=$2'; }
  else if (/上市|twse|sii/i.test(String(market))) { params.push('上市'); marketSql = ' AND market=$2'; }
  params.push(Math.max(1, Math.min(60, Number(limit) || 20)));
  const limitParam = params.length;
  const rows = await sql.query(`
    SELECT trade_date::text AS trade_date,stock_code,stock_name,market,
      foreign_net,foreign_dealer_net,trust_net,dealer_net,dealer_proprietary_net,dealer_hedge_net,total_net,source
    FROM institutional_trading_daily
    WHERE stock_code=$1${marketSql}
    ORDER BY trade_date DESC
    LIMIT $${limitParam}
  `, params);
  return rows.map(row => ({
    date: String(row.trade_date).slice(0,10), code: cleanCode(row.stock_code), name: clean(row.stock_name), market: row.market,
    foreign: num(row.foreign_net), foreignDealer: num(row.foreign_dealer_net), trust: num(row.trust_net), dealer: num(row.dealer_net),
    dealerProprietary: num(row.dealer_proprietary_net), dealerHedge: num(row.dealer_hedge_net), total: num(row.total_net),
    source: clean(row.source) || (row.market === '上市' ? 'TWSE T86' : 'TPEx 三大法人日報')
  }));
}

async function expectedLatestTradeDate(market) {
  try {
    const sql = getSql();
    const rows = await sql.query(`SELECT MAX(trade_date)::text AS d FROM market_daily_history WHERE market=$1`, [market]);
    return String(rows?.[0]?.d || '').slice(0,10);
  } catch { return ''; }
}

async function institutionalHistoryIsFresh(rows, market) {
  if (!rows?.length) return false;
  const expected = await expectedLatestTradeDate(market);
  if (!expected) return true;
  return String(rows[0]?.date || '') >= expected;
}

async function syncLatestMarket(market) {
  const { markAttempt, markSuccess, markError } = syncHelpers();
  const source = SOURCE_BY_MARKET[market];
  await markAttempt(source);
  try {
    const fetchDay = market === '上市' ? fetchTwseInstitutionalDay : fetchTpexInstitutionalDay;
    let selectedDate = '', rows = [];
    for (const iso of recentWeekdays(8)) {
      try {
        const got = await fetchDay(iso);
        if (got.length) { selectedDate = iso; rows = got; break; }
      } catch (e) {
        console.warn(`[institutional-history] ${market} ${iso} failed`, e?.message || e);
      }
    }
    if (!rows.length) throw new Error(`${market} 近期無可用官方法人資料`);
    const count = await upsertInstitutionalRows(rows);
    await markSuccess(source, count);
    return { ok: true, market, tradeDate: selectedDate, rows: count };
  } catch (e) {
    try { await markError(source, e); } catch {}
    return { ok: false, market, preservedLastGood: true, error: String(e?.message || e) };
  }
}

async function runInstitutionalSync() {
  await ensureInstitutionalHistorySchema();
  const results = await Promise.all([syncLatestMarket('上市'), syncLatestMarket('上櫃')]);
  const ok = results.some(x => x.ok);
  return { httpStatus: ok ? 200 : 502, body: { ok, source: 'institutional_trading_daily', markets: results, partial: results.some(x => !x.ok) } };
}

async function existingInstitutionalDates(market, limit = 550) {
  await ensureInstitutionalHistorySchema();
  const sql = getSql();
  const rows = await sql.query(`
    SELECT DISTINCT trade_date::text AS d
    FROM institutional_trading_daily
    WHERE market=$1
    ORDER BY trade_date DESC
    LIMIT $2
  `, [market, Math.max(20, Math.min(650, Number(limit) || 550))]);
  return new Set(rows.map(x => String(x.d).slice(0,10)));
}

// v2.6.5.16: market_daily_history is the canonical trading calendar.  Using it
// avoids repeatedly calling institutional endpoints on weekends/holidays and
// makes deep backfill resume from the exact dates already persisted in DB.
async function marketTradingDates(market, targetTradingDays = 500) {
  const sql = getSql();
  const rows = await sql.query(`
    SELECT trade_date::text AS d
    FROM (
      SELECT DISTINCT trade_date
      FROM market_daily_history
      WHERE market=$1
      ORDER BY trade_date DESC
      LIMIT $2
    ) x
    ORDER BY d DESC
  `, [market, Math.max(20, Math.min(550, Number(targetTradingDays) || 500))]);
  return rows.map(x => String(x.d).slice(0,10)).filter(Boolean);
}

function historyProgress(covered, target) {
  return target > 0 ? Number((Math.min(covered, target) / target * 100).toFixed(1)) : 0;
}

async function runInstitutionalBackfill({ targetTradingDays = 500, maxNewDays = 24, maxRunMs = 45000, concurrency = 3 } = {}) {
  await ensureInstitutionalHistorySchema();
  const started = Date.now();
  const target = Math.max(20, Math.min(500, Number(targetTradingDays) || 500));
  const perMarketBudget = Math.max(1, Math.min(30, Number(maxNewDays) || 24));
  const workerCount = Math.max(1, Math.min(4, Number(concurrency) || 3));
  const addedDates = { '上市': [], '上櫃': [] }, errors = [], markets = {};

  const runMarket = async market => {
    const existing = await existingInstitutionalDates(market, Math.max(550, target + 30));
    const calendar = await marketTradingDates(market, target);
    const fetchDay = market === '上市' ? fetchTwseInstitutionalDay : fetchTpexInstitutionalDay;
    const missing = calendar.filter(d => !existing.has(d));
    let attempts = 0, cursor = 0;
    const maxAttempts = Math.max(perMarketBudget, perMarketBudget * 3);
    const worker = async () => {
      while (cursor < missing.length && attempts < maxAttempts && addedDates[market].length < perMarketBudget && Date.now() - started < maxRunMs) {
        const iso = missing[cursor++]; attempts++;
        try {
          const rows = await fetchDay(iso);
          if (!rows.length) { errors.push({ market, tradeDate: iso, error: 'official report returned 0 rows' }); continue; }
          await upsertInstitutionalRows(rows);
          existing.add(iso);
          if (addedDates[market].length < perMarketBudget) addedDates[market].push({ tradeDate: iso, rows: rows.length });
        } catch (e) { errors.push({ market, tradeDate: iso, error: String(e?.message || e) }); }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const covered = calendar.filter(d => existing.has(d)).length;
    markets[market] = {
      targetTradingDays: target,
      availableMarketCalendarDays: calendar.length,
      coveredTradingDays: covered,
      complete: calendar.length >= target && covered >= target,
      waitingForMarketHistory: calendar.length < target,
      progressPct: historyProgress(covered, target),
      missingWithinAvailableCalendar: Math.max(0, calendar.length - covered),
      addedThisRun: addedDates[market].length,
      attempts, concurrency: workerCount
    };
  };
  await Promise.all(['上市','上櫃'].map(runMarket));

  const complete = ['上市','上櫃'].every(m => markets[m]?.complete);
  return {
    ok: complete || addedDates['上市'].length > 0 || addedDates['上櫃'].length > 0 || errors.length === 0,
    complete, targetTradingDays: target, source: 'institutional_trading_backfill', markets,
    addedDates, errors: errors.slice(0,16), elapsedMs: Date.now() - started
  };
}

async function readInstitutionalHistoryHealth() {
  await ensureInstitutionalHistorySchema();
  const sql = getSql();
  const rows = await sql.query(`
    WITH latest AS (
      SELECT market, MAX(trade_date) AS max_date
      FROM institutional_trading_daily
      GROUP BY market
    )
    SELECT d.market, COUNT(*)::int AS rows, COUNT(DISTINCT d.trade_date)::int AS trading_days,
      MIN(d.trade_date)::text AS min_date, MAX(d.trade_date)::text AS max_date,
      COUNT(*) FILTER (WHERE d.trade_date=l.max_date)::int AS latest_rows,
      MAX(d.updated_at)::text AS updated_at
    FROM institutional_trading_daily d
    JOIN latest l ON l.market=d.market
    GROUP BY d.market
    ORDER BY d.market
  `);
  const out = { totalRows: 0, markets: {} };
  for (const row of rows) {
    const item = {
      rows: Number(row.rows) || 0, tradingDays: Number(row.trading_days) || 0,
      minDate: String(row.min_date || '').slice(0,10), maxDate: String(row.max_date || '').slice(0,10),
      latestRows: Number(row.latest_rows) || 0, updatedAt: row.updated_at || null
    };
    out.totalRows += item.rows;
    out.markets[row.market] = item;
  }
  return out;
}

module.exports = {
  ensureInstitutionalHistorySchema, upsertInstitutionalRows, readInstitutionalForStock,
  institutionalHistoryIsFresh, runInstitutionalSync, runInstitutionalBackfill, readInstitutionalHistoryHealth,
  _test: {
    cleanCode, num, ymdToIso, rocToIso, recentWeekdays, parseTwseAll, parseTpexModernAll, parseTpexLegacyAll
  }
};
