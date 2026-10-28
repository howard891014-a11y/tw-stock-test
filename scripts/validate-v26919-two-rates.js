#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const pkg=require(path.join(root,'package.json'));
const start=js.indexOf('function historicalSimilarWinRate('),end=js.indexOf('\nfunction ',start+40);
assert(start>=0&&end>start,'one historical method');
const body=js.slice(start,end);
assert.equal((js.match(/function historicalSimilarWinRate\(/g)||[]).length,1);
const historyFixture=kind=>{
 const rows=[];
 for(let i=0;i<400;i++){
  const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
  let close=100,high=100,low=100;
  if(i>60){
   if(kind==='target'){high=110;close=100;}
   if(kind==='profit'){if(i%3===2){close=102;high=103}}
   if(kind==='loss'){if(i%3===2){close=99;low=99}}
   if(kind==='stopThenProfit'){low=90;high=103;if(i%3===2)close=102;}
   if(kind==='ambiguous'){high=110;low=90;close=101;}
   if(kind==='targetThenDown'){high=110;close=99;low=99;}
  }
  rows.push({date:d,close,high,low});
 }
 const ctx={latestHistory5Y:{history:rows},latestFiveStageResult:null,positionNumber:x=>x,seasonality5Y:()=>({valid:false}),
   playRowClose:r=>r.close,shortReturnN:()=>0,stageRet:()=>0,stageSmaAt:()=>100,histRetAt:()=>0,histMaAt:()=>100,
   histCloseAt:(r,i)=>r[i].close,historyDateKey:r=>r.date,historyRecencyWeight:()=>1,
   playRowHigh:r=>r.high,swingLow:r=>r.low,stagePct:(x,y)=>(x/y-1)*100,
   histWeightedPercentile:()=>0,stageClamp:(x,a,b)=>Math.min(b,Math.max(a,x)),Date,Math,Number,Map};
 vm.createContext(ctx);vm.runInContext(body,ctx);
 return ctx.historicalSimilarWinRate({key:'short'},100,5,-5);
};
const t=historyFixture('target');assert(t.valid);assert.equal(t.rate,100);assert.equal(t.profitRate,100);assert.equal(t.profitWithoutTarget,0);
const p=historyFixture('profit');assert(p.valid);assert.equal(p.rate,0);assert.equal(p.profitRate,100);assert.equal(p.profitWithoutTarget,p.sample);
const l=historyFixture('loss');assert(l.valid);assert.equal(l.rate,0);assert.equal(l.profitRate,0);
const s=historyFixture('stopThenProfit');assert(s.valid);assert.equal(s.rate,0);assert.equal(s.profitRate,0);
const a=historyFixture('ambiguous');assert(a.valid);assert.equal(a.rate,0);assert.equal(a.profitRate,0);assert.equal(a.ambiguous,a.sample);
const q=historyFixture('targetThenDown');assert(q.valid);assert.equal(q.rate,100);assert.equal(q.profitRate,100);
assert([t,p,l,s,a,q].every(x=>x.rate<=x.profitRate),'target success must be subset of profitable success');
assert(html.includes('<small>歷史相似達標率</small>')&&html.includes('<small>歷史相似勝率</small>'));
assert(html.includes('id="expectedProfitRate"')&&html.includes('id="expectedProfitRateNote"'));
assert(js.includes('setText("expectedProfitRate",wr.valid?`${wr.profitRate}%`:"--")'));
assert(js.includes('setText("expectedProfitRate","--")'));
assert(js.includes('renderCurrentExtremeRisk(risk);')&&js.includes('renderRecentPlayAdvice();'));
assert(!js.includes('function extremeMarketRisk('));
assert(!js.includes('const historicSecondRate='));
assert.equal(pkg.version,'2.6.9.20');
assert(html.includes('v2.6.9.20'));
assert.deepEqual(t.up,p.up);
assert.deepEqual(t.down,p.down);
console.log('PASS v2.6.9.20 historical rates: shared sample engine, target-first and positive exit secondary rate, stop-first, intraday ambiguity and unchanged two-rate semantics.');
