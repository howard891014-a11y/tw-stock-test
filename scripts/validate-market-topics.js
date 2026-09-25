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
const glassDef=defs.find(x=>x.id==='glass_substrate');
assert(glassDef&&glassDef.synthetic,'glass substrate should use explicit market-topic overlay');
for(const [code,name] of [['6207','雷科'],['8027','鈦昇'],['7828','創新服務'],['3037','欣興'],['6664','群翊'],['8064','東捷']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='glass_substrate'),`${code} ${name} should receive glass substrate market overlay`);
}
for(const [code,name] of [['8027','鈦昇'],['6664','群翊'],['8064','東捷'],['6187','萬潤'],['2467','志聖']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='foplp'),`${code} ${name} should receive FOPLP market overlay`);
}
assert(marketTopicLinks([],'鴻勁','7769').some(x=>x.id==='cpo_silicon_photonics'),'鴻勁 should receive CPO/矽光子 market overlay');
for(const [code,name] of [['2330','台積電'],['6451','訊芯-KY'],['3711','日月光投控'],['3450','聯鈞'],['4977','眾達-KY']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='cpo_silicon_photonics'),`${code} ${name} should receive CPO/矽光子 market-reference overlay`);
}
for(const [code,name] of [['2314','台揚'],['2485','兆赫'],['7812','稜研科技*-創']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='leo_satellite'),`${code} ${name} should receive 低軌衛星 market-reference overlay`);
}
for(const [code,name] of [['6435','大中'],['3317','尼克森'],['8255','朋程'],['4923','力士']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='power_semiconductor'),`${code} ${name} should receive 功率半導體 market-reference overlay`);
}
for(const [code,name] of [['4979','華星光'],['2455','全新'],['4971','IET-KY'],['4991','環宇-KY'],['3234','光環'],['2345','智邦'],['6515','穎崴'],['6223','旺矽'],['6510','精測'],['6530','創威'],['4903','聯光通']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='cpo_silicon_photonics'),`${code} ${name} should receive CPO/矽光子 market-reference overlay`);
}
for(const [code,name] of [['3711','日月光投控'],['2449','京元電子'],['8027','鈦昇'],['2464','盟立'],['5443','均豪'],['2404','漢唐'],['6691','洋基工程'],['6196','帆宣']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='cowos'),`${code} ${name} should receive CoWoS market-reference overlay`);
}
assert(marketTopicLinks([],'加百裕','3323').some(x=>x.id==='bbu'),'3323 加百裕 should receive BBU market-reference overlay');
for(const [code,name] of [['6285','啟碁'],['3105','穩懋'],['6213','聯茂'],['2355','敬鵬'],['2368','金像電'],['2367','燿華'],['3596','智易'],['2332','友訊']]){
  const links=marketTopicLinks([],name,code);
  assert(links.some(x=>x.id==='leo_satellite'),`${code} ${name} should receive 低軌衛星 market-reference overlay`);
}
assert(marketTopicLinks([],'氣立','4555').some(x=>x.id==='robot'),'4555 氣立 should receive 機器人 market-reference overlay');
const thermal=marketTopicLinks([{id:'liquid_cooling',name:'液冷散熱',importance:'core',origin:'test'}],'奇鋐');
assert(thermal.some(x=>x.id==='thermal'&&x.importance==='core'),'liquid cooling should consolidate to 散熱');
const bbu=marketTopicLinks([],'AES-KY');
assert(bbu.some(x=>x.id==='bbu'),'AES-KY should receive BBU market overlay');
const s=auditSummary();
assert(s.definitions<284,'market topic layer should reduce over-fragmented vote definitions');
console.log('Market Topic Taxonomy validation PASS',s);
