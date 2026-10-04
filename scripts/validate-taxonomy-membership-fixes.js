const assert=require('assert');
const {resolveCompanyBusinessTags,isBusinessTagExcluded}=require('../lib/company-business-tags');
const {classifyBusinessText,BLIND_COVERAGE_VERSION}=require('../lib/business-enrichment');
const taxonomy=require('../lib/market-topic-taxonomy');
const {marketTopicLinks,isMarketTopicExcluded}=taxonomy;

assert.equal(taxonomy.version,'2.0.0');
assert.equal(BLIND_COVERAGE_VERSION,'blind-1.2.0','membership-only release must not trigger a full business-enrichment rewrite');

function topicIds(name,code,rawLinks=[],context={}){
  return new Set(marketTopicLinks(rawLinks,name,code,context).map(x=>x.id));
}
function hasTopic(name,code,topic){return topicIds(name,code).has(topic);}

const additions=[
  ['中美晶','5483','wafer'],['嘉晶','3016','wafer'],
  ['鼎翰','3611','automatic_data_capture'],['精聯','3652','automatic_data_capture'],
  ['威剛','3260','memory_module'],['創見','2451','memory_module'],['宇瞻','8271','memory_module'],['宜鼎','5289','memory_module'],['十銓','4967','memory_module'],['廣穎電通','4973','memory_module'],
  ['晶心科','6533','semiconductor_ip'],['鑫創電子','6680','defense'],
  ['威強電','3022','io_interface_card'],['弘憶股','3312','io_interface_card'],['磐儀','3594','io_interface_card'],
  ['聯寶','6821','power_module'],['康聯訊','3672','optical_communication_market'],['陞泰','8072','security_surveillance'],
  ['長盛','3492','general_connector'],['維熹','3501','general_connector'],['映興','3597','general_connector'],['良維','6290','general_connector'],
  ['泰碩','3338','electrical_cable'],['瑞軒','2489','panel_market'],['長華*','8070','advanced_packaging_material'],
  ['中興電','1513','renewable_energy_equipment'],['盈正','3628','renewable_energy_equipment'],['寶碩','5210','renewable_energy_equipment'],
  ['勤凱科技','4760','functional_electronic_material'],['晟銘電','3013','precision_mold'],['健策','3653','precision_mold'],['禾昌','6158','precision_mold'],
  ['日月光投控','3711','osat'],['光寶科','2301','optocoupler'],
];
for(const [name,code,topic] of additions)assert(hasTopic(name,code,topic),`missing audited overlay ${code} ${name} -> ${topic}`);

const topicExclusions=[
  ['華宏','8240','bmc'],['華宏','8240','thermal'],['華宏','8240','semiconductor_equipment'],
  ['漢磊','3707','dram'],['欣銓','3264','memory_ic'],['點序','6485','nand'],['群聯','8299','nand'],
  ['久元','6261','image_sensor_ic'],['南染','1410','osat'],['福懋','1434','osat'],['福懋','1434','ic_module'],
  ['上亞科技','6130','pmic'],['慕康生醫','5398','general_connector'],['浪凡','6165','general_connector'],
  ['美而快','5321','general_pcb'],['大同','2371','wafer_manufacturing'],['坤悅','5206','it_services_market'],
  ['聲寶','1604','electrical_cable'],['三洋電','1614','electrical_cable'],['艾美特-KY','1626','electrical_cable'],['燦星網','4930','electrical_cable'],
  ['台郡','6269','pi_film'],['錩泰','1541','motor_driver_ic'],['橋椿','2062','electromechanical_switch'],
  ['鑫科','3663','vacuum_coating_service'],['東捷','8064','vacuum_coating_service'],
  ['濱川','1569','acoustic_component'],['集雅社','2937','acoustic_component'],['協益','5356','acoustic_component'],
  ['艾美特-KY','1626','consumer_electronics_retail'],['華碩','2357','consumer_electronics_retail'],['鴻名','3021','consumer_electronics_retail'],
  ['新日興','3376','consumer_electronics_retail'],['兆利','3548','consumer_electronics_retail'],['燦星網','4930','consumer_electronics_retail'],
  ['晶呈科技','4768','led_epitaxy'],['立軒','6222','led_epitaxy'],['同欣電','6271','led_epitaxy'],['台表科','6278','led_epitaxy'],
];
for(const [name,code,topic] of topicExclusions){
  assert(isMarketTopicExcluded(code,topic),`topic exclusion registry missing ${code} ${topic}`);
  const ids=topicIds(name,code,[{id:topic,importance:'core',origin:'test'}],{autoMarketTopics:[topic],mainBusiness:`${topic} BMC LED 二極體`});
  assert(!ids.has(topic),`excluded topic re-entered through raw/auto/evidence: ${code} ${name} -> ${topic}`);
}

