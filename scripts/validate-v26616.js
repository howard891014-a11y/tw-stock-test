const fs=require("fs"),path=require("path"),root=path.resolve(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const checks=[["index.html","v2.6.6.16"],["index.html","market-distribution-card"],["index.html","stockzone-v26616-market-dynamic-polish"],["app.js","renderMarketDistribution"],["lib/market-dynamic.js","getLatestDistribution"],["package.json","2.6.6.16"]];
let bad=0;for(const [f,x] of checks){const ok=read(f).includes(x);console.log(ok?"OK":"FAIL",f,x);if(!ok)bad++}
for(const f of ["app.js","lib/market-dynamic.js"]){try{new Function(read(f));console.log("SYNTAX OK",f)}catch(e){console.log("SYNTAX FAIL",f,e.message);bad++}}
if(bad)process.exit(1);console.log("v2.6.6.16 validation passed");
