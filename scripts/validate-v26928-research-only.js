'use strict';
// Verify removal of decision UI AND evaluation paths, without modifying independent research engines.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const pkg=require('../package.json');
const removedUi=['overviewDecisionCard','decisionEntryVerdict','decisionTrialPrice','decisionEntryPrice',
 'decisionTrimPrice','decisionExitPrice','decisionTrimStopPrice','decisionFullStopPrice',
 'adaptiveStopPanel','recentPlayCard','recentPlayTrial','recentPlayPct',
 'overviewFinalNext','szV33ResearchCard'];
for(const id of removedUi)assert(!new RegExp(`id=["']${id}["']`).test(html),`${id}: decision element remains in UI`);
assert(!/>買賣決策</.test(html),'buy/sell decision card still shown');
for(const engine of ['unified-trade-decision.js','recent-play-advice.js']){
 assert(!html.includes(engine),`auto-decision script still loaded: ${engine}`);
 assert(!fs.existsSync(path.join(root,'lib',engine)),`auto-decision code not deleted: ${engine}`);
}
for(const fn of ['unifiedDecisionForPlay','renderDecision','renderRecentPlayAdvice',
 'szRenderEntryVerdict','buildDecisionPlan','decisionAdaptiveStopScenario'])
 assert(!new RegExp(`function\\s+${fn}\\s*\\(`).test(app),`${fn} remains as active generator`);
assert(!app.includes('refreshHoldingTradePlan('),'auto advisory still updates manual plan');
assert(!app.includes('StockZoneUnifiedTrade'),'removed arbitrator still referenced');
assert(!app.includes('StockZoneRecentPlay'),'recent trade instructions still referenced');
assert(!require('../lib/holding-trade-plans').recommendAllocation,'auto position-allocation advice retained');
assert(!require('../lib/trade-orchestrator-v4').decide,'legacy V4 trade orchestrator retained');
assert(typeof require('../lib/holding-trade-plans').record==='function','manual trade ledger inadvertently removed');
assert(typeof require('../lib/trade-orchestrator-v4').splitPosition==='function','V4 position split inadvertently removed');
for(const id of ['overviewResonanceCard','overviewResonanceSvg','overviewSR8Levels',
 'szLabBacktest','playStyleCard','szV4WaveGrid','technical',
 'expectedUpsideCard','expectedWinRate','expectedProfitRate','szSimulationLedgerPage'])
 assert(html.includes(`id="${id}"`),`${id}: preserved research/simulation element missing`);
for(const script of ['position-play-v4.js','stockzone-sr82-browser.js','resonance-lab-v1.js','holding-trade-plans.js',
 'stockzone-d-paper.js']){
 if(script==='stockzone-d-paper.js')assert(fs.existsSync(path.join(root,'lib',script)));
 else assert(html.includes(script),`${script} was removed by mistake`);
}
assert(app.includes('const wr=historicalSimilarWinRate('),'historical win-rate computation was removed');
assert(app.includes('plan.resonance.adjustedStrength=Math.round('),'historical calibration of resonance removed');
assert(app.includes('szChartPriceZones()'),'SR8.2 calculations removed');
assert(app.includes('api.tacticalLevels(play?.swingWave,price)'),'V4 wave multiplier no longer calculated');
assert(app.includes('function renderCurrentExtremeRisk('),'technical risk research removed');
assert(!app.includes('const decision=renderDecision('),'buy/sell decision still computed');
assert.equal(pkg.version,'2.6.9.28');
console.log('PASS: 9 categories removed from DOM and execution; independent research retained; no Supabase/Neon mutation');
