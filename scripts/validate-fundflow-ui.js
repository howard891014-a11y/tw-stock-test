const fs=require("fs");
const assert=require("assert");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("style.css","utf8");
const app=fs.readFileSync("app.js","utf8");
const errors=[];
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)errors.push("duplicate DOM ids found");
for(const token of ['data-fundflow-scope="technology-upstream"','data-fundflow-scope="technology-midstream"','data-fundflow-scope="technology-downstream"','data-fundflow-scope="electronics-product"','data-fundflow-browser-scope="electronics-product"','fundflowTechStage','g.scope==="electronics-product"']) if(!html.includes(token)&&!app.includes(token)) errors.push(`missing classification token ${token}`);
for(const token of ['消費性電子','data-fundflow-axis-mode="zoom"','data-fundflow-axis-mode="raw"','data-fundflow-path="capital-leading"','data-fundflow-path="price-leading"','data-fundflow-path="resonance-up"','data-fundflow-path="capital-retreat"','data-fundflow-path="pullback"','data-fundflow-path="chaos"']) if(!html.includes(token))errors.push(`missing v2.6.5.26 control token ${token}`);
for(const token of ['fundflowPathState','fundflowAxisMode','fundflowZoomBound','fundflow-typhoon-trail','fundflow-typhoon-marker','fundflow-future-uncertainty','animateMotion']) if(!app.includes(token)&&!css.includes(token)&&!html.includes(token))errors.push(`missing v2.6.5.26 XY UI token ${token}`);
for(const old of ['data-fundflow-phase="germination"','data-fundflow-phase="potential"','data-fundflow-phase="mainline"','冷區／方向未明','過熱／冷卻 <em data-fundflow-phase-count']) if(html.includes(old))errors.push(`old phase UI still visible: ${old}`);
if(!html.includes('點開：A/B 兩條颱風路徑'))errors.push('Top-2 path legend text missing');
for(const token of ['XY v7','法人 20D robust 資金位置','20D正負鎖左右','價格發動率','等權投票','> +0.2%','資料完整度','讀取共用 XY snapshot'])if(!app.includes(token)&&!html.includes(token))errors.push(`missing v7 semantics token ${token}`);
if(app.includes('loadFundflowCoverage'))errors.push('retired fundflow coverage/sync-status loader still present');
if(html.includes('虛線：模型傾向'))errors.push('old projected legend text still visible');
if(html.includes('data-fundflow-scope="finance"'))errors.push('finance scope should be merged into traditional');
if(html.includes('data-fundflow-scope="all"'))errors.push('top-level all-business scope should be removed');
for(const token of ['new Set(["technology-upstream","technology-midstream","technology-downstream","electronics-product"])','fundflowScopes.size===1','fundflowScopes.delete(key)','fundflowScopes.add(key)']) if(!app.includes(token))errors.push(`multi-select classification rule missing: ${token}`);
if(errors.length){console.error('Fundflow UI validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
assert(app.includes('function fundflowBusinessUniverse()'),'full business-universe helper missing');
assert(app.includes('業務 ${universe.length}｜可畫 XY ${base.length}｜待法人 X ${pendingX}'),'UI must expose business universe vs true XY coverage');
assert(app.includes('key==="all"?String(universe.length):String(counts[key]??0)'),'All-path control must show the full business-universe count instead of only XY-eligible businesses');
console.log(`Fundflow UI v2.6.5.33 validation PASS — ${ids.length} unique DOM ids, consumer-electronics label + Path State + Raw/Zoom + typhoon animation present`);

assert(html.includes('max-height:calc(100dvh'),'settings modal must have a viewport-bounded scroll height');
assert(html.includes('overflow-y:auto!important'),'settings modal must scroll on mobile');
assert(app.includes('FUND_FLOW_VALIDATION_STORAGE_KEY'),'Path audit result persistence missing');
