'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const vm=require('node:vm');
const api=require('../lib/resonance-lab-v1.js');
const lib=fs.readFileSync(require.resolve('../lib/resonance-lab-v1.js'),'utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const pkg=require('../package.json');
assert.equal(pkg.version,'2.7.0.38');
for(const p of ['stockzone-version" content="2.7.0.38','v2.7.0.38</span>','resonance-lab-v1.js?v=2.7.0.38','app.js?v=2.7.0.38'])assert(html.includes(p),p);
assert(app.includes("modelVersion:'v2.7.0.38"));
const make=(key,count,win,avg,median,mae)=>({strategy:api.STRATEGIES.find(s=>s.key===key),stats:{count,winPct:win,avgPct:avg,medianPct:median,avgMaePct:mae}});
const report=rows=>({valid:true,coverage:{signals:rows[0]?.stats.count||0},results:rows});
const xintang=report([
 make('short',18,44.4,-.18,-.7,-3.49),make('mixed',18,44.4,-.31,-5.74,-5.81),
 make('swing',18,44.4,1.62,-2.56,-6.28),make('long-swing',18,44.4,1.82,-2.60,-9.17),
 make('long',18,44.4,-2.23,-6.38,-12.3)
]);
const ref=api.classifyFiveYearPlay(xintang);
assert.equal(ref.status,'reference');
assert.equal(ref.displayLabel,'波段（參考）'); // Same original R1 avgPct / |avgMaePct| ranking, but no eligibility filter.
assert.equal(ref.referenceKey,'swing');
assert.equal(ref.referenceCount,18);
assert.equal(ref.days,20);
assert.match(ref.referenceReason,/勝率 44.4%/);
assert.match(ref.referenceReason,/中位數 -2.56%/);
assert.equal(api.selectFiveYearPlay(xintang).key,null,'formal eligibility remains unchanged');
const young=report([
 make('short',6,100,3.05,3.5,-2.08),make('mixed',6,83.3,8.01,9.5,-3.26),
 make('swing',6,100,14.17,14.5,-3.4),make('long-swing',6,100,22.87,22.5,-3.4),
 make('long',6,100,29.5,29.5,-3.4)
]);
const youngRef=api.classifyFiveYearPlay(young);
assert.equal(youngRef.status,'reference');assert.equal(youngRef.displayLabel,'長期（參考）');
assert.equal(youngRef.referenceKey,'long');assert.match(youngRef.referenceReason,/有效樣本 6 筆/);
const allBad=api.classifyFiveYearPlay(report(api.STRATEGIES.map((s,i)=>make(s.key,18,20+i*3,-8+i,-12,-9))));
assert.equal(allBad.status,'reference');assert.equal(allBad.displayLabel,'長期（參考）');
assert.match(allBad.referenceReason,/平均淨報酬/);
for(const count of [1,2,3,9]){
 const few=api.classifyFiveYearPlay(report(api.STRATEGIES.map((s,i)=>make(s.key,count,20+i,-8+i,-12,-9))));
 assert.equal(few.status,'reference');assert.equal(few.referenceCount,count);
 assert.match(few.referenceReason,/正式需至少10筆/);
}
const zero=api.classifyFiveYearPlay(report(api.STRATEGIES.map(s=>make(s.key,0,0,0,0,0))));
assert.equal(zero.status,'insufficient-history');assert.equal(zero.referenceKey,undefined);
assert.equal(api.classifyFiveYearPlay({valid:false,reason:'日K異常跳變'}).status,'invalid');
const eligible=report([
 make('short',18,38.9,-.66,-4,-3.79),make('mixed',18,44.4,-.62,-6.05,-5.55),
 make('swing',18,50,.23,-4.46,-7.44),make('long-swing',18,55.6,3.63,1.62,-9.94),
 make('long',18,44.4,3.97,-4.02,-12.48)
]);
assert.equal(api.classifyFiveYearPlay(eligible).status,'selected');
assert.equal(api.classifyFiveYearPlay(eligible).displayLabel,'長波');
function shaBetween(start,end){const i=lib.indexOf(start),j=lib.indexOf(end,i);assert(i>=0&&j>i);return crypto.createHash('sha256').update(lib.slice(i,j)).digest('hex')}
assert.equal(shaBetween('  function backtestPriceBaselines(','  function reachabilityProfile('),'eb25b529b4f9015ac2188adf841ebedb5e297ddd7721a333518aa849beff04ea');
assert.equal(shaBetween('  function cleanBars(','  function avg(values)'),'e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1');
// Real R1 report is identical for selected and reference; only classification/UI changes.
assert.equal(api.backtestPriceBaselines,require('../lib/resonance-lab-v1.js').backtestPriceBaselines);
// Exercise the actual selectedPlay + render functions in a controlled browser-like VM.
const start=lib.indexOf('    function selectedPlay(plan,code) {');
const end=lib.indexOf('    function queue(){',start);
assert(start>0&&end>start);
function dynamicCase(p,locked=false,holding=true){
 const output={innerHTML:''};
 const root={localStorage:{},StockZoneHoldingPlans:{active:()=>locked?{initial:{playKey:'long'}}:null},
  CustomEvent:class {constructor(type,data){this.type=type;this.data=data}},dispatchEvent(){},StockZoneDynamicAllocation:null};
 const ctx={valid:true,price:100,ma20:105,ma60:108,ma120:115,ret20Pct:-4,volatilityPct:3,date:'2026-10-30'};
 const scope={root,api:{...api,getCurrentFiveYearPlay:()=>p,contextAt:()=>ctx},
  init:()=>output,codeNow:()=> '4919',st:{code:'4919',barsCode:'4919',bars:Array(130).fill({})},
  snapshotNow:()=>null,byId:id=>({szV4Candidate:{textContent:'核心 65%／機動 35%'}}[id]||{}),
  holdingBasis:()=>holding?{qty:1000,cost:100,total:100000,core:65,currentCoreMoney:65000}:null,
  getMarket:()=>({value:'on',date:'2026-10-30'}),fmt:x=>String(x),money:x=>Math.round(x).toString(),
  esc:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
 const render=vm.runInNewContext(lib.slice(start,end)+'\nrender',scope);
 render();return {html:output.innerHTML,alloc:root.StockZoneDynamicAllocation};
}
for(const p of [ref,youngRef,allBad,api.classifyFiveYearPlay(eligible)]){
 const {html,alloc}=dynamicCase(p);
 assert(html.includes('<b>動態倉位配置</b>'),'same title for selected and reference');
 assert(html.includes('szla-bars'),'reference must receive real core/tactical/cash bar');
 assert(html.includes('建議倉位（金額）'),'reference must not suppress money and adjustments');
 assert(html.includes('建議減碼')||html.includes('建議加碼')||html.includes('不需調整'));
 assert(alloc.study.valid&&alloc.actions,'reference must expose the same proposed allocation actions');
 assert.equal(alloc.reference,p.status==='reference');
 if(p.status==='reference')assert(html.includes('調整原因：</b><span>標示參考：'),'reason in adjustment row');
 else assert(!html.includes('標示參考：'));
 assert(!html.includes('研究參考：'),'no redundant warning in W3 regime');
}
const noHold=dynamicCase(youngRef,false,false);
assert(noHold.html.includes('szla-bars'),'no holdings continues to get percentage research bars');
const lock=dynamicCase(ref,true);
assert.equal(lock.alloc.study.play,'long','locked play still takes precedence');
assert.equal(lock.alloc.reference,false,'different locked play must not be mislabeled reference');
// Main-card note/action must not turn off the ordinary play flow for reference candidates.
assert(app.includes("['selected','reference'].includes(p?.status)"));
assert(!lib.includes('actions:isReference?null:planActions'));
assert(!lib.includes('if(isReference||holding.referenceOnly)'));
console.log('PASS v2.7.0.38: formal R1 unchanged; qualified / rejected / short-sample / zero-sample / invalid; reference UI follows normal allocation & monetary actions, clear reason only in adjustment, locked plans untouched');
