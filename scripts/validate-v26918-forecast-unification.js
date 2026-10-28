#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const pull=name=>{const begin=src.indexOf('function '+name+'(');assert(begin>=0,`missing ${name}`);const end=src.indexOf('\nfunction ',begin+15);assert(end>begin,`unterminated ${name}`);return src.slice(begin,end)};
const format=n=>(n>0?'+':'')+n.toFixed(1)+'%';
const out={};const setText=(k,v)=>out[k]=v;
const ctx={positionNumber:x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:null,positionReturn:(a,b)=>(a/b-1)*100,signedPercent:format,setText,stockzoneW3Regime:()=>null,marketDynamicData:null,Math,Number};
vm.createContext(ctx);vm.runInContext(pull('sz918ExpectedSpaces')+'\n'+pull('renderCurrentExtremeRisk'),ctx);
const sp=ctx.sz918ExpectedSpaces(100,{levels:[{value:110},{value:140}]},{levels:[{value:95},{value:82}]});
assert.equal(sp.upRange,'+10.0% ～ +40.0%');assert.equal(sp.downRange,'-18.0% ～ -5.0%');
assert.equal(ctx.sz918ExpectedSpaces(100,{levels:[{value:110}]},{levels:[]}).upRange,'+10.0%');
assert.equal(ctx.sz918ExpectedSpaces(100,{levels:[]},{levels:[]}).downRange,'--%');
const rk={valid:true,level:{key:'high',label:'高'},score:66,summary:'跌破 MA20'};
ctx.renderCurrentExtremeRisk(rk);assert.equal(out.expectedExtremeRisk,'高 66/100');assert.match(out.expectedExtremeRiskNote,/W3：當日W3待更新/);assert.match(out.expectedExtremeRiskNote,/非預估崩跌百分比/);
ctx.stockzoneW3Regime=()=> 'off';ctx.marketDynamicData={w3:{stale:false}};ctx.renderCurrentExtremeRisk(rk);assert.match(out.expectedExtremeRiskNote,/空頭環境/);
ctx.stockzoneW3Regime=()=> 'on';ctx.marketDynamicData={w3:{warning:true,stale:false}};ctx.renderCurrentExtremeRisk(rk);assert.match(out.expectedExtremeRiskNote,/風險升溫/);
ctx.renderCurrentExtremeRisk(null);assert.equal(out.expectedExtremeRisk,'資料不足');
const segment=src.slice(src.indexOf('function renderExpectedUpside('),src.indexOf('\n// v2.6.0.1',src.indexOf('function renderExpectedUpside(')));
assert(segment.includes('sz918ExpectedSpaces(price,plan,downside)'));
assert(segment.includes('historicalSimilarWinRate(play,price,firstUp,nearestDown)'),'v.20 must check actual target and current defense');
assert(!segment.includes('histUpPrices'));
assert(!segment.includes('wr.upNear'));
assert(!segment.includes('wr.downNear'));
assert(!segment.includes('extremeMarketRisk'));
assert(!src.includes('function extremeMarketRisk('));
assert(!src.includes('winRate?.extreme'));
assert(src.includes('renderCurrentExtremeRisk(risk);'),'v.20 current risk still rendered');
assert(src.includes('renderRecentPlayAdvice();'),'v.20 current recent logic still rendered');
assert(html.includes('歷史相似達標率'));
assert(html.includes('極端市場風險（風險分）'));
const histCtx={latestHistory5Y:{history:[]},latestFiveStageResult:null,positionNumber:ctx.positionNumber,seasonality5Y:()=>({valid:false}),playRowClose:r=>r.close,
 shortReturnN:()=>0,stageRet:()=>0,stageSmaAt:()=>100,histRetAt:()=>0,histMaAt:()=>100,histCloseAt:(r,i)=>r[i].close,
 historyDateKey:r=>r.date,historyRecencyWeight:()=>1,playRowHigh:r=>r.high,swingLow:r=>r.low,stagePct:(x,b)=>(x/b-1)*100,
 histWeightedPercentile:(x,q)=>x.length?x[0].value:null,stageClamp:(x,lo,hi)=>Math.min(hi,Math.max(lo,x)),Math,Number,Date,Map};
for(let i=0;i<300;i++){histCtx.latestHistory5Y.history.push({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),close:100,high:i>60?110:100,low:100})}
vm.createContext(histCtx);vm.runInContext(pull('historicalSimilarWinRate'),histCtx);
let w=histCtx.historicalSimilarWinRate({key:'short'},100,5,-5);assert(w.valid);assert.equal(w.rate,100);
w=histCtx.historicalSimilarWinRate({key:'short'},100,35,-5);assert(w.valid);assert.equal(w.up,35);assert.equal(w.rate,0);
w=histCtx.historicalSimilarWinRate({key:'short'},100,null,-5);assert(!w.valid);
w=histCtx.historicalSimilarWinRate({key:'short'},100,5,null);assert(!w.valid);
assert(!('extreme' in w));
console.log('PASS forecast v2.6.9.20: exact current target and defense, current resonance upside, structure downside, current risk+W3, no historical downside override.');
