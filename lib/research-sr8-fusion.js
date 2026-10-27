'use strict';
/** R8 independent research-only price-zone mapper. Daily OHLCV only: no minute bars.
 * Never represents estimated daily volume allocation as actual volume-at-price.
 * Requires two usable S zones for sufficient valid history: distinguish verified,
 * historical weak, and EXTRAPOLATED ATR RISK REFERENCE (not genuine support).
 */
const r3=require('./research-sr4-zones');
const r71=require('./research-sr7-hybrid');
const VERSION='SR8.2-daily-mass-conserving-profile-two-supports-v1-20261027';
const clamp=(n,l,h)=>Math.max(l,Math.min(h,n));
const rnd=(n,d=2)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
const median=x=>{if(!x.length)return 1;let v=[...x].sort((a,b)=>a-b);return v[Math.floor(v.length/2)]||1};
function decode(bar){return{date:String(bar?.date??bar?.trade_date??bar?.[0]??''),open:Number(bar?.open??bar?.[1]),high:Number(bar?.high??bar?.[2]),low:Number(bar?.low??bar?.[3]),close:Number(bar?.close??bar?.[4]),volume:Number(bar?.volume??bar?.[5])}}
const isGood=b=>/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&b.open>0&&b.high>=Math.max(b.open,b.close)&&b.low>0&&b.low<=Math.min(b.open,b.close)&&Number.isFinite(b.volume)&&b.volume>=0;
function analyzeSR8({bars=[],asOf,lookback=240}={}){
 const q=String(asOf||''),series=bars.map(decode).filter(b=>!q||b.date<=q).sort((a,b)=>a.date.localeCompare(b.date));
 if(q&&series.at(-1)?.date!==q)return{valid:false,version:VERSION,reason:'指定日期缺少有效K棒'};
 if(series.length<65||new Set(series.map(x=>x.date)).size!==series.length||series.some(x=>!isGood(x)))return{valid:false,version:VERSION,reason:'需要至少65根連續且有效的歷史日OHLCV'};
 const d=series.slice(-clamp(lookback,65,240)),n=d.length,price=d.at(-1).close;
 const tr=d.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-d[i].close),Math.abs(b.low-d[i].close)));
 const atr=tr.slice(-20).reduce((a,b)=>a+b,0)/20;
 if(!(atr>0))return {valid:false,version:VERSION,reason:'ATR20無效'};
 const width=price*clamp(.45*atr/price,.004,.022),step=width*.65;
 const floor=Math.min(...d.map(x=>x.low)),ceil=Math.max(...d.map(x=>x.high));
 const nBins=Math.ceil((ceil-floor)/step)+1;
 if(nBins>650||!(ceil>floor))return{valid:false,version:VERSION,reason:'價格變動過大，可能有分割／增減資未校正'};
 const dens=new Float64Array(nBins),priceAt=j=>floor+step*j;
 const medvol=median(d.slice(-20).map(x=>x.volume).filter(x=>x>0));
 // Daily-price-volume PROFILE PROXY: assume within-day turnover distribution using
 // 70% price-range overlap body + 30% wick range. NEVER a claim of actual tick VAP.
 for(let i=0;i<n;i++){
  const b=d[i],lo=Math.min(b.open,b.close),hi=Math.max(b.open,b.close);
  const weight=(.65+.35*(i+1)/n)*clamp(b.volume/medvol,.35,3);
  const from=clamp(Math.floor((b.low-floor)/step)-1,0,nBins-1),to=clamp(Math.ceil((b.high-floor)/step)+1,0,nBins-1);
  const bw=Math.max(hi-lo,step),rw=Math.max(b.high-b.low,step);
  const weights=[];let bodyMass=0,rangeMass=0;
  for(let j=from;j<=to;j++){
   const p=priceAt(j),body=clamp(1-Math.max(lo-p,p-hi,0)/(step+bw*.25),0,1),range=p>=b.low&&p<=b.high?1:0;
   weights.push({j,body,range});bodyMass+=body;rangeMass+=range;
  }
  // Mass conservation: one candle's estimated total allocated volume is weight,
  // regardless of how many price bins its range covers.
  const mix=rangeMass>0?.70:1;
  for(const x of weights)dens[x.j]+=weight*(mix*x.body/Math.max(bodyMass,1e-9)+(1-mix)*x.range/Math.max(rangeMass,1e-9));
 }
 const densMax=Math.max(1,...dens),candidates=[];
 // 3+3 confirmation guarantees no future pivot leakage.
 const pivots=[];
 for(let i=3;i<n-3;i++){
  const around=d.slice(i-3,i+4),b=d[i];
  if(around.every((x,j)=>j===3||b.low<x.low))pivots.push({price:b.low,side:'S',i});
  if(around.every((x,j)=>j===3||b.high>x.high))pivots.push({price:b.high,side:'R',i});
 }
 for(let j=1;j<nBins-1;j++)if(dens[j]>=dens[j-1]&&dens[j]>=dens[j+1]&&dens[j]/densMax>=.17)candidates.push({price:priceAt(j),type:'density'});
 for(const p of pivots)candidates.push({price:p.price,type:'pivot',side:p.side});
 for(const length of [20,60,120,240]){
  const slice=d.slice(-Math.min(length,n));
  if(slice.length<20)continue;
  candidates.push({price:Math.min(...slice.map(b=>b.low)),type:'historical-floor',length});
  candidates.push({price:Math.max(...slice.map(b=>b.high)),type:'historical-ceiling',length});
 }
 candidates.sort((a,b)=>a.price-b.price);
 const clusters=[];
 for(const c of candidates){let z=clusters.at(-1);if(z&&c.price-z.last<=width*.85){z.items.push(c);z.last=c.price}else clusters.push({items:[c],last:c.price})}
 function score(z,side){
  let sum=0,c=0;for(const x of z.items){let w=x.type==='density'?1.4:x.type==='pivot'?(x.side===side?1.5:.15):.8;sum+=w*x.price;c+=w}
  const center=sum/c, lower=center-width, upper=center+width;
  const idx=clamp(Math.round((center-floor)/step),0,nBins-1),density=dens[idx]/densMax;
  const pts=pivots.filter(x=>x.side===side&&Math.abs(x.price-center)<=width*1.2);
  const test=pts.length;const anchors=z.items.filter(x=>x.type==='historical-floor'&&side==='S'||x.type==='historical-ceiling'&&side==='R').length;
  let contacts=0,reactions=0,failures=0,last=-99;
  for(let i=1;i<n-4;i++){
   const b=d[i],before=d[i-1];if(i-last<5)continue;
   const approached=side==='S'?before.close>upper:before.close<lower;
   if(!approached||b.high<lower||b.low>upper)continue;
   contacts++;last=i;const f=d.slice(i+1,i+5),amt=Math.max(.007,atr/price*.55);
   if(side==='S'){
    if(Math.max(...f.map(x=>x.high))>=Math.max(b.close,upper)*(1+amt))reactions++;
    if(Math.min(...f.map(x=>x.close))<lower)failures++;
   }else{
    if(Math.min(...f.map(x=>x.low))<=Math.min(b.close,lower)*(1-amt))reactions++;
    if(Math.max(...f.map(x=>x.close))>upper)failures++;
   }
  }
  const score=2.6*density+1.2*Math.min(3,test)+1.1*Math.min(3,contacts)+.9*Math.min(2,reactions)+.6*Math.min(2,anchors)-.7*Math.min(2,failures);
  return{center,lower,upper,strength:score,density,pivotCount:test,testCount:contacts,pastReactions:reactions,pastFailures:failures,anchors,sourceCount:new Set(z.items.map(x=>x.type)).size};
 }
 let supports=clusters.map(x=>score(x,'S')).filter(x=>x.center<price&&x.upper<price+width*.15).sort((a,b)=>b.center-a.center);
 let resists=clusters.map(x=>score(x,'R')).filter(x=>x.center>price&&x.lower>price-width*.15).sort((a,b)=>a.center-b.center);
 const r71v=r71.analyzeHybrid({bars:d,asOf:d.at(-1).date});
 if(!r71v.valid)return{valid:false,version:VERSION,reason:r71v.reason};
 const r3v=r3.analyzeSupportResistance({bars:d,asOf:d.at(-1).date,lookback:120});
 const independent=(a,b,side)=>a&&b&&(side==='S'?a.upper<b.lower-width*.10:a.lower>b.upper+width*.10);
 const historical=x=>x&&x.sourceCount>=1&&(x.strength>=2.3||x.pivotCount>=1||x.anchors>=1);
 let s1=r71v.levels.S1||supports.find(historical)||null,r1=r71v.levels.R1||resists.find(historical)||null;
 // If no candidate exists S1 still has a price-derived floor with explicit low confidence.
 let s1Origin=r71v.levels.S1?'R7.1-confirmed':'R8-price-profile',s2Origin='none';
 if(!s1){const histFloor=Math.min(...d.slice(-20).map(b=>b.low));const level=histFloor<price?histFloor:price-atr*.8;s1={center:level,lower:level-width,upper:level+width};s1Origin='unconfirmed-local-floor'}
 // S2 is always emitted from sufficient clean history. Unlike R2, it may be a
 // labelled *risk estimate* when there is no independent historical lower zone.
 let s2=null;
 const legacyS2=r71v.levels.S2;
 if(independent(legacyS2,s1,'S')){s2=legacyS2;s2Origin='R7.1-verified-history'}
 if(!s2){const candidates=supports.filter(x=>independent(x,s1,'S')&&historical(x));
  if(candidates.length){const candidate=candidates[0];s2=candidate;s2Origin=candidate.pivotCount>0||candidate.testCount>0?'R8-history-tested-zone':'R8-daily-profile-proxy-zone';}
 }
 if(!s2){const lows=[20,60,120,240].filter(w=>d.length>=w).map(w=>({w,low:Math.min(...d.slice(-w).map(x=>x.low))}));
  const under=lows.filter(x=>x.low<s1.lower-width*.3).sort((a,b)=>b.low-a.low);
  if(under.length){const p=under[0].low;s2={center:p,lower:p-width,upper:p+width,strength:0,pivotCount:0,testCount:0,anchors:1,density:0};s2Origin='R8-historical-low-unconfirmed'}
 }
 if(!s2){const candidate=Math.max(.01,s1.lower-Math.max(atr*1.5,width*2.5));s2={center:candidate,lower:Math.max(.01,candidate-width),upper:candidate+width,strength:0,pivotCount:0,testCount:0,anchors:0,density:0};s2Origin='ATR-projected-risk-reference-NOT-historical-support'}
 // An independent second price area is mandatory; never overlap S1.
 if(!(s2.upper<s1.lower)){const candidate=Math.max(.01,s1.lower-Math.max(atr*1.5,width*2.5));s2={center:candidate,lower:Math.max(.001,candidate-width),upper:candidate+width,strength:0,pivotCount:0,testCount:0,anchors:0,density:0};s2Origin='ATR-projected-risk-reference-NOT-historical-support'}
 // R2 remains legitimately absent at fresh historic highs or with weak evidence.
 let r2=r71v.levels.R2||null,r2Origin=r2?'R7.1-verified-history':'none';
 if(!r2&&r1){const candidate=resists.find(x=>independent(x,r1,'R')&&x.strength>=9&&x.pivotCount>=2&&x.testCount>=3&&x.sourceCount>=2);
  if(candidate){r2=candidate;r2Origin='R8-historical-major-candidate';}}
 const historicMax=Math.max(...d.slice(0,-1).map(x=>x.high));
 if(price>=historicMax){r2=null;r2Origin='historical-new-high-no-reliable-R2'}
 const fmt=(z,role,origin)=>z?{role,center:rnd(z.center),lower:rnd(z.lower),upper:rnd(z.upper),strength:rnd(z.strength??0),pivotCount:z.pivotCount??0,testCount:z.testCount??0,profileDensity:rnd(z.density??0,4),origin,
  confidence:origin.startsWith('ATR-')?'projected':origin.includes('unconfirmed')?'weak':origin.includes('verified')?'structural':origin.includes('tested')?'tested':origin.includes('proxy')?'estimated':'candidate',isHistorical:!origin.startsWith('ATR-'),researchOnly:true}:null;
 const levels={S1:fmt(s1,'S1',s1Origin),S2:fmt(s2,'S2',s2Origin),R1:fmt(r1,'R1',r71v.levels.R1?'R7.1-confirmed':'R8-price-profile'),R2:fmt(r2,'R2',r2Origin)};
 return{valid:true,version:VERSION,asOf:d.at(-1).date,price:rnd(price),atr20:rnd(atr),historyBars:n,levels,
  supportBounce:levels.S1,supportFinal:levels.S2,resistanceFirst:levels.R1,resistanceMajor:levels.R2,
  twoSupports:!!(levels.S1&&levels.S2&&levels.S2.upper<levels.S1.lower),
  S2_riskDistancePct:rnd((price-levels.S2.center)/price*100,2),
  S2_stopCaution:levels.S2.confidence==='projected'?'這是ATR估算防守參考，不是已發生的支撐，不能當作歷史有效防線':(price-levels.S2.center)/price>.12?'歷史S2距現價超過12%，不適合作為單一停損依據':'回測後才可判斷是否適合作為停損依據',
  note:'S2必給出可參照的價格區間；projected是波動風險估算、不是已證實的歷史支撐。R2創高允許空值。所有價量資料為日K代理，非逐價成交量。',researchOnly:true};
}
function evaluateFrozenSR8(snapshot,current,previous){if(!snapshot?.valid)return{valid:false};const b=decode(current),p=decode(previous),s=snapshot.levels;return{valid:true,date:b.date,frozenAsOf:snapshot.asOf,S1break:b.close<s.S1.lower,S2break:b.close<s.S2.lower,S2_isHistorical:s.S2.isHistorical,R1break:s.R1?b.close>s.R1.upper&&p.close<=s.R1.upper:null,R2break:s.R2?b.close>s.R2.upper&&p.close<=s.R2.upper:null,note:'持倉S2需鎖定買入日快照，不得隨下跌動態下修；研究用，無直接下單'};}
module.exports={VERSION,analyzeSR8,evaluateFrozenSR8};
