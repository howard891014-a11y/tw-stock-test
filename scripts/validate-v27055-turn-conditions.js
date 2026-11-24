'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'lib/w3-d112-onoff.js'),'utf8');
const core=require('../lib/w3-d112-onoff').computeW3D112OnOff;
const wrapped=require('../lib/w3-d112').computeW3D112;
// Compare against the exact previous condition, without loading or modifying old production code.
const prior="r.strongThrustOn=!!(p&&finite(z)&&z>=2&&a>=80&&p.advance<=35&&a-b>=30);";
const current="r.strongThrustOn=!!(finite(z)&&z>=2&&finite(a)&&a>=80);";
assert(source.includes(current),'v2.7.0.55 strong rebound must have exactly two gates');
const context={module:{exports:{}},exports:{}};
vm.runInNewContext(source.replace(current,prior),context);
const oldCore=context.module.exports.computeW3D112OnOff;
function make({zHigh=true,advance=90,margin=true}={}){
 const first=Date.UTC(2026,5,1),data=[];
 for(let i=0;i<35;i++){
  const date=new Date(first+i*86400000).toISOString().slice(0,10);
  let taiex=100,a=55,b=55,flow=i%2?95:105;
  if(i===30){taiex=93;a=8;b=30;flow=70;}
  if(i===31){taiex=95;a=65;b=60;flow=110;}
  if(i===32){taiex=98;a=advance;b=75;flow=zHigh?500:110;}
  data.push({date,taiex,advance_ratio:a,breadth5:b,institutional_value_twd:flow,
    financing_value_twd:margin?1000:null});
 }
 return data;
}
const sample=make();
const newRun=core(sample),oldRun=oldCore(sample);
assert(newRun.records[30].regime==='RiskOff'&&oldRun.records[30].regime==='RiskOff','unchanged crash OFF guard');
assert(newRun.records[31].regime==='RiskOff'&&oldRun.records[31].regime==='RiskOff','first rebound remains OFF');
assert.equal(oldRun.records[32].regime,'RiskOff','old extra breadth guards prevent rebound');
assert.equal(newRun.records[32].regime,'RiskOn','new dual conditions allow follow-through rebound');
assert.equal(newRun.records[32].reason,'strong_thrust','no other route may create the ON');
const strongAt32=core(sample.slice(0,33)).lastTurnConditions;
assert.equal(strongAt32.triggered,'strong_thrust');
assert.equal(strongAt32.routes[0].matched,true);
assert.equal(strongAt32.routes[0].total,2);
assert.deepEqual(strongAt32.routes[0].conditions.map(x=>x.passed),[true,true]);
assert.equal(strongAt32.routes[1].matched,false,'comprehensive route must remain unchanged');
assert.equal(core(make({zHigh:false})).records[32].regime,'RiskOff','low Z does not turn ON');
assert.equal(core(make({advance:79})).records[32].regime,'RiskOff','breadth below 80 does not turn ON');
assert.equal(core(make({margin:false})).records[32].regime,'RiskOn','strong rebound retains pre-existing independence from margin readiness');
const full=wrapped(sample);
assert.equal(full.records[32].reason,'strong_thrust');
assert(full.lastTurnConditions&&Array.isArray(full.lastTurnConditions.routes));
assert.equal(full.lastTurnConditions.routes.length,3);
assert.equal(full.lastTurnConditions.date,full.lastInputDate);
assert.equal(full.strongThrustRevision,'2.7.0.55');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'lib/market-dynamic.js'),'utf8');
const ver=require('../package.json').version;
assert.equal(ver,'2.7.0.55');
for(const str of ['marketTurnDetails','marketTurnOverview','marketTurnRoutes','大盤轉折條件'])assert(html.includes(str),str);
assert(!html.includes('id="marketCoverage"'),'obsolete coverage widget must be removed');
assert(!app.includes('set("marketCoverage"'),'obsolete coverage renderer must be removed');
assert(app.includes('renderMarketTurnConditions();'));
assert(server.includes('turnConditions:w3Replay.lastTurnConditions'));
assert(html.includes(`app.js?v=${ver}`)&&html.includes(`content="${ver}"`));
console.log('PASS v2.7.0.55: strict 2-gate strong-thrust, former breadth exclusions removed, OFF and other ON intact, W3 turn-condition UI, previous incomplete-input behavior, version.');
