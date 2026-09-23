const {
  clean, numberOrNull, rocToIso, parsePeriod, fetchJson, normalizeTableJson, rowObject, first,
  taipeiDateParts, markAttempt, markSuccess, markError, upsertPriceAndHistoryRows, replaceDisposalMarket
} = require('./sync-common');

const PRICE_SOURCE = 'price_daily';
const TWSE_DISPOSAL_SOURCE = 'twse_disposal';
const TPEX_DISPOSAL_SOURCE = 'tpex_disposal';

const TWSE_OPENAPI_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_PRICE_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const TWSE_DISPOSAL_URL = 'https://www.twse.com.tw/rwd/zh/announcement/punish?response=json';
const TPEX_DISPOSAL_PRIMARY = 'https://www.tpex.org.tw/openapi/v1/tpex_disposal_information';
const TPEX_DISPOSAL_BACKUP = 'https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information_result.php?l=zh-tw&o=json';

function validCode(v) { return /^\d{4,6}$/.test(clean(v)); }

function pctChange(close, previousClose) {
  if (!Number.isFinite(close) || !Number.isFinite(previousClose) || previousClose <= 0) return null;
  return ((close - previousClose) / previousClose) * 100;
}

function withMarketStats(row, { tradeVolume = null, tradeValue = null, transactionCount = null, changeAmount = null } = {}) {
  const previousClose = row.previous_close;
  return {
    ...row,
    trade_volume: tradeVolume,
    trade_value: tradeValue,
    transaction_count: transactionCount,
    change_amount: changeAmount,
    change_pct: pctChange(row.close_price, previousClose)
  };
}

function twseOpenApiRows(data) {
  if (!Array.isArray(data)) throw new Error('TWSE OpenAPI 股價格式不是陣列');
  return data.map(x => {
    const close = numberOrNull(x?.ClosingPrice);
    const date = rocToIso(x?.Date);
    const code = clean(x?.Code);
    if (!validCode(code) || !date || close === null || close <= 0) return null;
    const change = numberOrNull(x?.Change);
    return withMarketStats({
      stock_code: code, stock_name: clean(x?.Name), market: '上市', trade_date: date,
      close_price: close, previous_close: change === null ? null : close - change,
      open_price: numberOrNull(x?.OpeningPrice), high_price: numberOrNull(x?.HighestPrice),
      low_price: numberOrNull(x?.LowestPrice), quote_time: null, source: 'TWSE STOCK_DAY_ALL fallback'
    }, {
      tradeVolume: numberOrNull(x?.TradeVolume),
      tradeValue: numberOrNull(x?.TradeValue),
      transactionCount: numberOrNull(x?.Transaction),
      changeAmount: change
    });
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
    return withMarketStats({
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
    }, {
      tradeVolume: numberOrNull(row?.[idx['成交股數']]),
      tradeValue: numberOrNull(row?.[idx['成交金額']]),
      transactionCount: numberOrNull(row?.[idx['成交筆數']]),
      changeAmount: signedChange
    });
  }).filter(Boolean);
}

function tpexPriceRows(data) {
  if (!Array.isArray(data)) throw new Error('TPEx 股價格式不是陣列');
  return data.map(x => {
    const code = clean(first(x, ['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號']));
    const close = numberOrNull(first(x, ['Close','ClosingPrice','收盤價']));
    const date = rocToIso(first(x, ['Date','TradeDate','資料日期']));
    if (!validCode(code) || !date || close === null || close <= 0) return null;
    const change = numberOrNull(first(x, ['Change','ChangeAmount','PriceChange','漲跌']));
    return withMarketStats({
      stock_code: code,
      stock_name: clean(first(x, ['CompanyName','SecuritiesCompanyName','SecuritiesName','Name','證券名稱'])),
      market: '上櫃', trade_date: date, close_price: close, previous_close: change === null ? null : close - change,
      open_price: numberOrNull(first(x, ['Open','OpeningPrice','開盤價'])),
      high_price: numberOrNull(first(x, ['High','HighestPrice','最高價'])),
      low_price: numberOrNull(first(x, ['Low','LowestPrice','最低價'])),
      quote_time: null, source: 'TPEx mainboard daily close'
    }, {
      tradeVolume: numberOrNull(first(x, ['TradingShares','TradeVolume','TradingVolume','成交股數','成交量'])),
      tradeValue: numberOrNull(first(x, ['TransactionAmount','TradeValue','TradingValue','成交金額','成交值'])),
      transactionCount: numberOrNull(first(x, ['TransactionNumber','Transaction','成交筆數'])),
      changeAmount: change
    });
  }).filter(Boolean);
}

function assertMarketHistoryCoverage(rows, market) {
  if (!rows.length) throw new Error(`${market} 行情解析為 0 筆`);
  const volumeOk = rows.filter(x => x.trade_volume !== null).length;
  const valueOk = rows.filter(x => x.trade_value !== null).length;
  const minRequired = Math.floor(rows.length * 0.95);
  if (volumeOk < minRequired || valueOk < minRequired) {
    throw new Error(`${market} 成交量值欄位不完整：volume=${volumeOk}/${rows.length}, value=${valueOk}/${rows.length}`);
  }
}

