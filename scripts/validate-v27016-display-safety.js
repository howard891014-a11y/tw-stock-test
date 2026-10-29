'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),lib=read('lib/resonance-lab-v1.js'),app=read('app.js');
const api=require('../lib/resonance-lab-v1.js');
assert.equal(require('../package.json').version,'2.7.0.16');
for(const tag of ['stockzone-version" content="2.7.0.16','v2.7.0.16</span>','resonance-lab-v1.js?v=2.7.0.16','app.js?v=2.7.0.16'])assert(html.includes(tag),`version ${tag}`);
for(const fn of ['entryCandidate','reachabilityProfile','selectFiveYearPlay','backtestPriceBaselines','recentPlayStudy','proposeAllocation','prioritizeTacticalAllocation'])assert.equal(typeof api[fn],'function',fn);
assert(html.includes('id="szLabCandidate" hidden aria-hidden="true"'));
assert(html.includes('id="szLabReach" hidden aria-hidden="true"'));
assert(!lib.includes('szLabOriginalReadouts'),'old standalone research card must not be created');
assert(!lib.includes('szlaHistoryCompact'),'history must be in recent mode, not a separate card');
assert(!lib.includes('歷史價格研究對照</span>'),'old history card heading removed');
assert(lib.includes('szs-reach-grid')&&lib.includes("['主要','次要','回測'].map(reachItem)"),'only 3 historic touch rates in recent renderer');
assert(lib.includes("'szLabReach','stockCodeLabel'"),'observer watches original touch data');
assert(app.includes("reachDataNode.dataset.stockCode=code"),'stock-switch data protection');
assert(!lib.includes('既有交易計畫：${esc(lockedPlay)}'));
assert(!lib.includes('持股 ${numberLabel(h.shares)} 股 · 均價'));
assert(!lib.includes('研究建議，尚未實際執行；只調整倉位建議'));
assert(lib.includes('研究價格觸及率')===false||lib.includes('歷史價格觸及率'));
assert(lib.includes('五年回測績效'),'backtest heading retained');
// Freeze hashes of key formulas relative to v14; none are modified for display refactoring.
const expected=[
 ['  function backtestPriceBaselines(','  function reachabilityProfile(','eb25b529b4f9015ac2188adf841ebedb5e297ddd7721a333518aa849beff04ea'],
 ['  function cleanBars(','  function avg(values)','e8996e6e97c9a0636ce20627f822b47667409c57250715e0ae8904000d410ab1']
];
for(const [from,to,digest] of expected){const a=lib.indexOf(from),b=lib.indexOf(to,a);assert(a>=0&&b>a,from);assert.equal(crypto.createHash('sha256').update(lib.slice(a,b)).digest('hex'),digest,from);}
const opts={play:'swing',baseCorePct:65,context:{valid:true,price:90,ma20:100,ma60:105,ma120:110,ret20Pct:-12,volatilityPct:7},market:'on'};
assert.equal(api.proposeAllocation(opts).corePct,50);
assert.equal(api.proposeAllocation(opts).cashPct,30);
for(const p of ['short','mixed','swing','long-swing','long']){const x=api.proposeAllocation({...opts,play:p,market:'off'});assert.strictEqual(api.prioritizeTacticalAllocation(x),x,'W3 OFF unchanged');}
const bars=[];for(let i=0;i<230;i++){const close=100+i*.18+2*Math.sin(i/12);const dt=new Date(Date.UTC(2025,0,i)).toISOString().slice(0,10);bars.push({date:dt,open:close-.25,high:close+1,low:close-1,close,volume:100000});}
const touch=api.reachabilityProfile(bars,bars.at(-1).close,bars.at(-1).close*1.18);
assert.equal(touch.valid,true);assert(touch.horizons.some(h=>h.days===20)&&touch.horizons.some(h=>h.days===40));
// v2.7.0.16 displays condition checks from the exact, unrounded values in recentPlayStudy.
assert(!lib.includes('歷史同幅度觸及比例，非獲利勝率。'));
assert(!lib.includes('執行規則：</b>'));
assert(lib.includes('class="szs-check"'));
assert(lib.includes("root.addEventListener('stockzone:recent-study',queue)"));
assert(html.includes('.expected-position[hidden]{display:none!important}'));
assert(app.includes("plan.status!=='open'"));
assert(app.includes('plan.initial?.code'));
assert(app.includes("posBox.dataset.stockCode=matched?code:''"));
const p5=api.recentPlayStudy({bars:bars.slice(-150),institutional:null});
assert(p5.valid===true);
for(const [name,check] of Object.entries({
  ma10Reached:typeof p5.inputs?.ma10==='number' && p5.conditions.ma10Reached === (bars.at(-1).close>=p5.inputs.ma10-.01),
  macdRising:typeof p5.conditions.macdRising==='boolean',
  volumeRatioAtLeastOne:typeof p5.conditions.volumeRatioAtLeastOne==='boolean',
  supportHeld:typeof p5.conditions.supportHeld==='boolean',
  ma5Stabilized:typeof p5.conditions.ma5Stabilized==='boolean'
}))assert(check,`passive indicator ${name}`);
console.log('PASS v2.7.0.16 version, original price formulas, W3 OFF, exact condition markers, hidden plan safety');
