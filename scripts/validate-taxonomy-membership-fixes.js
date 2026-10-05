'use strict';
const assert=require('node:assert/strict');
const {resolveCompanyBusinessTags,isBusinessTagExcluded}=require('../lib/company-business-tags');
const {classifyBusinessText,BLIND_COVERAGE_VERSION}=require('../lib/business-enrichment');
const taxonomy=require('../lib/market-topic-taxonomy');
const {marketTopicLinks}=taxonomy;

assert.equal(taxonomy.version,'2.3.0-final191');
assert.equal(BLIND_COVERAGE_VERSION,'blind-1.2.0','taxonomy-only release must not trigger full business-enrichment rewrite');

// Final frozen universe is authoritative; unknown/future companies still use classifier compatibility.
for(const id of ['gpu','chipset','wafer_manufacturing','consumer_ic','panel_market']){
  const got=new Set(marketTopicLinks([{id,importance:'core',origin:'test'}],'未來測試公司','999999',{}).map(x=>x.id));
  assert(!got.has(id),`${id} must remain retired from Fundflow XY`);
}
for(const [raw,expected] of [['rigid_flex','fpcb'],['specialty_process','mature_foundry'],['bt_substrate','abf_substrate'],['copper_foil','ccl'],['server_rack','server_chassis']]){
  const got=new Set(marketTopicLinks([{id:raw,importance:'core',origin:'test'}],'未來測試公司','999999',{}).map(x=>x.id));
  assert(got.has(expected),`${raw} should consolidate to ${expected}`);
}

// Raw/business classifier false-positive guards remain active for future enrichment.
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

console.log('PASS taxonomy membership fixes — audited final freeze + future-company classifier guards');
