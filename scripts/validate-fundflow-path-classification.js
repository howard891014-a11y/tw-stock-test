const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('app.js','utf8');
const a=src.indexOf('const STOCKZONE_NINE_STATES='),b=src.indexOf('function fundflowPathAllowed(',a);
assert(a>=0&&b>a,'nine-state implementation missing');
const context={marketDynamicData:null,
 fundflowPriceDiagnostic:()=>({priceY:2,dy3Turn:-2}),
 fundflowProjectionScenarios:()=>[],
 fundflowPointQuadrant:(x,y)=>x>=0?(y<0?'potential':'mainline'):(y>=0?'price-led':'cold'),
 fundflowQuadrantShort:x=>x,
};
vm.createContext(context);vm.runInContext(src.slice(a,b)+'\nthis.classify=fundflowPathState;',context);
const state=context.classify;
assert.equal(state({tagId:'a',x:10,y:3,dx3:0,dy3:99}).key,'pullback','turn must override legacy dy3');
assert.equal(state({tagId:'a',x:10,y:-1,dx3:4}).key,'ready');
assert.equal(state({tagId:'a',x:-10,y:-8,dx3:-2}).key,'rebound');
assert.equal(state({tagId:'a',x:-10,y:-1,dx3:-2}).key,'sleep');
assert.equal(state({tagId:'a',x:10,y:15,dx3:-1}).key,'gamble');
assert.equal(state({tagId:'a',x:5,y:-1,dx3:-9}).key,'sneak');
assert.equal(state({tagId:'a',x:5,y:3,dx3:0,dy3Turn:null}).key,'pullback');
context.marketDynamicData={latest:{w3Regime:'risk-off'}};
assert.equal(state({tagId:'a',x:5,y:-2,dx3:-3}).key,'avoid');
context.fundflowPriceDiagnostic=()=>null;
assert.equal(state({tagId:'a',x:3,y:1,dx3:0}).label,'價格路徑資料不足');
console.log('Nine-state price/turn mapping PASS — branch semantics preserved, legacy Y5-delta not substituted');
