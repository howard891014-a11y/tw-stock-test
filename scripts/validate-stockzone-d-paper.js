'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const orig=Module._load;
Module._load=function(req,parent,isMain){
 if(req==='@neondatabase/serverless')return{neon:()=>({query(){throw Error('NEON_NETWORK_DISALLOWED_IN_TEST')}})};
 return orig.call(this,req,parent,isMain);
};
const {VERSION:DV}=require('../lib/stockzone-d-policy');
const {VERSION,makeSignal,executeNextOpen,verifySeal,beginState}=require('../lib/stockzone-d-paper');
const {createBlobJournal,PREFIX}=require('../lib/stockzone-d-paper-store');
const {summarize}=require('../lib/stockzone-d-paper-report');
const {freezeToday,settleNext,NEXT_DAY_QUERY,COVERAGE_QUERY,PRICES_QUERY}=require('../lib/stockzone-d-paper-runner');
const mkPick=(id,slot=1)=>({stock_code:id,stock_name:'測試股票',market:'上市',tag_id:'semiconductor',slot,
 allocationPct:20,track:'V4_PROTECTED',v4Score:.9,originalV4Rank:slot});
const pick1=mkPick('2330',1),pick2=mkPick('2317',2),pick3=mkPick('2454',2);
function preview(date,mode='ON',d=[pick1,pick2],b=[pick1,pick3]){
 return {asOfDate:date,model:DV,adapter:'D-FORWARD-RESEARCH-ONLY',w3ModelVersion:'W3-D.1.2',
   neonMoneyVersion:'capital-money-corebreadth50-samecore100-v1',dataComplete:true,
   noOrders:true,studyOnly:true,independentSqlResearchParity:false,mode,source:'ORIGINAL_V4',
   reason:'OK',marketBreadth:null,entryAllowed:d.length>0,recommendations:mode==='OFF'?[]:d,
   baseline:{asOfDate:date,model:'StockZone-V4-5plus5-original_all',
    scene:mode==='ON'?'ON_BROAD':mode==='OFF'?'OFF':'WARNING',core:mode==='OFF'?[]:b,extended:[]}};
}
function rows(open=100,close=101){return [pick1,pick2,pick3].map(x=>({stock_code:x.stock_code,market:x.market,open_price:open,
 close_price:close,previous_close:100}));}
