'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const P=require('../lib/holding-trade-plans');
const R=require('../lib/holding-trade-review');
const store=()=>({v:{},getItem(k){return this.v[k]??null},setItem(k,v){this.v[k]=String(v)}});
const snap=(code='6187')=>({code,play:'波段',playKey:'swing',capturedAt:new Date().toISOString(),
  allocation:{core:55,tactical:45},targets:{main:120,secondary:135,defense:92},risk:{score:25},signal:'測試快照'});
const st=store(),code='6187';
const plan=P.create(st,code,100,1000,snap());
const initial=JSON.stringify(P.active(st,code).initial),id=plan.id;
assert.equal(P.metrics(P.active(st,code)).shares,1000);
assert.equal(P.metrics(P.active(st,code)).tradeCount,0,'期初基準不是使用者已登記的真實成交');
assert.throws(()=>P.record(st,code,{type:'add',tradeDate:'2030-01-01',shares:10,price:100}),/日期/);
assert.throws(()=>P.record(st,code,{type:'reduce',tradeDate:P.active(st,code).startDate,shares:1001,price:105}),/超過/);
assert.equal(P.active(st,code).ledger,undefined,'任何拒絕操作都不得寫入紀錄');
const day=P.active(st,code).startDate;
const tx=(type,shares,price,other={})=>P.record(st,code,{type,shares,price,tradeDate:day,...other});
const a=tx('trial',100,110,{fee:20,bucket:'tactical',note:'試單訊號'});
assert.equal(a.metrics.shares,1100);assert.equal(a.metrics.remainingCost,111020);
assert.equal(P.active(st,code).initial.targets.main,120);
assert.equal(P.active(st,code).initial.playKey,'swing');
assert.equal(P.active(st,code).ledger.trades[0].signalAtRecord.targets.main,120);
assert.equal(P.active(st,code).ledger.trades[0].bucket,'tactical');
assert.throws(()=>P.revise(st,code,99,500),/已有交易紀錄/);
assert.throws(()=>tx('reduce',1100,120),/全部售出必須選出清/);
assert.throws(()=>tx('exit',5,120),/出清必須等於/);
assert.throws(()=>tx('trial',0,100),/股數/);
assert.throws(()=>tx('trial',10,-1),/價格/);
assert.throws(()=>tx('trial',10,1e308),/安全計算範圍/);
const b=tx('add',100,120,{fee:10});
assert.equal(b.metrics.shares,1200);
const avg=b.metrics.avgCost;
const c=tx('reduce',200,125,{fee:50,tax:75});
assert.equal(c.metrics.shares,1000);assert.equal(c.metrics.tradeCount,3);
assert.equal(c.metrics.realizedGross,4495); // 平均成本精確基礎金額：123030 / 1200 = 102.525
assert.equal(c.metrics.realizedNet,Math.round((c.metrics.realizedGross-125)*100)/100);
assert.equal(P.metrics(P.active(st,code),130).unrealizedGross,Math.round((130*1000-c.metrics.remainingCost)*100)/100);
assert.throws(()=>tx('exit',1001,130),/超過/);
assert.equal(P.active(st,code).ledger.trades.length,3,'拒絕出清不得改動流水');
const end=tx('exit',1000,140,{fee:100,tax:300});
assert.equal(end.closed,true);assert.equal(end.metrics.shares,0);
assert.equal(P.active(st,code),null);
let archived=P.history(st,code);assert.equal(archived.length,1);
assert.equal(archived[0].status,'closed');assert.equal(archived[0].ledger.trades.length,4);
assert.equal(archived[0].initial.playKey,'swing');assert.equal(JSON.stringify(archived[0].initial),initial);
assert.equal(archived[0].id,id);
assert.throws(()=>tx('add',1,160),/沒有活動中的交易計畫/);
const next=P.create(st,code,150,500,snap());assert.notEqual(next.id,id);
assert.equal(P.history(st,code).length,1);
assert.equal(P.metrics(next).shares,500);
assert.equal(P.active(st,code).initial.targets.main,120);
const bad=store();bad.setItem(P.KEY,'invalid-json');assert.throws(()=>P.record(bad,code,{type:'add'}),/JSON/);
assert.equal(bad.getItem(P.KEY),'invalid-json');
// Forward evaluation: 2026-10-20 snapshot must NOT use same-date high (no hindsight).
const p={id:'audit',createdAt:'2026-10-20T07:00:00.000Z',initial:{code:'2330',playKey:'swing',
  capturedAt:'2026-10-20T07:00:00.000Z',targets:{main:120,secondary:140,defense:90}},updates:[
  {analysis:{capturedAt:'2026-10-22T07:00:00.000Z',playKey:'swing',targets:{main:125,secondary:145,defense:94},targetsStatus:'updated-from-current-resonance'}},
  {analysis:{capturedAt:'2026-10-23T07:00:00.000Z',playKey:'short',targets:{main:111},targetsStatus:'updated-from-current-resonance'}},
  {analysis:{capturedAt:'2026-10-23T07:00:00.000Z',playKey:'swing',targets:{main:160},targetsStatus:'retained-previous-no-confirmed-peak'}}
]};
const bars=[
  {date:'2026-10-20',open:100,high:145,low:98,close:100}, // same day high must be excluded
  {date:'2026-10-21',open:105,high:115,low:96,close:110},
  {date:'2026-10-22',open:110,high:121,low:91,close:110},
  {date:'2026-10-23',open:110,high:123,low:93,close:120},
  {date:'2026-10-26',open:122,high:128,low:92,close:125},
  {date:'2026-10-27',open:126,high:130,low:93,close:127}
];
let review=R.evaluate(p,bars);assert(review.valid);
assert.equal(review.initial.main.firstDate,'2026-10-22');
assert.equal(review.initial.main.firstDay,2);
assert.equal(review.initial.secondary.firstDate,null,'不能偷看同一天的145');
assert.equal(review.initial.main.horizons[0].status,'hit');
assert.equal(review.initial.secondary.horizons[0].status,'miss');
assert.equal(review.updatesWithConfirmedNewTarget,1);
assert.equal(review.latest.asOf,'2026-10-22');
assert.equal(review.latest.main.firstDay,2);
assert.equal(review.revisions.length,1);
assert.equal(review.revisions[0].byH[0].status,'pending');
assert.equal(review.latest.main.firstDate,'2026-10-26');
assert.equal(review.latest.main.horizons.find(x=>x.days===5).status,'hit');
assert.equal(R.auditTransactions({ledger:{trades:[{id:'ok',tradeDate:'2026-10-22',price:111},{id:'bad',tradeDate:'2026-10-21',price:180}]}},bars).uncertain,1);
const amb={...p,initial:{...p.initial,targets:{main:114,defense:97}}};
const issue=R.evaluate(amb,bars);assert.equal(issue.initial.sameBarAmbiguous,true);
const broken=[...bars,{date:'2026-10-28',open:200,high:205,low:190,close:200}];
assert.match(R.evaluate(p,broken).reason,/35%/);
assert.equal(R.evaluate(p,bars.slice(0,2)).initial.main.horizons[0].status,'pending');
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
for(const mark of ['data-trade-record','data-trade-type','data-trade-date','data-trade-shares','data-trade-verify','data-trade-baseline','data-trade-export','holdingTradeArchiveView','holdingTradeVerify','holdingTradeRecord','renderSimulationLedger','holdingSimulationCsv'])assert(app.includes(mark),`missing UI ${mark}`);
for(const mark of ['lib/holding-trade-review.js?v=2.6.9.17','id="holdingTradeArchive"','sz-v26915-ledger','id="szSimulationLedgerPage"','id="szSimulationSummary"'])assert(html.includes(mark));
for(const mark of ['market_business_xy2_research_daily','getSql','@neondatabase/serverless','supabase'])assert(!fs.readFileSync('lib/holding-trade-plans.js','utf8').includes(mark),'ledger must not access DB');
console.log('PASS SZ 2.6.9.15: manual trades, average-cost P&L, dates, fees, oversell, locked strategy, exit archive, forward no-leak target verification, split guard, UI wiring');
