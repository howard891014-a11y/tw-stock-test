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
const safeVal = v=>v===null||v===undefined?null:Number(v);
function normalizeRow(r){
  if(!r)return null;
  const date=isoDate(r.trade_date);
  if(!date)return null;
  const listed=safeVal(r.listed_value),cross=safeVal(r.cross_value);
  const consistent=listed!==null&&cross!==null&&cross>=listed&&cross<=listed*3;
  const otc=consistent?cross-listed:null;
  return {ok:true,date,taiexClose:safeVal(r.taiex_close),changePct:safeVal(r.change_pct),
    listedValue:listed,otcValue:otc,totalValue:consistent?cross:null,
    turnoverComplete:consistent,turnoverSource:consistent?'TWSE FMTQIK + MI_INDEX4':'TWSE FMTQIK (listed only)',
    dataType:'official_daily_close'};
}
async function latestStored(sql,throughDate){
  const rows=await sql.query(`SELECT trade_date::text AS trade_date, taiex_close,change_pct,listed_value,cross_value,poll_stage
    FROM market_index_eod_daily WHERE trade_date<=$1::date
    ORDER BY (taiex_close IS NOT NULL) DESC,trade_date DESC LIMIT 1`,[throughDate]);
  return rows?.[0]||null;
}
async function rowForDate(sql,date){const arr=await sql.query(`SELECT trade_date::text AS trade_date, taiex_close,change_pct,listed_value,cross_value,poll_stage
  FROM market_index_eod_daily WHERE trade_date=$1::date`,[date]);return arr?.[0]||null}
async function fetchAndStore(sql,c,fetchFn){
  const [list,all]=await Promise.allSettled([
    officialJSON(monthQuery(c,'FMTQIK'),fetchFn),
    (async()=>{
      const month=c.date.replace(/-/g,'').slice(0,6)+'01';
      const sources=[
        monthQuery(c,'MI_INDEX4'),
        `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX4?date=${month}&response=json`,
        'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX4'
      ];
      let err=null;
      for(const url of sources){
        try{
          const report=await officialJSON(url,fetchFn);
          if(parseMonth(report,'cross'))return report;
        }catch(e){err=e}
      }
      throw err||new Error('TWSE 跨市場資料尚未公布');
    })()
  ]);
  const listed=list.status==='fulfilled'?parseMonth(list.value,'listed'):null;
  const cross=all.status==='fulfilled'?parseMonth(all.value,'cross'):null;
  for(const r of [listed,cross]){
    if(!r||r.date>c.date)continue;
    if('taiexClose' in r){
      await sql.query(`INSERT INTO market_index_eod_daily(trade_date,taiex_close,change_pct,listed_value)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(trade_date) DO UPDATE SET taiex_close=EXCLUDED.taiex_close,change_pct=EXCLUDED.change_pct,
          listed_value=EXCLUDED.listed_value,updated_at=now()`,[r.date,r.taiexClose,r.changePct,r.listedValue]);
    }else{
      await sql.query(`INSERT INTO market_index_eod_daily(trade_date,cross_value) VALUES($1,$2)
        ON CONFLICT(trade_date) DO UPDATE SET cross_value=EXCLUDED.cross_value,updated_at=now()`,[r.date,r.crossValue]);
    }
  }
  if(list.status==='rejected')console.warn('TWSE FMTQIK 盤後資料暫不可用',list.reason?.message||list.reason);
  if(all.status==='rejected')console.warn('TWSE MI_INDEX4 跨市場資料暫不可用',all.reason?.message||all.reason);
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
    ON CONFLICT(trade_date) DO UPDATE SET poll_bucket=EXCLUDED.poll_bucket,poll_stage=EXCLUDED.poll_stage,
      checked_at=now() WHERE market_index_eod_daily.poll_bucket IS DISTINCT FROM EXCLUDED.poll_bucket
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
module.exports={getMarketIndexQuote, tpeClock,slotFor,parseMonth,isTradingDay,normalizeRow,eligibleForStage,STATIC_2026_HOLIDAYS};
