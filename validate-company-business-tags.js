const tags = require("../lib/business-tags");
const seeds = require("../lib/company-business-seeds");
const db = require("../lib/company-business-tags");
const industries = require("../lib/industry-classification");

const errors = [];
const seenSymbols = new Set();
const importance = new Set(db.importanceLevels);

for (const company of db.companies) {
  if (!/^\d{4,6}$/.test(company.symbol)) errors.push(`${company.symbol || "(empty)"}: invalid symbol`);
  if (seenSymbols.has(company.symbol)) errors.push(`${company.symbol}: duplicate company`);
  seenSymbols.add(company.symbol);
  if (!company.name) errors.push(`${company.symbol}: missing name`);
  if (!tags.getTag(company.sectorTag)) errors.push(`${company.symbol} ${company.name}: unknown sectorTag ${company.sectorTag}`);

  const seenCompanyTags = new Set();
  if (!company.tags.length) errors.push(`${company.symbol} ${company.name}: no business tags`);
  for (const link of company.tags) {
    const item = tags.getTag(link.id);
    if (!item) { errors.push(`${company.symbol} ${company.name}: unknown tag ${link.id}`); continue; }
    if (!item.voteEligible) errors.push(`${company.symbol} ${company.name}: business tag ${link.id} is not voteEligible`);
    if (!importance.has(link.importance)) errors.push(`${company.symbol} ${company.name}: invalid importance ${link.importance}`);
    if (seenCompanyTags.has(link.id)) errors.push(`${company.symbol} ${company.name}: duplicate tag ${link.id}`);
    seenCompanyTags.add(link.id);
  }
}


const staticallyCoveredFineTags=new Set(Object.keys(seeds.groups));
for(const code of ['24','25','26','27','28','29','30','31','36']){ const info=industries.resolveIndustry({code}); if(info.fallbackTag)staticallyCoveredFineTags.add(info.fallbackTag); }
for(const company of db.companies) for(const link of company.tags) staticallyCoveredFineTags.add(link.id);
const orphanFineTags=tags.listVoteEligible().filter(tag=>tag.resolution==='fine'&&!staticallyCoveredFineTags.has(tag.id));
if(orphanFineTags.length) errors.push(`fine business definitions without any company anchor: ${orphanFineTags.map(x=>`${x.id}/${x.name}`).join(', ')}`);

for (const [groupId,names] of Object.entries(seeds.groups)) {
  const item=tags.getTag(groupId);
  if (!item) errors.push(`official-chain seed group has unknown tag: ${groupId}`);
  else if (!item.voteEligible) errors.push(`official-chain seed group is not voteEligible: ${groupId}`);
  if (!names.length) errors.push(`official-chain seed group is empty: ${groupId}`);
}

const fallbackSamples=[
  ['半導體業','semiconductor_products_services'],['電子零組件業','electronic_components_manufacturing'],
  ['電腦及週邊設備業','computer_peripheral_business'],['光電業','optoelectronic_components_modules'],
  ['通信網路業','network_equipment'],['資訊服務業','information_software_services'],
  ['電子通路業','electronic_distribution_business'],['其他電子業','electronics_manufacturing_services'],
  ['數位雲端業','digital_cloud_services']
];
for(const [industry,expected] of fallbackSamples){
  const got=db.fallbackTagForIndustry(industry);
  if(got!==expected)errors.push(`industry fallback ${industry}: expected ${expected}, got ${got}`);
}

const seededProbe=db.resolveCompanyBusinessTags({name:'智邦',industry:'通信網路業'});
if(!seededProbe.tags.some(x=>x.id==='network_equipment'))errors.push('official-chain seed resolution failed: 智邦 -> network_equipment');
const fallbackProbe=db.resolveCompanyBusinessTags({name:'未收錄測試公司',industry:'半導體業'});
if(fallbackProbe.resolution!=='industry-baseline'||fallbackProbe.tags[0]?.id!=='semiconductor_products_services')errors.push('technology baseline resolution failed');


