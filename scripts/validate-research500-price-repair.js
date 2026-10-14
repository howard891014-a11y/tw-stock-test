'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const Module=require('node:module');
const source=fs.readFileSync('lib/research-500d-price-repair.js','utf8');
const official=fs.readFileSync('lib/research-500d-official.js','utf8');
const api=fs.readFileSync('api/sync-status.js','utf8');
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
assert(source.includes('market_research500_price_repair_backup'));
assert(source.includes('market_research500_price_repair_done'));
assert(source.includes('MAX(')===false || source.includes('market_research500_price_repair_cache'));
assert(source.includes('updated_at=NOW()'));
assert(source.includes('return_1_pct=ROUND(d.ret1,10),y_score=ROUND(d.y5,4)'));
assert(!/UPDATE market_business_xy2_(?:snapshot|stock_daily|topic_daily)/.test(source));
assert(official.includes('p1.trade_date=c.prior_date_1'));
assert(official.includes('p5.trade_date=c.prior_date_5'));
assert(official.includes('p20.trade_date=c.prior_date_20'));
assert(api.includes("action==='research-price-label-repair-manual'"));
assert(html.includes('manualResearchPriceRepair')&&app.includes('runManualResearchPriceRepair'));
const old=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return{neon:()=>{throw Error('DB disconnected in isolated unit test')}};return old.call(this,id,parent,isMain)};
const repair=require('../lib/research-500d-price-repair');Module._load=old;
assert.equal(repair.LAST_AFFECTED_DAY,'2026-10-13');
assert(repair.RECONSTRUCT_PRICE_SQL.includes('market_business_xy2_member'));
assert(repair.RECONSTRUCT_PRICE_SQL.includes('prev1')&&repair.RECONSTRUCT_PRICE_SQL.includes('prev5'));
(async()=>{
 const rows=(prefix,n)=>Array.from({length:n},(_,i)=>({trade_date:'2026-04-07',market:prefix,stock_code:String(1000+i),close_price:20,trade_value:1000}));
 const queries=[];
 const fake={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.includes('SELECT DISTINCT stock_code,market'))return rows('上市',1100).concat(rows('上櫃',300));
  if(sql.includes('RETURNING 1'))return Array.from({length:300},()=>({}));
  return [];
 }};
 // Pure official PRICE feed can be repaired without any institutional data.
 const n=await repair.fetchMissingPriceDay(fake,'2026-04-07',[
  async()=>({rows:rows('上市',1100)}),async()=>({rows:rows('上櫃',300)})]);
 assert(n>0);assert(queries.some(q=>q.sql.includes('market_research500_price_repair_calendar')));
 await assert.rejects(()=>repair.fetchMissingPriceDay(fake,'2026-04-07',[
  async()=>({rows:rows('上市',20)}),async()=>({rows:rows('上櫃',300)})]),/insufficient-coverage/);
 const closed=await repair.fetchMissingPriceDay(fake,'2026-04-03',[async()=>({nonTrading:true}),async()=>({nonTrading:true})]);
 assert.equal(closed,0);
 console.log('PASS research500 price-label hotfix: sessions, preserved price-only rows, historical backup, bounded repair, closed-market dates');
})().catch(e=>{console.error(e);process.exitCode=1});
