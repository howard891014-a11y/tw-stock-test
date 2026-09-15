const {
  clean, numberOrNull, rocToIso, fetchJson, first, taipeiDateParts, isCronAuthorized,
  markAttempt, markSuccess, markError, upsertPriceRows
} = require('../lib/sync-common');

const SOURCE = 'price_daily';
const TWSE_OPENAPI_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

function validCode(v) { return /^\d{4,6}$/.test(clean(v)); }

function twseOpenApiRows(data) {
  if (!Array.isArray(data)) throw new Error('TWSE OpenAPI 股價格式不是陣列');
  return data.map(x => {
    const close = numberOrNull(x?.ClosingPrice);
    const date = rocToIso(x?.Date);
    const code = clean(x?.Code);
    if (!validCode(code) || !date || close === null || close <= 0) return null;
    const change = numberOrNull(x?.Change);
    return {
      stock_code: code, stock_name: clean(x?.Name), market: '上市', trade_date: date,
      close_price: close, previous_close: change === null ? null : close - change,
      open_price: numberOrNull(x?.OpeningPrice), high_price: numberOrNull(x?.HighestPrice),
      low_price: numberOrNull(x?.LowestPrice), quote_time: null, source: 'TWSE STOCK_DAY_ALL fallback'
    };
  }).filter(Boolean);
}

