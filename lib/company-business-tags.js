// StockZone v2.6.2.14
// Company Business Tags DB v2
//
// Purpose:
// - Map a stock/company to business tags from lib/business-tags.js.
// - Technology/electronics companies use fine business tags.
// - This file is the denominator base for future tag hit-rate / market-flow voting.
// - No revenue weights are invented in v1. Importance is qualitative only:
//   core > important > related.
// - Daily voting should initially mark all attached vote-eligible tags, then let
//   market-wide hit count / hit rate / strength decide which tags survive Top N.

const { getTag, isVoteEligible } = require("./business-tags");
const { tagsForCompanyName, seededCompanyNames, normalizeCompanyName } = require("./company-business-seeds");

const IMPORTANCE = Object.freeze(["core", "important", "related"]);

function biz(id, importance = "important") {
  return Object.freeze({ id, importance });
}

function company(symbol, name, sectorTag, tags, options = {}) {
  return Object.freeze({
    symbol: String(symbol),
    name,
    sectorTag,
    tags: Object.freeze(tags.map((x) => Object.freeze({ ...x }))),
    confidence: options.confidence || "high",
    reviewStatus: options.reviewStatus || "seed-v1",
    note: options.note || "",
  });
}

const COMPANIES = Object.freeze([
  company("2330", "台積電", "semiconductor", [biz("advanced_foundry", "core"), biz("cowos", "important"), biz("soic", "important"), biz("info_packaging", "important")]),
  company("2454", "聯發科", "semiconductor", [biz("soc", "core"), biz("asic", "important"), biz("network_ic", "important"), biz("high_speed_ic", "related")]),
  company("3443", "創意", "semiconductor", [biz("asic_design_service", "core"), biz("asic", "core"), biz("soc", "important"), biz("semiconductor_ip", "important")]),
  company("3661", "世芯-KY", "semiconductor", [biz("asic_design_service", "core"), biz("asic", "core")]),
  company("3035", "智原", "semiconductor", [biz("asic_design_service", "core"), biz("semiconductor_ip", "important")]),
  company("3529", "力旺", "semiconductor", [biz("semiconductor_ip", "core")]),
  company("6643", "M31", "semiconductor", [biz("semiconductor_ip", "core")]),
  company("5274", "信驊", "semiconductor", [biz("bmc", "core"), biz("soc", "important")]),
  company("4919", "新唐", "semiconductor", [biz("mcu", "core")]),
  company("2379", "瑞昱", "semiconductor", [biz("network_ic", "core"), biz("soc", "important")]),
  company("3034", "聯詠", "semiconductor", [biz("display_driver_ic", "core"), biz("soc", "important")]),
  company("4961", "天鈺", "semiconductor", [biz("display_driver_ic", "core"), biz("pmic", "important")]),
  company("8299", "群聯", "storage", [biz("ssd_controller", "core"), biz("ssd", "important"), biz("nand", "related")]),
  company("2337", "旺宏", "storage", [biz("nor_flash", "core"), biz("nand", "important")]),
  company("2408", "南亞科", "storage", [biz("dram", "core")]),
  company("2344", "華邦電", "storage", [biz("dram", "core"), biz("nor_flash", "core")]),
  company("6488", "環球晶", "semiconductor", [biz("wafer", "core")]),
  company("3532", "台勝科", "semiconductor", [biz("wafer", "core")]),
  company("6182", "合晶", "semiconductor", [biz("wafer", "core")]),
  company("3131", "弘塑", "semiconductor", [biz("wet_process_equipment", "core"), biz("advanced_packaging_equipment", "important")]),
  company("3583", "辛耘", "semiconductor", [biz("wet_process_equipment", "core"), biz("advanced_packaging_equipment", "important")]),
  company("6187", "萬潤", "semiconductor", [biz("semiconductor_automation_equipment", "core"), biz("advanced_packaging_equipment", "important"), biz("factory_automation", "important")]),
  company("2467", "志聖", "semiconductor", [biz("advanced_packaging_equipment", "core"), biz("pcb_equipment", "important")]),
  company("6640", "均華", "semiconductor", [biz("advanced_packaging_equipment", "core"), biz("bonding_equipment", "important"), biz("laser_processing_equipment", "important")]),
  company("6438", "迅得", "semiconductor", [biz("semiconductor_automation_equipment", "core"), biz("factory_automation", "important"), biz("advanced_packaging_equipment", "important")]),
  company("8064", "東捷", "automation", [biz("factory_automation", "core"), biz("semiconductor_automation_equipment", "important")]),
  company("6223", "旺矽", "semiconductor", [biz("probe_card", "core"), biz("ate", "important")]),
  company("6515", "穎崴", "semiconductor", [biz("test_socket", "core"), biz("probe_card", "important")]),
  company("6683", "雍智科技", "semiconductor", [biz("test_socket", "core")]),
  company("2449", "京元電子", "semiconductor", [biz("semiconductor_test_service", "core")]),
  company("3711", "日月光投控", "semiconductor", [biz("osat", "core"), biz("semiconductor_test_service", "important")]),
  company("6239", "力成", "semiconductor", [biz("osat", "core"), biz("semiconductor_test_service", "important")]),
  company("6257", "矽格", "semiconductor", [biz("semiconductor_test_service", "core"), biz("osat", "important")]),
  company("3017", "奇鋐", "thermal", [biz("air_cooling", "core"), biz("liquid_cooling", "core"), biz("heat_pipe_vapor_chamber", "important"), biz("fan", "important")]),
  company("3324", "雙鴻", "thermal", [biz("air_cooling", "core"), biz("liquid_cooling", "core"), biz("heat_pipe_vapor_chamber", "important")]),
  company("2421", "建準", "thermal", [biz("fan", "core"), biz("air_cooling", "important")]),
  company("3653", "健策", "thermal", [biz("cold_plate", "core"), biz("liquid_cooling", "important"), biz("heat_pipe_vapor_chamber", "important")]),
  company("2308", "台達電", "power_electronics", [biz("power_supply", "core"), biz("server_psu", "important"), biz("liquid_cooling", "important"), biz("cdu", "important")]),
  company("6412", "群電", "power_electronics", [biz("power_supply", "core"), biz("server_psu", "important")]),
  company("2383", "台光電", "pcb", [biz("ccl", "core")]),
  company("6274", "台燿", "pcb", [biz("ccl", "core")]),
  company("3037", "欣興", "pcb", [biz("abf_substrate", "core"), biz("hdi", "important"), biz("general_pcb", "important")]),
  company("8046", "南電", "pcb", [biz("abf_substrate", "core"), biz("bt_substrate", "important"), biz("general_pcb", "important")]),
  company("3189", "景碩", "pcb", [biz("abf_substrate", "core"), biz("bt_substrate", "important")]),
  company("2368", "金像電", "pcb", [biz("general_pcb", "core"), biz("hdi", "important")]),
  company("1815", "富喬", "pcb", [biz("glass_fiber_cloth", "core")]),
  company("8358", "金居", "pcb", [biz("copper_foil", "core")]),
  company("3363", "上詮", "optical", [biz("fiber_component", "core"), biz("cpo", "important")]),
  company("6442", "光聖", "optical", [biz("fiber_component", "core"), biz("optical_transceiver", "important"), biz("cpo", "important")]),
  company("3163", "波若威", "optical", [biz("optical_module", "core"), biz("fiber_component", "important"), biz("cpo", "related")]),
  company("3081", "聯亞", "optical", [biz("epitaxy", "core"), biz("laser_vcsel", "important")]),
  company("4979", "華星光", "optical", [biz("laser_vcsel", "core"), biz("optical_transceiver", "important")]),
  company("2382", "廣達", "server", [biz("server_odm", "core"), biz("ai_server", "important")]),
  company("3231", "緯創", "server", [biz("server_odm", "core"), biz("ai_server", "important")]),
  company("6669", "緯穎", "server", [biz("server_odm", "core"), biz("ai_server", "core")]),
  company("2356", "英業達", "server", [biz("server_odm", "core"), biz("ai_server", "important")]),
  company("2376", "技嘉", "server", [biz("server_motherboard", "core"), biz("ai_server", "important")]),
  company("2059", "川湖", "server", [biz("server_rail", "core")]),
  company("8210", "勤誠", "server", [biz("server_chassis", "core")]),
  company("2301", "光寶科", "power_electronics", [biz("power_supply", "core"), biz("server_psu", "important")]),
  company("8996", "高力", "thermal", [biz("liquid_cooling", "core"), biz("cold_plate", "important")]),
]);

