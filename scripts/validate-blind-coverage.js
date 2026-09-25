const assert=require('assert');
const {blindCoverageForProfile,BLIND_COVERAGE_VERSION,AUTO_TOPIC_SCORE}=require('../lib/business-enrichment');
const {marketTopicLinks,detectMarketTopicEvidence}=require('../lib/market-topic-taxonomy');

// Blind test #1: company already has one valid tag. A second unrelated theme must still be discovered.
const alreadyClassified={
  stock_code:'9999',stock_name:'盲測甲',market:'上櫃',industry_code:'31',industry:'其他電子業',
  auto_business_tags:['automation_machine'],auto_market_topics:[]
};
const glass=blindCoverageForProfile(alreadyClassified,'自動化設備、TGV 玻璃通孔與 Glass Core 雷射鑽孔製程設備');
assert(glass.rawTags.includes('automation_machine'),'current business text must still rediscover automation_machine');
assert(glass.rawTags.includes('glass_substrate'),'TGV must discover glass_substrate raw tag');
assert(glass.marketTopics.includes('glass_substrate'),'TGV must discover glass substrate market topic');
assert(glass.discoveredRaw.includes('glass_substrate'),'second theme must be additive, not blocked by existing classification');

// Blind test #2: synthetic theme with no raw business tag must be discovered from text, not company name seed.
const satellite=blindCoverageForProfile({stock_code:'9997',stock_name:'盲測乙',auto_business_tags:['network_equipment'],auto_market_topics:[]},'低軌衛星通訊終端、LEO satellite gateway 與網路設備');
assert(satellite.rawTags.includes('network_equipment'),'existing network tag should remain');
assert(satellite.marketTopics.includes('leo_satellite'),'LEO theme must be discovered from business text');

// Blind test #3: BBU is a market theme overlay and should be recognized without any known company name.
const bbu=blindCoverageForProfile({stock_code:'9996',stock_name:'完全未知公司',auto_business_tags:[],auto_market_topics:[]},'AI伺服器 Battery Backup Unit (BBU) 備援電池模組');
assert(bbu.marketTopics.includes('bbu'),'BBU should be discovered from MOPS-like business text');

// Blind test #4: stale auto labels must be removable on a new engine version.
const stale=blindCoverageForProfile({stock_code:'9994',stock_name:'盲測丙',auto_business_tags:['semiconductor_chemicals_materials'],auto_market_topics:['semiconductor_material']},'各種精密探針製造、探針用測試治具研發製造');
assert(!stale.rawTags.includes('semiconductor_chemicals_materials'),'stale auto raw tag should self-heal instead of being unioned forever');
assert(!stale.marketTopics.includes('semiconductor_material'),'stale auto market topic should self-heal instead of being unioned forever');
assert(stale.marketTopics.includes('test_interface_market'),'probe/test-fixture wording must map to test interface');

// Real blind-audit phrases: these companies were not supplied as discovery seeds.
const precision=blindCoverageForProfile({stock_code:'6510',stock_name:'精測',auto_business_tags:[],auto_market_topics:[]},'晶圓測試卡、IC測試板、技術服務與其他');
assert(precision.marketTopics.includes('test_interface_market'),'晶圓測試卡 / IC測試板 must map to 測試介面');
const lianjun=blindCoverageForProfile({stock_code:'3450',stock_name:'聯鈞',auto_business_tags:[],auto_market_topics:[]},'光資訊及光通訊產品、功率半導體封裝測試');
assert(lianjun.marketTopics.includes('optical_communication_market'),'光通訊產品 must map to 光通訊');
assert(lianjun.marketTopics.includes('power_semiconductor'),'功率半導體 wording must map to 功率半導體');
const power=blindCoverageForProfile({stock_code:'5299',stock_name:'杰力',auto_business_tags:[],auto_market_topics:[]},'積體電路設計業、功率元件、電源管理積體電路');
assert(power.marketTopics.includes('power_semiconductor'),'功率元件 must map to 功率半導體');
const machine=blindCoverageForProfile({stock_code:'1539',stock_name:'巨庭',auto_business_tags:[],auto_market_topics:[]},'鑽床、車床、銑床、自動鉋床等機械及其零件製造買賣');
assert(machine.marketTopics.includes('machine_tool'),'multiple machine-tool product terms must map to 工具機');
const semimat=blindCoverageForProfile({stock_code:'1722',stock_name:'台肥',auto_business_tags:[],auto_market_topics:[]},'肥料產品、化工產品、電子級化學品');
assert(semimat.marketTopics.includes('semiconductor_material'),'電子級化學品 must map to 半導體材料');
const genericElectronicMaterial=blindCoverageForProfile({stock_code:'9993',stock_name:'盲測丁',auto_business_tags:[],auto_market_topics:[]},'電子材料批發業、電子零組件買賣');
assert(!genericElectronicMaterial.rawTags.includes('semiconductor_chemicals_materials'),'generic 電子材料 must not become 半導體材料');

