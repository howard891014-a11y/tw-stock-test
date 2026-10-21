'use strict';
/**
 * StockZone V4 — archived 5 CORE + 5 EXTENDED selection policy.
 * NOT a validated live-trading formula or a deployed data feed.
 * Unmodified dependencies: V4-R1, S3-R1 and S2-R3 frozen source files.
 *
 * Core is byte-for-byte rank-equivalent to selectFourStateDaily's 0..5 picks.
 * Extended consists of NEXT RANKED, previously unselected candidates with
 * ORIGINAL V4-R1 S2 score >= .75 (ON) or .78 (Warning), up to five.
 * The extended gate is existing, not a new tuned research threshold.
 * No extension if fewer than five core picks. OFF always returns empty.
 *
 * Note: for exploratory upScore scenarios, some core names may fall below
 * original eligibility gate due to historical MATCHED-QUOTA research design.
 * Their exact membership is intentionally preserved, not silently modified.
 */
const { selectFourStateDaily, reduceOneStock, additiveScores } = require('./s2-r3-four-state.js');
const { percentRanks, CONFIG } = require('./v4-stage3-first.js');
const { strict: assert } = require('node:assert');
const n = (v) => v === null || v === undefined || v === '' ? NaN : Number(v);
const finite = (v) => Number.isFinite(n(v));
const stockKey = (r) => `${r.market}|${r.stock_code}`;
const tagKey = (r) => `${r.market}|${r.stock_code}|${r.tag_id}`;
const cmp = (a, b) => String(a).localeCompare(String(b), 'en');
const allowed = new Set(['original_all', 'early_frozen_warn_up', 'posthoc_narrow_warning_up']);
const scoreSort = (a, b) => b.s2r3Score-a.s2r3Score || cmp(a.stock_code,b.stock_code) || cmp(a.market,b.market);
function validateDate(date) {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(date || '')) ||
      Number.isNaN(Date.parse(String(date)+'T00:00:00Z'))) throw Error('An explicit asOfDate YYYY-MM-DD is required for simulation traceability');
}
function selectFivePlusFiveDaily(asOfRawTags, w3Visible, advanceRatio, {
  scenario='original_all', asOfDate
}={}) {
  validateDate(asOfDate);
  if (!allowed.has(scenario)) throw Error(`Unknown frozen research scenario: ${scenario}`);
  if (!Array.isArray(asOfRawTags)) throw Error('T-day raw industry-tag candidate array required');
  if (asOfRawTags.some(r=>r.trade_date && String(r.trade_date).slice(0,10)!==asOfDate))
    throw Error('Input contains a non-asOfDate row; never mix days / future signals');
  const existing = selectFourStateDaily(asOfRawTags, w3Visible, advanceRatio, { scenario });
  const scene=existing.scene;
  const core=(existing.recommendations || []).map((r,i)=>({...r,stockzoneTier:'CORE',rank:i+1}));
  const gate=w3Visible==='Warning' ? .78 : .75;
  const common={
    asOfDate,scene,w3Visible,scenario,
    maxCore:5,maxExtended:5,
    rankingPolicy: 'CORE_V4_S2R3_MATCHED_OLD_SLOT; EXTENDED_POST_CORE_OLD_S2_GATE',
    threshold:scene==='OFF'?null:gate,
    officialStatus:'RESEARCH_FROZEN_NOT_DEPLOYED',
  };
  if (scene==='OFF') return {...common,core:[],extended:[],recommendations:[],coreCount:0,extendedCount:0,
    eligibleAfterStage3:0,eligibleOldGate:0,legacyMatchedSlots:0,
    tradeInstruction:'NO_NEW_BUY; existing OFF positions require separate next-session-open liquidation logic'};
  if (core.length<5) return {...common,core,extended:[],recommendations:core,coreCount:core.length,extendedCount:0,
    eligibleAfterStage3:reduceOneStock(existing.stage3Passed||[]).length,
    eligibleOldGate:existing.matchedOldSlots, legacyMatchedSlots:existing.matchedOldSlots,
    tradeInstruction:'Only CORE candidates eligible for paper-trading study; EXTENDED watch-only'};
  const liquid=asOfRawTags.filter(r=>n(r.avg_value20)>=CONFIG.minAvgTradeValue20 &&
    n(r.trade_value)>=CONFIG.minTodayTradeValue &&
    [r.ret5,r.taiex_ret5,r.relative_industry_ret5,r.flow5,r.sector_flow5,r.dflow5_3,r.delta_sector_flow,r.relative_gap20].every(finite));
  if (!liquid.every(r=>finite(r.ret20)&&finite(r.ret3)))
    throw Error('Missing ret20/ret3 in full as-of-T liquid population');
  const p20=percentRanks(liquid.map(r=>n(r.ret20))),p3=percentRanks(liquid.map(r=>n(r.ret3)));
  const ranks=new Map(liquid.map((r,i)=>[tagKey(r),{p20:p20[i],p3:p3[i]}]));
  const scored=reduceOneStock(existing.stage3Passed||[]).map(r=>{
    const x=ranks.get(tagKey(r));if(!x)throw Error('Frozen S3 and liquid T-day population mismatch: '+tagKey(r));
    const scores=additiveScores({...r,...x});
    const score=scenario==='original_all'? scores.old :
      scenario==='early_frozen_warn_up'?(scene==='WARNING'?scores.up:scores.old):
      (scene==='ON_BROAD'? scores.old:scores.up);
    return {...r,...x,originalScore:scores.old,upScore:scores.up,s2r3Score:score};
  }).sort(scoreSort);
  const topKeys=core.map(stockKey);const seen=new Set(topKeys);
  const actualTop=scored.slice(0,5).map(stockKey);
  assert.deepEqual(topKeys,actualTop,'Core top five MUST remain identical to original frozen S2-R3 result');
  const extended=[];
  for (const row of scored.slice(core.length)) {
    if (row.originalScore<gate)continue;
    const key=stockKey(row);
    if (seen.has(key))continue;
    seen.add(key);
    extended.push({...row,stockzoneTier:'EXTENDED',rank:core.length+extended.length+1});
    if(extended.length===5)break;
  }
  assert(core.length<=5&&extended.length<=5&&seen.size===core.length+extended.length);
  return {
    ...common,core,extended,recommendations:core,
    coreCount:core.length,extendedCount:extended.length,
    eligibleAfterStage3:scored.length,
    eligibleOldGate:scored.filter(r=>r.originalScore>=gate).length,
    legacyMatchedSlots:existing.matchedOldSlots,
    tradeInstruction:'Only CORE candidates eligible for paper-trading study; EXTENDED watch-only; OFF handled separately',
    warning:'No time-series out-of-sample confirmation, actual capital trades or daily live feed yet',
  };
}
function forSimulationLedger(result){
  if (!result || !Array.isArray(result.core) || !Array.isArray(result.extended))throw Error('5+5 selection result required');
  const proj = (r)=>({asOfDate:result.asOfDate,scene:result.scene,scenario:result.scenario,
    tier:r.stockzoneTier,rank:r.rank,market:r.market,stock_code:r.stock_code,stock_name:r.stock_name||'',
    originalScore:r.originalScore,rankingScore:r.s2r3Score,upScore:r.upScore,
    paperTradeEligible:r.stockzoneTier==='CORE' && result.scene!=='OFF'});
  return {asOfDate:result.asOfDate,marketState:result.scene,
    modelVersion:'StockZone-V4-5plus5-research-freeze-20261021',
    candidates:[...result.core,...result.extended].map(proj),
    realizedReturn:null,executionStatus:'NOT_EXECUTED'};
}
module.exports={selectFivePlusFiveDaily,forSimulationLedger};
