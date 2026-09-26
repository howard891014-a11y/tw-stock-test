const assert=require('assert');
const fs=require('fs');
const {
  ENGINE_VERSION,NON_CORE_EXPOSURE_BUDGET,applyCompanyExposureBudget,
  enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries,
  empiricalMagnitudePercentile,applySelfRelativeX
}=require('../lib/fundflow-xy');

assert.equal(ENGINE_VERSION,'xy-5.0.0-self-relative-flow-price','self-relative XY v5 engine version mismatch');
assert.equal(NON_CORE_EXPOSURE_BUDGET,null,'v5 must not use a cross-topic exposure cap');

const links=applyCompanyExposureBudget([{id:'c',importance:'core'},{id:'i',importance:'important'},{id:'r',importance:'related'}]);
assert.deepStrictEqual(links.map(x=>x.weight),[1,.5,.2],'business relevance weights must stay literal 1/.5/.2');
assert(links.every(x=>x.exposureScale===1),'v5 must not dilute a topic because the company has other topics');

// Raw institutional flow foundation remains unchanged and independent of price/credit.
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
assert.equal(by.A.stockInstitutionalX,Math.round(by.A.inst_flow_ratio_5*1e4)/1e4,'stock raw X must equal 5D institutional flow ratio');
assert.equal(by.A.stockY,6,'stock Y must equal raw 5D return');
assert.equal(by.B.stockX,0);assert.equal(by.B.stockY,0);

function item({weight=1,flowPct=0,return5=0}={}){
  const turnover=1_000_000;
  return {weight,inst_flow_ratio_1:flowPct,inst_flow_ratio_5:flowPct,inst_flow_ratio_10:flowPct,inst_flow_ratio_20:flowPct,inst_flow_value_1:flowPct/100*turnover,inst_flow_value_5:flowPct/100*turnover,inst_flow_value_10:flowPct/100*turnover,inst_flow_value_20:flowPct/100*turnover,inst_turnover_value_1:turnover,inst_turnover_value_5:turnover,inst_turnover_value_10:turnover,inst_turnover_value_20:turnover,inst_streak:flowPct>0?5:flowPct<0?-5:0,inst_agreement:flowPct>0?100:flowPct<0?-100:0,creditCorrection:12,stockInstitutionalX:flowPct,stockY:return5,legacyStockX:50,change_pct:return5/5,return_3_pct:return5*.6,return_5_pct:return5,return_20_pct:return5*2};
}
const raw=summarizeTagItemsRaw([item({weight:1,flowPct:2,return5:6}),item({weight:.2,flowPct:-2,return5:-2})],{memberCount:2,totalWeight:1.2});
assert(Math.abs(raw.x-1.3333)<.001,'topic raw X must stay weighted net-flow/turnover ratio');
assert(Math.abs(raw.y-4.6667)<.001,'topic Y must stay business-weighted 5D return');
const normalized=normalizeTagSummaries([raw])[0];
assert.equal(normalized.x,raw.x,'pre-transform raw X must not be cross-sectionally ranked');
assert.equal(normalized.y,raw.y,'Y must not be percentile-ranked or stretched');
assert.equal(normalized.creditCorrection,12,'credit may stay diagnostic');
assert.equal(normalized.x,normalized.institutionalX,'credit must not modify raw institutional X');

// Signed self-relative transform: sign stays literal buy/sell; magnitude is causal own-history percentile.
assert.equal(Math.round(empiricalMagnitudePercentile(2,[1,2,3])),57,'empirical percentile sanity check changed unexpectedly');
const d=['d1','d2','d3','d4'];
const m=new Map(d.map(x=>[x,[]]));
[1,2,-3,.5].forEach((rawX,i)=>m.get(d[i]).push({tagId:'topic',rawX,x:rawX,y:0,factorSignals:{x:{}}}));
applySelfRelativeX(m,d,{lookback:60,minHistory:2});
assert.equal(m.get('d1')[0].x,0,'first point has no prior baseline and must remain neutral/warmup');
assert(m.get('d2')[0].x>0,'net buy must remain on right side');
assert(m.get('d3')[0].x<0&&Math.abs(m.get('d3')[0].x)<=100,'net sell must remain on left side and inside bounded scale');
assert(m.get('d4')[0].x>0&&m.get('d4')[0].x<25,'small positive buy must stay right but close to center');
assert.equal(m.get('d3')[0].rawX,-3,'self-relative transform must preserve raw X for audit');

// No look-ahead: adding a future extreme cannot change already-computed historical X.
const m2=new Map([...d,'d5'].map(x=>[x,[]]));
[1,2,-3,.5,100].forEach((rawX,i)=>m2.get([...d,'d5'][i]).push({tagId:'topic',rawX,x:rawX,y:0,factorSignals:{x:{}}}));
applySelfRelativeX(m2,[...d,'d5'],{lookback:60,minHistory:2});
assert.equal(m2.get('d3')[0].x,m.get('d3')[0].x,'future observation leaked into historical X');
assert.equal(m2.get('d4')[0].x,m.get('d4')[0].x,'future observation leaked into historical X');

const lib=fs.readFileSync('lib/fundflow-xy.js','utf8');
for(const token of ["ENGINE_VERSION = 'xy-5.0.0-self-relative-flow-price'","applySelfRelativeX","empiricalMagnitudePercentile","rawX","themeReturn5Pct","SELF_RELATIVE_LOOKBACK_DAYS = 60"])assert(lib.includes(token),`self-relative XY v5 rule missing: ${token}`);
assert(!lib.includes('const NON_CORE_EXPOSURE_BUDGET = 1.5'),'old exposure cap must remain removed');
console.log('Self-relative XY v5 validation PASS — X preserves literal buy/sell sign and uses only prior same-topic history for distance; Y remains raw 5D price return');
