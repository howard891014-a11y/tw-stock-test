'use strict';
// Research-only probabilities inferred from strictly forward-labelled, expanding-
// window out-of-sample forecasts. Each test DATE has equal total weight; hundreds
// of correlated industries on one date are not hundreds of independent days.
// DO NOT interpret these estimates as verified live-trading calibration.
const finite = Number.isFinite;
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
function logit(p){const q=Math.max(.02,Math.min(.98,p));return Math.log(q/(1-q));}
function fitSignCalibration(samples,horizon){
  const valid=(samples||[]).filter(r=>finite(r.pred)&&finite(r.real)&&r.date);
  const days=[...new Set(valid.map(r=>r.date))].sort();
  if(days.length<Math.max(12,Math.min(20,horizon))||valid.length<100)return {available:false,status:'insufficient',distinctDates:days.length,effectiveBlocks:days.length/horizon,n:valid.length};
  const countByDate=new Map();for(const r of valid)countByDate.set(r.date,(countByDate.get(r.date)||0)+1);
  const mu=valid.reduce((s,r)=>s+r.pred/countByDate.get(r.date),0)/days.length;
  const sd=Math.max(.3,Math.sqrt(valid.reduce((s,r)=>s+(r.pred-mu)**2/countByDate.get(r.date),0)/days.length));
  const fraction=valid.reduce((s,r)=>s+(r.real>0?1:0)/countByDate.get(r.date),0)/days.length;
  let b0=logit(fraction),b1=0;
  for(let it=0;it<20;it++){
    let g0=0,g1=-1.5*b1,h00=1e-6,h01=0,h11=1.5;
    for(const r of valid){const z=Math.max(-8,Math.min(8,(r.pred-mu)/sd)),p=sigmoid(b0+b1*z),w=1/countByDate.get(r.date),e=(r.real>0?1:0)-p,v=w*p*(1-p);g0+=w*e;g1+=w*e*z;h00+=v;h01+=v*z;h11+=v*z*z;}
    const det=h00*h11-h01*h01;if(det<1e-10)break;
    const d0=(h11*g0-h01*g1)/det,d1=(h00*g1-h01*g0)/det;
    b0+=Math.max(-1,Math.min(1,d0));b1=Math.max(0,Math.min(5,b1+Math.max(-1,Math.min(1,d1))));
    if(Math.abs(d0)+Math.abs(d1)<1e-6)break;
  }
  // Mark all estimates preliminary until there are enough horizon-separated dates.
  const blocks=days.length/horizon;
  return {available:true,status:blocks>=6?'provisional':'research-only',n:valid.length,distinctDates:days.length,effectiveBlocks:Math.round(blocks*100)/100,
    mean:mu,sd,b0,b1,baseUpRate:fraction,variationSignal:b1>0.05};
}
function directionProbability(cal,pred){
  if(!cal?.available||!finite(pred))return {upProbability:null,directionProbability:null,confidenceStatus:cal?.status||'insufficient'};
  const pUp=sigmoid(cal.b0+cal.b1*Math.max(-8,Math.min(8,(pred-cal.mean)/cal.sd)));
  // Forecast direction is defined by cumulative expected return, not a Y5 displacement.
  const directionP=pred>=0?pUp:1-pUp;
  return {upProbability:Math.round(pUp*1000)/10,directionProbability:Math.round(directionP*1000)/10,
    confidenceStatus:cal.status,confidenceDates:cal.distinctDates,confidenceEffectiveBlocks:cal.effectiveBlocks};
}
module.exports={fitSignCalibration,directionProbability};
