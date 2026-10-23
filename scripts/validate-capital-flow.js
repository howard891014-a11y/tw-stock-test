'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {getSummary,getDetail,observeState,SUMMARY_SQL,DETAIL_SQL,DETAIL_STOCK_MONEY_SQL}=require('../lib/capital-flow');
const {LOAD_SQL,VERSION}=require('../lib/capital-flow-money');
const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8'),client=fs.readFileSync('capital-flow.js','utf8');
for(const a of ['cfOverview','cfDetail','cfStockList','cfMetrics','cfReading','cfList','cfSearch','cfStockSort','cfDetailKPIs','cfCoreBreadth','cfObserveTitle','cfObserveDescription','cfSortExplanation','cfCombinationExplain','cfScopeSelect','cfSortSelect'])
 assert(html.includes(`id="${a}"`),'missing '+a);
assert(!html.includes('id="fundflowXySvg"'),'XY legacy UI returned');
assert(!html.includes('id="fundflowDetailCard"'),'old UI returned');
assert(app.includes('if(view==="fundflow"){window.StockZoneCapital?.load(false);}') ,'fundflow navigation contract broken');
assert(client.includes('/api/capital-flow?view=summary')&&client.includes('/api/capital-flow?view=detail'),'API routing broken');
const viewMarkup=html.slice(html.indexOf('<article class="detail-panel fundflow-page'),html.indexOf('<article class="card detail-panel sz-featured-panel'));
assert(viewMarkup.includes('產業資金觀察'));
assert(viewMarkup.includes('data-cf-filter="returning"')&&viewMarkup.includes('data-cf-filter="warning"'));
assert(viewMarkup.includes('你想觀察什麼？')&&viewMarkup.includes('資金回流｜觀察'));
assert(viewMarkup.includes('id="cfSortSelect"')&&viewMarkup.includes('id="cfScopeSelect"'));
assert(!viewMarkup.includes('data-cf-sort=')&&!viewMarkup.includes('data-cf-scope='),'old multi-row filter buttons returned');
assert(client.includes("filter:'returning',sort:'auto'"),'default must be capital return + mode-aware sorting');
for(const s of ['資金回流｜觀察','強勢延續｜觀察','轉弱警訊｜觀察','弱勢延續｜觀察','全部產業｜查看'])assert(client.includes(s),'missing specific mode explanation '+s);
assert(client.includes('cfSortExplanation')&&client.includes('cfCombinationExplain')&&client.includes('modeSortSentence'),'dynamic combo explanation missing');
assert(client.includes("state.sort='auto'"),'mode change must reset to mode-auto sorting');
assert(client.includes("state.filter==='warning'||state.filter==='weak'"),'negative flows must sort by magnitude, not descending signed value');
assert(viewMarkup.includes('data-cf-stock-filter="core"')&&viewMarkup.includes('data-cf-stock-filter="related"'));
assert(!viewMarkup.includes('資金先行')&&!viewMarkup.includes('id="cfStockCandidates"')&&!viewMarkup.includes('個股機會'));
assert(!client.includes('candidate')&&!client.includes('opportunityCount'),'candidate shortcut still active');
assert(!SUMMARY_SQL.includes('opportunity_count')&&!SUMMARY_SQL.includes('JOIN market_activity_daily'),'unnecessary candidate query survived');
for(const q of [SUMMARY_SQL,DETAIL_SQL,DETAIL_STOCK_MONEY_SQL]) {
 assert(/^\s*(WITH|SELECT)\b/i.test(q),'read model must use SELECT');
 assert(!/\b(DELETE|TRUNCATE|DROP|ALTER|UPDATE|INSERT)\b/i.test(q),'observation query cannot write to Neon');
}
for(const q of [
 [{x:5,money5E8:10,moneyCoreValid5:3},'aligned'],
 [{x:-2,money5E8:10,moneyCoreValid5:3},'returning'],
 [{x:5,money5E8:-10,moneyCoreValid5:3},'warning'],
 [{x:-1,money5E8:-10,moneyCoreValid5:3},'weak'],
 [{x:5,money5E8:0,moneyCoreValid5:3},'neutral'],
 [{x:5,money5E8:null,moneyCoreValid5:3},'unknown'],
 [{x:5,money5E8:10,moneyCoreValid5:0},'unknown']
]) assert.equal(observeState(q[0]).key,q[1]);
const mockRows=[{
 trade_date:'2026-10-16',tag_id:'ai_server',tag_name:'AI伺服器',parent_name:'科技',scope:'technology-fine',member_count:13,valid_count:13,
 x_score:30,flow_1_pct:2.1,flow_5_pct:4.3,flow_20_pct:6.3,raw_y_5_pct:1.4,dx3:8.4,
 breadth_valid:13,inflow_count:9,core_breadth_valid:9,core_inflow_count:7,breadth_pct:69.23,core_breadth_pct:77.77,coverage_pct:100,reliability_pct:100}];
