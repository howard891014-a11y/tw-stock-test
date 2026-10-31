'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const dir=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(dir,file),'utf8');
const app=read('app.js'),html=read('index.html'),labText=read('lib/resonance-lab-v1.js');
const pure=require('../lib/resonance-lab-v1.js');
const pkg=require('../package.json');
assert.equal(pkg.version,'2.7.0.43');
for(const s of ['content="2.7.0.43"','v2.7.0.43</span>','app.js?v=2.7.0.43','resonance-lab-v1.js?v=2.7.0.43'])assert(html.includes(s),s);
for(const text of [html,labText,app]){
  assert(!text.includes('szLabRunBacktest'),'no old manual backtest DOM element, event or synthetic click');
  assert(!text.includes('按「執行五年價格基準回測」開始'),'no manual prompt');
}
assert(!labText.includes('maybeAutoRun'),'no DOM-driven auto-run');
assert(!app.includes('data-trade-baseline'),'no other dead/manual five-year ledger button');
assert.match(app,/updateFiveYearBacktest\(code,latestHistory5Y\?\.history\|\|null,historyError\)/,'five-year history load owns run');
assert.match(app,/history5Y\(code,market\)\.catch/);
assert.match(app,/technical\(code,market\)\.catch/,'technical failures independent');
assert(!app.includes("if(szLabLastStock!==code){if(select)select.value=play?.key||'swing';szLabLastStock=code;setText('szLabBacktest'"),'render cannot erase finished R1');
assert.match(app,/priceBacktest:window\.StockZoneResonanceLab\?\.getCurrentFiveYearReport\?\.\(code\)/);
// Original R1 and OHLC checks cannot change while fixing the lifecycle.
const section=(src,a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const frozenR1Hash=[
 ['  function backtestPriceBaselines(','  function reachabilityProfile(','eb25b529b4f9015ac2188adf841ebedb5e297ddd7721a333518aa849beff04ea'],
 ['  function cleanBars(','  function avg(values)','e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1'],
 ['  function classifyFiveYearPlay(','  function createSnapshot(','ce92d92b9d646548985e41542b38c6a5305a0a1c6daa696b14ec99fe05050ea5']
];
for(const [a,b,expected] of frozenR1Hash){
  assert.equal(sha(section(labText,a,b)),expected,`R1 source unchanged from .40: ${a}`);
}
function generate(n=1211){
  const out=[],d=new Date('2021-10-01T00:00:00.000Z');let i=0;
  while(out.length<n){if(d.getUTCDay()!==0&&d.getUTCDay()!==6){const close=100+out.length*.055;out.push({date:d.toISOString().slice(0,10),open:close-.1,high:close+.8,low:close-.8,close,volume:10000});}d.setUTCDate(d.getUTCDate()+1);i++;if(i>4000)throw Error('too many');}
  return out;
}
const good=generate();
const report=pure.backtestPriceBaselines(good,{warmup:120,stride:60,costPct:.5});
assert(report.valid,'full five-year source passes');
assert.equal(report.coverage.signals,18,'18 spaced samples without replacing R1 method');
const broken=good.map(x=>({...x}));
for(let i=550;i<broken.length;i++){for(const k of ['open','high','low','close'])broken[i][k]*=2.09;}
const gap=pure.backtestPriceBaselines(broken,{warmup:120,stride:60,costPct:.5});
assert.equal(gap.valid,false,'corporate-action discontinuity must NOT be silently accepted');
assert(gap.coverage.largeJumps.length>0);
// Live publication API runs the original pure R1, rejects invalid sources, and guards stock-switch races.
const a=labText.indexOf('    // R1 source remains a pure calculation.');
const b=labText.indexOf('  // R1.5 第二階段：',a);
assert(a>0&&b>a);
let code='2603';const timers=[],events=[],rendered=[];
const stub={api:{...pure},state:{code:'',report:null,error:null,date:null},doc:{getElementById(){return{textContent:`長榮 (${code})`}}},root:{setTimeout(fn){timers.push(fn)},dispatchEvent(e){events.push(e.type)},Event:class{constructor(type){this.type=type}}},schedule(){rendered.push(code)}};
vm.createContext(stub);
vm.runInContext('if(true){\n'+labText.slice(a,b),stub);
const first=stub.api.evaluateFiveYearForCode('2603',good);
assert(first.report.valid&&first.published);
assert.equal(stub.api.fiveYearPlay.code,'2603');
assert.equal(stub.api.fiveYearPlay.count,18);
assert.equal(stub.api.getCurrentFiveYearReport('2603').coverage.signals,18);
const unclean=stub.api.evaluateFiveYearForCode('2603',broken);
assert.equal(unclean.report.valid,false);
assert.equal(stub.api.fiveYearPlay.status,'invalid');
assert(stub.state.error.includes('35%'));
const noSource=stub.api.evaluateFiveYearForCode('2603',null,{sourceError:'Yahoo HTTP 502'});
assert.equal(noSource.report.valid,false);
assert.match(stub.state.error,/Yahoo HTTP 502/);
code='2330';const count=rendered.length;
const old=stub.api.evaluateFiveYearForCode('2603',good);
assert.equal(old.published,false);
assert.equal(rendered.length,count);
const next=stub.api.evaluateFiveYearForCode('2330',good);
assert(next.published);
assert.equal(stub.api.fiveYearPlay.code,'2330');
assert.equal(stub.api.getCurrentFiveYearReport('2603'),null);
console.log('v2.7.0.43 PASS — original R1 and OHLC hashes, real 18-sample backtest, source error and corporate-action rejection, cross-stock isolation, no DOM/manual run');
