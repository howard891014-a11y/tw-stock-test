const {
  clean, numberOrNull, rocToIso, fetchJson, first, taipeiDateParts, isCronAuthorized,
  markAttempt, markSuccess, markError, upsertPriceRows
} = require('../lib/sync-common');

const SOURCE = 'price_daily';
const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

function validCode(v) { return /^\d{4,6}$/.test(clean(v)); }

function twseRows(data) {
  if (!Array.isArray(data)) throw new Error('TWSE 股價格式不是陣列');
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
      low_price: numberOrNull(x?.LowestPrice), quote_time: null, source: 'TWSE STOCK_DAY_ALL'
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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isCronAuthorized(req)) return res.status(401).json({ ok:false, error:'Unauthorized' });
  // Hobby Cron 只有「小時級」精準度：13:30 這支若被提前到 13:00~13:29，先跳過，14:00 有保底排程。
  const cronSchedule = req.headers?.['x-vercel-cron-schedule'];
  const tw = taipeiDateParts();
  if (cronSchedule && (tw.hour < 13 || (tw.hour === 13 && tw.minute < 30))) {
    return res.status(202).json({ok:true,skipped:true,reason:'before 13:30 Asia/Taipei',taipeiTime:`${tw.date} ${String(tw.hour).padStart(2,'0')}:${String(tw.minute).padStart(2,'0')}`});
  }
  try {
    await markAttempt(SOURCE);
    const [twseRaw, tpexRaw] = await Promise.all([
      fetchJson(TWSE_URL, { retries:1, timeoutMs:15000 }),
      fetchJson(TPEX_URL, { retries:1, timeoutMs:15000 })
    ]);
    const twse = twseRows(twseRaw), tpex = tpexRows(tpexRaw);
    // 防止官方格式改版/空回傳時把「同步成功」誤判成真；門檻刻意低於正常市場筆數。
    if (twse.length < 300) throw new Error(`TWSE 股價有效筆數異常：${twse.length}`);
    if (tpex.length < 200) throw new Error(`TPEx 股價有效筆數異常：${tpex.length}`);
    const twseDates=[...new Set(twse.map(x=>x.trade_date))], tpexDates=[...new Set(tpex.map(x=>x.trade_date))];
    if(twseDates.length!==1 || tpexDates.length!==1 || twseDates[0]!==tpexDates[0]) {
      throw new Error(`兩市場交易日不同步：TWSE=${twseDates.join(',')} TPEx=${tpexDates.join(',')}`);
    }
    const rows = [...twse, ...tpex];
    await upsertPriceRows(rows);
    await markSuccess(SOURCE, rows.length);
    return res.status(200).json({ ok:true, source:SOURCE, rows:rows.length, twse:twse.length, tpex:tpex.length,
      tradeDates:[...new Set(rows.map(x=>x.trade_date))].sort() });
  } catch (e) {
    try { await markError(SOURCE, e); } catch {}
    return res.status(502).json({ ok:false, source:SOURCE, preservedLastGood:true, error:String(e?.message||e) });
  }
};

module.exports._test = { twseRows, tpexRows };
