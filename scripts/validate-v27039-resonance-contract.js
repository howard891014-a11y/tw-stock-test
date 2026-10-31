'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const api=require('../lib/resonance-lab-v1.js');
const pkg=require('../package.json');
const app=fs.readFileSync('app.js','utf8');
const lab=fs.readFileSync('lib/resonance-lab-v1.js','utf8');
const html=fs.readFileSync('index.html','utf8');
assert(/^2\.7\.0\.\d+$/.test(pkg.version));
const version=pkg.version;
assert(html.includes(`stockzone-version" content="${version}"`));
assert(html.includes(`v${version}</span>`));
assert(html.includes(`resonance-lab-v1.js?v=${version}`));
assert(html.includes(`app.js?v=${version}`));
assert(!html.includes('id="szLabLive"'), 'removed legacy element must remain unnecessary');
assert(!/txt\('szLabLive'\)/.test(lab),'no hidden DOM parsing for live prices');
assert(!/String\(\$\('szLabReach'\)\?\.textContent/.test(lab),'no hidden DOM parsing for reach rates');
assert(lab.includes("root.addEventListener('stockzone:resonance-live',queue)"));
assert(lab.includes("root.addEventListener?.('stockzone:resonance-live',schedule)"));
const section=(s,start,end)=>{const i=s.indexOf(start),j=s.indexOf(end,i+start.length);assert(i>=0&&j>i,`${start} missing`);return s.slice(i,j)};
const valuesFn=vm.runInNewContext(section(app,'function szLabValues(','function szLabFmt(')+'\nszLabValues',{
  positionNumber:v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):null,
  szLabCurrentDate:()=> '2026-10-30'});
const root={StockZoneResonanceLab:{liveResonance:null}};
const currentCode={value:'4919'};
const targetFn=vm.runInNewContext(section(lab,'    function targets(){','    // v2.7.0.5')+'\ntargets',{
  root,getCode:()=>currentCode.value,money:x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):null,
});
const reachFn=vm.runInNewContext(section(lab,'    function reachInfo(){','    function explain(')+'\nreachInfo',{
  el:()=>({textContent:currentCode.value}),api:root.StockZoneResonanceLab,
});
const numbers={price:132,main:164,secondary:205,pullback:109,defense:106};
// Real computation model surfaces targets to chart + UI, not a handwritten UI fallback.
const expected={price:132,plan:{resonance:{main:{center:164},secondary:{center:205}},levels:[{value:164},{value:205}]},downside:{levels:[{value:109},{value:106}]}};
const v=valuesFn({key:'swing',operationProfile:{basePct:40}},expected,null,null);
for(const key of Object.keys(numbers))assert.equal(v[key],numbers[key]);
const emitted=[];
const stock={code:'4919'};
const labApi={
  cleanBars:()=>({valid:true,bars:Array(130).fill({date:'2026-01-01',close:132})}),
  entryCandidate:()=>({valid:false}),
  reachabilityProfile:(bars,price,target)=>({valid:true,distancePct:Math.round((target/price-1)*1000)/10,
    sample:18,horizons:[{days:20,hitPct:target===164?5.6:target===205?0:33.3},
      {days:40,hitPct:target===164?16.7:target===205?5.6:33.3}]})
};
Object.assign(root.StockZoneResonanceLab,labApi);
const nodes=new Map();
function getNode(id){if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},disabled:false});return nodes.get(id)}
const windowStub={StockZoneResonanceLab:root.StockZoneResonanceLab,dispatchEvent:e=>emitted.push(e.type)};
const renderScope={window:windowStub,Event:class{constructor(type){this.type=type}},
  currentStockCode:()=>stock.code, szLabCachedExpected:null,szLabCachedRisk:null,szLabCachedDecision:null,
  szLabRecent:null,szLabLastStock:'4919',szLabLastBacktest:null,szLabReportCode:'',
  szLabValues:valuesFn,szLabBars:()=>Array(130).fill({date:'2026-01-01',close:132}),
  szLabActive:()=>null,szLabRead:()=>({}),szLabFmt:v=>String(v),
  szLabPlanText:x=>JSON.stringify(x),szLabSetMessage:()=>{},
  $:id=>getNode(id),setText:(id,value)=>{getNode(id).textContent=value},
};
const renderFn=vm.runInNewContext(section(app,'function renderResonanceLab(','$(\'szSaveResearchSnapshot\')')+'\nrenderResonanceLab',renderScope);
renderFn({key:'swing',operationProfile:{basePct:40}},expected,null,null);
assert.deepEqual(JSON.parse(JSON.stringify(root.StockZoneResonanceLab.liveResonance.values)),numbers);
assert.equal(root.StockZoneResonanceLab.liveResonance.code,'4919');
assert.equal(root.StockZoneResonanceLab.liveResonance.reachByType.主要.h20,5.6);
assert.equal(root.StockZoneResonanceLab.liveResonance.reachByType.主要.h40,16.7);
assert.equal(root.StockZoneResonanceLab.liveResonance.reachByType.次要.h20,0);
assert.equal(root.StockZoneResonanceLab.liveResonance.reachByType.回測.h20,33.3);
assert(emitted.includes('stockzone:resonance-live'));
Object.assign(root.StockZoneResonanceLab,labApi);
assert.deepEqual(JSON.parse(JSON.stringify(targetFn())),{main:164,secondary:205,pullback:109,defense:106});
const rates=reachFn();assert.equal(rates.主要.h20,5.6);assert.equal(rates.次要.h40,5.6);
// A different stock must never inherit 4919's values before its own model output arrives.
currentCode.value='2382';
assert.deepEqual(JSON.parse(JSON.stringify(targetFn())),{main:null,secondary:null,pullback:null,defense:null});
assert.deepEqual(JSON.parse(JSON.stringify(reachFn())),{});
// Even for the same stock missing secondary/defense, the UI must leave blanks, not fill synthetic numbers.
stock.code='2382';root.StockZoneResonanceLab.liveResonance={code:'2382',values:{main:150,secondary:null,pullback:null,defense:null},reachByType:{主要:{h20:8,h40:13}}};
assert.deepEqual(JSON.parse(JSON.stringify(targetFn())),{main:150,secondary:null,pullback:null,defense:null});
assert.equal(reachFn().主要.h20,8);
assert(!/return\s*\{main:[^}]*\|\|\s*\d/.test(lab));
const originalApi=require('../lib/resonance-lab-v1.js');
assert.equal(originalApi.reachabilityProfile,api.reachabilityProfile);
console.log('PASS .39: canonical resonance targets and reach, matched across chart and play; stale-stock isolation; missing-data safety; event-driven refresh');
