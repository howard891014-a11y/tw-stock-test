'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');const old=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return{neon:()=>{throw Error('No Neon in test')}};return old.call(this,id,parent,isMain)};
const mod=require('../lib/research-corporate-actions');Module._load=old;
assert.equal(mod.START,'2025-02-25');assert.equal(mod.END,'2026-10-14');
assert.equal(mod.calendarDate('114年08月26日'),'2025-08-26');
assert.equal(mod.calendarDate('115/09/02'),'2026-09-02');
assert.equal(mod.calendarDate('20260826'),'2026-08-26');
const cols=['資料日期','股票代號','股票名稱','除權息前收盤價','除權息參考價','權/息'];
const x=mod.parseListed({fields:cols,data:[['115年08月26日','6914','阜爾運通','148.5','121.5','息']]},'上市','ex','TWSE TWT49U');
assert.equal(x.length,1);assert.equal(x[0].trusted_basic,true);assert.equal(x[0].trade_date,'2026-08-26');
const y=mod.parseListed({fields:cols,data:[['115年08月26日','6944','some','1030','829','權']]},'上市','ex','TWSE TWT49U');
assert.equal(y.length,1);assert.equal(y[0].requires_review,true);assert.equal(y[0].trusted_basic,false);
const z=mod.parseListed({fields:['恢復買賣日期','股票代號','名稱','停止買賣前收盤價','恢復買賣參考價','減資原因'],data:[['115/09/01','2520','example','120','150','彌補虧損']]},'上市','reduction','TWSE TWTAUU');
assert.equal(z[0].requires_review,true);assert.equal(z[0].kind,'reduction');
const cash=mod.normalizeTpexExRow(['115/09/01','1234','X','70','60','10','0','10','權','70','50','60','60','0','0','3','20']);
assert.equal(cash.requires_review,true);assert.equal(cash.kind,'rights_offering');
assert.throws(()=>mod.parseListed({stat:'OK'},'上市','ex','bad'),/official-schema-invalid/);
assert.throws(()=>mod.parseTpex({stat:'OK'},'ex','bad'),/official-schema-invalid/);
const validMonths=mod.monthsBetween();assert.equal(validMonths.at(0),'2025-02');assert.equal(validMonths.at(-1),'2026-10');assert.equal(validMonths.length,21);
const p=new Map();for(const [d,stock,close] of [['2026-08-26','6914',121.5],['2026-08-25','6914',148.5],['2026-08-19','6914',148.5],['2026-08-26','1513',166],['2026-08-25','1513',165.5],['2026-08-19','1513',164]])p.set(`${d}/上市/${stock}`,close);
const r=mod.reconstructTagDay({day:'2026-08-26',previousDay:'2026-08-25',dayMinus5:'2026-08-19',prices:p,events:[x[0]],memberRows:[{market:'上市',stock_code:'6914',weight:1},{market:'上市',stock_code:'1513',weight:0.2}]});
assert(Math.abs(r.old1-(-15.1011626842))<.01);assert(Math.abs(r.new1-0.050352)<.01);
assert.equal(mod.priceReturn(121.5,148.5,[]),-18.181818181818176);
assert(Math.abs(mod.priceReturn(121.5,148.5,[x[0]]))<1e-9);
const plan=mod.planAffectedDates(['2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-02'],[x[0]]);
assert.equal(plan.size,5);assert(plan.has('2026-09-01'));assert(!plan.has('2026-09-02'));
(async()=>{
 const noFetch=async()=>({ok:false});
 const result=await mod.fetchOfficialMonth('2026-08',{fetcher:noFetch});
 assert.equal(result.ok,false);assert(result.errors.length>0);
 const mock=async url=>({ok:true,json:async()=>url.includes('tpex.org.tw')?
  {stat:'ok',date:'20260801~20260831',tables:[{fields:url.includes('/revivt')?['恢復買賣日期','股票代號','最後交易日之收盤價格','減資恢復買賣開始日參考價格']:['除權息日期','代號','除權息前收盤價','除權息參考價'],data:[]}]}:
  {stat:'OK',fields:cols,data:[]}});
 const yes=await mod.fetchOfficialMonth('2026-08',{fetcher:mock});
 assert.equal(yes.ok,true);assert.equal(yes.sources.length,5);
 console.log('PASS v2.6.7.17: official action parsers, split/reduction/rights guards, 5D window, price adjustment, source fail-closed');
})().catch(e=>{console.error(e);process.exitCode=1});
