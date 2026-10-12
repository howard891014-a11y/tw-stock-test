'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const src=fs.readFileSync('api/sync-status.js','utf8'),app=fs.readFileSync('app.js','utf8');
assert(src.includes("progressView==='history-raw-progress'"));
assert(src.includes("progressView==='research-500d-progress'"));
assert(!src.includes("const {backfillResearch500D,readResearch500DProgress}=require('../lib/research-500d-backfill')"));
assert(app.includes('Promise.allSettled([rawPromise,researchPromise])'));
const original=Module._load;
let requested=[], failResearch=true;
const getSql=()=>({query:async(q,params)=>{
  requested.push(q);
  if(/market_daily_history/.test(q))return [{market:'上市',days:121},{market:'上櫃',days:121}];
  if(/institutional_trading_daily/.test(q))return [{market:'上市',days:121},{market:'上櫃',days:121}];
  if(/credit_trading_daily/.test(q))return [{market:'上市',days:90},{market:'上櫃',days:90}];
  throw Error('Unexpected SQL: '+q.slice(0,120));
}});
Module._load=function(name,parent,isMain){
  if(name==='@neondatabase/serverless')return {neon:()=>{throw Error('Direct Neon init not allowed in test')}};
  if(name==='../lib/db' && parent?.filename?.endsWith('/api/sync-status.js'))return {getSql,readDatabaseSizeAudit:async()=>({}),readDatabaseDeepAudit:async()=>({})};
  if(name==='../lib/research-500d-backfill' && parent?.filename?.endsWith('/api/sync-status.js')){
    if(failResearch)throw Error('Simulated missing research file');
    return {readResearch500DProgress:async()=>({targetDays:500,currentDays:60,xUsableDays:26,categoryCount:203,allVersionDays:64,minDate:'2026-07-15',maxDate:'2026-10-08'})};
  }
  return original.call(this,name,parent,isMain)
};
let handler;
handler=require('../api/sync-status.js')
async function exec(view){
  const res={setHeader(){},status(x){this.code=x;return this},json(x){this.body=x;return this}};
  await handler({method:'GET',query:{view},headers:{}},res);
  return res;
}
(async()=>{
  let r=await exec('history-raw-progress');
  assert.equal(r.code,200);assert.equal(r.body.markets['上市'].price.tradingDays,121);
  assert.equal(r.body.markets['上櫃'].credit.tradingDays,90);
  assert.equal(requested.length,3);
  // Research import is intentionally deferred; an unavailable research module cannot
  // make RAW progress fail on function cold-start.
  r=await exec('research-500d-progress');assert.equal(r.code,500);
  r=await exec('history-raw-progress');assert.equal(r.code,200);
  failResearch=false;
  r=await exec('research-500d-progress');assert.equal(r.code,200);
  assert.equal(r.body.research500Progress.currentDays,60);
  assert.equal(r.body.research500Progress.xUsableDays,26);
  console.log('PASS v2.6.7.9: independent raw 121/121/90; optional 500D fail-isolation; research 60D/X26D');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{Module._load=original});
