const assert=require('assert');
const fs=require('fs');
const {ENGINE_VERSION,enrichFlowFeatures,scoreStocksForDate}=require('../lib/fundflow-xy');

assert.equal(ENGINE_VERSION,'xy-3.0.0-a-xv2-institutional-credit','formal X v2 engine version mismatch');

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
assert(by.A.stockInstitutionalX>by.B.stockInstitutionalX&&by.B.stockInstitutionalX>by.C.stockInstitutionalX,'institutional net flow must order formal X base');
assert(by.A.stockX>by.C.stockX,'formal X must preserve institutional direction after credit correction');
for(const x of scored){
  assert(x.creditCorrection>=-15&&x.creditCorrection<=15,'credit correction escaped ±15 cap');
  assert(Number.isFinite(x.legacyStockX),'legacy X baseline must remain available');
  assert(Number.isFinite(x.stockInstitutionalX),'institutional X must be finite');
}
assert(by.A.creditCorrection>0,'healthy institutional buy + price strength + margin digestion should add credit quality');
assert(by.C.creditCorrection<0,'institutional sell + price weakness + margin increase should subtract credit quality');

const lib=fs.readFileSync('lib/fundflow-xy.js','utf8');
for(const token of ['institutional_x_score','credit_correction','legacy_x_score','flow_breadth','flow_concentration_quality'])assert(lib.includes(token),`persisted X v2 field missing: ${token}`);
assert(lib.includes("LIMIT $1\n  `,[Math.max(trajectoryDays+20,trajectoryDays)]"),'X v2 must request rolling warmup dates');
assert(lib.includes("axes:{x:'法人淨資金流＋信用籌碼修正'"),'formal XY axis must expose X v2');

console.log('X v2 validation PASS — institutional net flow is formal X, credit is bounded ±15, legacy X retained only as baseline');
