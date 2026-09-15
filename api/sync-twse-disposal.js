const {
  clean, rocToIso, parsePeriod, fetchJson, normalizeTableJson, rowObject, first,
  isCronAuthorized, markAttempt, markSuccess, markError, replaceDisposalMarket
} = require('../lib/sync-common');

const SOURCE = 'twse_disposal';
const MARKET = '上市';
const URL = 'https://www.twse.com.tw/rwd/zh/announcement/punish?response=json';

function parseRows(json) {
  const table = normalizeTableJson(json);
  if (!table.data.length && !Array.isArray(json?.data) && !Array.isArray(json?.tables)) {
    throw new Error('TWSE 處置資料格式無法辨識');
  }
  const out = [];
  for (const rawRow of table.data) {
    const x = rowObject(table.fields, rawRow);
    const code = clean(first(x, ['證券代號','Code','SecuritiesCode']));
    if (!/^\d{4,6}$/.test(code)) continue;
    const periodRaw = first(x, ['處置起迄時間','處置起訖時間','DispositionPeriod']);
    const reason = clean(first(x, ['處置條件','處置原因','處置內容','DisposalCondition']));
    const p = parsePeriod(periodRaw, reason);
    if (!p.start || !p.end) continue;
    out.push({
      stock_code: code,
      stock_name: clean(first(x, ['證券名稱','Name','SecuritiesName'])),
      announcement_date: rocToIso(first(x, ['公布日期','公告日期','Date','AnnouncementDate'])) || null,
      start_date: p.start, end_date: p.end, reason,
      raw_data: x
    });
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (!isCronAuthorized(req)) return res.status(401).json({ok:false,error:'Unauthorized'});
  try {
    await markAttempt(SOURCE);
    const raw = await fetchJson(URL, { retries:1, timeoutMs:15000 });
    const rows = parseRows(raw);
    if(!rows.length) throw new Error('TWSE 處置解析為 0 筆，保留上一份成功快照');
    await replaceDisposalMarket(MARKET, rows);
    await markSuccess(SOURCE, rows.length);
    return res.status(200).json({ok:true,source:SOURCE,market:MARKET,rows:rows.length});
  } catch (e) {
    try { await markError(SOURCE,e); } catch {}
    return res.status(502).json({ok:false,source:SOURCE,preservedLastGood:true,error:String(e?.message||e)});
  }
};

module.exports._test = { parseRows };
