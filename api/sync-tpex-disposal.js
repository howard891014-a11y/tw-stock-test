const {
  clean, rocToIso, parsePeriod, fetchJson, normalizeTableJson, rowObject, first,
  isCronAuthorized, markAttempt, markSuccess, markError, replaceDisposalMarket
} = require('../lib/sync-common');

const SOURCE = 'tpex_disposal';
const MARKET = '上櫃';
const PRIMARY = 'https://www.tpex.org.tw/openapi/v1/tpex_disposal_information';
const BACKUP = 'https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information_result.php?l=zh-tw&o=json';

function parseRows(json) {
  const table = normalizeTableJson(json);
  const sourceRows = table.data;
  if (!Array.isArray(sourceRows)) throw new Error('TPEx 處置資料格式不是陣列');
  const out=[];
  for (const rawRow of sourceRows) {
    const x = rowObject(table.fields, rawRow);
    const code = clean(first(x,['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號','股票代號']));
    if (!/^\d{4,6}$/.test(code)) continue;
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


function normalizeLegacy(json) {
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

async function fetchWithOfficialBackup() {
  let primaryError='';
  try {
    const j=await fetchJson(PRIMARY,{retries:1,timeoutMs:15000});
    if (!Array.isArray(j)) throw new Error('TPEx OpenAPI 回傳格式不是陣列');
    if (!j.length) throw new Error('TPEx OpenAPI 回傳空陣列');
    return {json:j,source:PRIMARY};
  } catch(e) { primaryError=String(e?.message||e); }
  try {
    const j=await fetchJson(BACKUP,{retries:1,timeoutMs:18000});
    const normalized=normalizeLegacy(j);
    if (!normalized.length) throw new Error('TPEx 官方 JSON 備援無可解析處置資料');
    return {json:normalized,source:BACKUP};
  } catch(e) {
    throw new Error(`TPEx primary=${primaryError}; backup=${String(e?.message||e)}`);
  }
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!isCronAuthorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});
  try{
    await markAttempt(SOURCE);
    const fetched=await fetchWithOfficialBackup();
    const rows=parseRows(fetched.json);
    if(!rows.length)throw new Error('TPEx 處置解析為 0 筆，保留上一份成功快照');
    await replaceDisposalMarket(MARKET,rows);
    await markSuccess(SOURCE,rows.length);
    return res.status(200).json({ok:true,source:SOURCE,market:MARKET,rows:rows.length,upstream:fetched.source});
  }catch(e){
    try{await markError(SOURCE,e)}catch{}
    return res.status(502).json({ok:false,source:SOURCE,preservedLastGood:true,error:String(e?.message||e)});
  }
};

module.exports._test={parseRows,normalizeLegacy};
