const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const HEADERS={'user-agent':UA,'accept':'application/json,text/plain,*/*'};
const FUND_TYPES=[
  'quarterlyDilutedEPS','quarterlyBasicEPS','quarterlyTotalRevenue','quarterlyOperatingRevenue',
  'quarterlyGrossProfit','quarterlyOperatingIncome','quarterlyTotalOperatingIncomeAsReported',
  'quarterlyNetIncome','quarterlyNetIncomeCommonStockholders'
];
const OFFICIAL_CACHE_MS=6*60*60*1000;
const officialEndpointCache=new Map();
const TWSE_BASE='https://openapi.twse.com.tw/v1';
const TPEX_BASE='https://www.tpex.org.tw/openapi/v1';
const OFFICIAL_MARKETS={
  listed:{label:'上市',base:TWSE_BASE,monthly:'/opendata/t187ap05_L',statement:[
    ['general','一般業','/opendata/t187ap06_L_ci'],['financial','金融業','/opendata/t187ap06_L_basi'],['securities','證券期貨業','/opendata/t187ap06_L_bd'],['holding','金控業','/opendata/t187ap06_L_fh'],['insurance','保險業','/opendata/t187ap06_L_ins'],['mixed','異業','/opendata/t187ap06_L_mim']
  ]},
  otc:{label:'上櫃',base:TPEX_BASE,monthly:'/mopsfin_t187ap05_O',statement:[
    ['general','一般業','/mopsfin_t187ap06_O_ci'],['financial','金融業','/mopsfin_t187ap06_O_basi'],['securities','證券期貨業','/mopsfin_t187ap06_O_bd'],['holding','金控業','/mopsfin_t187ap06_O_fh'],['insurance','保險業','/mopsfin_t187ap06_O_ins'],['mixed','異業','/mopsfin_t187ap06_O_mim']
  ]}
};
function num(x){if(x===null||x===undefined||x==='')return null;x=Number(x);return Number.isFinite(x)?x:null}
function round(x,d=2){return Number.isFinite(x)?Number(x.toFixed(d)):null}
function codeOf(v){return String(v||'').trim().toUpperCase().replace(/\.(?:TW|TWO)$/i,'')}
function marketSymbols(code,market){const m=String(market||'');if(m.includes('上櫃'))return [`${code}.TWO`,`${code}.TW`];if(m.includes('上市'))return [`${code}.TW`,`${code}.TWO`];return [`${code}.TW`,`${code}.TWO`]}
function rawReported(x){const v=x?.reportedValue?.raw??x?.raw??null;return num(v)}
function quarterLabel(date){const m=String(date||'').match(/^(\d{4})-(\d{2})/);if(!m)return String(date||'');return `${m[1]} Q${Math.ceil(Number(m[2])/3)}`}
function officialNum(v){if(v===null||v===undefined)return null;let s=String(v).trim();if(!s||s==='--'||s==='-'||s==='N/A')return null;const neg=/^\(.*\)$/.test(s);s=s.replace(/[,%％元千百萬億\s]/g,'').replace(/[()]/g,'');const n=Number(s);return Number.isFinite(n)?(neg?-n:n):null}
function officialText(row,patterns){if(!row||typeof row!=='object')return null;const keys=Object.keys(row);for(const p of patterns){const k=keys.find(x=>p.test(String(x)));if(k!==undefined){const v=row[k];if(v!==null&&v!==undefined&&String(v).trim()!=='')return String(v).trim()}}return null}
function officialValue(row,patterns){return officialNum(officialText(row,patterns))}
function officialCode(row){return String(officialText(row,[/^公司代號$/, /^公司代碼$/, /^證券代號$/, /^Code$/i])||'').trim()}
function rocYearToAd(v){const n=Number(String(v||'').replace(/\D/g,''));return Number.isFinite(n)&&n>0?(n<1911?n+1911:n):null}
function officialPeriod(row){const y=rocYearToAd(officialText(row,[/^年度$/, /^年$/, /資料年度/, /會計年度/]));let q=Number(String(officialText(row,[/^季別$/, /^季$/, /季別/])||'').replace(/\D/g,''));if(!(q>=1&&q<=4))q=null;return {year:y,quarter:q,label:y&&q?`${y} Q${q}`:y?String(y):null}}
async function fetchOfficialRows(url){
  const c=officialEndpointCache.get(url);if(c&&Date.now()-c.savedAt<OFFICIAL_CACHE_MS&&Array.isArray(c.data))return c.data;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),6500);
  try{const r=await fetch(url,{headers:{...HEADERS,accept:'application/json'},redirect:'follow',signal:ctl.signal});if(!r.ok)throw new Error(`官方 OpenAPI HTTP ${r.status}`);const j=await r.json();if(!Array.isArray(j))throw new Error('官方 OpenAPI 格式異常');officialEndpointCache.set(url,{savedAt:Date.now(),data:j});return j}finally{clearTimeout(timer)}
}
function findOfficialRow(rows,code){return Array.isArray(rows)?rows.find(x=>officialCode(x)===String(code)):null}
function parseMonthlyRevenue(row,marketLabel,endpoint){if(!row)return null;const period=officialText(row,[/^資料年月$/, /資料年月/, /年月/]);return {market:marketLabel,period,revenue:officialValue(row,[/^營業收入-當月營收$/, /當月營收$/]),lastMonthRevenue:officialValue(row,[/^營業收入-上月營收$/, /上月營收$/]),yearAgoRevenue:officialValue(row,[/^營業收入-去年當月營收$/, /去年當月營收$/]),momPct:officialValue(row,[/^營業收入-上月比較增減\(%\)$/, /上月比較增減/]),yoyPct:officialValue(row,[/^營業收入-去年同月增減\(%\)$/, /去年同月增減/]),cumulativeRevenue:officialValue(row,[/^累計營業收入-當月累計營收$/, /當月累計營收/]),priorCumulativeRevenue:officialValue(row,[/^累計營業收入-去年累計營收$/, /去年累計營收/]),cumulativeYoyPct:officialValue(row,[/^累計營業收入-前期比較增減\(%\)$/, /累計.*增減/]),source:'官方月營收',endpoint}}
function parseOfficialStatement(row,typeKey,typeLabel,marketLabel,endpoint){
  if(!row)return null;const p=officialPeriod(row),isGeneral=typeKey==='general';
  const revenue=officialValue(row,isGeneral?[/^營業收入$/, /營業收入合計/, /^收入合計$/, /^營收$/]:[/^營業收入$/, /淨收益/, /收益合計/, /利息淨收益/, /收入合計/, /^收入$/]);
  const grossProfit=officialValue(row,[/營業毛利/, /毛利（毛損）/, /毛利\(毛損\)/, /^毛利$/]);
  const operatingIncome=officialValue(row,[/^營業利益/, /營業利益（損失）/, /營業損益/, /營業淨利/]);
  const netIncome=officialValue(row,[/歸屬於母公司.*淨利/, /^本期淨利/, /本期淨利（淨損）/, /本期損益/, /稅後淨利/]);
  const eps=officialValue(row,[/基本每股盈餘/, /每股盈餘/]);
  const grossMargin=isGeneral&&Number.isFinite(revenue)&&revenue!==0&&Number.isFinite(grossProfit)?round(grossProfit/revenue*100):null;
  const operatingMargin=isGeneral&&Number.isFinite(revenue)&&revenue!==0&&Number.isFinite(operatingIncome)?round(operatingIncome/revenue*100):null;
  return {market:marketLabel,financialType:typeKey,financialTypeLabel:typeLabel,period:p.label,year:p.year,quarter:p.quarter,basis:'cumulative',revenue,grossProfit,operatingIncome,netIncome,eps,grossMargin,operatingMargin,marginApplicable:isGeneral,source:'官方綜合損益表',endpoint};
}
async function findOfficialStatement(code,def){
  const [general,...others]=def.statement,errors=[];
  try{const rows=await fetchOfficialRows(def.base+general[2]),row=findOfficialRow(rows,code);if(row)return parseOfficialStatement(row,general[0],general[1],def.label,def.base+general[2])}catch(e){errors.push(e?.message||String(e))}
  const found=await Promise.all(others.map(async x=>{try{const rows=await fetchOfficialRows(def.base+x[2]),row=findOfficialRow(rows,code);return row?parseOfficialStatement(row,x[0],x[1],def.label,def.base+x[2]):null}catch(e){errors.push(e?.message||String(e));return null}}));
  return found.find(Boolean)||{missing:true,errors:[...new Set(errors)].slice(0,3)};
}
async function fetchOfficialMarketFundamentals(code,key){const def=OFFICIAL_MARKETS[key],monthlyUrl=def.base+def.monthly;const [statementResult,monthlyResult]=await Promise.allSettled([findOfficialStatement(code,def),fetchOfficialRows(monthlyUrl).then(rows=>parseMonthlyRevenue(findOfficialRow(rows,code),def.label,monthlyUrl))]);const statement=statementResult.status==='fulfilled'&&!statementResult.value?.missing?statementResult.value:null;const monthly=monthlyResult.status==='fulfilled'?monthlyResult.value:null;return {market:def.label,statement,monthly,errors:[statementResult.status==='rejected'?statementResult.reason?.message:null,monthlyResult.status==='rejected'?monthlyResult.reason?.message:null].filter(Boolean)}}
async function fetchOfficialFundamentals(code,market){const m=String(market||''),order=m.includes('上櫃')?['otc','listed']:m.includes('上市')?['listed','otc']:['listed','otc'];let fallback=null;for(const key of order){const x=await fetchOfficialMarketFundamentals(code,key);if(x.statement||x.monthly)return x;if(!fallback)fallback=x}return fallback||{market:null,statement:null,monthly:null,errors:['官方資料未找到股票代號']}}
async function fetchFundamentalSeries(symbol,period1,period2){
  const qs=FUND_TYPES.map(x=>`type=${encodeURIComponent(x)}`).join('&');let last=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{const url=`https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&${qs}&period1=${period1}&period2=${period2}&padTimeSeries=true`;const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),5500);let r;try{r=await fetch(url,{headers:{...HEADERS,origin:'https://finance.yahoo.com',referer:`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/financials/`},redirect:'follow',signal:ctl.signal})}finally{clearTimeout(timer)}if(!r.ok)throw new Error(`Yahoo fundamentals HTTP ${r.status}`);const j=await r.json(),result=j?.timeseries?.result||[];if(!Array.isArray(result)||!result.length)throw new Error('Yahoo fundamentals 無資料');const map=new Map();for(const block of result){for(const key of FUND_TYPES){const arr=Array.isArray(block?.[key])?block[key]:[];for(const item of arr){const date=String(item?.asOfDate||item?.reportedDate||'').slice(0,10);if(!date)continue;if(!map.has(date))map.set(date,{date});const v=rawReported(item);if(v!==null)map.get(date)[key]=v}}}const rows=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>{const eps=num(x.quarterlyDilutedEPS)??num(x.quarterlyBasicEPS),revenue=num(x.quarterlyTotalRevenue)??num(x.quarterlyOperatingRevenue),grossProfit=num(x.quarterlyGrossProfit),operatingIncome=num(x.quarterlyOperatingIncome)??num(x.quarterlyTotalOperatingIncomeAsReported),netIncome=num(x.quarterlyNetIncome)??num(x.quarterlyNetIncomeCommonStockholders);return {period:quarterLabel(x.date),date:x.date,eps,revenue,grossProfit,operatingIncome,netIncome,grossMargin:revenue&&grossProfit!==null?round(grossProfit/revenue*100):null,operatingMargin:revenue&&operatingIncome!==null?round(operatingIncome/revenue*100):null}}).filter(x=>[x.eps,x.revenue,x.grossProfit,x.operatingIncome,x.netIncome].some(Number.isFinite));if(!rows.length)throw new Error('Yahoo fundamentals 無可用季度資料');return {symbol,rows}}catch(e){last=e}}
  throw last||new Error('Yahoo fundamentals 取得失敗');
}
export default async function handler(req,res){
  const code=codeOf(req.query?.q||req.query?.code||req.query?.symbol),market=String(req.query?.market||'');
  if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:'股票代碼格式錯誤'});
  try{
    const now=Math.floor(Date.now()/1000),period2=now+86400,period1=now-Math.round(3.5*365.25*86400);
    const officialPromise=fetchOfficialFundamentals(code,market).catch(e=>({market:null,statement:null,monthly:null,errors:[e?.message||String(e)]}));
    const yahooPromise=(async()=>{let data,last=null;for(const s of marketSymbols(code,market)){try{data=await fetchFundamentalSeries(s,period1,period2);break}catch(e){last=e}}return data?{data,error:null}:{data:null,error:last?.message||'Yahoo fundamentals 無資料'}})();
    const [official,yahoo]=await Promise.all([officialPromise,yahooPromise]);
    const quarters=yahoo.data?.rows?.slice(-12).reverse()||[];
    if(!official?.statement&&!official?.monthly&&!quarters.length)throw new Error([...(official?.errors||[]),yahoo.error].filter(Boolean).join('；')||'長期基本面資料取得失敗');
    const coverage={eps:quarters.filter(x=>Number.isFinite(x.eps)).length,revenue:quarters.filter(x=>Number.isFinite(x.revenue)).length,grossMargin:quarters.filter(x=>Number.isFinite(x.grossMargin)).length,operatingMargin:quarters.filter(x=>Number.isFinite(x.operatingMargin)).length,officialStatement:!!official?.statement,officialMonthlyRevenue:!!official?.monthly};
    const src=[];if(official?.statement)src.push(`${official.market}官方綜合損益表`);if(official?.monthly)src.push(`${official.market}官方月營收`);if(quarters.length)src.push('Yahoo歷史季度補充');
    res.setHeader('Cache-Control','public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ok:true,source:src.join(' + '),code,market:official?.market||market,symbol:yahoo.data?.symbol||null,updatedAt:new Date().toISOString(),officialStatement:official?.statement||null,monthlyRevenue:official?.monthly||null,quarters,coverage,sources:{official:!!(official?.statement||official?.monthly),yahooHistory:quarters.length>0,officialErrors:official?.errors||[],yahooError:yahoo.error||null}});
  }catch(e){return res.status(502).json({ok:false,error:e?.message||'長期基本面資料取得失敗'})}
}
