'use strict';
// StockZone 2.6.8.13: isolated TWSE end-of-day index + cross-market turnover.
// Does not invoke or modify W3 / X20. Scheduling and holiday gating happen BEFORE official requests.
const { getSql } = require('./db');

const TZ='Asia/Taipei';
const STATIC_2026_HOLIDAYS=new Set([
  '2026-01-01','2026-02-12','2026-02-13','2026-02-16','2026-02-17',
  '2026-02-18','2026-02-19','2026-02-20','2026-02-27','2026-04-03',
  '2026-04-06','2026-05-01','2026-06-19','2026-09-25','2026-09-28',
  '2026-10-09','2026-10-26','2026-12-25'
]);
// New years: official annual holiday calendar is obtained and saved once per year in Neon.
// When unavailable, fail CLOSED: no EOD polling on an unverified date.
const money = v => {if(v===null||v===undefined||v==='')return null;const n=Number(String(v).replace(/[,\s]/g,''));return Number.isFinite(n)?n:null};
const exactDate = d => typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)?d:'';
const isoDate = d => d instanceof Date?d.toISOString().slice(0,10):exactDate(String(d||'').slice(0,10));
const roc = str => {
  const s=String(str||'').trim();let m=s.match(/^(\d{2,3})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if(m)return `${String(Number(m[1])+1911)}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
  m=s.match(/^(\d{3})(\d{2})(\d{2})$/);if(m)return `${Number(m[1])+1911}-${m[2]}-${m[3]}`;
  // Some official OpenAPI feeds use Gregorian YYYYMMDD rather than ROC YYYMMDD.
  m=s.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if(m)return `${m[1]}-${m[2]}-${m[3]}`;
  return exactDate(s);
};
const tpeClock = (now=new Date())=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,year:Number(parts.year),weekday:parts.weekday,minutes:Number(parts.hour)*60+Number(parts.minute)};
};
const isWeekend = c=>c.weekday==='Sat'||c.weekday==='Sun';
const slotFor = c=>{
  if(c.minutes<14*60||c.minutes>=18*60)return null;
  const stage=c.minutes>=17*60+50?2:c.minutes>=15*60+40?1:0;
  const tenMinuteBucket=Math.floor((c.minutes-14*60)/10);
  return {stage, bucket:`${c.date}:${tenMinuteBucket}`, slot:tenMinuteBucket};
};
let schemaPromise;
async function ensureSchema(sql){
  if(!schemaPromise){schemaPromise=(async()=>{
    await sql.query(`CREATE TABLE IF NOT EXISTS market_index_eod_daily(
      trade_date date PRIMARY KEY,
      taiex_close numeric(14,2), change_pct numeric(10,4),
      listed_value numeric(24,0), cross_value numeric(24,0),
      poll_bucket text, poll_stage smallint, checked_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await sql.query(`CREATE TABLE IF NOT EXISTS market_index_official_calendar(
      cal_year integer PRIMARY KEY, holiday_dates jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now())`);
  })().catch(err=>{schemaPromise=null;throw err})}
  await schemaPromise;
}
function holidayFromAnnualRecord(row){
  const name=String(row?.Name||row?.name||'');
  if(/開始交易|最後交易日/.test(name))return null;
  return roc(row?.Date||row?.date);
}
async function officialJSON(url, fetchFn=fetch){
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetchFn(url,{headers:{'User-Agent':'StockZone/2.6.8.13 official-end-of-day','Accept':'application/json'},cache:'no-store',signal:controller.signal});
    if(!res.ok)throw new Error(`官方資料 HTTP ${res.status}`);
    return await res.json();
  }finally{clearTimeout(timer)}
}
async function isTradingDay(c,sql,fetchFn){
  if(isWeekend(c))return false;
  if(c.year===2026)return !STATIC_2026_HOLIDAYS.has(c.date);
  const cached=await sql.query('SELECT holiday_dates FROM market_index_official_calendar WHERE cal_year=$1',[c.year]);
  let holidays=cached?.[0]?.holiday_dates;
  if(typeof holidays==='string'){try{holidays=JSON.parse(holidays)}catch{holidays=null}}
  if(!Array.isArray(holidays)){
    try{
      // TWSE OpenAPI supplies annual calendar records (ROC YYYYMMDD). One request per new year, not per day.
      const rows=await officialJSON('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',fetchFn);
      if(!Array.isArray(rows))return false;
      const all=rows.map(x=>roc(x?.Date)).filter(Boolean);
      if(!all.some(x=>x.startsWith(`${c.year}-`)))return false;
      holidays=rows.map(holidayFromAnnualRecord).filter(x=>x&&x.startsWith(`${c.year}-`));
      await sql.query(`INSERT INTO market_index_official_calendar(cal_year,holiday_dates)
        VALUES($1,$2::jsonb) ON CONFLICT(cal_year) DO UPDATE SET holiday_dates=EXCLUDED.holiday_dates, updated_at=now()`,[c.year,JSON.stringify(holidays)]);
    }catch(e){console.warn('尚無已核對的年度開休市曆，暫停盤後查詢',e?.message||e);return false}
  }
  return !holidays.includes(c.date);
}
function monthQuery(c,path){
  const date=c.date.replace(/-/g,'').slice(0,6)+'01';
  return path==='FMTQIK'
    ? `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${date}&response=json`
    : `https://www.twse.com.tw/exchangeReport/MI_INDEX4?date=${date}&response=json`;
}
function parseMonth(doc,market){
  // TWSE monthly report: {fields,data}; OpenAPI fallback: array of objects with same published keys.
  if(Array.isArray(doc)){
    const fields=['日期','成交金額(元)','寶島股價指數'];
    doc={fields,data:doc.map(row=>[
      row?.['日期']??row?.Date??row?.date,
      row?.['成交金額(元)']??row?.['成交金額']??row?.TradeValue??row?.tradeValue,
      row?.['寶島股價指數']??row?.Index
    ])};
  }
  const fields=Array.isArray(doc?.fields)?doc.fields.map(x=>String(x).trim()):[];
  const di=fields.findIndex(x=>x.includes('日期'));
  const ci=market==='listed'?fields.findIndex(x=>x.includes('發行量加權股價指數')):-1;
  const vi=fields.findIndex(x=>x.includes('成交金額'));
  const pi=market==='listed'?fields.findIndex(x=>x.includes('漲跌點數')):-1;
  if(di<0||vi<0||(market==='listed'&&ci<0))return null;
  const values=(Array.isArray(doc?.data)?doc.data:[]).map(row=>{
    const date=roc(row?.[di]),value=money(row?.[vi]);
    if(!date||value===null||value<0)return null;
    if(market!=='listed')return {date,crossValue:value};
    const close=money(row?.[ci]),delta=pi<0?null:money(row?.[pi]);
    if(close===null||close<=0)return null;
    const prev=delta===null?null:close-delta;
    return {date,taiexClose:close,listedValue:value,changePct:prev>0?Number((delta/prev*100).toFixed(4)):null};
  }).filter(Boolean);
  values.sort((a,b)=>b.date.localeCompare(a.date));
  return values[0]||null;
}

