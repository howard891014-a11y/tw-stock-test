const fs=require("fs");
const assert=require("assert");
const html=fs.readFileSync("index.html","utf8");
const css=fs.readFileSync("style.css","utf8");
const app=fs.readFileSync("app.js","utf8");
const errors=[];
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)errors.push("duplicate DOM ids found");
for(const token of ['data-fundflow-scope="technology-upstream"','data-fundflow-scope="technology-midstream"','data-fundflow-scope="technology-downstream"','data-fundflow-scope="electronics-product"','data-fundflow-browser-scope="electronics-product"','fundflowTechStage','g.scope==="electronics-product"']) if(!html.includes(token)&&!app.includes(token)) errors.push(`missing classification token ${token}`);
for(const token of ['消費性電子','data-fundflow-axis-mode="zoom"','data-fundflow-axis-mode="raw"','data-fundflow-path="cold"','data-fundflow-path="direction-unclear"','data-fundflow-path="early-reaction"','data-fundflow-path="institutional-layout"','data-fundflow-path="strong-continuation"','data-fundflow-path="main-rise-confirmation"','data-fundflow-path="weakening"','data-fundflow-path="pullback"']) if(!html.includes(token))errors.push(`missing v2.6.6.4 route control token ${token}`);
for(const token of ['fundflowPathState','fundflowPathAngle','fundflowFutureOpposed','fundflowAxisMode','fundflowZoomBound','fundflow-typhoon-trail','fundflow-future-cone','fundflowStartFocusAnimation','fundflowFocusAnimationState','fundflowPartialPolyline']) if(!app.includes(token)&&!css.includes(token)&&!html.includes(token))errors.push(`missing Path 3.1 XY UI token ${token}`);
for(const old of ['data-fundflow-phase="germination"','data-fundflow-phase="potential"','data-fundflow-phase="mainline"','冷區／方向未明','過熱／冷卻 <em data-fundflow-phase-count']) if(html.includes(old))errors.push(`old phase UI still visible: ${old}`);
for(const old of ['data-fundflow-path="capital-leading"','data-fundflow-path="price-leading"','data-fundflow-path="resonance-up"','data-fundflow-path="strong-hold"','data-fundflow-path="capital-retreat"','data-fundflow-path="chaos"']) if(html.includes(old))errors.push(`old route control still visible: ${old}`);
if(!html.includes('淡色區：XY 外包絡帶'))errors.push('dW4 Plus XY envelope legend missing');
if(html.includes('Future Path A 5D 一起判讀'))errors.push('retired A/B forecast default note remains');
if(!app.includes('scenarios.slice(0,1).forEach'))errors.push('legacy secondary A/B route must not render');
for(const token of ['XY v8','法人 20D robust 資金位置','20D正負鎖左右','價格發動率','等權投票','> +0.2%','資料完整度','讀取共用 XY snapshot'])if(!app.includes(token)&&!html.includes(token))errors.push(`missing v7 semantics token ${token}`);
if(app.includes('loadFundflowCoverage'))errors.push('retired fundflow coverage/sync-status loader still present');
if(html.includes('虛線：模型傾向'))errors.push('old projected legend text still visible');
if(html.includes('data-fundflow-scope="finance"'))errors.push('finance scope should be merged into traditional');
if(html.includes('data-fundflow-scope="all"'))errors.push('top-level all-business scope should be removed');
for(const token of ['["technology-upstream","technology-midstream","technology-downstream","electronics-product"]','fundflowScopes.size===1','fundflowScopes.delete(key)','fundflowScopes.add(key)','saveFundflowSession']) if(!app.includes(token))errors.push(`multi-select/session classification rule missing: ${token}`);

for(const token of ['if(fundflowSelectedTagId===id){fundflowClearSelection();return;}','groups=selected?[selected]:allGroups','FUND_FLOW_HOLD_MS=5000','fundflowPartialPolyline(rawPts,anim.history)','zeroNeonFocus:true'])if(!app.includes(token))errors.push(`missing focus/animation rule: ${token}`);
for(const token of ['/api/fundflow?view=detail','fundflowDetailCache','fundflowCompanySort','fundflowSortedCompanies','renderFundflowCompanyList','data-fundflow-company-sort="x"','data-fundflow-company-sort="y"','X 軸貢獻 ↓','Y 軸貢獻 ↓'])if(!app.includes(token)&&!html.includes(token))errors.push(`missing v2.6.6.4 company-contribution token ${token}`);
if(app.includes('(d.companies||[]).slice(0,12)'))errors.push('company contribution list must not truncate to 12 rows');
if(!app.includes('依 ${axis.toUpperCase()} 軸貢獻高 → 低'))errors.push('company contribution sort direction text missing');
if(!css.includes('.fundflow-typhoon-trail.is-focus{stroke-opacity:.92!important'))errors.push('focused historical trail must keep uniform opacity');

for(const token of ['fundflowFutureCurveSamples','fundflowFutureConePath','fundflowFutureCenterPath','stroke-dasharray:5 5','fill:none!important'])if(!app.includes(token)&&!css.includes(token)&&!html.includes(token))errors.push(`missing smooth Path 3.1 forecast rendering token ${token}`);
if(app.includes('familyProbabilityWeak'))errors.push('artificial A>=50% direction gate must be removed');
if(errors.length){console.error('Fundflow UI validation FAILED');for(const e of errors)console.error('-',e);process.exit(1)}
assert(app.includes('function fundflowBusinessUniverse()'),'full business-universe helper missing');
assert(app.includes('業務 ${universe.length}｜可畫 XY ${base.length}｜待法人 X ${pendingX}'),'UI must expose business universe vs true XY coverage');
assert(app.includes('key==="all"?String(universe.length):String(counts[key]??0)'),'All-path control must show the full business-universe count instead of only XY-eligible businesses');
console.log(`Fundflow UI v2.6.6.8 validation PASS — ${ids.length} unique DOM ids, consumer-electronics label + Path State + Raw/Zoom + typhoon animation present`);

assert(html.includes('max-height:calc(100dvh'),'settings modal must have a viewport-bounded scroll height');
assert(html.includes('overflow-y:auto!important'),'settings modal must scroll on mobile');
assert(app.includes('FUND_FLOW_VALIDATION_STORAGE_KEY'),'Path audit result persistence missing');

assert(html.includes('補齊法人 60D'),'settings must expose 60D institutional repair');
assert(html.includes('重建乾淨 XY'),'settings must expose Clean XY v2 rebuild');
assert(html.includes('Neon Storage Audit'),'settings must expose read-only storage audit');
assert(app.includes('fundflow-clean-rebuild-manual'),'Clean XY button must call DB-only clean rebuild endpoint');
assert(app.includes('fundflow-audit&target=60'),'Path audit must request the 60D history target');
