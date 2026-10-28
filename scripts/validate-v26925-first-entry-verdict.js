#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const pkg=require('../package.json');
const current=require('../lib/unified-trade-decision');
assert.equal(pkg.version,'2.6.9.25');
const validRecent={valid:true,signalStrength:'strong',trialPct:10,data:{vol20:2.5},
 support:{value:1275,lower:1270,upper:1302},resistance:{value:1330,lower:1329,upper:1388},
 entrySignals:{pullback:false,chase:false,pullNote:'待回測確認',chaseNote:'待放量突破'}};
const common={price:1350,play:{key:'swing',period:'波段',operationProfile:{tacticalPct:40}},
 expected:{plan:{levels:[{value:1455},{value:1680}],resonance:{}},downside:{levels:[{value:1285}]}},
 market:{verified:true,regime:'on',warning:false},risk:{valid:true,score:23,trimTriggered:false,exitTriggered:false,summary:'正常'},
 recent:validRecent,holding:false};
function inspect(testCase){
 const d=current.decision(testCase);
 assert.equal(d.fullStopCenter,1285,'original structural stop must not be changed');
 return [d,current.entryGuidance(d,testCase.price)];
}
const [trial,entryTrial]=inspect(common);
assert.equal(trial.trialEligible,true);
assert.equal(entryTrial.status,'trial');
assert.match(entryTrial.title,/現價可首次試單 10%/);
assert.match(entryTrial.detail,/空倉/);
// Entering a historical "supplemental observation band" when FLAT does not authorize supplemental buy.
const inside={...common,recent:{...validRecent,resistance:{value:1360,lower:1329,upper:1388}}};
const [inBand,entryBand]=inspect(inside);
assert.equal(inBand.holding,false);
assert.equal(inBand.entryReady,false,'flat does not trigger an add');
assert.equal(entryBand.status,'trial');
assert.match(entryBand.detail,/現價已在補倉觀察價帶/);
const warned={...inside,risk:{...common.risk,trimTriggered:true,score:42,summary:'跌破MA10、MA20'}};
const [blocked,veto]=inspect(warned);
assert.equal(blocked.trialEligible,false);
assert.equal(veto.status,'block');
assert.match(veto.title,/暫不進場/);
assert.match(veto.detail,/風控已提示走弱/);
assert.match(blocked.action,/空倉.*暫不首次試單/);
const [exitBlock,exitVeto]=inspect({...inside,risk:{...common.risk,exitTriggered:true}});
assert.equal(exitVeto.status,'block');
assert.match(exitBlock.action,/空倉.*暫不首次進場/);
const [off,offVeto]=inspect({...inside,market:{verified:true,regime:'off'}});
assert.equal(off.trialEligible,false);assert.match(offVeto.detail,/空頭/);
const [noData,noDataVeto]=inspect({...inside,recent:{...validRecent,valid:false}});
assert.equal(noDataVeto.status,'block');assert.match(noDataVeto.detail,/資料不足/);
const [holding,heldNote]=inspect({...common,holding:true,recent:{...validRecent,entrySignals:{pullback:true,chase:false}}});
assert.equal(holding.trialEligible,false);assert.equal(holding.entryReady,true);
assert.equal(heldNote.status,'add');assert.match(heldNote.title,/回測補倉/);
const [waiting,waitNote]=inspect({...common,holding:true});
assert.equal(waitNote.status,'wait');assert.equal(waiting.entryReady,false);
const empty=current.entryGuidance(null,1350);
assert.equal(empty.status,'wait');
for(const k of ['overviewEntryVerdict','decisionEntryVerdict','overviewTrialLabel','overviewEntryLabel','decisionTrialLabel','decisionEntryLabel']){
 assert(html.includes('id="'+k+'"'),`missing ${k}`);
}
for(const key of ['function szRenderEntryVerdict','function szRenderDecisionLabels',"szRenderEntryVerdict(decision,expected.price,'overview')","szRenderEntryVerdict(d,price,'decision')","szRenderEntryVerdict(null,null,'overview')","szRenderEntryVerdict(null,null,'decision')"]){assert(app.includes(key),`missing wiring: ${key}`)}
assert(html.includes('app.js?v=2.6.9.25'));
assert(html.includes('unified-trade-decision.js?v=2.6.9.25'));
console.log('PASS .25: flat price inside supplemental observation band -> first-entry 5/10% or risk veto; holdings-only add; zero invented fills; current trade prices and defense center checked; overview/detail/reset UI wired');
