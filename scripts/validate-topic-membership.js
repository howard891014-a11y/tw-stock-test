const assert=require('assert');
const {resolveCompanyBusinessTags}=require('../lib/company-business-tags');
const {marketTopicLinks}=require('../lib/market-topic-taxonomy');

function topics(code,name){
  const r=resolveCompanyBusinessTags({stock_code:code,stock_name:name,name,market:'上市',industry_code:'24',industry:'半導體業',auto_business_tags:[]});
  return new Set(marketTopicLinks(r.tags||[],r.name||name,r.symbol||code).map(x=>x.id));
}
function expect(code,name,required){
  const got=topics(code,name);
  for(const t of required)assert(got.has(t),`${code} ${name} missing required market topic ${t}; got=${[...got].join(',')}`);
}

// User-facing priority themes: these are build-breaking checks, not documentation-only lists.
for(const [code,name] of [
  ['1802','台玻'],['3481','群創'],['8064','東捷'],['6207','雷科'],['8027','鈦昇'],['7828','創新服務'],
  ['3037','欣興'],['4958','臻鼎-KY'],['3673','TPK-KY'],['3149','正達'],['4768','晶呈科技'],['1595','川寶'],
  ['6664','群翊'],['3580','友威科'],['3055','蔚華科'],['8046','南電'],['3189','景碩']
]) expect(code,name,['glass_substrate']);

for(const [code,name] of [
  ['3481','群創'],['3535','晶彩科'],['3455','由田'],['3583','辛耘'],['3131','弘塑'],['8027','鈦昇'],
  ['6664','群翊'],['8064','東捷'],['5443','均豪'],['2467','志聖'],['6187','萬潤']
]) expect(code,name,['foplp']);

expect('6187','萬潤',['cowos','copos','cpo_silicon_photonics']);
expect('2467','志聖',['cowos','copos']);
expect('7769','鴻勁',['semiconductor_test_equipment_market','cpo_silicon_photonics']);
expect('4919','新唐',['mcu']);
expect('2454','聯發科',['asic']);
expect('3017','奇鋐',['thermal']);
expect('8064','東捷',['glass_substrate','foplp']);

console.log('Priority topic membership validation PASS');
