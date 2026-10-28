'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
// Pure offline tests: avoid importing Neon network libraries; no actual DB/API writes.
const fakeDbPath=require.resolve('../lib/db');
require.cache[fakeDbPath]={id:fakeDbPath,filename:fakeDbPath,loaded:true,
 exports:{getSql:()=>{throw Error('DB not available in offline tests')}}};
const fakeCommonPath=require.resolve('../lib/sync-common');
require.cache[fakeCommonPath]={id:fakeCommonPath,filename:fakeCommonPath,loaded:true,
 exports:{taipeiDateParts:()=>({date:'2026-10-28',hour:15})}};
const schedule=require('../lib/market-daily-schedule');
const {marketDateGate}=require('../lib/market-dynamic-date-gate');
const {parseTpexMarketTotal,normalizeRow}=require('../lib/market-index-eod');
const ms=[...cfg.crons].map(x=>x.path+'|'+x.schedule);
assert.equal(ms.length,18);assert.equal(new Set(ms).size,18);
for(const [route,time] of [
 ['/api/sync-status','0 7 * * 1-5'],['/api/sync-status','0 8 * * 1-5'],
 ['/api/sync-status','0 9 * * 1-5'],['/api/sync-status','0 13 * * 1-5'],
 ['/api/sync-status','15 13 * * 1-5'],['/api/sync-status','30 13 * * 1-5'],
 ['/api/sync-status','45 13 * * 1-5'],
 ['/api/market-dynamic-refresh','0 14 * * 1-5'],
 ['/api/market-dynamic-refresh','35 15 * * 1-5'],
 ['/api/capital-flow','15 13 * * 1-5'],
 ['/api/capital-flow','30 13 * * 1-5'],
 ['/api/capital-flow','35 13 * * 1-5'],
 ['/api/capital-flow','50 13 * * 1-5'],
 ['/api/capital-flow','55 13 * * 1-5'],
 ['/api/capital-flow','20 14 * * 1-5'],
 ['/api/capital-flow','45 14 * * 1-5'],
 ['/api/fundflow?view=industry-changes&action=scan','30 9 * * 1-5'],
 ['/api/market-dynamic-refresh?paper=stage3','15 22 * * 1-5'],
])assert(ms.includes(route+'|'+time),`missing cron ${route} ${time}`);
const good=marketDateGate([{market:'上市',trade_date:'2026-10-28',rows:1050},
 {market:'上櫃',trade_date:'2026-10-28',rows:850}]);
const old=marketDateGate([{market:'上市',trade_date:'2026-10-27',rows:1050},
 {market:'上櫃',trade_date:'2026-10-27',rows:850}]);
const partial=marketDateGate([{market:'上市',trade_date:'2026-10-28',rows:1050},
 {market:'上櫃',trade_date:'2026-10-27',rows:850}]);
