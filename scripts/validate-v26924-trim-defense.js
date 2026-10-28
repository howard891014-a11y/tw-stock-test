#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const decision=require('../lib/unified-trade-decision.js').decision;
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const pkg=require('../package.json');
assert.equal(pkg.version,'2.6.9.24');
const recent={valid:true,signalStrength:'strong',trialPct:10,
  data:{vol20:2.5},support:{value:1329,lower:1320,upper:1388},
  resistance:{value:1405,lower:1405,upper:1454},
  stop:'尚未確認下一道支撐',entrySignals:{pullback:false,chase:false}};
const expected={plan:{levels:[{value:1455},{value:1680}],resonance:{}},downside:{levels:[{value:1286}]}};
const base={price:1300,recent,expected,play:{key:'swing',period:'波段'},holding:false,
 market:{verified:true,regime:'on'},risk:{valid:true,score:42,trimTriggered:true,exitTriggered:false,summary:'跌破 MA10｜跌破 MA20'}};
// Replicate the Wanrun screenshot's *structural condition*: no distinct supporting trim level
// above full stop, but the risk assessor has already raised a trim alert.
const warning=decision(base);
assert.equal(warning.trimStop,null, 'do not invent an additional stop line');
assert.equal(warning.trimStopCenter,null,'current observation may not be stored as stop trigger');
assert.equal(warning.trimStopStatus,'risk-already-triggered');
assert.deepEqual(warning.trimStopAlert,{kind:'current-risk-trigger',price:1300,alreadyTriggered:true});
assert.equal(warning.trialEligible,false,'risk-trigger still prohibits buying');
assert.match(warning.trimStopNote,/減碼警戒/);
assert.match(warning.trimStopNote,/不.*新止損線/);
assert.equal(warning.fullStopCenter,1286,'existing full-stop trigger unchanged');
assert(warning.fullStop[0]<1286&&warning.fullStop[1]>1286);
const holding=decision({...base,holding:true});
assert.equal(holding.trimStopStatus,'risk-already-triggered');
assert.match(holding.trimStopNote,/持股者依原交易計畫/);
const noRisk=decision({...base,risk:{valid:true,score:16,trimTriggered:false,exitTriggered:false}});
assert.equal(noRisk.trimStopStatus,'not-formed');
assert(noRisk.trimStopAlert===null&&noRisk.trimStop===null);
const exitRisk=decision({...base,risk:{valid:true,score:78,trimTriggered:true,exitTriggered:true,summary:'結構已失守'}});
assert.equal(exitRisk.trimStopStatus,'exit-priority');
assert.equal(exitRisk.trimStopAlert,null);
const withRealSupport=decision({...base,recent:{...recent,support:{value:1295,lower:1290,upper:1298}}});
assert.equal(withRealSupport.trimStopStatus,'structural-zone');
assert.equal(withRealSupport.trimStopCenter,1295);
assert(withRealSupport.trimStop[0]<1295 && withRealSupport.trimStop[1]>1295);
assert.equal(withRealSupport.fullStopCenter,1286);
const noFull=decision({...base,expected:{...expected,downside:{levels:[]}}});
assert.equal(noFull.trimStopAlert,null,'no real defense -> no invented current stop');
assert.match(noFull.trimStopNote,/沒有高於⑥防守/);
assert(app.includes('function szTrimDefenseText(d,compact=false)'));
assert(app.includes('szTrimDefenseText(decision,true)'));
assert(app.includes('szTrimDefenseText(d)'));
assert(app.includes('d?.trimStopAlert?\'警戒已觸發\''));
const vm=require('node:vm');
const begin=app.indexOf('function szTrimDefenseText(d,compact=false)'),end=app.indexOf('\nfunction renderUnifiedStopPanel(',begin);
assert(begin>0&&end>begin,'actual UI display formatter found');
const ctx={overviewIntFmt:n=>Number(n).toLocaleString('zh-TW',{maximumFractionDigits:0}),
 overviewZoneIntText:zone=>`BAND:${zone.join('-')}`,targetZoneText:zone=>`BAND:${zone.join('-')}`};
vm.createContext(ctx);vm.runInContext(app.slice(begin,end),ctx);
assert.equal(ctx.szTrimDefenseText(warning,true),'現價 1,300（已觸發）');
assert.equal(ctx.szTrimDefenseText(noRisk,true),'未形成（依⑥防守）');
assert.equal(ctx.szTrimDefenseText(exitRisk),'已觸發出場警戒（看⑥）');
assert.match(ctx.szTrimDefenseText(withRealSupport),/^BAND:/);
assert(html.includes('v2.6.9.24')&&html.includes('app.js?v=2.6.9.24'));
console.log('PASS v2.6.9.24: no independent trim -> clear current triggered marker; no invented stop; original full stop preserved; UI formatter and regression tests checked.');