// TPEx official market aggregate, not inferred by subtracting two TWSE files.
// A missing/ambiguous market summary is UNKNOWN, never zero or a made-up total.
const TP_EX_URL='https://www.tpex.org.tw/openapi/v1/tpex_mainborad_highlight';
function parseTpexMarketTotal(doc){
  let rows=Array.isArray(doc)?doc:Array.isArray(doc?.data)?doc.data:Array.isArray(doc?.aaData)?doc.aaData:[];
  if(!rows.length)return null;
  const keys=['成交金額(元)','成交金額（元）','成交金額(千元)','成交金額(億元)','成交金額','成交值(元)','成交值(千元)','成交值(億元)','成交值','TradeValue','TradingValue','TransactionAmount','TotalTradeValue','TradingAmount'];
  // If the report contains several instrument classes, require an explicitly
  // recognizable OTC market total. Do not add per-stock values or ETFs arbitrarily.
  if(rows.length>1){rows=rows.filter(r=>{
    const label=String(r?.['類別']||r?.['項目']||r?.['分類']||r?.['交易市場']||r?.['Market']||r?.['Type']||'');
    return /上櫃(?:股票)?(?:總計|合計|市場)?|股票合計|股票總計|總計|合計/i.test(label)&&!/興櫃|創櫃|債券|權證|ETF|開放式|黃金/.test(label);
  });if(rows.length!==1)return null}
  const row=rows[0];if(!row||typeof row!=='object'||Array.isArray(row))return null;
  const date=roc(row.Date||row.date||row['日期']||row['資料日期']||row.TradeDate||row['交易日期']||'');
  if(!date)return null;
  for(const key of keys){
    if(!Object.prototype.hasOwnProperty.call(row,key))continue;
    const raw=money(row[key]);
    if(raw===null||raw<0)continue;
    const factor=/千元/.test(key)?1e3:/億元/.test(key)?1e8:1;
    const otcValue=raw*factor;
    if(otcValue>=1e8&&otcValue<=2e12)return {date,otcValue,source:'TPEx tpex_mainborad_highlight',field:key};
  }
  return null;
}

