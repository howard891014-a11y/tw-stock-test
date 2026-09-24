const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
const sync=fs.readFileSync(path.join(root,'lib','sync-common.js'),'utf8');
const service=fs.readFileSync(path.join(root,'lib','sync-service.js'),'utf8');
const errors=[];
for(const id of ['fundflowDetailProjection','fundflowDetailProjectionNote','fundflowXySvg','fundflowPhaseSummary'])if(!html.includes(`id="${id}"`))errors.push(`missing DOM id ${id}`);
for(const token of ['fundflow-projection-fan','模型轉態傾向','projection.points.filter(p=>Number(p.horizon)<=3)','let fundflowPhaseFilter="all"','fundflowEligibleGroups({phase:false})',"v2.6.3.0 E' fan background pass"])if(!app.includes(token))errors.push(`missing E-prime behavior ${token}`);

for(const phase of ['all','germination','potential','mainline','transition','hotcool','cold-unknown'])if(!html.includes(`data-fundflow-phase="${phase}"`))errors.push(`missing Phase filter ${phase}`);
if(app.includes('.sort((a,b)=>priority(b)-priority(a)).slice(0,16)'))errors.push('XY chart still truncates groups to Top 16');
if(!app.includes('const groups=fundflowEligibleGroups().sort((a,b)=>priority(b)-priority(a))'))errors.push('XY chart is not full-view after Phase filtering');
if(!css.includes('fill-opacity:.065')||!css.includes('stroke-opacity:.18'))errors.push('E-prime fan is not low-opacity background styling');
if(!html.includes('app.js?v=2.6.3.0'))errors.push('app.js cache-buster not updated to v2.6.3.0');
if(!html.includes('.fundflow-projection-fan{opacity:1;fill-opacity:.065;stroke-opacity:.18'))errors.push('live inline E-prime fan CSS missing');
for(const forbidden of ['data-fundflow-browser-status=','>科技回退<','>0 家公司<','>未成群<','>有 XY<','>全部狀態<'])if(html.includes(forbidden))errors.push(`obsolete business-browser control still present: ${forbidden}`);
if(html.includes('data-fundflow-browser-scope="other"'))errors.push('obsolete 其他 business-browser scope still present');
for(const cls of ['.fundflow-projection{','.fundflow-projection-fan{','.fundflow-projection-summary{'])if(!css.includes(cls))errors.push(`missing CSS ${cls}`);
for(const token of ['return_3_pct numeric','LAG(close_price,3)','return_3_pct=EXCLUDED.return_3_pct',"INTERVAL '180 days'"])if(!sync.includes(token))errors.push(`missing B activity factor ${token}`);
if(!service.includes('targetTradingDays=80'))errors.push('history target is not 80 trading days');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const seen=new Set();for(const id of ids){if(seen.has(id))errors.push(`duplicate DOM id ${id}`);seen.add(id)}
if(errors.length){console.error(`Fundflow UI/upgrade validation failed (${errors.length})`);for(const e of errors)console.error(`- ${e}`);process.exit(1)}
console.log(`Fundflow UI/upgrade validation PASS — ${ids.length} unique DOM ids, E' projection + B/C prerequisites present`);
