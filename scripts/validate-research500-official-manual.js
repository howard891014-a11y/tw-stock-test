'use strict';
const assert=require('assert');const fs=require('fs');const Module=require('module');
const root=fs.readFileSync('lib/research-500d-official.js','utf8');const api=fs.readFileSync('api/sync-status.js','utf8');
const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8');
assert(root.includes('market_research500_official_stage'));
assert(root.includes('market_research500_official_calendar'));
for(const t of ['WARMUP','MAX_FETCH_DAYS=3','MAX_STAGE_DAYS=54','official-overlap-Y-reproduction-failed','ON CONFLICT (trade_date,tag_id)','fetchTwseHistoricalRows','fetchTpexHistoricalRows','fetchTwseInstitutionalDay','fetchTpexInstitutionalDay'])assert(root.includes(t),t);
assert(!root.includes('INSERT INTO market_daily_history'));
assert(!root.includes('INSERT INTO institutional_trading_daily'));
assert(!root.includes('INSERT INTO market_business_xy2_topic_daily'));
assert(!root.includes('INSERT INTO market_business_xy2_stock_daily'));
assert(!root.includes('setInterval('));
assert(api.includes('loadOfficialResearch500D().backfillResearch500DOfficial({sql:getSql(),batchDays:3})'));
assert(html.includes('手動補齊 500D')&&app.includes('手動補齊 500D'));
const old=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return{neon:()=>{throw Error('No Neon in manual research tests')}};return old.call(this,id,parent,isMain)};
const b=require('../lib/research-500d-official');Module._load=old;
assert.strictEqual(b.MAX_FETCH_DAYS,3);
assert.deepStrictEqual(b.earlierWeekdays('2026-04-20',3),['2026-04-15','2026-04-16','2026-04-17']);
let dates=Array.from({length:49},(_,i)=>new Date(Date.UTC(2026,3,1+i)).toISOString().slice(0,10));
let selected=b.selectCausalBatch(dates,dates[48]);
assert.deepStrictEqual(selected.dates,dates.slice(45,48));assert.strictEqual(selected.warmupStart,dates[0]);
assert(!b.selectCausalBatch(dates.slice(-20),dates[48]).dates.length);
const stockRows=Array.from({length:52},(_,i)=>({trade_date:dates[i]||new Date(Date.UTC(2026,3,1+i)).toISOString().slice(0,10),stock_code:'2330',market:'上市',close_price:100+i*.5,trade_value:100000+i*9,trade_volume:1000,foreign_net:120,trust_net:22,dealer_net:-8,total_net:134}));
const derived=b.deriveStockFeatures(stockRows);
assert.strictEqual(derived.length,52);
assert.strictEqual(derived[0].change_pct,null);assert(Math.abs(derived[24].return_20_pct-100*((100+24*.5)/(100+4*.5)-1))<1e-8);
assert.strictEqual(derived[25].positive_days_5,5);
assert.strictEqual(derived[32].institutional_total_net,134);
assert(Math.abs(derived[40].return_5_pct-100*((100+40*.5)/(100+35*.5)-1))<1e-9);
const allowed=new Map([['上市',new Set()],['上櫃',new Set()]]);
const twse=Array.from({length:450},(_,i)=>({trade_date:'2026-04-17',stock_code:String(1000+i),close_price:20,trade_value:200000,trade_volume:10000,market:'上市'}));
const tpex=Array.from({length:300},(_,i)=>({trade_date:'2026-04-17',stock_code:String(3000+i),close_price:20,trade_value:200000,trade_volume:10000,market:'上櫃'}));
for(const p of twse.slice(0,230))allowed.get('上市').add(p.stock_code);
for(const p of tpex.slice(0,190))allowed.get('上櫃').add(p.stock_code);
const inst=rows=>rows.map(p=>({date:p.trade_date,code:p.stock_code,foreign:100,trust:20,dealer:5,total:125}));
const normalized=b.normalizeOfficialDay('2026-04-17',[{rows:twse},{rows:tpex}],[inst(twse),inst(tpex)],allowed);
assert(normalized.ok,JSON.stringify(normalized));assert.strictEqual(normalized.rows.length,420);
assert(!b.normalizeOfficialDay('2026-04-17',[{rows:twse.slice(0,12)},{rows:tpex}],[inst(twse),inst(tpex)],allowed).ok);
assert(!b.normalizeOfficialDay('2026-04-17',[{rows:twse},{rows:tpex}],[inst(twse).map(x=>({...x,date:'2026-04-16'})),inst(tpex)],allowed).ok);