const BY_SYMBOL = new Map(COMPANIES.map((x) => [x.symbol, x]));
const BY_NAME = new Map(COMPANIES.map((x) => [normalizeCompanyName(x.name), x]));

// Official TWSE/TPEx industry labels used as the last-resort full-market technology fallback.
// The fallback is intentionally an "other" business bucket so broad sector names do not
// compete directly with fine tags such as CoWoS / CPO / ASIC in future Top-N voting.
const TECH_INDUSTRY_FALLBACKS = Object.freeze([
  { test: /半導體/, tagId: "semiconductor_other_business" },
  { test: /電子零組件/, tagId: "electronic_components_other" },
  { test: /電腦.*週邊|電腦及週邊/, tagId: "computer_peripheral_other" },
  { test: /光電/, tagId: "optoelectronics_other" },
  { test: /通信網路|通訊網路/, tagId: "communication_other" },
  { test: /資訊服務/, tagId: "information_service_other" },
  { test: /電子通路/, tagId: "electronic_distribution_other" },
  { test: /其他電子/, tagId: "other_electronics_business" },
  { test: /數位雲端|數位科技/, tagId: "digital_cloud_other" },
]);

function normalizeSymbol(value) {
  const match = String(value || "").trim().match(/\d{4,6}/);
  return match ? match[0] : String(value || "").trim();
}