async function fetchTwsePriceRows() {
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
  try {
    const raw = await fetchJson(TWSE_OPENAPI_URL, { retries:1, timeoutMs:15000 });
    const rows = twseOpenApiRows(raw);
    if (rows.length < 300) throw new Error(`TWSE OpenAPI 股價有效筆數異常：${rows.length}`);
    return { rows, upstream:'TWSE STOCK_DAY_ALL fallback' };
  } catch (fallbackError) {
    throw new Error(`TWSE 主來源失敗：${String(rwdError?.message||rwdError)}；備援失敗：${String(fallbackError?.message||fallbackError)}`);
  }
}

async function runPriceSync({ cronSchedule = '' } = {}) {
  const tw = taipeiDateParts();
  if (cronSchedule && (tw.hour < 13 || (tw.hour === 13 && tw.minute < 30))) {
    return { httpStatus:202, body:{ok:true,skipped:true,reason:'before 13:30 Asia/Taipei',taipeiTime:`${tw.date} ${String(tw.hour).padStart(2,'0')}:${String(tw.minute).padStart(2,'0')}`} };
  }
  try {
    await markAttempt(PRICE_SOURCE);
    const [twseResult, tpexRaw] = await Promise.all([
      fetchTwsePriceRows(),
      fetchJson(TPEX_PRICE_URL, { retries:1, timeoutMs:15000 })
    ]);
    const twse = twseResult.rows, tpex = tpexPriceRows(tpexRaw);
    if (tpex.length < 200) throw new Error(`TPEx 股價有效筆數異常：${tpex.length}`);
    assertMarketHistoryCoverage(twse, 'TWSE');
    assertMarketHistoryCoverage(tpex, 'TPEx');
    const twseDates=[...new Set(twse.map(x=>x.trade_date))], tpexDates=[...new Set(tpex.map(x=>x.trade_date))];
    if(twseDates.length!==1 || tpexDates.length!==1 || twseDates[0]!==tpexDates[0]) {
      throw new Error(`兩市場交易日不同步：TWSE=${twseDates.join(',')} TPEx=${tpexDates.join(',')}（TWSE來源=${twseResult.upstream}）`);
    }
    const rows = [...twse, ...tpex];
    await upsertPriceAndHistoryRows(rows);
    await markSuccess(PRICE_SOURCE, rows.length);
    const valueRows = rows.filter(x => x.trade_value !== null).length;
    const volumeRows = rows.filter(x => x.trade_volume !== null).length;
    return { httpStatus:200, body:{ok:true,source:PRICE_SOURCE,rows:rows.length,twse:twse.length,tpex:tpex.length,
      twseUpstream:twseResult.upstream,tradeDates:[...new Set(rows.map(x=>x.trade_date))].sort(),
      historySaved:true,valueRows,volumeRows} };
  } catch (e) {
    try { await markError(PRICE_SOURCE, e); } catch {}
    return { httpStatus:502, body:{ok:false,source:PRICE_SOURCE,preservedLastGood:true,error:String(e?.message||e)} };
  }
}

function parseTwseDisposalRows(json) {
  const table = normalizeTableJson(json);
  if (!table.data.length && !Array.isArray(json?.data) && !Array.isArray(json?.tables)) {
    throw new Error('TWSE 處置資料格式無法辨識');
  }
  const out = [];
  for (const rawRow of table.data) {
    const x = rowObject(table.fields, rawRow);
    const code = clean(first(x, ['證券代號','Code','SecuritiesCode']));
    if (!validCode(code)) continue;
    const periodRaw = first(x, ['處置起迄時間','處置起訖時間','DispositionPeriod']);
    const reason = clean(first(x, ['處置條件','處置原因','處置內容','DisposalCondition']));
    const p = parsePeriod(periodRaw, reason);
    if (!p.start || !p.end) continue;
    out.push({
      stock_code: code,
      stock_name: clean(first(x, ['證券名稱','Name','SecuritiesName'])),
      announcement_date: rocToIso(first(x, ['公布日期','公告日期','Date','AnnouncementDate'])) || null,
      start_date: p.start, end_date: p.end, reason, raw_data: x
    });
  }
  return out;
}

async function runTwseDisposalSync() {
  try {
    await markAttempt(TWSE_DISPOSAL_SOURCE);
    const raw = await fetchJson(TWSE_DISPOSAL_URL, { retries:1, timeoutMs:15000 });
    const rows = parseTwseDisposalRows(raw);
    if(!rows.length) throw new Error('TWSE 處置解析為 0 筆，保留上一份成功快照');
    await replaceDisposalMarket('上市', rows);
    await markSuccess(TWSE_DISPOSAL_SOURCE, rows.length);
    return { httpStatus:200, body:{ok:true,source:TWSE_DISPOSAL_SOURCE,market:'上市',rows:rows.length} };
  } catch (e) {
    try { await markError(TWSE_DISPOSAL_SOURCE,e); } catch {}
    return { httpStatus:502, body:{ok:false,source:TWSE_DISPOSAL_SOURCE,preservedLastGood:true,error:String(e?.message||e)} };
  }
}

