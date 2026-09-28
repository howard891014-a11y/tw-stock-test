const assert=require('assert');
const fs=require('fs');
const {buildTransitionCalibration,projectGroup,PATH_INFLUENCE,PATH_MIN_COMPLETENESS_PCT}=require('../lib/fundflow-xy');
function makeHistory(){
  const groups=[];
  for(let g=0;g<5;g++){
    const trajectory=[];
    for(let i=0;i<40;i++)trajectory.push({date:`2026-${String(7+Math.floor(i/28)).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`,xAvailable:true,x:-50+g+i*2.6,y:-4+i*.35,rawX:.3+i*.01,flowValidCount:8,flow5Pct:.6,flow1Pct:.8,activationRate:78,dataCompleteness:90,reliability:90,phaseState:i<10?'transition':'mainline',phaseLabel:'',phaseConfidence:75,dx1:2.6,dy1:.35,dx3:7.8,dy3:1.05,ddx1:0,ddy1:0});
    groups.push({tagId:`g${g}`,trajectory});
  }
  return groups;
}
const calibration=buildTransitionCalibration(makeHistory());
const g={x:42,y:-.2,phaseState:'transition',phaseConfidence:65,activationRate:80,flow5Pct:.8,flow1Pct:1.0,dataCompleteness:92,reliability:92,dx3:12,dy3:.7};
const p=projectGroup(g,calibration);
assert.equal(p.mode,'institutional-activation-nearest-trajectory-top2');assert.equal(p.scenarios.length,2);assert.deepStrictEqual(p.scenarios.map(x=>x.id),['A','B']);assert(p.scenarios[0].confidence>=p.scenarios[1].confidence);assert.notEqual(p.scenarios[0].direction,p.scenarios[1].direction);
assert.deepStrictEqual(p.influence,PATH_INFLUENCE);assert(PATH_INFLUENCE.institutional>PATH_INFLUENCE.activation&&PATH_INFLUENCE.activation>PATH_INFLUENCE.history);
for(const route of p.scenarios){assert.deepStrictEqual(route.points.map(x=>x.horizon),[3,5,10]);for(const pt of route.points){assert(pt.lowX<=pt.x&&pt.x<=pt.highX);assert(pt.lowY<=pt.y&&pt.y<=pt.highY)}}
assert(p.points===p.primary.points);assert.equal(p.confidence,p.primary.routeShare);assert(p.top2Share<=100.01&&p.residualPct>=0);assert(Number.isFinite(p.pathGap));
// Completeness changes uncertainty, not direction probability.
const hi=projectGroup({...g,dataCompleteness:100},calibration),lo=projectGroup({...g,dataCompleteness:55},calibration);assert.equal(hi.primary.direction,lo.primary.direction);assert.equal(hi.primary.routeShare,lo.primary.routeShare);
const h5=hi.primary.points.find(x=>x.horizon===5),l5=lo.primary.points.find(x=>x.horizon===5);assert((l5.highX-l5.lowX)>=(h5.highX-h5.lowX));assert((l5.highY-l5.lowY)>=(h5.highY-h5.lowY));
const insufficient=projectGroup({...g,dataCompleteness:PATH_MIN_COMPLETENESS_PCT-1},calibration);assert.equal(insufficient.mode,'insufficient-data');assert.equal(insufficient.scenarios.length,0);
const core=fs.readFileSync('lib/fundflow-xy.js','utf8'),app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
for(const token of ['nearestTransitionStats','pathFeatureDistance','axisEvidenceDistribution','institutional:0.50, activation:0.30, history:0.20','No sign enforcement','dataCompleteness','PATH_MIN_COMPLETENESS_PCT'])assert(core.includes(token),`new Path token missing: ${token}`);
for(const token of ['fundflowProjectionScenarios','fundflow-future-path','fundflow-future-point','fundflow-future-uncertainty','fundflowStartFocusAnimation','fundflowFocusAnimationState','fundflowPathState','路徑差'])assert(app.includes(token)||html.includes(token),`Top-2/typhoon UI token missing: ${token}`);
assert(!core.includes('.62*histProb+.24*trendSim'),'retired history-dominant direction formula remains');
const signalBlock=core.slice(core.indexOf('function currentSignalState'),core.indexOf('function scenarioDirectionScores'));
assert(signalBlock.includes('positionForce=tanhUnit(x20,55)'),'institutional Path evidence must include X20 position strength');
assert(signalBlock.includes('activationForce=clampRange(activation/100,0,1)'),'1/0 activation must be positive-only breadth evidence');
assert(!signalBlock.includes('(activation-50)/50'),'low activation must not become a synthetic -1/down vote');
console.log('Future Path 2.0 validation PASS — institutional X-axis > positive-only activation > causal nearest trajectory; completeness only gates/widens uncertainty');
