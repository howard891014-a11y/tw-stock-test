'use strict';
// Official CBC interbank close, TWD per USD; not an intraday quote.
const URL='https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day';
let cache=null,expires=0;
function rate(v){const n=Number(String(v??'').replace(/,/g,'').trim());return Number.isFinite(n)&&n>15&&n<80?n:null}
function date(v){
 const text=String(v||'').trim();
 let m=text.match(/^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
 if(!m&&/^\d{8}$/.test(text))m=[text,text.slice(0,4),text.slice(4,6),text.slice(6,8)];
 if(!m&&/^\d{7}$/.test(text))m=[text,text.slice(0,3),text.slice(3,5),text.slice(5,7)];
 if(!m)return '';
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
 if(mo<1||mo>12||d<1||d>31)return '';
 return `${y<1911?y+1911:y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function flatten(o,depth=0){
 if(depth>4||!o)return [];
 if(Array.isArray(o))return o.flatMap(x=>flatten(x,depth+1));
 if(typeof o==='object'){
  const keys=Object.keys(o),d=o['日期']||o.date||o.Date||o['交易日期'];
  const r=o['NTD/USD']??o['新臺幣/美元']??o['新台幣/美元']??o.rate??o.Rate;
  if(d&&r!==undefined)return [{date:date(d),rate:rate(r)}];
  return keys.flatMap(k=>flatten(o[k],depth+1));
 }
 return [];
}
function normalize(data){
 const byDay=new Map();for(const r of flatten(data))if(/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&r.rate!==null)byDay.set(r.date,r.rate);
 const rows=[...byDay].sort((a,b)=>a[0].localeCompare(b[0]));
 if(!rows.length)throw Error('CBC official FX payload has no recognized daily USD/TWD rows');
 const current=rows.at(-1),prev=rows.at(-2),prev5=rows.at(-6),prev20=rows.at(-21);
 const pct=x=>x?Number(((current[1]/x[1]-1)*100).toFixed(2)):null;
 return {date:current[0],rate:current[1],previous:prev?.[1]??null,change:prev?Number((current[1]-prev[1]).toFixed(4)):null,
  change5Pct:pct(prev5),change20Pct:pct(prev20),source:'中央銀行銀行間市場美元／新臺幣收盤匯率',unit:'TWD per USD'};
}
async function getFx(){
 if(cache&&Date.now()<expires)return cache;
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),9500);
 try{
  const response=await fetch(URL,{headers:{Accept:'application/json'},signal:ctrl.signal});
  if(!response.ok)throw Error(`CBC HTTP ${response.status}`);
  const next=normalize(await response.json());cache=next;expires=Date.now()+2*3600000;
  return next;
 }catch(e){
  if(cache)return {...cache,stale:true,error:String(e?.message||e)};
  return {rate:null,date:null,error:String(e?.message||e),source:'中央銀行銀行間市場美元／新臺幣收盤匯率'};
 }finally{clearTimeout(timeout)}
}
module.exports={getFx,normalize};
