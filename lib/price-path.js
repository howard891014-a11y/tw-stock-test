'use strict';
// Price layer: a daily-rebalanced synthetic topic index built from the persisted
// business-weighted DAILY returns.  A five-day constituent-weighted return is
// NOT compounded: portfolio membership/weights can change across observations.
const numeric=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const dateOf=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
function logReturn(ordinaryPercent){const r=numeric(ordinaryPercent);return r===null||r<=-100?null:100*Math.log1p(r/100);}
function simpleReturn(logPercent){const p=numeric(logPercent);return p===null?null:100*Math.expm1(p/100);}
function addLogReturns(values){let total=0;for(const v of values){const r=logReturn(v);if(r===null)return null;total+=r;}return total;}
function retiringFlow(sortedRows,i,horizon){
  const h=Number(horizon),lo=i-19,hi=i-20+h;if(lo<0||hi>i||h<1||h>20)return null;
  const values=sortedRows.slice(lo,hi+1).map(r=>numeric(r.flow_1_pct));
  return values.length===h&&values.every(v=>v!==null)?values.reduce((s,v)=>s+v,0)/h:null;
}
function buildTopicPricePath(sortedRows,dates,anchorSessions=20){
  const last=dates.slice(-anchorSessions-1);
  if(last.length!==anchorSessions+1)return {valid:false,reason:'insufficient-trading-days',points:[]};
  const rows=new Map(sortedRows.map(r=>[dateOf(r.trade_date),r]));
  if(!last.every(d=>rows.has(d)))return {valid:false,reason:'missing-topic-session',points:[]};
  const points=[{date:last[0],priceLogY:0,priceY:0}];let total=0;
  for(let i=1;i<last.length;i++){
    const one=logReturn(rows.get(last[i])?.return_1_pct);
    if(one===null)return {valid:false,reason:'missing-one-day-return',points:[]};
    total+=one;points.push({date:last[i],priceLogY:total,priceY:simpleReturn(total)});
  }
  const ending=last.length-1;
  const turn3=ending>=6?addLogReturns(last.slice(-3).map(d=>rows.get(d).return_1_pct))-addLogReturns(last.slice(-6,-3).map(d=>rows.get(d).return_1_pct)):null;
  const today=rows.get(last.at(-1)),prior=rows.get(last.at(-4));
  const mNow=logReturn(today?.y_score),mOld=logReturn(prior?.y_score);
  return {valid:true,anchorDate:last[0],asOf:last.at(-1),priceY:points.at(-1).priceY,priceLogY:total,dy3Turn:turn3,dy3Roll:mNow!==null&&mOld!==null?mNow-mOld:null,points};
}
module.exports={numeric,dateOf,logReturn,simpleReturn,addLogReturns,retiringFlow,buildTopicPricePath};
