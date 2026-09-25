const assert = require('assert');
const credit = require('../lib/credit-trading')._test;

const twseMargin = {
  stat:'OK',date:'20260924',tables:[{}, {data:[
    ['2330','台積電','10','4','1','100','105','1000','3','6','0','20','23','1000','2','']
  ]}]
};
const a = credit.parseTwseMargin(twseMargin,'2026-09-24')[0];
assert.equal(a.stock_code,'2330');
assert.equal(a.margin_balance,105000);
assert.equal(a.margin_prev_balance,100000);
assert.equal(a.short_balance,23000);
assert.equal(a.offsetting,2000);

const twseSbl = {stat:'OK',date:'20260924',data:[
  ['2330','台積電','20000','6000','3000','0','23000','1000000','800000','120000','30000','5000','895000','200000','']
]};
const b = credit.parseTwseSbl(twseSbl,'2026-09-24')[0];
assert.equal(b.sbl_prev_balance,800000);
assert.equal(b.sbl_sell,120000);
assert.equal(b.sbl_return,30000);
assert.equal(b.sbl_balance,895000);

const tpexMargin = {reportDate:'115/09/24',aaData:[
  ['6488','環球晶','50','8','4','1','53','0','2.5','2000','10','3','2','0','11','0','0.6','2000','1','']
]};
const c = credit.parseTpexMargin(tpexMargin,'2026-09-24')[0];
assert.equal(c.margin_balance,53000);
assert.equal(c.margin_usage_pct,2.5);
assert.equal(c.short_sell,3000);
assert.equal(c.short_buy,2000);

const tpexSbl = {reportDate:'115/09/24',aaData:[
  ['6488','環球晶','10000','3000','1000','0','12000','1000000','50000','9000','2000','-1000','56000','100000','']
]};
const d = credit.parseTpexSbl(tpexSbl,'2026-09-24')[0];
assert.equal(d.sbl_prev_balance,50000);
assert.equal(d.sbl_sell,9000);
assert.equal(d.sbl_return,2000);
assert.equal(d.sbl_adjustment,-1000);
assert.equal(d.sbl_balance,56000);

const merged = credit.mergeCreditRows([a],[b]);
assert.equal(merged.length,1);
assert.equal(merged[0].margin_balance,105000);
assert.equal(merged[0].sbl_balance,895000);

const rows = [
  {margin_balance:105,margin_prev_balance:100,short_balance:23,short_prev_balance:20,sbl_balance:90,sbl_prev_balance:80},
  {margin_balance:100,margin_prev_balance:98,short_balance:20,short_prev_balance:21,sbl_balance:80,sbl_prev_balance:82},
  {margin_balance:98,margin_prev_balance:99,short_balance:21,short_prev_balance:20,sbl_balance:82,sbl_prev_balance:80},
  {margin_balance:99,margin_prev_balance:97,short_balance:20,short_prev_balance:19,sbl_balance:80,sbl_prev_balance:79},
  {margin_balance:97,margin_prev_balance:96,short_balance:19,short_prev_balance:18,sbl_balance:79,sbl_prev_balance:78}
];
const p = credit.creditPeriods(rows);
assert.equal(p['1'].marginChange,5);
assert.equal(p['5'].marginChange,9);
assert.equal(p['5'].shortChange,5);
assert.equal(p['5'].sblChange,12);
assert.equal(p['10'].complete,false);

assert.throws(()=>credit.parseTwseMargin({...twseMargin,date:'20260923'},'2026-09-24'),/日期錯位/);
assert.throws(()=>credit.parseTpexMargin({...tpexMargin,reportDate:'115\/09\/23'},'2026-09-24'),/日期錯位/);

console.log('credit-trading validation PASS');
