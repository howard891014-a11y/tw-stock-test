/* v2.6.9.7 guarded market EOD scheduling regression tests. */
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {marketDateGate,readMarketDateGate}=require('../lib/market-dynamic-date-gate');
const root=path.resolve(__dirname,'..');
const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
for(const [route,schedule] of [
  ['/api/sync-status','20 10 * * 1-5'],
  ['/api/sync-status','50 10 * * 1-5'],
  ['/api/market-dynamic-refresh','20 11 * * 1-5'],
  ['/api/market-dynamic-refresh','40 12 * * 1-5'],
  ['/api/market-dynamic-refresh','50 14 * * 1-5'],
  ['/api/market-dynamic-refresh','35 15 * * 1-5']
])assert(v.crons.some(x=>x.path===route&&x.schedule===schedule),`missing ${route} ${schedule}`);
assert.equal(v.crons.length,new Set(v.crons.map(x=>x.path+'|'+x.schedule)).size);
const good=[{market:'上市',trade_date:'2026-10-27',rows:1094},{market:'上櫃',trade_date:'2026-10-27',rows:868}];
assert.equal(marketDateGate(good).ok,true);
assert.equal(marketDateGate([{...good[0]}, {...good[1],trade_date:'2026-10-22'}]).reason,'market-dates-misaligned');
assert.equal(marketDateGate([{...good[0]},{...good[1],rows:30}]).reason,'market-stock-coverage-low');
assert.equal(marketDateGate([good[0]]).reason,'market-history-missing');
(async()=>{
let dbReads=0,snapshotRuns=0,fixture=good;
const gate=await readMarketDateGate({query:async (q)=>{dbReads++;assert.match(q,/market_daily_history/);return fixture;}});
assert.equal(gate.ok,true);
const mocks={
  '../lib/db.js':{getSql:()=>({query:async()=>{dbReads++;return fixture;}})},
  '../lib/market-dynamic.js':{refreshMarketSnapshot:async()=>{snapshotRuns++;return{latest:{date:'2026-10-27'},w3:{sourceDate:'2026-10-27',isLiveModel:true}}}},
  '../lib/sync-common.js':{isCronAuthorized:()=>true}
};
const cacheBackups=[];
for(const [rel,exports] of Object.entries(mocks)){
 const file=path.resolve(root,'api',rel);
 cacheBackups.push([file,require.cache[file]]);
 require.cache[file]={id:file,filename:file,loaded:true,exports};
}
const h=require('../api/market-dynamic-refresh.js');
async function req(schedule,query={}){
 const result={statusCode:0,headers:{},body:null};
 const response={setHeader(k,v){result.headers[k]=v},status(n){result.statusCode=n;return this},json(v){result.body=v;return this}};
 await h({method:'GET',query,headers:{'x-vercel-cron-schedule':schedule,'user-agent':'vercel-cron/1.0'}},response);
 return result;
}
fixture=[{...good[0]},{...good[1],trade_date:'2026-10-22'}];
let r=await req('20 11 * * 1-5');
assert.equal(r.statusCode,503);assert.equal(r.body.code,'MARKET_SOURCE_NOT_ALIGNED');assert.equal(r.body.preservedLastGood,true);assert.equal(snapshotRuns,0);
fixture=good;
r=await req('20 11 * * 1-5');assert.equal(r.statusCode,200);assert.equal(r.body.latestDate,'2026-10-27');assert.equal(snapshotRuns,1);
r=await req('40 12 * * 1-5');assert.equal(r.statusCode,200);assert.equal(snapshotRuns,2);
r=await req('8 8 * * 1-5');assert.equal(r.statusCode,401);assert.equal(snapshotRuns,2);
for(const [file,old] of cacheBackups){if(old)require.cache[file]=old;else delete require.cache[file];}
console.log(JSON.stringify({ok:true,checks:17,dbReads,snapshotRuns,cronCount:v.crons.length}));
})().catch(e=>{console.error(e);process.exitCode=1});
