'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='./db'&&parent?.filename?.endsWith('/lib/official-institutional-archive.js')){
  return {getSql:()=>({query:()=>Promise.resolve([])})};
 }
 return originalLoad.call(this,request,parent,isMain);
};
const {collectRows,saveOfficialArchive,validated}=require('../lib/official-institutional-archive');
const {parseTwse,parseTpex,combine}=require('../lib/market-institutional-official');
const day='2026-10-27';
const tw=parseTwse({stat:'OK',date:'20261027',data:[
 ['自營商(自行買賣)','9007716092','8239495006','768221086'],
 ['自營商(避險)','35473740121','48640735317','-13166995196'],
 ['投信','38392407004','14787900746','23604506258'],
 ['外資及陸資(不含外資自營商)','514123007104','522161880243','-8038873139'],
 ['外資自營商','0','0','0'],
 ['合計','596996870321','593830011312','3166859009']
]},day);
const otc=parseTpex([{Date:'1151027',Investor:'外資及陸資合計',PurchaseAmount:'72533938852',SaleAmount:'70187491470',Net:'2346447382'},
{Date:'1151027',Investor:'投信',PurchaseAmount:'6171809852',SaleAmount:'3499542234',Net:'2672267618'},
{Date:'1151027',Investor:'自營商合計',PurchaseAmount:'4792600150',SaleAmount:'4631563840',Net:'161036310'},
{Date:'1151027',Investor:'三大法人合計*',PurchaseAmount:'83498348854',SaleAmount:'78318597544',Net:'5179751310'}],day);
assert(validated(tw,day,'上市'));assert(validated(otc,day,'上櫃'));
assert.equal(combine(day,tw,otc).foreign,-5692425757);
const both={date:day,officialInstitutional:combine(day,tw,otc)};
const all=collectRows([both],[{date:day,market:'上市',result:null,error:'simulated timeout'},
 {date:'2026-10-28',market:'上市',result:null,error:'OFFICIAL_NOT_READY'}]);
assert.equal(all.length,3);assert.equal(all.filter(x=>x.complete).length,2);
assert.equal(all.find(x=>x.date===day&&x.market==='上市').total,3166859009);
assert.equal(all.find(x=>x.date==='2026-10-28').complete,false);
let ins=null,cut=false;
(async()=>{
 let calls=[];
 const sql={query:async (query,params)=>{
  calls.push({query,params});
  if(query.includes('SELECT count(DISTINCT trade_date)'))return [{days:2,rows:3,verified_rows:2,paired_complete_days:1,bytes:24576}];
  return [];
 }};
 const o=await saveOfficialArchive({history:[both],attempts:[{date:'2026-10-28',market:'上市',result:null,error:'NOT_READY'}]},sql);
 assert(o.ok&&o.recorded===3);assert.equal(calls.length,5);
 assert(calls[0].query.includes('CREATE TABLE IF NOT EXISTS official_institutional_cash_daily'));
 assert(calls[1].query.includes('SELECT trade_date::text AS date,market,is_complete'));
 assert(calls[2].query.includes('ON CONFLICT(trade_date,market)'));
 assert(calls[3].query.includes('LIMIT 250'));
 assert.equal(o.paired_complete_days,1);
 console.log('PASS: TWSE+TPEx independently validated; latest + partial preserved; 250D DB writes isolated; five SQL calls');
})().catch(e=>{console.error(e);process.exitCode=1});
