'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const vm=require('node:vm');
const engine=require('../lib/resonance-lab-v1.js');
const app=fs.readFileSync('app.js','utf8');
const lab=fs.readFileSync('lib/resonance-lab-v1.js','utf8');
const version=require('../package.json').version;
assert.equal(version,'2.7.0.48');
function slice(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,`source anchor missing ${start}`);return source.slice(a,b)}
function sha(body){return crypto.createHash('sha256').update(body).digest('hex')}
// Protected math and source normalization are byte-identical to v2.7.0.45.
const frozen={
  '  function cleanBars(':['  function avg(values)','e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1'],
  '  function simulateTrade(':['  function summarise(','8889397b4c582deac050a9928c1ad2bbbea9568c43a7a7383e21699e42411d12'],
};
for(const [start,[end,hash]] of Object.entries(frozen))assert.equal(sha(slice(lab,start,end)),hash);
const base=[];let day=new Date('2021-10-01T00:00:00Z');
while(base.length<1211){if(day.getUTCDay()!==0&&day.getUTCDay()!==6){const close=100+.055*base.length;base.push({date:day.toISOString().slice(0,10),open:close-.1,high:close+.8,low:close-.8,close});}day.setUTCDate(day.getUTCDate()+1)}
const pure=JSON.stringify(base);
const oldGood=engine.cleanBars(base);assert(oldGood.valid);
const fresh=engine.recentAllocationContext(base);assert(fresh.valid);
assert.equal(JSON.stringify(fresh),JSON.stringify(engine.contextAt(oldGood.bars,oldGood.bars.length-1)));
// Long Evergreen 2023 cash dividend: no new OHLC math; old jump stays
// reported in R1 and is excluded there, while recent 120 bars remain usable.
const oldJump=base.map(b=>({...b}));for(let i=550;i<oldJump.length;i++)for(const k of ['open','high','low','close'])oldJump[i][k]*=2.09;
assert.equal(engine.cleanBars(oldJump).valid,false);
assert.equal(engine.backtestPriceBaselines(oldJump).coverage.quality,'partial');
const recent=engine.recentAllocationContext(oldJump);assert(recent.valid,'old corporate action cannot suppress current price context');
assert.equal(recent.date,oldJump.at(-1).date);
assert(Number.isFinite(recent.ma120));
assert.equal(JSON.stringify(base),pure,'history source untouched');
// Recent price gaps and malformed rows still fail closed.
const badJump=base.map(b=>({...b}));for(let i=base.length-50;i<badJump.length;i++)for(const k of ['open','high','low','close'])badJump[i][k]*=2.09;
assert.equal(engine.recentAllocationContext(badJump).valid,false);
assert.match(engine.recentAllocationContext(badJump).reason,/近期120日.*跳變/);
const badOHLC=base.map(b=>({...b}));badOHLC.at(-20).low=badOHLC.at(-20).high+2;
assert.equal(engine.recentAllocationContext(badOHLC).valid,false);
assert.match(engine.recentAllocationContext(badOHLC).reason,/OHLC/);
const olderOHLC=base.map(b=>({...b}));olderOHLC[330].low=olderOHLC[330].high+2;
assert(engine.recentAllocationContext(olderOHLC).valid,'ancient malformed OHLC does not taint recent 120');
const invalidToday=base.map(b=>({...b}));invalidToday.at(-1).high=0;
assert(!engine.recentAllocationContext(invalidToday).valid,'latest malformed bar must not fall back silently to yesterday');
const undated=base.map(b=>({...b}));undated[100].date='';
assert(!engine.recentAllocationContext(undated).valid,'undated error cannot be ruled historical');
assert(!engine.recentAllocationContext(base.slice(0,119)).valid,'120 is still required for current price context');
// Canonical W3 source: use existing live W3 data, not DOM, R1, or stock bars.
const w3Code=slice(app,'function stockzoneW3Regime(){','function fundflowPathState(')+
  slice(app,'function marketStableTradeDate(){','// v2.7.0.46 — Canonical W3 feed')+
  slice(app,'// v2.7.0.46 — Canonical W3 feed','function renderMarketDistribution(');
