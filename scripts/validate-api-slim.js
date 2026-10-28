'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const root=path.join(__dirname,'..'),apiDir=path.join(root,'api');
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const names=fs.readdirSync(apiDir).filter(f=>f.endsWith('.js'));
assert.equal(names.length,8,'Expected eight serverless entrypoints');
assert(names.length<=12,'Vercel Hobby ceiling');
const routes={
 '/api/stock':'/api/quote?sz_route=stock',
 '/api/w3-d111-shadow':'/api/market-dynamic?sz_shadow=d111',
 '/api/w3-d112-shadow':'/api/market-dynamic?sz_shadow=d112',
};
for(const [source,destination] of Object.entries(routes)){
 const found=(config.rewrites||[]).filter(row=>row.source===source);
 assert.equal(found.length,1,`Missing unique route ${source}`);
 assert.equal(found[0].destination,destination);
 assert(!fs.existsSync(path.join(apiDir,path.basename(source)+'.js')),'Dead original endpoint exists: '+source);
}
const q=fs.readFileSync(path.join(apiDir,'quote.js'),'utf8'), f=fs.readFileSync(path.join(apiDir,'fundflow.js'),'utf8'), m=fs.readFileSync(path.join(apiDir,'market-dynamic.js'),'utf8');
assert(q.includes('async function szStockActionHandler')&&q.includes('stockRoute')===false);
assert(!f.includes('szDw4Handler'),'retired forecast route must not exist');
assert(m.includes("require('../lib/api-routes/w3-shadow').d111")&&m.includes("require('../lib/api-routes/w3-shadow').d112"));
assert(fs.existsSync(path.join(root,'lib/api-routes/w3-shadow.js')));
assert.equal((config.crons||[]).length,12,'Keep all 12 currently scheduled jobs');
assert.equal((config.crons||[]).filter(x=>x.path==='/api/fundflow?view=industry-changes&action=scan').length,1);
assert(!Object.keys(config.functions||{}).some(x=>!fs.existsSync(path.join(root,x))));

// Exercise delegated live handlers under dependency stubs (no Neon or external HTTP).
const calls=[],originalLoad=Module._load;
Module._load=function(id,parent,isMain){
 const src=(parent?.filename||'').replaceAll('\\','/');
 if(src.endsWith('/api/quote.js')&&id==='../lib/stockmeta-service')return ()=>{};
 if(src.endsWith('/api/quote.js')&&id==='../lib/db')return {getSql:()=>{throw Error('Unexpected DB request')}};
 if(src.endsWith('/api/quote.js')&&id.startsWith('../lib/api-routes/'))return async(req,res)=>{calls.push('stock:'+req.query.action);return res.status(200).json({stockRoute:req.query.action})};
 if(src.endsWith('/api/fundflow.js')&&id==='../lib/fundflow-xy')return {SNAPSHOT_SCHEMA_VERSION:'schema-test',getFundflowSnapshot:async()=>({flowRoute:true}),getFundflowBusinessBrowser:async()=>({}),getFundflowDetail:async()=>({})};
 if(src.endsWith('/api/fundflow.js')&&id==='../lib/db')return {getSql:()=>({query:async()=>[]})};
 if(src.endsWith('/api/market-dynamic.js')&&id==='../lib/market-dynamic')return {getMarketDynamicCached:async()=>({marketRoute:true})};
 if(src.endsWith('/api/market-dynamic.js')&&id==='../lib/market-index-eod')return {getMarketIndexQuote:async()=>({indexRoute:true})};
 if(src.endsWith('/api/market-dynamic.js')&&id==='../lib/api-routes/w3-shadow')return {
  d111:async(req,res)=>{calls.push('w3-d111');return res.status(200).json({shadow:'d111'})},
  d112:async(req,res)=>{calls.push('w3-d112');return res.status(200).json({shadow:'d112'})},
 };
 return originalLoad.apply(this,arguments);
};
const mkres=()=>({code:0,headers:{},status(n){this.code=n;return this},json(body){this.body=body;return this},setHeader(k,v){this.headers[k]=v}});
async function run(){
 try{
  const quote=require('../api/quote'),fundflow=require('../api/fundflow'),market=require('../api/market-dynamic');
  const res1=mkres();await quote({method:'GET',query:{sz_route:'stock',action:'targets'}},res1);assert.equal(res1.body.stockRoute,'targets');
  const res4=mkres();await fundflow({query:{view:'overview'}},res4);assert.equal(res4.body.flowRoute,true);
  for(const v of ['d111','d112']){const res=mkres();await market({method:'GET',query:{sz_shadow:v}},res);assert.equal(res.body.shadow,v)}
  const res5=mkres();await market({method:'GET',query:{days:'5'}},res5);assert.equal(res5.body.marketRoute,true);
 }finally{Module._load=originalLoad;}
 assert.deepEqual(calls,['stock:targets','w3-d111','w3-d112']);
 console.log('PASS API slimming: 8/12 functions, 3 retained public URLs, cron, actual delegated handlers');
}
run().catch(err=>{console.error(err);process.exitCode=1;Module._load=originalLoad});
