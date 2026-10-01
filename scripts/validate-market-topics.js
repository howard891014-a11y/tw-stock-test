const assert=require('assert');
const {TOPIC_SPECS,listMarketDefinitions,marketTopicLinks,auditSummary}=require('../lib/market-topic-taxonomy');

const defs=listMarketDefinitions();
const ids=defs.map(x=>x.id);
assert.equal(new Set(ids).size,ids.length,'market topic ids must be unique');
for(const id of ['thermal','passive','power_semiconductor','semiconductor_equipment','semiconductor_material','cpo_silicon_photonics','bbu','leo_satellite','drone','heavy_electrical','robot','machine_tool','ai_pc','abf_substrate','ccl','server_chassis','ai_server','automotive_electronics']){
  assert(ids.includes(id),`missing market topic ${id}`);
}
for(const fine of ['air_cooling','liquid_cooling','cold_plate','cdu','mlcc','resistor','mosfet','igbt','wet_process_equipment','advanced_packaging_equipment']){
  assert(!ids.includes(fine),`${fine} should not be an independent market XY topic`);
}
for(const separate of ['cowos','copos','foplp','glass_substrate'])assert(ids.includes(separate),`${separate} must remain separately tradable`);
// Conservative de-duplication: collapse only near-duplicate market lines while preserving the detailed raw tags.
assert(!ids.includes('consumer_desktop'),'Desktop should consolidate into PC／Notebook');
assert(!ids.includes('rigid_flex'),'軟硬結合板 should consolidate into FPCB');
assert(!ids.includes('specialty_process'),'特殊製程 should consolidate into 成熟／特殊製程晶圓代工');
assert(!ids.includes('micro_led'),'Micro LED should consolidate into Mini／Micro LED');
assert(!ids.includes('electronic_distribution_business'),'電子通路 should consolidate into 電子／IC通路');
assert(!ids.includes('bt_substrate')&&!ids.includes('ic_substrate'),'BT / generic IC substrate should consolidate into IC載板');
assert(!ids.includes('copper_foil')&&!ids.includes('glass_fiber_cloth'),'銅箔 / 玻纖布 should consolidate into PCB材料');
assert(!ids.includes('server_rack')&&!ids.includes('server_rail'),'server rack / rail should consolidate into server mechanical topic');
assert(!ids.includes('server_odm')&&!ids.includes('server_motherboard')&&!ids.includes('server_system'),'server ODM / motherboard / generic system should consolidate into AI server topic');
assert(!ids.includes('automotive_sensor'),'車用感測 should consolidate into 車用電子');
assert(!ids.includes('cloud_market'),'雲端 should consolidate into 資服／雲端');
assert(!ids.includes('test_interface_market'),'測試介面 should consolidate into 半導體測試／介面');
assert(!ids.includes('dc800'),'800VDC should consolidate into AI資料中心電源／BBU／800VDC');
for(const oldId of ['consumer_tablet','consumer_mobile','consumer_wearable','consumer_game_console','consumer_display','consumer_audio','consumer_camera','consumer_smart_home'])assert(!ids.includes(oldId),`${oldId} should consolidate into 消費電子終端`);
assert(marketTopicLinks([{id:'rigid_flex',importance:'core',origin:'test'}],'測試軟硬板').some(x=>x.id==='fpcb'),'rigid-flex source must map to consolidated FPCB topic');
assert(marketTopicLinks([{id:'specialty_process',importance:'core',origin:'test'}],'測試特殊製程').some(x=>x.id==='mature_foundry'),'specialty process must map to consolidated mature/specialty foundry');
assert(marketTopicLinks([{id:'micro_led',importance:'core',origin:'test'}],'測試MicroLED').some(x=>x.id==='mini_led'),'Micro LED must map to consolidated Mini/Micro LED');
assert(marketTopicLinks([{id:'electronic_distribution_business',importance:'core',origin:'test'}],'測試電子通路').some(x=>x.id==='ic_distribution'),'electronic distribution must map to consolidated electronic/IC distribution');
assert(marketTopicLinks([{id:'bt_substrate',importance:'core',origin:'test'}],'測試BT載板').some(x=>x.id==='abf_substrate'),'BT substrate must map to consolidated IC substrate topic');
assert(marketTopicLinks([{id:'ic_substrate',importance:'core',origin:'test'}],'測試IC載板').some(x=>x.id==='abf_substrate'),'generic IC substrate must map to consolidated IC substrate topic');
assert(marketTopicLinks([{id:'copper_foil',importance:'core',origin:'test'}],'測試銅箔').some(x=>x.id==='ccl'),'copper foil must map to consolidated PCB material topic');
assert(marketTopicLinks([{id:'glass_fiber_cloth',importance:'core',origin:'test'}],'測試玻纖布').some(x=>x.id==='ccl'),'glass fiber cloth must map to consolidated PCB material topic');
assert(marketTopicLinks([{id:'server_rack',importance:'core',origin:'test'}],'測試機櫃').some(x=>x.id==='server_chassis'),'server rack must map to consolidated server mechanical topic');
assert(marketTopicLinks([{id:'server_rail',importance:'core',origin:'test'}],'測試滑軌').some(x=>x.id==='server_chassis'),'server rail must map to consolidated server mechanical topic');
for(const tag of ['server_odm','server_motherboard','server_system'])assert(marketTopicLinks([{id:tag,importance:'core',origin:'test'}],`測試${tag}`).some(x=>x.id==='ai_server'),`${tag} must map to consolidated AI server topic`);
assert(marketTopicLinks([{id:'automotive_sensor',importance:'core',origin:'test'}],'測試車用感測').some(x=>x.id==='automotive_electronics'),'automotive sensor must map to consolidated automotive electronics topic');
assert(marketTopicLinks([{id:'cloud_service',importance:'core',origin:'test'}],'測試雲端').some(x=>x.id==='it_services_market'),'cloud service must map to 資服／雲端');
assert(marketTopicLinks([{id:'probe_card',importance:'core',origin:'test'}],'測試探針卡').some(x=>x.id==='semiconductor_test_equipment_market'),'probe card must map to semiconductor test/interface topic');
const glassDef=defs.find(x=>x.id==='glass_substrate');
assert(glassDef&&glassDef.synthetic,'glass substrate should use explicit market-topic overlay');
for(const [code,name] of [['6207','雷科'],['8027','鈦昇'],['7828','創新服務'],['3037','欣興'],['6664','群翊'],['8064','東捷'],['2409','友達'],['1815','富喬'],['3583','辛耘'],['3131','弘塑'],['2467','志聖'],['3563','牧德'],['3711','日月光投控']]){
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

// Consumer/end-device consolidation: keep active market lines broad enough to move together.
const consumerIds=['ai_pc','consumer_notebook','consumer_peripherals','consumer_brand_device'];
for(const id of consumerIds){const d=defs.find(x=>x.id===id);assert(d,`missing consumer-electronics topic ${id}`);assert.equal(d.scope,'electronics-product',`${id} must be in consumer-electronics scope`);}
assert(marketTopicLinks([{id:'notebook_pc',importance:'core',origin:'test'}],'測試筆電').some(x=>x.id==='consumer_notebook'),'notebook product must map to PC／Notebook');
assert(marketTopicLinks([{id:'desktop_pc',importance:'core',origin:'test'}],'測試桌機').some(x=>x.id==='consumer_notebook'),'desktop product should consolidate into PC／Notebook');
assert(marketTopicLinks([{id:'display_device',importance:'core',origin:'test'}],'測試顯示器').some(x=>x.id==='consumer_brand_device'),'finished display device must map to 消費電子終端');
assert(marketTopicLinks([{id:'consumer_electronics',importance:'core',origin:'test'}],'測試終端').some(x=>x.id==='consumer_brand_device'),'generic finished consumer electronics must map to 消費電子終端');
assert(marketTopicLinks([{id:'computer_peripheral_business',importance:'core',origin:'test'}],'測試週邊').some(x=>x.id==='consumer_peripherals'),'computer peripherals must remain a separate market line');
for(const [tag,id] of [['camera_module','camera_module'],['audio_component','acoustic_component'],['acoustic_component','acoustic_component']]){
  const links=marketTopicLinks([{id:tag,importance:'core',origin:'test'}],`上游${tag}`);
  assert(links.some(x=>x.id===id),`${tag} should remain in its upstream/component market topic`);
  assert(!links.some(x=>x.scope==='electronics-product'),`${tag} must not be forced into consumer electronics`);
}
const panel=defs.find(x=>x.id==='panel_market');assert(panel&&panel.scope==='technology-fine','panel materials/components must remain technology-fine, not consumer electronics');
for(const text of ['主要產品為智慧手機整機與行動終端','設計製造平板電腦與 Tablet PC','智慧手錶及穿戴式裝置','遊戲主機及 Game Console 終端產品','智慧家庭產品與 Smart Home 裝置','藍牙耳機與 Headphone 終端產品','數位相機與攝影機終端產品']){
  assert(marketTopicLinks([],'盲測消費終端','',{main_business:text}).some(x=>x.id==='consumer_brand_device'),`direct end-product evidence should map to consolidated consumer endpoint: ${text}`);
}

// Holding-company continuity: new listing names must inherit the predecessor's market-topic seeds.
assert(marketTopicLinks([],'中光電投控','3718').some(x=>x.id==='drone'),'3718 中光電投控 should inherit 中光電 無人機 market overlay');
assert(marketTopicLinks([],'中光電投資控股股份有限公司','3718').some(x=>x.id==='drone'),'full legal holding-company name should normalize to 中光電');
const thermal=marketTopicLinks([{id:'liquid_cooling',name:'液冷散熱',importance:'core',origin:'test'}],'奇鋐');
assert(thermal.some(x=>x.id==='thermal'&&x.importance==='core'),'liquid cooling should consolidate to 散熱');
const bbu=marketTopicLinks([],'AES-KY');
assert(bbu.some(x=>x.id==='bbu'),'AES-KY should receive BBU market overlay');
// Every explicit company/reference seed must actually resolve to its canonical topic. This prevents a source list from being added without becoming a user-visible company label.
for(const spec of TOPIC_SPECS){
  const pairs=[
    ...(spec.companySeeds||[]).map((name,i)=>[String((spec.companySymbols||[])[i]||''),name,'companySeed']),
    ...(spec.referenceSeeds||[]).map((name,i)=>[String((spec.referenceSymbols||[])[i]||''),name,'referenceSeed'])
  ];
  for(const [code,name,kind] of pairs){
    const links=marketTopicLinks([],name,code);
    assert(links.some(x=>x.id===spec.id),`${kind} ${code} ${name} must resolve to ${spec.id}`);
  }
}

const s=auditSummary();
assert(s.definitions<284,'market topic layer should reduce over-fragmented vote definitions');
console.log('Market Topic Taxonomy v1.8 / market co-movement consolidation + coverage validation PASS',s);
