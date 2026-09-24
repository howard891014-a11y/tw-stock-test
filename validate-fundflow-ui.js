const fs=require("fs");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("style.css","utf8");
const app=fs.readFileSync("app.js","utf8");
const errors=[];
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)errors.push("duplicate DOM ids found");
if(!html.includes('app.js?v=2.6.3.4'))errors.push('app.js cache-buster not updated to v2.6.3.4');
for(const token of ['data-fundflow-scope="electronics-product"','data-fundflow-browser-scope="electronics-product"','fundflowIsElectronicsProduct','fundflowScopeBucket(item)!==fundflowBrowserScope']) if(!html.includes(token)&&!app.includes(token)) errors.push(`missing v2.6.3.4 token ${token}`);
for(const token of ['fundflow-projection-fan','fundflow-controls-box .fundflow-phase-row','.fundflow-quad-legend{display:none!important}']) if(!app.includes(token)&&!css.includes(token)&&!html.includes(token)) errors.push(`missing UI token ${token}`);
if(app.includes('svg.append(fundflowSvg("polyline",{points:linePoints,class:`fundflow-projection')) errors.push('projection dashed polyline should be removed from chart rendering');
if(!css.includes('.fundflow-projection-fan{'))errors.push('fan CSS missing');
if(!html.includes('點開：不確定扇形'))errors.push('fan legend text missing');
if(html.includes('虛線：模型傾向'))errors.push('old projected legend text still visible');
if(!html.includes('data-fundflow-scope="finance"'))errors.push('finance scope missing');
if(!html.includes('data-fundflow-scope="traditional"'))errors.push('traditional scope missing');
if(!html.includes('data-fundflow-scope="technology-fine"'))errors.push('technology scope missing');
if(errors.length){console.error('Fundflow UI validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
console.log(`Fundflow UI/upgrade validation PASS — ${ids.length} unique DOM ids, v2.6.3.4 controls + fan assertions present`);
