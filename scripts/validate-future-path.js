const assert=require('assert');
const fs=require('fs');
const {buildTransitionCalibration,projectGroup,PATH_INFLUENCE,PATH_MIN_COMPLETENESS_PCT,PATH_CONE_COVERAGE}=require('../lib/fundflow-xy');
function makeHistory(){
  const groups=[];
  for(let g=0;g<6;g++){
    const trajectory=[];
    for(let i=0;i<44;i++)trajectory.push({date:`2026-${String(7+Math.floor(i/28)).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,xAvailable:true,x:-50+g+i*2.6,y:-4+i*.35,rawX:.3+i*.01,flowValidCount:8,flow5Pct:.6,flow1Pct:.8,activationRate:78,dataCompleteness:90,reliability:90,phaseState:i<10?'transition':'mainline',phaseLabel:'',phaseConfidence:75,dx1:2.6,dy1:.35,dx3:7.8,dy3:1.05,ddx1:0,ddy1:0});
    groups.push({tagId:`g${g}`,trajectory});
  }
  return groups;
}
const calibration=buildTransitionCalibration(makeHistory());
assert.equal(calibration.cone?.method,'causal-nearest-path-error-p70');
assert.equal(calibration.cone?.coveragePct,70);
assert(calibration.pathSamples.length>0,'Path 3.1 needs complete 3D/5D/10D micro trajectories');
const r3=calibration.cone.radii[3].radiusNorm,r5=calibration.cone.radii[5].radiusNorm,r10=calibration.cone.radii[10].radiusNorm;
assert(r3>0&&r5>=r3&&r10>=r5,'P70 cone radii must be positive and non-decreasing');

const g={tagId:'new',x:42,y:-.2,phaseState:'transition',phaseConfidence:65,activationRate:80,flow5Pct:.8,flow1Pct:1.0,dataCompleteness:92,reliability:92,dx3:12,dy3:.7};
const p=projectGroup(g,calibration);
assert.equal(p.mode,'path-family-cone-p70-point-line-area');assert(p.scenarios.length>=1&&p.scenarios.length<=2);assert.equal(p.scenarios[0].id,'A');if(p.scenarios[1])assert.equal(p.scenarios[1].id,'B');
assert.deepStrictEqual(p.influence,PATH_INFLUENCE);assert(PATH_INFLUENCE.institutional>PATH_INFLUENCE.activation&&PATH_INFLUENCE.activation>PATH_INFLUENCE.history);
assert(Math.abs(Number(p.familyProbabilityTotalPct)-100)<.02,'all micro-path family probability must sum to 100%');
assert(p.primary.routeShare>0&&p.primary.routeShare<=100,'A must be the literal largest family share, without an artificial floor');
for(const route of p.scenarios){assert.deepStrictEqual(route.points.map(x=>x.horizon),[3,5,10]);assert(route.familySize>=1);for(const pt of route.points){assert(pt.lowX<=pt.x&&pt.x<=pt.highX);assert(pt.lowY<=pt.y&&pt.y<=pt.highY);assert(pt.radiusNorm>0);assert.equal(pt.coveragePct,70)}}
assert(p.points===p.primary.points);assert.equal(p.confidence,p.primary.routeShare);assert(p.top2Share<=100.01&&p.residualPct>=0);assert(Number.isFinite(p.pathGap));assert.equal(p.cone.coveragePct,70);
// Completeness widens the cone but must not reassign family probability.
const hi=projectGroup({...g,dataCompleteness:100},calibration),lo=projectGroup({...g,dataCompleteness:55},calibration);assert.equal(hi.primary.direction,lo.primary.direction);assert.equal(hi.primary.routeShare,lo.primary.routeShare);
const h5=hi.primary.points.find(x=>x.horizon===5),l5=lo.primary.points.find(x=>x.horizon===5);assert(l5.radiusNorm>=h5.radiusNorm);assert((l5.highX-l5.lowX)>=(h5.highX-h5.lowX));
const insufficient=projectGroup({...g,dataCompleteness:PATH_MIN_COMPLETENESS_PCT-1},calibration);assert.equal(insufficient.mode,'insufficient-data');assert.equal(insufficient.scenarios.length,0);

const core=fs.readFileSync('lib/fundflow-xy.js','utf8'),app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('style.css','utf8');
for(const token of ['buildHistoricalPathErrorCalibration','nearestPathCandidates','buildPathFamilies','pathFamilyCompatible','pathTrajectoryDistance','pathFamilyAdaptiveRadius','PATH_CONE_COVERAGE=0.70','causal-nearest-path-error-p70','path-family-cone-p70-point-line-area','institutional:0.50, activation:0.30, history:0.20','PATH_MIN_COMPLETENESS_PCT'])assert(core.includes(token),`Path 3.1 token missing: ${token}`);
for(const token of ['fundflowProjectionScenarios','fundflow-future-path','fundflow-future-point','fundflow-future-cone','fundflowFutureConePath','fundflowStartFocusAnimation','fundflowPathState','fundflowFutureCenterPath'])assert(app.includes(token)||html.includes(token)||css.includes(token),`Path 3.1 forecast UI token missing: ${token}`);
assert(app.includes('scenarios.slice(0,1).forEach'),'new dW4 Plus UI must not render legacy secondary A/B path');
assert(app.includes('const envelope=fundflowFutureConePath'),'XY envelope must be rendered');
assert(app.includes('const centerPath=fundflowFutureCenterPath'),'independent horizon center path must be rendered');
assert(!core.includes('.62*histProb+.24*trendSim'),'retired history-dominant direction formula remains');
const signalBlock=core.slice(core.indexOf('function currentSignalState'),core.indexOf('function directionEvidenceScores'));
assert(signalBlock.includes('positionForce=tanhUnit(x20,55)'),'institutional Path evidence must include X20 position strength');
assert(signalBlock.includes('activationForce=clampRange(activation/100,0,1)'),'1/0 activation must be positive-only breadth evidence');
assert(!signalBlock.includes('(activation-50)/50'),'low activation must not become a synthetic -1/down vote');

// Timeout recovery remains required after Path engine bumps.
assert(core.includes('rebuildPathAuditFromStored'),'missing compact-only Path audit repair helper');
assert(core.includes('auditNeedsRepair=auditMissing||auditSuspiciousZero'),'warm path must detect missing/stale-zero Path audit');
const warmBlock=core.slice(core.indexOf('async function warmCurrentEngineFromStoredDb'),core.indexOf('async function getFundflowSnapshot'));
assert(warmBlock.indexOf('auditNeedsRepair')<warmBlock.indexOf("clean-engine-snapshots-and-path-audit-already-latest"),'Path audit gate must run before cheap no-op');
assert(warmBlock.includes("mode:result?.mode||'path-audit-repair-from-compact'"),'missing compact Path-audit-only repair mode');
assert(core.includes('auditStale=Boolean(pathAudit&&before?.asOf&&isoDate(pathAudit?.asOf)!==isoDate(before.asOf))'),'warm must detect stale path-audit by asOf');
assert(core.includes('auditNeedsRepair=auditMissing||auditSuspiciousZero||auditStale'),'stale path-audit must enter repair path');

console.log('Future Path 3.1 validation PASS — micro-path probability conserves 100%; point→line→family aggregation and causal P70 forecast area verified');
