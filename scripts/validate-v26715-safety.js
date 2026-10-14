'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=name=>fs.readFileSync(require('node:path').resolve(__dirname,'..',name),'utf8');
const enrich=read('lib/business-enrichment.js'),sync=read('api/sync-status.js'),engine=read('lib/fundflow-xy.js'),official=read('lib/research-500d-backfill.js'),dynamic=read('lib/market-dynamic.js'),app=read('app.js'),html=read('index.html');
// Never let 1988 background MOPS auto-enrich updates destroy frozen final 203 subindustries.
for(const table of ['market_business_xy2_member','market_business_xy2_topic_daily','market_business_xy2_snapshot']){
 assert(!enrich.includes('DELETE FROM '+table),'Blind Coverage wipes '+table);
}
const scheduled=sync.slice(sync.indexOf("if(schedule && ['price','twse','tpex'].includes(action))"));
assert(!scheduled.includes('runBusinessEnrichment({'),'daily cron must NOT rerun legacy Blind Coverage');
assert(sync.includes('frozen-taxonomy-protected-manual-only'));
// 500D progress must remain derived from canonical 203 freeze, even while live member table is empty.
assert(official.includes('frozenTaxonomy.listDefinitions()'));
assert(official.includes('unnest($3::text[])'));
assert(official.includes('taxonomyReady'));
assert(read('lib/research-500d-official.js').includes('frozen-203-membership-missing-use-safe-restore'));
assert(app.includes('research500TaxonomyReady'));
assert(html.includes('manualXYRecovery')&&app.includes('runManualXYRecovery'));
assert(sync.includes("action==='xy-safe-restore-manual'"));
assert(sync.includes('preserveResearch:true'));
assert(sync.includes('safeRestorePreparedFromStored({sql})'));
assert(sync.includes('const partialSuccess=Boolean(result.ok||Number(result.processedDates)>0)'));
assert(engine.includes('async function safeRestorePreparedFromStored'));
const recovery=engine.slice(engine.indexOf('async function safeRestorePreparedFromStored'),engine.indexOf('async function warmCurrentEngineFromStoredDb'));
assert(!recovery.includes('refreshBusinessFlowDaily'),'emergency restoration must never rewrite research table');
const migration=engine.slice(engine.indexOf('async function rebuildTopicTaxonomyHistory'),engine.indexOf('async function refreshBusinessFlowDaily'));
assert(migration.includes('if(!preserveResearch)await persistCompactResearchRows'));
assert(migration.includes('maxDates=null'));
assert(sync.includes('readOnly:false'));
// 10/14 2-stock partial import cannot be rendered as a valid zero.
const db=require.resolve('../lib/db');require.cache[db]={id:db,filename:db,loaded:true,exports:{getSql:()=>null}};
const {deriveRows}=require('../lib/market-dynamic');
const raw=[{trade_date:'2026-10-13',total_count:1900,usable_count:1800,up_count:1000,down_count:800,flat_count:0,total_trade_value:1234},{trade_date:'2026-10-14',total_count:1090,usable_count:1090,up_count:500,down_count:500,flat_count:90,total_trade_value:5678}];
const inst=[{trade_date:'2026-10-13',coverage_ok:true,foreign_value:-2500000000,foreign_net:-500000000,trust_value:100000000,dealer_value:-30000000,institutional_coverage_pct:90},{trade_date:'2026-10-14',coverage_ok:false,foreign_value:null,foreign_net:null,institutional_coverage_pct:0}];
const result=deriveRows(raw,inst,new Map());
assert.equal(result[0].foreign_value,-2500000000);
assert.equal(result[0].institutional_complete,true);
assert.equal(result[1].foreign_value,null);
assert.equal(result[1].foreign_net,null);
assert.equal(result[1].institutional_complete,false);
for(const col of ['foreign_value','trust_value','dealer_value','institutional_complete','institutional_coverage_pct'])assert(dynamic.includes('ADD COLUMN IF NOT EXISTS '+col),'missing backward schema '+col);
assert(dynamic.includes('LEFT JOIN institutional_trading_daily i USING(trade_date,stock_code,market)'));
assert(dynamic.includes('COUNT(*)=2 AND BOOL_AND(complete)'));
assert(dynamic.includes('SUM(i.foreign_net::numeric * p.close_price::numeric)'));
assert(app.includes('marketFmtMoney(d.foreignValue)'));
assert(!app.includes('marketFmtMoney(d.foreignNet)'),'foreign share count must NEVER be marked 億元');
assert(app.includes('"待更新"'));
assert(read('lib/institutional-history.js').includes("const minimum = market === '上市' ? 500 : 350"));
console.log('PASS v2.6.7.15 frozen taxonomy + independent 500D progress + no fake foreign money + safe resumable recovery');
