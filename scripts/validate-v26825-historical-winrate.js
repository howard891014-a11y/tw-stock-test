#!/usr/bin/env node
'use strict';
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const src=fs.readFileSync(require('path').join(__dirname,'..','app.js'),'utf8');
const start=src.indexOf('function historicalSimilarWinRate(');
const end=src.indexOf('\nfunction ',start+50);
assert(start>=0&&end>start,'Original function should exist');
const fn=src.slice(start,end);
function fixture(kind,nowOverride){
  const history=[];
  const d0=new Date('2025-01-01T00:00:00Z');
  for(let i=0;i<300;i++){
    const d=new Date(d0.valueOf()+i*86400000);
    const date=d.toISOString().slice(0,10);
    const x={date,close:100,high:100,low:100};
    history.push(x);
  }
  const chosen=history[61];
  // With step=3 the first short-mode candidate is i=60. Use the entire path for
  // the same scenario so every sampled case follows the same outcome shape.
  for(let i=0;i<history.length;i++){
    const idx=(i-60)%3;
    if(i<=60)continue;
    if(kind==='up')history[i].high=110;
    if(kind==='down')history[i].low=90;
    if(kind==='double'){history[i].high=110;history[i].low=90;}
  }
  const context={
    latestHistory5Y:{history},latestFiveStageResult:null,
    positionNumber:x=>x,seasonality5Y:()=>({valid:false}),extremeMarketRisk:()=>({valid:false}),
    playRowClose:r=>r.close,shortReturnN:()=>0,stageRet:()=>0,stageSmaAt:()=>100,
    histRetAt:()=>0,histMaAt:()=>100,histCloseAt:(r,i)=>r[i].close,
    historyDateKey:r=>r.date,historyRecencyWeight:()=>1,
    stageClamp:(x,lo,hi)=>Math.min(hi,Math.max(lo,x)),
    playRowHigh:r=>r.high,swingLow:r=>r.low,stagePct:(x,b)=>(x/b-1)*100,
    histWeightedPercentile:()=>0,
    Date:nowOverride?class extends Date { constructor(...a){super(...(a.length?a:['2045-03-15T00:00:00Z']))} }:Date,
    Math,Number,Map
  };
  vm.createContext(context);vm.runInContext(fn,context);
  return context.historicalSimilarWinRate({key:'short'},100,5,-5);
}
const up=fixture('up'); assert(up.valid);assert.strictEqual(up.ambiguous,0);assert.strictEqual(up.notReached,0);assert.strictEqual(up.rate,100);
const down=fixture('down'); assert(down.valid);assert.strictEqual(down.rate,0);assert(down.losses>0);
const both=fixture('double');assert(both.valid);assert.strictEqual(both.rate,0);assert.strictEqual(both.ambiguous,both.sample);assert.strictEqual(both.rateUpper,100);
const flat=fixture('flat');assert(flat.valid);assert.strictEqual(flat.notReached,flat.sample);assert.strictEqual(flat.ambiguous,0);assert.strictEqual(flat.rate,0);
// The matching quarter must come from the latest observation, not device clock.
const a=fixture('up');const b=fixture('up',true);
assert.strictEqual(a.sample,b.sample);assert.strictEqual(a.rate,b.rate);
console.log('PASS: wins, losses, ambiguous intraday order, no-touch and date snapshot tests.');