const officialChainProbes=[
  ['欣興','電子零組件業','general_pcb'],
  ['嘉澤','電子零組件業','general_connector'],
  ['奇鋐','電腦及週邊設備業','air_cooling'],
  ['系微','資訊服務業','bios_firmware'],
  ['晶睿','光電業','security_surveillance'],
  ['洋華','光電業','touch_panel'],
  ['盛群','半導體業','mcu'],
  ['瑞昱','半導體業','network_ic'],
  ['天鈺','半導體業','display_driver_ic'],
  ['金居','電子零組件業','copper_foil'],
  ['光罩','半導體業','photomask'],
  ['永光','化學工業','photoresist'],
  ['台特化','化學工業','specialty_gas'],
  ['三福化','化學工業','wet_chemicals'],
  ['上詮','光電業','optical_engine'],
  ['強茂','半導體業','power_module'],
  ['富鼎','半導體業','mosfet'],
  ['台郡','電子零組件業','fpcb'],
  ['勤誠','電腦及週邊設備業','server_rack'],
  ['國巨','電子零組件業','mlcc'],
  ['晶技','電子零組件業','crystal_oscillator'],
  ['群創','光電業','lcd_panel'],
  ['大聯大','電子通路業','electronic_distribution_business'],
  ['聯電','半導體業','mature_foundry'],
  ['鴻勁','其他電子業','handler'],
  ['碩天','電腦及週邊設備業','ups'],
  ['安碁資訊','資訊服務業','cybersecurity'],
  ['鴻海','其他電子業','ems_odm'],
  ['漢翔','其他','defense'],
  ['龍德造船','其他','defense'],
  ['雷虎','運動休閒','defense'],
  ['凌陽','半導體業','consumer_ic'],
  ['祥碩','半導體業','io_interface_ic'],
  ['旺宏','半導體業','memory_ic'],
  ['台積電','半導體業','wafer_manufacturing'],
  ['致茂','其他電子業','semiconductor_process_test_equipment'],
  ['永光','化學工業','semiconductor_chemicals_materials'],
  ['景碩','電子零組件業','ic_substrate'],
  ['順德','半導體業','leadframe'],
  ['大聯大','電子通路業','ic_distribution'],
  ['瑞儀','光電業','backlight_module'],
  ['富采','光電業','led_epitaxy'],
  ['聯合再生','光電業','solar_cell'],
  ['華碩','電腦及週邊設備業','motherboard'],
  ['新普','電子零組件業','battery_module'],
  ['信錦','電子零組件業','hinge'],
  ['仁寶','電腦及週邊設備業','notebook_pc'],
  ['緯穎','電腦及週邊設備業','server_system'],
  ['台嘉碩','電子零組件業','filter_oscillator'],
  ['零壹','資訊服務業','software_distribution']
];
for(const [name,industry,expected] of officialChainProbes){
  const resolved=db.resolveCompanyBusinessTags({name,industry});
  if(!resolved.tags.some(x=>x.id===expected))errors.push(`official-chain v2 seed failed: ${name} -> ${expected}`);
}

const batchBRegressionProbes=[
  ['精英','電腦及週邊設備業','motherboard'],
  ['新普','電子零組件業','battery_module'],
  ['信錦','電子零組件業','hinge'],
  ['虹光','電腦及週邊設備業','office_imaging_equipment'],
  ['東訊','通信網路業','wired_communication_equipment'],
  ['鑫科','電子零組件業','filter_oscillator'],
  ['永擎','電腦及週邊設備業','server_system']
];
for(const [name,industry,expected] of batchBRegressionProbes){
  const resolved=db.resolveCompanyBusinessTags({name,industry});
  if(!resolved.tags.some(x=>x.id===expected))errors.push(`v2.6.2.33-B-FIX cumulative seed failed: ${name} -> ${expected}`);
}


const glassSubstrateAudit=[
  ['雷科','其他電子業','glass_substrate'],
  ['鈦昇','其他電子業','glass_substrate'],
  ['創新服務','其他電子業','glass_substrate']
];
for(const [name,industry,expected] of glassSubstrateAudit){
  const resolved=db.resolveCompanyBusinessTags({name,industry});
  if(!resolved.tags.some(x=>x.id===expected))errors.push(`glass-substrate audit failed: ${name} -> ${expected}`);
}

