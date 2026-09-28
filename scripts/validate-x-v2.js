const assert=require('assert');
const fs=require('fs');
const {
  ENGINE_VERSION,NON_CORE_EXPOSURE_BUDGET,STOCK_FLOW_POSITION_DAYS,STOCK_FLOW_MOMENTUM_DAYS,STOCK_FLOW_LOOKBACK_DAYS,STOCK_FLOW_MIN_HISTORY_DAYS,
  STOCK_FLOW_SCALE_FLOOR_PCT,TOPIC_SINGLE_STOCK_CAP,ACTIVATION_THRESHOLD_PCT,PATH_INFLUENCE,
  stockFlowScale,continuousStockFlowScore,capWeightShares,applyCompanyExposureBudget,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries
}=require('../lib/fundflow-xy');

assert.equal(ENGINE_VERSION,'xy-7.1.0-feature1-path1','XY v7.1 engine version mismatch');
assert.equal(NON_CORE_EXPOSURE_BUDGET,null,'retired cross-topic exposure cap must remain disabled');
assert.equal(STOCK_FLOW_POSITION_DAYS,20);assert.equal(STOCK_FLOW_MOMENTUM_DAYS,5);assert.equal(STOCK_FLOW_LOOKBACK_DAYS,20);assert.equal(STOCK_FLOW_MIN_HISTORY_DAYS,15);
assert.equal(ACTIVATION_THRESHOLD_PCT,.2);assert(PATH_INFLUENCE.institutional>PATH_INFLUENCE.activation&&PATH_INFLUENCE.activation>PATH_INFLUENCE.history,'Path influence order must be institutional > vote > history');
assert(STOCK_FLOW_SCALE_FLOOR_PCT>0&&TOPIC_SINGLE_STOCK_CAP>0&&TOPIC_SINGLE_STOCK_CAP<.5);

const links=applyCompanyExposureBudget([{id:'c',importance:'core'},{id:'i',importance:'important'},{id:'r',importance:'related'}]);
assert.deepStrictEqual(links.map(x=>x.weight),[1,.5,.2]);assert(links.every(x=>x.exposureScale===1));

const hist=Array(20).fill(.20),scale=stockFlowScale(hist);
const tinyP=continuousStockFlowScore(.02,15,scale),tinyN=continuousStockFlowScore(-.02,15,scale),normal=continuousStockFlowScore(.20,15,scale),extreme=continuousStockFlowScore(1.20,15,scale);
assert(tinyP>0&&tinyP<15);assert(tinyN<0&&tinyN>-15);assert(normal>25&&normal<65);assert(extreme>normal&&extreme<100);

