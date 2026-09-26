const assert=require('assert');
const fs=require('fs');
const {ENGINE_VERSION,NON_CORE_EXPOSURE_BUDGET,applyCompanyExposureBudget,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries}=require('../lib/fundflow-xy');

assert.equal(ENGINE_VERSION,'xy-3.2.0-a-xv2-exposure-budget','formal X v2.2 engine version mismatch');
assert.equal(NON_CORE_EXPOSURE_BUDGET,1.5,'non-core exposure budget mismatch');


// Company exposure budget: core stays intact; only important/related total is capped at 1.5.
const wideLinks=[{id:'core',importance:'core'},...Array.from({length:5},(_,i)=>({id:`important${i}`,importance:'important'})),...Array.from({length:3},(_,i)=>({id:`related${i}`,importance:'related'}))];
const budgeted=applyCompanyExposureBudget(wideLinks);
const coreLink=budgeted.find(x=>x.importance==='core'),nonCore=budgeted.filter(x=>x.importance!=='core');
assert.equal(coreLink.weight,1,'core exposure must not be diluted');
assert(Math.abs(nonCore.reduce((s,x)=>s+x.weight,0)-1.5)<1e-9,'important+related exposure must cap at 1.5');
assert(nonCore.find(x=>x.importance==='important').weight>nonCore.find(x=>x.importance==='related').weight,'importance ordering must survive exposure scaling');
const compact=applyCompanyExposureBudget([{id:'c',importance:'core'},{id:'i',importance:'important'}]);
assert.equal(compact[0].weight,1);assert.equal(compact[1].weight,.5,'normal companies below budget must remain unchanged');

// Stock-level institutional flow + bounded credit correction stays available as diagnostics.
const rows=[];
const dates=Array.from({length:20},(_,i)=>`2026-08-${String(i+3).padStart(2,'0')}`);
const specs=[
  {code:'A',flow:6000,foreign:3500,trust:1800,dealer:700,margin0:120000,marginStep:-500,short0:10000,shortStep:150,sbl0:25000,sblStep:-120,price:105,ret5:6},
  {code:'B',flow:0,foreign:0,trust:0,dealer:0,margin0:80000,marginStep:0,short0:8000,shortStep:0,sbl0:15000,sblStep:0,price:100,ret5:0},
  {code:'C',flow:-6000,foreign:-3500,trust:-1800,dealer:-700,margin0:90000,marginStep:600,short0:9000,shortStep:-100,sbl0:18000,sblStep:160,price:95,ret5:-6},
];
for(let di=0;di<dates.length;di++)for(const s of specs){
  const margin=s.margin0+s.marginStep*di,short=s.short0+s.shortStep*di,sbl=s.sbl0+s.sblStep*di;
  rows.push({trade_date:dates[di],stock_code:s.code,stock_name:s.code,market:'上市',trade_value:2_000_000,trade_volume:20_000,close_price:s.price,
    institutional_foreign_net:s.foreign,institutional_trust_net:s.trust,institutional_dealer_net:s.dealer,institutional_total_net:s.flow,
    margin_prev_balance:margin-s.marginStep,margin_balance:margin,short_prev_balance:short-s.shortStep,short_balance:short,sbl_prev_balance:sbl-s.sblStep,sbl_balance:sbl,
    value_ratio_20:s.code==='A'?2:s.code==='C'?.5:1,value_trend_5_15:s.code==='A'?1.5:s.code==='C'?.7:1,
    change_pct:s.ret5/5,return_3_pct:s.ret5*.6,return_5_pct:s.ret5,return_20_pct:s.ret5*2,positive_days_5:s.ret5>0?5:s.ret5<0?0:2.5});
}
const enriched=enrichFlowFeatures(rows);
const latest=dates.at(-1),today=enriched.filter(x=>x.trade_date===latest),scored=scoreStocksForDate(today);
const by=Object.fromEntries(scored.map(x=>[x.stock_code,x]));
assert(by.A.inst_flow_ratio_5>0&&by.C.inst_flow_ratio_5<0,'rolling institutional flow direction wrong');
assert(by.A.stockInstitutionalX>by.B.stockInstitutionalX&&by.B.stockInstitutionalX>by.C.stockInstitutionalX,'stock diagnostic institutional ranking wrong');
assert(by.A.stockX>by.C.stockX,'stock diagnostic X must preserve institutional direction after credit correction');
for(const x of scored){
  assert(x.creditCorrection>=-15&&x.creditCorrection<=15,'credit correction escaped ±15 cap');
  assert(Number.isFinite(x.legacyStockX),'legacy X baseline must remain available');
  assert(Number.isFinite(x.stockInstitutionalX),'institutional X must be finite');
  assert(Number.isFinite(x.inst_flow_value_20)||x.inst_flow_ratio_20===null,'rolling institutional flow value must be retained for topic aggregation');
}
assert(by.A.creditCorrection>0,'healthy institutional buy + price strength + margin digestion should add credit quality');
assert(by.C.creditCorrection<0,'institutional sell + price weakness + margin increase should subtract credit quality');

