#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),recent=require('../lib/recent-play-advice.js');
const engine=require('../lib/unified-trade-decision.js'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),pkg=require('../package.json');
assert.equal(pkg.version,'2.6.9.24');
const close=(a,b)=>Math.abs(a-b)<1e-7;
const band=(v,center,label)=>{
 assert(Array.isArray(v)&&v.length===2&&v[0]>0&&v[1]>v[0],`${label}: required real interval`);
 assert(v[0]<=center&&v[1]>=center,`${label}: center must be preserved`);
};
const recentData={valid:true,signalStrength:'strong',trialPct:10,data:{vol20:2.8},
 support:{value:3110,label:'S1',lower:3085,upper:3140},
 resistance:{value:3330,label:'R1',lower:3288.1,upper:3429.6},
 entrySignals:{pullback:false,chase:false,pullNote:'待回測',chaseNote:'待突破'}};
const expected={plan:{levels:[{value:3330},{value:3667}],resonance:{bandwidthPct:4.2,
 main:{center:3330,min:3288.1,max:3429.6},secondary:{center:3667,min:3628,max:3698}}},
 downside:{levels:[{value:3191},{value:3085}]}};
const sample={price:3200,recent:recentData,expected,holding:false,risk:{valid:true,score:51},
 play:{key:'swing',period:'波段',operationProfile:{basePct:60,tacticalPct:40}},market:{regime:'on',verified:true}};
const decision=(change={})=>engine.decision({...sample,...change});
let d=decision();
assert(d.valid&&d.trialEligible&&d.trialPct===10);
band(d.trial,3200,'initial trial 3200');
assert.deepEqual(d.entryCandidate,[3288.1,3429.6], 'R1 3288.1~3429.6 must not collapse into 3330~3330');
assert.deepEqual(d.trim,[3288.1,3429.6], 'profit trim should use real resonance contributor range');
assert.deepEqual(d.exit,[3628,3698], 'extension should use second resonance contributors');
band(d.fullStop,3191,'structural defense 3191');
assert.equal(d.fullStopCenter,3191,'full stop risk trigger remains original exact center');
assert.equal(d.trimStop,null,'no believable trim stop must stay null');
assert.equal(d.trimCenter,3330);assert.equal(d.exitCenter,3667);
assert.equal(d.zoneBasis.entry,'SR8-confirmed-range');
assert.match(d.trialNote,/觀察帶隨即時價重新計算/);
assert.match(d.fullStopNote,/不改原出場觸發價/);
const dVol=decision({recent:{...recentData,data:{vol20:5.1}}});
assert(dVol.trial[0]<d.trial[0], 'volatility increase expands trial observation below current price');
assert(dVol.fullStop[0]<d.fullStop[0], 'volatility increase widens visual stop buffer');
assert.equal(dVol.fullStopCenter,3191);
assert.equal(dVol.trialPct,d.trialPct, 'display-band width must not alter trial permission');
const dOff=decision({market:{verified:true,regime:'off'}});
assert(!dOff.trialEligible&&dOff.trial===null&&dOff.trialPct===0);
assert.deepEqual(dOff.entryCandidate,[3288.1,3429.6], 'risk veto must not erase factual price zones');
assert.equal(dOff.fullStopCenter,3191);
const missing=decision({recent:{...recentData,valid:false,trialPct:0}});
assert.equal(missing.trial,null);assert.equal(missing.trialEligible,false);
const holding=decision({holding:true,recent:{...recentData,entrySignals:{pullback:true,chase:false}}});
assert(!holding.trialEligible&&holding.entryReady);
band(holding.entry,3200,'holding-only confirmed entry');
assert.equal(holding.addPct,null);
const noTargets=decision({expected:{plan:{levels:[]},downside:expected.downside}});
assert.equal(noTargets.trim,null);assert.equal(noTargets.exit,null);
const badRange=decision({recent:{...recentData,resistance:{value:3330,lower:2500,upper:4200}}});
assert(badRange.entryCandidate[0]>3000&&badRange.entryCandidate[1]<3600,
 'malformed/overwide SR8 band must not pass through');
const h=Array.from({length:65},(_,i)=>({date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),close:96+i*.06}));
const rr=recent.evaluate({price:100,technical:{ma:{ma5:99,ma10:98.5,ma20:97,ma60:92},
 momentum:{rsi14:55,histogram:1},bollinger:{lower:91,upper:105},volume:{ratio20:1.3},history:h},
 kd:{k:56,d:47},supports:[{label:'S1',value:98,lower:97,upper:100}],resistances:[{label:'R1',value:103,lower:102,upper:106}],
 institution:{label:'中性'},financing:{label:'正常'}});
assert(rr.valid);
assert.equal(rr.support.lower,97);assert.equal(rr.support.upper,100);
assert.equal(rr.resistance.lower,102);assert.equal(rr.resistance.upper,106);
assert(app.includes("const srItem=(label,key)=>({label,value:validSR(key),lower:levels[key]?.confidence==='projected'?null:levels[key]?.lower"));
assert(app.includes('const trim=positionNumber(d?.trimStopCenter),full=positionNumber(d?.fullStopCenter)'),
 'risk rate must not silently move from center to range lower edge');
assert(app.includes('overviewZoneIntText(decision?.entry??decision?.entryCandidate)'));
assert(app.includes('targetZoneText(d.entry??d.entryCandidate)'));
assert(html.includes('v2.6.9.24')&&html.includes('app.js?v=2.6.9.24'));
console.log('PASS v2.6.9.24: non-degenerate trial/stop bands, exact SR8 R1, resonance target spreads, stable centers, vol adaptation, off/holding gates, real SR8 bounds, risk panel alignment.');
