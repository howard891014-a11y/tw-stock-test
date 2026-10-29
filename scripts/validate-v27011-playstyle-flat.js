'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const lib=fs.readFileSync(path.join(root,'lib/resonance-lab-v1.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.version,'2.7.0.11');
assert.match(html,/stockzone-version" content="2\.7\.0\.11"/);
assert.match(html,/v2\.7\.0\.11/);
assert.match(lib,/#playStyleCard>\.sz-reslab\{display:block!important\}/);
assert.doesNotMatch(lib,/<small class="szs-five-year-evidence">/);
assert.doesNotMatch(lib,/details\.innerHTML='<summary>查看詳細研究依據/);
assert.doesNotMatch(lib,/doc\.createElement\('details'\)/);
assert.doesNotMatch(lib,/szLabAllocationW3|st\.override|手動試算：/);
assert.match(lib,/const details=doc\.createElement\('div'\);details\.id='szLabOriginalReadouts'/);
assert.match(lib,/box=doc\.createElement\('section'\);box\.id='szLabAllocation'/);
assert.match(lib,/return w3Source\(lastDate\)/);
assert.match(lib,/root\.StockZoneEnsureW3\?\.\(\)/);
assert.match(app,/window\.StockZoneEnsureW3=\(\)=>loadMarketDynamic\(false\)/);
assert.doesNotMatch(html,/<div class="sz-reslab-header">/);
assert.doesNotMatch(html,/<details class="sz-reslab-method">/);
// Ensure all five-year candidate audit and base 60-day sampling remain intact.
assert.match(lib,/selectFiveYearPlay/);
assert.match(lib,/szLabBacktest/);
assert.match(lib,/prioritizeTacticalAllocation/);
// Inherited R1.5 configuration and W3-off priority calculations must not drift.
const lab=require('../lib/resonance-lab-v1.js');
const ctx={valid:true,price:90,ma20:100,ma60:105,ma120:110,ret20Pct:-12,volatilityPct:7};
const proposed=lab.proposeAllocation({baseCorePct:65,play:'swing',context:ctx,market:'on'});
assert.deepEqual([proposed.corePct,proposed.tacticalPct,proposed.cashPct],[50,20,30]);
const ordered=lab.prioritizeTacticalAllocation(proposed);
assert.deepEqual([ordered.corePct,ordered.tacticalPct,ordered.cashPct],[65,5,30]);
for(const play of ['short','mixed','swing','long-swing','long']){
 const off=lab.proposeAllocation({baseCorePct:65,play,context:ctx,market:'off'});
 assert.strictEqual(lab.prioritizeTacticalAllocation(off,{corePct:65,tacticalPct:20}),off);
}
// Price model math remains a byte-for-byte copy of the previous release.
const crypto=require('node:crypto');
for(const [begin,end] of [['  function backtestPriceBaselines(','  function reachabilityProfile('],['  function cleanBars(','  function avg(values)']]){
  const f=lib.slice(lib.indexOf(begin),lib.indexOf(end,lib.indexOf(begin)));
  const expected=begin.includes('backtestPriceBaselines')?'eb25b529b4f9015ac2188adf841ebedb5e297ddd7721a333518aa849beff04ea':'e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1';
  assert.equal(crypto.createHash('sha256').update(f).digest('hex'),expected,'Do not modify five-year or OHLC formulas');
}
console.log('v2.7.0.11: four changes, R1.5/W3-off checks and baseline math PASS');
