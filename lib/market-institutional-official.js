'use strict';
// StockZone v2.6.9.9: official CASH buy/sell net amounts for the market card only.
// Deliberately independent from stock-level T86 shares, industrial-flow estimates,
// W3-D.1.2 inputs and the existing market_dynamic_daily table.
const TWSE_SOURCE='TWSE BFI82U';
const TPEX_SOURCE='TPEx 3insti summary';
const MAX_DAYS=20;
const asAmount=v=>{
  if(v===null||v===undefined||v==='')return null;
  const n=Number(String(v).replace(/,/g,'').trim());
  return Number.isSafeInteger(n)?n:null;
};
const norm=s=>String(s??'').replace(/[\s　*（）()]/g,'');
const rocDateToIso=d=>{
  const s=String(d??'').trim(),m=s.match(/^(\d{3})(?:\/?|-?)(\d{2})(?:\/?|-?)(\d{2})$/);
  if(!m)return '';
  return `${Number(m[1])+1911}-${m[2]}-${m[3]}`;
};
const ymdToIso=d=>{const s=String(d??'');return /^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:''};
const netRow=(row,col=3)=>{
  if(!Array.isArray(row)||row.length<=col)return null;
  const n=asAmount(row[col]);
  if(n===null)return null;
  const buy=asAmount(row[1]),sell=asAmount(row[2]);
  if(buy!==null&&sell!==null&&buy-sell!==n)throw Error('Official report net mismatch');
  return n;
};
const equalTotal=(foreign,trust,dealer,total)=>total!==null&&foreign+trust+dealer===total;
function parseTwse(doc,date){
  if(doc?.stat!=='OK'||!Array.isArray(doc?.data)||ymdToIso(doc.date)!==date)return null;
  const rows=new Map(doc.data.map(row=>[norm(row?.[0]),row]));
  const f=rows.get('外資及陸資不含外資自營商'),tr=rows.get('投信'),
    own=rows.get('自營商自行買賣'),hedge=rows.get('自營商避險'),total=rows.get('合計');
  const foreign=netRow(f),trust=netRow(tr),self=netRow(own),hed=netRow(hedge),sum=netRow(total);
  if([foreign,trust,self,hed,sum].some(v=>v===null))return null;
  const dealer=self+hed;
  if(!equalTotal(foreign,trust,dealer,sum))throw Error('TWSE BFI82U summed components mismatch');
  return {date,market:'上市',foreign,trust,dealer,total:sum,source:TWSE_SOURCE};
}
function parseTpex(doc,date){
  const tbl=Array.isArray(doc?.tables)?doc.tables[0]:null;
  const d=tbl?.date?rocDateToIso(tbl.date):null;
  const list=Array.isArray(doc)?doc:(tbl?.data||[]);
  if(!Array.isArray(list)||!list.length)return null;
  if(d&&d!==date)return null;
  if(Array.isArray(doc)){ // Official OpenAPI exposes only its newest day.
    if(rocDateToIso(list[0].Date)!==date)return null;
  }
  const rowMap=new Map(list.map(r=>{
    if(Array.isArray(r))return [norm(r[0]),[r[0],r[1],r[2],r[3]]];
    return [norm(r.Investor),[r.Investor,r.PurchaseAmount,r.SaleAmount,r.Net]];
  }));
  const foreign=netRow(rowMap.get('外資及陸資合計'));
  const trust=netRow(rowMap.get('投信'));
  const dealer=netRow(rowMap.get('自營商合計'));
  const sum=netRow(rowMap.get('三大法人合計'));
  if([foreign,trust,dealer,sum].some(v=>v===null))return null;
  if(!equalTotal(foreign,trust,dealer,sum))throw Error('TPEx official summed components mismatch');
  return {date,market:'上櫃',foreign,trust,dealer,total:sum,source:TPEX_SOURCE};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function requestJson(url,{fetchFn=fetch}={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetchFn(url,{headers:{'user-agent':'StockZone/2.6.9.9 official institutional summary'},signal:controller.signal});
    if(!res.ok)throw Error(`HTTP ${res.status}`);
    return res.json();
  }finally{clearTimeout(timeout)}
}
async function fetchMarket(date,market,options={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid trade date');
  if(market==='上市'){
    const doc=await requestJson(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&dayDate=${date.replace(/-/g,'')}`,options);
    return parseTwse(doc,date);
  }
  if(market==='上櫃'){
    // Government Open Data 11743; historic dates through TPEx official daily-report interface.
    const doc=await requestJson(`https://www.tpex.org.tw/www/zh-tw/insti/summary?type=Daily&date=${encodeURIComponent(date.replace(/-/g,'/'))}&response=json`,options);
    return parseTpex(doc,date);
  }
  throw Error('Unknown market');
}
function combine(date,listed,otc){
  if(!listed||!otc||listed.date!==date||otc.date!==date)return null;
  const foreign=listed.foreign+otc.foreign,trust=listed.trust+otc.trust,dealer=listed.dealer+otc.dealer;
  return {date,foreign,trust,dealer,total:foreign+trust+dealer,listed,otc,source:'TWSE BFI82U + TPEx official summary',complete:true};
}
function fromPrevious(previous){
  const out=new Map();
  for(const row of previous?.history||[]){
    const x=row?.officialInstitutional;
    if(x?.complete&&x.date===row.date&&x.listed?.date===row.date&&x.otc?.date===row.date){
      if(x.total===x.foreign+x.trust+x.dealer)out.set(row.date,{listed:x.listed,otc:x.otc});
    }
  }
  return out;
}
async function enrichOfficialInstitutional(data,previous,{fetchFn=fetch,backfillMaxDays=MAX_DAYS,onMarketAttempt=null}={}){
  if(!data?.ok||!Array.isArray(data.history))return data;
  const dates=[...new Set(data.history.slice(0,MAX_DAYS).map(r=>r.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))];
  const old=fromPrevious(previous);
  let attempts=0,success=0;
  // On every refresh recheck the newest two trading days; rest are fetched once and carried
  // by the existing durable private Blob/Neon snapshots. Initial backfill capped at 20 days.
  const wanted=dates.filter((d,i)=>i<2||!old.has(d)).slice(0,backfillMaxDays);
  // Bound concurrency to avoid excessive traffic to official public endpoints.
  for(let i=0;i<wanted.length;i+=3){
    const chunk=wanted.slice(i,i+3);
    await Promise.all(chunk.map(async date=>{
      const stored=old.get(date)||{};
      const [listed,otc]=await Promise.all(['上市','上櫃'].map(async market=>{
        try{
          attempts++;const x=await fetchMarket(date,market,{fetchFn});
          if(x)success++;
          if(onMarketAttempt)onMarketAttempt({date,market,result:x,error:x?null:'OFFICIAL_NOT_READY'});
          return x;
        }catch(e){
          if(onMarketAttempt)onMarketAttempt({date,market,result:null,error:String(e?.message||e)});
          console.warn(`StockZone official ${market} ${date} unavailable`,String(e?.message||e));return null;
        }
      }));
      if(listed||otc)old.set(date,{listed:listed||stored.listed||null,otc:otc||stored.otc||null});
    }));
    if(i+3<wanted.length)await sleep(160);
  }
  data.history=data.history.map(row=>{
    const s=old.get(row.date)||{};
    return {...row,officialInstitutional:combine(row.date,s.listed,s.otc)};
  });
  data.latest=data.history[0]||data.latest;
  data.institutionalOfficial={...data.latest?.officialInstitutional||{},
    complete:!!data.latest?.officialInstitutional?.complete,
    date:data.latest?.date||null,
    source:'TWSE BFI82U + TPEx government open data 11743',
    availability:success,attempts};
  return data;
}
module.exports={parseTwse,parseTpex,fetchMarket,combine,enrichOfficialInstitutional,rocDateToIso};
