'use strict';
const assert=require('node:assert/strict');
const moduleToTest=require('../lib/resonance-main-pullback');
const lab=require('../lib/resonance-lab-v1');
const bars=Array.from({length:800},(_,i)=>({
 date:new Date(Date.UTC(2022,0,1+i)).toISOString().slice(0,10),
 open:100,high:110,low:91,close:100,volume:15000
}));
const common={price:100,deepReference:65.6,bars,lab,zones:{valid:true,levels:{
 S1:{lower:94,center:95,upper:97,confidence:'observed'},
 S2:{lower:91,center:92,upper:94,confidence:'observed'}
}}};
const selected=moduleToTest.select(common);
assert(selected.valid);
assert.equal(selected.label,'S1');
assert.equal(selected.price,95);
assert(selected.sample>=6);
assert(selected.hit40>=2);
assert.equal(moduleToTest.displayRange({...common,mainPullback:selected}),'-5% ～ -34.4%');
const deepHit=lab.reachabilityProfile(bars,100,65.6);
assert.equal(deepHit.horizons.find(x=>x.days===40).hitPct,0,'deep reference can have 0% touch rate and must be preserved');
assert.equal(moduleToTest.select({...common,zones:{valid:true,levels:{S1:{center:65},S2:{center:64}}}}).valid,false);
assert.equal(moduleToTest.displayRange({...common,mainPullback:null}),'--%');
assert.equal(moduleToTest.select({...common,bars:bars.slice(0,180)}).valid,false);
console.log('PASS .20-base primary pullback, unchanged deep reference, same historical reach, no fabricated targets');

