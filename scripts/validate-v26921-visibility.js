#!/usr/bin/env node
'use strict';
const containsCenter=(band,center)=>Array.isArray(band)&&band.length===2&&band[0]>0&&band[0]<=center&&band[1]>=center&&band[1]>band[0];

const assert=require('node:assert/strict');
const fs=require('node:fs');
const engine=require('../lib/unified-trade-decision.js');
const src=fs.readFileSync(require('node:path').resolve(__dirname,'../app.js'),'utf8');
const html=fs.readFileSync(require('node:path').resolve(__dirname,'../index.html'),'utf8');
const sample={price:100,play:{key:'swing',period:'波段',operationProfile:{basePct:55,tacticalPct:45}},
 recent:{valid:true,status:'小量試單條件尚未齊',trialPct:0,signalStrength:'blocked',support:{value:96},resistance:{value:108},trial:'等待支撐確認',add:'突破108再確認'},
 risk:{valid:true,score:30,trimTriggered:false,exitTriggered:false},
 expected:{plan:{levels:[{value:115},{value:124}]},downside:{levels:[{value:90}]}},
 market:{verified:true,regime:'on'},holding:false};
const run=change=>engine.decision({...sample,...change});
// Previously both prices disappeared whenever trialPct=0; do not regress.
let d=run();
assert.equal(d.trial,null,'0% should not become an authorized order');
assert(containsCenter(d.trialCandidate,96),'confirmed support is visible while entry remains blocked');
assert(containsCenter(d.entryCandidate,108),'confirmed resistance is visible while entry remains blocked');
assert.equal(d.trialEligible,false);assert.equal(d.blocked,true);
assert.match(d.trialNote,/目前不建議買進/);assert.match(d.entryNote,/尚未持股/);
d=run({risk:{score:82,trimTriggered:true,exitTriggered:false},recent:{...sample.recent,trialPct:20,signalStrength:'strong'}});
assert.equal(d.trialPct,0);assert(containsCenter(d.trialCandidate,96));assert(containsCenter(d.entryCandidate,108));
assert.match(d.trialNote,/風控/);
d=run({market:{verified:true,regime:'off'},recent:{...sample.recent,trialPct:20,signalStrength:'strong'}});
assert.equal(d.trialPct,0,'risk-off still forbids new entries');
assert.equal(d.trial,null);assert(containsCenter(d.trialCandidate,96));assert(containsCenter(d.entryCandidate,108));
assert.match(d.trialNote,/空頭/);
d=run({recent:{...sample.recent,trialPct:20,signalStrength:'strong'}});
assert.equal(d.trialPct,10);assert.equal(d.trialEligible,true);assert(containsCenter(d.trial,100));
assert(containsCenter(d.entryCandidate,108));assert.equal(d.entryReady,false);
d=run({recent:{valid:false,trialPct:20}});
assert.equal(d.trial,null);assert.equal(d.trialCandidate,null);assert.equal(d.entryCandidate,null);
d=run({recent:{...sample.recent,trialPct:0,support:null,resistance:null}});
assert.equal(d.trialCandidate,null);assert.equal(d.entryCandidate,null,'missing levels must never be invented');
d=run({recent:{...sample.recent,trialPct:0,support:{value:105},resistance:{value:95}}});
assert.equal(d.trialCandidate,null);assert.equal(d.entryCandidate,null,'crossed/invalid levels must never be invented');
assert(src.includes('decision?.trial??decision?.trialCandidate'), 'overview reads visible candidate');
assert(src.includes('d.trial??d.trialCandidate'), 'decision card reads visible candidate');
assert(src.includes('decision.holding?null:(decision.trial??decision.trialCandidate)'), 'holding plan suppresses first-entry trial after holding');
assert(src.includes('trialEligible:!!decision.trialEligible'), 'holding plans preserve difference between reference and permission');
assert(html.includes('v2.6.9.23')&&html.includes('unified-trade-decision.js?v=2.6.9.23'));
console.log('PASS v2.6.9.22 compatibility: available trial/add prices remain visible through market and risk veto; permissions unchanged, no fabricated price; overview, detail, holdings consistent.');
