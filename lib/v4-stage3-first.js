'use strict';
/**
 * EXPERIMENT: V4 S3-R1 independent low-participation filter BEFORE UNCHANGED S2.
 * NOTE: this improves empirical alpha/dual success, but NOT crash-risk protection.
 * Not deployed and does not rewrite original stage 2, W3, or Supabase.
 *
 * Stage 1 = EXACT V4-R1 strong/emerging and liquidity definitions.
 * Stage 3 = reject unique stock-days in bottom 20% of (sd20/ma20) among S1 candidates.
 * Stage 2 = EXACT V4-R1 score formula, threshold 0.75/0.78,
 *           ranked by score2 (old third-stage score2-brake no longer exists).
 */
const previous = require('./v4-research-R1-UNMODIFIED');
const {CONFIG, percentRanks, marketStateFromW3Day, processEntry, processExistingPositions} = previous;
const N = x => x === '' || x === undefined || x === null ? NaN : Number(x);
const compareText = (a, b) => String(a).localeCompare(String(b),'en');
const key = r => `${r.market}|${r.stock_code}`;

function assignBottomQuintile(stage1) {
  const unique = new Map();
  for (const r of stage1) {
    if (!(Number.isFinite(N(r.sd20)) && N(r.sd20)>=0 && N(r.ma20)>0))
      throw new Error(`S3-R1 lacks as-of-T sd20/ma20 for ${key(r)}; no silent fallback`);
    const k=key(r);
    if (!unique.has(k)) unique.set(k,r);
  }
  const items=[...unique.values()].sort((a,b)=>(N(a.sd20)/N(a.ma20))-(N(b.sd20)/N(b.ma20)) || compareText(a.market,b.market) || compareText(a.stock_code,b.stock_code));
  // Postgres NTILE(5) GROUP 1 contains ceil(N/5) items for N>=5;
  // for N<5, each of first N items gets one tile.
  const rejectedKeys=new Set(items.slice(0,Math.ceil(items.length/5)).map(key));
  return {rejectedKeys,items};
}
function selectDailyStage3First(rows, marketState, opts={}) {
  const config={...CONFIG,...opts};
  if (!['RiskOn','Warning','RiskOff'].includes(marketState)) throw new Error('Explicit frozen W3-D.1.2 RiskOn/Warning/RiskOff required');
  if (marketState==='RiskOff') return {marketState,eligibleLiquid:0,stage1:[],stage3Rejected:[],stage3Passed:[],stage2Passed:[],recommendations:[]};
  const liquid=rows.filter(r=>N(r.avg_value20)>=config.minAvgTradeValue20 && N(r.trade_value)>=config.minTodayTradeValue &&
    [r.ret5,r.taiex_ret5,r.relative_industry_ret5,r.flow5,r.sector_flow5,r.dflow5_3,r.delta_sector_flow,r.relative_gap20]
      .every(v=>Number.isFinite(N(v))));
  if (!liquid.length) return {marketState,eligibleLiquid:0,stage1:[],stage3Rejected:[],stage3Passed:[],stage2Passed:[],recommendations:[]};
  // Keep original Stage 2 cross-sectional denominator BEFORE Stage 1/3 filters.
  const ps=percentRanks(liquid.map(r=>N(r.ret5)-N(r.taiex_ret5)));
  const pi=percentRanks(liquid.map(r=>N(r.relative_industry_ret5)));
  const pf=percentRanks(liquid.map(r=>N(r.dflow5_3)));
  const pd=percentRanks(liquid.map(r=>N(r.delta_sector_flow)));
  const stage1=[];
  for (let i=0;i<liquid.length;i++) {
    const r=liquid[i],ret5=N(r.ret5),idx=N(r.taiex_ret5),sr=N(r.relative_industry_ret5);
    const strong=ret5-idx>0 && sr>0 && (N(r.flow5)>0 || N(r.sector_flow5)>0);
    const emerging=N(r.dflow5_3)>0 && N(r.delta_sector_flow)>0 && ret5>-5;
    if (!strong && !emerging) continue;
    const scoreStrong=.45*ps[i]+.30*pi[i]+.25*pf[i];
    const scoreEmerging=.20*ps[i]+.15*pi[i]+.40*pf[i]+.25*pd[i];
    const score2=Math.max(strong?scoreStrong:0,emerging?scoreEmerging:0);
    stage1.push({...r,strong,emerging,scoreStrong,scoreEmerging,score2});
  }
  if (!stage1.length) return {marketState,eligibleLiquid:liquid.length,stage1:[],stage3Rejected:[],stage3Passed:[],stage2Passed:[],recommendations:[]};
  const {rejectedKeys}=assignBottomQuintile(stage1);
  const stage3Rejected=stage1.filter(r=>rejectedKeys.has(key(r)));
  const stage3Passed=stage1.filter(r=>!rejectedKeys.has(key(r)));
  const uplift=marketState==='Warning'?config.warningUplift:0;
  const stage2Passed=stage3Passed.filter(r=>r.score2>=config.shortlistThreshold+uplift);
  const ordered=stage2Passed.sort((a,b)=>b.score2-a.score2 || compareText(a.stock_code,b.stock_code) || compareText(a.tag_id,b.tag_id));
  const seen=new Set();
  const recommendations=[];
  for (const row of ordered) {
    if (seen.has(key(row))) continue;
    seen.add(key(row)); recommendations.push(row);
    if (recommendations.length>=config.maxRecommendations) break;
  }
  return {marketState,eligibleLiquid:liquid.length,stage1,stage3Rejected,stage3Passed,stage2Passed,recommendations};
}
module.exports={selectDailyStage3First,assignBottomQuintile,CONFIG,percentRanks,marketStateFromW3Day,processEntry,processExistingPositions};
