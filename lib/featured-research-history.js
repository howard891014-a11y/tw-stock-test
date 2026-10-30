'use strict';
const {getSql}=require('./db');
const {getFeaturedDaily}=require('./featured-neon-daily');

const HORIZONS=Object.freeze([3,5,10,15,20]);
const STORE='public.market_featured_research_daily';
const READ=`SELECT trade_date::text AS trade_date,scene,scenario,model_version,source_quality,
 core,extended,performance,archived_at,evaluated_at FROM ${STORE} ORDER BY trade_date DESC LIMIT $1`;
const ACTIVE=`SELECT trade_date::text AS trade_date,scene,scenario,model_version,source_quality,
 core,extended,performance FROM ${STORE} WHERE trade_date >= $1::date ORDER BY trade_date ASC`;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const compact=r=>({stock_code:String(r.stock_code),stock_name:String(r.stock_name||r.stock_code),market:String(r.market),rank:Number(r.rank)||0,
 tag_id:r.tag_id||null,stockzoneTier:r.stockzoneTier||null});
const taiwanDay=date=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const numeric=v=>v===null||v===undefined?null:Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const pct=(a,b)=>Math.round((b/a-1)*10000)/100;
const validScene=s=>['OFF','WARNING','ON_BROAD','ON_NARROW'].includes(s);

function validateSignal(signal,day){
 if(!signal?.ok||signal.asOfDate!==day||!ISO.test(day)||!validScene(signal.scene)||
 !Array.isArray(signal.core)||!Array.isArray(signal.extended)||signal.core.length>5||signal.extended.length>5||
 (signal.scene==='OFF'&&(signal.core.length||signal.extended.length))||
 (signal.core.length<5&&signal.extended.length>0)|| signal.w3ModelVersion!=='W3-D.1.2')
  throw Error('日期／W3／5+5 訊號未通過封存條件');
 const seen=new Set();
 for(const r of [...signal.core,...signal.extended]){
   const key=String(r.market)+'|'+String(r.stock_code);
   if(!r.stock_code||!r.market||seen.has(key))throw Error('選股名單重複或缺欄位');
   seen.add(key);
 }
 if(signal.sourceQuality?.asOfDate!==day||signal.sourceQuality?.latestPriceDate!==day||signal.sourceQuality?.latestMarketDate!==day)
  throw Error('價量、W3與選股日期不同；不得封存為今日真實選股');
 return true;
}

function evaluateArchive(row,calendar,prices,w3){
 const core=Array.isArray(row.core)?row.core:[],extended=Array.isArray(row.extended)?row.extended:[];
 const day=String(row.trade_date),first=calendar.findIndex(s=>s.day===day),entry=first+1;
 const items=[];
 for(const [tier,stocks] of [['core',core],['extended',extended]])for(const stock of stocks){
   const code=String(stock.stock_code),byDay=prices.get(code)||new Map(),horizons={};
   for(const h of HORIZONS){
     const targetIdx=entry+h;
     if(first<0||entry>=calendar.length){horizons[h]={status:'pending'};continue;}
     let exitIdx=targetIdx,offExit=false,unverifiedW3=false;
     // A saved OFF decision on day D requires exiting at the NEXT trading session's close.
     // We use next-session closing prices for both stock and index (same observation time).
     for(let i=entry;i<Math.min(targetIdx,calendar.length);i++){
       const regime=w3.get(calendar[i].day);
       if(regime===undefined){unverifiedW3=true;break;}
       if(regime==='RiskOff'){
         if(i+1>=calendar.length){unverifiedW3=true;break;}
         exitIdx=i+1;offExit=true;break;
       }
     }
     if(unverifiedW3){horizons[h]={status:'pending_w3'};continue;}
     if(!offExit&&targetIdx>=calendar.length){horizons[h]={status:'pending'};continue;}
     const base=byDay.get(calendar[entry].day),target=byDay.get(calendar[exitIdx].day);
     const indexBase=calendar[entry].index,indexTarget=calendar[exitIdx].index;
     if(!numeric(base)||!numeric(target)||!numeric(indexBase)||!numeric(indexTarget)){
       horizons[h]={status:'missing_price',entryDate:calendar[entry].day,exitDate:calendar[exitIdx].day};continue;
     }
     const stockReturn=pct(base,target),marketReturn=pct(indexBase,indexTarget);
     horizons[h]={status:'complete',entryDate:calendar[entry].day,exitDate:calendar[exitIdx].day,
       returnPct:stockReturn,marketPct:marketReturn,doubleSuccess:stockReturn>0&&stockReturn>marketReturn,offExit};
   }
   items.push({tier,stock_code:code,market:String(stock.market),rank:Number(stock.rank)||0,horizons});
 }
 return {method:'T+1 收盤進場；持有 H 交易日後收盤比較（股票／大盤同時點）；遇 OFF 於下個交易日收盤離場。非成交價格承諾，未扣費稅。',
   w3ModelVersion:'W3-D.1.2',items};
}