for(const code of ['2426','3066','3234','3339','3531','4908','4956','6164','6168','6226','8111']){
  const ids=topicIds('',code,[{id:'discrete_semiconductor',importance:'related',origin:'test'}],{mainBusiness:'發光二極體 LED 光電元件'});
  assert(!ids.has('power_semiconductor'),`generic diode false positive survived ${code}`);
}

const rawExclusionProbes=[
  ['8240','華宏','bmc'],['3707','漢磊','dram'],['3264','欣銓','memory_ic'],['6485','點序','nand'],['8299','群聯','nand'],
  ['6261','久元','image_sensor_ic'],['1410','南染','osat'],['6130','上亞科技','pmic'],['6269','台郡','pi_film'],
  ['3663','鑫科','vacuum_coating_service'],['8064','東捷','vacuum_coating_service'],
];
for(const [code,name,tag] of rawExclusionProbes){
  assert(isBusinessTagExcluded(code,tag),`raw exclusion registry missing ${code} ${tag}`);
  const resolved=resolveCompanyBusinessTags({stock_code:code,stock_name:name,industry:'半導體業',auto_business_tags:[tag]});
  assert(!resolved.tags.some(x=>x.id===tag),`excluded raw tag survived resolver ${code} ${tag}`);
}

function classified(text,code=''){return new Set(classifyBusinessText(text,{code}));}
assert(!classified('BMC材料及成型品 汽車燈反射鏡').has('bmc'));
assert(classified('基板管理控制器 BMC Controller IC').has('bmc'));
assert(!classified('LED發光二極體與顯示器').has('discrete_semiconductor'));
assert(classified('功率整流二極體與肖特基二極體').has('discrete_semiconductor'));
assert(!classified('NAND Flash Controller IC研發製造').has('nand'));
assert(!classified('SSD Controller IC').has('ssd'));
assert(classified('NAND Flash 記憶體產品').has('nand'));
assert(classified('企業級 SSD 固態硬碟').has('ssd'));
assert(!classified('CIS測試設備與CCM測試設備').has('image_sensor_ic'));
assert(classified('CMOS Image Sensor IC設計').has('image_sensor_ic'));
assert(!classified('馬達、電動工具、自動控制系統').has('motor_driver_ic'));
assert(classified('馬達驅動IC設計').has('motor_driver_ic'));
assert(!classified('薄膜濺鍍靶材及貴金屬材料').has('vacuum_coating_service'));
assert(classified('真空鍍膜代工服務').has('vacuum_coating_service'));



// v2.6.6.1 — ABF / IC載板 / BT full-group semantic re-audit.
// Market-line definition: direct organic IC package-substrate manufacturers only.
// Upstream materials/distribution, production equipment, ceramic substrate, COF/tape-carrier
// film substrate and IC test load boards are intentionally outside this market line.
const icSubstrateMakers=[
  ['欣興','3037'],['景碩','3189'],['南電','8046'],['臻鼎-KY','4958'],
];
for(const [name,code] of icSubstrateMakers){
  assert(hasTopic(name,code,'abf_substrate'),`audited IC substrate maker missing ${code} ${name}`);
  assert(!isMarketTopicExcluded(code,'abf_substrate'),`audited IC substrate maker unexpectedly excluded ${code} ${name}`);
}

const icSubstrateAdjacent=[
  ['駿吉-KY','1591','adjacent/non-substrate business'],
  ['敦吉','2459','adjacent electronics/testing business'],
  ['利機','3444','materials/equipment distributor'],
  ['敘豐','3485','FCBGA production equipment'],
  ['和碩','4938','EMS/ODM'],
  ['雷科','6207','substrate processing equipment'],
  ['同欣電','6271','ceramic substrate'],
  ['易華電','6552','COF/tape-carrier film IC substrate'],
  ['雍智科技','6683','IC test load board'],
  ['長華*','8070','packaging materials/equipment distribution'],
];
for(const [name,code,reason] of icSubstrateAdjacent){
  assert(isMarketTopicExcluded(code,'abf_substrate'),`IC substrate market exclusion missing ${code} ${name} (${reason})`);
  for(const raw of ['abf_substrate','bt_substrate','ic_substrate']){
    assert(isBusinessTagExcluded(code,raw),`IC substrate raw exclusion missing ${code} ${name} -> ${raw}`);
    const ids=topicIds(name,code,[{id:raw,importance:'core',origin:'test'}],{autoMarketTopics:['abf_substrate'],mainBusiness:'IC封裝基板 ABF BT 載板'});
    assert(!ids.has('abf_substrate'),`adjacent role re-entered IC substrate topic ${code} ${name} via ${raw}`);
  }
}
console.log(`PASS taxonomy membership fixes — ${additions.length} audited additions, ${topicExclusions.length} exact topic exclusions, classifier false-positive guards + IC substrate manufacturer-only boundary; BLIND coverage version unchanged`);
