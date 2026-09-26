const assert=require('assert');
const fs=require('fs');
const {ENGINE_VERSION,NON_CORE_EXPOSURE_BUDGET,applyCompanyExposureBudget,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries}=require('../lib/fundflow-xy');

assert.equal(ENGINE_VERSION,'xy-4.0.0-raw-flow-price','raw XY v4 engine version mismatch');
assert.equal(NON_CORE_EXPOSURE_BUDGET,null,'v4 must not use a cross-topic exposure cap');

const links=applyCompanyExposureBudget([{id:'c',importance:'core'},{id:'i',importance:'important'},{id:'r',importance:'related'}]);
assert.deepStrictEqual(links.map(x=>x.weight),[1,.5,.2],'business relevance weights must stay literal 1/.5/.2');
assert(links.every(x=>x.exposureScale===1),'v4 must not dilute a topic because the company has other topics');

const rows=[];
const dates=Array.from({length:20},(_,i)=>`2026-08-${String(i+3).padStart(2,'0')}`);
const specs=[
  {code:'A',flow:6000,foreign:3500,trust:1800,dealer:700,price:105,ret5:6},
  {code:'B',flow:0,foreign:0,trust:0,dealer:0,price:100,ret5:0},
  {code:'C',flow:-6000,foreign:-3500,trust:-1800,dealer:-700,price:95,ret5:-6},
];
for(let di=0;di<dates.length;di++)for(const s of specs)rows.push({trade_date:dates[di],stock_code:s.code,stock_name:s.code,market:'上市',trade_value:2_000_000,trade_volume:20_000,close_price:s.price,institutional_foreign_net:s.foreign,institutional_trust_net:s.trust,institutional_dealer_net:s.dealer,institutional_total_net:s.flow,change_pct:s.ret5/5,return_3_pct:s.ret5*.6,return_5_pct:s.ret5,return_20_pct:s.ret5*2,positive_days_5:s.ret5>0?5:s.ret5<0?0:2.5});
const enriched=enrichFlowFeatures(rows),latest=dates.at(-1),today=enriched.filter(x=>x.trade_date===latest),scored=scoreStocksForDate(today),by=Object.fromEntries(scored.map(x=>[x.stock_code,x]));
assert(by.A.inst_flow_ratio_5>0&&by.C.inst_flow_ratio_5<0,'institutional raw flow direction wrong');
assert.equal(by.A.stockInstitutionalX,Math.round(by.A.inst_flow_ratio_5*1e4)/1e4,'stock X must equal raw 5D institutional flow ratio');
assert.equal(by.A.stockY,6,'stock Y must equal raw 5D return');
assert.equal(by.B.stockX,0);assert.equal(by.B.stockY,0);

function item({weight=1,flowPct=0,return5=0}={}){
  const turnover=1_000_000;
  return {weight,inst_flow_ratio_1:flowPct,inst_flow_ratio_5:flowPct,inst_flow_ratio_10:flowPct,inst_flow_ratio_20:flowPct,inst_flow_value_1:flowPct/100*turnover,inst_flow_value_5:flowPct/100*turnover,inst_flow_value_10:flowPct/100*turnover,inst_flow_value_20:flowPct/100*turnover,inst_turnover_value_1:turnover,inst_turnover_value_5:turnover,inst_turnover_value_10:turnover,inst_turnover_value_20:turnover,inst_streak:flowPct>0?5:flowPct<0?-5:0,inst_agreement:flowPct>0?100:flowPct<0?-100:0,creditCorrection:12,stockInstitutionalX:flowPct,stockY:return5,legacyStockX:50,change_pct:return5/5,return_3_pct:return5*.6,return_5_pct:return5,return_20_pct:return5*2};
}
const raw=summarizeTagItemsRaw([item({weight:1,flowPct:2,return5:6}),item({weight:.2,flowPct:-2,return5:-2})],{memberCount:2,totalWeight:1.2});
// (1*+2% + .2*-2%) / (1+.2) = +1.333...% because equal turnover values are weighted by topic relevance.
assert(Math.abs(raw.x-1.3333)<.001,'topic X must be literal weighted net-flow/turnover ratio');
assert(Math.abs(raw.y-4.6667)<.001,'topic Y must be literal business-weighted 5D return');
const normalized=normalizeTagSummaries([raw])[0];
assert.equal(normalized.x,raw.x,'normalization must not percentile-rank or stretch X');
assert.equal(normalized.y,raw.y,'normalization must not percentile-rank or stretch Y');
assert.equal(normalized.creditCorrection,12,'credit may stay diagnostic');
assert.equal(normalized.x,normalized.institutionalX,'credit must not modify X');

const sparse={...raw,flowCoveragePct:5,x:2,rawX:2,themeFlow5Pct:2,y:5,rawY:5,themeReturn5Pct:5};
const sparseOut=normalizeTagSummaries([sparse])[0];
assert.equal(sparseOut.x,2,'low coverage must not pull measured X toward neutral');
assert.equal(sparseOut.y,5,'low coverage must not pull measured Y toward neutral');

const lib=fs.readFileSync('lib/fundflow-xy.js','utf8');
for(const token of ["ENGINE_VERSION = 'xy-4.0.0-raw-flow-price'","themeFlow5Pct","themeReturn5Pct","flow/turnover*100","x:round(x,4),rawX:round(x,4)","y:round(y,4),rawY:round(y,4)"])assert(lib.includes(token),`raw XY v4 rule missing: ${token}`);
assert(!lib.includes('const NON_CORE_EXPOSURE_BUDGET = 1.5'),'old exposure cap must be removed');
console.log('Raw XY v4 validation PASS — X=5D institutional net-flow/turnover, Y=5D price return, 0-centered, no percentile/credit/EMA coordinate correction');