// Missing ONE day's institution observation must not remove an otherwise
// valid stock PRICE from the official buffer. Otherwise the next valid stock
// row erroneously measures 2-day movement as a 1-day return.
const missingFlow=inst(twse).filter(x=>x.code!==twse[0].stock_code);
const priceOnly=b.normalizeOfficialDay('2026-04-17',[{rows:twse},{rows:tpex}],[missingFlow,inst(tpex)],allowed);
assert(priceOnly.ok&&priceOnly.rows.length===420);
const retained=priceOnly.rows.find(x=>x.market==='上市'&&x.stock_code===twse[0].stock_code);
assert.strictEqual(retained.close_price,20);assert.strictEqual(retained.total_net,null);
// A stock gap on a MARKET trading day makes 1D / 3D / 5D returns invalid.
const sparse=[
 {trade_date:'2026-04-13',stock_code:'2000',market:'上市',close_price:100,trade_value:10000,total_net:10},
 {trade_date:'2026-04-14',stock_code:'2000',market:'上市',close_price:109,trade_value:10000,total_net:10},
 {trade_date:'2026-04-15',stock_code:'2001',market:'上市',close_price:20,trade_value:10000,total_net:10},
 {trade_date:'2026-04-16',stock_code:'2000',market:'上市',close_price:119,trade_value:10000,total_net:10},
 {trade_date:'2026-04-16',stock_code:'2001',market:'上市',close_price:20,trade_value:10000,total_net:10},
];
const sparseRows=b.deriveStockFeatures(sparse),gapStock=sparseRows.find(x=>x.stock_code==='2000'&&x.trade_date==='2026-04-16');
assert.strictEqual(gapStock.change_pct,null,'one missing MARKET session cannot become a 1D return');
assert(Math.abs(gapStock.return_3_pct-19)<1e-10&&gapStock.return_5_pct===null);
assert(b.OFFICIAL_CAUSAL_FEATURE_SQL.includes('market_research500_official_calendar'));
for(const h of [1,3,5,20])assert(b.OFFICIAL_CAUSAL_FEATURE_SQL.includes(`p${h}.trade_date=c.prior_date_${h}`),`no exact market-session join for ${h}D`);

