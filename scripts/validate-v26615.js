const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const checks=[
  ['index.html','data-view="market-dynamic"'],['index.html','data-view-panel="market-dynamic"'],['index.html','v2.6.6.15'],
  ['app.js','loadMarketDynamic(false)'],['app.js','screening","market-dynamic","fundflow'],
  ['lib/market-dynamic.js','CREATE TABLE IF NOT EXISTS market_dynamic_daily'],['lib/market-dynamic.js','FMTQIK'],
  ['lib/storage-policy.js','marketDynamics: 500'],['api/market-dynamic.js','getMarketDynamic']
];
let bad=0;for(const [f,x] of checks){const ok=read(f).includes(x);console.log(ok?'OK':'FAIL',f,x);if(!ok)bad++}
for(const f of ['app.js','lib/market-dynamic.js','api/market-dynamic.js']){try{new Function(read(f));console.log('SYNTAX OK',f)}catch(e){console.log('SYNTAX FAIL',f,e.message);bad++}}
if(bad)process.exit(1);console.log('v2.6.6.15 market-dynamic validation passed');
