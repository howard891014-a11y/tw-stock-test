#!/usr/bin/env node
'use strict';
const containsCenter=(band,center)=>Array.isArray(band)&&band.length===2&&band[0]>0&&band[0]<=center&&band[1]>=center&&band[1]>band[0];

const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const recent=require('../lib/recent-play-advice.js'),engine=require('../lib/unified-trade-decision.js');
const repo=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(repo,'app.js'),'utf8'),html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const pkg=require('../package.json');
assert.equal(pkg.version,'2.6.9.23');
const history=Array.from({length:65},(_,i)=>({date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),close:96+i*.06}));
const technical={ma:{ma5:99,ma10:98.5,ma20:97,ma60:92},momentum:{rsi14:55,histogram:1},
 bollinger:{lower:91,upper:105},volume:{ratio20:1.3},history};
const kd={k:56,d:47};
const input={price:100,technical,kd,supports:[{label:'S1',value:91}],resistances:[{label:'R1',value:101}],
 institution:{label:'中性'},financing:{label:'正常'}};
const r=x=>recent.evaluate({...input,...x});
const expected={plan:{levels:[{value:117},{value:131}]},downside:{levels:[{value:89},{value:84}]}};
const sample={price:100,play:{key:'swing',period:'波段',operationProfile:{basePct:60,tacticalPct:40}},
 risk:{valid:true,score:18,trimTriggered:false,exitTriggered:false,summary:'尚未明顯惡化'},
 expected,market:{verified:true,regime:'on',warning:false},recent:r(),holding:false};
const d=(change={})=>engine.decision({...sample,...change});
// Support is 9% beneath price; resistance is 1% overhead: neither alone vetoes a SMALL trial.
assert.equal(r().valid,true);assert.equal(r().trialPct,10);
assert.equal(r().signalStrength,'strong');
assert.equal(d().trialPct,10);assert.equal(d().trialEligible,true);
assert(containsCenter(d().trial,100));assert.equal(d().entryReady,false);
assert.match(d().entryNote,/尚未持股：不可直接執行補倉/);
assert.equal(d().stopDistance,11);assert(containsCenter(d().fullStop,89));
assert.equal(d({market:{verified:true,regime:'on',warning:true}}).trialPct,5);
assert.equal(d({market:{verified:false,regime:'off'}}).trialPct,5);
assert.equal(d({market:{verified:true,regime:'off'}}).trialPct,0);
assert.equal(d({risk:{valid:true,score:82}}).trialPct,0);
assert.equal(d({risk:{valid:true,score:30,trimTriggered:true}}).trialPct,0);
assert.equal(d({risk:{valid:false,score:10}}).trialPct,0);
assert.equal(d({expected:{plan:expected.plan,downside:{levels:[]}}}).trialPct,0);
assert.equal(d({expected:{plan:expected.plan,downside:{levels:[{value:72}]}}}).trialPct,0);
assert.equal(d({expected:{plan:expected.plan,downside:{levels:[]}}}).fullStop,null);
assert.equal(d({recent:{...r(),valid:true,signalStrength:null}}).trialPct,0);
assert.equal(d({recent:{...r(),valid:false}}).trialPct,0);
assert.equal(r({technical:{...technical,ma:{...technical.ma,ma20:null}}}).valid,false);
assert.equal(r({technical:{...technical,momentum:{rsi14:55,histogram:null}}}).valid,false);
assert.equal(r({technical:{...technical,momentum:{rsi14:82,histogram:1}}}).trialPct,0);
assert.equal(r({financing:{label:'融資偏熱'}}).trialPct,0);
assert.equal(r({institution:{label:'法人偏空'}}).trialPct,0);
// Cautious trial doesn't require MACD/KD perfection or an exact buy price.
const cautious=r({technical:{...technical,volume:{ratio20:.76}}});
assert.equal(cautious.valid,true);assert.equal(cautious.trialPct,5);
assert.equal(d({recent:cautious}).trialPct,5);
assert.equal(d({recent:cautious,holding:true}).trialPct,0,'existing holdings must not emit an initial trial');
// Support that equals the price is NOT discarded.
const atSupport=r({supports:[{label:'S1',value:100}]});
assert.equal(atSupport.support.value,100);
assert.equal(atSupport.entrySignals.pullback,true);
let add=d({holding:true,recent:atSupport});
assert.equal(add.trialEligible,false);assert.equal(add.pullbackReady,true);
assert.equal(add.entryReady,true);assert.equal(add.addType,'pullback');
assert(containsCenter(add.entry,100));assert.equal(add.addPct,null);
// Breakout above a PREVIOUS resistance is a different holding-only signal.
const breakout=r({supports:[{label:'S1',value:90}],resistances:[{label:'R1',value:98},{label:'R2',value:107}]});
assert.equal(breakout.entrySignals.pullback,false);assert.equal(breakout.entrySignals.chase,true);
add=d({holding:true,recent:breakout});
assert.equal(add.entryReady,true);assert.equal(add.chaseReady,true);assert.equal(add.addType,'chase');
assert.equal(d({holding:false,recent:breakout}).entryReady,false);
assert.equal(d({holding:true,recent:breakout,market:{verified:true,regime:'off'}}).entryReady,false);
assert.equal(d({holding:true,recent:breakout,risk:{valid:true,score:80}}).entryReady,false);
assert.equal(d({holding:true,recent:breakout,expected:{plan:expected.plan,downside:{levels:[]}}}).entryReady,false);
assert.equal(d({holding:true,recent:breakout,play:{key:'short'},market:{verified:true,regime:'off'}}).offExit,true);
assert.equal(d({holding:true,recent:breakout,play:{key:'long-swing'},market:{verified:true,regime:'off'}}).offTactical,true);
assert.equal(d({holding:true,recent:breakout,play:{key:'long-swing'},market:{verified:true,regime:'off'}}).offExit,false);
assert(containsCenter(d({recent:r({technical:{...technical,momentum:{rsi14:82,histogram:1}}})}).entryCandidate,101), 'blocked action retains price reference');
// UI and position plans consume the same decision; 2 explicit modes are visible.
assert(html.includes('id="recentPlayPullback"')&&html.includes('id="recentPlayChase"'));
assert(html.includes(`lib/recent-play-advice.js?v=${pkg.version}`));
assert(html.includes(`lib/unified-trade-decision.js?v=${pkg.version}`));
assert(html.includes(`app.js?v=${pkg.version}`));
assert(html.indexOf('lib/recent-play-advice.js?v=')<html.indexOf('lib/unified-trade-decision.js?v='));
assert(html.indexOf('lib/unified-trade-decision.js?v=')<html.indexOf('app.js?v='));
assert(app.includes("setText('recentPlayPullback',d.pullbackNote)"));
assert(app.includes("setText('recentPlayChase',d.chaseNote)"));
assert(app.includes('overviewZoneIntText(decision?.entry??decision?.entryCandidate)'));
assert(app.includes('targetZoneText(d.entry??d.entryCandidate)'));
assert(app.includes('entryReady:!!decision.entryReady'));
assert(app.includes('play:original.play,playKey:key,analysisPlayKey:key'));
assert(!app.includes('merger.decide('));
console.log('PASS v2.6.9.22: 5/10% risk trial, stop/risk/W3 veto, missing data, equal support, holding-only pullback/chase, locked play, unified UI, no fabricated add size.');
