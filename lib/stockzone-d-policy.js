'use strict';
/**
 * StockZone D (frozen research policy 2026-10-24), PURE, research-only.
 * Reuses ORIGINAL StockZone V4 Stage1 -> Stage3 -> Stage2 JS without editing it.
 * No database read/write, no network, no order placement, no Supabase dependency.
 * This policy is NOT byte-for-byte equal to the Supabase SQL research replay:
 * only future Neon-produced as-of-T recommendations can establish live parity.
 */
const {selectDailyStage3First}=require('./v4-stage3-first');
const {visibleFromFrozenRecord}=require('./stockzone-five-plus-five-w3d112');
const {selectFivePlusFiveDaily}=require('./stockzone-five-plus-five');
const VERSION='SZ-D-RESEARCH-FROZEN-20261024-v1';
const N=v=>v===null||v===undefined||v===''?NaN:Number(v);
const finite=v=>Number.isFinite(N(v));
const stockKey=r=>`${r.market}|${r.stock_code}`;
const compareText=(a,b)=>String(a).localeCompare(String(b),'en');
const sortScore=(a,b)=>N(b.score2)-N(a.score2)||compareText(a.stock_code,b.stock_code)||compareText(a.tag_id,b.tag_id);
const refusal=message=>{throw Error('D_LOCKED: '+message);};

function pickV4Qualified(rawRows,marketState,financeCoreKeys=new Set()){
 const v4=selectDailyStage3First(rawRows,marketState);  // Frozen S1/S3/S2 JS, no proxy scoring.
 const pre=[];
 const seen=new Set();
 for(const row of (v4.stage2Passed||[]).slice().sort(sortScore)){
  const key=stockKey(row);
  if(seen.has(key))continue;
  seen.add(key);
  // Study is FINANCE-FREE: remove any core finance stock regardless of which
  // other tag it may have won under, and financial tag itself.
  if(row.tag_id==='finance'||financeCoreKeys.has(key))continue;
  pre.push({...row,oldV4Rank:pre.length+1,score2:Number(row.score2)});
 }
 return {eligible:pre,diagnostic:{
  liquidInputTags:v4.eligibleLiquid||0,stage1TagRows:(v4.stage1||[]).length,
  stage3TagRows:(v4.stage3Passed||[]).length,stage2TagRows:(v4.stage2Passed||[]).length,
  financeExcluded:seen.size-pre.length,eligibleUniqueStocks:pre.length,
 }};
}
function qualifyMoneySectors(moneyRows){
 if(!Array.isArray(moneyRows)||moneyRows.length<1)refusal('5-day sector capital data not ready');
 const seen=new Set();
 const eligible=[];
 for(const r of moneyRows){
  if(!r||typeof r.tag_id!=='string'||seen.has(r.tag_id))refusal('invalid/duplicate sector capital key');
  seen.add(r.tag_id);
  const cash=N(r.flow_5_e8),core=N(r.core_valid_5);
  if(finite(cash)&&finite(core)&&core>0&&cash>0)eligible.push({tag_id:r.tag_id,money5:cash,coreValid5:core,density:cash/core});
 }
 if(moneyRows.length<180)refusal('Neon sector capital coverage below 180 categories');
 if(!eligible.length)refusal('no positive-core sector money data');
 const sortCash=(a,b)=>b.money5-a.money5||compareText(a.tag_id,b.tag_id);
 const sortDensity=(a,b)=>b.density-a.density||compareText(a.tag_id,b.tag_id);
 const cashTop=eligible.slice().sort(sortCash).slice(0,5).map(x=>x.tag_id);
 const densityTop=eligible.slice().sort(sortDensity).slice(0,5).map(x=>x.tag_id);
 return {cashTop,densityTop,strong:new Set([...cashTop,...densityTop]),coverage:moneyRows.length};
}
function rankDualTrack(eligible,strongSectors,protectedCount){
 if(![2,4].includes(protectedCount))refusal('only frozen 4+1/2+3 track mix permitted');
 const output=[];
 const used=new Set();
 function add(row,source){
  const key=stockKey(row);
  if(used.has(key))return;
  used.add(key);
  output.push({...row,track:source,slot:output.length+1,weight:0.2});
 }
 eligible.slice(0,protectedCount).forEach(r=>add(r,'V4_PROTECTED'));
 for(const row of eligible){
  if(output.length>=5)break;
  if(strongSectors.has(row.tag_id))add(row,'STRONG_SECTOR');
 }
 for(const row of eligible){
  if(output.length>=5)break;
  add(row,'V4_FALLBACK');
 }
 return output;
}
function isFirstWarning(records){
 const last=records.at(-1);
 if(!last?.warning) return false;
 const before=records.at(-2);
 if(!before)refusal('cannot identify first warning date without previous W3 trading record');
 if(String(before.date)>=String(last.date))refusal('W3 dates are not chronological');
 return !before.warning;
}
/**
 * `flow1` values are frozen as-of-T features from Neon (`raw_flow_1_pct`).
 * marketBreadth = % of listed+OTC priced stocks advancing T vs T-1.
 * Never refill warning candidates excluded by risk conditions. Each planned
 * stock receives EXACTLY 20% of model capital, not reweighted.
 */
