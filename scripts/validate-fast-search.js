const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const quote=fs.readFileSync(path.join(root,'api','quote.js'),'utf8');
const meta=fs.readFileSync(path.join(root,'lib','stockmeta-service.js'),'utf8');
const errors=[];
function need(ok,msg){if(!ok)errors.push(msg)}
need(/mode:\s*"db-close"/.test(app),'app.js does not call DB-close mode');
need(/if\(!isTaiwanIntraday\(\)\)\{\s*const fast=await dbCloseQuote/.test(app),'post-close quote is not DB-first');
need(!/enrichStockMetaIndustry/.test(app),'search still depends on industry enrichment');
need(/return \[code,market\]\.filter\(Boolean\)\.join\(" \| "\)/.test(app),'stock header still renders exchange industry category');
need(/if\(mode==="db-close"\)/.test(quote),'quote API missing db-close mode');
need(/market_company_profile/.test(quote)&&/price_snapshot/.test(quote),'quote API does not use persisted company/price DB');
need(/const db=await dbResolveStock/.test(quote),'quote resolver is not DB-first');
need(/const local=await dbHits\(q\)/.test(meta),'stock meta service is not DB-first');
if(errors.length){console.error('FAST SEARCH VALIDATION FAIL');for(const e of errors)console.error('-',e);process.exit(1)}
console.log('FAST SEARCH VALIDATION PASS');
