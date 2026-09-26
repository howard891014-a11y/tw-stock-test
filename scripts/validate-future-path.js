const assert=require('assert');
const fs=require('fs');
const {projectGroup}=require('../lib/fundflow-xy');

const calibration={
  historyDays:60,maturityPct:100,
  stats:{transition:{}}
};
for(const h of [3,5,10]){
  calibration.stats.transition[h]={n:100,medianDx:0,medianDy:0,q20Dx:-5,q80Dx:5,q20Dy:-5,q80Dy:5,directions:{
    '右上':{n:46,medianDx:4*h/5,medianDy:3*h/5,q20Dx:2*h/5,q80Dx:6*h/5,q20Dy:1*h/5,q80Dy:5*h/5},
    '右下':{n:38,medianDx:3*h/5,medianDy:-3*h/5,q20Dx:1*h/5,q80Dx:5*h/5,q20Dy:-5*h/5,q80Dy:-1*h/5},
    '盤整':{n:16,medianDx:0,medianDy:0,q20Dx:-1,q80Dx:1,q20Dy:-1,q80Dy:1}
  }};
}
const g={x:52,y:49,phaseState:'transition',phaseConfidence:65,confirmation:62,dx3:1.8,dy3:.3};
const p=projectGroup(g,calibration);
assert.equal(p.mode,'top2-scenario');
assert.equal(p.scenarios.length,2);
assert.deepStrictEqual(p.scenarios.map(x=>x.id),['A','B']);
assert(p.scenarios[0].confidence>=p.scenarios[1].confidence,'A must have >= confidence than B');
assert.notEqual(p.scenarios[0].direction,p.scenarios[1].direction,'A/B should be distinct scenario directions');
for(const route of p.scenarios){
  assert.deepStrictEqual(route.points.map(x=>x.horizon),[3,5,10]);
  for(const pt of route.points){
    assert(pt.lowX<=pt.x&&pt.x<=pt.highX,'cone X must contain route center');
    assert(pt.lowY<=pt.y&&pt.y<=pt.highY,'cone Y must contain route center');
  }
}
assert(p.points===p.primary.points,'legacy projection points should alias Path A');
assert.equal(p.confidence,p.primary.confidence,'legacy projection confidence should alias Path A');
assert(p.top2Share<=100.01&&p.residualPct>=0,'Top-2 share/residual invalid');
assert(Number.isFinite(p.pathGap));

const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
for(const token of ['fundflowProjectionScenarios','fundflow-future-path','fundflow-future-point','A 5日','路徑差'])assert(app.includes(token),`Top-2 UI token missing: ${token}`);
for(const token of ['Top-2 未來路徑','A/B 兩條颱風路徑','fundflow-future-path','fundflow-projection-fan.is-secondary'])assert(html.includes(token),`Top-2 HTML/CSS token missing: ${token}`);
console.log('Future Path Top-2 validation PASS — two distinct A/B scenarios, independent cones, path-gap chaos signal, and UI rendering hooks present');
