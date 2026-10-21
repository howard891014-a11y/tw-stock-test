'use strict';
/**
 * StockZone V4-R1 exploratory stock selection; no V3 scoring or gate dependencies.
 * Inputs must be as-of T CLOSE and must come from the supplied research tables.
 * Market state MUST be computed by separately bundled frozen W3-D.1.2; this
 * module never guesses or derives that state from yesterday's stored values.
 * NOT production-deployed. NOT a trained or validated predictive model.
 */

const CONFIG = Object.freeze({
  minAvgTradeValue20: 100_000_000,
  minTodayTradeValue: 50_000_000,
  shortlistThreshold: 0.75,
  finalThreshold: 0.72,
  warningUplift: 0.03,
  maxRecommendations: 5,
});
const numeric = (x) => x === undefined || x === null || x === '' ? NaN : Number(x);

// Matches PostgreSQL PERCENT_RANK ordered ASC (same null exclusion for required fields).
function percentRanks(values) {
  const ordered = values.map((v, i) => ({ v: numeric(v), i }))
    .sort((a, b) => Number.isNaN(a.v) - Number.isNaN(b.v) || a.v - b.v || a.i - b.i);
  const ranks = Array(values.length).fill(NaN);
  for (let n = 0; n < ordered.length;) {
    const start = n, current = ordered[n].v;
    while (n < ordered.length && (ordered[n].v === current || (Number.isNaN(ordered[n].v) && Number.isNaN(current)))) n++;
    for (let j = start; j < n; j++) ranks[ordered[j].i] = values.length <= 1 ? 0 : start / (values.length - 1);
  }
  return ranks;
}
function compareStrings(a, b) { return String(a).localeCompare(String(b), 'en'); }

function selectDailyV4(rows, marketState, config = CONFIG) {
  if (!['RiskOn','Warning','RiskOff'].includes(marketState)) throw new Error('Pass explicit W3-D.1.2 RiskOn / Warning / RiskOff visible state');
  if (marketState === 'RiskOff') return { marketState, eligibleLiquid: 0, stage1: [], stage2: [], recommendations: [] };
  const valid = rows.filter(r => numeric(r.avg_value20) >= config.minAvgTradeValue20 &&
    numeric(r.trade_value) >= config.minTodayTradeValue &&
    [r.ret5,r.taiex_ret5,r.relative_industry_ret5,r.flow5,r.sector_flow5,r.dflow5_3,r.delta_sector_flow,r.relative_gap20].every(x => Number.isFinite(numeric(x))));
  if (valid.length === 0) return { marketState, eligibleLiquid: 0, stage1: [], stage2: [], recommendations: [] };
  const rel = valid.map(r => numeric(r.ret5)-numeric(r.taiex_ret5));
  const ps = percentRanks(rel), pi=percentRanks(valid.map(r=>r.relative_industry_ret5));
  const pf = percentRanks(valid.map(r=>r.dflow5_3)), pd=percentRanks(valid.map(r=>r.delta_sector_flow));
  const stage1 = valid.map((row, i) => {
    const r5=numeric(row.ret5), ir5=numeric(row.taiex_ret5), sr=numeric(row.relative_industry_ret5);
    const f5=numeric(row.flow5), sf=numeric(row.sector_flow5), df=numeric(row.dflow5_3);
    const ds=numeric(row.delta_sector_flow), gap=numeric(row.relative_gap20);
    const strong = r5-ir5>0 && sr>0 && (f5>0 || sf>0);
    const emerging = df>0 && ds>0 && r5>-5;
    const scoreStrong = 0.45*ps[i]+0.30*pi[i]+0.25*pf[i];
    const scoreEmerging = 0.20*ps[i]+0.15*pi[i]+0.40*pf[i]+0.25*pd[i];
    const score2 = Math.max(strong ? scoreStrong : 0, emerging ? scoreEmerging : 0);
    const brake = 0.30*(1-pf[i])*(1-pd[i])*(0.35+0.65*Math.min(Math.max((gap-6)/8,0),1.5));
    return { ...row, strong, emerging, scoreStrong, scoreEmerging, score2, brake, finalScore:score2-brake };
  }).filter(r=>r.strong || r.emerging);
  // Stage 2 ranking and eligibility; stage 3 independently applies brake, then reranks.
  const uplift = marketState === 'Warning' ? (config.warningUplift ?? 0) : 0;
  const stage2 = stage1.filter(r => r.score2 >= config.shortlistThreshold + uplift);
  const afterBrake = stage2.filter(r => r.finalScore >= config.finalThreshold + uplift)
    .sort((a,b)=>b.finalScore-a.finalScore || compareStrings(a.stock_code,b.stock_code) || compareStrings(a.tag_id,b.tag_id));
  const stockMap = new Map();
  for (const r of afterBrake) {
    const key = String(r.market)+'|'+String(r.stock_code);
    if (!stockMap.has(key)) stockMap.set(key,r);
  }
  return { marketState, eligibleLiquid:valid.length, stage1, stage2,
    recommendations:[...stockMap.values()].slice(0,config.maxRecommendations) };
}

/**
 * Enforce W3-D.1.2 OFF execution order independently of stock ranking.
 * A T signal enters at T+1 CLOSE only if T+1 CLOSE is not OFF.
 * Previously opened positions liquidate at first OPEN after OFF confirmed.
 * end-of-day signals are never filled retroactively.
 */
function marketStateFromW3Day(record) {
  if (!record || !['RiskOn','RiskOff'].includes(record.regime) || typeof record.warning !== 'boolean') throw new Error('Pass a record from the frozen computeW3D112() result');
  return record.regime === 'RiskOff' ? 'RiskOff' : record.warning ? 'Warning' : 'RiskOn';
}
function processEntry(nextSessionVisibleState) {
  if (!['RiskOn','Warning','RiskOff'].includes(nextSessionVisibleState)) throw new Error('Missing verified next session W3 state');
  return nextSessionVisibleState === 'RiskOff' ? 'CANCEL_ENTRY' : 'ENTER_AT_CLOSE';
}
function processExistingPositions(previousCloseVisibleState) {
  if (!['RiskOn','Warning','RiskOff'].includes(previousCloseVisibleState)) throw new Error('Missing W3 state');
  return previousCloseVisibleState === 'RiskOff' ? 'LIQUIDATE_NEXT_OPEN' : 'RETAIN_BY_STOCK_RULES';
}
module.exports={CONFIG, percentRanks, selectDailyV4, marketStateFromW3Day, processEntry, processExistingPositions};
