'use strict';
/** Stage3 read-only Neon -> private immutable Blob orchestrator.
 * NO LIVE ORDERS, NO Neon writes, NO backfilling unseen recommendations.
 */
const crypto = require('node:crypto');
const {getSql,getDatabaseUrl} = require('./db');
const {createBlobJournal} = require('./stockzone-d-paper-store');
const {freezeToday,settleNext} = require('./stockzone-d-paper-runner');

const CRON_SCHEDULE='15 22 * * 1-5'; // UTC weekdays 22:15 == Taipei Tue-Sat 06:15
const CRON_PATH='/api/market-dynamic-refresh?paper=stage3';
const LATEST_PRICE_QUERY=`SELECT MAX(trade_date)::text AS latest_trade_date
 FROM market_daily_history WHERE market IN ('上市','上櫃')`;
const PREV_PRICE_QUERY=`SELECT MAX(trade_date)::text AS prev_trade_date
 FROM market_daily_history WHERE trade_date < $1::date AND market IN ('上市','上櫃')`;
const CHECK_PRICE_QUERY=`SELECT COUNT(*)::int AS n FROM market_daily_history
 WHERE trade_date=$1::date AND market IN ('上市','上櫃')
 AND stock_code ~ '^[1-9][0-9]{3}$' AND close_price>0`;
const fail=m=>{throw new Error('PAPER_STAGE3_LOCKED: '+m);};
const asDay=v=> v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const secEqual=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string')return false;
 const aa=Buffer.from(a,'utf8'),bb=Buffer.from(b,'utf8');
 return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
};
function strictCronAccess(req, env=process.env){
 const secret=env.CRON_SECRET;
 if(typeof secret!=='string'||secret.length<32) return false;
 return req?.method==='GET' &&
  String(req?.headers?.['x-vercel-cron-schedule']||'')===CRON_SCHEDULE &&
  String(req?.headers?.['user-agent']||'')==='vercel-cron/1.0' &&
  secEqual(req?.headers?.authorization,`Bearer ${secret}`);
}
function enabled(env=process.env){
 return env.STOCKZONE_D_PAPER_ENABLED==='1' &&
  typeof env.CRON_SECRET==='string' && env.CRON_SECRET.length>=32 &&
  typeof env.BLOB_READ_WRITE_TOKEN==='string' && env.BLOB_READ_WRITE_TOKEN.length>0;
}
function getTaipeiClock(date){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(date).map(p=>[p.type,p.value]));
 return {today:`${parts.year}-${parts.month}-${parts.day}`,hour:+parts.hour,minute:+parts.minute};
}
function officialNeon(){
 let host='';try{host=new URL(getDatabaseUrl()).hostname}catch{}
 if(!host.endsWith('.neon.tech'))fail('read-only official Neon connection required');
}
/**
 * Per cron tick:
 *  1. Verify new official session E is present and settled (>=1500 priced stocks).
 *  2. Settle ONLY an actually frozen signal from immediately preceding session T.
 *  3. Freeze today's EOD signal for tomorrow (if formula inputs complete).
 * No missed days may be spliced into a paper trading chain. No W3 formula changes.
 */
async function runDailyCycle({journal=createBlobJournal(),sql=null,now=()=>new Date(),
 freeze=freezeToday,settle=settleNext,neonCheck=officialNeon}={}){
 if(!sql)neonCheck();
 const instant=now();
 const clock=getTaipeiClock(instant);
 if(clock.hour>=8)fail('capture/settlement forbidden from Taipei 08:00 onward; no intraday replay');
 const db=sql||getSql();
 const latest=asDay((await db.query(LATEST_PRICE_QUERY))?.[0]?.latest_trade_date);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(latest))fail('no official stock session');
 if(latest>clock.today)fail('future-dated price records');
 const coverage=Number((await db.query(CHECK_PRICE_QUERY,[latest]))?.[0]?.n||0);
 if(coverage<1500)fail('latest price session still incomplete');
 const previous=asDay((await db.query(PREV_PRICE_QUERY,[latest]))?.[0]?.prev_trade_date);
 const signalDates=await journal.listSignalDates();
 const executionDates=await journal.listExecutionDates();
 const lastExecutionDate=executionDates.at(-1)||null;
 const sigLast=signalDates.at(-1)||null;
 if(lastExecutionDate&&lastExecutionDate>latest)fail('stored execution is later than official source');
 if(sigLast&&sigLast>latest)fail('stored signal newer than official source');
 if(lastExecutionDate&&sigLast&&lastExecutionDate>sigLast)fail('execution exceeds latest frozen recommendation');
 let settled=null;
 if(lastExecutionDate===latest){
  // Weekend/holiday repeated Cron. No more execution for this date.
  settled={status:'SESSION_ALREADY_RECORDED'};
 }else if(signalDates.includes(previous)){
  if(lastExecutionDate&&lastExecutionDate!==previous)fail('missing trading session in execution ledger; no backfill');
  if(lastExecutionDate===null&&signalDates.filter(x=>x<previous).length)fail('orphaned old signals; cannot bootstrap mid-chain');
  settled=await settle({signalDate:previous,journal,sql:db,now});
  if(!['RECORDED','ALREADY_FROZEN'].includes(settled.status))fail('preceding signal not settled');
  if(settled.executionDate!==latest)fail('settlement date not equal to latest completed session');
 }else if(lastExecutionDate||signalDates.length){
  fail('missing previous-session frozen signal; no retroactive recommendations or chain repair');
 }else settled={status:'FIRST_SESSION_BOOTSTRAP_NO_PRIOR_TRADE'};
 // A signal may only be created promptly. Prevent weekend/holiday or a broken
 // refresh pipeline from creating fake past picks at the next session's open.
 const elapsed=Date.parse(instant)-Date.parse(latest+'T07:00:00Z'); // T at Taipei 15:00
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>48*3600*1000){
  return {ok:true,status:'SOURCE_STALE_NO_NEW_SIGNAL',asOfDate:latest,
   settled: settled.status,signalCreated:false,executionDate:settled.executionDate||null,
   neonWrites:0,realOrders:0};
 }
 const frozen=await freeze({journal,now});
 if(frozen.signalDate!==latest)fail('D original W3/V4 preview source date != latest price session');
 return {ok:true,status:'CYCLE_VERIFIED',asOfDate:latest,
  settled:settled.status,executionDate:settled.executionDate||null,
  signalCreated:frozen.created,signalDate:frozen.signalDate,
  dCount:frozen.dCount,v4Count:frozen.v4Count,neonWrites:0,realOrders:0};
}
module.exports={CRON_SCHEDULE,CRON_PATH,LATEST_PRICE_QUERY,PREV_PRICE_QUERY,
 CHECK_PRICE_QUERY,strictCronAccess,enabled,getTaipeiClock,runDailyCycle};
