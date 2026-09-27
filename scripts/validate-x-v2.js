const assert=require('assert');
const fs=require('fs');
const {
  ENGINE_VERSION,NON_CORE_EXPOSURE_BUDGET,STOCK_FLOW_LOOKBACK_DAYS,STOCK_FLOW_MIN_HISTORY_DAYS,
  STOCK_FLOW_SCALE_FLOOR_PCT,TOPIC_SINGLE_STOCK_CAP,VOTE_NEUTRAL_SCORE,
  stockFlowScale,continuousStockFlowScore,capWeightShares,
  applyCompanyExposureBudget,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries
}=require('../lib/fundflow-xy');

assert.equal(ENGINE_VERSION,'xy-6.0.0-stock-robust-flow-price','XY v6 engine version mismatch');
assert.equal(NON_CORE_EXPOSURE_BUDGET,null,'v6 must not use the retired cross-topic exposure cap');
assert.equal(STOCK_FLOW_LOOKBACK_DAYS,60);assert.equal(STOCK_FLOW_MIN_HISTORY_DAYS,20);
assert(STOCK_FLOW_SCALE_FLOOR_PCT>0&&TOPIC_SINGLE_STOCK_CAP>0&&TOPIC_SINGLE_STOCK_CAP<.5&&VOTE_NEUTRAL_SCORE>0);

// Business relevance stays literal; topic aggregation later adds sqrt-liquidity/reliability and a stock cap.
const links=applyCompanyExposureBudget([{id:'c',importance:'core'},{id:'i',importance:'important'},{id:'r',importance:'related'}]);
assert.deepStrictEqual(links.map(x=>x.weight),[1,.5,.2]);
assert(links.every(x=>x.exposureScale===1));

// Continuous own-history mapping: sign is literal buy/sell, small flow stays near centre,
// ordinary flow is moderate, and only truly large flow approaches the boundary.
const hist=Array(40).fill(.20);
const scale=stockFlowScale(hist);
const tinyP=continuousStockFlowScore(.02,40,scale),tinyN=continuousStockFlowScore(-.02,40,scale);
const normal=continuousStockFlowScore(.20,40,scale),extreme=continuousStockFlowScore(1.20,40,scale);
assert(tinyP>0&&tinyP<15,'small true buy should stay close to centre');
assert(tinyN<0&&tinyN>-15,'small true sell should stay close to centre');
assert(normal>25&&normal<65,'normal own-history flow should map to a moderate X');
assert(extreme>normal&&extreme<100,'large own-history flow should move farther without hard percentile jumps');
assert(Math.abs(tinyP-tinyN)<30,'tiny sign flip must not create a ±80/±90 route jump');

function dates(n){const out=[];let d=new Date('2026-07-01T00:00:00Z');for(let i=0;i<n;i++){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}return out;}
function flowRows(n=45,{futureExtreme=false}={}){
  const ds=dates(n),rows=[];
  for(let i=0;i<ds.length;i++){
    const flow=futureExtreme&&i===ds.length-1?20000:100;
    rows.push({trade_date:ds[i],stock_code:'A',stock_name:'A',market:'上市',trade_value:1_000_000,trade_volume:10_000,close_price:100,
      institutional_foreign_net:flow*.6,institutional_trust_net:flow*.25,institutional_dealer_net:flow*.15,institutional_total_net:flow,
      change_pct:.2,return_3_pct:.5,return_5_pct:1,return_20_pct:2,positive_days_5:4});
  }
  return rows;
}
// No look-ahead: appending a future extreme may not alter an already-computed historical stock X.
const base=enrichFlowFeatures(flowRows(44)),extended=enrichFlowFeatures(flowRows(45,{futureExtreme:true}));
const anchor=base[40],same=extended.find(x=>x.trade_date===anchor.trade_date);
assert(anchor&&same);assert.equal(anchor.stock_flow_score,same.stock_flow_score,'future observation leaked into historical stock X');
assert(anchor.stock_flow_history_days<=60&&anchor.stock_flow_history_days>=20,'stock X should use rolling prior history');

const latest=enrichFlowFeatures([
  ...flowRows(45),
  ...dates(45).map((d,i)=>({trade_date:d,stock_code:'B',stock_name:'B',market:'上市',trade_value:1_000_000,trade_volume:10_000,close_price:100,
    institutional_foreign_net:-60,institutional_trust_net:-25,institutional_dealer_net:-15,institutional_total_net:-100,
    change_pct:-.1,return_3_pct:-.3,return_5_pct:-.8,return_20_pct:-1,positive_days_5:1})),
  ...dates(45).map(d=>({trade_date:d,stock_code:'M',stock_name:'M',market:'上市',trade_value:1_000_000,trade_volume:10_000,close_price:100,
    institutional_foreign_net:null,institutional_trust_net:null,institutional_dealer_net:null,institutional_total_net:null,
    change_pct:.1,return_3_pct:.2,return_5_pct:.4,return_20_pct:.8,positive_days_5:3}))
]);
const lastDate=dates(45).at(-1),scored=scoreStocksForDate(latest.filter(x=>x.trade_date===lastDate)),by=Object.fromEntries(scored.map(x=>[x.stock_code,x]));
assert(by.A.stockX>0&&by.A.stockInstitutionalX>0,'true institutional buy must remain on right');
assert(by.B.stockX<0&&by.B.stockInstitutionalX<0,'true institutional sell must remain on left');
assert.equal(by.M.stockX,null,'missing institutional flow must abstain, not become fake zero');

