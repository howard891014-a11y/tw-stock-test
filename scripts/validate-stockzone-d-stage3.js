'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
// Local validation is fully offline; do not require cloud account credentials.
const Module=require('node:module');
const oldLoad=Module._load;
Module._load=function(name,...rest){
 if(name==='@neondatabase/serverless')return {neon:()=>{throw Error('no live Neon from unit tests')}};
 if(name==='@vercel/blob')return {get:()=>{throw Error('no live Blob from unit tests')}};
 return oldLoad.call(this,name,...rest);
};
let api,stage;
try{
 api=require('../api/market-dynamic-refresh');
 stage=require('../lib/stockzone-d-paper-cron');
}finally{Module._load=oldLoad;}

const {createBlobJournal}=require('../lib/stockzone-d-paper-store');
const {sealed}=require('../lib/stockzone-d-paper');
const {CRON_SCHEDULE,CRON_PATH,strictCronAccess,enabled,runDailyCycle,
 LATEST_PRICE_QUERY,PREV_PRICE_QUERY,CHECK_PRICE_QUERY}=stage;
const config=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../vercel.json'),'utf8'));
const secret='test-only-not-production-32-byte-secret-abcdefg';
const goodReq={method:'GET',query:{paper:'stage3'},headers:{'x-vercel-cron-schedule':CRON_SCHEDULE,'user-agent':'vercel-cron/1.0',authorization:`Bearer ${secret}`}};
const env={CRON_SECRET:secret,STOCKZONE_D_PAPER_ENABLED:'1',BLOB_READ_WRITE_TOKEN:'test-mock-only'};
function thrownText(e){return String(e?.message||e)}
function db({latest,prev,cover=1900}){return {async query(q,params=[]){
 if(q===LATEST_PRICE_QUERY)return[{latest_trade_date:latest}];
 if(q===PREV_PRICE_QUERY){assert.equal(params[0],latest);return[{prev_trade_date:prev}];}
 if(q===CHECK_PRICE_QUERY){assert.equal(params[0],latest);return[{n:cover}];}
 throw Error('unexpected SQL in stage3 '+q);
}};}
async function tests(){
 assert(config.crons.length>=8);assert.equal(config.crons.filter(c=>c.path===CRON_PATH&&c.schedule===CRON_SCHEDULE).length,1);
 assert(config.crons.filter(c=>c.path!=='/api/market-dynamic-refresh?paper=stage3').length>=7);
 assert.equal(strictCronAccess(goodReq,env),true);
 for(const req of [
  {...goodReq,method:'POST'},
  {...goodReq,headers:{...goodReq.headers,authorization:'Bearer wrong'}},
  {...goodReq,headers:{...goodReq.headers,'x-vercel-cron-schedule':'35 15 * * 1-5'}},
  {...goodReq,headers:{...goodReq.headers,'user-agent':'curl/8'}},
 ])assert.equal(strictCronAccess(req,env),false);
 assert.equal(strictCronAccess(goodReq,{CRON_SECRET:''}),false,'undefined cron secret MUST fail closed');
 assert.equal(enabled(env),true);
 assert.equal(enabled({...env,STOCKZONE_D_PAPER_ENABLED:'0'}),false);
 assert.equal(enabled({...env,BLOB_READ_WRITE_TOKEN:''}),false);
 assert.equal(enabled({...env,CRON_SECRET:undefined}),false);
 const data=new Map();
 const journal=createBlobJournal({client:{
  async get(path){const rec=data.get(path);return rec===undefined?null:{statusCode:200,stream:new Response(rec).body}},
  async put(path,body,opts){assert.equal(opts.allowOverwrite,false);if(data.has(path))throw Error('409');data.set(path,body);return{pathname:path}},
  async list({prefix}){return {blobs:[...data.keys()].filter(k=>k.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false}},
 }});
 assert.deepEqual(await journal.listSignalDates(),[]);
 const days=['2026-10-27','2026-10-28'];
 let current='2026-10-27',freezeCount=0,settleCount=0;
 const freeze=async({journal:store,now})=>{
  freezeCount++;
  const signal={type:'FROZEN_SIGNAL',signalDate:current,capturedAt:now().toISOString(),noOrders:true};
  const result=await store.saveSignal(sealed(signal));
  return {created:result.created,signalDate:current,dCount:0,v4Count:0};
 };
 const settle=async({signalDate,journal:store})=>{
  settleCount++;
  assert.equal(signalDate,'2026-10-27');
  const old=await store.getSignal(signalDate);assert.ok(old);
  const saved=await store.saveExecution(sealed({type:'EXECUTION',signalDate,signalSha256:old.sha256,executionDate:'2026-10-28'}));
  return {status:saved.created?'RECORDED':'ALREADY_FROZEN',executionDate:'2026-10-28'};
 };
 let result=await runDailyCycle({journal,sql:db({latest:current,prev:'2026-10-23'}),
  now:()=>new Date('2026-10-27T22:15:00Z'),freeze,settle});
 assert.equal(result.status,'CYCLE_VERIFIED');assert.equal(result.settled,'FIRST_SESSION_BOOTSTRAP_NO_PRIOR_TRADE');
 assert.equal(result.signalCreated,true);assert.equal(settleCount,0);assert.deepEqual(await journal.listSignalDates(),[current]);
 current='2026-10-28';
 result=await runDailyCycle({journal,sql:db({latest:current,prev:'2026-10-27'}),
  now:()=>new Date('2026-10-28T22:15:00Z'),freeze,settle});
 assert.equal(result.status,'CYCLE_VERIFIED');assert.equal(result.settled,'RECORDED');
 assert.deepEqual(await journal.listExecutionDates(),[current]);
 assert.deepEqual(await journal.listSignalDates(),days);assert.equal(result.signalCreated,true);
 result=await runDailyCycle({journal,sql:db({latest:current,prev:'2026-10-27'}),
  now:()=>new Date('2026-10-28T22:15:00Z'),freeze,settle});
 assert.equal(result.status,'CYCLE_VERIFIED');assert.equal(result.settled,'SESSION_ALREADY_RECORDED');
 assert.equal(result.signalCreated,false);assert.equal(settleCount,1,'a second cron request must not redo trades');
 assert.equal(freezeCount,3);
 // Even when last day is all present, do not create an old snapshot 5 days later.
 const snapshotCount=data.size;
 result=await runDailyCycle({journal,sql:db({latest:current,prev:'2026-10-27'}),
  now:()=>new Date('2026-11-02T22:15:00Z'),freeze,settle});
 assert.equal(result.status,'SOURCE_STALE_NO_NEW_SIGNAL');assert.equal(data.size,snapshotCount);
 await assert.rejects(runDailyCycle({journal,sql:db({latest:current,prev:'2026-10-27'}),
  now:()=>new Date('2026-10-28T06:15:00Z'),freeze,settle}),/08:00 onward/);
 await assert.rejects(runDailyCycle({journal,sql:db({latest:'2026-10-29',prev:'2026-10-28',cover:1400}),
  now:()=>new Date('2026-10-29T22:15:00Z'),freeze,settle}),/session still incomplete/);
 await assert.rejects(runDailyCycle({journal,sql:db({latest:'2026-10-30',prev:'2026-10-29'}),
  now:()=>new Date('2026-10-30T22:15:00Z'),freeze,settle}),/missing previous-session frozen signal/);
 // On this project CRON_SECRET is not configured yet. Stage3 route must deny even with spoofed cron headers.
 const mockRes=()=>({status(n){this.statusCode=n;return this},setHeader(){return this},json(v){this.body=v;return this}});
 const realSecret=process.env.CRON_SECRET,realFlag=process.env.STOCKZONE_D_PAPER_ENABLED;
 try{
  delete process.env.CRON_SECRET;delete process.env.STOCKZONE_D_PAPER_ENABLED;
  let res=mockRes();await api(goodReq,res);assert.equal(res.statusCode,200);
  assert.equal(res.body.status,'D_PAPER_DISABLED');
  process.env.CRON_SECRET=secret;
  res=mockRes();await api(goodReq,res);assert.equal(res.statusCode,200);
  assert.equal(res.body.status,'D_PAPER_DISABLED');
  process.env.STOCKZONE_D_PAPER_ENABLED='1';
  // If cloud Blob token is absent, still no writes.
  const savedBlob=process.env.BLOB_READ_WRITE_TOKEN;
  try{
   process.env.BLOB_READ_WRITE_TOKEN='fake-test-only';
   res=mockRes();await api({...goodReq,headers:{...goodReq.headers,authorization:'Bearer false'}},res);
   assert.equal(res.statusCode,401);
  }finally{if(savedBlob===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;
   else process.env.BLOB_READ_WRITE_TOKEN=savedBlob;}
 }finally{
  if(realSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=realSecret;
  if(realFlag===undefined)delete process.env.STOCKZONE_D_PAPER_ENABLED;else process.env.STOCKZONE_D_PAPER_ENABLED=realFlag;
 }
 console.log('PASS D stage3: 7 legacy jobs preserved, paper cron unchanged, new EOD jobs permitted; mandatory bearer secret/flag; first-session bootstrap; signed Blob signals; next-session settlement; one-time idempotency; incomplete EOD, missed signal and late capture fail-closed; no Neon writes/orders.');
}
tests().catch(e=>{console.error(e);process.exitCode=1});