function normalizeIndustry(value){
  return String(value||"").normalize("NFKC").replace(/\s+/g,"").trim();
}

function fallbackTagForIndustry(industry){
  const text=normalizeIndustry(industry);
  if(!text)return null;
  return TECH_INDUSTRY_FALLBACKS.find(x=>x.test.test(text))?.tagId||null;
}

function isTechnologyIndustry(industry){
  return Boolean(fallbackTagForIndustry(industry));
}

function getCompany(symbol) {
  return BY_SYMBOL.get(normalizeSymbol(symbol)) || null;
}

function getCompanyByName(name){
  return BY_NAME.get(normalizeCompanyName(name)) || null;
}

function listCompanies() {
  return [...COMPANIES];
}

function normalizeResolvedLinks(links, voteEligibleOnly=true){
  const out=[],seen=new Set();
  for(const link of links){
    if(!link?.id||seen.has(link.id))continue;
    const tag=getTag(link.id);
    if(!tag)continue;
    if(voteEligibleOnly&&!isVoteEligible(tag))continue;
    seen.add(link.id);
    out.push(Object.freeze({
      id:link.id,
      importance:link.importance||"important",
      origin:link.origin||"curated",
      name:tag.name,
      parent:tag.parent,
      voteEligible:tag.voteEligible,
      resolution:tag.resolution,
    }));
  }
  return out;
}

function resolveCompanyBusinessTags(profile={}, options={}){
  const symbol=normalizeSymbol(profile.symbol||profile.code||profile.stock_code||"");
  const name=String(profile.name||profile.stock_name||"").trim();
  const industry=String(profile.industry||profile.industry_name||"").trim();
  const voteEligibleOnly=options.voteEligibleOnly!==false;
  const links=[];
  const exact=getCompany(symbol)||getCompanyByName(name);
  if(exact){
    for(const x of exact.tags)links.push({...x,origin:"curated"});
  }
  const seedIds=tagsForCompanyName(name||exact?.name||"");
  for(const id of seedIds)links.push({id,importance:"related",origin:"official-chain"});
  let resolution=exact?"curated":seedIds.length?"official-chain":"none";
  if(!links.length){
    const fallback=fallbackTagForIndustry(industry);
    if(fallback){
      links.push({id:fallback,importance:"related",origin:"industry-fallback"});
      resolution="industry-fallback";
    }
  }
  const tags=normalizeResolvedLinks(links,voteEligibleOnly);
  return Object.freeze({
    symbol,
    name:name||exact?.name||"",
    industry,
    isTechnology:isTechnologyIndustry(industry)||Boolean(exact)||seedIds.length>0,
    resolution,
    tags:Object.freeze(tags),
  });
}