function dateFromTwseRwd(json, table) {
  const direct = rocToIso(json?.date || json?.Date || '');
  if (direct) return direct;
  const title = clean(table?.title || '');
  const m = title.match(/(\d{3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return '';
  return `${Number(m[1]) + 1911}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function twseRwdRows(json) {
  if (!json || typeof json !== 'object') throw new Error('TWSE MI_INDEX 格式不是物件');
  if (json.stat && json.stat !== 'OK') throw new Error(`TWSE MI_INDEX：${clean(json.stat)}`);
  const tables = Array.isArray(json.tables) ? json.tables : [];
  const table = tables.find(t => {
    const f = Array.isArray(t?.fields) ? t.fields.map(clean) : [];
    return f.includes('證券代號') && f.includes('證券名稱') && f.includes('收盤價');
  });
  if (!table || !Array.isArray(table.data)) throw new Error('TWSE MI_INDEX 找不到個股收盤表');
  const fields = table.fields.map(clean);
  const idx = Object.fromEntries(fields.map((f, i) => [f, i]));
  const tradeDate = dateFromTwseRwd(json, table);
  if (!tradeDate) throw new Error('TWSE MI_INDEX 無法判斷交易日');

  return table.data.map(row => {
    const code = clean(row?.[idx['證券代號']]);
    const close = numberOrNull(row?.[idx['收盤價']]);
    if (!validCode(code) || close === null || close <= 0) return null;
    const diffAbs = numberOrNull(row?.[idx['漲跌價差']]);
    const signText = clean(row?.[idx['漲跌(+/-)']]);
    let signedChange = null;
    if (diffAbs !== null) {
      if (signText.includes('-')) signedChange = -Math.abs(diffAbs);
      else if (signText.includes('+')) signedChange = Math.abs(diffAbs);
      else if (diffAbs === 0) signedChange = 0;
    }
    return {
      stock_code: code,
      stock_name: clean(row?.[idx['證券名稱']]),
      market: '上市',
      trade_date: tradeDate,
      close_price: close,
      previous_close: signedChange === null ? null : close - signedChange,
      open_price: numberOrNull(row?.[idx['開盤價']]),
      high_price: numberOrNull(row?.[idx['最高價']]),
      low_price: numberOrNull(row?.[idx['最低價']]),
      quote_time: null,
      source: 'TWSE MI_INDEX'
    };
  }).filter(Boolean);
}

function tpexRows(data) {
  if (!Array.isArray(data)) throw new Error('TPEx 股價格式不是陣列');
  return data.map(x => {
    const code = clean(first(x, ['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號']));
    const close = numberOrNull(first(x, ['Close','ClosingPrice','收盤價']));
    const date = rocToIso(first(x, ['Date','TradeDate','資料日期']));
    if (!validCode(code) || !date || close === null || close <= 0) return null;
    const change = numberOrNull(first(x, ['Change','ChangeAmount','PriceChange','漲跌']));
    return {
      stock_code: code,
      stock_name: clean(first(x, ['CompanyName','SecuritiesCompanyName','SecuritiesName','Name','證券名稱'])),
      market: '上櫃', trade_date: date, close_price: close, previous_close: change === null ? null : close - change,
      open_price: numberOrNull(first(x, ['Open','OpeningPrice','開盤價'])),
      high_price: numberOrNull(first(x, ['High','HighestPrice','最高價'])),
      low_price: numberOrNull(first(x, ['Low','LowestPrice','最低價'])),
      quote_time: null, source: 'TPEx mainboard daily close'
    };
  }).filter(Boolean);
}

async function fetchTwseRows() {
  const tw = taipeiDateParts();
  const ymd = tw.date.replace(/-/g, '');
  const rwdUrl = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  let rwdError = null;
  try {
    const raw = await fetchJson(rwdUrl, { retries:1, timeoutMs:15000 });
    const rows = twseRwdRows(raw);
    if (rows.length >= 300) return { rows, upstream:'TWSE MI_INDEX' };
    rwdError = new Error(`TWSE MI_INDEX 股價有效筆數異常：${rows.length}`);
  } catch (e) {
    rwdError = e;
  }

  // 非交易日或 MI_INDEX 尚未產出時，才退回「最近交易日」OpenAPI；
  // 後面仍會和 TPEx 日期比對，日期不一致就拒絕寫入。
  try {
    const raw = await fetchJson(TWSE_OPENAPI_URL, { retries:1, timeoutMs:15000 });
    const rows = twseOpenApiRows(raw);
    if (rows.length < 300) throw new Error(`TWSE OpenAPI 股價有效筆數異常：${rows.length}`);
    return { rows, upstream:'TWSE STOCK_DAY_ALL fallback' };
  } catch (fallbackError) {
    throw new Error(`TWSE 主來源失敗：${String(rwdError?.message||rwdError)}；備援失敗：${String(fallbackError?.message||fallbackError)}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isCronAuthorized(req)) return res.status(401).json({ ok:false, error:'Unauthorized' });
  // Hobby Cron 只有小時級精準度：13:30 這支若被提前到 13:00~13:29，先跳過；14:00 另有保底排程。
  const cronSchedule = req.headers?.['x-vercel-cron-schedule'];
  const tw = taipeiDateParts();
  if (cronSchedule && (tw.hour < 13 || (tw.hour === 13 && tw.minute < 30))) {
    return res.status(202).json({ok:true,skipped:true,reason:'before 13:30 Asia/Taipei',taipeiTime:`${tw.date} ${String(tw.hour).padStart(2,'0')}:${String(tw.minute).padStart(2,'0')}`});
  }
  try {
    await markAttempt(SOURCE);
    const [twseResult, tpexRaw] = await Promise.all([
      fetchTwseRows(),
      fetchJson(TPEX_URL, { retries:1, timeoutMs:15000 })
    ]);
    const twse = twseResult.rows, tpex = tpexRows(tpexRaw);
    if (tpex.length < 200) throw new Error(`TPEx 股價有效筆數異常：${tpex.length}`);
    const twseDates=[...new Set(twse.map(x=>x.trade_date))], tpexDates=[...new Set(tpex.map(x=>x.trade_date))];
    if(twseDates.length!==1 || tpexDates.length!==1 || twseDates[0]!==tpexDates[0]) {
      throw new Error(`兩市場交易日不同步：TWSE=${twseDates.join(',')} TPEx=${tpexDates.join(',')}（TWSE來源=${twseResult.upstream}）`);
    }
    const rows = [...twse, ...tpex];
    await upsertPriceRows(rows);
    await markSuccess(SOURCE, rows.length);
    return res.status(200).json({ ok:true, source:SOURCE, rows:rows.length, twse:twse.length, tpex:tpex.length,
      twseUpstream:twseResult.upstream, tradeDates:[...new Set(rows.map(x=>x.trade_date))].sort() });
  } catch (e) {
    try { await markError(SOURCE, e); } catch {}
    return res.status(502).json({ ok:false, source:SOURCE, preservedLastGood:true, error:String(e?.message||e) });
  }
};

module.exports._test = { twseOpenApiRows, twseRwdRows, tpexRows, dateFromTwseRwd };
