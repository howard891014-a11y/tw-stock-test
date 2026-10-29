'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const text=filename=>fs.readFileSync(path.join(root,filename),'utf8');
const lib=text('lib/resonance-lab-v1.js'),app=text('app.js'),html=text('index.html');
const version=require('../package.json').version,api=require('../lib/resonance-lab-v1.js');
assert.equal(version,'2.7.0.14');
for(const phrase of ['stockzone-version" content="2.7.0.14','v2.7.0.14</span>','resonance-lab-v1.js?v=2.7.0.14','app.js?v=2.7.0.14'])assert(html.includes(phrase),phrase);
for(const key of ['selectFiveYearPlay','backtestPriceBaselines','recentPlayStudy','proposeAllocation','prioritizeTacticalAllocation'])assert.equal(typeof api[key],'function',key);
assert(lib.includes('#playStyleCard #szLabIntegrated{display:none!important}'),'v2.7.0.12 simple main card must remain');
assert(lib.includes('szs-pair')&&lib.includes('szs-targets')&&lib.includes('szs-recent-grid'),'playstyle main card preserved');
assert(lib.includes('五年回測績效')&&lib.includes('歷史價格研究對照'),'history and backtest present');
assert(!lib.includes('id="szLabAllocationApply"'),'manual confirmation button must be removed');
assert(!app.includes('const approved=window.StockZoneResonanceLab?.approvedAllocationForCode'),'cannot modify resonance by research allocation');
assert(!lib.includes('const approved=api.approvedAllocationForCode?.(code)||null'),'simple main allocation cannot read approved values');
assert(lib.includes("HOLDINGS_KEY='stockzone_holdings_v2'"),'read the actual holdings key');
assert(lib.includes('root.StockZoneHoldingPlans?.active?.(root.localStorage,code)'),'official plan source');
assert(lib.includes('StockZoneDynamicAllocation=study.valid'),'dynamic, no manual confirmation');
assert(lib.includes('核心倉：')&&lib.includes('機動倉：'),'money display');
const hashes=[
 ['  function backtestPriceBaselines(','  function reachabilityProfile(','eb25b529b4f9015ac2188adf841ebedb5e297ddd7721a333518aa849beff04ea'],
 ['  function cleanBars(','  function avg(values)','e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1']
];
for(const [a,b,expected] of hashes){const i=lib.indexOf(a),j=lib.indexOf(b,i);assert(i>=0&&j>i,a);assert.equal(crypto.createHash('sha256').update(lib.slice(i,j)).digest('hex'),expected,`original R1 formula ${a}`)}
const ctx={valid:true,price:90,ma20:100,ma60:105,ma120:110,ret20Pct:-12,volatilityPct:7};
assert.deepEqual([api.proposeAllocation({play:'swing',baseCorePct:65,context:ctx,market:'on'}).corePct,api.proposeAllocation({play:'swing',baseCorePct:65,context:ctx,market:'on'}).cashPct],[50,30]);
for(const key of ['short','mixed','swing','long-swing','long']){
 const off=api.proposeAllocation({play:key,baseCorePct:65,context:ctx,market:'off'});
 assert.strictEqual(api.prioritizeTacticalAllocation(off),off,'W3 OFF must remain exactly original');
}
// Selection: real locked plan > legacy lab plan > R1 > no qualified.
const start=lib.indexOf('    function selectedPlay(plan,code) {'),end=lib.indexOf('    function render(){',start);
assert(start>0&&end>start);
const select=vm.runInNewContext(lib.slice(start,end)+'\nselectedPlay',{
 root:{localStorage:{},StockZoneHoldingPlans:{active:()=>({initial:{playKey:'long-swing'}})}},api:{getCurrentFiveYearPlay:()=>({status:'selected',key:'swing'})}});
assert.equal(select(null,'2330'),'long-swing');
const selectNew=vm.runInNewContext(lib.slice(start,end)+'\nselectedPlay',{
 root:{localStorage:{},StockZoneHoldingPlans:{active:()=>null}},api:{getCurrentFiveYearPlay:()=>({status:'selected',key:'swing'})}});
assert.equal(selectNew(null,'2330'),'swing');
const selectNone=vm.runInNewContext(lib.slice(start,end)+'\nselectedPlay',{
 root:{localStorage:{},StockZoneHoldingPlans:{active:()=>null}},api:{getCurrentFiveYearPlay:()=>({status:'no-qualified'})}});
assert.equal(selectNone(null,'2330'),null);
// v2.7.0.13 was broken because it moved `if(root...)` inside factory. No root-dependent UI in factory.
const factory=lib.slice(lib.indexOf("function () {\n  'use strict';"));
assert(!factory.includes('sz2713LayoutStyle'),'v2.7.0.13 fatal injected code must not persist');
assert(lib.indexOf('sz2714Style') < lib.indexOf("if (typeof module === 'object' && module.exports) module.exports = api;"),'new display code outside factory');
console.log('PASS v2.7.0.14: restored original R1, recent, W3 and simple card; money-based plan; no resonance coupling');
