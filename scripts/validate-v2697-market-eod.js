/* Historical TWSE/TPEx date-gate test, adjusted for the v2.6.9.17 schedule. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),{marketDateGate}=require('../lib/market-dynamic-date-gate');
const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
for(const [route,time] of [['/api/sync-status','0 7 * * 1-5'],
 ['/api/sync-status','0 8 * * 1-5'],['/api/sync-status','0 9 * * 1-5'],
 ['/api/market-dynamic-refresh','0 14 * * 1-5'],
 ['/api/market-dynamic-refresh','35 15 * * 1-5']])
 assert(v.crons.some(x=>x.path===route&&x.schedule===time),`missing ${route} ${time}`);
assert.equal(v.crons.length,new Set(v.crons.map(x=>x.path+'|'+x.schedule)).size);
const good=[{market:'上市',trade_date:'2026-10-28',rows:1094},{market:'上櫃',trade_date:'2026-10-28',rows:868}];
assert.equal(marketDateGate(good).ok,true);
assert.equal(marketDateGate([good[0],{...good[1],trade_date:'2026-10-27'}]).reason,'market-dates-misaligned');
assert.equal(marketDateGate([good[0],{...good[1],rows:30}]).reason,'market-stock-coverage-low');
assert.equal(marketDateGate([good[0]]).reason,'market-history-missing');
let fixture=good,snapshotRuns=0,storedW3=false;
const stubs={
 '../lib/db.js':{getSql:()=>({query:async(q)=>q.includes('market_dynamic_snapshot')
  ? (storedW3?[{d:'2026-10-28',price_date:'2026-10-28',valid:'true'}]:[]):fixture})},
 '../lib/market-dynamic.js':{refreshMarketSnapshot:async()=>{snapshotRuns++;storedW3=true;
  return{latest:{date:'2026-10-28'},w3:{sourceDate:'2026-10-28',isLiveModel:true}}}},
 '../lib/sync-common.js':{isCronAuthorized:()=>true,taipeiDateParts:()=>({date:'2026-10-28'})},
 '../lib/market-daily-schedule.js':{marketScheduleGate:async()=>({state:'pending',
  gate:marketDateGate(fixture)})}
};
const backups=[];for(const [rel,exports] of Object.entries(stubs)){
 const file=path.resolve(root,'api',rel);backups.push([file,require.cache[file]]);
 require.cache[file]={id:file,filename:file,loaded:true,exports};
}
const handler=require('../api/market-dynamic-refresh.js');
async function call(schedule){const out={status:0,body:null};const res={setHeader(){},
 status(x){out.status=x;return this},json(x){out.body=x;return this}};
 await handler({method:'GET',query:{},headers:{'x-vercel-cron-schedule':schedule,
 'user-agent':'vercel-cron/1.0'}},res);return out}
(async()=>{
 fixture=good.map(x=>({...x,trade_date:'2026-10-27'}));
 let r=await call('0 14 * * 1-5');assert.equal(r.status,200);
 assert.equal(r.body.reason,'today-close-unavailable');assert.equal(snapshotRuns,0);
 fixture=good;
 r=await call('0 14 * * 1-5');assert.equal(r.status,200);
 assert.equal(r.body.w3Valid,true);assert.equal(snapshotRuns,1);
 r=await call('35 15 * * 1-5');assert.equal(r.status,200);
 assert.equal(r.body.reason,'w3-already-verified-at-2200');assert.equal(snapshotRuns,1);
 r=await call('20 11 * * 1-5');assert.equal(r.status,401);
 for(const [f,c] of backups){if(c)require.cache[f]=c;else delete require.cache[f]}
 console.log('PASS EOD cron gate — 22:00 verified, 23:35 no-op when verified, old cron unauthorized');
})().catch(e=>{console.error(e);process.exitCode=1});
