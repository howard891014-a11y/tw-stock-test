// Offline contract tests: no external Yahoo or Neon calls.
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(parent?.filename?.endsWith('/api/quote.js')&&request==='../lib/stockmeta-service')return ()=>{};
  if(parent?.filename?.endsWith('/api/quote.js')&&request==='../lib/db')return {getSql:()=>{throw Error('DB must not be used in this quote fixture')}};
  return original.apply(this,arguments);
};
const quote=require('../api/quote.js');
Module._load=original;
const t=Math.floor(new Date('2026-10-21T01:30:00.000Z').getTime()/1000);
async function one(meta, bars=[],times=[]){
 const old=global.fetch;
 global.fetch=async()=>({ok:true,json:async()=>({chart:{result:[{meta:{shortName:'Test',regularMarketTime:t,regularMarketPrice:100,chartPreviousClose:95,...meta},timestamp:times,indicators:{quote:[{close:bars}]}}]}})});
 try{return await quote._test.fetchYahoo('2330.TW',{name:'台積電',market:'上市'});}finally{global.fetch=old}
}
(async()=>{
 const native=await one({regularMarketChange:5,regularMarketChangePercent:5.2});
 assert.equal(native.changePct,5.2);assert.equal(native.changeSource,'Yahoo 原始漲跌');
 const derived=await one({});
 assert.ok(Math.abs(derived.changePct-(100/95-1)*100)<1e-8);
 assert.equal(derived.changeSource,'Yahoo 同源基準計算');
 const next=await one({regularMarketChange:5,regularMarketChangePercent:5.2},[103],[t+60]);
 assert.equal(next.last,103);
 assert.ok(Math.abs(next.changePct-(103/95-1)*100)<1e-8);
 assert.equal(next.changeSource,'Yahoo 同源基準計算');
 console.log('PASS v2.6.8.3 Yahoo native/fallback/newer-bar quote behavior');
})().catch(e=>{console.error(e);process.exitCode=1});