const safeVal = v=>v===null||v===undefined?null:Number(v);
function normalizeRow(r){
  if(!r)return null;
  const date=isoDate(r.trade_date);
  if(!date)return null;
  const listed=safeVal(r.listed_value),cross=safeVal(r.cross_value);
  const consistent=listed!==null&&cross!==null&&cross>=listed&&cross<=listed*3;
  const marker=String(r.poll_bucket||'').match(/\|tpex=(\d{8,14})$/);
  const direct=Boolean(marker);
  // New rows read the actual TPEx official amount saved with the source marker.
  // Older TWSE MI_INDEX4 rows retain their old mathematical inference untouched.
  const otc=direct&&consistent?Number(marker[1]):consistent?cross-listed:null;
  return {ok:true,date,taiexClose:safeVal(r.taiex_close),changePct:safeVal(r.change_pct),
    listedValue:listed,otcValue:otc,totalValue:consistent?cross:null,
    turnoverComplete:consistent,turnoverSource:consistent?(direct?'TWSE FMTQIK + TPEx official':'TWSE FMTQIK + MI_INDEX4'):'TWSE FMTQIK (listed only)',
    dataType:'official_daily_close'};
}
async function latestStored(sql,throughDate){
  const rows=await sql.query(`SELECT trade_date::text AS trade_date, taiex_close,change_pct,listed_value,cross_value,poll_stage,poll_bucket
    FROM market_index_eod_daily WHERE trade_date<=$1::date
    ORDER BY (taiex_close IS NOT NULL) DESC,trade_date DESC LIMIT 1`,[throughDate]);
  return rows?.[0]||null;
}
async function rowForDate(sql,date){const arr=await sql.query(`SELECT trade_date::text AS trade_date, taiex_close,change_pct,listed_value,cross_value,poll_stage,poll_bucket
  FROM market_index_eod_daily WHERE trade_date=$1::date`,[date]);return arr?.[0]||null}
