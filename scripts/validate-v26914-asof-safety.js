'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const research=read('lib/research-500d-backfill.js');
const xy=read('lib/fundflow-xy.js');
const status=read('api/sync-status.js');
const client=read('app.js');
const html=read('index.html');
const db=read('lib/db.js');
const pkg=require('../package.json');
const batch=read('lib/holding-trade-plans.js');
// Banned physical dual-store architecture.
for(const s of [research,xy,status,db,client,html]) {
  assert(!s.includes('research-500d-parallel'),'dual research storage must be absent');
  assert(!s.includes('research_current_daily'),'new research table must be absent');
}
assert(!fs.existsSync(path.join(root,'lib/research-500d-parallel.js')));
assert(!html.includes('research500LegacyRow'),'only one 500D progress row');
assert.match(html,/研究 500D（逐日保存）/);
assert.equal(pkg.version,'2.6.9.19');
assert.match(batch,/StockZoneHoldingPlans/); // .12 batch preserved, more exhaustive in batch2
// Append-only research records; existing dates are NEVER upserted.
const ar=xy.slice(xy.indexOf('async function persistCompactResearchRows('),xy.indexOf('function memberPayloadFromCompanyMap('));
assert.match(ar,/ON CONFLICT \(trade_date,tag_id\) DO NOTHING/);
assert(!/ON CONFLICT[^]*DO UPDATE/i.test(ar));
// Fingerprint is metadata only in 60D readiness; no last-build strict equality or rebuild.
const tax=xy.slice(xy.indexOf('async function readTopicTaxonomyBuildState('),xy.indexOf('async function rebuildTopicTaxonomyHistory('));
assert.match(tax,/COUNT\(DISTINCT t\.tag_id\)/);
assert(!tax.includes('t.build_version=$3'));
const rebuild=xy.slice(xy.indexOf('async function rebuildTopicTaxonomyHistory('),xy.indexOf('async function refreshBusinessFlowDaily('));
assert.match(rebuild,/historical-topic-restatement-disabled/);
const broad=xy.slice(xy.indexOf('async function backfillCompactFeatureHistory('),xy.indexOf('async function needsRefresh('));
assert.match(broad,/historical-compact-rebuild-disabled/);
const warm=xy.slice(xy.indexOf('async function warmCurrentEngineFromStoredDb('),xy.indexOf('async function getFundflowSnapshot('));
assert(!warm.includes('await rebuildTopicTaxonomyHistory('));
assert.match(warm,/await refreshBusinessFlowDaily\(/);
// Normal membership registration not blocked. Manual historical rebuild disabled.
assert.match(status,/if\(stage==='membership'\)/);
assert.match(status,/if\(stage==='topics'\)return res.status\(409\)/);
assert.match(status,/if\(action==='fundflow-clean-rebuild-manual'\)return res.status\(409\)/);
assert(!status.includes('researchParallel'));
assert.match(research,/historical-research-backfill-disabled/);
assert.match(research,/tags>=GREATEST\(1,\(SELECT COUNT\(\*\) FROM member_tags\)-13\)/);
// A normal listing that changes the historical tag count doesn't stop overall progress.
let gotQuery='';
// Mock only the external Neon client, exercising real module source and SQL shape.
const Module=require('node:module'),origLoad=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return {neon:()=>{throw Error('test client must not connect')}};return origLoad.call(this,id,parent,isMain)};
const mockSql={query:async(q,args)=>{
  gotQuery=q;
  assert(args[0].startsWith('feature-'));
  assert.equal(args[1].length,203);
  return [{tag_count:203,current_days:500,x_usable_days:500,all_version_days:500,
     oldest:'2024-10-01',newest:'2026-10-27',member_rows:3445,
     incomplete_dates:0,build_versions:2}];
}};
(async()=>{
  const prog=await require('../lib/research-500d-backfill').readResearch500DProgress(mockSql);
  assert.deepEqual([prog.currentDays,prog.xUsableDays,prog.coverageComplete,prog.complete,prog.buildVersions], [500,500,true,true,2]);
  assert.equal(prog.versionWarning,null);
  assert.equal(prog.uniformVersionReady,null);
  assert.match(prog.basis,/203-tag-daily-coverage/);
  assert.match(gotQuery,/tags>=GREATEST/);
  // Pure no-write guard functions: errors disabled with zero queries.
  let writes=0;const deny={query:async()=>{writes++;throw new Error('no writes permitted')}};
  assert.equal((await require('../lib/research-500d-backfill').backfillResearch500D({sql:deny})).noDataWrites,true);
  assert.equal((await require('../lib/fundflow-xy').backfillCompactFeatureHistory({sql:deny})).noDataWrites,true);
  assert.equal((await require('../lib/fundflow-xy').rebuildTopicTaxonomyHistory({sql:deny})).noDataWrites,true);
  assert.equal(writes,0);
  Module._load=origLoad;
  console.log('PASS SZ 2.6.9.14: single 500D coverage, as-of membership, append-only research, no historical rewrite, .12 holdings included');
})().catch(e=>{console.error(e);process.exitCode=1;});