function item({weight=1,flow=0,streak=0,agreement=0,credit=0}={}){
  return {weight,inst_flow_ratio_1:flow,inst_flow_ratio_5:flow,inst_flow_ratio_10:flow,inst_flow_ratio_20:flow,inst_flow_value_5:flow*1_000_000,
    inst_streak:streak,inst_agreement:agreement,creditCorrection:credit,stockInstitutionalX:50,stockY:50,legacyStockX:50,change_pct:0};
}
// Core must materially outweigh a merely-related company. Equal and opposite signals stay positive because 1.0 >> 0.2.
const strongRaw=summarizeTagItemsRaw([item({weight:1,flow:2,streak:5,agreement:100}),item({weight:.2,flow:-2,streak:-5,agreement:-100})],{memberCount:2,totalWeight:1.2});
const neutralRaw=summarizeTagItemsRaw([item({weight:1,flow:0,streak:0,agreement:0})],{memberCount:1,totalWeight:1});
const weakRaw=summarizeTagItemsRaw([item({weight:1,flow:-2,streak:-5,agreement:-100}),item({weight:.2,flow:2,streak:5,agreement:100})],{memberCount:2,totalWeight:1.2});
assert(strongRaw.themeFlow5Pct>1,'core business flow must dominate opposite related-company flow');
assert(weakRaw.themeFlow5Pct<-1,'core negative flow must dominate opposite related-company flow');
const normalized=normalizeTagSummaries([strongRaw,neutralRaw,weakRaw]);
assert(normalized[0].institutionalX>=70,'strong topic should not collapse near 50 after topic-first normalization');
assert(normalized[2].institutionalX<=30,'weak topic should not collapse near 50 after topic-first normalization');
assert(normalized[0].institutionalX-normalized[2].institutionalX>=40,'topic X dispersion is too compressed');

// Reliability/coverage should live in confidence; only genuinely severe (<20%) institutional coverage may neutralize X.
const sparseStrong={...strongRaw,flowCoveragePct:10};
const sparse=normalizeTagSummaries([sparseStrong,neutralRaw,weakRaw])[0];
assert(Math.abs(sparse.institutionalX-50)<Math.abs(normalized[0].institutionalX-50),'severe flow-data shortage must still shrink X toward neutral');

const lib=fs.readFileSync('lib/fundflow-xy.js','utf8');
for(const token of ['institutional_x_score','credit_correction','legacy_x_score','flow_breadth','flow_concentration_quality'])assert(lib.includes(token),`persisted X v2 field missing: ${token}`);
for(const token of ["core:1, important:0.5, related:0.2","NON_CORE_EXPOSURE_BUDGET = 1.5","applyCompanyExposureBudget","normalizeTagSummaries","themeFlow5Pct","flowCoveragePct)??0)/20"])assert(lib.includes(token),`X v2.2 topic-first/exposure-budget rule missing: ${token}`);
assert(lib.includes("LIMIT $1\n  `,[Math.max(trajectoryDays+20,trajectoryDays)]"),'X v2 must request rolling warmup dates');
assert(lib.includes("axes:{x:'法人淨資金流＋信用籌碼修正'"),'formal XY axis must expose X v2');

console.log('X v2.2 validation PASS — topic-first institutional flow, core kept intact, non-core exposure capped at 1.5, credit ±15, dispersion preserved');
