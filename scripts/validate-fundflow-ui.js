const fs=require("fs");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("style.css","utf8");
const app=fs.readFileSync("app.js","utf8");
const errors=[];
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)errors.push("duplicate DOM ids found");
for(const token of ['data-fundflow-scope="technology-upstream"','data-fundflow-scope="technology-midstream"','data-fundflow-scope="technology-downstream"','data-fundflow-scope="electronics-product"','data-fundflow-browser-scope="technology-upstream"','data-fundflow-browser-scope="electronics-product"','fundflowTechStage','g.scope==="electronics-product"','fundflowScopeBucket(item)!==fundflowBrowserScope']) if(!html.includes(token)&&!app.includes(token)) errors.push(`missing v2.6.5.20 classification token ${token}`);
for(const token of ['fundflow-projection-fan','fundflow-future-path','fundflow-future-label','fundflow-controls-box .fundflow-phase-row','.fundflow-quad-legend{display:none!important}']) if(!app.includes(token)&&!css.includes(token)&&!html.includes(token)) errors.push(`missing UI token ${token}`);
if(app.includes('svg.append(fundflowSvg("polyline",{points:linePoints,class:`fundflow-projection')) errors.push('projection dashed polyline should be removed from chart rendering');
if(!css.includes('.fundflow-projection-fan{'))errors.push('fan CSS missing');
if(!html.includes('點開：A/B 兩條颱風路徑'))errors.push('Top-2 path legend text missing');
if(html.includes('虛線：模型傾向'))errors.push('old projected legend text still visible');
if(html.includes('data-fundflow-scope="finance"'))errors.push('finance scope should be merged into traditional');
if(html.includes('data-fundflow-scope="all"'))errors.push('top-level all-business scope should be removed');
if(!html.includes('data-fundflow-scope="traditional"'))errors.push('traditional scope missing');
for(const token of ['new Set(["technology-upstream","technology-midstream","technology-downstream","electronics-product"])','fundflowScopes.size===1','fundflowScopes.delete(key)','fundflowScopes.add(key)']) if(!app.includes(token))errors.push(`multi-select classification rule missing: ${token}`);
if(errors.length){console.error('Fundflow UI validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
console.log(`Fundflow UI/upgrade validation PASS — ${ids.length} unique DOM ids, multi-select categories + Top-2 typhoon path UI present`);
