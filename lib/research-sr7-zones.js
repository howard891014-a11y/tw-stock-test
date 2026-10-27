'use strict';
/** StockZone R7 RESEARCH ONLY. K-bar price-volume OVERLAP PROXY, not real volume-at-price.
 * A zone must be justified by pre-existing OHLCV density or CONFIRMED pivots.
 * Signals only depend on bars <= asOf. No forced S1/S2/R1/R2. No trading.
 */
const VERSION='SR7-240d-density-confirmed-pivot-reaction-20261027';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const round=(v,k=3)=>Number.isFinite(v)?Number(v.toFixed(k)):null;
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
function decode(bar){return{date:String(bar.date??bar.trade_date??bar[0]??''),open:Number(bar.open??bar[1]),high:Number(bar.high??bar[2]),low:Number(bar.low??bar[3]),close:Number(bar.close??bar[4]),volume:Number(bar.volume??bar.trade_volume??bar[5])};}
function validBar(b){return /\d{4}-\d{2}-\d{2}/.test(b.date)&&b.low>0&&b.open>0&&b.close>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&Number.isFinite(b.volume)&&b.volume>=0;}
function analyzeSR7({bars=[],asOf,lookback=240}={}){
 const date=String(asOf??''),listed=bars.map(decode).filter(b=>!date||b.date<=date).sort((a,b)=>a.date.localeCompare(b.date));
 if(date&&!listed.some(b=>b.date===date))return{valid:false,version:VERSION,reason:'缺少指定日K棒'};
 if(listed.length<65)return{valid:false,version:VERSION,reason:'歷史K棒少於65根'};
 if(new Set(listed.map(b=>b.date)).size!==listed.length||listed.some(b=>!validBar(b)))return{valid:false,version:VERSION,reason:'歷史K棒無效或日期重複'};
 const data=listed.slice(-Math.min(240,Math.max(65,lookback|0))),n=data.length,price=data.at(-1).close;
 const trs=data.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-data[i].close),Math.abs(b.low-data[i].close)));
 const atr=avg(trs.slice(-20));if(!(atr>0))return{valid:false,reason:'ATR20不合法',version:VERSION};
 const half=price*clamp(atr/price*.35,.0035,.018),step=half*.85;
 const lo=Math.floor(Math.min(...data.map(b=>b.low))/step)*step,hi=Math.ceil(Math.max(...data.map(b=>b.high))/step)*step;
 const gridSize=Math.round((hi-lo)/step)+1;if(gridSize>750)return{valid:false,reason:'K棒價格範圍異常，待公司行動查核',version:VERSION};
 const density=new Float64Array(gridSize),vols=data.slice(-20).map(b=>b.volume).filter(x=>x>0).sort((a,b)=>a-b),median=vols[Math.floor(vols.length/2)]||1;
 // Close + body concentration + faint wicks; recency + capped volume support, never claimed as real intraday transaction distribution.
 for(let i=0;i<n;i++){
  const b=data[i],w=(.65+.35*(i+1)/n)*clamp(b.volume/median,.4,2.5);
  const l=Math.min(b.open,b.close),h=Math.max(b.open,b.close),bl=Math.max(h-l,step*.6);
  const from=clamp(Math.floor((b.low-step-lo)/step),0,gridSize-1),to=clamp(Math.ceil((b.high+step-lo)/step),0,gridSize-1);
  for(let j=from;j<=to;j++){
   const p=lo+j*step,body=(p>=l&&p<=h)?1:clamp(1-Math.min(Math.abs(p-l),Math.abs(p-h))/(step+bl*.35),0,1),wick=(p>=b.low&&p<=b.high)?1:0,
    close=clamp(1-Math.abs(p-b.close)/(1.6*step),0,1);
   density[j]+=w*(.60*body+.28*close+.12*wick);
  }
 }
 const pivots=[];
 for(let i=2;i<n-2;i++){
  const b=data[i];if(data.slice(i-2,i+3).every((x,j)=>j===2||b.low<x.low))pivots.push({p:b.low,type:'support',index:i});
  if(data.slice(i-2,i+3).every((x,j)=>j===2||b.high>x.high))pivots.push({p:b.high,type:'resistance',index:i});
 }
 const max=Math.max(...density),prominence=max*.15,raw=[];
 for(let i=1;i<gridSize-1;i++)if(density[i]>=prominence&&density[i]>=density[i-1]&&density[i]>=density[i+1])raw.push({p:lo+i*step,source:'density'});
 for(const p of pivots)raw.push({p:p.p,source:'pivot'});
 // Consolidate overlapping peaks BEFORE labeling support/resistance.
 raw.sort((a,b)=>a.p-b.p);
 const groups=[];
 for(const z of raw){let g=groups.at(-1);if(g&&z.p-g.last<half*1.3){g.prices.push(z);g.last=z.p;}else groups.push({prices:[z],last:z.p});}
 const rawZones=[];
 for(const g of groups){
  const p=g.prices.map(x=>x.p);const center=p.length===1?p[0]:p[Math.floor(p.length/2)];
  const lower=center-half,upper=center+half,j=clamp(Math.round((center-lo)/step),0,gridSize-1),dens=density[j]/Math.max(1,max);
  let sn=0,rn=0,sBounce=0,rReject=0,sFailure=0,rBreak=0,ptS=0,ptR=0;
  for(const p of pivots)if(Math.abs(p.p-center)<=half*1.5){if(p.type==='support')ptS++;else ptR++;}
  // Past test and reaction require up to 4 FOLLOWING days ALREADY IN THE PAST.
  // Count events at least five days apart, preventing a tight sideways patch counting dozens of times.
  let lastS=-99,lastR=-99;
  for(let i=1;i<n-4;i++){
   const b=data[i],prev=data[i-1],within=b.low<=upper&&b.high>=lower;
   if(!within)continue;
   const future=data.slice(i+1,i+5),move=Math.max(.007,atr/price*.6);
   if(prev.close>upper&&i-lastS>=5){
    sn++;lastS=i;
    const highest=Math.max(...future.map(z=>z.high)),lowest=Math.min(...future.map(z=>z.low));
    if(highest>=Math.max(b.close,upper)*(1+move))sBounce++;
    if(lowest<lower*(1-move*.2))sFailure++;
   }
   if(prev.close<lower&&i-lastR>=5){
    rn++;lastR=i;
    const lowest=Math.min(...future.map(z=>z.low)),highest=Math.max(...future.map(z=>z.high));
    if(lowest<=Math.min(b.close,lower)*(1-move))rReject++;
    if(highest>upper*(1+move*.2))rBreak++;
   }
  }
  const sRate=sn?sBounce/sn:null,rRate=rn?rReject/rn:null;
  const scoreS=1.8*Math.min(1,dens)+1.25*Math.min(3,ptS)+1.25*Math.min(4,sn)+1.1*Math.min(2,sBounce);
  const scoreR=1.8*Math.min(1,dens)+1.25*Math.min(3,ptR)+1.25*Math.min(4,rn)+1.1*Math.min(2,rReject);
  rawZones.push({center,lower,upper,density:dens,pivotS:ptS,pivotR:ptR,sTests:sn,rTests:rn,sBounce,rReject,sFailure,rBreak,sRate,rRate,scoreS,scoreR});
 }
 const qualifying=(z,side)=>{const sc=side==='support'?z.scoreS:z.scoreR,pt=side==='support'?z.pivotS:z.pivotR,tests=side==='support'?z.sTests:z.rTests;return sc>=2.15&&(pt>=1||tests>=1||z.density>=.48)};
 // We can consider a zone containing the last close support OR resistance, not both. Direction is determined by past role evidence.
 const supports=rawZones.filter(z=>z.center<=price+half*.35&&(z.upper<price||z.scoreS>=z.scoreR*1.18))
  .filter(z=>qualifying(z,'support')).sort((a,b)=>b.center-a.center);
 const resists=rawZones.filter(z=>z.center>=price-half*.35&&(z.lower>price||z.scoreR>z.scoreS*1.18))
  .filter(z=>qualifying(z,'resistance')).sort((a,b)=>a.center-b.center);
 const s1=supports[0]||null,r1=resists[0]||null;
 const major=(side,first,arr)=>{
  if(!first)return null;
  const allowed=arr.filter(z=>side==='support'?z.upper<first.lower-half*.15:z.lower>first.upper+half*.15);
  const key=side==='support'?'scoreS':'scoreR';
  // S2/R2 need independent evidence >= S1/R1, rather than second-nearest arbitrary line.
  const qualifies=allowed.filter(z=>z[key]>=Math.max(3.15,first[key]*1.05));
  return qualifies[0]||null;
 };
 const s2=major('support',s1,supports),r2=major('resistance',r1,resists);
 function fmt(z,role){return z?{role,center:round(z.center,2),lower:round(z.lower,2),upper:round(z.upper,2),strength:round(role.startsWith('S')?z.scoreS:z.scoreR,2),density:round(z.density,3),pivotCount:role.startsWith('S')?z.pivotS:z.pivotR,testCount:role.startsWith('S')?z.sTests:z.rTests,successCount:role.startsWith('S')?z.sBounce:z.rReject,pastReactionRate:round(role.startsWith('S')?z.sRate:z.rRate),lastClose:round(price,2)}:null;}
 const levels={S1:fmt(s1,'S1'),S2:fmt(s2,'S2'),R1:fmt(r1,'R1'),R2:fmt(r2,'R2')};
 // Relative difficulty is only a hypothesis; measured out-of-sample conditional-on-touch, not defined by score.
 return{valid:true,version:VERSION,asOf:data.at(-1).date,historyBars:n,price:round(price,2),atr20:round(atr,3),halfWidth:round(half,3),levels,
  supportBounce:levels.S1,supportFinal:levels.S2,resistanceFirst:levels.R1,resistanceMajor:levels.R2,
  coverage:Object.fromEntries(Object.entries(levels).map(([k,v])=>[k,!!v])),
  historicalMethod:'日K實體密度+估算成交量權重（非真實逐價成交量）+已確認pivot+截止asOf的歷史觸及反應；S2/R2需更高歷史證據',researchOnly:true};
}
function evaluateFrozen(frozen,cur,prev){if(!frozen?.valid||!cur||!prev)return {valid:false};const b=decode(cur),p=decode(prev),lev=frozen.levels;
 return{valid:true,date:b.date,from:frozen.asOf,
  S1touch:!!lev.S1&&b.low<=lev.S1.upper&&b.high>=lev.S1.lower,
  S1break:lev.S1?b.close<lev.S1.lower:null,
  S2break:lev.S2?b.close<lev.S2.lower:null,
  R1touch:!!lev.R1&&b.low<=lev.R1.upper&&b.high>=lev.R1.lower,
  R1break:lev.R1?b.close>lev.R1.upper&&p.close<=lev.R1.upper:null,
  R2break:lev.R2?b.close>lev.R2.upper&&p.close<=lev.R2.upper:null,
  note:'前日鎖定區間，不得使用當日重新計算的S2下修停損'};}
module.exports={VERSION,analyzeSR7,evaluateFrozen};
