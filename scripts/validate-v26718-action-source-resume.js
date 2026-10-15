'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const originalLoad=Module._load;
Module._load=function(id,parent,isMain){if(id==='@neondatabase/serverless')return{neon:()=>{throw Error('No Neon in unit test')}};return originalLoad.call(this,id,parent,isMain)};
const m=require('../lib/research-corporate-actions');Module._load=originalLoad;

(async()=>{
  assert.equal(m.OFFICIAL_SOURCE_NAMES.length,5);
  const seen=[],sourceCache=new Map(),monthCache=[];
  const sql={query:async (query,args=[])=>{
    if(query.startsWith('CREATE TABLE IF NOT EXISTS '))return [];
    if(query.includes('SELECT month FROM market_research500_action_month'))return monthCache.map(month=>({month}));
    if(query.includes('SELECT kind,COUNT(*)::int n'))return [];
    if(query.includes('SELECT COUNT(*)::int n,COALESCE(SUM(changed_rows)'))return [{n:0,rows:0}];
    if(query.includes('SELECT source,rows,actions FROM market_research500_action_source_month'))return [...sourceCache.values()].filter(x=>x.month===args[0]);
    if(query.includes('SELECT source FROM market_research500_action_source_month'))return [...sourceCache.values()].filter(x=>x.month===args[0]).map(x=>({source:x.source}));
    if(query.includes('INSERT INTO market_research500_action_source_month')){
      const [month,source,rows,actions]=args;
      assert(!sourceCache.has(`${month}/${source}`));
      sourceCache.set(`${month}/${source}`,{month,source,rows,actions:JSON.parse(actions)});return [];
    }
    if(query.includes('SELECT DISTINCT stock_code,market FROM market_business_xy2_member'))return[{stock_code:'6914',market:'上市'}];
    if(query.includes('INSERT INTO market_research500_action_event')){throw Error('No events should be written in this test');}
    if(query.includes('INSERT INTO market_research500_action_month')){monthCache.push(args[0]);return []}
    throw Error(`Unknown SQL in test: ${query.slice(0,130)}`);
  }};
  const fake=async(month,{onlySources}={})=>{
    seen.push([...onlySources]);
    const failure=onlySources.length===5;
    const nameFail='TPEx revivt';
    return {month,ok:!failure,errors:failure?[`${nameFail}: HTTP 404`]:[],sourceReports:onlySources.filter(x=>!failure||x!==nameFail).map(name=>({name,rows:0,actions:[]}))};
  };
  let r=await m.scanNextMonth({sql,fetchMonth:fake});
  assert.equal(r.ok,false);assert.equal(r.month,'2025-02');
  assert.equal(r.completedSources,4);assert.equal(r.requiredSources,5);
  assert.equal(r.pendingSources.join(','),'TPEx revivt');
  assert.equal(monthCache.length,0,'failed month must NOT be marked complete');
  assert.equal(sourceCache.size,4,'successful independently validated sources must survive');
  r=await m.scanNextMonth({sql,fetchMonth:fake});
  assert.equal(r.ok,true);assert.equal(r.month,'2025-02');
  assert.deepEqual(seen[1],['TPEx revivt'],'must NOT re-download already validated sources');
  assert.equal(sourceCache.size,5);assert.equal(monthCache.length,1);
  assert.equal(r.status.completedMonths,1);
  const fakeHttp=async url=>({ok:url.includes('revivt'),status:422,json:async()=>({aaData:[]})});
  const fail=await m.fetchOfficialMonth('2025-02',{fetcher:fakeHttp,onlySources:['TWSE TWT49U','TPEx revivt']});
  assert.equal(fail.ok,false);assert(fail.errors[0].includes('TWSE TWT49U'));
  assert.equal(fail.sourceReports.length,1);
  assert.equal(fail.sourceReports[0].name,'TPEx revivt');
  await assert.rejects(()=>m.fetchOfficialMonth('2025-02',{onlySources:['unknown source']}),/unknown-official-source/);
  console.log('PASS v2.6.7.18: partial official source cache, resume missing only, 422 source diagnostics, fail-closed month certification');
})().catch(err=>{console.error(err);process.exitCode=1});
