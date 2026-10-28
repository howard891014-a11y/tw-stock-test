#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'app.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engine=require('../lib/unified-trade-decision.js');
const pkg=require('../package.json');
const example={price:100,
 play:{key:'swing',period:'波段',operationProfile:{basePct:60,tacticalPct:40}},
 recent:{valid:true,status:'符合小量試單觀察條件',trialPct:20,signalStrength:'strong',support:{value:96},resistance:{value:108},trial:'等支撐確認',add:'站上108後量能確認',stop:'收盤跌破96'},
 risk:{valid:true,score:22,trimTriggered:false,exitTriggered:false,summary:'結構尚可'},
 expected:{plan:{levels:[{value:112},{value:126}]},downside:{levels:[{value:92},{value:85}]}},
 market:{regime:'on',warning:false,verified:true},holding:false};
const u=x=>engine.decision({...example,...x});
const ok=u();
assert(ok.valid);assert.equal(ok.trialPct,10);assert.equal(ok.trial[0],100);assert.equal(ok.entry,null);assert.equal(ok.entryReady,false);
assert.equal(ok.entryCandidate[0],108);assert.equal(ok.trim[0],112);assert.equal(ok.exit[0],126);
assert.equal(ok.trimStop[0],96);assert.equal(ok.fullStop[0],92);
assert.match(ok.action,/試單 10%/);
assert.match(ok.entryNote,/尚未持股/);
assert.equal(ok.stopSource,'current-downside-plan');
assert.equal(u({recent:{valid:true,trialPct:0,status:'不宜試單'}}).trialPct,0);
assert.equal(u({recent:{valid:true,trialPct:0,status:'不宜試單'}}).trial,null);
assert.equal(u({recent:{valid:false,trialPct:20}}).trialPct,0,'missing data must not authorize any entry');
assert.equal(u({risk:{score:75}}).trialPct,0,'severe risk must override entry');
assert.equal(u({risk:{score:34,trimTriggered:true}}).trialPct,0,'trim risk must override entry');
assert.equal(u({risk:{score:55,exitTriggered:true}}).defenseMode,'exit');
assert.equal(u({market:{regime:'off',verified:true},holding:false}).trialPct,0,'fresh RiskOff blocks new entries');
assert.equal(u({market:{regime:'off',verified:true},holding:true,play:{key:'mixed'}}).offExit,true);
assert.equal(u({market:{regime:'off',verified:true},holding:true,play:{key:'short'}}).defenseMode,'exit');
assert.equal(u({market:{regime:'off',verified:true},holding:true,play:{key:'long',period:'長期'}}).offTactical,true);
assert.equal(u({market:{regime:'off',verified:true},holding:true,play:{key:'long-swing',period:'長波'}}).offExit,false,'core must not be forced out');
assert.equal(u({market:{regime:'off',verified:false}}).trialPct,5,'stale RiskOff is not a verified trade signal; unknown market caps trial at 10');
assert.equal(u({market:{regime:'on',warning:true,verified:true}}).trialPct,5,'warning caps trial');
assert.equal(u({market:{regime:null,verified:false}}).trialPct,5,'unknown market caps trial');
assert.equal(u({play:{key:'long',operationProfile:{basePct:85,tacticalPct:15}}}).trialPct,10);
assert.equal(u({recent:{valid:true,trialPct:20,signalStrength:'strong',support:null,resistance:null}}).trial[0],100,'risk trial no longer needs exact support; verified downside remains mandatory');
assert.equal(u({recent:{valid:true,trialPct:20,signalStrength:'strong',support:null,resistance:null}}).entryCandidate,null);
const nodown=u({expected:{plan:{levels:[{value:120}]},downside:{levels:[]}}});assert.equal(nodown.fullStop,null,'no invented stop');assert.equal(nodown.exit,null,'no invented second target');
const noaim=u({expected:{plan:{levels:[]},downside:{levels:[{value:95}]}}});assert.equal(noaim.trim,null,'no invented resonance target');
assert.equal(u({expected:{plan:{levels:[{value:98},{value:125}]},downside:{levels:[{value:92}]}}}).trim,null,'no target below current is called profit target');
assert.equal(u({risk:{score:70,exitTriggered:true},holding:true,play:{key:'long',period:'長期'}}).offExit,false,'long-term risk needs management not off-imposed liquidation');
assert(!src.includes('merger.decide('),'legacy three-engine must not produce independent advice');
const live=src.slice(src.indexOf('function renderDecision('),src.indexOf('// 第一批：近期技術操作提示'));
assert(live.includes('unifiedDecisionForPlay('));
assert(!live.includes('buildDecisionPlan('));assert(!live.includes('buildAdaptiveStopModel('));assert(!live.includes('applyDecisionRisk('));
assert(src.includes('function renderUnifiedRecentPlay('));
assert(src.includes('setText("overviewFinalNext",decision?.action'));
assert(src.includes('const risk=buildDecisionRisk(locked,price,expected),decision=unifiedDecisionForPlay(locked,'),'locked holdings consume same decision and retain play');
assert(src.includes('play:original.play,playKey:key,analysisPlayKey:key'),'original play remains frozen');
assert(src.includes('const key=plan?.initial?.playKey'),'lock key still comes from transaction initial');
assert(src.includes('source:"V4鎖定玩法／共振／新版單一買賣決策畫面輸出'),'snapshots point to updated output');
assert(src.includes("set('szV33Summary',action)"),'research panel copies same formal action');
assert(src.includes('function historicalSimilarWinRate('));
assert(src.includes('const up=upsidePct,down=Math.abs(downsidePct)'),'history checks actual target with no upside cap');
assert(src.includes('const wr=historicalSimilarWinRate(play,price,firstUp,nearestDown);'),'history checks exact main target and current defense');
assert(!src.includes('fallbackUp=play?.key'),'no fictional historical target');
assert(html.includes('補倉觀察（回測／追價）</span><strong id="decisionEntryPrice"'),'no "immediate all in" language');
assert(html.includes('補倉觀察（雙模式）</span><strong class="overview-metric-value" id="overviewEntryPrice"'));
assert(html.includes('單一決策'));
assert(html.includes('lib/unified-trade-decision.js?v='+pkg.version));
assert(html.indexOf('lib/unified-trade-decision.js?v='+pkg.version)<html.indexOf('app.js?v='+pkg.version));
assert.match(pkg.version,/^2\.6\.9\.2[012]$/);
// Exact up/down historical target test uses historical method unchanged except removing the invalid clipping.
const begin=src.indexOf('function historicalSimilarWinRate('),end=src.indexOf('\nfunction ',begin+40);
const rows=[];for(let i=0;i<320;i++)rows.push({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),close:100,high:i>60?140:100,low:100});
const ctx={latestHistory5Y:{history:rows},latestFiveStageResult:null,positionNumber:x=>x,seasonality5Y:()=>({valid:false}),playRowClose:r=>r.close,
 shortReturnN:()=>0,stageRet:()=>0,stageSmaAt:()=>100,histRetAt:()=>0,histMaAt:()=>100,histCloseAt:(r,i)=>r[i].close,
 historyDateKey:r=>r.date,historyRecencyWeight:()=>1,playRowHigh:r=>r.high,swingLow:r=>r.low,stagePct:(x,b)=>(x/b-1)*100,
 histWeightedPercentile:()=>0,stageClamp:(x,a,b)=>Math.min(b,Math.max(a,x)),Math,Number,Date,Map};
vm.createContext(ctx);vm.runInContext(src.slice(begin,end),ctx);
const hist=ctx.historicalSimilarWinRate({key:'long-swing'},100,35,-7);
assert(hist.valid);assert.equal(hist.up,35);assert.equal(hist.down,7);assert.equal(hist.rate,100);
const not=ctx.historicalSimilarWinRate({key:'long-swing'},100,45,-7);assert.equal(not.up,45);assert.equal(not.rate,0,'must not compute 28% on displayed 45% target');
assert.equal(ctx.historicalSimilarWinRate({key:'long-swing'},100,null,-7).valid,false);
assert.equal(ctx.historicalSimilarWinRate({key:'long-swing'},100,35,null).valid,false);
console.log('PASS v2.6.9.22 compatibility: one formal trade decision, recent entry gate, W3 off/warning/stale, locked core, exact resonance hit-rate, same stop/target UI, research isolation, missing-input protection.');
