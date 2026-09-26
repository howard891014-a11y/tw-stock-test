const assert=require('assert');
const fs=require('fs');
const {projectGroup}=require('../lib/fundflow-xy');
const calibration={historyDays:60,maturityPct:100,stats:{transition:{}}};
for(const h of [3,5,10])calibration.stats.transition[h]={n:100,medianDx:0,medianDy:0,q20Dx:-12,q80Dx:12,q20Dy:-1.2,q80Dy:1.2,directions:{
  '右上':{n:46,medianDx:4*h,medianDy:.30*h,q20Dx:2*h,q80Dx:6*h,q20Dy:.15*h,q80Dy:.45*h},
  '右下':{n:38,medianDx:3.5*h,medianDy:-.28*h,q20Dx:1.5*h,q80Dx:5.5*h,q20Dy:-.42*h,q80Dy:-.14*h},
  '盤整':{n:16,medianDx:0,medianDy:0,q20Dx:-3,q80Dx:3,q20Dy:-.25,q80Dy:.25}
}};
const g={x:42,y:-.2,phaseState:'transition',phaseConfidence:65,confirmation:62,dx3:14,dy3:.25};
const p=projectGroup(g,calibration);
assert.equal(p.mode,'top2-scenario');assert.equal(p.scenarios.length,2);assert.deepStrictEqual(p.scenarios.map(x=>x.id),['A','B']);assert(p.scenarios[0].confidence>=p.scenarios[1].confidence);assert.notEqual(p.scenarios[0].direction,p.scenarios[1].direction);
for(const route of p.scenarios){assert.deepStrictEqual(route.points.map(x=>x.horizon),[3,5,10]);for(const pt of route.points){assert(pt.lowX<=pt.x&&pt.x<=pt.highX);assert(pt.lowY<=pt.y&&pt.y<=pt.highY)}}
assert(p.points===p.primary.points);assert.equal(p.confidence,p.primary.confidence);assert(p.top2Share<=100.01&&p.residualPct>=0);assert(Number.isFinite(p.pathGap));
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
for(const token of ['fundflowProjectionScenarios','fundflow-future-path','fundflow-future-point','fundflow-future-uncertainty','fundflow-typhoon-marker','animateMotion','fundflowPathState','路徑差'])assert(app.includes(token)||html.includes(token),`Top-2/typhoon UI token missing: ${token}`);
for(const token of ['Top-2 未來路徑','A/B 兩條颱風路徑','3 / 5 / 10 日圓圈'])assert(html.includes(token)||app.includes(token),`Top-2 UI text missing: ${token}`);
assert(!app.includes('fundflow-forecast-corridor ${routeClass}'),'old wide forecast corridor rendering should be removed');
console.log('Future Path validation PASS — Top-2 3/5/10D routes + expanding uncertainty circles + historical typhoon animation');