// Topic aggregation: one huge-turnover stock cannot own the whole topic.
function item({score,raw,turnover=1_000_000,weight=1,reliability=1,ret=0,importance='core'}={}){
  return {weight,importance,stockFlowScore:score,stockX:score,inst_flow_ratio_1:raw,inst_flow_ratio_5:raw,inst_flow_ratio_10:raw,inst_flow_ratio_20:raw,
    inst_turnover_value_1:turnover,inst_turnover_value_5:turnover,inst_turnover_value_10:turnover,inst_turnover_value_20:turnover,
    stock_flow_reliability:reliability,stock_flow_history_days:40,stock_flow_maturity_pct:100,inst_agreement:raw>0?100:raw<0?-100:0,inst_streak:raw>0?5:raw<0?-5:0,
    change_pct:ret/5,return_3_pct:ret*.6,return_5_pct:ret,return_20_pct:ret*2,positive_days_5:ret>0?4:ret<0?1:2.5,creditCorrection:0,legacyStockX:50,stockY:ret};
}
const cappedItems=[item({score:90,raw:5,turnover:1_000_000_000}),...Array.from({length:7},()=>item({score:-20,raw:-.2,turnover:1_000_000}))];
const capped=summarizeTagItemsRaw(cappedItems,{memberCount:8,totalWeight:8});
assert(capped.topFlowSharePct<=25.01,'large-cap stock exceeded topic X cap');
assert(capped.x<20,'one huge-turnover positive stock should not dominate seven negative members');

// Voting is Confirmation, not X: same stock-strength average can have different consensus quality.
const consensus=summarizeTagItemsRaw([item({score:40,raw:.4}),item({score:40,raw:.4}),item({score:40,raw:.4})],{memberCount:3,totalWeight:3});
const split=summarizeTagItemsRaw([item({score:90,raw:.9}),item({score:30,raw:.3}),item({score:-80,raw:-.8})],{memberCount:3,totalWeight:3});
assert(consensus.confirmation>split.confirmation,'C should reward member agreement instead of contaminating X');
assert(consensus.flowBreadth>split.flowBreadth,'buy vote breadth should be separate from X');

// Missing member abstains and reduces reliability/coverage rather than voting neutral.
const missing={...item({score:0,raw:0}),stockFlowScore:null,stockX:null,inst_flow_ratio_1:null,inst_flow_ratio_5:null,inst_flow_ratio_10:null,inst_flow_ratio_20:null,stock_flow_reliability:0};
const withMissing=summarizeTagItemsRaw([item({score:35,raw:.3}),missing],{memberCount:2,totalWeight:2});
assert(withMissing.flowValidCount===1);assert(withMissing.abstainBreadth>=49,'missing flow should be an abstain');assert(withMissing.reliability<consensus.reliability,'missing flow should lower reliability');

// Y stays literal business-weighted 5D return and normalization must not alter either axis.
const yRaw=summarizeTagItemsRaw([item({score:30,raw:.3,ret:6,weight:1}),item({score:-20,raw:-.2,ret:-2,weight:.5})],{memberCount:2,totalWeight:1.5});
assert(Math.abs(yRaw.y-3.3333)<.01,'Y must remain literal business-weighted 5D return');
const norm=normalizeTagSummaries([yRaw])[0];assert.equal(norm.x,yRaw.x);assert.equal(norm.y,yRaw.y);assert.equal(norm.creditCorrection,yRaw.creditCorrection);

// Weight helper itself remains normalized and capped.
const shares=capWeightShares([{baseWeight:1000},...Array.from({length:7},()=>({baseWeight:1}))]);
assert(Math.abs(shares.reduce((a,b)=>a+b,0)-1)<1e-9);assert(Math.max(...shares)<=.2500001);

const lib=fs.readFileSync('lib/fundflow-xy.js','utf8');
for(const token of ["ENGINE_VERSION = 'xy-6.0.0-stock-robust-flow-price'",'continuousStockFlowScore','Math.tanh','Math.sqrt(turnover/medTurnover)','TOPIC_SINGLE_STOCK_CAP','abstainBreadth','flowValidCount'])assert(lib.includes(token),`XY v6 rule missing: ${token}`);
for(const old of ['applySelfRelativeX','empiricalMagnitudePercentile'])assert(!lib.includes(old),`retired topic-percentile transform still present: ${old}`);
assert(!lib.includes('const NON_CORE_EXPOSURE_BUDGET = 1.5'),'old exposure cap must remain removed');
console.log('Stock-first robust XY v6 validation PASS — Y raw price; X stock-first causal robust flow; capped aggregation; voting in C; missing abstains');
