const assert=require('assert');
const {blindCoverageForProfile,BLIND_COVERAGE_VERSION,AUTO_TOPIC_SCORE}=require('../lib/business-enrichment');
const {marketTopicLinks,detectMarketTopicEvidence}=require('../lib/market-topic-taxonomy');

// Blind test #1: company already has one valid tag. A second unrelated theme must still be discovered.
const alreadyClassified={
  stock_code:'9999',stock_name:'盲測甲',market:'上櫃',industry_code:'31',industry:'其他電子業',
  auto_business_tags:['automation_machine'],auto_market_topics:[]
};
const glass=blindCoverageForProfile(alreadyClassified,'自動化設備、TGV 玻璃通孔與 Glass Core 雷射鑽孔製程設備');
assert(glass.rawTags.includes('automation_machine'),'existing tag must be preserved');
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

// Direct runtime evidence: cached main_business should work before the DB row is rewritten.
const runtime=marketTopicLinks([], '陌生公司', '9995', {main_business:'FOPLP 面板級封裝設備與 TGV 玻璃核心基板設備',auto_market_topics:[]});
assert(runtime.some(x=>x.id==='foplp'),'runtime evidence should discover FOPLP');
assert(runtime.some(x=>x.id==='glass_substrate'),'runtime evidence should discover glass substrate');

// Conservative threshold: a generic nickname mention is audit-only; a strong product phrase can auto-assign.
const generic=detectMarketTopicEvidence('提供機器人軟體整合服務',{minScore:0}).find(x=>x.id==='robot');
assert(generic&&generic.score<AUTO_TOPIC_SCORE,'generic robot mention should remain audit-only');
const strong=detectMarketTopicEvidence('人形機器人與協作型機器人控制系統',{minScore:0}).find(x=>x.id==='robot');
assert(strong&&strong.score>=AUTO_TOPIC_SCORE,'strong robot wording should reach auto threshold');
assert.equal(BLIND_COVERAGE_VERSION,'blind-1.0.0');

console.log('Blind Coverage Engine validation PASS — additive all-company discovery does not depend on known company seeds');
