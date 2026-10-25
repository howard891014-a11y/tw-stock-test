#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

(async()=>{
  const {validTradingBars}=await import('../lib/valid-trading-bars.js');
  const valid={date:'2026-10-22',open:49.05,high:49.90,low:49.0,close:49.75,volume:29233032};
  const holiday={date:'2026-10-23',open:49.75,high:49.75,low:49.75,close:49.75,volume:0};
  assert.deepEqual(validTradingBars([valid,holiday]).map(x=>x.date),['2026-10-22'],'phantom session with 0 volume must be removed');
  assert.equal(validTradingBars([valid,{...holiday,volume:null}]).length,1,'null volume is not a trading session');
  assert.equal(validTradingBars([valid,{...holiday,volume:undefined}]).length,1,'missing volume is not a trading session');
  assert.equal(validTradingBars([valid,{...holiday,volume:NaN}]).length,1,'non-finite volume is not a trading session');
  assert.equal(validTradingBars([valid,{...holiday,volume:-10}]).length,1,'negative volume is not a trading session');
  assert.equal(validTradingBars([valid,{...holiday,volume:123,high:49}]).length,1,'invalid OHLC cannot be used');
  assert.equal(validTradingBars([valid,{...valid,volume:0}]).length,1,'invalid duplicate cannot replace valid candle');
  assert.deepEqual(validTradingBars([holiday,valid,{...valid,date:'2026-10-21',volume:25480642}]).map(x=>x.date),['2026-10-21','2026-10-22'],'preserve ascending date order');
  assert.equal(validTradingBars([valid,{...holiday,volume:null}],{requireVolume:false}).length,2,'index data need not report trade volume');

  const days=[];
  let dt=new Date('2026-10-22T01:00:00Z');
  while(days.length<100){if(dt.getUTCDay()!==0&&dt.getUTCDay()!==6)days.push(new Date(dt));dt=new Date(dt.valueOf()-86400000)}
  days.reverse();
  const ts=days.map(x=>Math.trunc(x.valueOf()/1000));
  const open=days.map((_,i)=>40+i*.09),close=days.map((_,i)=>40+i*.09+.1),high=days.map((_,i)=>40+i*.09+.5),low=days.map((_,i)=>40+i*.09-.3),volume=days.map((_,i)=>20000000+(i%7)*1000000);
  // Use the actual Neon 2884 10/22 volume as an integration anchor.
  open[open.length-1]=49.05;close[close.length-1]=49.75;high[high.length-1]=49.90;low[low.length-1]=49;volume[volume.length-1]=29233032;
  const ghostTs=Math.floor(new Date('2026-10-23T01:00:00Z').valueOf()/1000);
  const marketTs=[...ts,ghostTs];
  const stockQuote={open:[...open,49.75],high:[...high,49.75],low:[...low,49.75],close:[...close,49.75],volume:[...volume,0]};
  const indexQuote={...stockQuote,volume:stockQuote.volume.map(()=>null)};
  const makeResponse=(isIndex)=>({chart:{result:[{
    timestamp:marketTs,meta:{gmtoffset:28800},indicators:{quote:[isIndex?indexQuote:stockQuote],adjclose:[{adjclose:[...close,49.75]}]}
  }]}});
  const fetchOld=globalThis.fetch;
  const fetchHits=[];
  globalThis.fetch=async url=>{fetchHits.push(String(url));return{ok:true, json:async()=>makeResponse(String(url).includes('%5ETWII')||String(url).includes('^TWII'))}};
  const {default:handler}=await import('../api/technical.js');
  async function request(query){
    const response={statusCode:200,headers:{},setHeader(n,v){this.headers[n]=v},status(n){this.statusCode=n;return this},json(data){this.body=data;return this}};
    await handler({query},response);return response;
  }
  try{
    const res=await request({q:'2884',market:'上市'});
    assert.equal(res.statusCode,200,JSON.stringify(res.body));
    assert.equal(res.body.updatedAt,'2026-10-22');
    assert.equal(res.body.latest.date,'2026-10-22');
    assert.equal(res.body.latest.volume,29233032);
    assert.equal(res.body.volume.current,29233032);
    assert.equal(res.body.count,100);
    assert.equal(res.body.history.length,100);
    assert(res.body.history.every(x=>x.volume>0));
    const expectedVol5=Math.round(volume.slice(-5).reduce((a,b)=>a+b,0)/5);
    const expectedVol20=Math.round(volume.slice(-20).reduce((a,b)=>a+b,0)/20);
    const expectedRatio=Number((29233032/(volume.slice(-20).reduce((a,b)=>a+b,0)/20)).toFixed(2));
    assert.equal(res.body.volume.avg5,expectedVol5,'5D volume uses traded days');
    assert.equal(res.body.volume.avg20,expectedVol20,'20D volume uses traded days');
    assert.equal(res.body.volume.ratio20,expectedRatio,'volume ratio is not 0');
    // Corrected indicators must use the last true close; phantom candle cannot shift MAs, RSI, MACD, Bollinger.
    const expectedMA5=Number((close.slice(-5).reduce((a,b)=>a+b,0)/5).toFixed(2));
    assert.equal(res.body.ma.ma5,expectedMA5,'MA5 must exclude phantom day');
    assert.equal(res.body.bollinger.middle,res.body.ma.ma20,'Bollinger must use cleaned closes');
    assert(Number.isFinite(res.body.momentum.macd),'MACD remains calculable');

    const historical=await request({mode:'history',q:'2884',market:'上市'});
    assert.equal(historical.statusCode,200,JSON.stringify(historical.body));
    assert.equal(historical.body.history.at(-1).date,'2026-10-22','5-year equity history must exclude zero-volume holiday');
    assert.equal(historical.body.history.length,100);
    assert(historical.body.history.every(x=>x.volume>0));
    assert.equal(historical.body.benchmark.history.at(-1).date,'2026-10-22','benchmark cannot add fake trading day');
    assert.deepEqual(historical.body.benchmark.history.map(x=>x.date),historical.body.history.map(x=>x.date),'index benchmark should align to traded equity days');

    assert(fetchHits.length>0);
    const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
    assert(app.includes('technical-v26826:'),'old technical caches must be invalidated');
    assert(app.includes('history5y-v26826:'),'old history caches must be invalidated');
    assert.equal((app.match(/v:"26826"/g)||[]).length,2,'both technical APIs must bypass stale CDN entries');
    assert(!app.slice(app.indexOf('async function history5Y('),app.indexOf('const FUNDAMENTALS_CACHE_KEY=')).includes('void stockzoneIdbPut("marketCache",key,legacy)'), 'legacy historical cache must not reintroduce synthetic days');
  }finally{globalThis.fetch=fetchOld}
  console.log('PASS v2.6.8.26: rejects 0/missing-volume holidays, preserves 2884 volume, 5/20D averages, MA/MACD/Bollinger, five-year history and cache isolation.');
})().catch(e=>{console.error(e);process.exitCode=1});
