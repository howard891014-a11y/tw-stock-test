'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module');
const moduleLoad=Module._load;
Module._load=function(name,parent,isMain){if(name==='@neondatabase/serverless')return {neon:()=>{throw Error('Unit tests are DB-read/write free')}};return moduleLoad.call(this,name,parent,isMain)};
const repair=require('../lib/research-x-gap-repair');Module._load=moduleLoad;
const app=fs.readFileSync('app.js','utf8'),api=fs.readFileSync('api/sync-status.js','utf8'),html=fs.readFileSync('index.html','utf8');
assert(html.includes('id="manualResearchXGapRepair"')&&html.includes('id="manualResearchXGapStatus"'));
assert(app.includes('runManualResearchXGapRepair')&&app.includes('research-x-gap-repair-manual'));
assert(api.includes("action==='research-x-gap-repair-manual'"));
assert(api.includes("progressView==='research-x-gap-progress'"));
const src=fs.readFileSync('lib/research-x-gap-repair.js','utf8');
assert(src.includes('r.x_score IS NULL OR r.flow_1_pct IS NULL OR r.flow_5_pct IS NULL'));
assert(src.includes('x_score=COALESCE(r.x_score,i.x_score)'));
assert(src.includes('flow_1_pct=COALESCE(r.flow_1_pct,i.flow_1_pct)'));
assert(src.includes('flow_5_pct=COALESCE(r.flow_5_pct,i.flow_5_pct)'));
assert(!src.includes('INSERT INTO market_business_xy2_research_daily'));
assert(!src.includes('y_score=')&&!src.includes('DELETE FROM')&&!src.includes('CREATE TABLE'));
assert(!src.includes('UPDATE market_business_xy2_topic_daily'));
let comparator=new Map([['2026-07-14|a',{x_score:10}],['2026-07-14|b',{x_score:-5}]]);
let ok=repair.auditReproduction(comparator,[{trade_date:'2026-07-14',tag_id:'a',x_score:10.1},{trade_date:'2026-07-14',tag_id:'b',x_score:-4.8}],{minPairs:2});
assert.equal(ok.ok,true);
let bad=repair.auditReproduction(comparator,[{trade_date:'2026-07-14',tag_id:'a',x_score:-10},{trade_date:'2026-07-14',tag_id:'b',x_score:5}],{minPairs:2});
assert.equal(bad.ok,false);
async function test(){
  let queries=[];
  const sql={query:async(q,args)=>{queries.push(q);
    if(q.includes('WITH current_tags'))return [{d:'2026-07-15',price_tags:202,x_tags:0,missing_x:202},{d:'2026-07-16',price_tags:202,x_tags:0,missing_x:202}];
    if(q.includes('WITH p AS'))return Array.from({length:80},(_,i)=>({d:new Date(Date.UTC(2026,3,20+i)).toISOString().slice(0,10)}));
    throw Error('Unexpected query '+q.slice(0,40));
  }};
  const state=await repair.readResearchXGapStatus(sql);
  assert.equal(state.gapDays,2);assert.equal(state.missingXRows,404);
  const test=await repair.repairResearchXGaps({sql,dryRun:true});
  assert.equal(test.noWrites,true); // mock calendar deliberately does not include the later gap
  assert.equal(test.ok,false);
  assert(!queries.some(q=>q.includes('UPDATE ')||q.includes('INSERT ')));
  const emptySql={query:async(q)=>q.includes('WITH current_tags')?[]:[]};
  let empty=await repair.repairResearchXGaps({sql:emptySql});
  assert.equal(empty.skipped,true);assert.equal(empty.noWrites,true);
  assert(repair.loadHistoricXCompactRows && repair.finishCompactXRow);
  // Optimized SQL must return only 4 target/anchor dates; no reliance on a
  // cross-invocation serverless memory cache or extra persisted temp tables.
  const row=repair.finishCompactXRow({prior_raw20:Array(20).fill(.25),
    inst_flow_days_20:20,inst_flow_ratio_20:.75,stock_code:'2330',market:'上市'});
  assert.equal(row.stock_flow_history_days,20);
  assert.equal(row.stock_flow_reliability,1);
  assert(row.stock_flow_score>0);
  assert.equal(row.inst_flow_ratio_20,.75);
  assert(!src.includes("loadHistoricXRows(sql,warmupStart,readThrough)"));
  assert(src.includes("ARRAY_AGG(r.raw20) FILTER"));
  assert(src.includes("FROM histories WHERE trade_date=ANY($3::date[])"));

  // Execute full positive path with fake data engine: validate atomic update-only
  // semantics and that the current 202 tags' 3 historical days become repaired.
  delete require.cache[require.resolve('../lib/research-x-gap-repair')];
  const mockOriginal=Module._load;
  const sourceDates=Array.from({length:80},(_,i)=>new Date(Date.UTC(2026,3,20+i)).toISOString().slice(0,10));
  const target=sourceDates.slice(55,58),anchor=sourceDates[54],tags=Array.from({length:202},(_,i)=>`tag${i}`);
  Module._load=function(name,parent,isMain){
    if(parent?.filename?.endsWith('/research-x-gap-repair.js')){
      if(name==='./research-500d-backfill')return {WARMUP:45,availableRawDates:async()=>sourceDates};
      if(name==='./fundflow-xy')return {FEATURE_VERSION:'current',DAILY_BUILD_VERSION:'current',buildProfileTagMap:()=>({}),stockFlowScale:()=>1,continuousStockFlowScore:()=>10,scoreStocksForDate:a=>a,
        aggregateTagDate:(a,map,d)=>tags.map(tagId=>({tagId,xAvailable:true,x:10,themeFlow1Pct:1.5,themeFlow5Pct:2.5}))};
    }
    return mockOriginal.call(this,name,parent,isMain);
  };
  const injected=require('../lib/research-x-gap-repair');Module._load=mockOriginal;
  let repaired=false,updated=false;
  const db={query:async(q,args)=>{
    if(q.includes('WITH current_tags'))return repaired?[]:target.map(d=>({d,price_tags:202,x_tags:0,missing_x:202}));
    if(q.includes('market_company_profile ORDER BY stock_code'))return [];
    if(q.includes('WITH codes AS')){
      assert.deepEqual(args[2],[anchor,...target]);
      return [anchor,...target].map(d=>({trade_date:d,prior_raw20:Array(20).fill(1),inst_flow_ratio_20:1,inst_flow_days_20:20}));
    }
    if(q.includes('WHERE trade_date=$1::date')&&q.includes('x_score IS NOT NULL'))return tags.map(tag_id=>({trade_date:anchor,tag_id,x_score:10}));
    if(q.includes('trade_date=ANY($1::date[])'))return target.flatMap(d=>tags.map(tag_id=>({trade_date:d,tag_id,x_score:null,y_score:2,flow_1_pct:null,flow_5_pct:null})));
    if(q.includes('pg_database_size'))return [{bytes:358334464}];
    if(q.includes('UPDATE market_business_xy2_research_daily')){
      assert(q.includes('COALESCE(r.x_score,i.x_score)'));assert(!q.includes('y_score='));assert.equal(JSON.parse(args[0]).length,606);
      repaired=true;updated=true;return target.flatMap(d=>tags.map(tag_id=>({d,tag_id})));
    }
    throw Error('Unexpected repair SQL: '+q.slice(0,150));
  }};
  const positive=await injected.repairResearchXGaps({sql:db});
  assert(positive.ok&&positive.updatedRows===606&&positive.after.gapDays===0&&updated);
  assert.equal(positive.audit.signAgreement,1);
  // Math equivalence: 3-day optimized feature transport MUST produce exactly
  // the same stock X20, flow1/5 and reliability as the original 49D raw scan.
  // Include missing-trade dates and late-listed stocks to exercise maturity.
  const realEngine=require('../lib/fundflow-xy');
  const simulated=[];
  for(let stock=0;stock<7;stock++)for(let t=0;t<57;t++){
    if((t+stock*3)%31===0||(stock===6&&t<21))continue;
    const tradeValue=1000000+stock*99990+(t%7)*17424;
    const closePrice=30+stock*3+.23*t;
    simulated.push({trade_date:new Date(Date.UTC(2026,0,1+t)).toISOString().slice(0,10),
      stock_code:String(8000+stock),market:'上市',trade_value:tradeValue,close_price:closePrice,
      institutional_total_net:Math.round(Math.sin((t+stock)*.61)*5400)});
  }
  const full=realEngine.enrichFlowFeatures(simulated);
  const byStock=new Map();for(const r of full){const key=r.market+'|'+r.stock_code;
    if(!byStock.has(key))byStock.set(key,[]);byStock.get(key).push(r);}
  let comparisons=0;
  for(const rows of byStock.values()){
    rows.sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
    for(let i=0;i<rows.length;i++){
      const r=rows[i];if(i<20||i%3!==1)continue;
      const hist=rows.slice(0,i).map(x=>x.inst_flow_days_20>=20?x.inst_flow_ratio_20:null)
        .filter(x=>x!==null).slice(-20);
      const rebuilt=repair.finishCompactXRow({
        stock_code:r.stock_code,market:r.market,trade_date:r.trade_date,
        inst_flow_ratio_20:r.inst_flow_ratio_20,inst_flow_days_20:r.inst_flow_days_20,
        inst_flow_ratio_1:r.inst_flow_ratio_1,inst_flow_ratio_5:r.inst_flow_ratio_5,
        inst_turnover_value_20:r.inst_turnover_value_20,prior_raw20:hist});
      assert.equal(rebuilt.stock_flow_history_days,r.stock_flow_history_days);
      assert(Math.abs(rebuilt.stock_flow_reliability-r.stock_flow_reliability)<1e-10);
      assert(Math.abs(rebuilt.stock_flow_scale-r.stock_flow_scale)<1e-10);
      if(r.stock_flow_score===null)assert.equal(rebuilt.stock_flow_score,null);
      else assert(Math.abs(rebuilt.stock_flow_score-r.stock_flow_score)<1e-9);
      comparisons++;
    }
  }
  assert(comparisons>50,`Too few X-math equivalence examples: ${comparisons}`);
  console.log(`PASS X-gap optimized/legacy stock-score equivalence: ${comparisons} synthetic examples`);
  console.log('PASS X gap repair: single-authoritative X, guarded null-only update, overlap comparison, known missing stock, dry-run, no-write fallbacks, API and UI entry points');
}
test().catch(e=>{console.error(e);process.exitCode=1});
