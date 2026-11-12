'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const previous=Module._load;
Module._load=function(name,parent,isMain){
 if(name==='./db'&&parent?.filename?.endsWith('/lib/official-institutional-archive.js'))return {getSql:()=>({query:async()=>[]})};
 return previous.call(this,name,parent,isMain);
};
const {RETENTION_YEARS,loadVerifiedByDate,saveOfficialArchive}=require('../lib/official-institutional-archive');
Module._load=previous;
const mk=(date,market)=>({date,market,foreign:'100',trust:'200',dealer:'300',total:'600'});
(async()=>{
 assert.equal(RETENTION_YEARS,5);
 const rows=[];
 for(let i=0;i<260;i++){
  const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
  rows.unshift(mk(d,'上市'),mk(d,'上櫃'));
 }
 let queries=[];
 const db={query:async (sql,args)=>{
  queries.push({sql,args});
  const result=rows.filter(x=>!args[0]||x.date>=args[0])
   .filter(x=>!args[1]||(x.date<args[1]||(x.date===args[1]&&x.market<args[2])))
   .slice(0,500);
  return result;
 }};
 const m=await loadVerifiedByDate(db,'2025-01-01');
 assert.equal(m.size,260,'All 260 dates must load, beyond old LIMIT 500 rows');
 assert.equal(queries.length,2,'Keyset pagination should read a full page then remaining page');
 assert.match(queries[1].sql,/\(trade_date,market\)<\(\$2::date,\$3::text\)/);
 assert.equal(queries[1].args[1],rows[499].date);
 assert.equal(queries[1].args[2],rows[499].market);
 const cached=await loadVerifiedByDate(db,'2025-02-01');
 assert.equal(cached.size,260);
 assert.equal(queries.length,2,'Cache re-used only for ranges contained in first load');
 console.log('PASS: five calendar years + stable 500-row keyset pagination and range-aware cache');
})().catch(e=>{console.error(e);process.exitCode=1});