const detailRows=[
 {code:'1234',name:'甲',market:'上市',importance:'core',weight:1,x:33,flow1:1,flow5:5,flow20:3,ret3:2,ret5:4,ret20:12},
 {code:'5678',name:'乙',market:'上市',importance:'related',weight:.2,x:-4,flow1:-1,flow5:-2,flow20:-4,ret3:0,ret5:16,ret20:40}
];
const moneyRow={trade_date:'2026-10-16',tag_id:'ai_server',flow_1_e8:'2',flow_5_e8:'40.2',core_5_e8:'36.0',related_5_e8:'4.2',core_valid_5:7,core_buy_5:6,core_sell_5:1};
const moneyRows=[moneyRow,...Array.from({length:197},(_,i)=>({...moneyRow,tag_id:'unused_'+i}))];
let requests=[];
const fake={query:async(q,args=[])=>{requests.push([q,args]);
 if(q===SUMMARY_SQL)return mockRows;
 if(q===DETAIL_SQL)return detailRows;
 if(q===DETAIL_STOCK_MONEY_SQL)return [
  {stock_code:'1234',market:'上市',raw_money_1_e8:'2',raw_money_5_e8:'8.5'},
  {stock_code:'5678',market:'上市',raw_money_1_e8:'-1',raw_money_5_e8:'-3.7'}];
 if(q===LOAD_SQL)return moneyRows;
 if(q.includes('market_w3_run_daily'))return [{trade_date:'2026-10-16',regime:'RiskOff',model_version:'W3-D.1.1'}];
 if(q===`SELECT trade_date,x_score,flow_5_pct,raw_y_5_pct FROM market_business_xy2_topic_daily WHERE tag_id=$1 ORDER BY trade_date DESC LIMIT 15`)return [
  {trade_date:'2026-10-16',x_score:30,flow_5_pct:4.3,raw_y_5_pct:1.4},
  {trade_date:'2026-10-15',x_score:28,flow_5_pct:2.9,raw_y_5_pct:0.9},
  {trade_date:'2026-10-14',x_score:26,flow_5_pct:2.4,raw_y_5_pct:0.4},
  {trade_date:'2026-10-13',x_score:21.6,flow_5_pct:1.8,raw_y_5_pct:0.2}];
 if(q.includes('WHERE tag_id=$1 ORDER BY trade_date DESC LIMIT 1'))return [mockRows[0]];
 throw new Error('Unexpected SQL: '+q.slice(0,140));}};
(async()=>{
 const r=await getSummary(fake);
 assert.equal(r.sectors[0].x,30);assert.equal(r.sectors[0].money5E8,40.2);
 assert.equal(r.sectors[0].observation.key,'aligned');assert.equal(r.sectors[0].momentum.key,'improving');
 assert.match(r.sectors[0].reading,/核心同方向 6\/7/);
 const d=await getDetail('ai_server',fake);
 assert.equal(d.stocks.length,2);assert.equal(d.stocks[0].money5RawE8,8.5);
 assert.equal(d.stocks[1].money5RawE8,-3.7);assert.equal(d.sector.dx3,8.4);
 assert.equal(d.sector.moneyCore5E8,36);assert.equal(d.sector.moneyRelated5E8,4.2);
 assert(!('candidate' in d.stocks[0]));
 assert(requests.every(([q])=>!/^\s*(DELETE|UPDATE|INSERT|ALTER)/i.test(q)));
 assert.equal(VERSION,'capital-money-corebreadth50-samecore100-v1','settled money model altered');
 console.log('Capital Flow v2.6.8.17 PASS: sector observation, four crossover states, company raw flows, no candidate picks, SELECT-only queries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
