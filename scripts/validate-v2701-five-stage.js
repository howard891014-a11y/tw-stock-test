/** v2.7.0.1 regression: test the shipped stage code on fully as-of synthetic OHLCV. */
const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
const start=app.indexOf('function stageNum(v){'),end=app.indexOf('\nfunction resetFiveStage(',start);
assert(start>=0&&end>start);
const scope=vm.createContext({});vm.runInContext(app.slice(start,end),scope);
function moving(a,n){return a.slice(-n).reduce((x,y)=>x+y,0)/n}
function data(vals,rsi=55){
 const history=vals.map((v,i)=>({date:`d${i}`,close:v,open:i?vals[i-1]:v,high:v*1.008,low:v*.992,volume:10000}));
 const p=vals.at(-1),m={ma5:moving(vals,5),ma10:moving(vals,10),ma20:moving(vals,20),ma60:moving(vals,60)};
 return {history,price:p,ma:m,bias:{ma20:(p/m.ma20-1)*100,ma5:(p/m.ma5-1)*100},momentum:{rsi14:rsi,histogram:p>m.ma20?1:-1},volume:{ratio20:1.2},bollinger:{upper:m.ma20*1.12,lower:m.ma20*.88}};
}
const collect=(fn,n=180)=>Array.from({length:n},(_,i)=>Number(fn(i).toFixed(4)));
let patterns=[
 ['descending',collect(i=>180-i*.5),1],
 ['base-low',collect(i=>i<130?175-i*.45:116.5+Math.sin(i*.34)*.6),1],
 ['early-reversal',collect(i=>i<171?170-i*.34:111.86+(i-171)*.55),2],
 ['trend-climb',collect(i=>100+i*.38+Math.sin(i*.23)*1.1),3],
 ['strong-accelerate',collect(i=>i<162?100+i*.3:148.6+(i-162)*1.48),4],
 ['high-stall',collect(i=>i<153?100+i*.54:182.62+Math.sin(i*.7)*.6),5],
 ['sideways',collect(i=>110+Math.sin(i*.18)*5),5],
 ['rising-hot-rsi',collect(i=>100+i*.38),3]
];
for(const [name,values,expect] of patterns){const r=scope.calculateFiveStage(data(values,name==='rising-hot-rsi'?85:name==='strong-accelerate'?72:52),values.at(-1));console.log(name,r.stage,r.name,r.substate,'(expect',expect,')');if(expect!==null)assert.strictEqual(r.stage,expect,`${name} stage wrong`);}
assert(html.indexOf('id="stagePositionCard"')>html.indexOf('class="overview-outline"')&&html.indexOf('id="stagePositionCard"')<html.indexOf('id="overviewResonanceCard"'),'stage card needs to be above overview resonance');
assert.strictEqual((html.match(/id="stagePositionCard"/g)||[]).length,1,'stage id duplicate');
assert(!html.includes('id="stagePositionCard" data-view-panel="analysis"'),'stage should not stay in analysis');
const current=JSON.parse(fs.readFileSync('package.json','utf8')).version;
assert(html.includes(`v${current}`)&&html.includes(`app.js?v=${current}`),'current app version must be consistent');
const src=app.slice(app.indexOf('function calculateLegacyStageForExistingScoring(t,currentPrice){'),app.indexOf('\n// v2.7.0.1 — 單一主要波段'))
  .trimEnd().replace('calculateLegacyStageForExistingScoring','calculateFiveStage');
const legacyHash=crypto.createHash('sha256').update(src).digest('hex');
assert.strictEqual(legacyHash,'e215377898b10938ebe14bc7e5f258533e8e3082fd26186b759d286d5140c746','legacy trading model must be unchanged');
assert(app.includes('latestFiveStagePositionResult=r;latestFiveStageResult=legacy??r'),'new display must not alter old strategy stage input');
console.log('v2.7.0.1 stage/UI smoke validation PASS — legacy strategy source preserved');
