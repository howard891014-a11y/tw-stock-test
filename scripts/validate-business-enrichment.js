const assert=require('assert');
const {classifyBusinessText,classifyBroadBusinessText}=require('../lib/business-enrichment');
const {resolveCompanyBusinessTags}=require('../lib/company-business-tags');

function has(text,id){assert(classifyBusinessText(text).includes(id),`${id} missing for: ${text}`)}
has('主要產品為微控制器 MCU、電源管理IC與消費性IC','mcu');
has('主要產品為微控制器 MCU、電源管理IC與消費性IC','pmic');
has('印刷電路板 PCB、HDI 高密度互連板之製造與銷售','general_pcb');
has('印刷電路板 PCB、HDI 高密度互連板之製造與銷售','hdi');
has('伺服器系統、AI伺服器與伺服器主機板','ai_server');
has('光收發器、光通訊模組、CPO與矽光子元件','optical_transceiver');
has('資安、雲端服務、系統整合與AI解決方案','cybersecurity');
has('資安、雲端服務、系統整合與AI解決方案','cloud_service');


function hasCode(code,text,id){assert(classifyBusinessText(text,{code}).includes(id),`${id} missing for ${code}: ${text}`)}
hasCode('2363','研究開發、生產、製造、銷售各種特殊應用積體電路','asic');
hasCode('5215','薄膜開關控制之製造銷售','keyboard_input_device');
hasCode('6127','氧化鋁陶瓷基板之製造、加工及買賣業務','ceramic_substrate');
hasCode('6525','功率半導體封裝測試服務','mosfet');
hasCode('6538','精密網版之研發、製造及銷售','screen_printing_mesh');
hasCode('6573','半導體整流功率分離式元件','discrete_semiconductor');


// C4 final-tail one-by-one mappings. Every one of the 26 formerly unresolved codes
// must now resolve to at least one concrete fine tag even when MOPS wording is generic.
const c4Cases = [
  ['2432','電信加值網路業務、電腦軟硬體應用系統之設計、銷售、出租、電腦創新週邊移動產品與生活智慧產品之銷售','consumer_electronics'],
  ['3631','焊錫條、焊錫絲、錫球、錫膏與助焊相關產品','solder_material'],
  ['6114','電腦週邊裝置及電子零件製造加工買賣業務','functional_electronic_material'],
  ['6584','電子零組件製造業、家具及裝設品製造業、其他金屬製品製造業','server_rail'],
  ['6698','高精細金屬遮罩製作銷售、精密洗淨及再生處理','precision_metal_mask'],
  ['6761','EMC及線路保護元件銷售、認證測試之整合性服務','emc_protection_component'],
  ['6855','智慧製造、智慧醫療、數位工具等系統與產品之研發、製造與銷售','biomedical_health'],
  ['6863','RFID電子標籤','rfid_tag'],
  ['6921','高速訊號傳輸介面之數位類比晶片之設計、開發、生產、製造及銷售','high_speed_ic'],
  ['6967','電子功能材料解決方案、經銷業務','functional_electronic_material'],
  ['7738','外籍移工匯兌業、電信業務門號代辦業','digital_remittance'],
  ['7749','AI運算處理','ai_accelerator'],
  ['7753','數位顯示系統、視覺燈光系統','display_device'],
  ['7792','再生能源自用發電設備業、能源技術服務業、發電輸電配電機械製造業','renewable_energy_equipment'],
  ['7805','數據儲存解決方案銷售','storage_system'],
  ['7835','健康資訊系統應用服務及解決方案、健康媒體廣告行銷','biomedical_health'],
  ['8021','電子線路板專用微型鑽針及銑刀、電子線路板製程加工','pcb_tooling'],
  ['8047','雷射雕刻機、雷射切割機','laser_processing_equipment'],
  ['8121','軟性鐵氧磁粉、磁鐵芯及其他有關磁性組件','ferrite_magnetic_component'],
  ['8183','電子零組件製造業、資料儲存及處理設備製造業','pcba_ems'],
  ['8215','電腦及週邊設備製造業、其他化學材料製造業、醫療產品製造業','biomedical_health'],
  ['8249','電子零組件製造業、資料儲存及處理設備製造業、有線通信機械器材製造業','image_sensor_module'],
  ['8284','資訊軟體服務、行動軟體平台','digital_platform'],
  ['8416','SOLIDWORKS、3D CAD/CAM/CAE/CAID軟體銷售、PDM產品研發','software_distribution'],
  ['8431','金屬表面處理服務','surface_treatment'],
  ['8487','數位內容、廣告託播代理、轉播及其他','digital_media_streaming'],
];
for (const [code,text,id] of c4Cases) hasCode(code,text,id);


// C5 final unclassified cleanup: special/management-stock profiles may use clear broad
// traditional sectors when no technology fine tag is present.
assert(classifyBroadBusinessText('藥品、醫療器材及檢測試劑之研發製造與銷售').includes('biotech'));
assert(classifyBroadBusinessText('食品、飲料與烘焙產品之製造及銷售').includes('food'));
assert(classifyBroadBusinessText('建築工程與不動產開發').includes('construction'));
assert(classifyBroadBusinessText('鋼材、不鏽鋼加工及銷售').includes('steel'));
assert(classifyBusinessText('醫療器材與健康照護產品',{allowBroad:true}).includes('biomedical_health'));
const special=resolveCompanyBusinessTags({stock_code:'9998',stock_name:'特殊測試',market:'上櫃',industry_code:'80',industry:'管理股票',auto_business_tags:['biotech']});
assert.equal(special.resolution,'mops-business');
assert(special.tags.some(x=>x.id==='biotech'));



// C6 final 4 TDR cleanup. These were the last profiles counted as completely unclassified.
const drCases = [
  ['910861','神州-DR',['ai_solution','digital_platform']],
  ['9110','越南控-DR',['motorcycle']],
  ['911608','明輝-DR',['cybersecurity','system_integration']],
  ['9136','巨騰-DR',['computer_chassis']],
];
for (const [code,name,expected] of drCases){
  const r=resolveCompanyBusinessTags({stock_code:code,stock_name:name,market:'上市',industry_code:'91',industry:'存託憑證'});
  assert.notEqual(r.resolution,'none',`${code} ${name} still unresolved`);
  for (const id of expected) assert(r.tags.some(x=>x.id===id),`${code} ${name} missing ${id}`);
}
assert(classifyBroadBusinessText('生產製造機車、生產製造機車零組件、製造金屬零件').includes('motorcycle'));
assert(classifyBusinessText('數據智能決策使能平台及AI全棧技術服務',{code:'910861'}).includes('ai_solution'));
assert(classifyBusinessText('Supply chain management Engineering services Security products and services',{code:'911608'}).includes('cybersecurity'));
assert(classifyBusinessText('生產及銷售筆記本型電腦外殼、手持設備外殼',{code:'9136'}).includes('computer_chassis'));

const resolved=resolveCompanyBusinessTags({stock_code:'9999',stock_name:'測試公司',market:'上市',industry_code:'24',industry:'半導體業',auto_business_tags:['mcu','pmic']});
assert.equal(resolved.resolution,'mops-business');
assert(resolved.tags.some(x=>x.id==='mcu'));
assert(resolved.tags.some(x=>x.id==='pmic'));
assert(!resolved.tags.some(x=>x.origin==='industry-baseline'));
console.log('business-enrichment validation PASS');
