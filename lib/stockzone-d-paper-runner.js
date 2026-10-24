'use strict';
/** Research orchestration only: public stock-data reader + private append-only Blob. */
const {getDPreview}=require('./stockzone-d-neon-readonly');
const {getSql}=require('./db');
const {makeSignal,executeNextOpen,verifySeal,taipeiDay}=require('./stockzone-d-paper');
const {createBlobJournal}=require('./stockzone-d-paper-store');
const {getDatabaseUrl}=require('./db');
const fail=m=>{throw Error('PAPER_LOCKED: '+m);};
const NEXT_DAY_QUERY=`SELECT MIN(trade_date)::text AS trade_date FROM market_daily_history
 WHERE trade_date>$1::date AND trade_date<=CURRENT_DATE`;
const COVERAGE_QUERY=`SELECT COUNT(*)::int AS n FROM market_daily_history
 WHERE trade_date=$1::date AND market IN('上市','上櫃') AND stock_code ~ '^[1-9][0-9]{3}$' AND close_price>0`;
const PRICES_QUERY=`SELECT market,stock_code,open_price::float8 AS open_price,
 close_price::float8 AS close_price,previous_close::float8 AS previous_close
 FROM market_daily_history WHERE trade_date=$1::date AND (market||'|'||stock_code)=ANY($2::text[])`;
function neonGuard(sqlProvided){
 if(sqlProvided)return; // test-only injectable client; normal path checks true Neon URL.
 let host='';try{host=new URL(getDatabaseUrl()).hostname}catch{}
 if(!host.endsWith('.neon.tech'))fail('official Neon required, no research database substituted');
}
/** Run once after T close. If already frozen, first saved timestamp/content wins. */
async function freezeToday({journal=createBlobJournal(),previewFetcher=getDPreview,now=()=>new Date()}={}){
 const p=await previewFetcher({withBaseline:true});
 const datetime=now().toISOString();
 const candidate=makeSignal(p,datetime);
 const saved=await journal.saveSignal(candidate);
 return {ok:true,created:saved.created,signalDate:saved.record.signalDate,
  capturedAt:saved.record.capturedAt,sha256:saved.record.sha256,
  mode:saved.record.mode,dCount:saved.record.d.positions.length,
  v4Count:saved.record.baseline.positions.length,storage:'PRIVATE_BLOB',neonWrites:0,
  executableOnlyBeforeNextOpen:true,transactionsExecuted:0};
}
/** Settle T signal strictly at the next actual Neon exchange trading session open,
 * after same day's official EOD has been saved. Reject missed session & lookahead. */
async function settleNext({signalDate,journal=createBlobJournal(),sql=null,now=()=>new Date(),officialIndexOpenFetcher=null}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(signalDate||'')))fail('explicit signalDate required');
 neonGuard(Boolean(sql));
 const db=sql||getSql();
 const signal=await journal.getSignal(signalDate);if(!signal)fail('missing immutable pre-open recommendation');
 verifySeal(signal);
 const following=(await db.query(NEXT_DAY_QUERY,[signalDate]))?.[0]?.trade_date;
 if(!following) return {ok:true,status:'WAITING_FOR_NEXT_OFFICIAL_SESSION',signalDate,transactionsExecuted:0};
 if(following<=signalDate)fail('invalid chronological exchange date');
 const existing=await journal.getExecution(following);
 if(existing){
  if(existing.signalSha256!==signal.sha256)fail('execution exists for different signal; no overwrite');
  return {ok:true,status:'ALREADY_FROZEN',signalDate,executionDate:following,
   sha256:existing.sha256,transactionsExecuted:0};
 }
 const lastDates=await journal.listExecutionDates();
 const previous=lastDates.length?await journal.getExecution(lastDates.at(-1)):null;
 if(previous&&previous.executionDate!==signalDate)fail('missed execution date; cannot roll positions across unrecorded sessions');
 if(previous&&previous.executionDate>=following)fail('journal dates out of order');
 const marketPriceCount=Number((await db.query(COVERAGE_QUERY,[following]))?.[0]?.n||0);
 const keys=new Set();
 for(const list of [signal.d.positions,signal.baseline.positions,
  previous?.state?.accounts?.D?.positions||[],previous?.state?.accounts?.V4?.positions||[]])
  for(const r of list)keys.add(`${r.market}|${r.stock_code}`);
 const prices=keys.size?await db.query(PRICES_QUERY,[following,[...keys]]):[];
 let marketBenchmark=null;
 if(officialIndexOpenFetcher){
  const b=await officialIndexOpenFetcher(following);
  if(!b||b.tradeDate!==following||b.index!=='TAIEX'||b.source!=='OFFICIAL_TWSE_OPEN'||!(Number(b.open)>0))
   fail('benchmark provider not verified official TAIEX opening');
  marketBenchmark=Number(b.open);
 }
 const record=executeNextOpen({signal,previous,sessionDate:following,observedAt:now().toISOString(),
  prices:prices.map(x=>({market:x.market,stock_code:x.stock_code,open_price:x.open_price===null?null:Number(x.open_price),
   close_price:x.close_price===null?null:Number(x.close_price),previous_close:x.previous_close===null?null:Number(x.previous_close)})),marketPriceCount,
  benchmarkOpen:marketBenchmark});
 const saved=await journal.saveExecution(record);
 if(saved.record.signalSha256!==signal.sha256)fail('concurrent record mismatch');
 return {ok:true,status:saved.created?'RECORDED':'ALREADY_FROZEN',signalDate,
  executionDate:following,sha256:saved.record.sha256,
  simulatedTradeEvents:saved.record.events.length,
  dEquity:saved.record.state.accounts.D.equityAtClose,
  v4Equity:saved.record.state.accounts.V4.equityAtClose,
  warnings:saved.record.problems,neonWrites:0,actualOrders:0};
}
module.exports={freezeToday,settleNext,NEXT_DAY_QUERY,COVERAGE_QUERY,PRICES_QUERY};
