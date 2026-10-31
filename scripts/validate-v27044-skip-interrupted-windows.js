'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const engine=require('../lib/resonance-lab-v1.js');
const root=path.resolve(__dirname,'..');
const current=fs.readFileSync(path.join(root,'lib/resonance-lab-v1.js'),'utf8');
const prior=fs.readFileSync(path.join(root,'docs/v27044-prior-r1-formulas.js.txt'),'utf8');
const f=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
for(const [a,b] of [['  function simulateTrade(','  function summarise('],['  function entryCandidate(','  function simulateTrade('],['  function contextAt(','  function entryCandidate('],['  function cleanBars(','  function avg(values)'],['  function summarise(','  function backtestPriceBaselines(']]){
 assert.equal(f(current,a,b).split('  // v2.7.0.45')[0].trimEnd(),f(prior,a,b).trimEnd(),'Original R1 mathematical or OHLC rules changed: '+a);
}
const n=1211; const bars=[];let date=new Date('2021-10-01T00:00:00Z');
while(bars.length<n){if(date.getUTCDay()!==0&&date.getUTCDay()!==6){const close=100+bars.length*.055;bars.push({date:date.toISOString().slice(0,10),open:close-.1,high:close+.8,low:close-.8,close})}date.setUTCDate(date.getUTCDate()+1)}
const base=engine.backtestPriceBaselines(bars);assert(base.valid);assert.equal(base.coverage.signals,20);assert.equal(base.coverage.quality,'complete');
const split=bars.map(b=>({...b}));const abnormalIndex=550;
for(let i=abnormalIndex;i<split.length;i++)for(const p of ['open','high','low','close'])split[i][p]*=2.09;
const partial=engine.backtestPriceBaselines(split);
assert(partial.valid);assert.equal(partial.coverage.quality,'partial');assert.equal(partial.coverage.excludedEvents.length,1);
assert(partial.coverage.signals<20&&partial.coverage.signals>0);
assert.equal(engine.classifyFiveYearPlay(partial).status,'reference','partial history never claims qualified whole-period strategy');
for(const candidate of partial.candidates){const i=split.findIndex(b=>b.date===candidate.date);
 assert(i+60<abnormalIndex || i>abnormalIndex,`sample crosses price basis discontinuity: ${candidate.date}`)}
for(const strategy of partial.results){assert.equal(strategy.trades.length,partial.coverage.signals);for(const t of strategy.trades){assert(!(+t.entryPrice<=0));}}
const broken=bars.map(x=>({...x}));broken[550].low=broken[550].high+1;
const skipped=engine.backtestPriceBaselines(broken);
assert(skipped.valid);assert.equal(skipped.coverage.quality,'partial');assert(skipped.coverage.excludedEvents.some(e=>e.kind==='ohlc'));
for(const candidate of skipped.candidates){const i=bars.findIndex(b=>b.date===candidate.date);assert(i+60<550||i>=550,`OHLC window crossed missing row: ${candidate.date}`)}
const unknown=bars.map(x=>({...x}));unknown[550].date='';
assert.equal(engine.backtestPriceBaselines(unknown).valid,false,'unlocatable date must not be spliced');
const all=bars.map(x=>({...x}));for(let i=150;i<all.length;i+=100){for(let j=i;j<all.length;j++)for(const p of ['open','high','low','close'])all[j][p]*=1.5;}
const none=engine.backtestPriceBaselines(all);assert(!none.valid||none.coverage.quality==='partial');
const vm=require('node:vm');
const sandbox={module:{exports:{}}};vm.runInNewContext(prior,sandbox);
const original=sandbox.module.exports;
const oldBaseline=original.backtestPriceBaselines(bars);
assert.equal(base.coverage.signals,20,'new baseline computes up to 20 price-only trials');
assert.equal(oldBaseline.coverage.signals,18,'original 120-day warmup still computes 18 samples');
const originalTouch=original.reachabilityProfile(bars,120,150);
const touch=engine.reachabilityProfile(bars,120,150);
assert.equal(touch.sample,20);assert.equal(originalTouch.sample,18);
assert(touch.horizons.every(x=>Number.isFinite(x.hitPct)),'historic touch calculation remains available');
const interruptedTouch=engine.reachabilityProfile(split,120,150);
assert(interruptedTouch.valid);
assert.equal(interruptedTouch.sample,partial.coverage.signals);
assert.equal(interruptedTouch.quality,'partial');
assert.equal(interruptedTouch.excludedEvents.length,1);
console.log('PASS v2.7.0.44: identical historical R1 maths, 20 healthy samples, discontinuity exclusion, OHLC guard, no invalid date splice, transparent reference status');