const captured=(d)=>d+'T08:00:00.000Z'; // T 16:00 Taipei
const observed=(d)=>d+'T08:15:00.000Z'; // E 16:15 Taipei
const sig=(date,mode='ON',d,b)=>makeSignal(preview(date,mode,d,b),captured(date));
const run=(signal,previous,date,prices=rows())=>executeNextOpen({signal,previous,sessionDate:date,observedAt:observed(date),prices,marketPriceCount:1930});
let s=sig('2026-10-23');
assert.equal(s.type,'FROZEN_SIGNAL');assert.equal(s.d.positions.length,2);assert.equal(s.baseline.positions.length,2);
assert.equal(verifySeal(s).sha256,s.sha256);
assert.equal(s.simulatedOnly,true);assert.equal(s.noOrders,true);
assert.throws(()=>verifySeal({...s,mode:'OFF'}),/SHA256 mismatch/);
assert.throws(()=>makeSignal(preview('2026-10-23'), '2026-10-23T05:00:00.000Z'),/after T 15:00/);
let e=run(s,null,'2026-10-27'); // actual future session date injected: 10/26 holiday
assert.equal(e.events.filter(x=>x.side==='BUY').length,4);
assert.equal(e.state.accounts.D.positions.length,2);
assert.equal(e.state.accounts.V4.positions.length,2);
assert.equal(e.state.accounts.D.cash,600000);
assert.ok(e.state.accounts.D.equityAtClose<1020000); // fees charged
assert.equal(e.state.accounts.D.positions[0].heldSessions,1);
assert.throws(()=>run(s,null,'2026-10-23'),/not a later/);
assert.throws(()=>run(makeSignal(preview('2026-10-23'), '2026-10-27T02:00:00.000Z'),null,'2026-10-27'),/LOOKAHEAD/);
assert.throws(()=>executeNextOpen({signal:s,previous:null,sessionDate:'2026-10-27',observedAt:'2026-10-27T02:00:00Z',prices:rows(),marketPriceCount:1930}),/after official close/);
assert.throws(()=>executeNextOpen({signal:s,previous:null,sessionDate:'2026-10-27',observedAt:observed('2026-10-27'),prices:rows(),marketPriceCount:600}),/incomplete opening/);
const off=sig('2026-10-27','OFF');const exit=run(off,e,'2026-10-28');
assert.equal(exit.events.filter(x=>x.side==='SELL').length,4);
assert.equal(exit.state.accounts.D.positions.length,0);
assert.equal(exit.state.accounts.V4.positions.length,0);
assert.equal(exit.state.accounts.D.closedTrades,2);
assert.ok(exit.state.accounts.D.realizedPnl<0); // unchanged opening quote still incurs transaction costs
const summary=summarize([exit,e]);
assert.equal(summary.observedSessions,2);
assert.equal(summary.D.closedTrades,2);
assert.equal(summary.V4.closedTrades,2);
assert.equal(summary.D.dualSuccessRatePct,null); // no verified official TAIEX opening feed; refuse guess
assert.equal(summary.D.missingBenchmarkExits,2);
assert.equal(summary.fullyVerified,false);
const benchBuy=executeNextOpen({signal:s,previous:null,sessionDate:'2026-10-27',observedAt:observed('2026-10-27'),prices:rows(),marketPriceCount:1930,benchmarkOpen:20000});
const benchSell=executeNextOpen({signal:off,previous:benchBuy,sessionDate:'2026-10-28',observedAt:observed('2026-10-28'),prices:rows(102,102),marketPriceCount:1930,benchmarkOpen:20010});
assert.equal(benchSell.events.filter(x=>x.side==='SELL'&&x.dualSuccess===true).length,4);
assert.equal(summarize([benchBuy,benchSell]).D.dualSuccessRatePct,100);
assert.throws(()=>summarize([{...e,events:[]}]),/SHA256 mismatch/);
assert.throws(()=>run(sig('2026-10-29'),e,'2026-10-30'),/missing preceding execution/);
const w=sig('2026-11-02','WARNING',[pick1,pick2],[pick1,pick3]);
let wEntry=run(w,null,'2026-11-03');assert.equal(wEntry.state.accounts.D.positions[0].mode,'WARNING');
assert.equal(wEntry.state.accounts.D.positions[0].heldSessions,1);
let wNext=sig('2026-11-03','WARNING',[pick1,pick2],[pick1,pick3]);
let wExit=run(wNext,wEntry,'2026-11-04');
assert.equal(wExit.events.filter(x=>x.strategy==='D'&&x.side==='SELL').length,2);
assert.equal(wExit.events.filter(x=>x.strategy==='D'&&x.side==='BUY').length,2);
assert.equal(wExit.state.accounts.D.positions[0].entryDate,'2026-11-04');
let blocked=rows();blocked[0].open_price=null;
const wBlocked=run(wNext,wEntry,'2026-11-04',blocked);
assert.equal(wBlocked.state.accounts.D.positions.length,1); // 1 sold, 1 blocked, cannot refill
assert.ok(wBlocked.problems.some(x=>x.reason==='OPEN_OR_CLOSE_UNAVAILABLE'));
assert.equal(wBlocked.events.filter(x=>x.strategy==='D'&&x.side==='BUY').length,0);
const badOpening=rows();badOpening[0].open_price=55;
const blockCorporate=run(wNext,wEntry,'2026-11-04',badOpening);
assert.ok(blockCorporate.problems.some(x=>x.reason==='PRICE_DISCONTINUITY_CORPORATE_ACTION_REVIEW'));
let onSignal=sig('2026-11-02','ON',[pick1],[pick1]);
let held=run(onSignal,null,'2026-11-03');
for(let i=1;i<20;i++){
 const d=new Date(Date.parse('2026-11-03T00:00:00Z')+86400000*i).toISOString().slice(0,10);
 let cur=sig(held.executionDate,'ON',[pick2],[pick2]);
 held=run(cur,held,d);
 if(i<19)assert.equal(held.events.filter(x=>x.side==='SELL').length,0);
}
assert.equal(held.state.accounts.D.positions[0].heldSessions,20);
const next=new Date(Date.parse(held.executionDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const roll=run(sig(held.executionDate,'ON',[pick2],[pick2]),held,next);
assert.equal(roll.events.filter(x=>x.strategy==='D'&&x.side==='SELL').length,1);
assert.equal(roll.events.filter(x=>x.strategy==='D'&&x.side==='BUY').length,1);
assert.equal(roll.state.accounts.D.positions[0].stock_code,'2317');
// A failed/missing buy must leave exactly its 20% allocation as cash, not redistribute.
let limited=run(s,null,'2026-10-27',rows().filter(x=>x.stock_code!=='2317'));
assert.equal(limited.state.accounts.D.cash,800000);
assert.equal(limited.state.accounts.D.positions.length,1);
// Store mock: same key is strictly immutable; repeated capture has first writer's timestamp.
const files=new Map(),mockBlob={
 async get(path){const data=files.get(path);return data?{statusCode:200,stream:new Response(data).body}:null},
 async put(path,contents,opts){assert.equal(opts.allowOverwrite,false);assert.equal(opts.access,'private');if(files.has(path))throw Error('409 Conflict already exists');files.set(path,contents);return {pathname:path}},
 async list({prefix}){return{blobs:[...files.keys()].filter(x=>x.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false}}
};
const journal=createBlobJournal({client:mockBlob});
(async()=>{
 const a=await journal.saveSignal(s);assert.equal(a.created,true);
 const b=await journal.saveSignal(makeSignal(preview('2026-10-23'), '2026-10-23T08:15:00.000Z'));
 assert.equal(b.created,false);assert.equal(b.record.sha256,s.sha256);
 let c=await journal.saveExecution(e);assert.equal(c.created,true);
 let d=await journal.saveExecution(e);assert.equal(d.created,false);
 assert.deepEqual(await journal.listExecutionDates(),['2026-10-27']);
 assert.equal((await journal.getSignal(s.signalDate)).sha256,s.sha256);
 const immutable=JSON.parse(files.get(PREFIX+'signals/2026-10-23.json'));
 files.set(PREFIX+'signals/2026-10-23.json',JSON.stringify({...immutable,mode:'OFF'}));
 await assert.rejects(journal.getSignal('2026-10-23'),/SHA256 mismatch/);
 files.set(PREFIX+'signals/2026-10-23.json',JSON.stringify(immutable));
 const separate=new Map();const j2=createBlobJournal({client:{...mockBlob,
  async get(path){const data=separate.get(path);return data?{statusCode:200,stream:new Response(data).body}:null},
  async put(path,body,opts){if(separate.has(path))throw Error('409');separate.set(path,body);return{pathname:path}},
  async list({prefix}){return{blobs:[...separate.keys()].filter(x=>x.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false}},
 }});
 let first=await freezeToday({journal:j2,previewFetcher:async()=>preview('2026-10-23'),now:()=>new Date('2026-10-23T08:00:00Z')});
 assert.equal(first.created,true);assert.equal(first.dCount,2);
 first=await freezeToday({journal:j2,previewFetcher:async()=>preview('2026-10-23'),now:()=>new Date('2026-10-23T08:20:00Z')});
 assert.equal(first.created,false);assert.equal(first.capturedAt,'2026-10-23T08:00:00.000Z');
 const fakeSql={async query(q,args){
  if(q===NEXT_DAY_QUERY)return[{trade_date:'2026-10-27'}];
  if(q===COVERAGE_QUERY)return[{n:1944}];
  if(q===PRICES_QUERY)return rows().filter(x=>args[1].includes(x.market+'|'+x.stock_code));
  throw Error('unexpected query: '+q);
 }};
 const settled=await settleNext({signalDate:'2026-10-23',journal:j2,sql:fakeSql,now:()=>new Date('2026-10-27T08:15:00Z')});
 assert.equal(settled.status,'RECORDED');assert.equal(settled.simulatedTradeEvents,4);
 const twice=await settleNext({signalDate:'2026-10-23',journal:j2,sql:fakeSql,now:()=>new Date('2026-10-27T08:16:00Z')});
 assert.equal(twice.status,'ALREADY_FROZEN');
 const signalOld=await j2.getSignal('2026-10-23');
 const simulated=await j2.getExecution('2026-10-27');
 assert.equal(simulated.signalSha256,signalOld.sha256);
 assert.equal(simulated.state.accounts.D.positions.length,2);
 assert.equal(simulated.noOrders,true);
 assert.equal(NEXT_DAY_QUERY.toLowerCase().includes('insert'),false);
 assert.equal(COVERAGE_QUERY.toLowerCase().includes('insert'),false);
 assert.equal(PRICES_QUERY.toLowerCase().includes('update'),false);
 console.log('PASS PAPER immutable paired signal D/V4; 20-session ON, 1-session WARNING, OFF close, 20% untouched cash, 0.3%+0.3% cost, halt/corporate guard, preopen anti-lookahead, same-date chain, hash verification, Blob first-writer-wins, Neon readonly runner, idempotent retry');
})().catch(e=>{console.error(e);process.exitCode=1});
