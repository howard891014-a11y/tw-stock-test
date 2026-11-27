'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
// Pure mock: this test makes no database/network calls and intentionally
// does not require production credentials or installed Neon SDK.
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='@neondatabase/serverless')return {neon:()=>{throw new Error('No DB in unit tests')}};
 return originalLoad.apply(this,arguments);
};
const config=require('../vercel.json');
const {missingPerSession,recoverPriceGaps,recoverChipGaps}=require('../lib/market-auto-recovery');
const stockCode=require('../lib/w3-d112-onoff');
const pkg=require('../package.json');
assert.equal(pkg.version,'2.7.1.0');
assert.equal(typeof stockCode.computeW3D112OnOff,'function');
for(const [s,p] of [['0 12 * * 1-5','/api/sync-status'],['50 13 * * 1-5','/api/sync-status'],['50 15 * * 1-5','/api/market-dynamic-refresh?margin=1']]){
 assert(config.crons.some(x=>x.schedule===s&&x.path===p),`missing verified recovery job ${s}`);
}
assert(config.crons.some(x=>x.schedule==='0 14 * * 1-5'&&x.path==='/api/market-dynamic-refresh'),'W3 22:00 job must survive');
assert(config.crons.some(x=>x.schedule==='35 15 * * 1-5'&&x.path==='/api/market-dynamic-refresh'),'W3 23:35 recovery must survive');
const dates=['2026-11-25','2026-11-26','2026-11-27'];
const counts=Object.fromEntries(dates.flatMap(d=>['上市','上櫃'].map(m=>[`${d}|${m}`,m==='上市'?1080:860])));
delete counts['2026-11-26|上市'];delete counts['2026-11-26|上櫃'];
assert.deepEqual(missingPerSession(dates,counts,{'上市':500,'上櫃':300}),[
 {date:'2026-11-26',market:'上市'},{date:'2026-11-26',market:'上櫃'}]);
// The newest date's existence must not conceal a missing middle session.
const sql={query:async(q,args=[])=>{
 if(q.includes('FROM market_index_eod_daily'))return dates.slice().reverse().map(d=>({d}));
 if(q.includes('FROM market_daily_history'))return Object.entries(counts).map(([k,n])=>({d:k.slice(0,10),market:k.split('|')[1],n}));
 if(q.includes('FROM institutional_trading_daily')||q.includes('FROM credit_trading_daily'))return [];
 if(q.includes('INSERT INTO sync_status'))return [];
 throw new Error('Unexpected SQL test query: '+q.slice(0,90));
}};
(async()=>{
 const source=require('../lib/sync-service');
 const prior=source.repairHistoricalMarketDate;
 const calls=[];
 source.repairHistoricalMarketDate=async({tradeDate,markets})=>{
  calls.push({tradeDate,markets});return {tradeDate,ok:false,reason:'test-no-external-call'};
 };
 try{
  const out=await recoverPriceGaps({sql,maxDates:1});
  assert.equal(calls.length,1);assert.deepEqual(calls[0],{tradeDate:'2026-11-26',markets:['上市','上櫃']});
  assert.equal(out.ok,false);
  assert.equal(out.remaining.length,2);
 }finally{source.repairHistoricalMarketDate=prior}
 const src=fs.readFileSync(path.join(root,'lib/margin-maintenance.js'),'utf8');
 assert(src.includes('trade_date>$1::date AND trade_date<=$2::date'));
 assert(src.includes('if(gap.length)return null'),'margin cost state cannot skip unknown session');
 const api=fs.readFileSync(path.join(root,'api/market-dynamic-refresh.js'),'utf8');
 assert(api.includes('daily-margin-estimate'),'independent margin computation required');
 assert(!fs.readFileSync(path.join(root,'lib/w3-d112-onoff.js'),'utf8').includes('market_recovery_'));
 const margin=require('../lib/margin-maintenance');
 const sample={date:'2026-11-25',estimate_pct:133.79,coverage_pct:99.9,symbol_coverage_pct:99.2,stock_count:1764,used_count:1751,unknown_share_pct:20};
 let writes=0;
 const db={query:async q=>{
  if(q.includes('CREATE TABLE'))return [];
  if(q.includes('SELECT MAX(trade_date)::text AS day FROM credit_trading_daily'))return [{day:'2026-11-27'}];
  if(q.includes('FROM sz_margin_market_daily WHERE trade_date='))return [];
  if(q.includes('SELECT MAX(trade_date)::text AS d FROM sz_margin_market_daily'))return [{d:'2026-11-25'}];
  if(q.includes('WITH sessions AS'))return [{d:'2026-11-26'}];
  if(q.includes('FROM sz_margin_market_daily ORDER BY trade_date DESC LIMIT 1'))return [sample];
  if(/INSERT|UPDATE|DELETE/.test(q)){writes++;throw Error('Must not write margin over missing session')}
  throw Error('Unexpected margin SQL: '+q.slice(0,100));
 }};
 const preserved=await margin.marketEstimate(db);
 assert.equal(preserved.date,'2026-11-25');assert.equal(preserved.stale,true);assert.equal(writes,0);
 console.log('PASS v2.7.1.0: missing-day detection, independent crons, unchanged W3, margin state protected against skipped sessions.');
})().catch(e=>{console.error(e);process.exitCode=1});
