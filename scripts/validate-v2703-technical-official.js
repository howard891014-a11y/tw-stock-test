#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {mergeOfficialDailyBars}=require('../lib/technical-official-daily');
const mk=(date,close,volume=2000000)=>({date,open:close-1,high:close+2,low:close-3,close,volume});
const official=(r,source='TPEx mainboard daily close')=>({trade_date:r.date,open_price:r.open,high_price:r.high,low_price:r.low,close_price:r.close,trade_volume:r.volume,source});
const yahoo=[mk('2026-10-26',1270),mk('2026-10-27',1285)];
function fakeSql(rows){const sql={n:0,query:async(q,args)=>{sql.n++;assert(q.includes('market_daily_history'));assert(q.includes('source IN'));assert.deepEqual(args,['6187','上櫃','2026-10-27']);return rows;}};return sql}
(async()=>{
 const sql=fakeSql([official(mk('2026-10-28',1345,1566331)),official(mk('2026-10-27',1285,2124304))]);
 const good=await mergeOfficialDailyBars(yahoo,{code:'6187',market:'上櫃',sql});
 assert.equal(sql.n,1);assert.equal(good.added,1);assert.equal(good.rows.at(-1).date,'2026-10-28');assert.equal(good.rows.at(-1).close,1345);assert.equal(good.rows.at(-1).volume,1566331);assert(good.source.includes('Neon'));
 const mismatch=await mergeOfficialDailyBars(yahoo,{code:'6187',market:'上櫃',sql:fakeSql([official(mk('2026-10-28',1345)),official(mk('2026-10-27',1400))])});
 assert.equal(mismatch.added,0);assert.equal(mismatch.reason,'price-basis-mismatch');
 const invalid=await mergeOfficialDailyBars(yahoo,{code:'6187',market:'上櫃',sql:fakeSql([official(mk('2026-10-28',1345,0)),official(mk('2026-10-27',1285))])});
 assert.equal(invalid.added,0,'no phantom bars');
 const wrongSource=await mergeOfficialDailyBars(yahoo,{code:'6187',market:'上櫃',sql:fakeSql([official(mk('2026-10-28',1345),'Yahoo intraday'),official(mk('2026-10-27',1285))])});
 assert.equal(wrongSource.added,0,'only official complete daily candles');
 const current=await mergeOfficialDailyBars([...yahoo,mk('2026-10-28',1345)],{code:'6187',market:'上櫃',sql:{query:async()=>[official(mk('2026-10-28',1345))]}});
 assert.equal(current.added,0,'no duplicate append');
 const fail=await mergeOfficialDailyBars(yahoo,{code:'6187',market:'上櫃',sql:{query:async()=>{throw Error('Neon offline')}}});
 assert.equal(fail.added,0);assert.equal(fail.rows.at(-1).date,'2026-10-27');
 const noDb=await mergeOfficialDailyBars(yahoo,{code:'6187',market:'上櫃'});assert.equal(noDb.added,0);
 const fs=require('node:fs');const api=fs.readFileSync('api/technical.js','utf8'),app=fs.readFileSync('app.js','utf8');
 assert(api.includes('withLatestOfficialClose(yahooRows,codeOf(q),market)'),'technical route must use official bridge');
 assert(api.includes('withLatestOfficialClose(yahooStockRows,code,market)'),'history route must use official bridge');
 assert(app.includes('technical-v2703:'));assert(app.includes('history5y-v2703:'));
 assert.equal((app.match(/v:"2703"/g)||[]).length,2);
 console.log('PASS v2.7.0.3: official 10/28 tail + 10/27 Yahoo; mismatch, unverified/no volume, duplicate and outage safeguards; both technical paths and cache invalidation.');
})().catch(e=>{console.error(e);process.exitCode=1});
