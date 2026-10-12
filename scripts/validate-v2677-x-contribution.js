'use strict';
// Regression for the 2026-10-12 partial institutional feed: one ticker per market
// must never make the entire day eligible for XY, and company detail must use
// the stored snapshot's as-of date rather than mixing incomplete live inputs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadTagEngineInputs,computeTagDetail}=require('../lib/fundflow-xy');
const code=fs.readFileSync(require.resolve('../lib/fundflow-xy'),'utf8');
assert(code.includes('i.n >= GREATEST(100, a.n * 0.70)'), 'Must gate each market by institutional coverage');
assert.equal((code.match(/inst_dates AS \(\$\{COMPLETE_INSTITUTIONAL_DATES_SQL\}\)/g)||[]).length,4, 'All four upstream source-date queries must share completeness gate');
assert(code.includes('loadTagEngineInputs(sql,cleanTag,bounded,{asOf:snapshot.asOf})'), 'Company detail must be pinned to persisted snapshot date');
assert(code.includes('if(detail.asOf!==snapshot.asOf)'), 'Reject a cross-date mismatch rather than display misleading company contributions');
async function testSqlBoundDate(){
  const calls=[];
  const sql={query:async(q,args)=>{
    calls.push({q,args});
    if(q.includes('SELECT DISTINCT p.stock_code'))return [{stock_code:'7769',stock_name:'鴻勁',market:'上市'}];
    if(q.includes('WITH activity_dates'))return [{trade_date:'2026-10-08'}];
    return [];
  }};
  const out=await loadTagEngineInputs(sql,'semiconductor_test_equipment',5,{asOf:'2026-10-08'});
  assert.equal(out.dates.at(-1),'2026-10-08');
  assert(calls[1].q.includes('a.trade_date <= $2::date'));
  assert.deepEqual(calls[1].args.slice(-1),['2026-10-08']);
  assert.equal(calls[2].args.at(-1),'2026-10-08');
}
function testNoFakeZero(){
  const companies=[['2360','致茂'],['6261','久元'],['6706','惠特'],['7769','鴻勁']].map(([stock_code,stock_name])=>({stock_code,stock_name,market:['6261'].includes(stock_code)?'上櫃':'上市',industry_code:'24',industry:'半導體業'}));
  const rows=[];
  let date=new Date('2026-07-20T00:00:00Z'),n=0;
  while(n<62){const dow=date.getUTCDay();if(dow!==0&&dow!==6){const day=date.toISOString().slice(0,10);for(const x of companies){const valid=x.stock_code==='7769';rows.push({trade_date:day,...x,trade_value:1000000,trade_volume:10000,close_price:100,change_pct:0.3,return_5_pct:1.2,return_3_pct:1,return_20_pct:4,positive_days_5:3,institutional_total_net:valid?-10000:null,institutional_foreign_net:valid?-5000:null,institutional_trust_net:valid?-2500:null,institutional_dealer_net:valid?-2500:null});}n++}date.setUTCDate(date.getUTCDate()+1)}
  const d=computeTagDetail(companies,rows,'semiconductor_test_equipment',{maxDates:10});
  assert.equal(d.companies.length,4);
  const valid=d.companies.find(x=>x.code==='7769');
  assert.notEqual(valid.stockX,null);
  assert(Number.isFinite(valid.impactX));
  for(const c of d.companies.filter(x=>x.code!=='7769')){
    assert.equal(c.stockX,null,`${c.code} missing X must remain null`);
    assert.equal(c.impactX,null,`${c.code} missing X must never present as +0.00`);
    assert(Number.isFinite(c.impactY),'Valid Y contribution should remain visible');
  }
}
Promise.resolve().then(testSqlBoundDate).then(testNoFakeZero).then(()=>console.log('PASS v2.6.7.7 — source completeness, as-of pinning, missing-X contributions')).catch(e=>{console.error(e);process.exitCode=1;});
