'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');
const P=require('../lib/holding-trade-plans');
const api=fs.readFileSync('api/sync-status.js','utf8');
const app=fs.readFileSync('app.js','utf8');
assert.match(app,/function holdingPlanLockedSnapshot\(/);
assert.match(app,/buildExpectedPlan\(locked,price\)/);
assert.match(app,/unifiedDecisionForPlay\(locked,expected,risk,latestRecentPlayAdvice,holding\)/,'locked holdings must use one modern decision, never legacy plan or duplicate stop');
assert.match(app,/api\.live\(localStorage,String\(code\),locked\)/);
assert.match(api,/research500Progress\?\.complete/);
const source={playKey:'swing',allocation:{core:55,tactical:45}};
for(const [risk,w3,expectedCore] of [[{score:20},null,60],[{score:80},null,45],[{score:50},{verified:true,regime:'off',warning:false},45],[{score:20},{verified:true,regime:'on',warning:true},50]]){
  const o=P.recommendAllocation(source,{risk},{w3});assert.equal(o.core,expectedCore);assert.equal(o.tactical,100-expectedCore);assert.deepEqual(o.bounds,[45,60]);
}
const t=P.recommendAllocation({playKey:'short',allocation:{core:20,tactical:80}},{risk:{score:90}},{w3:{verified:true,regime:'off'}});
assert.match(t.action,/全部出清/);assert.ok(t.core>=10&&t.core<=20);
const l=P.recommendAllocation({playKey:'long',allocation:{core:85,tactical:15}},{risk:{score:90}},{w3:{verified:true,regime:'off'}});
assert.match(l.action,/機動倉/);assert.ok(l.core>=80&&l.core<=90);
const st={data:{},getItem(k){return this.data[k]??null},setItem(k,v){this.data[k]=v}};
const snap=(main=150,playKey='swing')=>({code:'1234',play:'波段',playKey,allocation:{core:55,tactical:45},targets:{main,secondary:175},decision:{mode:'波段'},risk:{score:20}});
P.create(st,'1234',100,1000,snap());assert.equal(P.live(st,'1234',snap(110,'short')).blocked,true);
const accepted={...snap(155),analysisPlayKey:'swing',modeChangeObserved:'short',allocation:{core:45,tactical:55},holdingAction:'根據原玩法控倉'};
assert.equal(P.live(st,'1234',accepted).changed,true);assert.equal(P.active(st,'1234').initial.targets.main,150);
assert.equal(P.active(st,'1234').last.targets.main,155);assert.equal(P.live(st,'1234',accepted).changed,false);
// Execute the actual browser integration functions in a controlled VM (not only source markers).
const vm=require('node:vm');
const start=app.indexOf('function holdingPlanW3Snapshot(){'),end=app.indexOf('function refreshHoldingTradePlan(code){',start);
assert.ok(start>0&&end>start);
const ctx={window:{StockZoneHoldingPlans:P},currentStockCode:()=>"1234",
  stockzoneW3Regime:()=>"off",marketDynamicData:{w3:{stale:false,isLiveModel:true,warning:false}},
  latestPlayStyleResult:{key:'short',period:'短期',operationProfile:{key:'short',basePct:10,tacticalPct:90}},
  positionNumber:n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n):null,
  holdingPlanActive:()=>({position:{avgCost:110,shares:1000}}),currentHoldingPosition:()=>({avgCost:110,shares:1000}),
  buildExpectedPlan:play=>({resonance:{valid:true},levels:[{value:play.key==='swing'?161:105},{value:185}]}),
  buildDownsidePlan:()=>({levels:[{value:93},{value:89}]}),
  buildDecisionRisk:play=>({score:80,level:{label:'極高'},summary:play.key+' 避險'}),
  buildDecisionPlan:play=>({mode:play.key,trial:[100,103],entryCandidate:[125,130],trim:[160,163],exit:[180,185]}),
  buildAdaptiveStopModel:()=>({mode:'holding'}),
  applyDecisionRisk:d=>({...d,trimStop:[95,97],fullStop:[90,92]}),
  unifiedDecisionForPlay:play=>({valid:true,mode:play.key,action:'已鎖定波段玩法；同一份正式建議',trial:[100,100],entryCandidate:null,trim:[160,160],exit:[180,180],trimStop:[95,95],fullStop:[90,90]}),
  latestRecentPlayAdvice:{valid:true,trialPct:10},
};
vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
const plan=P.active(st,'1234');
const screen={code:'1234',referencePrice:120,play:'短期',playKey:'short',signal:'短期候選',capturedAt:'2026-10-27T12:00:00Z'};
const locked=ctx.holdingPlanLockedSnapshot('1234',plan,screen);
assert.equal(locked.playKey,'swing');assert.equal(locked.analysisPlayKey,'swing');
assert.equal(locked.modeChangeObserved,'short');assert.equal(locked.targets.main,161);
assert.equal(locked.decision.mode,'swing');assert.equal(locked.risk.score,80);
assert.ok(locked.allocation.core>=45&&locked.allocation.core<=60);
assert.match(locked.holdingAction,/機動倉/);
assert.equal(P.live(st,'1234',locked).changed,true);assert.equal(P.active(st,'1234').initial.targets.main,150);
ctx.buildExpectedPlan=()=>({resonance:{valid:false},levels:[]});
const noPeak=ctx.holdingPlanLockedSnapshot('1234',P.active(st,'1234'),screen);
assert.equal(noPeak.targets.main,161);assert.equal(noPeak.targetsStatus,'retained-previous-no-confirmed-peak');
assert.match(noPeak.signal,/沒有|無高於現價/);
console.log('PASS 2.6.9.14 .12 holding-plan behavior: fixed play, risk bounds, dynamic snapshot; no database use');
