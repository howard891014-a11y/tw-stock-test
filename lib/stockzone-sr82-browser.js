// StockZone R8.2 standalone browser build. Built from frozen research source files.
(function(root){"use strict";const factories=Object.create(null),cache=Object.create(null);
function localRequire(id){if(cache[id])return cache[id].exports;const f=factories[id];if(!f)throw new Error("missing SR8 module "+id);const module={exports:{}};cache[id]=module;f(module,module.exports,localRequire);return module.exports;}
factories["./research-sr4-zones"]=function(module,exports,require){
'use strict';
/**
 * StockZone R3: Research-only four-zone support/resistance mapper.
 * Inputs: daily OHLCV only. 'Volume concentration' means a transparent
 * OHLCV/body-overlap proxy; it is NOT actual volume-at-price from intraday ticks.
 * Excludes future bars, requires pivot confirmation, never fabricates 4 levels.
 * No Neon/Supabase writes, no live orders, no alteration of original R2/R1.
 */
const VERSION='sr4-kbar-clusters-pivots-research-20261027';
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const round=(x,n=2)=>Number.isFinite(x)?+x.toFixed(n):null;
function analyzeSupportResistance(input={}){
  const asOf=String(input.asOf||''),src=Array.isArray(input.bars)?input.bars:[];
  const mapped=src.map(b=>({
    date:String(b?.date??b?.tradeDate??b?.trade_date??b?.[0]??''),
    open:Number(b?.open??b?.[1]),high:Number(b?.high??b?.[2]),
    low:Number(b?.low??b?.[3]),close:Number(b?.close??b?.[4]),
    volume:Number(b?.volume??b?.tradeVolume??b?.trade_volume??b?.[5])
  })).filter(b=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.date) && (!asOf || b.date<=asOf))
    .sort((a,b)=>a.date.localeCompare(b.date));
  if(asOf&&!mapped.some(b=>b.date===asOf))return {valid:false,reason:'指定日期缺少有效K棒',version:VERSION};
  if(mapped.length<65)return {valid:false,reason:'少於65根歷史K棒',version:VERSION};
  if(new Set(mapped.map(x=>x.date)).size!==mapped.length)return {valid:false,reason:'重複日期K棒',version:VERSION};
  if(mapped.some(b=>!Number.isFinite(b.volume)||b.volume<0||b.low<=0||b.open<=0||b.close<=0||b.high<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))return {valid:false,reason:'OHLCV資料不合法',version:VERSION};
  const data=mapped.slice(-Math.max(65,Math.min(120,Number(input.lookback)||120))),n=data.length,price=data[n-1].close;
  const tr=[];for(let i=1;i<n;i++){const b=data[i];tr.push(Math.max(b.high-b.low,Math.abs(b.high-data[i-1].close),Math.abs(b.low-data[i-1].close)))}
  const atr=tr.slice(-20).reduce((s,x)=>s+x,0)/20;
  if(!Number.isFinite(atr)||atr<=0)return{valid:false,reason:'ATR無效',version:VERSION};
  // 0.4%-2.2% adaptive zone half-width, never a single exact-price threshold.
  const band=price*clamp(0.40*atr/price,0.004,0.022);
  const minL=Math.min(...data.map(b=>b.low)),maxH=Math.max(...data.map(b=>b.high));
  if((maxH-minL)>price*2.4)return{valid:false,reason:'價格變動幅度異常；需查核公司行動',version:VERSION};
  const width=band;let step=band;const nBins=Math.ceil((maxH-minL)/step);
  if(nBins>400)return{valid:false,reason:'價格帶超出可計算範圍',version:VERSION};
  const centers=Array.from({length:nBins+1},(_,i)=>minL+i*step);
  const dens=new Float64Array(centers.length);
  const vols=data.slice(-20).map(b=>b.volume).filter(x=>x>0).sort((a,b)=>a-b);
  const medvol=vols.length?vols[Math.floor(vols.length/2)]:1;
  for(let i=0;i<n;i++){
    const b=data[i],age=n-1-i,recency=0.55+0.45*(1-age/n),v=clamp(medvol?b.volume/medvol:1,0.3,2.5);
    const bodyLo=Math.min(b.open,b.close),bodyHi=Math.max(b.open,b.close),effective=Math.max(bodyHi-bodyLo,step*.70);
    const centerBody=(bodyHi+bodyLo)/2,from=Math.max(0,Math.floor((centerBody-effective/2-minL-step)/step)),to=Math.min(nBins,Math.ceil((centerBody+effective/2-minL+step)/step));
    for(let j=from;j<=to;j++){
      const dist=Math.abs(centers[j]-centerBody),body=clamp(1-dist/(effective/2+step),0,1);
      const close=clamp(1-Math.abs(centers[j]-b.close)/(step*1.5),0,1);
      dens[j]+=recency*v*(0.70*body+0.30*close);
    }
  }
  // Confirmed pivots: a bar must have two subsequent candles by asOf.
  const pivots=[];
  for(let i=2;i<n-2;i++){
    const hi=data.slice(i-2,i+3),b=data[i];
    if(hi.every((x,j)=>j===2||b.low<x.low))pivots.push({level:b.low,type:'support',i});
    if(hi.every((x,j)=>j===2||b.high>x.high))pivots.push({level:b.high,type:'resistance',i});
  }
  const denMax=Math.max(1,...dens),candidates=[];
  for(let j=1;j<nBins;j++){
    if(dens[j]>=dens[j-1]&&dens[j]>=dens[j+1]&&dens[j]>=denMax*.13)candidates.push({level:centers[j],kind:'density'});
  }
  // Pivots may identify major turning points outside the largest body clusters.
  for(const p of pivots)candidates.push({level:p.level,kind:'pivot'});
  const map=new Map();
  for(const c of candidates){const k=Math.round((c.level-minL)/step);if(k>=0&&k<=nBins){const existing=map.get(k)||{level:centers[k],sources:new Set()};existing.sources.add(c.kind);map.set(k,existing)}}
  const clusters=[];
  for(const c of map.values()){
    const bLow=c.level-band,bHigh=c.level+band;
    let countTouches=0,positive=0,negative=0,lastTouch=-100;
    for(let i=2;i<n-3;i++){
      const b=data[i],isTouch=b.low<=bHigh&&b.high>=bLow;
      if(!isTouch||i-lastTouch<3)continue;
      const future=data.slice(i+1,i+4);
      const rises=(Math.max(...future.map(x=>x.high))-b.close)/b.close;
      const falls=(b.close-Math.min(...future.map(x=>x.low)))/b.close;
      const cutoff=Math.max(0.009,0.50*atr/b.close);
      if(rises>=cutoff||falls>=cutoff){countTouches++;if(rises>=cutoff&&b.low<=bHigh)positive++;if(falls>=cutoff&&b.high>=bLow)negative++;lastTouch=i}
    }
    const pivotSupport=pivots.filter(p=>p.type==='support'&&Math.abs(p.level-c.level)<=band).length;
    const pivotResistance=pivots.filter(p=>p.type==='resistance'&&Math.abs(p.level-c.level)<=band).length;
    const density=dens[Math.round((c.level-minL)/step)]/denMax;
    const score=(side)=>round(5*Math.min(1,density)+2*Math.min(3,side==='support'?pivotSupport:pivotResistance)+1.2*Math.min(4,side==='support'?positive:negative)+0.35*Math.min(5,countTouches),2);
    clusters.push({level:c.level,band,lower:c.level-band,upper:c.level+band,density:round(density,3),touches:countTouches,positive,negative,pivotSupport,pivotResistance,scoreSupport:score('support'),scoreResistance:score('resistance')});
  }
  // Nearby density peaks and pivots represent one zone, not fake extra lines.
  clusters.sort((a,b)=>a.level-b.level);
  const merged=[];
  for(const c of clusters){let target=merged.at(-1);if(target&&c.level-target.level<band*1.6){
    const boost=c.density>target.density;c.level=boost?c.level:target.level;
    c.density=Math.max(target.density,c.density);c.touches=Math.max(target.touches,c.touches);
    c.scoreSupport=Math.max(target.scoreSupport,c.scoreSupport);c.scoreResistance=Math.max(target.scoreResistance,c.scoreResistance);
    c.pivotSupport=Math.max(target.pivotSupport,c.pivotSupport);c.pivotResistance=Math.max(target.pivotResistance,c.pivotResistance);
    merged[merged.length-1]=c;
  } else merged.push(c)}
  const filter=(side)=>merged.filter(z=>side==='support'?z.upper<price:z.lower>price).map(z=>({...z,strength:side==='support'?z.scoreSupport:z.scoreResistance}));
  const supports=filter('support').sort((a,b)=>b.level-a.level);
  const resistances=filter('resistance').sort((a,b)=>a.level-b.level);
  const valid=z=>z && z.strength>=2.2 && (z.touches>=1||z.pivotSupport+z.pivotResistance>=1||z.density>=.26);
  const s1=supports.find(valid),r1=resistances.find(valid);
  const strongerAfter=(arr,first,side)=>{
    if(!first)return null;
    const eligible=arr.filter(z=>side==='support'?z.upper<first.lower-band*.25:z.lower>first.upper+band*.25).filter(valid);
    if(!eligible.length)return null;
    // For final defense / major pressure favor tested robust areas, not second-nearest.
    const max=Math.max(...eligible.map(x=>x.strength));
    const minMajor=side==='resistance'?first.strength*1.10:first.strength*1.04;
    const qualified=eligible.filter(x=>x.strength>=Math.max(2.5,0.72*max,minMajor));
    return qualified[0]||null;
  };
  const s2=strongerAfter(supports,s1,'support'),r2=strongerAfter(resistances,r1,'resistance');
  const fmt=(z,key)=>z?{type:key,center:round(z.level),lower:round(z.level-band),upper:round(z.level+band),strength:z.strength,density:z.density,touches:z.touches,pivotSupport:z.pivotSupport,pivotResistance:z.pivotResistance}:null;
  const out={valid:true,version:VERSION,asOf:data.at(-1).date,price:round(price),atr20:round(atr),zoneHalfWidth:round(band),
    supportBounce:fmt(s1,'bounce'),supportFinal:fmt(s2,'last-defense'),
    resistanceFirst:fmt(r1,'first-hurdle'),resistanceMajor:fmt(r2,'major-hurdle'),
    methodology:'日K實體重疊密度(代理，不是真正逐價成交分布)+已確認pivot+歷史觸及反應；上下各兩個區間；強弱是研究分數，非突破率',
    insufficientLevels:['supportBounce','supportFinal','resistanceFirst','resistanceMajor'].filter(k=>!({supportBounce:s1,supportFinal:s2,resistanceFirst:r1,resistanceMajor:r2})[k]),
    studyOnly:true,tradeAuthority:false};
  // Structural cues are deliberately separate from execution. One weak bounce
  // support failing is NOT an automatic exit. Hard risk ceiling must be frozen
  // at actual entry and never lowered to chase a falling stock.
  out.riskCues={atSupport1:s1?price-s1.upper<=atr*0.75:false,
    atResistance1:r1?r1.lower-price<=atr*0.75:false,
    hasTwoSupports:!!s1&&!!s2,hasTwoResistances:!!r1&&!!r2,
    supportBreak:'使用上一交易日鎖定的區間比較當日收盤；不可用當日重新計算的區間回頭認定失守'};
  return out;
}
/** Evaluate today's candle versus *yesterday's frozen zone snapshot*.
 * For actual positions, snapshot S1/S2 on entry; never move last defense
 * down on account of a later lower print.  No automatic sell is issued here.
 */
function evaluateFrozenZones(frozen, current, previous, options={}){
 if(!frozen?.valid||!current||!previous)return{valid:false,reason:'缺少鎖定區間或前後K棒'};
 const close=+current.close,prevClose=+previous.close,high=+current.high,low=+current.low;
 if(!Number.isFinite(close)||!Number.isFinite(prevClose)||close<=0||prevClose<=0||!Number.isFinite(high)||!Number.isFinite(low))return{valid:false,reason:'比較K棒不合法'};
 const s1=frozen.supportBounce,s2=frozen.supportFinal,r1=frozen.resistanceFirst,r2=frozen.resistanceMajor;
 const rule=(z,dir)=>!z?null:dir==='breakdown'?(close<z.lower):(close>z.upper&&prevClose<=z.upper);
 const riskPct=clamp(Number(options.maxLossPct??0.08),0.02,0.15);
 const entry=Number(options.entryPrice),hardStop=Number.isFinite(entry)&&entry>0?round(entry*(1-riskPct)):null;
 const belowHardStop=hardStop==null?null:low<=hardStop;
 return {valid:true,frozenAsOf:frozen.asOf,markedDate:String(current.date||''),studyOnly:true,
  nearSupport1:s1?low<=s1.upper&&close>=s1.lower:null,
  support1CloseBreak:rule(s1,'breakdown'),support2CloseBreak:rule(s2,'breakdown'),
  resistance1CloseBreak:rule(r1,'breakout'),resistance2CloseBreak:rule(r2,'breakout'),
  hardStop,hardStopTouched:belowHardStop,
  actionCues:belowHardStop?'觸及最大風險防線（僅研究標記，成交須按當日開盤及價格模擬）':
    rule(s2,'breakdown')?'最後防線收盤失守：停止補倉並啟動減碼／停損研究':
    rule(s1,'breakdown')?'反彈支撐收盤失守：先停止補倉、評估核心防線':
    rule(r2,'breakout')?'突破重大壓力：需量價確認，不直接滿倉':
    rule(r1,'breakout')?'突破第一壓力：需量價確認，評估分批加碼':
    '未有區間突破／失守訊號',
  note:'有效突破／失守的量價確認、停損成交規則，必須與其他指標及隔日成交回測一起評估。'};
}
module.exports={VERSION,analyzeSupportResistance,evaluateFrozenZones};

};
factories["./research-sr7-zones"]=function(module,exports,require){
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

};
factories["./research-sr7-hybrid"]=function(module,exports,require){
'use strict';
/** Research only: protect R3's empirically stronger *near* levels;
 * try R7's longer 240d history for a genuinely independent major zone.
 * Missing major zones remain null; no fake R2/S2 from ATR or MA.
 */
const old=require('./research-sr4-zones'),modern=require('./research-sr7-zones');
const VERSION='SR7.1-hybrid-primary-R3-extended-major-R7';
function analyzeHybrid({bars=[],asOf}={}){
 const a=old.analyzeSupportResistance({bars,asOf,lookback:120});
 const b=modern.analyzeSR7({bars,asOf,lookback:240});
 if(!a.valid||!b.valid)return {valid:false,version:VERSION,reason:a.reason||b.reason};
 const S1=a.supportBounce||b.levels.S1,R1=a.resistanceFirst||b.levels.R1;
 const select=(legacy,extended,first,side)=>{
  const separate=z=>z&&first&&(side==='support'?z.upper<first.lower:z.lower>first.upper);
  if(separate(legacy))return{...legacy,origin:'R3-verified-major'};
  // S2/R2 must be independent high-evidence zones, not arbitrary distant lines.
  if(separate(extended)&&extended.strength>=5 &&(extended.testCount>=1||extended.pivotCount>=2))return{...extended,origin:'R7-240d-major-candidate'};
  return null;
 };
 const levels={S1:S1?{...S1,origin:a.supportBounce?'R3-near':'R7-near-fallback'}:null,
   S2:select(a.supportFinal,b.levels.S2,S1,'support'),
   R1:R1?{...R1,origin:a.resistanceFirst?'R3-near':'R7-near-fallback'}:null,
   R2:select(a.resistanceMajor,b.levels.R2,R1,'resistance')};
 return{valid:true,version:VERSION,asOf:a.asOf,historyBars:b.historyBars,price:a.price,atr20:a.atr20,levels,
  supportBounce:levels.S1,supportFinal:levels.S2,resistanceFirst:levels.R1,resistanceMajor:levels.R2,
  originalR3:a.version,extendedR7:b.version,
  note:'用R3近檔精度保護S1/R1，擴充240日歷史尋找S2/R2；R2較難突破仍須條件化回測證明',researchOnly:true};}
module.exports={VERSION,analyzeHybrid};

};
factories["./research-sr8-fusion"]=function(module,exports,require){
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

};
root.StockZoneSR8=localRequire("./research-sr8-fusion");})(window);
