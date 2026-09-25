const assert=require('assert');
const {listMarketDefinitions,marketTopicLinks,auditSummary}=require('../lib/market-topic-taxonomy');

const defs=listMarketDefinitions();
const ids=defs.map(x=>x.id);
assert.equal(new Set(ids).size,ids.length,'market topic ids must be unique');
for(const id of ['thermal','passive','power_semiconductor','semiconductor_equipment','semiconductor_material','cpo_silicon_photonics','bbu','dc800','leo_satellite','drone','heavy_electrical','robot','machine_tool','ai_pc']){
  assert(ids.includes(id),`missing market topic ${id}`);
}
for(const fine of ['air_cooling','liquid_cooling','cold_plate','cdu','mlcc','resistor','mosfet','igbt','wet_process_equipment','advanced_packaging_equipment']){
  assert(!ids.includes(fine),`${fine} should not be an independent market XY topic`);
}
for(const separate of ['cowos','copos','foplp','glass_substrate'])assert(ids.includes(separate),`${separate} must remain separately tradable`);
const thermal=marketTopicLinks([{id:'liquid_cooling',name:'液冷散熱',importance:'core',origin:'test'}],'奇鋐');
assert(thermal.some(x=>x.id==='thermal'&&x.importance==='core'),'liquid cooling should consolidate to 散熱');
const bbu=marketTopicLinks([],'AES-KY');
assert(bbu.some(x=>x.id==='bbu'),'AES-KY should receive BBU market overlay');
const s=auditSummary();
assert(s.definitions<284,'market topic layer should reduce over-fragmented vote definitions');
console.log('Market Topic Taxonomy validation PASS',s);