async function fetchAndStore(sql,c,fetchFn){
  const [listedDoc,otcDoc]=await Promise.allSettled([
    officialJSON(monthQuery(c,'FMTQIK'),fetchFn),
    officialJSON(TP_EX_URL,fetchFn)
  ]);
  const listed=listedDoc.status==='fulfilled'?parseMonth(listedDoc.value,'listed'):null;
  const tpex=otcDoc.status==='fulfilled'?parseTpexMarketTotal(otcDoc.value):null;
  if(listed&&listed.date<=c.date){
    await sql.query(`INSERT INTO market_index_eod_daily(trade_date,taiex_close,change_pct,listed_value)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(trade_date) DO UPDATE SET taiex_close=EXCLUDED.taiex_close,change_pct=EXCLUDED.change_pct,
       listed_value=EXCLUDED.listed_value,updated_at=now()`,
      [listed.date,listed.taiexClose,listed.changePct,listed.listedValue]);
  }
  // Only merge TWO SAME-DAY official figures. This column remains the already
  // existing cross-market total, with an explicit source marker; no DB migration.
  if(tpex&&listed&&tpex.date===listed.date&&tpex.date===c.date){
    const total=listed.listedValue+tpex.otcValue;
    if(total>=listed.listedValue&&total<=listed.listedValue*3)
      await sql.query(`UPDATE market_index_eod_daily
        SET cross_value=$2,poll_bucket=split_part(COALESCE(poll_bucket,''),'|tpex=',1)||'|tpex='||$3::text,updated_at=now()
        WHERE trade_date=$1::date`,[c.date,Math.round(total),Math.round(tpex.otcValue)]);
  }
  if(listedDoc.status==='rejected')console.warn('TWSE listed EOD unavailable',listedDoc.reason?.message||listedDoc.reason);
  if(otcDoc.status==='rejected')console.warn('TPEx direct OTC EOD unavailable',otcDoc.reason?.message||otcDoc.reason);
  else if(!tpex)console.warn('TPEx direct OTC summary not parseable; preserve last valid, no TWSE subtraction');
}
function eligibleForStage(dayRow,slot){
  const complete=Boolean(dayRow&&dayRow.taiex_close!==null&&dayRow.listed_value!==null&&dayRow.cross_value!==null&&
    Number(dayRow.cross_value)>=Number(dayRow.listed_value));
  if(!complete)return true;
  return Number(dayRow.poll_stage??-1)<slot.stage;
}
async function claimPoll(sql,c,slot){
  // Durable atomic bucket claim: even concurrent Vercel instances poll official sources once per 10-minute window.
  const results=await sql.query(`INSERT INTO market_index_eod_daily(trade_date,poll_bucket,poll_stage,checked_at)
    VALUES($1,$2,$3,now())
    ON CONFLICT(trade_date) DO UPDATE SET
      poll_bucket=EXCLUDED.poll_bucket || CASE
        WHEN market_index_eod_daily.poll_bucket LIKE '%|tpex=%'
        THEN '|tpex='||split_part(market_index_eod_daily.poll_bucket,'|tpex=',2)
        ELSE '' END,
      poll_stage=EXCLUDED.poll_stage,checked_at=now()
      WHERE split_part(COALESCE(market_index_eod_daily.poll_bucket,''),'|tpex=',1)
        IS DISTINCT FROM EXCLUDED.poll_bucket
    RETURNING trade_date`,[c.date,slot.bucket,slot.stage]);
  return (results?.length||0)>0;
}
let inProcessCache=null;
async function getMarketIndexQuote({now=new Date(),sql=getSql(),fetchFn=fetch}={}){
  const c=tpeClock(now),activeSlot=slotFor(c);
  await ensureSchema(sql);
  // A single on-demand recovery fetch is allowed after 18:00 if the day's data was missed.
  // This is NOT a repeating schedule; the durable DB bucket prevents repeat fetches.
  const mayCatchUp=c.minutes>=18*60&&c.minutes<24*60;
  const trading=(activeSlot||mayCatchUp)?await isTradingDay(c,sql,fetchFn):false;
  let today=trading?await rowForDate(sql,c.date):null;
  const missingToday=!today||today.taiex_close===null||today.listed_value===null||today.cross_value===null;
  const dueSlot=activeSlot||(mayCatchUp&&trading&&missingToday?{stage:3,bucket:`${c.date}:catchup`}:null);
  if(dueSlot&&trading&&eligibleForStage(today,dueSlot)&&await claimPoll(sql,c,dueSlot)){
    await fetchAndStore(sql,c,fetchFn);
    today=await rowForDate(sql,c.date);
  }
  const latest=await latestStored(sql,c.date);
  const normalized=normalizeRow(latest)||inProcessCache;
  if(normalized&&normalized.date<=c.date){inProcessCache=normalized;return {...normalized,pollActive:Boolean(activeSlot&&trading)}};
  return {ok:false,date:'',error:'官方盤後資料尚未取得',pollActive:Boolean(activeSlot&&trading)};
}
module.exports={getMarketIndexQuote, tpeClock,slotFor,parseMonth,parseTpexMarketTotal,isTradingDay,normalizeRow,eligibleForStage,STATIC_2026_HOLIDAYS};
