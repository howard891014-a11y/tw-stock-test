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
