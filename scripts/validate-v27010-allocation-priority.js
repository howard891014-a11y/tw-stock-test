'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lab=require('../lib/resonance-lab-v1.js');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'lib/resonance-lab-v1.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const raw=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ver=require('../package.json').version;
assert.equal(ver,'2.7.0.10');
assert(raw.includes('v2.7.0.10')&&raw.includes('resonance-lab-v1.js?v=2.7.0.10'));
assert(app.includes("modelVersion:'v2.7.0.10"));
assert(app.includes('approved.corePct/investedPct*100'),'Resonance must normalize invested weights, excluding cash');
assert(app.includes('actualCorePct:approved.corePct'),'Position allocation stays on full 100% cash-inclusive basis');
assert(app.includes("stockzone:allocation-study-approved"),'Confirmed research triggers resonance recalculation');
assert(source.includes("api.approvedAllocationForCode=function(code)"),'Only approved study reaches official chart');
assert(source.includes('研究配置已確認，未執行交易'),'Do not misrepresent approved research as actual trades');
assert(source.includes('api.prioritizeTacticalAllocation(rawStudy,currentAllocation)'),'UI must show ordered allocation');
assert(source.includes('api.prioritizeTacticalAllocation(rawStudy,latest?'),'Confirm must use same priority logic');
assert(source.includes('researchTarget:study.researchTarget||null'),'Saved review retains raw research target');

const c={valid:true,price:90,ma20:100,ma60:105,ma120:110,ret20Pct:-12,volatilityPct:7};
const rawStudy=lab.proposeAllocation({baseCorePct:65,play:'swing',context:c,market:'on'});
assert.deepEqual([rawStudy.corePct,rawStudy.tacticalPct,rawStudy.cashPct],[50,20,30],'Unchanged study research target');
let result=lab.prioritizeTacticalAllocation(rawStudy);
assert.deepEqual([result.corePct,result.tacticalPct,result.cashPct],[65,5,30],'Sell tactical before core, match 30% total reduction');
assert.deepEqual([result.researchTarget.corePct,result.researchTarget.tacticalPct,result.researchTarget.cashPct],[50,20,30]);
assert.equal(result.priorityRule,'tactical-first-v1');
assert(result.reason.some(s=>s.includes('機動倉優先')));

// No drift after saving a study adjustment: next run starts from last approved configuration.
const repeated=lab.prioritizeTacticalAllocation(rawStudy,{corePct:65,tacticalPct:5});
assert.deepEqual([repeated.corePct,repeated.tacticalPct,repeated.cashPct],[65,5,30]);

const rawWarn=lab.proposeAllocation({baseCorePct:65,play:'swing',context:c,market:'warning'});
assert.deepEqual([rawWarn.corePct,rawWarn.tacticalPct,rawWarn.cashPct],[42.5,10,47.5]);
const warn=lab.prioritizeTacticalAllocation(rawWarn,{corePct:65,tacticalPct:5});
assert.deepEqual([warn.corePct,warn.tacticalPct,warn.cashPct],[52.5,0,47.5],'After last 5% tactical is sold, core can be reduced');

// More severe scenario: sell 35% tactical, THEN 15% core.
const deeper=lab.prioritizeTacticalAllocation({...rawStudy,corePct:30,tacticalPct:20,cashPct:50});
assert.deepEqual([deeper.corePct,deeper.tacticalPct,deeper.cashPct],[50,0,50]);

// Rebound may replenish tactical; it cannot silently rewrite a core position while tactical is held.
const recovery=lab.proposeAllocation({baseCorePct:65,play:'long-swing',context:{...c,price:120,ma20:110,ma60:100,ret20Pct:10,volatilityPct:3},market:'on'});
assert.deepEqual([recovery.corePct,recovery.tacticalPct,recovery.cashPct],[70,30,0]);
const boost=lab.prioritizeTacticalAllocation(recovery,{corePct:65,tacticalPct:5});
assert.deepEqual([boost.corePct,boost.tacticalPct,boost.cashPct],[65,35,0]);
const fromZero=lab.prioritizeTacticalAllocation(recovery,{corePct:60,tacticalPct:0});
assert.deepEqual([fromZero.corePct,fromZero.tacticalPct,fromZero.cashPct],[70,30,0]);

// W3 OFF is explicitly excluded from new ordering: preserve the old model byte-for-byte as object.
for(const play of ['short','mixed','swing','long-swing','long']){
  const off=lab.proposeAllocation({baseCorePct:65,play,context:c,market:'off'});
  assert.strictEqual(lab.prioritizeTacticalAllocation(off,{corePct:65,tacticalPct:20}),off,`${play}: W3 OFF must stay exactly unchanged`);
}
assert.deepEqual(lab.prioritizeTacticalAllocation({valid:false,reason:['bad']}),{valid:false,reason:['bad']});
assert.equal(lab.prioritizeTacticalAllocation(rawStudy,{corePct:60,tacticalPct:80}).valid,false,'Invalid positions must block confirmation');
console.log('PASS v2.7.0.10 tactical-first portfolio adjustment, stable 65/5/30 and 52.5/0/47.5, R1.5 research unchanged, W3 OFF untouched, version');
