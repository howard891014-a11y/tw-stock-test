'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const recent=require('../lib/recent-play-advice.js');
const history=Array.from({length:70},(_,i)=>({close:98+i*.05}));
const base={price:101.45,technical:{latest:{date:'2026-10-27'},
  ma:{ma5:100.3,ma10:99.4,ma20:99,ma60:94},
  momentum:{histogram:0.4,rsi14:58},
  volume:{ratio20:1.10},bollinger:{lower:96,middle:99,upper:107},history},
  kd:{k:63,d:59},supports:[{label:'回測支撐',value:99}],
  resistances:[{label:'上方壓力',value:118}],institution:{label:'法人偏多'},financing:{label:'籌碼健康'}};
let out=recent.evaluate(base);
assert.equal(out.valid,true);assert.equal(out.mode,'波段優先');assert.equal(out.trialPct,20);assert.match(out.add,/118/);assert.match(out.stop,/99/);
assert.equal(out.data.vol20!==null,true,'歷史日K需算出波動率');
assert.equal(recent.evaluate({...base,price:105}).trialPct,10,'波動條件正常但離支撐較遠才試單縮比例；仍需在6.5%內');
assert.equal(recent.evaluate({...base,price:117.9}).trialPct,0,'接近壓力，不能追價');
assert.equal(recent.evaluate({...base,technical:{...base.technical,ma:{ma20:null}}}).trialPct,null,'缺少核心指標不能給假比例');
assert.equal(recent.evaluate({...base,financing:{label:'籌碼偏弱'}}).trialPct,0,'融資警戒時不提供試單');
assert.equal(recent.evaluate({...base,technical:{...base.technical,momentum:{histogram:-1,rsi14:45}}}).trialPct,0,'MACD轉弱不得當作立即試單');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const h=fs.readFileSync(path.join(root,'index.html'),'utf8');
// 原本共振家族/連續高斯演算法，不可移除或換成統計 B。
for(const marker of ['function resonanceContinuousPeaks(','resonanceDistanceDecay(','add("shortwave"','add("pressure"','add("swing"','add("broker"','add("valuation"'])
  assert.ok(app.includes(marker),`原始共振家族/公式消失 ${marker}`);
assert.ok(!h.includes('id="expectedTarget3"'),'第三個樂觀目標不得再顯示');
assert.match(h,/id="expectedTarget1"[^>]*>\s*<span id="expectedT1Label">主要共振/);
assert.match(h,/id="expectedTarget2"[^>]*>\s*<span id="expectedT2Label">次要共振/);
assert.match(h,/\.\/lib\/recent-play-advice\.js\?v=2\.6\.9\.11/);
for(const id of ['recentPlayMode','recentPlayTrial','recentPlayPct','recentPlayEntry','recentPlayAdd','recentPlayStop','recentPlayEvidence'])assert.ok(h.includes(`id="${id}"`),`近期操作缺少 ${id}`);
assert.ok(!app.includes('??latestValuationScenario?.F);\n  const mainTitle'),'圖表不能拿估值代替次要共振');
const code=app.slice(app.indexOf('function buildResonanceTargets('),app.indexOf('function uniqueDownsideTargets('));
function testPeaks(peaks){
 const context={positionNumber:n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n):null,
   resonanceClamp:(n,mi=0,ma=100)=>Math.min(ma,Math.max(mi,n)),resonanceSourceRelevance:()=>80,
   resonanceBandwidthPct:()=>4,preferredMainTarget:()=>null,targetBasis:()=>null,resonanceBrokerQuality:()=>60,
   latestValuationScenario:null,resonanceValuationQuality:()=>60,latestTechnicalForPlay:{},stageNum:()=>null,
   fundamentalResonanceAdjustment:()=>({points:0}),resonanceContinuousPeaks:()=>peaks,
   resonanceStrengthLabel:()=> '中度共振'};
 vm.createContext(context);vm.runInContext(code,context);
 return context.buildExpectedPlan({key:'swing',shortEngine:{pressureTargets:[{value:112,label:'壓力'}]}},100);
}
let report=testPeaks([{center:110,strength:80,rank:90,familyCount:3},{center:102,rank:88},{center:128,rank:70,familyCount:2}]);
assert.equal(report.resonance.main.center,110,'主峰保留原最高排名，不因價位大小重排');
assert.equal(report.resonance.secondary.center,128,'次峰必須高於主峰，即使排名第三');
assert.deepEqual(Array.from(report.levels,x=>x.value),[110,128]);
report=testPeaks([{center:110,strength:80,rank:90,familyCount:3},{center:102,rank:88}]);
assert.equal(report.resonance.secondary,null,'沒有合理延伸高點應回傳null');
assert.equal(report.levels.length,1,'不能捏造第二個目標');
assert.equal(report.resonance.optimistic,null,'正式不顯示第三個樂觀目標');
console.log('PASS v2.6.9.11 first batch: original resonance inputs retained, main+extension ordering, no invented extension, 6 recent tactical outputs and guarded 0/10/20 provisional sizing');
