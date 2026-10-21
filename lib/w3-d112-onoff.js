'use strict';
// W3-D.1.2 ON/OFF core (2026-10-20): exact W3-D.1.1 fork + one deduction confirmation gate.
// Original reference byte-identical copy in ../vendor/w3-d111.js; see README.md.
// Input: chronological market-day records from the same stock-level native source.
// No Normal state, no database writes, no external requests from this module.
const finite=Number.isFinite;
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const valid=v=>v!==null&&v!==undefined&&v!==''&&finite(Number(v))?Number(v):NaN;
const p80=a=>{const b=[...a].sort((x,y)=>x-y),k=(b.length-1)*.8,j=Math.floor(k);return b[j]+(b[Math.min(j+1,b.length-1)]-b[j])*(k-j)};
function computeW3D112OnOff(input){
 if(!Array.isArray(input))throw Error('W3-D.1.2 requires explicit chronological source records');
 const data=input.map(src=>({
  date:String(src.date||src.trade_date||'').slice(0,10),
  close:valid(src.taiex??src.close),
  advance:valid(src.advance_ratio??src.advance),
  breadth5:valid(src.breadth5??src.breadth_5),
  institutionalValue:valid(src.institutional_value_twd??src.inst_value_twd??src.institutionalValue),
  financingMV:valid(src.financing_value_twd??src.financingMV),
  sourceQuality:src.sourceQuality||null
 }));
 for(let i=0;i<data.length;i++){
  const r=data[i],p=data[i-1];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||(p&&r.date<=p.date))throw Error('W3-D.1.2 expects sorted unique YYYY-MM-DD trading days');
  const part=(key,n)=>i>=n-1?data.slice(i-n+1,i+1).map(x=>x[key]):[];
  const ma=(key,n)=>{const v=part(key,n);return v.length===n&&v.every(finite)?avg(v):NaN};
  r.ma5=ma('close',5);r.ma10=ma('close',10);r.ma20=ma('close',20);
  const ret=n=>i>=n&&finite(r.close)&&finite(data[i-n].close)&&data[i-n].close>0?100*(r.close/data[i-n].close-1):NaN;
  r.ret1=ret(1);r.ret3=ret(3);r.ret5=ret(5);
  const closes=part('close',20);
  r.drawdown20=closes.length===20&&closes.every(finite)?100*(r.close/Math.max(...closes)-1):NaN;
  const flow=data.slice(Math.max(0,i-20),i).map(x=>x.institutionalValue).filter(finite);
  if(flow.length>=10&&finite(r.institutionalValue)){
   const m=avg(flow),sd=Math.sqrt(avg(flow.map(x=>(x-m)**2)));
   r.institutionalZ20=(r.institutionalValue-m)/(sd>1e-9?sd:1);
  }else r.institutionalZ20=NaN;
  r.financeGrowth10=i>=10&&finite(r.financingMV)&&finite(data[i-10].financingMV)&&data[i-10].financingMV>0?100*(r.financingMV/data[i-10].financingMV-1):NaN;
  const prevFin=data.slice(Math.max(0,i-20),i).map(x=>x.financingMV);
  r.financeP80=prevFin.length===20&&prevFin.every(finite)?p80(prevFin):NaN;
  r.financeHot=finite(r.financeP80)&&finite(r.financeGrowth10)?(r.financingMV>=r.financeP80&&r.financeGrowth10>3):null;
  const z=r.institutionalZ20,a=r.advance,b=r.breadth5;
  r.institutionalPoints=!finite(z)?NaN:z<=-2.5?40:z<=-2?35:z<=-1.5?25:z<=-1?15:0;
  r.breadthPoints=!finite(a)||!finite(b)?NaN:b<40&&a<40?30:b<48&&a<50?25:b<50||a<30?15:0;
  r.financingPoints=r.financeHot===null?NaN:r.financeHot?20:0;
  r.momentumPoints=!finite(r.ret3)||!finite(r.ma5)?NaN:r.close<r.ma5&&r.ret3<0?10:r.close<r.ma5||r.ret3<0?5:0;
  const repair={
   institutional:finite(z)&&z>=.5,
   breadth:finite(a)&&finite(b)&&a>=70&&b>=50,
   financing:finite(r.financeGrowth10)&&r.financeGrowth10<=0,
   momentum:finite(r.ma5)&&finite(r.ret3)&&r.close>r.ma5&&r.ret3>0
  };
  const keys=['institutional','breadth','financing','momentum'];
  for(const key of keys){
   const value=r[key+'Points'],previous=p?.[key+'Points'];
   r[key+'Held']=!finite(value)?NaN:repair[key]?0:Math.max(value,finite(previous)?previous*.7:0);
  }
  r.valid=keys.every(key=>finite(r[key+'Held']));
  r.riskScore=r.valid?keys.reduce((sum,key)=>sum+r[key+'Held'],0):null;
  r.rawScore=r.valid?keys.reduce((sum,key)=>sum+r[key+'Points'],0):null;
  const score=r.riskScore;
  // One targeted departure from D.1.1: confirm an ordinary progressive OFF
  // by institutional 20D MA deduction and normalized 5D-flow-trend.
  // All four ORIGINAL OFF triggers and three ON triggers are otherwise preserved.
  const f20=data.slice(i-20,i).map(x=>x.institutionalValue);
  const f10=data.slice(i-9,i+1).map(x=>x.institutionalValue);
  const completeFlow=i>=20&&f20.length===20&&f10.length===10&&
    f20.every(finite)&&f10.every(finite)&&finite(r.institutionalValue);
  let confirmed=null;
  r.flowDeduct20=null;r.flowTrend5Z=null;
  if(completeFlow){
   const fm=avg(f20),fsd=Math.sqrt(avg(f20.map(x=>(x-fm)**2)));
   if(fsd>1e-9){
    r.flowDeduct20=r.institutionalValue-data[i-20].institutionalValue;
    r.flowTrend5Z=(avg(f10.slice(-5))-avg(f10.slice(0,5)))/fsd;
    confirmed=r.flowDeduct20<0&&r.flowTrend5Z<=.15;
   }
  }
  r.progressiveOffOriginal=!!(r.valid&&score>=75&&p&&p.breadthPoints>=15&&z<=-1.5&&z<p.institutionalZ20&&r.close<r.ma5&&r.ret3<0&&r.financeHot===true&&r.financeGrowth10>=5&&b<55&&r.breadthHeld>0);
  // If deduction history is incomplete, keep the ORIGINAL protection instead
  // of silently suppressing a legitimate OFF trigger.
  r.progressiveOff=r.progressiveOffOriginal&&(confirmed===null||confirmed);
  r.flowDeductionConfirmed=confirmed;
  r.panicOff=!!(r.valid&&score>=75&&z<=-2&&a<12&&b<42&&r.drawdown20<=-8&&r.ret5<=-5);
  r.rapidPanicOff=!!(r.valid&&score>=65&&z<=-1.8&&a<10&&b<40&&r.drawdown20<=-7&&r.ret5<=-5);
  // Independent severe crash guard: no institution/financing prerequisite.
  r.systemShockOff=!!(i>0&&finite(r.ret1)&&finite(a)&&finite(b)&&r.ret1<=-6&&a<=12&&b<45);
  r.strongThrustOn=!!(p&&finite(z)&&z>=2&&a>=80&&p.advance<=35&&a-b>=30);
  r.comprehensiveOn=!!(r.valid&&z>=2&&a>=80&&b>=50&&r.close>r.ma20&&r.ret3>0&&score<=25);
  r.slope5=i>=7&&finite(r.ma5)&&finite(data[i-3].ma5)?r.ma5-data[i-3].ma5:NaN;
  r.slope10=i>=12&&finite(r.ma10)&&finite(data[i-3].ma10)?r.ma10-data[i-3].ma10:NaN;
  r.bullishStructure=!!(r.ma5>r.ma10&&r.ma10>r.ma20&&r.slope5>0&&r.slope10>0);
 }
 let state='RiskOn',stay=0;
 const records=[],switches=[];
 for(let i=0;i<data.length;i++){
  const r=data[i],prev=data[i-1],old=state;
  let why='';
  if(state==='RiskOn'){
   if(r.systemShockOff){state='RiskOff';why='system_shock'}
   else if(r.progressiveOff){state='RiskOff';why='risk_progression'}
   else if(r.panicOff){state='RiskOff';why='panic'}
   else if(r.rapidPanicOff){state='RiskOff';why='rapid_panic'}
  }else if(state==='RiskOff'){
   if(r.strongThrustOn){state='RiskOn';why='strong_thrust'}
   else if(r.comprehensiveOn){state='RiskOn';why='comprehensive_recovery'}
   else if(stay>=3&&r.bullishStructure&&prev?.bullishStructure&&r.valid&&r.riskScore<=25){state='RiskOn';why='bullish_repair'}
  }
  // Model cannot issue a fresh state from incomplete daily input. Historical state carries through unchanged.
  // For complete production availability, callers must report data quality separately.
  if(old!==state){switches.push({date:r.date,from:old,to:state,reason:why,score:r.riskScore});stay=0}else stay++;
  // Warning entry and exit are independently computed in w3-d112.js.
  records.push({date:r.date,regime:state,score:r.riskScore,valid:r.valid,
   reason:why,flowZ20:finite(r.institutionalZ20)?r.institutionalZ20:null,
   breadth5:finite(r.breadth5)?r.breadth5:null,advanceRatio:finite(r.advance)?r.advance:null,
   marginGrowth10:finite(r.financeGrowth10)?r.financeGrowth10:null,
   indexReturn1:finite(r.ret1)?r.ret1:null,
   inputQuality:!r.valid?'incomplete':'complete',modelVersion:'W3-D.1.2/ONOFF',
   progressiveOffOriginal:r.progressiveOffOriginal,progressiveOffConfirmed:r.progressiveOff,
   flowDeduct20:r.flowDeduct20,flowTrend5Z:r.flowTrend5Z,
   flowDeductionConfirmed:r.flowDeductionConfirmed});
 }
 return {version:'W3-D.1.2/ONOFF',records,switches,lastInputDate:data.at(-1)?.date||null,validDays:records.filter(x=>x.valid).length};
}
module.exports={computeW3D112OnOff};
