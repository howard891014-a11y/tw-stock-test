'use strict';
// Offline release gate; does not connect to or modify Neon.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const freeze=require('../lib/final-taxonomy-freeze');
const taxonomy=require('../lib/market-topic-taxonomy');
const xy=require('../lib/fundflow-xy');
const defs=freeze.listDefinitions();
assert.equal(taxonomy.version,'2.3.1-final203');
assert.equal(freeze.STATS.taxonomyCount,203);
assert.equal(defs.length,203);
assert.equal(new Set(defs.map(t=>t.id)).size,203);
assert.equal(new Set(defs.map(t=>t.name)).size,203);
assert.equal(freeze.STATS.membershipEdges,3440);
assert.equal(freeze.STATS.coreEdges,2376);
assert.equal(freeze.STATS.relatedEdges,1064);
assert.equal(freeze.STATS.companyUniverseCount,1988);
assert.equal(freeze.STATS.taggedCompanyCount,1981);
const count=new Map(),rows=[];
for(const [code,pairs] of Object.entries(freeze.COMPANY_TOPICS)){
  const ids=new Set();
  for(const [tag,role] of pairs){
    assert(defs.some(x=>x.id===tag),`unknown tag ${tag}`);
    assert(!ids.has(tag),`duplicate ${tag}/${code}`);ids.add(tag);
    assert(['core','related'].includes(role));
    count.set(tag,(count.get(tag)||0)+1);
    const market=(code==='4414')?'上市':null;
    // Full Neon-vs-freeze checksum validated separately using release source company market mappings.
    rows.push([tag,code,role]);
  }
}
assert.equal(rows.length,3440);
assert.equal(count.size,203);
assert.equal([...count.values()].filter(x=>x>=3).length,190);
assert.equal([...count.values()].filter(x=>x<3).length,13);
for(const oldTag of ['shipping','oil_gas_utility','ccl','bbu','semiconductor_test_equipment_market','shipping_sea','shipping_land']){
  assert(!freeze.definitionById(oldTag),`obsolete composite ${oldTag} resurrected`);
}
for(const code of ['6806','8183']){
  assert(freeze.RETIRED_COMPANY_CODES.includes(code));
  assert.deepEqual(freeze.companyTopicPairs(code),[]);
  assert.deepEqual(taxonomy.marketTopicLinks([{id:'shipping',importance:'core'}],'retired',code),[]);
}
assert.deepEqual(taxonomy.marketTopicLinks([{id:'shipping',importance:'core'},{id:'bbu',importance:'core'}],'new listing','987654'),[],'legacy composite topic must not come back for newly listed stock');
assert.equal(freeze.companyTopicPairs('2633').some(([id])=>id==='shipping_rail'),true);
assert.equal(freeze.companyTopicPairs('2603').some(([id])=>id==='shipping_container'),true);
assert.equal(freeze.companyTopicPairs('7769').some(([id])=>id==='semiconductor_test_equipment'),true);
assert.equal(xy.COMPANY_MAP_VERSION,freeze.VERSION);
assert.equal(xy.SNAPSHOT_SCHEMA_VERSION,'snapshot-7.0.4-focuspack-path31-taxonomy26-browser203');
// Browser should not plot a singleton rail theme despite having historical price points.
const profiles=['2633','2608','2642','2612'].map(stock_code=>({stock_code,market:'上市',stock_name:stock_code}));
const sample=(tagId,validCount)=>({tagId,validCount,memberCount:validCount,flowValidCount:validCount,xAvailable:true,x:20,y:1,trajectory:[{date:'2026-10-01',x:19,y:1},{date:'2026-10-02',x:20,y:1}],xyEligible:true});
const browser=xy.buildBusinessBrowserCatalog(profiles,{groups:[sample('shipping_rail',1),sample('shipping_road',3)]});
const rail=browser.items.find(x=>x.tagId==='shipping_rail'),road=browser.items.find(x=>x.tagId==='shipping_road');
assert.equal(rail.companyCount,1);assert.equal(rail.xyEligible,false);
assert.equal(road.companyCount,3);assert.equal(road.xyEligible,true);
// The release code must not overwrite unchanged company edges on every warm refresh.
const fs=require('node:fs');const source=fs.readFileSync(require.resolve('../lib/fundflow-xy'),'utf8');
assert(source.includes('m.importance IS DISTINCT FROM EXCLUDED.importance'));
assert(source.includes('m.stock_code = ANY($2::text[])'));
assert(source.includes('validCount>=2&&trajectoryLength>=2'),'Browser must require at least 2 valid stocks + 2 trajectory points');
assert(source.includes('businessEligible=g=>g.validCount>=2&&g.trajectory.length>=2'),'overview minimum membership and history must match Browser');
console.log(`PASS StockZone203 offline release: 203 categories / 3440 edges / 190 potentially XY-enabled / 13 unplottable / retired 6806 excluded`);
