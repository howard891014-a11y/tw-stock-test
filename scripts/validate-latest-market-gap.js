const fs=require('fs');
const assert=require('assert');
const syncService=fs.readFileSync('lib/sync-service.js','utf8');
const status=fs.readFileSync('api/sync-status.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const vm=require('vm');
function extractFunction(src,name){const start=src.indexOf(`function ${name}`);if(start<0)throw new Error(`${name} missing`);const sigEnd=src.indexOf(') {',start);if(sigEnd<0)throw new Error(`${name} signature parse failed`);let brace=sigEnd+2,depth=0,end=-1;for(let i=brace;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'){depth--;if(depth===0){end=i+1;break}}}if(end<0)throw new Error(`${name} parse failed`);return src.slice(start,end);}
const latestMarketGapPlan=vm.runInNewContext(`(${extractFunction(syncService,'latestMarketGapPlan')})`);

assert.strictEqual(JSON.stringify(latestMarketGapPlan({'上市':'2026-10-02','上櫃':'2026-10-02'})),JSON.stringify({needed:false,reason:'latest-market-dates-aligned',targetDate:'2026-10-02',market:null,leadingMarket:null}));
assert.strictEqual(JSON.stringify(latestMarketGapPlan({'上市':'2026-10-02','上櫃':'2026-10-01'})),JSON.stringify({needed:true,reason:'latest-market-date-gap',targetDate:'2026-10-02',market:'上櫃',leadingMarket:'上市'}));
assert.strictEqual(JSON.stringify(latestMarketGapPlan({'上市':'2026-10-01','上櫃':'2026-10-02'})),JSON.stringify({needed:true,reason:'latest-market-date-gap',targetDate:'2026-10-02',market:'上市',leadingMarket:'上櫃'}));

const repair=syncService.slice(syncService.indexOf('async function runLatestMarketGapRepair'),syncService.indexOf('async function runMarketHistoryBackfill'));
assert(repair.includes("if (!plan.needed)"),'aligned path must cheap-no-op before upstream work');
assert(repair.indexOf('if (!plan.needed)') < repair.indexOf('loadCompanyUniverse(sql)'),'cheap no-op must not load company master');
assert(repair.includes('fetchTwseHistoricalRows(plan.targetDate)')&&repair.includes('fetchTpexHistoricalRows(plan.targetDate)'),'repair must fetch only the missing market/date historical endpoint');
assert(repair.includes('noFullBackfill:true'),'repair must explicitly remain targeted');
assert(repair.includes('refreshMarketActivityFactors()'),'repaired day must refresh local activity factors');
assert(repair.includes('refreshPriceSnapshotFromMarketHistory()'),'repaired day must refresh snapshot');

const manual=status.slice(status.indexOf("if(action==='fundflow-warm-manual')"),status.indexOf("if(action==='fundflow-clean-rebuild-manual')"));
assert(manual.includes('runLatestMarketGapRepair({sql:getSql()})'),'manual XY refresh must repair latest market gap first');
assert(manual.indexOf('runLatestMarketGapRepair') < manual.indexOf('warmCurrentEngineFromStoredDb'),'manual gap repair must precede XY warm');

const auto=status.slice(status.indexOf("if(action==='tpex'){\n          try{result.body.latestMarketGapRepair"),status.indexOf('try{result.body.flowDataHealth'));
assert(auto.includes('runLatestMarketGapRepair({sql:getSql()})'),'22:00 cron must repair latest market gap');
assert(auto.indexOf('runLatestMarketGapRepair') < auto.indexOf('warmCurrentEngineFromStoredDb'),'22:00 gap repair must precede XY warm');
assert(app.includes('若只缺一邊就補該日'),'manual UI must explain targeted latest-date repair');

assert.strictEqual((vercel.crons||[]).length,3,'must keep exactly the existing three cron slots');
assert.deepStrictEqual((vercel.crons||[]).map(x=>x.schedule),['0 7 * * 1-5','0 11 * * 1-5','0 14 * * 1-5']);
console.log('Latest market gap validation PASS — auto/manual targeted repair + cheap no-op + unchanged 3 cron slots');
