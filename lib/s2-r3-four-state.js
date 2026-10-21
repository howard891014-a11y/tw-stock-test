'use strict';
/**
 * StockZone V4 S2-R3 / FOUR-STATE RESEARCH ONLY (2026-10-21).
 * Uses the FROZEN S1/S3 module unmodified, verified W3-D.1.2 visible state,
 * and exact canonical W3 input advance_ratio, NOT the outdated four_cont warning.
 *
 * No OOS or live-trading claim. Daily matched-slot capacity is a research CONTROL:
 * old S2 0.75/.78 eligible unique stocks determines slot count and the ONLY
 * difference is which (same number) go into that slot. A production gate has
 * NOT been calibrated; DO NOT use this function to deploy an auto-trader.
 */
const {selectDailyStage3First,percentRanks,CONFIG}=require('./v4-stage3-first.js');
const {strict:assert}=require('node:assert');
const num=x=>x===null||x===undefined||x===''?NaN:Number(x);
const isnum=x=>Number.isFinite(num(x));
const k=x=>`${x.market}|${x.stock_code}`;
const kt=x=>`${x.market}|${x.stock_code}|${x.tag_id}`;
const cmp=(a,b)=>String(a).localeCompare(String(b),'en');
function sceneFromFrozenW3(w3Visible,advanceRatio){
  if(!w3Visible||!['RiskOn','Warning','RiskOff'].includes(w3Visible))throw Error('W3-D.1.2 visible RiskOn / Warning / RiskOff required');
  if(w3Visible==='RiskOff')return 'OFF';
  if(w3Visible==='Warning')return 'WARNING';
  if(!isnum(advanceRatio)||num(advanceRatio)<0||num(advanceRatio)>100)throw Error('W3 canonical advance_ratio 0..100 required; no interpolation or stale fallback');
  return num(advanceRatio)>=50?'ON_BROAD':'ON_NARROW';
}
function additiveScores(row){
  const old=num(row.score2);
  const up=.55*num(row.p20)+.45*num(row.p3);
  if(!isnum(old)||!isnum(up))throw Error('Missing T-known S2 scores');
  return {old,up};
}
function compareRank(a,b){return b.s2r3Score-a.s2r3Score||cmp(a.stock_code,b.stock_code)||cmp(a.market,b.market);}
function reduceOneStock(rows){
  const best=new Map();
  for(const r of rows){const key=k(r);const old=best.get(key);if(!old||r.score2>old.score2||(r.score2===old.score2&&cmp(r.tag_id,old.tag_id)<0))best.set(key,r);}
  return [...best.values()];
}
function selectFourStateDaily(asOfRawTags,w3Visible,advanceRatio,{scenario='early_frozen_warn_up'}={}){
  const scene=sceneFromFrozenW3(w3Visible,advanceRatio);
  if(scene==='OFF')return {scene,recommendations:[],matchedOldSlots:0,warning:'RESEARCH ONLY'};
  // The S1+S3 module is sourced from the already frozen unmodified package.
  const s3=selectDailyStage3First(asOfRawTags,w3Visible);
  const liquid=asOfRawTags.filter(r=>num(r.avg_value20)>=CONFIG.minAvgTradeValue20&&num(r.trade_value)>=CONFIG.minTodayTradeValue&&
    [r.ret5,r.taiex_ret5,r.relative_industry_ret5,r.flow5,r.sector_flow5,r.dflow5_3,r.delta_sector_flow,r.relative_gap20].every(isnum));
  if(liquid.length===0)return {scene,stage1:s3.stage1,stage3Passed:s3.stage3Passed,recommendations:[],matchedOldSlots:0};
  if(!liquid.every(r=>isnum(r.ret20)&&isnum(r.ret3)))throw Error('ret20, ret3 missing from full T-day liquid population');
  const p20=percentRanks(liquid.map(x=>num(x.ret20)));
  const p3=percentRanks(liquid.map(x=>num(x.ret3)));
  const ranks=new Map(liquid.map((r,i)=>[kt(r),{p20:p20[i],p3:p3[i]}]));
  const unique=reduceOneStock(s3.stage3Passed).map(r=>{
    const rank=ranks.get(kt(r));if(!rank)throw Error('Mismatch between frozen S3 and T-day liquidity universe: '+kt(r));
    const row={...r,...rank};const scores=additiveScores(row);
    let score=scores.old;
    if(scenario==='early_frozen_warn_up')score=scene==='WARNING'?scores.up:scores.old;
    else if(scenario==='posthoc_narrow_warning_up')score=(scene==='WARNING'||scene==='ON_NARROW')?scores.up:scores.old;
    else if(scenario==='original_all')score=scores.old;
    else throw Error('Unknown research scenario '+scenario);
    return {...row,s2r3Score:score,originalScore:scores.old,upScore:scores.up};
  });
  const oldThreshold=w3Visible==='Warning'?.78:.75;
  // NOT a new live entry threshold. Match old S2 unique eligible stock count per signal day.
  const matchedOldSlots=Math.min(5,unique.filter(r=>r.originalScore>=oldThreshold).length);
  const recommendations=unique.slice().sort(compareRank).slice(0,matchedOldSlots);
  assert(recommendations.length===matchedOldSlots);
  return {scene,matchedOldSlots,recommendations,stage1:s3.stage1,stage3Passed:s3.stage3Passed,
    studyWarning:'Historical matched-slot comparison only. New-model entry gate and trading costs are NOT verified.'};
}
module.exports={sceneFromFrozenW3,additiveScores,reduceOneStock,selectFourStateDaily};