const advancedPackagingAudit=[
  ['萬潤','半導體業',['cowos','cpo','silicon_photonics','soic','copos']],
  ['志聖','其他電子業',['cowos','soic','bonding_equipment','copos']],
  ['辛耘','半導體業',['cowos','foplp']],
  ['均華','其他電子業',['cowos','soic','hbm']],
  ['弘塑','半導體業',['cowos','foplp','hbm']]
];
for(const [name,industry,expectedTags] of advancedPackagingAudit){
  const resolved=db.resolveCompanyBusinessTags({name,industry});
  for(const expected of expectedTags){
    if(!resolved.tags.some(x=>x.id===expected))errors.push(`advanced-packaging audit failed: ${name} -> ${expected}`);
  }
}
if(seeds.seededCompanyNames.length<760)errors.push(`official-chain seed coverage regression: expected >=760 unique names, got ${seeds.seededCompanyNames.length}`);

if(tags.getTag('telecom')?.voteEligible!==false)errors.push('coarse telecom should be non-votable because telecom_service_business is the canonical business tag');
if(tags.getTag('conglomerate')?.voteEligible!==false)errors.push('empty generic conglomerate bucket should be non-votable until a current company group exists');
if(tags.listVoteEligible().some(x=>x.resolution==='fallback'))errors.push('legacy technology fallback buckets must not be voteEligible');
const nativeTechBaselines=[
  ['24','semiconductor_products_services'],['25','computer_peripheral_business'],['26','optoelectronic_components_modules'],
  ['27','network_equipment'],['28','electronic_components_manufacturing'],['29','electronic_distribution_business'],
  ['30','information_software_services'],['31','electronics_manufacturing_services'],['36','digital_cloud_services']
];
for(const [code,expected] of nativeTechBaselines){
  const r=db.resolveCompanyBusinessTags({name:`測試科技${code}`,industryCode:code});
  if(!r.technologyTags.some(x=>x.id===expected))errors.push(`native technology baseline ${code}: expected ${expected}`);
  if(!r.hasTechnologyBusiness)errors.push(`native technology company ${code} lost technology label`);
}


const industryCodeSamples=[
  ['24','半導體業','semiconductor_products_services'],['25','電腦及週邊設備業','computer_peripheral_business'],
  ['03','塑膠工業','plastics'],['08','玻璃陶瓷','glass_ceramics'],['17','金融業','finance']
];
for(const [code,name,expectedTag] of industryCodeSamples){
  const info=industries.resolveIndustry({code});
  if(info.name!==name)errors.push(`industry code ${code}: expected ${name}, got ${info.name}`);
  const got=info.fallbackTag||info.broadTag;
  if(got!==expectedTag)errors.push(`industry tag ${code}: expected ${expectedTag}, got ${got}`);
}
const nanya=db.resolveCompanyBusinessTags({symbol:'1303',name:'南亞',industryCode:'03'});
if(!nanya.crossIndustryTechnology||!nanya.tags.some(x=>x.id==='ccl')||!nanya.tags.some(x=>x.id==='plastics'))errors.push('cross-industry overlay failed: 南亞');
const taiwanGlass=db.resolveCompanyBusinessTags({symbol:'1802',name:'台玻',industryCode:'08'});
if(!taiwanGlass.crossIndustryTechnology||!taiwanGlass.tags.some(x=>x.id==='glass_fiber_cloth')||!taiwanGlass.tags.some(x=>x.id==='glass_ceramics'))errors.push('cross-industry overlay failed: 台玻');

const summary = db.getCoverageSummary();
if (errors.length) {
  console.error(`Company business tags validation failed (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Company business tags ${db.version}: OK`);
console.log(`${summary.companyCount} curated companies / ${summary.relationCount} curated relations / ${summary.representedTagCount} curated vote tags`);
console.log(`${summary.officialChainSeedNames} official-chain seeded company names + all-market official industry + cross-industry technology overlay`);
