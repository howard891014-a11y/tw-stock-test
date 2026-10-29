'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'lib/resonance-lab-v1.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const pkg=require('../package.json');
const api=require('../lib/resonance-lab-v1.js');
assert.equal(pkg.version,'2.7.0.12');
for (const s of ['stockzone-version" content="2.7.0.12','v2.7.0.12</span>','resonance-lab-v1.js?v=2.7.0.12','app.js?v=2.7.0.12'])assert(html.includes(s),s);
assert(app.includes('最大浮虧')&&!app.includes('最差MAE'),'MAE title');
assert(source.includes('<b>動態倉位配置</b>'));
assert(!source.includes('第二階段｜持倉配置研究'));
assert(!source.includes('配置基準：核心'));
assert(!source.includes('<b>大盤狀態</b>'));
assert(!source.includes('<span>${esc(stat)}</span>'));
assert(source.includes('root.addEventListener?.(\'stockzone:five-year-play\',queue)'));
assert(source.includes('grid-template-columns:minmax(0,1fr) minmax(0,2fr)'));
assert(source.includes('table-layout:fixed'));
assert(!source.includes('min-width:380px'));
assert(!html.includes('min-width:430px'));
assert(source.includes('th:nth-child(1){width:28%}'));
assert(source.includes('td:first-child{text-align:left!important'));
assert(source.includes('line-height:1.4;font-variant-numeric:tabular-nums;text-align:right!important'));
assert(source.includes('if(plan?.initial?.play)return plan.initial.play'));
assert(!source.includes("return byId('szLabPlaySelect')?.value||'swing'"));
const start=source.indexOf('    function selectedPlay(plan,code) {');
const end=source.indexOf('    function render(){',start);
assert(start>0&&end>start);
const fakeApi={getCurrentFiveYearPlay(code){assert.equal(code,'6196');return {status:'selected',key:'swing'}}};
const select=vm.runInNewContext(source.slice(start,end)+'\nselectedPlay', {api:fakeApi});
assert.equal(select(null,'6196'),'swing','new research follows R1');
assert.equal(select({initial:{play:'long-swing'}},'6196'),'long-swing','locked plan always wins');
const none=vm.runInNewContext(source.slice(start,end)+'\nselectedPlay',{api:{getCurrentFiveYearPlay:()=>({status:'no-qualified'})}});
assert.equal(none(null,'6196'),null,'no fallback to legacy selection');
// R1, allocation and W3 original math must remain unchanged.
for(const [begin,end,expected] of [
['  function backtestPriceBaselines(','  function reachabilityProfile(','eb25b529b4f9015ac2188adf841ebedb5e297ddd7721a333518aa849beff04ea'],
['  function cleanBars(','  function avg(values)','e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1']]){
 const i=source.indexOf(begin),j=source.indexOf(end,i);assert(i>=0&&j>i);assert.equal(crypto.createHash('sha256').update(source.slice(i,j)).digest('hex'),expected);
}
const ctx={valid:true,price:90,ma20:100,ma60:105,ma120:110,ret20Pct:-12,volatilityPct:7};
const raw=api.proposeAllocation({baseCorePct:65,play:'swing',context:ctx,market:'on'});
assert.deepEqual([raw.corePct,raw.tacticalPct,raw.cashPct],[50,20,30]);
const priority=api.prioritizeTacticalAllocation(raw);
assert.deepEqual([priority.corePct,priority.tacticalPct,priority.cashPct],[65,5,30]);
for(const play of ['short','mixed','swing','long-swing','long']){
  const off=api.proposeAllocation({baseCorePct:65,play,context:ctx,market:'off'});
  assert.strictEqual(api.prioritizeTacticalAllocation(off),off);
}
console.log('PASS v2.7.0.12: R1 source, locked plans, labels, responsive R1 table, frozen R1 math and W3 allocation');