function dates(n){const out=[];let d=new Date('2026-07-01T00:00:00Z');for(let i=0;i<n;i++){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
function row(d,code,net,change=.5){return {trade_date:d,stock_code:code,stock_name:code,market:'上市',trade_value:1_000_000,trade_volume:10_000,close_price:100,institutional_foreign_net:net*.6,institutional_trust_net:net*.25,institutional_dealer_net:net*.15,institutional_total_net:net,change_pct:change,return_3_pct:change*2,return_5_pct:change*3,return_20_pct:change*5,positive_days_5:change>0?4:1};}
const ds=dates(26);
// First 21 days heavy buy, last five days sell: X20 must stay right while 5D momentum is negative.
const regime=enrichFlowFeatures(ds.map((d,i)=>row(d,'A',i<21?1000:-500,i%2?.4:.6)));
const last=regime.at(-1);assert(last.inst_flow_ratio_20>0,'20D regime fixture should remain net-buy');assert(last.inst_flow_ratio_5<0,'5D momentum fixture should be net-sell');assert(last.stock_flow_score>0,'negative 5D must not flip a positive X20 regime');
const scored=scoreStocksForDate([last])[0];assert(scored.stockX>0&&scored.stockInstitutionalX>0,'X side must follow literal 20D flow sign');
// Future data cannot alter a historical X20.
const anchor=enrichFlowFeatures(ds.slice(0,25).map((d,i)=>row(d,'L',100)) ).at(-1);
const withFuture=enrichFlowFeatures([...ds.slice(0,25).map(d=>row(d,'L',100)),row(ds[25],'L',50000)]).find(x=>x.trade_date===anchor.trade_date);
assert.equal(anchor.stock_flow_score,withFuture.stock_flow_score,'future observation leaked into historical X20');
assert(anchor.stock_flow_history_days>=15&&anchor.stock_flow_history_days<=20,'X20 robust scale must use bounded prior 5D windows');

function item({score=30,raw20=.4,raw5=.2,raw1=.2,turnover=1_000_000,weight=1,reliability=1,ret=1,change=.5,importance='core'}={}){
  return {weight,importance,stockFlowScore:score,stockX:score,inst_flow_ratio_1:raw1,inst_flow_ratio_5:raw5,inst_flow_ratio_10:raw20,inst_flow_ratio_20:raw20,
    inst_turnover_value_1:turnover,inst_turnover_value_5:turnover,inst_turnover_value_10:turnover,inst_turnover_value_20:turnover,
    stock_flow_reliability:reliability,stock_flow_history_days:20,stock_flow_maturity_pct:100,inst_agreement:100,inst_streak:3,
    change_pct:change,return_3_pct:ret*.6,return_5_pct:ret,return_20_pct:ret*2,positive_days_5:ret>0?4:1,creditCorrection:0,legacyStockX:50,stockY:ret};
}
// Topic X remains X20 even when short-term 5D flow reverses.
const shortWeak=summarizeTagItemsRaw([item({score:55,raw20:.7,raw5:-.5,raw1:-.8}),item({score:35,raw20:.3,raw5:-.2,raw1:-.4})],{memberCount:2,totalWeight:2});
assert(shortWeak.x>0&&shortWeak.rawX>0,'20D net-buy topic must stay on right');assert(shortWeak.themeFlow5Pct<0,'5D sell pressure must remain separately visible');

// Equal-company activation: large weights cannot buy extra votes; only daily % > +0.2 counts.
const twoActive=[item({change:5,weight:10}),item({change:4,weight:8}),...Array.from({length:8},()=>item({change:-1,weight:.2}))];
const vote20=summarizeTagItemsRaw(twoActive,{memberCount:10,totalWeight:19.6});assert.equal(vote20.activationRate,20);assert.equal(vote20.confirmation,20);
const eightActive=[...Array.from({length:8},()=>item({change:.3})),item({change:.2}),item({change:-.1})];
const vote80=summarizeTagItemsRaw(eightActive,{memberCount:10,totalWeight:10});assert.equal(vote80.activationRate,80,'+0.2 exactly is 0 vote; only > +0.2 activates');
assert.equal(vote80.strongCount,8);assert.equal(vote80.sellBreadth,0,'price vote is 1/0, never -1');

// One huge-turnover stock cannot own topic X, while voting remains equal-company.
const cappedItems=[item({score:90,raw20:5,turnover:1_000_000_000,change:5}),...Array.from({length:7},()=>item({score:-20,raw20:-.2,turnover:1_000_000,change:-1}))];
const capped=summarizeTagItemsRaw(cappedItems,{memberCount:8,totalWeight:8});assert(capped.topFlowSharePct<=25.01);assert(capped.x<20);assert.equal(capped.activationRate,12.5);

// Missing institutional flow abstains from X but valid price remains in activation denominator.
const missing={...item({change:.4}),stockFlowScore:null,stockX:null,inst_flow_ratio_1:null,inst_flow_ratio_5:null,inst_flow_ratio_10:null,inst_flow_ratio_20:null,stock_flow_reliability:0};
const withMissing=summarizeTagItemsRaw([item({score:35,raw20:.3,change:.4}),missing],{memberCount:2,totalWeight:2});assert.equal(withMissing.flowValidCount,1);assert.equal(withMissing.activationRate,100);assert(withMissing.dataCompleteness<100);

// Y remains literal business-weighted 5D return; normalization cannot rewrite either axis.
const yRaw=summarizeTagItemsRaw([item({score:30,raw20:.3,ret:6,weight:1}),item({score:-20,raw20:-.2,ret:-2,weight:.5})],{memberCount:2,totalWeight:1.5});
assert(Math.abs(yRaw.y-3.3333)<.01);const norm=normalizeTagSummaries([yRaw])[0];assert.equal(norm.x,yRaw.x);assert.equal(norm.y,yRaw.y);

const shares=capWeightShares([{baseWeight:1000},...Array.from({length:7},()=>({baseWeight:1}))]);assert(Math.abs(shares.reduce((a,b)=>a+b,0)-1)<1e-9);assert(Math.max(...shares)<=.2500001);

const lib=fs.readFileSync('lib/fundflow-xy.js','utf8');
for(const token of ["ENGINE_VERSION = 'xy-7.0.0-x20-y5-activation-causal-path'",'STOCK_FLOW_POSITION_DAYS = 20','ACTIVATION_THRESHOLD_PCT = 0.2','topicActivationMetrics','inst_flow_ratio_20','rawSide*Math.abs(robustAggregate)','PATH_INFLUENCE = Object.freeze({ institutional:0.50, activation:0.30, history:0.20 })'])assert(lib.includes(token),`XY v7 rule missing: ${token}`);
for(const old of ['applySelfRelativeX','empiricalMagnitudePercentile'])assert(!lib.includes(old),`retired topic-percentile transform still present: ${old}`);
console.log('XY v7 validation PASS — X20 regime + 5D/1D motion + equal-company >0.2% price activation + Y5 literal return');
