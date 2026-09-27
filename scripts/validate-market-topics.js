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

// v2.6.5.26 consumer/end-device classification must be real taxonomy, not a UI rename.
const consumerIds=['ai_pc','consumer_notebook','consumer_desktop','consumer_tablet','consumer_mobile','consumer_wearable','consumer_game_console','consumer_display','consumer_audio','consumer_camera','consumer_peripherals','consumer_smart_home','consumer_brand_device'];
for(const id of consumerIds){const d=defs.find(x=>x.id===id);assert(d,`missing consumer-electronics topic ${id}`);assert.equal(d.scope,'electronics-product',`${id} must be in consumer-electronics scope`);}
assert(marketTopicLinks([{id:'notebook_pc',importance:'core',origin:'test'}],'測試筆電').some(x=>x.id==='consumer_notebook'),'notebook product must map to consumer electronics');
assert(marketTopicLinks([{id:'desktop_pc',importance:'core',origin:'test'}],'測試桌機').some(x=>x.id==='consumer_desktop'),'desktop product must map to consumer electronics');
assert(marketTopicLinks([{id:'display_device',importance:'core',origin:'test'}],'測試顯示器').some(x=>x.id==='consumer_display'),'finished display device must map to consumer electronics');
assert(marketTopicLinks([{id:'consumer_electronics',importance:'core',origin:'test'}],'測試終端').some(x=>x.id==='consumer_brand_device'),'generic finished consumer electronics must map to end-device bucket');
for(const [tag,id] of [['camera_module','camera_module'],['audio_component','acoustic_component'],['acoustic_component','acoustic_component']]){
  const links=marketTopicLinks([{id:tag,importance:'core',origin:'test'}],`上游${tag}`);
  assert(links.some(x=>x.id===id),`${tag} should remain in its upstream/component market topic`);
  assert(!links.some(x=>x.scope==='electronics-product'),`${tag} must not be forced into consumer electronics`);
}
const panel=defs.find(x=>x.id==='panel_market');assert(panel&&panel.scope==='technology-fine','panel materials/components must remain technology-fine, not consumer electronics');
for(const [text,id] of [
  ['主要產品為智慧手機整機與行動終端','consumer_mobile'],
  ['設計製造平板電腦與 Tablet PC','consumer_tablet'],
  ['智慧手錶及穿戴式裝置','consumer_wearable'],
  ['遊戲主機及 Game Console 終端產品','consumer_game_console'],
  ['智慧家庭產品與 Smart Home 裝置','consumer_smart_home'],
  ['藍牙耳機與 Headphone 終端產品','consumer_audio'],
  ['數位相機與攝影機終端產品','consumer_camera']
]){
  assert(marketTopicLinks([],`盲測-${id}`,'',{main_business:text}).some(x=>x.id===id),`direct end-product evidence should map to ${id}`);
}

// Holding-company continuity: new listing names must inherit the predecessor's market-topic seeds.
assert(marketTopicLinks([],'中光電投控','3718').some(x=>x.id==='drone'),'3718 中光電投控 should inherit 中光電 無人機 market overlay');
assert(marketTopicLinks([],'中光電投資控股股份有限公司','3718').some(x=>x.id==='drone'),'full legal holding-company name should normalize to 中光電');
const thermal=marketTopicLinks([{id:'liquid_cooling',name:'液冷散熱',importance:'core',origin:'test'}],'奇鋐');
assert(thermal.some(x=>x.id==='thermal'&&x.importance==='core'),'liquid cooling should consolidate to 散熱');
const bbu=marketTopicLinks([],'AES-KY');
assert(bbu.some(x=>x.id==='bbu'),'AES-KY should receive BBU market overlay');
const s=auditSummary();
assert(s.definitions<284,'market topic layer should reduce over-fragmented vote definitions');
console.log('Market Topic Taxonomy v1.6 / consumer-electronics validation PASS',s);
