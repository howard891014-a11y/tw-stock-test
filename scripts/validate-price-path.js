'use strict';
// Regression/unit tests only. No external calls, no production accuracy claims.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const price=require('../lib/price-path'),dw4=require('../lib/dw4');
const approx=(x,y,eps=1e-7)=>assert.ok(Math.abs(x-y)<eps,`${x} != ${y}`);
approx(price.simpleReturn(price.logReturn(10)+price.logReturn(100*(150/110-1))),50,1e-8);
assert.equal(price.logReturn(null),null);assert.equal(price.logReturn(''),null);
assert.equal(price.logReturn(-100),null);assert.equal(price.addLogReturns([2,null,3]),null);
assert.equal(dw4.OOS_CONFIDENCE[5],undefined);
assert.equal(dw4.direction(0,0),'原地');
const dates=Array.from({length:90},(_,i)=>new Date(Date.UTC(2026,5,i+1)).toISOString().slice(0,10));
const all=[];for(let tag=0;tag<5;tag++)for(let i=0;i<dates.length;i++)all.push({
  trade_date:dates[i],tag_id:`tag_${tag}`,x_score:(i-30)*.3+tag*5,y_score:i<5?0:(tag+1)*.6,
  return_1_pct:(tag+1)*.12+(i%7)*.015,flow_1_pct:(tag+1)*.1+i*.003,flow_5_pct:(tag+1)*.1+(i%5)*.01
});
const tagRows=all.filter(r=>r.tag_id==='tag_2');
const path=price.buildTopicPricePath(tagRows,dates,20);
assert.equal(path.valid,true);assert.equal(path.points.length,21);assert.equal(path.anchorDate,dates[69]);
assert.equal(path.asOf,dates[89]);
const accumulated=price.addLogReturns(tagRows.slice(-20).map(r=>r.return_1_pct));
approx(path.priceLogY,accumulated);approx(path.priceY,price.simpleReturn(accumulated));
const recent=price.addLogReturns(tagRows.slice(-3).map(r=>r.return_1_pct));
const prior=price.addLogReturns(tagRows.slice(-6,-3).map(r=>r.return_1_pct));
approx(path.dy3Turn,recent-prior);
assert.equal(price.buildTopicPricePath(tagRows.filter(r=>r.trade_date!==dates[82]),dates,20).valid,false);
const retire=price.retiringFlow(tagRows,25,5),expected=tagRows.slice(6,11).reduce((s,r)=>s+r.flow_1_pct,0)/5;approx(retire,expected);
const ex=dw4.buildExamples(all,5),e=ex.find(r=>r.tag_id==='tag_2'&&r.trade_date===dates[25]);
assert.ok(e);approx(e.target_price_log,price.addLogReturns(tagRows.slice(26,31).map(r=>r.return_1_pct)));approx(e.retiring_flow_ratio,retire);
assert.ok(!ex.some(r=>r.trade_date===dates[88]));
const withGap=all.filter(r=>!(r.tag_id==='tag_2'&&r.trade_date===dates[40]));
assert.ok(!dw4.buildExamples(withGap,5).some(r=>r.tag_id==='tag_2'&&r.trade_date===dates[39]));
assert.ok(!dw4.buildExamples(withGap,5).some(r=>r.tag_id==='tag_2'&&r.trade_date===dates[41])); // 20-session X history broken
// Prediction payload and frontend are checked with synthetic research rows.
const mock={async query(sql){if(sql.startsWith('SELECT COALESCE'))return [{d:dates.at(-1)}];if(sql.includes('SELECT trade_date,tag_id,x_score'))return all;throw new Error('Unexpected DB query');}};
(async()=>{
  const pred=await dw4.predictDw4({sql:mock,horizons:[5,10,15,20]});
  assert.equal(pred.ok,true);assert.equal(pred.modelVersion,dw4.DW4_VERSION);
  assert.equal(pred.pricePaths.tag_2.valid,true);
  assert.equal(pred.horizonResults[5].ok,true);
  for(const horizon of [5,10,15,20]){
    assert.ok(pred.horizonResults[horizon].predictions.length>0,`missing ${horizon}D`);
    for(const p of pred.horizonResults[horizon].predictions){
      approx(p.predReturnPct,price.simpleReturn(p.predLogReturn));assert.equal(p.confidence,null);
    }
  }
  const fallbackRows=all.map(r=>({...r,flow_1_pct:dateOfBefore(r.trade_date,dates[59])?null:r.flow_1_pct}));
  function dateOfBefore(date,threshold){return date<threshold;}
  const fallbackMock={async query(sql){if(sql.startsWith('SELECT COALESCE'))return [{d:dates.at(-1)}];if(sql.includes('SELECT trade_date,tag_id,x_score'))return fallbackRows;throw new Error('Unexpected DB query');}};
  const fall=await dw4.predictDw4({sql:fallbackMock,horizons:[5,10,15,20]});
  assert.equal(fall.horizonResults[20].ok,true,'must not zero-out predictions due to missing historic 1D institutional flow');
  assert.equal(fall.horizonResults[20].xFeatureMode,'fallback-no-expiring-flow');
  const app=fs.readFileSync('app.js','utf8');
  assert.ok(app.includes('loadFundflowDw4(fundflowXyData?.asOf)'),'forecast must use the snapshot date');
  const start=app.indexOf('let fundflowDw4Data=null;'),end=app.indexOf('async function loadFundflowDw4(',start);
  assert.ok(start>0&&end>start);
  const ctx={fundflowLogY:v=>v===null?NaN:100*Math.log1p(v/100),fundflowRawY:v=>100*Math.expm1(v/100)};
  vm.createContext(ctx);
  vm.runInContext(app.slice(start,end)+ '\nthis.getCurrent=()=>fundflowDw4Data;',ctx);
  const group={tagId:'tag_2',x:5,y:5,trajectory:dates.slice(-15).map(date=>({date,x:5,y:5}))};
  ctx.fundflowApplyDw4({asOf:dates.at(-1),groups:[group]},pred);
  assert.ok(group.priceY>0);assert.equal(group.trajectory.length,15);
  for(let i=1;i<group.trajectory.length;i++){
    assert.ok(group.trajectory[i].priceY>group.trajectory[i-1].priceY, 'historical Y must rise on positive returns');
  }
  const first=group.projection.scenarios[0].points[0];
  approx(first.y,price.simpleReturn(price.logReturn(group.priceY)+first.predLogReturn));
  assert.equal(Math.sign(first.y-group.priceY),Math.sign(first.priceReturnPct));
  assert.equal(group.dy3Turn,pred.pricePaths.tag_2.dy3Turn);
  const stale={tagId:'tag_2',x:5,y:5,trajectory:[{date:dates.at(-1)}]};
  ctx.fundflowApplyDw4({asOf:'2026-10-08',groups:[stale]},pred);
  assert.equal(stale.priceY,null,'date mismatch must fail closed');
  assert.equal(stale.projection,null);
  // Verify the nine-state function reads the new turn rather than old dy3.
  const a=app.indexOf('const STOCKZONE_NINE_STATES='),b=app.indexOf('function fundflowPathAllowed(',a);
  assert.ok(a>0&&b>a);
  const stateCtx={marketDynamicData:null,fundflowPriceDiagnostic:()=>({priceY:10,dy3Turn:-2}),fundflowProjectionScenarios:()=>[],fundflowPointQuadrant:(x,y)=>x>0?(y>0?'mainline':'potential'):(y>0?'price-led':'cold'),fundflowQuadrantShort:x=>x};
  vm.createContext(stateCtx);
  vm.runInContext(app.slice(a,b)+'\nthis.state=fundflowPathState;',stateCtx);
  assert.equal(stateCtx.state({x:10,y:3,dx3:0,dy3:99,tagId:'a'}).key,'pullback');
  console.log('PASS price-path: compound return, missing data, 20D anchor, retiring flows, causal labels, Y direction, nine-state turn, date gate, no fake confidence');
})().catch(err=>{console.error(err);process.exitCode=1;});
