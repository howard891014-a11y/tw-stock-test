'use strict';
const assert=require('node:assert/strict'),fs=require('fs');
const {getSummary,getDetail,isCandidate,SUMMARY_SQL,DETAIL_SQL}=require('../lib/capital-flow');
const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8'),client=fs.readFileSync('capital-flow.js','utf8');
for(const a of ['cfOverview','cfDetail','cfStockList','cfMetrics','cfReading','cfStockCandidates','cfList','cfSearch'])assert(html.includes(`id="${a}"`),'missing '+a);
assert(!html.includes('id="fundflowXySvg"'),'XY graph is still rendered');
assert(!html.includes('data-fundflow-path="sleep"'),'nine-state controls are still rendered');
assert(!html.includes('id="fundflowDetailCard"'),'legacy XY detail is still in UI');
assert(app.includes('if(view==="fundflow"){window.StockZoneCapital?.load(false);}') ,'fundflow navigation must load capital-flow API');
assert(client.includes('/api/capital-flow?view=summary'),'new API not used');
assert(client.includes('/api/capital-flow?view=detail'),'new detail API not used');
for(const q of [SUMMARY_SQL,DETAIL_SQL]){assert(/^\s*(WITH|SELECT)\b/i.test(q));assert(!/\b(DELETE|TRUNCATE|DROP|ALTER|UPDATE|INSERT)\b/i.test(q),'read API cannot write to Neon');}
assert(!isCandidate({x:30,flow5Pct:4,flow20Pct:2,return5Pct:22,return20Pct:15}),'already jumped not candidate');
assert(!isCandidate({x:30,flow5Pct:4,flow20Pct:2,return5Pct:-15,return20Pct:15}),'falling knife not candidate');
assert(isCandidate({x:30,flow5Pct:4,flow20Pct:2,return5Pct:3,return20Pct:16}),'capital ahead of price candidate');
const mockRows=[{
 trade_date:'2026-10-16',tag_id:'ai_server',tag_name:'AI伺服器',parent_name:'科技',scope:'technology-fine',member_count:13,valid_count:13,
 x_score:30,flow_1_pct:2.1,flow_5_pct:4.3,flow_20_pct:6.3,raw_y_5_pct:1.4,dx3:8.4,
 breadth_valid:13,inflow_count:9,core_breadth_valid:9,core_inflow_count:7,breadth_pct:69.23,core_breadth_pct:77.77,opportunity_count:2,coverage_pct:100,reliability_pct:100}];
const detailRows=[
 {code:'1234',name:'甲',market:'上市',importance:'core',weight:1,x:33,flow1:1,flow5:5,flow20:3,ret3:2,ret5:4,ret20:12},
 {code:'5678',name:'乙',market:'上市',importance:'related',weight:.2,x:-4,flow1:-1,flow5:-2,flow20:-4,ret3:0,ret5:16,ret20:40}
];
let requests=[];
const fake={query:async(q,args=[])=>{requests.push([q,args]);if(q===SUMMARY_SQL)return mockRows;if(q===DETAIL_SQL)return detailRows;
 if(q.includes('market_w3_run_daily'))return [{trade_date:'2026-10-16',regime:'RiskOff',model_version:'W3-D.1.1'}];
 if(q===`SELECT trade_date,x_score,flow_5_pct,raw_y_5_pct FROM market_business_xy2_topic_daily WHERE tag_id=$1 ORDER BY trade_date DESC LIMIT 15`){return [
 {trade_date:'2026-10-16',x_score:30,flow_5_pct:4.3,raw_y_5_pct:1.4},
 {trade_date:'2026-10-15',x_score:28,flow_5_pct:2.9,raw_y_5_pct:0.9},
 {trade_date:'2026-10-14',x_score:26,flow_5_pct:2.4,raw_y_5_pct:0.4},
 {trade_date:'2026-10-13',x_score:21.6,flow_5_pct:1.8,raw_y_5_pct:0.2}];}
 if(q.includes('WHERE tag_id=$1 ORDER BY trade_date DESC LIMIT 1'))return [mockRows[0]];
 throw new Error('Unexpected SQL: '+q.slice(0,100));}};
(async()=>{
 const r=await getSummary(fake);assert.equal(r.sectors[0].x,30);assert.equal(r.sectors[0].breadthPct,69.2);assert.equal(r.sectors[0].momentum.key,'accelerating');assert.match(r.sectors[0].reading,/逆勢吸金/);
 const d=await getDetail('ai_server',fake);assert.equal(d.stocks.length,2);assert.equal(d.stocks[0].candidate,true);assert.equal(d.stocks[1].candidate,false);assert.equal(d.sector.dx3,8.4);assert.equal(d.sector.breadthPct,50);
 assert(requests.every(([q])=>!/^\s*(DELETE|UPDATE|INSERT)/i.test(q)));
 console.log('Capital Flow v2.6.8.0 PASS: X20 retained, breadth/candidates/W3, drill-down, zero DB writes, retired XY/9-state UI');
})().catch(e=>{console.error(e);process.exitCode=1;});
