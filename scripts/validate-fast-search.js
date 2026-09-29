const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const quote=fs.readFileSync(path.join(root,'api','quote.js'),'utf8');
const meta=fs.readFileSync(path.join(root,'lib','stockmeta-service.js'),'utf8');
const errors=[];
function need(ok,msg){if(!ok)errors.push(msg)}
need(/mode:\s*"db-close"/.test(app),'app.js missing DB-close fallback');
need(/readLocalCloseQuote/.test(app)&&/isTodayCloseCached/.test(app),'post-close fast local quote cache missing');
need(/Yahoo is the normal close source\. Neon price_snapshot is fallback only/.test(app),'post-close source priority is not Yahoo/local-first');
need(!/enrichStockMetaIndustry/.test(app),'search still depends on industry enrichment');
need(/return \[code,market\]\.filter\(Boolean\)\.join\(" \| "\)/.test(app),'stock header still renders exchange industry category');
need(/if\(mode==="db-close"\)/.test(quote),'quote API missing db-close fallback mode');
need(/market_company_profile/.test(quote)&&/price_snapshot/.test(quote),'quote API lost persisted DB fallback');
need(/const numericHint=liveStockHint\(query,marketHint\)/.test(quote),'numeric quote should bypass Neon identity lookup');
need(/const db=await dbResolveStock/.test(quote),'name resolver should retain DB-first company lookup');
need(/const local=await dbHits\(q\)/.test(meta),'stock meta service is not DB-first');
if(errors.length){console.error('FAST SEARCH VALIDATION FAIL');for(const e of errors)console.error('-',e);process.exit(1)}
console.log('FAST SEARCH VALIDATION PASS — local/IndexedDB fast close, Yahoo normal source, Neon fallback');