function selectFrozenD({rawRows,marketRecords,moneyRows,financeCoreKeys=new Set(),
  stockFlow1=new Map(),marketBreadth=null,asOfDate}={}){
 if(!Array.isArray(marketRecords)||!marketRecords.length)refusal('missing W3-D.1.2 source records');
 if(typeof asOfDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))refusal('explicit as-of date required');
 const last=marketRecords.at(-1);
 if(last?.date!==asOfDate)refusal('W3 as-of date mismatch');
 if(!Array.isArray(rawRows))refusal('raw Neon V4 candidates required');
 if(rawRows.some(r=>r.trade_date&&String(r.trade_date).slice(0,10)!==asOfDate))refusal('future or mixed-date V4 input');
 if(!(financeCoreKeys instanceof Set)||!(stockFlow1 instanceof Map))refusal('finance/stock risk evidence missing');
 // THIS CALL validates ORIGINAL FROZEN W3-D.1.2 record safety.
 const visible=visibleFromFrozenRecord(last);
 const base={model:VERSION,asOfDate,w3ModelVersion:'W3-D.1.2',w3Visible:visible,
  source:'ORIGINAL_V4_STAGE1_STAGE3_STAGE2 + NEON_SECTOR_CASH_TOP5_DENSITY_TOP5',
  executed:false,noOrders:true,studyOnly:true,costRoundTripPct:0.6,
  maxSlots:5,plannedAllocationPctPerStock:20,
  recommendations:[],tradeSlots:0,cashFraction:1};
 if(visible==='RiskOff')return {...base,mode:'OFF',entryAllowed:false,reason:'RISK_OFF',v4:{eligibleUniqueStocks:0}};
 if(!finite(last.advanceRatio)||N(last.advanceRatio)<0||N(last.advanceRatio)>100)refusal('W3 original advancing-issue ratio missing');
 // Independently run the archived 5+5 to assert ORIGINAL core ordering is preserved.
 const reference=selectFivePlusFiveDaily(rawRows,visible,N(last.advanceRatio),{asOfDate,scenario:'original_all'});
 const ranks=pickV4Qualified(rawRows,visible,financeCoreKeys);
 const fullV4=selectDailyStage3First(rawRows,visible);
 const core=fullV4.recommendations||[];
 if(reference.core.length!==core.length||reference.core.some((r,i)=>stockKey(r)!==stockKey(core[i])))refusal('original V4 5+5 top slots do not match archived stage JS');
 const sector=qualifyMoneySectors(moneyRows);
 const mode=visible==='Warning'?'WARNING':'ON';
 const raw=rankDualTrack(ranks.eligible,sector.strong,mode==='ON'?4:2);
 let approved=raw,reason='OK',firstWarning=false;
 if(mode==='WARNING'){
  firstWarning=isFirstWarning(marketRecords);
  if(!finite(marketBreadth)||N(marketBreadth)<0||N(marketBreadth)>100)refusal('T-day all-market breadth missing');
  if(firstWarning){approved=[];reason='FIRST_WARNING_NO_BUY';}
  else if(N(marketBreadth)<30){approved=[];reason='MARKET_ADVANCE_UNDER_30';}
  else {
   // Candidate slots are NOT refilled when a stock fails the warning filter.
   // The official D reference is 2+3 rankings followed by this risk gate.
   for(const row of raw){
    if(!stockFlow1.has(stockKey(row)))refusal('T-day stock flow1 missing for '+stockKey(row));
    if(!finite(stockFlow1.get(stockKey(row))))refusal('T-day stock flow1 invalid for '+stockKey(row));
    if(!finite(row.price_breadth))refusal('T-day sector breadth missing for '+stockKey(row));
   }
   approved=raw.filter(row=>N(stockFlow1.get(stockKey(row)))>0&&N(row.price_breadth)>=60);
   if(!approved.length)reason='NO_QUALIFIED_WARNING_STOCK';
  }
 }
 return {...base,mode,entryAllowed:approved.length>0,reason,firstWarning,
  marketBreadth:mode==='WARNING'?N(marketBreadth):null,
  sectorCashTop5:sector.cashTop,sectorDensityTop5:sector.densityTop,
  strongSectorTagCount:sector.strong.size,
  v4:ranks.diagnostic,originalCoreStockKeys:reference.core.map(stockKey),
  recommendations:approved.map(r=>({stock_code:r.stock_code,stock_name:r.stock_name||'',market:r.market,
   tag_id:r.tag_id,slot:r.slot,track:r.track,originalV4Rank:r.oldV4Rank,
   v4Score:r.score2,allocationPct:20,flow1:mode==='WARNING'?N(stockFlow1.get(stockKey(r))):null,
   industryPriceBreadth:mode==='WARNING'?N(r.price_breadth):null})),
  tradeSlots:approved.length,cashFraction:Number((1-approved.length/5).toFixed(10))};
}
/** T-close instruction for PAPER SIMULATION ONLY. Trading day counts come from a
 * ledger of executed *prior* sessions; this function never claims an execution.
 * previous position = {mode: 'ON'|'WARNING',heldSessions:int} or null.
 */
function planNextOpen(selection,position=null){
 if(!selection||selection.model!==VERSION)refusal('D locked selection required');
 if(position!==null && (!['ON','WARNING'].includes(position.mode)||!Number.isInteger(position.heldSessions)||position.heldSessions<0))refusal('invalid paper position');
 const mode=selection.mode;
 const needExit=!!position&&(mode==='OFF'||position.mode!==mode||position.heldSessions>=(position.mode==='ON'?20:1));
 const keeping=!!position&&!needExit;
 const canEnter=mode!=='OFF'&&!keeping&&selection.entryAllowed;
 return {signalDate:selection.asOfDate,execute:'NEXT_TRADING_SESSION_OPEN',simulationOnly:true,
  closeCurrentPosition:needExit,keepCurrentPosition:keeping,
  buyAfterExit:canEnter?selection.recommendations:[],buySlots:canEnter?selection.tradeSlots:0,
  reason:mode==='OFF'?'OFF_LIQUIDATE':keeping?'HOLD_UNTIL_TERM_OR_STATE_SWITCH':selection.reason};
}
module.exports={VERSION,stockKey,pickV4Qualified,qualifyMoneySectors,rankDualTrack,isFirstWarning,selectFrozenD,planNextOpen};
