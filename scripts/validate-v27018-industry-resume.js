'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');const oldLoad=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return{neon:()=>{throw Error('Live Neon forbidden in test')}};return oldLoad.call(this,id,parent,isMain);};
const m=require('../lib/company-action-monitor');Module._load=oldLoad;
const {OFFICIAL_SOURCE_NAMES}=require('../lib/research-corporate-actions');
const statuses=new Map(),pending=new Map();
const sample={trade_date:'2026-09-08',stock_code:'2330',market:'上市',kind:'split',source:'TWSE TWTB8U',old_close:100,reference_close:10,note:'分割'};
const queries=[];
const sql={query:async(text,args=[])=>{
 queries.push({text,args});
 if(text.startsWith('CREATE TABLE IF NOT EXISTS'))return[];
 if(text.includes('SELECT month,source,finalized,rows,actions FROM market_company_action_scan_source'))return [...statuses.values()].filter(x=>x.month>=args[0]&&x.month<=args[1]);
 if(text.includes('INSERT INTO market_company_action_scan_source')){const [month,source,finalized,rows,json]=args;statuses.set(`${month}/${source}`,{month,source,finalized,rows,actions:JSON.parse(json)});return[];}
 if(text.includes('FROM market_company_profile'))return[{stock_code:'2330',market:'上市',stock_name:'台積電',industry:'半導體'}];
 if(text.includes('INSERT INTO market_company_action_candidate')){
  const entries=JSON.parse(args[0]);let added=[];
  for(const e of entries)if(!pending.has(e.id)){pending.set(e.id,e);added.push({candidate_id:e.id});}
  return added;
 }
 throw Error('Unexpected query: '+text.slice(0,120));
}};
const attempted=[];
const fetchMonth=async(month,{onlySources}={})=>{
 attempted.push({month,sources:[...onlySources]});
 const failed=month==='2026-09'&&onlySources.includes('TPEx revivt')&&!attempted.some((r,i)=>i<attempted.length-1&&r.month===month);
 return {ok:!failed,errors:failed?['TPEx revivt: non-JSON HTML response']:[],sourceReports:onlySources.filter(s=>!(failed&&s==='TPEx revivt')).map(s=>({name:s,rows:s==='TWSE TWTB8U'&&month==='2026-09'?1:0,actions:s==='TWSE TWTB8U'&&month==='2026-09'?[sample]:[]}))};
};
(async()=>{
 let r=await m.scanRecent({sql,fetchMonth,date:'2026-10-29'});
 assert.equal(r.complete,false);assert.deepEqual(r.scannedMonths,['2026-09','2026-10']);
 assert.deepEqual(r.pendingMonths.map(x=>x.month),['2026-09']);
 assert.equal(r.pendingSourceCount,1);assert.equal(pending.size,1);assert.equal(r.inserted,1);
 assert.equal(statuses.get('2026-09/TWSE TWTB8U').finalized,true);
 assert.equal(statuses.get('2026-10/TWSE TWTB8U').finalized,false);
 r=await m.scanRecent({sql,fetchMonth,date:'2026-10-30'});
 assert.equal(r.complete,true);assert.equal(r.inserted,0,'existing candidate remains unchanged');
 const septRetry=attempted.filter(x=>x.month==='2026-09');
 assert.deepEqual(septRetry[1].sources,['TPEx revivt'],'retry only failed source');
 const octRetry=attempted.filter(x=>x.month==='2026-10');
 assert.equal(octRetry[1].sources.length,5,'current month rechecked');
 r=await m.scanRecent({sql,fetchMonth,date:'2026-11-02'});
 assert.equal(r.complete,true);assert(r.scannedMonths.includes('2026-10'));assert(r.scannedMonths.includes('2026-11'));
 assert(!r.scannedMonths.includes('2026-09'),'final historical month not re-downloaded');
 const octFinalize=attempted.filter(x=>x.month==='2026-10')[2];
 assert.equal(octFinalize.sources.length,5,'previous month provisional results finalized after close');
 assert.equal(statuses.get('2026-10/TWSE TWTB8U').finalized,true);
 const novPending=await m.scanRecent({sql,fetchMonth,date:'2026-12-01'});
 assert(novPending.scannedMonths.includes('2026-11'),'November provisional data finalized in December');
 const dates=[];
 const {fetchOfficialMonth}=require('../lib/research-corporate-actions');
 const official=async url=>{dates.push(url);return {ok:true,json:async()=>url.includes('tpex.org.tw')?{stat:'ok',date:'20261001~20261029',tables:[{fields:url.includes('/revivt')?['恢復買賣日期','股票代號','最後交易日之收盤價格','減資恢復買賣開始日參考價格']:['除權息日期','代號','名稱','除權息前收盤價','除權息參考價'],data:[]}]}:{stat:'OK',fields:['資料日期','股票代號','名稱','停止買賣前收盤價','恢復買賣參考價'],data:[]}}};
 const check=await fetchOfficialMonth('2026-10',{fetcher:official,eventEnd:'2026-10-29'});
 assert(check.ok);
 assert(dates.filter(u=>u.includes('twse.com.tw')).every(u=>u.includes('20261029')||u.includes('TWT49U')),'TWSE current month must stop at scan date');
 assert(dates.filter(u=>u.includes('tpex.org.tw')).every(u=>u.includes('2026%2F10%2F29')),'TPEx current month must stop at scan date');
 const html=await fetchOfficialMonth('2026-09',{onlySources:['TPEx revivt'],fetcher:async()=>({ok:true,json:async()=>{throw new SyntaxError('Unexpected token \'<\'')}}),eventEnd:'2026-10-29'});
 assert(!html.ok&&html.errors.some(e=>e.includes('Unexpected token')),'HTML must never certify a month');
 assert.equal(pending.size,1,'no duplicate candidate insertion');
 assert(!queries.some(x=>/UPDATE\s+market_business_xy2|DELETE\s+FROM\s+market_business_xy2|INSERT\s+INTO\s+market_company_action_release/i.test(x.text)),'approved taxonomy must remain untouched');
 console.log('PASS v2.7.0.18 source checkpoint, 9/10 month gap retry, finalized prior month, provisional current month, idempotent candidates, no approved data writes');
})().catch(e=>{console.error(e);process.exitCode=1});