function listCompanyTags(symbol, options = {}) {
  const exact=getCompany(symbol);
  if(exact && !options.name && !options.industry){
    return normalizeResolvedLinks(exact.tags.map(x=>({...x,origin:"curated"})),options.voteEligibleOnly!==false);
  }
  return resolveCompanyBusinessTags({symbol,name:options.name||exact?.name||"",industry:options.industry||""},options).tags;
}

function listCompaniesByTag(tagId) {
  const id = String(tagId || "");
  return COMPANIES.filter((companyItem) =>
    companyItem.tags.some((x) => x.id === id)
  );
}

function getTagCoverage(options = {}) {
  const voteEligibleOnly = options.voteEligibleOnly !== false;
  const counts = new Map();
  for (const item of COMPANIES) {
    for (const link of item.tags) {
      const tag = getTag(link.id);
      if (!tag) continue;
      if (voteEligibleOnly && !isVoteEligible(tag)) continue;
      counts.set(link.id, (counts.get(link.id) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tagId, companyCount]) => {
      const tag = getTag(tagId);
      return Object.freeze({ tagId, name: tag?.name || tagId, companyCount });
    })
    .sort((a, b) => b.companyCount - a.companyCount || a.name.localeCompare(b.name, "zh-Hant"));
}

function getCoverageSummary() {
  const companyCount = COMPANIES.length;
  const relationCount = COMPANIES.reduce((sum, x) => sum + x.tags.length, 0);
  const representedTagCount = getTagCoverage().length;
  return Object.freeze({
    companyCount,
    relationCount,
    representedTagCount,
    officialChainSeedNames:seededCompanyNames.length,
    mode:"full-market-tech-with-fallback"
  });
}

function summarizeProfiles(profiles=[]){
  let techCompanies=0,curated=0,officialChain=0,industryFallback=0,unmappedTech=0,relations=0;
  const represented=new Set();
  for(const p of profiles){
    const resolved=resolveCompanyBusinessTags(p);
    if(!resolved.isTechnology)continue;
    techCompanies++;
    if(resolved.resolution==="curated")curated++;
    else if(resolved.resolution==="official-chain")officialChain++;
    else if(resolved.resolution==="industry-fallback")industryFallback++;
    else unmappedTech++;
    relations+=resolved.tags.length;
    for(const t of resolved.tags)represented.add(t.id);
  }
  const fineMapped=curated+officialChain;
  return Object.freeze({
    techCompanies,curated,officialChain,industryFallback,unmappedTech,
    fineMapped,fineMappedPct:techCompanies?Number((fineMapped/techCompanies*100).toFixed(1)):0,
    coveredPct:techCompanies?Number(((techCompanies-unmappedTech)/techCompanies*100).toFixed(1)):0,
    relations,representedTagCount:represented.size,
    officialChainSeedNames:seededCompanyNames.length
  });
}

module.exports = Object.freeze({
  version: "2.0.0",
  importanceLevels: IMPORTANCE,
  companies: COMPANIES,
  techIndustryFallbacks: TECH_INDUSTRY_FALLBACKS,
  normalizeSymbol,
  normalizeIndustry,
  getCompany,
  getCompanyByName,
  isTechnologyIndustry,
  fallbackTagForIndustry,
  resolveCompanyBusinessTags,
  listCompanies,
  listCompanyTags,
  listCompaniesByTag,
  getTagCoverage,
  getCoverageSummary,
  summarizeProfiles,
});
