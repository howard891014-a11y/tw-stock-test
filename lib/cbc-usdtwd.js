'use strict';
// CBC Open Government Data #7232, interbank USD/TWD closing rate (TWD per USD).
// Two independent *official* publication formats, same series. Never use an
// inferred market quote or a stale page's publication date as a trading date.
const JSON_URL='https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day';
const CSV_URL='https://www.cbc.gov.tw/public/data/OpenData/%E5%A4%96%E5%8C%AF%E5%B1%80/FTDOpenData015.csv';
const TAIFEX_URL='https://openapi.taifex.com.tw/v1/DailyForeignExchangeRates';
let cache=null,expires=0;
const number=v=>{
 const n=Number(String(v??'').replace(/,/g,'').trim());
 return Number.isFinite(n)&&n>15&&n<80?n:null;
};
function date(v){
 const src=String(v??'').trim().replace(/年|月/g,'/').replace(/日/g,'');
 let m=src.match(/^(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\D|$)/);
 if(!m && /^\d{7,8}$/.test(src))m=[src,src.slice(0,-4),src.slice(-4,-2),src.slice(-2)];
 if(!m)return '';
 const y=+m[1],mo=+m[2],d=+m[3],ad=y<1911?y+1911:y;
 if(ad<1990||ad>2100||mo<1||mo>12||d<1||d>31)return '';
 const out=`${ad}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 const parsed=new Date(`${out}T00:00:00Z`);
 return parsed.getUTCFullYear()===ad&&parsed.getUTCMonth()+1===mo&&parsed.getUTCDate()===d?out:'';
}
const normalKey=k=>String(k||'').replace(/[\s　_]/g,'').toUpperCase();
function rowValue(obj,names){
 const keys=new Set(names.map(normalKey));
 for(const [k,v] of Object.entries(obj))if(keys.has(normalKey(k)))return v;
 return null;
}
function flatten(value,depth=0){
 if(depth>6||value==null)return [];
 if(Array.isArray(value))return value.flatMap(x=>flatten(x,depth+1));
 if(typeof value!=='object')return [];
 const when=rowValue(value,['日期','Date','交易日期','期間','交易日','日期(年月日)']);
 const quote=rowValue(value,['NTD/USD','新臺幣/美元','新台幣/美元','匯率','收盤匯率','美元_新台幣(匯率)','美元／新臺幣','美元／新台幣','美元/新臺幣','美元/新台幣','USD/TWD','USDNTD','USD_TWD']);
 if(when!=null&&quote!=null)return [{date:date(when),rate:number(quote)}];
 return Object.values(value).flatMap(x=>flatten(x,depth+1));
}
function normalize(data){
 const byDate=new Map();
 for(const r of flatten(data))if(r.date&&r.rate!==null)byDate.set(r.date,r.rate);
 const rows=[...byDate].sort(([a],[b])=>a.localeCompare(b));
 if(!rows.length)throw Error('CBC 7232 payload contains no valid dated USD/TWD rates');
 const [lastDate,lastRate]=rows.at(-1),prev=rows.at(-2),p5=rows.at(-6),p20=rows.at(-21);
 const pct=r=>r?+((lastRate/r[1]-1)*100).toFixed(2):null;
 return {date:lastDate,rate:lastRate,previous:prev?.[1]??null,
  change:prev?+(lastRate-prev[1]).toFixed(4):null,change5Pct:pct(p5),change20Pct:pct(p20),
  source:'中央銀行：銀行間美元／新臺幣收盤匯率',unit:'TWD per USD'};
}
function parseCsv(input){
 const text=String(input||'').replace(/^\uFEFF/,'');
 const table=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch;continue;}
  if(ch==='"')quoted=true;
  else if(ch===','){row.push(field);field='';}
  else if(ch==='\n'){row.push(field);table.push(row);row=[];field='';}
  else if(ch!=='\r')field+=ch;
 }
 if(field||row.length){row.push(field);table.push(row)}
 const headIndex=table.findIndex(r=>r.some(v=>normalKey(v)==='日期'||normalKey(v)==='DATE')&&r.some(v=>['NTD/USD','美元新台幣(匯率)','美元新臺幣(匯率)','USD/TWD','USDNTD'].includes(normalKey(v))));
 if(headIndex<0)throw Error('CBC 7232 CSV header not recognized');
 const head=table[headIndex].map(x=>x.trim());
 return table.slice(headIndex+1).map(cols=>Object.fromEntries(head.map((key,i)=>[key,cols[i]??''])));
}
async function request(url,timeoutMs){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const res=await fetch(url,{headers:{Accept:'application/json,text/csv,text/plain,*/*'},signal:controller.signal});
  if(!res.ok)throw Error(`HTTP ${res.status}`);
  return res;
 }finally{clearTimeout(timer)}
}
async function getFx(){
 if(cache&&Date.now()<expires)return cache;
 let error=null;
 try{
  const res=await request(JSON_URL,11000);
  const result=normalize(await res.json());
  cache={...result,sourceUrl:JSON_URL};expires=Date.now()+45*60*1000;
  return cache;
 }catch(e){error=`央行 JSON：${e?.message||e}`;}
 try{
  const res=await request(CSV_URL,11000);
  const raw=new Uint8Array(await res.arrayBuffer());
  // The currently published government file is UTF-8; Big5 is only tried if
  // UTF-8 headers fail validation. Both are the same CBC released CSV bytes.
  let result;
  try{result=normalize(parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(raw)));}
  catch(e){result=normalize(parseCsv(new TextDecoder('big5').decode(raw)));}
  cache={...result,sourceUrl:CSV_URL};expires=Date.now()+45*60*1000;
  return cache;
 }catch(e){error+=`；央行 CSV：${e?.message||e}`;}
 // TAIFEX's government-open-data FX reference rate is a *different* official
 // fixing, not a CBC interbank closing rate. Label it distinctly in the UI.
 try{
  const res=await request(TAIFEX_URL,11000);
  const payload=typeof res.json==='function'?await res.json():JSON.parse(await res.text());
  const result=normalize(payload);
  cache={...result,source:'臺灣期貨交易所：美元／新台幣每日參考匯率',
   sourceUrl:TAIFEX_URL,referenceRate:true};
  expires=Date.now()+45*60*1000;
  return cache;
 }catch(e){error+=`；期交所 API：${e?.message||e}`;}
 if(cache)return {...cache,stale:true,error};
 return {rate:null,date:null,error,source:'中央銀行：銀行間美元／新臺幣收盤匯率'};
}
module.exports={getFx,normalize,parseCsv,date,JSON_URL,CSV_URL,TAIFEX_URL};
