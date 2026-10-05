'use strict';
const assert=require('node:assert/strict');
const { buildBusinessBrowserCatalog, buildCompanyMap } = require('../lib/fundflow-xy');
const { listMarketDefinitions } = require('../lib/market-topic-taxonomy');

const profiles = [
  { stock_code:'6488', stock_name:'環球晶', market:'上櫃', industry_code:'24', industry:'半導體業' },
  { stock_code:'3532', stock_name:'台勝科', market:'上市', industry_code:'24', industry:'半導體業' },
  { stock_code:'6182', stock_name:'合晶', market:'上櫃', industry_code:'24', industry:'半導體業' },
  { stock_code:'1101', stock_name:'台泥', market:'上市', industry_code:'01', industry:'水泥工業' },
  { stock_code:'6207', stock_name:'雷科', market:'上櫃', industry_code:'31', industry:'其他電子業' },
  { stock_code:'8027', stock_name:'鈦昇', market:'上櫃', industry_code:'05', industry:'電機機械' },
  { stock_code:'6781', stock_name:'AES-KY', market:'上市', industry_code:'28', industry:'電子零組件業' },
];
const snapshot={asOf:'2026-09-23',engineVersion:'test',groups:[{tagId:'wafer',name:'矽晶圓',parentName:'晶圓製造與製程',scope:'technology-fine',memberCount:3,validCount:3,flowValidCount:3,xAvailable:true,xyEligible:true,coveragePct:100,reliability:78,x:71.3,y:48.6,quadrant:'potential',status:'potential-rising',statusLabel:'潛伏升溫',trajectory:[{date:'2026-09-22',x:73.9,y:70.8,xAvailable:true},{date:'2026-09-23',x:71.3,y:48.6,xAvailable:true}],leaders:[{code:'3532',name:'台勝科'}]}]};

const out=buildBusinessBrowserCatalog(profiles,snapshot);
assert.equal(out.ok,true);
assert.equal(out.counts.totalDefinitions,191,'fallback Browser registry must be the final 191, not legacy 213');
assert.equal(listMarketDefinitions({finalOnly:true}).length,191);
const wafer=out.items.find(x=>x.tagId==='wafer');assert(wafer);assert.equal(wafer.companyCount,3);assert.equal(wafer.xyEligible,true);
const cement=out.items.find(x=>x.tagId==='cement');assert(cement);assert.equal(cement.companyCount,1);assert.equal(cement.xyEligible,false);
assert(!out.items.some(x=>x.tagId==='semiconductor_products_services'),'removed generic semiconductor-service tag must not reappear in Browser');
const glass=out.items.find(x=>x.tagId==='glass_substrate');assert(glass);assert(glass.companyCodes.includes('8027'));assert(!glass.companyCodes.includes('6207'));
const companyMap=buildCompanyMap(profiles);assert.equal(companyMap.byTopic.get('glass_substrate').companyCount,glass.companyCount);assert.equal(companyMap.stats.totalCompanies,profiles.length);
assert(out.items.find(x=>x.tagId==='bbu').companyNames.includes('AES-KY'));
assert(!out.items.some(x=>x.tagId==='wet_process_equipment'));

const frozenSnapshot={...snapshot,topicTaxonomyVersion:'taxonomy-2.3.0-final191'};
const frozenCatalog=buildBusinessBrowserCatalog(profiles,frozenSnapshot);
assert.equal(frozenCatalog.counts.totalDefinitions,frozenSnapshot.groups.length);
assert.deepEqual(frozenCatalog.items.map(x=>x.tagId),frozenSnapshot.groups.map(x=>x.tagId));
console.log('Fundflow business browser validation PASS — final 191 registry + Company_Map consistency');
