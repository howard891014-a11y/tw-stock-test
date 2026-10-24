'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const saved=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return {neon:()=>{throw Error('No live Neon in tests')}};return saved.call(this,id,parent,isMain)};
const mod=require('../lib/company-action-monitor');
Module._load=saved;
const {classify}=mod;
const make=(kind,note='權',source='TWSE TWT49U',date='2026-10-23')=>({trade_date:date,stock_code:'2330',market:'上市',kind,source,old_close:100,reference_close:50,note});
assert.equal(classify(make('split','分割')).action,'分割');
assert.equal(classify(make('reduction','減資')).action,'減資');
assert.equal(classify(make('rights_offering','現金增資')).action,'增資');
assert.equal(classify(make('ex_rights','權')).action,'除權');
assert.equal(classify(make('ex_rights','除息')),null,'pure dividend is NOT ex-rights');
assert.equal(classify({...make('ex_rights','權/息'),type_confirmed:false}),null,'missing official type must never be guessed as rights');
assert.equal(classify(make('ex_rights','未知')),null,'unknown ex-rights types cannot be guessed');
assert.equal(classify(make('ex_rights','權/息')).ambiguous,true,'mixed event requires SZ review');
assert.equal(classify(make('split')).id,classify(make('split')).id,'deterministic idempotency');
assert.notEqual(classify(make('split')).id,classify(make('reduction')).id,'different actions get distinct IDs');
assert.notEqual(classify(make('split')).id,classify({...make('split'),reference_close:30}).id,'changed official numbers must reenter review');
const dir=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(dir,'app.js'),'utf8'),html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),monitor=fs.readFileSync(path.join(dir,'lib/company-action-monitor.js'),'utf8');
assert(html.includes('<th>行為</th>')&&!html.includes('<th>上市櫃／下市</th>'),'event behavior column');
assert(!html.includes('id="manualActionScan"'),'corporate detection moved out of advanced repair section');
assert(app.includes("szIndustryRequest('scan-actions','POST')"),'one-click XY update also scans recent corporate actions');
assert(app.includes('await szIndustryRefresh();'),'XY release refresh must reload imported state without deployment');
assert(app.includes("row.recordType==='company-action'?'delete-action':'delete'"),'per-candidate safe deletion');
assert(monitor.includes('FROM market_company_action_release'),'actual independent Neon SZ approval needed');
assert(monitor.includes('WHERE NOT EXISTS(SELECT 1 FROM market_company_action_release'),'verified-and-deleted candidate cannot resurrect');
assert(monitor.includes('length(trim(r.evidence))>=10'),'release requires audited evidence');
assert(!/UPDATE\s+market_business_xy2_member|DELETE\s+FROM\s+market_business_xy2_member|UPDATE\s+market_business_xy2_research_daily/i.test(monitor),'scanner does not rewrite approved taxonomy/history');
const original=make('split','股票分割'),failedSource='TWSE TWT49U';
const queries=[];
const sql={query:async(q,args=[])=>{
 queries.push({q,args});
 if(q.startsWith('CREATE TABLE IF NOT EXISTS'))return [];
 if(q.includes('FROM market_company_profile'))return[{stock_code:'2330',stock_name:'台積電',industry:'半導體業',market:'上市'}];
 if(q.includes('INSERT INTO market_company_action_candidate')){assert(q.includes('WHERE NOT EXISTS'),'must not resurrect audited deleted candidates');assert(q.includes('ON CONFLICT(candidate_id) DO NOTHING'),'idempotent scanner');return[{candidate_id:'abc'}];}
 if(q.includes('DELETE FROM market_company_action_candidate')){assert(q.includes('AND EXISTS'),'cannot delete without approved verified row');return args[0]==='a'.repeat(24)?[{candidate_id:args[0]}]:[];}
 if(q.includes('to_regclass'))return[{candidate:true,release:true}];
 if(q.includes('FROM market_company_action_candidate'))return[];
 throw Error('unhandled test sql '+q.slice(0,100));
}};
async function tests(){
  // Both month feeds are attempted. Partial failure is reported and cannot be
  // treated as 0 official events; successful records are still available.
  const fetchMonth=async m=>m==='2026-10'?{ok:false,errors:[`${failedSource}: HTTP 502`],sourceReports:[{name:'TPEx exDailyQ',actions:[]}]}:
    {ok:true,errors:[],sourceReports:[{name:'TWSE TWTB8U',actions:[original]}]};
  const a=await mod.scanRecent({sql,fetchMonth,date:'2026-10-24'});
  assert.equal(a.complete,false);assert.equal(a.inserted,1);assert.deepEqual(a.scannedMonths,['2026-09','2026-10']);
  assert.equal(a.errors.length,1);assert(queries.some(x=>x.q.includes('market_company_action_candidate')));
  const deleted=await mod.removeApproved('a'.repeat(24),{sql});assert.equal(deleted.verifiedReleasePreserved,true);
  await assert.rejects(()=>mod.removeApproved('b'.repeat(24),{sql}),/禁止刪除/);
  assert.equal((await mod.list({sql})).length,0);
  console.log('PASS v2.6.8.23 corporate events candidate inbox, official partial failure, Neon audited release gate, XY refresh, approved-only deletion');
}
tests().catch(e=>{console.error(e);process.exitCode=1});
