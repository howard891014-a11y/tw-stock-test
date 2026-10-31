'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const e=require('../lib/resonance-lab-v1.js');
const src=fs.readFileSync(path.join(__dirname,'../lib/resonance-lab-v1.js'),'utf8');
function series(n){
 const out=[],d=new Date('2021-10-01T00:00:00.000Z');
 while(out.length<n){
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6){
   const c=100+out.length*.055;
   out.push({date:d.toISOString().slice(0,10),open:c-.1,high:c+.8,low:c-.8,close:c});
  }
  d.setUTCDate(d.getUTCDate()+1);
 }
 return out;
}
const base=series(1211),copy=JSON.stringify(base);
const normal=e.backtestPriceBaselines(base);
assert(normal.valid);assert.equal(normal.coverage.signals,20,'20 complete trials for intact 5-year source');
assert.equal(normal.coverage.quality,'complete');
assert.equal(normal.coverage.indicatorReadySignals,18,'120-day historic context is diagnostic only');
assert.equal(normal.coverage.indicatorMissingSignals,2);
assert.equal(normal.candidates[0].key,null);
assert(normal.results.every(x=>x.stats.count===20));
assert.equal(JSON.stringify(base),copy,'five-year historical input is never changed');
const above=series(1350),more=e.backtestPriceBaselines(above);
assert.equal(more.coverage.signals,20,'at most 20 signals when more price data are available');
assert(more.candidates[0].date>above[0].date,'cap should keep most recent complete observations');
// The formal 10-trial minimum is unchanged by the new sample maximum.
const ten=e.backtestPriceBaselines(series(601));
assert.equal(ten.coverage.signals,10);
assert(e.selectFiveYearPlay(ten)?.key,'10 otherwise-qualifying samples can be formally selected');
assert.equal(e.classifyFiveYearPlay(ten).status,'selected');
const nine=e.backtestPriceBaselines(series(541));
assert.equal(nine.coverage.signals,9);
assert.equal(e.selectFiveYearPlay(nine)?.key,null,'9 samples do not qualify');
assert.equal(e.classifyFiveYearPlay(nine).status,'reference');
// Second 60-day block begins at index 60. Day 45 of that block
// is the invalid day index 105. Restart at day 46, index 106.
const broken=base.map(x=>({...x}));
for(let i=105;i<broken.length;i++)for(const k of ['open','high','low','close'])broken[i][k]*=2.09;
const partial=e.backtestPriceBaselines(broken);
assert(partial.valid);assert.equal(partial.coverage.quality,'partial');
assert.equal(partial.coverage.excludedEvents.length,1);
assert.equal(partial.candidates[0].date,broken[0].date);
assert.equal(partial.candidates[1].date,broken[106].date,'restart exactly the session following abnormal day');
for(const c of partial.candidates){
 const i=broken.findIndex(x=>x.date===c.date);
 assert(i>105||i+60<105,'never include abnormal day in a full 60-day observation');
}
assert(partial.results.every(x=>x.stats.count===partial.coverage.signals));
assert.equal(e.classifyFiveYearPlay(partial).status,'reference','partial history retains original reference policy');
assert(partial.coverage.indicatorMissingSignals>=2,'120MA may be unavailable after jump, without blocking price trials');
// Malformed OHLC row is *removed* by normalizer: its first following
// clean bar is the new signal date (not the next-next day).
const damaged=base.map(x=>({...x}));damaged[105].low=damaged[105].high+2;
const after=e.backtestPriceBaselines(damaged);
assert(after.valid);assert.equal(after.coverage.quality,'partial');
assert.equal(after.candidates[1].date,damaged[106].date);
const unknown=base.map(x=>({...x}));unknown[105].date='';
assert.equal(e.backtestPriceBaselines(unknown).valid,false,'unlocatable defects remain blocked');
// Reachability must use the exact same qualifying signal dates.
const hits=e.reachabilityProfile(broken,120,140);
assert(hits.valid);assert.equal(hits.sample,partial.coverage.signals);
// Original formal gate is intentionally frozen: >=10, >=50%, positive mean/median.
assert.match(src,/x\.stats\?\.count>=10/);
assert.match(src,/x\.stats\?\.winPct>=50/);
assert.match(src,/x\.stats\?\.avgPct>0/);
assert.match(src,/x\.stats\?\.medianPct>0/);
console.log('PASS v2.7.0.45: 20 max, 10 min unchanged, day-after-abnormal restart, historical OHLC unchanged, 120MA optional, original R1 trade functions untouched');
