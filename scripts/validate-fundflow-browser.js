const assert = require('assert');
const { buildBusinessBrowserCatalog } = require('../lib/fundflow-xy');
const { listVoteEligible } = require('../lib/business-tags');

const profiles = [
  { stock_code:'6488', stock_name:'環球晶', market:'上櫃', industry_code:'24', industry:'半導體業' },
  { stock_code:'3532', stock_name:'台勝科', market:'上市', industry_code:'24', industry:'半導體業' },
  { stock_code:'6182', stock_name:'合晶', market:'上櫃', industry_code:'24', industry:'半導體業' },
  { stock_code:'1101', stock_name:'台泥', market:'上市', industry_code:'01', industry:'水泥工業' },
];

const snapshot = {
  asOf:'2026-09-23',
  engineVersion:'xy-1.0.0',
  groups:[{
    tagId:'wafer', name:'矽晶圓', parentName:'晶圓製造與製程', scope:'technology-fine',
    memberCount:3, validCount:3, coveragePct:100, reliability:78,
    x:71.3, y:48.6, quadrant:'potential', status:'potential-rising', statusLabel:'潛伏升溫',
    dx3:10.1, dy3:-27.1, trajectory:[{date:'2026-09-22',x:73.9,y:70.8},{date:'2026-09-23',x:71.3,y:48.6}],
    leaders:[{code:'3532',name:'台勝科'}]
  }]
};

const out = buildBusinessBrowserCatalog(profiles, snapshot);
assert.equal(out.ok, true);
assert.equal(out.counts.totalDefinitions, listVoteEligible().length, '應列出完整可投票業務定義');
assert.equal(out.asOf, '2026-09-23');

const wafer = out.items.find(x=>x.tagId==='wafer');
assert(wafer, '應包含矽晶圓');
assert.equal(wafer.companyCount, 3, '矽晶圓應映射 3 家 fixture 公司');
assert.equal(wafer.xyEligible, true, '矽晶圓應有可用 XY');
assert.equal(wafer.scope, 'technology-fine');
assert.equal(wafer.quadrant, 'potential');

const cement = out.items.find(x=>x.tagId==='cement');
assert(cement, '應包含傳產粗分類水泥');
assert.equal(cement.scope, 'traditional-coarse');
assert.equal(cement.companyCount, 1);
assert.equal(cement.xyEligible, false);
assert(/1 家/.test(cement.noXYReason), '單一公司應標記未成群');

const zero = out.items.find(x=>x.companyCount===0);
assert(zero, '完整瀏覽器應保留目前 0 家公司的業務定義');
assert.equal(zero.noXYReason, '尚無公司映射');

assert(out.counts.technologyFineDefinitions > 0);
assert(out.counts.traditionalDefinitions > 0);
assert(out.counts.withXY >= 1);
console.log(`Fundflow business browser validation PASS — ${out.counts.totalDefinitions} definitions, ${out.counts.technologyFineDefinitions} tech-fine`);
