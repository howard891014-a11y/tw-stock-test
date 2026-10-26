'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const api=require('../lib/position-play-v4.js'),orchestrator=require('../lib/trade-orchestrator-v4.js');
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS',name)}
function bars(fn,n=1200,{annotated=true,warning=false}={}){
  return Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2021,0,1+i)).toISOString().slice(0,10),close:fn(i),volume:10000,...(annotated?{w3Regime:'RiskOn',w3Warning:warning}:{})}));
}
function quarters(n=24,cb=i=>({eps:5+i*.2,revenue:100+i*5})){
  return Array.from({length:n},(_,i)=>({year:2020+Math.floor(i/4),quarterNo:i%4+1,...cb(i)}));
}
const growing=quarters(),assessment={companyQuality:80,continuation:83,stability:{score:85},risk:{score:0},operationalConfidence:90};
const longGrowth=bars(i=>100*Math.exp(i*.0017)*(1+Math.sin(i/25)*.06)),longRange=bars(i=>100*(1+Math.sin(i/23)*.4));
const continuous=(n=252,values=[100,110,123,138],opts={})=>bars(i=>values[Math.floor(i/63)],n,opts);
const lastEightUp=quarters(8,i=>({eps:i<4?3:6,revenue:i<4?100:130}));
const lastEightDown=quarters(8,i=>({eps:i<4?8:4,revenue:i<4?100:80}));
const detail=(price,fin)=>api.mediumReview({midBars:price,quarters:api.orderedQuarters(fin)});
check('longHorizon removes newest 252 days from long-term price baseline',()=>{const x=api.longHorizon(longGrowth,growing);assert.equal(x.baseBars.length,948);assert.equal(x.midBars.length,252);assert.equal(x.baseQuarterRows.length,20);assert.equal(x.lastQuarterRows.length,4)});
check('long baseline ignores recent 1-3mo short-term quotation change',()=>{const newPrices=longGrowth.map((x,i)=>({...x,close:i>=1140?x.close*.35:x.close}));const x=api.longHorizon(newPrices,growing);const y=api.longHorizon(longGrowth,growing);assert.deepEqual(x.baseBars.map(x=>x.close),y.baseBars.map(x=>x.close));assert.equal(api.structuralHistory(x.baseBars).tier,api.structuralHistory(y.baseBars).tier)});
check('quarter ordering handles most recent rows returned in reverse order',()=>{const x=api.orderedQuarters(growing.toReversed());assert.equal(x[0][0],2020*4);assert.equal(x.at(-1)[0],2025*4+3)});
check('unverified industry moat is not asserted as verified',()=>{assert.equal(api.fundamentalLongBasis(assessment,growing.slice(0,-4),growing).durability.moatVerified,false)});
check('2-5 year baseline financial grade uses only older quarter history',()=>{const f=api.fundamentalLongBasis(assessment,growing.slice(0,-4),growing);assert(f.longBaselineVerified);assert(f.complete);assert(['strong','good'].includes(f.tier))});
check('short fundamentals do not become long term confirmed',()=>{const f=api.fundamentalLongBasis(assessment,growing.slice(0,8),growing);assert(!f.complete)});
check('long trend with sufficient historical periods has persistent classification',()=>{const p=api.structuralHistory(longGrowth.slice(0,-252));assert(p.sufficient&&p.tier==='persistent')});
check('range stock is not made persistent by isolated 3-month momentum',()=>{const r=longRange.map((x,i)=>({...x,close:i>1150?x.close*2:x.close}));assert.notEqual(api.structuralHistory(r.slice(0,-252)).tier,'persistent')});
check('W3 RiskOn with warning unspecified NOT confirmed normal',()=>{const p=api.structuralHistory(longGrowth.map(x=>{const y={...x};delete y.w3Warning;return y}));assert(!p.marketRegimeVerified)});
check('full annotated normal price+fundamental 6-12mo improvement confirmed +5',()=>{const v=detail(continuous(),lastEightUp);assert.equal(v.delta,5);assert.equal(v.state,'confirmed_improvement')});
check('full annotated normal price+fundamental 6-12mo deterioration confirmed -5',()=>{const v=detail(continuous(252,[140,128,115,95]),lastEightDown);assert.equal(v.delta,-5);assert.equal(v.state,'confirmed_deterioration')});
check('6-12mo price improvement alone never shifts core ratio',()=>{assert.equal(detail(continuous(),quarters(8)).delta,0)});
check('6-12mo earnings improvement alone never shifts core ratio',()=>{assert.equal(detail(continuous(252,[100,100,100,100]),lastEightUp).delta,0)});
check('missing W3 tags blocks upward reclassification',()=>{const v=detail(continuous(252,[100,110,123,138],{annotated:false}),lastEightUp);assert.equal(v.state,'pending_market_validation');assert.equal(v.delta,0)});
check('W3 RiskOn without warning flag blocks upward reclassification',()=>{const r=continuous().map(x=>{const t={...x};delete t.w3Warning;return t});assert.equal(detail(r,lastEightUp).delta,0)});
check('W3 warning days excluded from each normal-market price band',()=>{const r=continuous().map((x,i)=>({...x,w3Warning:i%10===0}));const d=detail(r,lastEightUp);assert.equal(d.delta,5);assert(d.price.normal);assert(d.price.normalCounts.every(x=>x<=63&&x>=55))});
check('limited W3 normal coverage blocks all medium classification shifts',()=>{const r=continuous().map((x,i)=>({...x,w3Regime:i%2?'RiskOn':'RiskOff'}));assert.equal(detail(r,lastEightUp).delta,0)});
check('recent 60-day isolated price spike cannot change strategy',()=>{const r=continuous(252,[100,100,100,100]).map((x,i)=>({...x,close:i>=205?170:100}));assert.equal(detail(r,lastEightUp).delta,0)});
check('missing 8 consecutive quarters blocks medium reclassification',()=>{const q=lastEightUp.filter((_,i)=>i!==3);assert.equal(detail(continuous(),q).delta,0)});
check('non-positive baseline revenue blocks false YoY comparison',()=>{const q=lastEightUp.map((x,i)=>i===0?{...x,revenue:0}:x);assert.equal(detail(continuous(),q).delta,0)});
check('repeated date de-duplicated before long baseline',()=>{const r=[...longGrowth,longGrowth[5]];assert.equal(api.orderedBars(r).length,longGrowth.length)});
check('zero volume phantom day is not accepted as history sample',()=>{const r=[...longGrowth,{date:'2026-01-01',close:0,volume:0}];assert.equal(api.orderedBars(r).length,longGrowth.length)});
check('long core/medium core are separately visible with medium status',()=>{const x=api.classify({history:longGrowth,fundamentalRows:growing,fundamental:assessment});assert(x.available&&x.longBaseline&&x.medium&&x.modelVersion.endsWith('V4.2-CANDIDATE'));assert.equal(x.longHistoryDays,longGrowth.length-252)});
check('incomplete W3 history labels provisional rather than pretending official normal',()=>{const x=api.classify({history:bars(i=>100+i*.1,1000,{annotated:false}),fundamentalRows:growing,fundamental:assessment});assert(x.provisional)});
check('finance, valuation and targets cannot alter structural style by arbitrary present values',()=>{const x=api.classify({history:longGrowth,fundamentalRows:growing,fundamental:assessment}),y=api.classify({history:longGrowth,fundamentalRows:growing,fundamental:assessment,valuation:-90,targets:99999,institutional:-100,w3:'RiskOff',techScore:0});assert.equal(x.basePct,y.basePct)});
check('holdings style locked to original interval irrespective of V4.2 research recommendation',()=>{const x=api.classify({history:longGrowth,fundamentalRows:growing,fundamental:assessment,holdingLock:{styleKey:'mixed'}});assert.equal(x.locked.key,'mixed');assert(x.locked.basePct<=40&&x.locked.basePct>=25)});
check('original tactical 1.5x/2x/2.5x outputs preserved',()=>{const w={valid:true,baseLow:100,firstWave:120,pullbackLow:112,completed:true,ext15:142,ext20:152,ext25:162};assert.deepEqual(api.tacticalLevels(w,140).tiers.map(x=>x.value),[142,152,162])});
check('W3 OFF short-swing full exit still honored',()=>{const r=orchestrator.decide({w3:{regime:'RiskOff',valid:true},play:{key:'mixed'}});assert.equal(r.policy,'exit_all')});
check('resonance data quality only adjusts research confidence',()=>{const r=api.resonanceDataConfidence(80,{operationalConfidence:30});assert(r.confidence<80&&r.raw===80)});
check('six production formulas preserved as previously passed exact strings',()=>{const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');for(const target of ['function calculateSwingWave(','function calculateStockPersonality(','function buildFundamentalAssessment(','function deriveFinalPositionProfile(','function buildDecisionPlan('])assert(src.includes(target));for(const w of ['weight:.40','weight:.45','weight:.15'])assert(src.includes(w));assert(src.includes('const operationProfile=deriveFinalPositionProfile(longEngine,targetSignal)'))});
check('version and V4.2 research label match',()=>{const pkg=require('../package.json');assert.equal(pkg.version,'2.6.8.29');const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');assert(html.includes('V4.2 長期基準＋中期轉型｜研究對照'));assert(html.includes('app.js?v=2.6.8.29'))});
console.log(`RESULT ${passed}/${passed} passed`);