const today=new Date().toISOString().slice(0,10);
const w3Scope={window:{},marketDynamicData:null,Date};vm.createContext(w3Scope);vm.runInContext(w3Code,w3Scope);
const mkState=(regime,opts={})=>({latest:{date:today,w3Regime:regime,institutionalComplete:true},history:[],w3:{regime,warning:!!opts.warning,isLiveModel:opts.live!==false,stale:!!opts.stale,records:[{date:today,regime,valid:true,status:'computed'}]}});
w3Scope.marketDynamicData=mkState('RiskOff');
assert.equal(w3Scope.window.StockZoneGetOfficialW3().value,'off');
w3Scope.marketDynamicData=mkState('RiskOn',{warning:true});assert.equal(w3Scope.window.StockZoneGetOfficialW3().value,'warning');
w3Scope.marketDynamicData=mkState('RiskOn');assert.equal(w3Scope.window.StockZoneGetOfficialW3().value,'on');
w3Scope.marketDynamicData=mkState('RiskOff',{stale:true});assert.equal(w3Scope.window.StockZoneGetOfficialW3().value,'unknown');
w3Scope.marketDynamicData=mkState('RiskOn',{live:false});assert.equal(w3Scope.window.StockZoneGetOfficialW3().value,'unknown');
w3Scope.marketDynamicData=null;assert.equal(w3Scope.window.StockZoneGetOfficialW3().value,'unknown');
// The actual allocation renderer must take independently validated price
// context and canonical W3, with no historical .valid dependency.
const getMarketSource=slice(lab,'    function getMarket(){','    const css = `');
const rendererSource=slice(lab,'    function selectedPlay(plan,code) {','    function queue(){');
function runRender({ctx=recent,regime='off',w3Date=ctx?.date||today,play='long',code='2603'}={}){
 const root={StockZoneGetOfficialW3:()=>({value:regime,date:w3Date,source:'W3-D.1.2正式大盤快照'}),
   StockZoneHoldingPlans:{active:()=>null},localStorage:{getItem:()=>null},StockZoneDynamicAllocation:null,
   dispatchEvent:()=>{},CustomEvent:class{constructor(type,data){this.type=type;this.data=data}}};
 const ui={innerHTML:''};const scope={root,api:{...engine,getCurrentFiveYearPlay:()=>({status:'reference',referenceKey:play,referenceReason:'歷史價格異常跳過，僅供參考'})},
   init:()=>ui,codeNow:()=>code,st:{code,barsCode:code,recentContext:ctx},
   snapshotNow:()=>null,holdingBasis:()=>null,byId:id=>({szV4Candidate:{textContent:'配置基準｜核心 65%／機動 35%'}}[id]||{}),
   fmt:x=>String(x),money:x=>String(x),esc:x=>String(x),Date};
 vm.createContext(scope);vm.runInContext(getMarketSource+rendererSource+'\nrender()',scope);
 return {html:ui.innerHTML,allocation:root.StockZoneDynamicAllocation};
}
const off=runRender({});
assert.match(off.html,/空頭環境/);assert.doesNotMatch(off.html,/W3尚未確認/);
assert(off.allocation?.study?.valid,'stale historic anomaly still computes current allocation');
assert.equal(off.allocation.study.market,'off');
assert.equal(off.allocation.study.tacticalPct,0,'official W3 off risk behavior unchanged');
const recentFail=runRender({ctx:engine.recentAllocationContext(badJump),w3Date:today});
assert.match(recentFail.html,/空頭環境/,'old recent OHLC failure must not relabel known W3 as unknown');
assert.match(recentFail.html,/近期120日存在未校正價格跳變/);
assert(!recentFail.allocation,'do not publish an allocation with invalid recent bars');
const lag=runRender({ctx:recent,w3Date:'2021-01-04'});
assert.match(lag.html,/空頭環境/);assert.match(lag.html,/日期差距超過7日/);assert(!lag.allocation);
const none=runRender({ctx:recent,regime:'unknown'});
assert.match(none.html,/W3尚未確認/);assert(none.allocation?.study?.requiresW3);
// Stock switch must not wipe freshly computed current-stock context: this
// previously occurred when a queued render saw st.code still pointing old.
const wrapperSource=slice(lab,'    const originalClean=api.cleanBars;','    if(doc.readyState===');
let activeCode='2603';const state={code:'',barsCode:'',recentContext:{valid:false},pending:null};let updates=0;
const wrapperScope={api:{cleanBars:engine.cleanBars,recentAllocationContext:engine.recentAllocationContext},
  st:state,codeNow:()=>activeCode,queue:()=>{updates++}};
vm.createContext(wrapperScope);vm.runInContext(wrapperSource,wrapperScope);
wrapperScope.api.cleanBars(oldJump);
assert.equal(state.code,'2603');assert.equal(state.barsCode,'2603');assert(state.recentContext.valid);
activeCode='4919';wrapperScope.api.cleanBars(badJump);
assert.equal(state.code,'4919');assert.equal(state.barsCode,'4919');assert(!state.recentContext.valid);
assert.equal(updates,2);
// One official W3 refresh event, independent of historical quality.
assert(app.includes("window.dispatchEvent(new Event('stockzone:w3-current'))"));
assert(lab.includes("root.addEventListener?.('stockzone:w3-current',queue)"));
assert(!lab.includes("st.bars=res.valid?res.bars:[]"));
assert(!lab.includes("getMarket(ctx?.date||'')"));
console.log('PASS v2.7.0.48: historical jumps excluded only from five-year R1; current 120K context independently valid, stale/unknown W3 fail closed, current official W3 remains visible, OFF actions intact');
