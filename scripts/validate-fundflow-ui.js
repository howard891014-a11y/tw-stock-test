const fs=require("fs");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("style.css","utf8");
const app=fs.readFileSync("app.js","utf8");
const errors=[];
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)errors.push("duplicate DOM ids found");
for(const token of ['data-fundflow-scope="technology-upstream"','data-fundflow-scope="technology-midstream"','data-fundflow-scope="technology-downstream"','data-fundflow-scope="electronics-product"','data-fundflow-browser-scope="electronics-product"','fundflowTechStage','g.scope==="electronics-product"']) if(!html.includes(token)&&!app.includes(token)) errors.push(`missing classification token ${token}`);
for(const token of ['消費性電子','data-fundflow-axis-mode="zoom"','data-fundflow-axis-mode="raw"','data-fundflow-path="capital-leading"','data-fundflow-path="price-leading"','data-fundflow-path="resonance-up"','data-fundflow-path="capital-retreat"','data-fundflow-path="pullback"','data-fundflow-path="chaos"']) if(!html.includes(token))errors.push(`missing v2.6.5.25 control token ${token}`);
for(const token of ['fundflowPathState','fundflowAxisMode','fundflowZoomBound','fundflow-typhoon-trail','fundflow-typhoon-marker','fundflow-future-uncertainty','animateMotion']) if(!app.includes(token)&&!css.includes(token)&&!html.includes(token))errors.push(`missing v2.6.5.25 XY UI token ${token}`);
for(const old of ['data-fundflow-phase="germination"','data-fundflow-phase="potential"','data-fundflow-phase="mainline"','冷區／方向未明','過熱／冷卻 <em data-fundflow-phase-count']) if(html.includes(old))errors.push(`old phase UI still visible: ${old}`);
if(!html.includes('點開：A/B 兩條颱風路徑'))errors.push('Top-2 path legend text missing');
if(html.includes('虛線：模型傾向'))errors.push('old projected legend text still visible');
if(html.includes('data-fundflow-scope="finance"'))errors.push('finance scope should be merged into traditional');
if(html.includes('data-fundflow-scope="all"'))errors.push('top-level all-business scope should be removed');
for(const token of ['new Set(["technology-upstream","technology-midstream","technology-downstream","electronics-product"])','fundflowScopes.size===1','fundflowScopes.delete(key)','fundflowScopes.add(key)']) if(!app.includes(token))errors.push(`multi-select classification rule missing: ${token}`);
if(errors.length){console.error('Fundflow UI validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
console.log(`Fundflow UI v2.6.5.25 validation PASS — ${ids.length} unique DOM ids, consumer-electronics label + Path State + Raw/Zoom + typhoon animation present`);