const empty={15:{date:'2026-10-28',state:'no-update'},16:{date:'2026-10-28',state:'no-update'},17:{date:'2026-10-28',state:'no-update'}};
assert.equal(schedule.deriveDayState(empty,old,'2026-10-28'),'closed','exact 3 no-update probes -> presumed closed');
assert.equal(schedule.deriveDayState({...empty,17:null},old,'2026-10-28'),'pending','missing third probe is not a holiday');
assert.equal(schedule.deriveDayState({...empty,16:{date:'2026-10-28',state:'error'}},old,'2026-10-28'),'pending','failed source is not a holiday');
assert.equal(schedule.deriveDayState(empty,partial,'2026-10-28'),'pending','partial market is not a holiday');
assert.equal(schedule.deriveDayState(empty,good,'2026-10-28'),'ready','today aligned data always wins');
let db=[];const sql={query:async(q,args)=>{
 if(q.includes('INSERT INTO sync_status')){db=db.filter(r=>r.source!==args[0]);db.push({source:args[0],error_message:args[2]});return []}
 if(q.includes('FROM sync_status'))return db;
 if(q.includes('FROM market_daily_history'))return [
  {market:'上市',trade_date:'2026-10-27',rows:1050},
  {market:'上櫃',trade_date:'2026-10-27',rows:850}];
 throw new Error('unexpected sql '+q.slice(0,40));
}};
(async()=>{
 function serviceMockSafe(){const x=fs.readFileSync(path.join(root,'lib/market-index-eod.js'),'utf8');return x.includes("THEN '|tpex='||split_part")&&x.includes("split_part(COALESCE(poll_bucket,''),'|tpex=',1)||'|tpex='");}
 for(const slot of ['15','16','17'])await schedule.savePriceAttempt(sql,slot,'2026-10-28','no-update');
 const result=await schedule.marketScheduleGate(sql,'2026-10-28');
 assert.equal(result.state,'closed');
 assert.equal(result.attempts['15'].state,'no-update');
 assert.equal(result.attempts['17'].state,'no-update');
 await schedule.savePriceAttempt(sql,'16','2026-10-28','error',{error:'official blocked'});
 assert.equal((await schedule.marketScheduleGate(sql,'2026-10-28')).state,'pending');
 // The next day must NOT reuse yesterday's three statuses.
 assert.equal((await schedule.marketScheduleGate(sql,'2026-10-29')).state,'pending');
 const otc=parseTpexMarketTotal([{Date:'1151028',TradeValue:'125,000,000,000'}]);
 assert.deepEqual({date:otc.date,value:otc.otcValue},{date:'2026-10-28',value:125000000000});
 assert.equal(parseTpexMarketTotal([{Date:'20261028',TradeValue:'125,000,000,000'}]).date,'2026-10-28');
 assert.equal(parseTpexMarketTotal([{Date:'1151028',TradeValue:'-'}]),null);
 assert.equal(parseTpexMarketTotal([{Date:'1151028',TradeValue:'125,000,000,000'},
 {Date:'1151028',TradeValue:'7,000,000,000'}]),null);
 const index=normalizeRow({trade_date:'2026-10-28',taiex_close:47000,
  listed_value:'730000000000',cross_value:'855000000000',poll_bucket:'2026-10-28:10|tpex=125000000000'});
 assert.equal(index.otcValue,125000000000);
 assert.equal(index.turnoverSource,'TWSE FMTQIK + TPEx official');
 const legacy=normalizeRow({trade_date:'2026-10-27',listed_value:'730000000000',cross_value:'855000000000',poll_bucket:'2026-10-27:10'});
 assert.equal(legacy.turnoverSource,'TWSE FMTQIK + MI_INDEX4');
 assert(serviceMockSafe(), 'market-index source marker must be retained across poll claims');
 // Price window is today's only; must not run 120D historical scanning.
 const service=fs.readFileSync(path.join(root,'lib/sync-service.js'),'utf8');
 assert(service.includes('expectedTradeDate'));
 assert(service.includes('official-today-not-published-or-already-stored'));
 assert(service.includes('refreshMarketActivityFactorsForDate(expectedTradeDate)'));
 const cronCode=fs.readFileSync(path.join(root,'api/sync-status.js'),'utf8');
 assert(cronCode.includes('warmCurrentEngineFromStoredDb'), 'daily 500D append must be retained');
 assert(fs.readFileSync(path.join(root,'lib/market-dynamic.js'),'utf8').includes("r.trade_date===latest"),'daily close must not rewrite 25 past trading days');
 assert(cronCode.includes('runStorageMaintenance'), '500D retention must remain enabled');
 const w3Code=fs.readFileSync(path.join(root,'api/market-dynamic-refresh.js'),'utf8');
 assert(w3Code.includes("if(schedule==='35 15 * * 1-5')"));
 assert(w3Code.includes('w3-already-verified-at-2200'));
 assert(w3Code.includes('three-price-probes-no-trading'));
 assert(w3Code.includes('chipRepair'));
 const settings=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const t of ['szMarketDailySchedule','15:00','16:00','17:00','21:00','22:00','23:35'])assert(settings.includes(t));
 console.log('PASS v2.6.9.17 unified EOD schedule, holiday three-probe gate, partial/error protection, official OTC source and settings (42 checks)');
})().catch(e=>{console.error(e);process.exitCode=1});
