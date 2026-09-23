const tags = require("../lib/business-tags");
const seeds = require("../lib/company-business-seeds");
const db = require("../lib/company-business-tags");

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

for (const [groupId,names] of Object.entries(seeds.groups)) {
  const item=tags.getTag(groupId);
  if (!item) errors.push(`official-chain seed group has unknown tag: ${groupId}`);
  else if (!item.voteEligible) errors.push(`official-chain seed group is not voteEligible: ${groupId}`);
  if (!names.length) errors.push(`official-chain seed group is empty: ${groupId}`);
}

const fallbackSamples=[
  ['半導體業','semiconductor_other_business'],['電子零組件業','electronic_components_other'],
  ['電腦及週邊設備業','computer_peripheral_other'],['光電業','optoelectronics_other'],
  ['通信網路業','communication_other'],['資訊服務業','information_service_other'],
  ['電子通路業','electronic_distribution_other'],['其他電子業','other_electronics_business'],
  ['數位雲端業','digital_cloud_other']
];
for(const [industry,expected] of fallbackSamples){
  const got=db.fallbackTagForIndustry(industry);
  if(got!==expected)errors.push(`industry fallback ${industry}: expected ${expected}, got ${got}`);
}

const seededProbe=db.resolveCompanyBusinessTags({name:'智邦',industry:'通信網路業'});
if(!seededProbe.tags.some(x=>x.id==='network_equipment'))errors.push('official-chain seed resolution failed: 智邦 -> network_equipment');
const fallbackProbe=db.resolveCompanyBusinessTags({name:'未收錄測試公司',industry:'半導體業'});
if(fallbackProbe.resolution!=='industry-fallback'||fallbackProbe.tags[0]?.id!=='semiconductor_other_business')errors.push('industry fallback resolution failed');

const summary = db.getCoverageSummary();
if (errors.length) {
  console.error(`Company business tags validation failed (${errors.length})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Company business tags ${db.version}: OK`);
console.log(`${summary.companyCount} curated companies / ${summary.relationCount} curated relations / ${summary.representedTagCount} curated vote tags`);
console.log(`${summary.officialChainSeedNames} official-chain seeded company names + full-market technology industry fallback`);