const blindAuditCases=[
  ['1539','巨庭','鑽床、車床、銑床、自動鉋床等機械及其零件製造買賣','machine_tool'],
  ['1722','台肥','肥料產品、化工產品、電子級化學品','semiconductor_material'],
  ['2236','百達-KY','沖壓機台及汽機車用件、服務型機器人之銷售及租賃','robot'],
  ['2486','一詮','散熱元件、LED導線架、智能服務機器人及其他電子零組件','thermal'],
  ['2486','一詮','散熱元件、LED導線架、智能服務機器人及其他電子零組件','robot'],
  ['3450','聯鈞','光資訊及光通訊產品、功率半導體封裝測試','optical_communication_market'],
  ['3450','聯鈞','光資訊及光通訊產品、功率半導體封裝測試','power_semiconductor'],
  ['3597','映興','AI伺服器、網通、無人載具及車用電子等關鍵線組與連接器','drone'],
  ['4306','炎洲','電子級化學品純化與循環再利用及綠色能源之開發建置','semiconductor_material'],
  ['4541','晟田','航太零組件、半導體設備及相關零組件、自動化精密傳動相關零組件','semiconductor_equipment'],
  ['5299','杰力','積體電路設計業、功率元件、電源管理積體電路','power_semiconductor'],
  ['6138','茂達','半導體功率IC和其模組、半導體功率元件和其模組','power_semiconductor'],
  ['6217','中探針','各種精密探針製造、各種探針用測試治具之研發製造銷售','test_interface_market'],
  ['6510','精測','晶圓測試卡、IC測試板、技術服務與其他','test_interface_market'],
  ['6680','鑫創電子','軍規強固智能運算及無人載具電腦產品之研發製造與銷售','drone'],
  ['6693','廣閎科','功率半導體元件(功率金氧半場效電晶體)之研發設計與銷售','power_semiconductor'],
  ['7402','邑錡','AI影像機器人視覺產品與低功耗相機模組','robot'],
  ['7712','博盛半導體','功率半導體元件','power_semiconductor'],
];
for(const [code,name,business,topic] of blindAuditCases){
  const r=blindCoverageForProfile({stock_code:code,stock_name:name,auto_business_tags:[],auto_market_topics:[]},business);
  assert(r.marketTopics.includes(topic),`${code} ${name} blind audit missing ${topic}`);
}

// Direct runtime evidence: cached main_business should work before the DB row is rewritten.
const runtime=marketTopicLinks([], '陌生公司', '9995', {main_business:'FOPLP 面板級封裝設備與 TGV 玻璃核心基板設備',auto_market_topics:[]});
assert(runtime.some(x=>x.id==='foplp'),'runtime evidence should discover FOPLP');
assert(runtime.some(x=>x.id==='glass_substrate'),'runtime evidence should discover glass substrate');

// Conservative threshold: a generic nickname mention is audit-only; a strong product phrase can auto-assign.
const generic=detectMarketTopicEvidence('提供機器人軟體整合服務',{minScore:0}).find(x=>x.id==='robot');
assert(generic&&generic.score<AUTO_TOPIC_SCORE,'generic robot mention should remain audit-only');
const strong=detectMarketTopicEvidence('人形機器人與協作型機器人控制系統',{minScore:0}).find(x=>x.id==='robot');
assert(strong&&strong.score>=AUTO_TOPIC_SCORE,'strong robot wording should reach auto threshold');
assert.equal(BLIND_COVERAGE_VERSION,'blind-1.1.0');

console.log('Blind Coverage Engine validation PASS — blind discovery self-heals stale auto tags and does not depend on known company seeds');