function parseTpexDisposalRows(json) {
  const table = normalizeTableJson(json);
  const sourceRows = table.data;
  if (!Array.isArray(sourceRows)) throw new Error('TPEx 處置資料格式不是陣列');
  const out=[];
  for (const rawRow of sourceRows) {
    const x = rowObject(table.fields, rawRow);
    const code = clean(first(x,['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號','股票代號']));
    if (!validCode(code)) continue;
    const periodRaw = first(x,['DispositionPeriod','處置起訖時間','處置起迄時間']);
    const reason = clean(first(x,['DisposalCondition','DispositionReasons','DispositionReason','DisposalInformation','處置原因','處置內容']));
    const p = parsePeriod(periodRaw, `${reason} ${periodRaw}`);
    if (!p.start || !p.end) continue;
    out.push({
      stock_code:code,
      stock_name:clean(first(x,['CompanyName','SecuritiesCompanyName','SecuritiesName','Name','證券名稱'])),
      announcement_date:rocToIso(first(x,['Date','AnnouncementDate','公布日期','公告日期','處置日期']))||null,
      start_date:p.start,end_date:p.end,reason,raw_data:x
    });
  }
  return out;
}

function normalizeTpexLegacy(json) {
  const table = normalizeTableJson(json);
  if (!Array.isArray(table.data) || !table.data.length || !Array.isArray(table.fields) || !table.fields.length) return [];
  const fields = table.fields.map(clean);
  const idx = names => { for (const n of names) { const i=fields.indexOf(n); if(i>=0)return i; } return -1; };
  const ci=idx(['證券代號','股票代號']), ni=idx(['證券名稱','股票名稱']), di=idx(['公布日期','公告日期','日期']);
  const pi=idx(['處置起訖時間','處置起迄時間']), ri=idx(['處置原因','處置條件']), ti=idx(['處置內容','處置措施']);
  if (ci<0 || pi<0) return [];
  return table.data.map(r=>({
    Date:di>=0?clean(r[di]):'', SecuritiesCompanyCode:clean(r[ci]), CompanyName:ni>=0?clean(r[ni]):'',
    DispositionPeriod:clean(r[pi]), DispositionReasons:ri>=0?clean(r[ri]):'',
    DisposalCondition:ti>=0?clean(r[ti]):(ri>=0?clean(r[ri]):'')
  })).filter(x=>x.SecuritiesCompanyCode);
}

async function fetchTpexDisposalWithOfficialBackup() {
  let primaryError='';
  try {
    const j=await fetchJson(TPEX_DISPOSAL_PRIMARY,{retries:1,timeoutMs:15000});
    if (!Array.isArray(j)) throw new Error('TPEx OpenAPI 回傳格式不是陣列');
    if (!j.length) throw new Error('TPEx OpenAPI 回傳空陣列');
    return {json:j,source:TPEX_DISPOSAL_PRIMARY};
  } catch(e) { primaryError=String(e?.message||e); }
  try {
    const j=await fetchJson(TPEX_DISPOSAL_BACKUP,{retries:1,timeoutMs:18000});
    const normalized=normalizeTpexLegacy(j);
    if (!normalized.length) throw new Error('TPEx 官方 JSON 備援無可解析處置資料');
    return {json:normalized,source:TPEX_DISPOSAL_BACKUP};
  } catch(e) {
    throw new Error(`TPEx primary=${primaryError}; backup=${String(e?.message||e)}`);
  }
}

async function runTpexDisposalSync() {
  try {
    await markAttempt(TPEX_DISPOSAL_SOURCE);
    const fetched=await fetchTpexDisposalWithOfficialBackup();
    const rows=parseTpexDisposalRows(fetched.json);
    if(!rows.length)throw new Error('TPEx 處置解析為 0 筆，保留上一份成功快照');
    await replaceDisposalMarket('上櫃',rows);
    await markSuccess(TPEX_DISPOSAL_SOURCE,rows.length);
    return { httpStatus:200, body:{ok:true,source:TPEX_DISPOSAL_SOURCE,market:'上櫃',rows:rows.length,upstream:fetched.source} };
  }catch(e){
    try{await markError(TPEX_DISPOSAL_SOURCE,e)}catch{}
    return { httpStatus:502, body:{ok:false,source:TPEX_DISPOSAL_SOURCE,preservedLastGood:true,error:String(e?.message||e)} };
  }
}

module.exports = {
  runPriceSync, runTwseDisposalSync, runTpexDisposalSync,
  _test: {
    twseOpenApiRows, twseRwdRows, tpexPriceRows, dateFromTwseRwd, pctChange, assertMarketHistoryCoverage,
    parseTwseDisposalRows, parseTpexDisposalRows, normalizeTpexLegacy
  }
};