// Compare the unchanged stock-level scorer against compact SQL-like output
// over a multi-stock, missing-days, changing-flow deterministic fixture.
// The database does rolling windows and median/MAD; JavaScript still applies
// the same score. We separately benchmark the SQL with real Neon read-only.
async function validateCausalDbSideOptimization(){
 const {enrichFlowFeatures,scoreStocksForDate}=require('../lib/fundflow-xy');
 const fixture=[];
 for(let stock=0;stock<4;stock++){
  for(let i=0;i<62;i++){
   if(stock===3&&i%7===0)continue;
   const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
   fixture.push({trade_date:date,stock_code:String(2000+stock),market:stock===3?'上櫃':'上市',stock_name:`s${stock}`,
    close_price:50+stock*13+i*.12+Math.sin(i*.8+stock)*3,
    trade_value:1000000+stock*10000+i*250,trade_volume:25000,
    foreign_net:Math.round(Math.cos(i*.6+stock)*2100),trust_net:Math.round(Math.sin(i*.9)*200),
    dealer_net:Math.round(Math.sin(i*.33+stock)*350),total_net:Math.round(Math.cos(i*.6+stock)*2100)+Math.round(Math.sin(i*.9)*200)+Math.round(Math.sin(i*.33+stock)*350)});
  }
 }
 const original=enrichFlowFeatures(b.deriveStockFeatures(fixture));
 const wanted=new Set([58,59,60,61].map(i=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)));
 const baseline=original.filter(r=>wanted.has(r.trade_date));
 const compact=baseline.map(r=>({trade_date:r.trade_date,stock_code:r.stock_code,market:r.market,stock_name:r.stock_name,
  change_pct:r.change_pct,return_3_pct:r.return_3_pct,return_5_pct:r.return_5_pct,return_20_pct:r.return_20_pct,
  positive_days_5:r.positive_days_5,inst_flow_ratio_1:r.inst_flow_ratio_1,inst_flow_ratio_5:r.inst_flow_ratio_5,
  inst_flow_ratio_10:r.inst_flow_ratio_10,inst_flow_ratio_20:r.inst_flow_ratio_20,
  inst_turnover_value_20:r.inst_turnover_value_20,inst_flow_days_20:r.inst_flow_days_20,
  stock_flow_scale:r.stock_flow_scale,stock_flow_history_days:r.stock_flow_history_days}));
 const optimized=b.normalizeCausalScoringRows(compact);
 const a=scoreStocksForDate(baseline),z=scoreStocksForDate(optimized);
 assert.strictEqual(a.length,z.length);
 for(let i=0;i<a.length;i++){
  for(const col of ['stockX','stockY','stockFlowScore','stockFlowScale','stockFlowHistoryDays','stockFlowReliability','persistenceScore'])
   assert.strictEqual(a[i][col],z[i][col],`optimized scoring mismatch ${a[i].stock_code} ${a[i].trade_date} ${col}`);
  for(const col of ['inst_flow_ratio_1','inst_flow_ratio_5','inst_flow_ratio_10','inst_flow_ratio_20','return_5_pct','return_20_pct','inst_turnover_value_20','positive_days_5'])
   assert.strictEqual(a[i][col],z[i][col],`optimized feature mismatch ${a[i].stock_code} ${a[i].trade_date} ${col}`);
 }
 // Every real DB execution must request only the scored dates, not entire
 // stock-level warmup rows. The historical window is still used INSIDE SQL.
 assert(b.OFFICIAL_CAUSAL_FEATURE_SQL.includes('WHERE trade_date=ANY($3::date[])'));
 assert(b.OFFICIAL_CAUSAL_FEATURE_SQL.includes('UNBOUNDED PRECEDING AND 1 PRECEDING'));
 assert(b.OFFICIAL_CAUSAL_FEATURE_SQL.includes('PERCENTILE_CONT(0.5)'));
 const requested=[];
 const stub={query:async(sql,params)=>{requested.push({sql,params});return compact.filter(r=>params[2].includes(r.trade_date));}};
 const dates=[...wanted].sort();
 const fetched=await b.loadOfficialCausalScoringRows(stub,{warmupStart:'2026-01-01',anchor:dates.at(-1),dates:dates.slice(0,3)});
 assert.strictEqual(fetched.length,compact.length);
 assert.strictEqual(requested.length,1);
 assert.strictEqual(requested[0].params[3],20);
 assert.deepStrictEqual(requested[0].params[2],dates);
 await assert.rejects(()=>b.loadOfficialCausalScoringRows({query:async()=>[]},
  {warmupStart:'2026-01-01',anchor:dates.at(-1),dates:dates.slice(0,3)}),/official-causal-feature-dates-missing/);
 assert.throws(()=>b.normalizeCausalScoringRows([{stock_flow_scale:null,stock_flow_history_days:20,inst_flow_days_20:20}]),/official-causal-feature-invalid-scale/);
}
(async()=>{const payload=await b.fetchOfficialDay('2026-04-17',allowed,{priceFetch:[async()=>({rows:twse}),async()=>({rows:tpex})],institutionalFetch:[async()=>inst(twse),async()=>inst(tpex)]});
 assert(payload.ok&&payload.rows.length===420);
 await validateCausalDbSideOptimization();
 console.log('PASS research500 official manual: calendar, causal windows, source normalization, quality guards, storage boundaries, UI/APIs');
})().catch(e=>{console.error(e);process.exitCode=1});
