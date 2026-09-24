const assert=require('assert');
const {classifyBusinessText}=require('../lib/business-enrichment');
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

const resolved=resolveCompanyBusinessTags({stock_code:'9999',stock_name:'測試公司',market:'上市',industry_code:'24',industry:'半導體業',auto_business_tags:['mcu','pmic']});
assert.equal(resolved.resolution,'mops-business');
assert(resolved.tags.some(x=>x.id==='mcu'));
assert(resolved.tags.some(x=>x.id==='pmic'));
assert(!resolved.tags.some(x=>x.origin==='industry-baseline'));
console.log('business-enrichment validation PASS');