function summarize(rows,horizon){
 const result={all:{success:0,eligible:0},core:{success:0,eligible:0},extended:{success:0,eligible:0}};
 for(const row of rows){
   const items=row.performance?.items||[];
   for(const item of items){
     const h=item.horizons?.[horizon];if(h?.status!=='complete')continue;
     for(const k of ['all',item.tier]){
       if(!result[k])continue;
       result[k].eligible++;
       if(h.doubleSuccess)result[k].success++;
     }
   }
 }
 return result;
}

async function getHistory({sql,limit=120}={}){
 const db=sql||getSql();
 const rows=await db.query(READ,[Math.min(180,Math.max(1,Number(limit)||120))]);
 const summaries=Object.fromEntries(HORIZONS.map(h=>[h,summarize(rows,String(h))]));
 const summariesByScene=Object.fromEntries(['ON_BROAD','ON_NARROW','WARNING','OFF'].map(scene=>[scene,
   Object.fromEntries(HORIZONS.map(h=>[h,summarize(rows.filter(row=>row.scene===scene),String(h))]))]));
 return {ok:true,source:'Neon saved-at-day historical 5+5 snapshots',version:'v2.7.0.33',horizons:HORIZONS,rows,summaries,summariesByScene,
 caveat:'非歷史重算；只收集部署後通過當日驗證的原始選股。現有 Neon 重建特徵與研究版不一致，追蹤績效不能宣稱復現原版回測。'};
}

async function archiveToday({sql,now=new Date(),getSignal=getFeaturedDaily}={}){
 const db=sql||getSql(),day=taiwanDay(now);
 const signal=await getSignal({sql:db,skipConnectionCheck:false});
 validateSignal(signal,day);
 const rows=await db.query(`INSERT INTO ${STORE}
 (trade_date,scene,scenario,model_version,source_quality,core,extended)
 VALUES($1::date,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
 ON CONFLICT(trade_date) DO NOTHING RETURNING trade_date::text AS trade_date`,[
 day,signal.scene,signal.scenario,signal.version,String(signal.sourceQuality?.status||''),
 JSON.stringify(signal.core.map(compact)),JSON.stringify(signal.extended.map(compact))]);
 return {day,created:rows.length===1,scene:signal.scene,counts:[signal.core.length,signal.extended.length]};
}

async function updatePerformance({sql,now=new Date()}={}){
 const db=sql||getSql(),today=taiwanDay(now);
 // Only inspect the 45-day active evaluation window. Mature metrics are retained in archived rows.
 const minDate=new Date(new Date(today+'T00:00:00Z').getTime()-55*86400000).toISOString().slice(0,10);
 const rows=await db.query(ACTIVE,[minDate]);if(!rows.length)return {updated:0,studied:0};
 const first=rows[0].trade_date;
 const days=await db.query(`SELECT trade_date::text AS day,taiex_close::float8 AS index
 FROM market_dynamic_daily WHERE trade_date >= $1::date AND trade_date <= $2::date AND taiex_close>0 ORDER BY trade_date`,[first,today]);
 const calendar=days.map(r=>({day:r.day,index:numeric(r.index)}));
 const codes=[...new Set(rows.flatMap(row=>[...row.core,...row.extended].map(r=>String(r.stock_code))))];
 const stockRows=codes.length?await db.query(`SELECT trade_date::text AS day,stock_code,close_price::float8 AS close
 FROM market_daily_history WHERE trade_date >= $1::date AND trade_date <= $2::date AND stock_code=ANY($3::text[])
 ORDER BY trade_date,stock_code`,[first,today,codes]):[];
 const stockPrices=new Map();for(const r of stockRows){if(!stockPrices.has(r.stock_code))stockPrices.set(r.stock_code,new Map());stockPrices.get(r.stock_code).set(r.day,numeric(r.close));}
 const states=await db.query(`SELECT trade_date::text AS day,regime FROM market_w3_run_daily
 WHERE trade_date >= $1::date AND trade_date <= $2::date AND model_version='W3-D.1.2'`,[first,today]);
 const w3=new Map(states.map(r=>[r.day,r.regime]));
 let updated=0;
 for(const row of rows){
   const performance=evaluateArchive(row,calendar,stockPrices,w3);
   const changed=JSON.stringify(performance)!==JSON.stringify(row.performance);
   if(!changed)continue;
   const out=await db.query(`UPDATE ${STORE} SET performance=$2::jsonb,evaluated_at=now()
     WHERE trade_date=$1::date AND performance IS DISTINCT FROM $2::jsonb RETURNING trade_date`,[row.trade_date,JSON.stringify(performance)]);
   updated+=out.length;
 }
 return {updated,studied:rows.length};
}

async function runDailyArchive({sql,now=new Date(),getSignal}={}){
 const db=sql||getSql();
 let archived=null,error=null;
 try{archived=await archiveToday({sql:db,now,getSignal});}
 catch(e){error=String(e?.message||e);}
 const performance=await updatePerformance({sql:db,now});
 return {ok:!error,archived,performance,error,asOfDate:taiwanDay(now)};
}
module.exports={HORIZONS,taiwanDay,validateSignal,evaluateArchive,summarize,getHistory,archiveToday,updatePerformance,runDailyArchive};
