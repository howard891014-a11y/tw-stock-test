'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const load=f=>fs.readFileSync(path.join(root,f),'utf8');
const index=load('index.html'),app=load('app.js'),lab=load('lib/resonance-lab-v1.js'),market=load('lib/market-dynamic.js');
assert.equal(require('../package.json').version,'2.7.0.53');
// 1: chart and play-style panel use identical deep-defense target, never pullback.
assert.match(lab,/target\('深跌參考',a\.targets\?\.defense\)/);
assert.doesNotMatch(lab,/target\('深跌參考',Number\.isFinite\(a\.targets\?\.pullback/);
// 2: no forced line-height reservation between financing-usage and estimate.
assert.match(index,/\[data-credit-card="margin"\]>p#creditMarginUsage\{\s*min-height:0!important;margin:0 0 1px!important/);
// 3: independent earnings quarters; no cross-quarter numerator/denominator mixing.
assert.match(load('lib/api-routes/fundamentals.js'),/incomeGross \/ incomeRevenue \* 100/);
assert.match(load('lib/api-routes/fundamentals.js'),/incomeOperating \/ incomeRevenue \* 100/);
const start=app.indexOf('function fundamentalQuarterInfo('),end=app.indexOf('function fundamentalComment(',start);
assert(start>0&&end>start);
const scope={valuationNum:v=>v==null?null:Number(v),Date};
vm.createContext(scope);vm.runInContext(app.slice(start,end),scope);
const q3={period:'2026 Q3',year:2026,quarterNo:3,revenue:1000,grossProfit:500,operatingIncome:300,
  grossMargin:50,operatingMargin:30,sourceType:'official',marginSource:'official'};
const q2={period:'2026 Q2',year:2026,quarterNo:2,grossMargin:45,operatingMargin:25,sourceType:'official'};
let result=scope.fundamentalMarginYearComparison({officialStatement:q3,marginStatement:q2,quarters:[]},'gross');
assert.equal(result.now,50);assert.equal(result.period,'2026Q3');
result=scope.fundamentalMarginYearComparison({officialStatement:q3,marginStatement:q2,quarters:[]},'operating');
assert.equal(result.now,30);assert.equal(result.period,'2026Q3');
result=scope.fundamentalMarginYearComparison({officialStatement:{period:'2026 Q3',year:2026,quarterNo:3,sourceType:'official'},marginStatement:q2,quarters:[]},'gross');
assert.equal(result.now,45);assert.equal(result.period,'2026Q2','Never label the older Q2 value as Q3');
// 4: protect prior institutional official totals at price-only publication and read cached archive.
assert.match(market,/restoreOfficialHistory\(previous,sql\)/);
assert.match(market,/r\.officialInstitutional=old\.officialInstitutional/);
assert.match(market,/restoreOfficialHistory\(page,getSql\(\)\)/);
assert.match(load('lib/market-institutional-official.js'),/i===0\|\|!old\.has\(d\)/);
// 5: FX: primary official JSON, independent CBC official CSV, and labeled
//    official TAIFEX reference-rate fallback, never a fabricated FX rate.
(async()=>{
  const originalFetch=global.fetch;
  const modPath=require.resolve('../lib/cbc-usdtwd');
  delete require.cache[modPath];
  const fx=require('../lib/cbc-usdtwd');
  const csv='日期,NTD/USD\n115/10/29,32.492\n115/10/30,32.478\n115/11/02,32.592\n115/11/03,32.760\n115/11/04,32.821\n115/11/05,32.854\n';
  assert.equal(fx.date('1151105'),'2026-11-05');
  assert.equal(fx.date('115/11/05'),'2026-11-05');
  assert.equal(fx.normalize(fx.parseCsv(csv)).rate,32.854);
  let calls=[];
  global.fetch=async url=>{
    calls.push(String(url));
    if(String(url)===fx.JSON_URL)return {ok:false,status:503};
    if(String(url)===fx.CSV_URL)return {ok:true,arrayBuffer:async()=>new TextEncoder().encode(csv).buffer};
    throw Error('unexpected destination');
  };
  try{
    const result=await fx.getFx();
    assert.equal(result.rate,32.854);assert.equal(result.date,'2026-11-05');
    assert.equal(result.sourceUrl,fx.CSV_URL);
    assert.equal(calls.length,2);
  }finally{global.fetch=originalFetch;delete require.cache[modPath];}
  // Full CBC outage: still show a real, explicitly differently-timed
  // official TAIFEX settlement reference, never claim it is CBC closing FX.
  const taifex=require('../lib/cbc-usdtwd');
  global.fetch=async url=>{
    if(String(url)===taifex.TAIFEX_URL)return {ok:true,text:async()=>JSON.stringify([
      {'日期':'115/11/05','美元_新台幣(匯率)':'32.850'}])};
    return {ok:false,status:503};
  };
  try{
    const r=await taifex.getFx();
    assert.equal(r.rate,32.85);assert.equal(r.referenceRate,true);
    assert.match(r.source,/期貨交易所/);
  }finally{global.fetch=originalFetch;delete require.cache[modPath];}
  // Independent archive row carries explicit market identity and checksum.
  const Module=require('node:module'),originalLoad=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='./db'&&parent?.filename?.endsWith('/lib/official-institutional-archive.js'))return {getSql:()=>({query:async()=>[]})};
    return originalLoad.call(this,request,parent,isMain);
  };
  let archive;try{archive=require('../lib/official-institutional-archive')}finally{Module._load=originalLoad;}
  const dates=['2026-11-03','2026-11-04'];
  const records=[];
  for(const date of dates)for(const marketName of ['上市','上櫃'])records.push({date,market:marketName,
    foreign:'-1000000000',trust:'2000000000',dealer:'3000000000',total:'4000000000'});
  let queryCount=0;
  const sql={query:async q=>{queryCount++;assert.match(q,/WHERE is_complete=true/);return records}};
  const data={ok:true,history:[{date:'2026-11-04',officialInstitutional:null},{date:'2026-11-03',officialInstitutional:null}]};
  await archive.restoreOfficialHistory(data,sql);
  assert.equal(data.history[0].officialInstitutional.foreign,-2000000000);
  assert.equal(data.history[1].officialInstitutional.complete,true);
  assert.equal(data.latest.date,'2026-11-04');
  assert.equal(queryCount,1);
  await archive.restoreOfficialHistory({ok:true,history:[{date:'2026-11-03'}]},sql);
  assert.equal(queryCount,1,'Reuse 5-min validated archive cache, no extra Neon read');
  console.log('v2.7.0.53 fixes PASS: defense target, ratio quarter, CSS, CBC fallback, verified archive recovery');
})().catch(err=>{console.error(err);process.exitCode=1});
