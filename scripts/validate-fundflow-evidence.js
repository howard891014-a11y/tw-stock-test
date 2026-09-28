const assert=require('assert');
const fs=require('fs');
const {walkForwardPathAudit}=require('../lib/fundflow-xy');

// Causal synthetic path: every topic keeps moving right/up.  The walk-forward
// evaluator must learn only from data available at each anchor and report real hits.
function makeGroup(id,shift=0){
  const trajectory=[];
  for(let i=0;i<42;i++){
    const x=-45+shift+i*3.0,y=-4+shift*.02+i*.42;
    trajectory.push({
      date:`2026-${String(7+Math.floor(i/28)).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,
      xAvailable:true,x,y,rawX:x/10,rawY:y,flowValidCount:6,
      confirmation:78,activationRate:78,flow5Pct:.8,flow1Pct:1.0,dataCompleteness:90,overheating:25,phaseState:i<18?'transition':'mainline',phaseLabel:i<18?'混沌／方向未明':'共振轉強',phaseConfidence:72,
      dx1:i?3:0,dy1:i?.42:0,dx3:i>=3?9:3,dy3:i>=3?1.26:.42,ddx1:0,ddy1:0,priceBreadth:68,flowBreadth:66,concentrationQuality:75,reliability:85,validCount:8
    });
  }
  const last=trajectory.at(-1);
  return {tagId:id,name:id,...last,trajectory};
}
const audit=walkForwardPathAudit([makeGroup('a',0),makeGroup('b',3),makeGroup('c',-4)],{horizon:5,minHistoryDays:10});
assert(audit.predictions>20,'walk-forward should produce enough causal predictions');
assert(Number.isFinite(audit.top1HitPct),'top1 hit rate must be measured');
assert(Number.isFinite(audit.top2HitPct),'top2 hit rate must be measured');
assert(audit.top2HitPct>=audit.top1HitPct,'top2 coverage cannot be below top1');
assert(audit.top1HitPct>=60,'deterministic synthetic trend should clear 60% without fake confidence inflation');

const core=fs.readFileSync('lib/fundflow-xy.js','utf8');
const status=fs.readFileSync('api/sync-status.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
for(const token of [
  'readFundflowValidationAudit','readTopicInstitutionalCoverageAudit','walkForwardPathAudit',
  'benchmarkSignLockPass','benchmarkSnapshotMatchPass','pathTop1AtLeast60','readyToFinalize','businessUniverseBaseline=161'
])assert(core.includes(token),`evidence gate missing: ${token}`);
for(const token of ["view==='fundflow-audit'","action==='institutional-backfill-manual'","action==='fundflow-history-backfill-manual'",'x-stockzone-manual-institutional','x-stockzone-manual-history','clientRevisionMatch'])assert(status.includes(token),`audit/backfill endpoint missing: ${token}`);
for(const token of ['manualInstitutionalRepair','manualFundflowHistory','runFundflowValidation','Path 5D Top1','補齊法人 60D','Compact history','Neon Storage Audit'])assert(app.includes(token)||html.includes(token),`settings evidence UI missing: ${token}`);
assert(core.includes('sign(x)===sign(rawX)'),'benchmark must explicitly verify topic X/raw-X sign lock');
assert(core.includes('instFlow20Pct:roundNullable(item.inst_flow_ratio_20,3)'),'company detail must expose raw X20 flow');
assert(core.includes('ACTIVATION_THRESHOLD_PCT = 0.2'),'price activation threshold must be explicit');
assert(core.includes('readCompactFeatureHistoryStatus'),'compact feature history status missing');
assert(core.includes('compactHistoryReady'),'release gate must expose compact history readiness');
assert(core.includes('pathMeasured:path.predictions>=30'),'Path release gate must require measured samples');
assert(app.includes('fundflow-audit&target=60'),'Settings audit must request 60D history');
assert(app.includes('if(v===null||v===undefined||v==="")return "--"'),'fundflow formatter must render missing values as --');
console.log(`Fundflow evidence validation PASS — causal walk-forward=${audit.top1HitPct}% top1 / ${audit.top2HitPct}% top2 on deterministic fixture + runtime release gate present`);
