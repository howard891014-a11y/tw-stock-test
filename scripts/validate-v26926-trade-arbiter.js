#!/usr/bin/env node
'use strict';
// StockZone .26 — 使用真實發布決策原始碼；合成價格用於檢查狀態機，不冒充歷史績效。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const engine=require('../lib/unified-trade-decision');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const pkg=require('../package.json');
const p=(defense=1286,trim=1310,key='swing')=>({id:'unit-trade-1',explicitPlan:true,status:'open',startDate:'2026-10-20',
 initial:{play:'波段',playKey:key,referencePrice:1345,targets:{defense},decision:{fullStop:[defense-4,defense+4],trimStop:trim?[trim-3,trim+3]:null}} ,
 last:{targets:{defense:900},decision:{fullStop:[880,920]}}});
const rec={valid:true,signalStrength:'strong',trialPct:10,data:{vol20:2.6},support:{value:1335,lower:1329,upper:1340},
 resistance:{value:1388,lower:1380,upper:1395},entrySignals:{pullback:true,chase:false,pullNote:'測試支撐反彈',chaseNote:'測試突破尚未成立'}};
const risk={valid:true,score:32,trimTriggered:false,exitTriggered:false,summary:'測試風險正常'};
const base={price:1345,holding:true,play:{key:'swing',period:'波段',operationProfile:{basePct:60,tacticalPct:40}},
 expected:{downside:{levels:[{value:1286},{value:1200}]},plan:{levels:[{value:1550},{value:1680}]}},
 recent:rec,risk,market:{verified:true,regime:'on',warning:false},plan:p()};
const run=over=>engine.decision({...base,...over});
const tests=[];
function verify(name,fn){try{fn();tests.push({name,status:'PASS'});}catch(error){console.error('FAIL',name,error);process.exitCode=1;tests.push({name,status:'FAIL'});}}
verify('01 原始出場防守鎖定，不因現價跌破後改成1200',()=>{
 const v=run({price:1275,expected:{...base.expected,downside:{levels:[{value:1200},{value:1090}]}}});
 assert.equal(v.fullStopCenter,1286);assert.equal(v.stopSource,'trade-initial-locked');
 assert.equal(v.stopBreached,true);assert.equal(v.tradeState,'exit-warning');assert.equal(v.entryReady,false);
});
verify('02 減碼風險僅有技術警戒時不冒充現價防守',()=>{
 const v=run({plan:p(1286,null),risk:{...risk,trimTriggered:true,summary:'跌破MA10'},recent:{...rec,support:{value:1350}}});
 assert.equal(v.trimStopCenter,null);assert.equal(v.trimStopAlert,null);assert.equal(v.trimStopStatus,'technical-risk-only');
 assert.equal(v.tradeState,'trim-warning');assert(!/現價 1,345（已觸發）/.test(v.trimStopNote));
});
verify('03 兩筆原始計畫不同、同一現價也必須輸出不同出場防守',()=>{
 const a=run({plan:p(1286)}),b=run({plan:p(1200)});
 assert.equal(a.fullStopCenter,1286);assert.equal(b.fullStopCenter,1200);
 assert.equal(run({plan:{...p(1200),last:{...p(1200).last,targets:{defense:999}}}}).fullStopCenter,1200);
});
verify('04 補倉訊號遇減碼警戒不能成為可執行動作',()=>{
 const v=run({risk:{...risk,trimTriggered:true}});
 assert.equal(v.tradeState,'trim-warning');assert.equal(v.entryReady,false);
 assert.equal(v.entrySignalReady,false);assert.match(v.action,/停止補倉/);
 assert(Array.isArray(v.pullbackCandidate),'候選支撐仍應留在研究資料');
});
verify('05 空倉即使落在補倉價帶也只能按首次試單分支',()=>{
 const v=run({holding:false,plan:null});const g=engine.entryGuidance(v,1345);
 assert.equal(v.tradeState,'trial');assert.equal(g.status,'trial');assert.equal(v.entryReady,false);assert(!/補倉/.test(v.action));
});
verify('06 持股、有回測確認但未提供剩餘部位額度，不授權補倉',()=>{
 const v=run({});const g=engine.entryGuidance(v,1345);
 assert.equal(v.entrySignalReady,true);assert.equal(v.entryReady,false);assert.equal(v.addPct,null);
 assert.equal(v.tradeState,'add-pending');assert.match(g.title,/未確認/);
});
verify('07 沒有鎖定交易計畫不得把今日候選支撐當原停損',()=>{
 const v=run({plan:null});assert.equal(v.tradeState,'plan-missing');
 assert.equal(v.fullStopCenter,null);assert.equal(v.fullStop,null);assert.equal(v.researchDefense.full,1286);
});
verify('08 已有舊計畫但 original 防守遺失時不得自行補值',()=>{
 const plan=p();delete plan.initial.targets.defense;const v=run({plan});
 assert.equal(v.fullStopCenter,null);assert.equal(v.tradeState,'plan-missing');
});
verify('09 W3空頭短線出場風險優先、長線機動倉優先',()=>{
 const market={verified:true,regime:'off',warning:false};
 const short=run({play:{key:'short',period:'短線'},plan:p(1286,null,'short'),market});
 const long=run({play:{key:'long',period:'長期'},plan:p(1286,null,'long'),market});
 assert.equal(short.tradeState,'exit-warning');assert.equal(long.tradeState,'trim-warning');
 assert.match(long.action,/機動倉/);assert.equal(long.entryReady,false);
});
verify('10 原防守已失守時，不依動態技術資料判斷「可補倉」',()=>{
 const v=run({price:1275,recent:rec,expected:{...base.expected,downside:{levels:[{value:1200}]}}});
 assert.equal(v.tradeState,'exit-warning');assert.equal(v.entryReady,false);
});
verify('11 公司行動／市場資料缺口不得用於空倉進場',()=>{
 const v=run({holding:false,plan:null,recent:{...rec,valid:false}});
 assert.equal(v.tradeState,'wait');assert.equal(v.trialEligible,false);
});
verify('12 保留主要／次要共振數值，不把其當作防守',()=>{
 const v=run({});assert.equal(v.trimCenter,1550);assert.equal(v.exitCenter,1680);
 assert.notEqual(v.fullStopCenter,v.trimCenter);
});
verify('13 統一 app 讀取 initial，決策及 overview 同一物件',()=>{
 assert(app.includes('plan=holdingPlanActive(currentStockCode())'));
 assert(app.includes('plan,\n    holding:'));
 assert(app.includes('const decision=renderDecision(lockedPlay,effectiveExpected,risk)'));
 assert(app.includes('renderOverviewResonance(lockedPlay,effectiveExpected,decision,risk)'));
 assert(app.includes('stopSource:decision.stopSource||null'));
});
verify('14 介面預設只有一個主要決策，六價位為可展開研究資訊',()=>{
 assert(html.includes('id="decisionPlanSummary"'));
 assert(html.includes('<details class="sz-research-prices"><summary>展開六項研究價位'));
 assert(html.includes('id="overviewEntryVerdict"')&&html.includes('id="decisionEntryVerdict"'));
 assert(html.includes('app.js?v=2.6.9.26')&&html.includes('unified-trade-decision.js?v=2.6.9.26'));
 assert(!html.includes('id="decisionPlanSummary" data-debug'));
 assert.equal(pkg.version,'2.6.9.26');
});
console.table(tests);
if(process.exitCode)process.exit(process.exitCode);
console.log('PASS release926 guardrails: real decision code, no DB writes or real trades');
