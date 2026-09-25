// StockZone v2.6.4.0 — Market Topic Taxonomy layer
//
// Purpose
// - Keep the detailed business taxonomy intact for company/business evidence and search aliases.
// - Consolidate only the topics that Taiwan market participants usually trade together.
// - Keep independently traded themes (e.g. CoWoS / CoPoS / FOPLP / glass substrate) separate.
// - Use common market names instead of engineering-only names.
//
// This layer is consumed by Fundflow/XY. It does NOT delete the original business tags.

const { getTag, listVoteEligible } = require('./business-tags');

const IMPORTANCE_RANK = Object.freeze({ related:1, important:2, core:3 });
function normalizeName(v){
  return String(v||'').normalize('NFKC').trim().replace(/\s+/g,'').replace(/[＊*]/g,'').replace(/(?:-KY創|-KY|-DR|-創)$/i,'').replace(/(?:股份有限公司|有限公司|公司)$/,'');
}
function uniq(xs){return [...new Set((xs||[]).filter(Boolean).map(String))];}

// High-confidence market groups from the v2.6.3.5 taxonomy audit.
// `members` are detailed source tags. They remain available as aliases/roles but no longer
// need to produce separate XY lines when the market normally trades them as one group.
const TOPIC_SPECS = Object.freeze([
  {id:'thermal',name:'散熱',scope:'technology-fine',parentName:'科技',members:['air_cooling','liquid_cooling','cold_plate','cdu','quick_disconnect','fan','heat_pipe_vapor_chamber'],aliases:['氣冷','液冷','水冷','冷板','CDU','QD','快接頭','風扇','均熱板','Vapor Chamber']},
  {id:'passive',name:'被動元件',scope:'technology-fine',parentName:'科技',members:['mlcc','resistor','inductor','capacitor','crystal_oscillator','filter_oscillator','capacitor_foil','emc_protection_component','ferrite_magnetic_component'],aliases:['MLCC','電阻','電感','電容','石英元件','晶振','濾波器','EMC元件','磁性元件']},
  {id:'power_semiconductor',name:'功率半導體',scope:'technology-fine',parentName:'半導體',members:['mosfet','igbt','gan_power','sic_power','discrete_semiconductor'],aliases:['功率元件','MOSFET','IGBT','GaN','SiC','分離式半導體']},
  {id:'asic',name:'ASIC',scope:'technology-fine',parentName:'IC設計',members:['asic','asic_design_service'],aliases:['客製化晶片','客製晶片','ASIC設計服務']},
  {id:'high_speed_ic',name:'高速傳輸IC',scope:'technology-fine',parentName:'IC設計',members:['high_speed_ic','retimer'],aliases:['高速介面IC','Retimer','重定時器']},
  {id:'semiconductor_equipment',name:'半導體設備',scope:'technology-fine',parentName:'半導體',members:['wet_process_equipment','coating_develop_equipment','deposition_equipment','etch_equipment','bonding_equipment','laser_processing_equipment','semiconductor_automation_equipment','semiconductor_other_equipment','semiconductor_process_test_equipment','packaging_test_equipment','advanced_packaging_equipment'],aliases:['半導體製程設備','半導體檢測設備','封測設備','先進封裝設備','濕製程設備','蝕刻設備','沉積設備','鍵合設備','雷射設備']},
  {id:'semiconductor_material',name:'半導體材料',scope:'technology-fine',parentName:'半導體',members:['photoresist','cmp_slurry','specialty_gas','wet_chemicals','precursor','quartz_parts','silicon_parts','semiconductor_other_material','semiconductor_chemicals_materials'],aliases:['光阻','CMP材料','半導體特氣','電子化學品','前驅物','石英耗材','矽耗材']},
  {id:'it_services_market',name:'資服',scope:'technology-fine',parentName:'科技',members:['information_software_services','software_development','system_integration','data_processing','it_service'],aliases:['資訊服務','軟體服務','軟體開發','系統整合','SI','資料處理','IT Service']},
  {id:'cloud_market',name:'雲端',scope:'technology-fine',parentName:'科技',members:['digital_cloud_services','cloud_service'],aliases:['雲端服務','Cloud Service','數位雲端服務']},
  {id:'ems_odm',name:'電子代工',scope:'technology-fine',parentName:'科技',members:['electronics_manufacturing_services','ems_odm','pcba_ems'],aliases:['EMS','ODM','電子製造服務','PCBA','SMT組裝']},
  {id:'acoustic_component',name:'聲學元件',scope:'technology-fine',parentName:'電子產品',members:['audio_component','acoustic_component'],aliases:['音訊元件','揚聲器','喇叭','蜂鳴器','Buzzer']},
  {id:'cpo_silicon_photonics',name:'CPO／矽光子',scope:'technology-fine',parentName:'科技',members:['cpo','npo','silicon_photonics','optical_engine'],aliases:['CPO','NPO','矽光子','Silicon Photonics','光引擎']},
  {id:'optical_communication_market',name:'光通訊',scope:'technology-fine',parentName:'科技',members:['optical_module','optical_transceiver','laser_vcsel','fiber_component','optical_communication_equipment'],aliases:['光模組','光收發器','VCSEL','光纖元件','光通訊設備']},
  {id:'solar_market',name:'太陽能',scope:'traditional-coarse',parentName:'綠能',members:['solar_cell','solar_module','solar_system_engineering','solar_conductive_paste'],aliases:['太陽能電池','太陽能模組','太陽能電廠','Solar EPC','太陽能導電漿']},
  {id:'networking_market',name:'網通',scope:'technology-fine',parentName:'科技',members:['network_equipment','wired_communication_equipment','wireless_communication_equipment'],aliases:['網路設備','有線通訊設備','無線通訊設備','路由器','交換器']},
  {id:'panel_market',name:'面板',scope:'technology-fine',parentName:'電子產品',members:['lcd_panel','touch_panel','display_chemicals_materials','ito_substrate','backlight_source','display_frame','optical_film','backlight_module','display_module','display_process_test_equipment','cover_glass','display_device','precision_metal_mask'],aliases:['LCD','觸控面板','背光模組','顯示器模組','面板設備','Cover Glass','顯示器']},
  {id:'automation_market',name:'自動化設備',scope:'technology-fine',parentName:'科技',members:['factory_automation','automation_machine','machine_vision'],aliases:['工廠自動化','自動化機台','機器視覺','FA']},
  {id:'semiconductor_test_equipment_market',name:'半導體測試設備',scope:'technology-fine',parentName:'半導體',members:['ate','handler'],aliases:['ATE','測試分選機','Handler']},
  {id:'test_interface_market',name:'測試介面',scope:'technology-fine',parentName:'半導體',members:['probe_card','test_socket'],aliases:['探針卡','Probe Card','測試座','Test Socket']},
  {id:'glass_substrate',name:'玻璃基板',scope:'technology-fine',parentName:'先進封裝',members:['glass_substrate'],aliases:['TGV','Glass Core','玻璃核心基板','玻璃載板','玻璃穿孔'],companySeeds:['台玻','群創','東捷','雷科','鈦昇','創新服務','悅城']},
  {id:'osat',name:'封測',scope:'technology-fine',parentName:'半導體',members:['osat','semiconductor_test_service','burn_in'],aliases:['OSAT','封裝測試','IC測試','晶片測試','老化測試','Burn-in']},
  {id:'power_supply',name:'電源供應器',scope:'technology-fine',parentName:'科技',members:['server_psu','power_supply'],aliases:['PSU','Server PSU','伺服器電源']},
  {id:'high_speed_transmission_market',name:'高速傳輸',scope:'technology-fine',parentName:'科技',members:['high_speed_connector','server_cable'],aliases:['高速連接器','高速線材','高速傳輸線']},
  // Legacy topic kept searchable as one bucket, but excluded from Fundflow because it is no longer an active rotation theme.
  {id:'optical_storage_market',name:'光儲存',scope:'electronics-product',parentName:'電子產品',members:['optical_drive','optical_disc'],aliases:['光碟機','光碟片'],active:false},

  // Missing market themes found in the audit. These are direct market overlays with explicit company seeds.
  {id:'bbu',name:'BBU',scope:'technology-fine',parentName:'科技',members:[],aliases:['備援電池模組','Battery Backup Unit','伺服器BBU'],companySeeds:['AES-KY','新普','順達','新盛力','系統電','台達電','光寶科'],sourceUrl:'https://money.udn.com/money/story/11162/9617815'},
  {id:'dc800',name:'800VDC',scope:'technology-fine',parentName:'科技',members:[],aliases:['800V DC','800V直流供電','HVDC'],companySeeds:['台達電','光寶科','康舒','順達','新盛力'],sourceUrl:'https://money.udn.com/money/story/5612/9695336'},
  {id:'leo_satellite',name:'低軌衛星',scope:'technology-fine',parentName:'科技',members:[],aliases:['LEO','Starlink','衛星通訊'],companySeeds:['華通','昇達科','金寶','台燿','中美晶','攸泰科技','事欣科'],sourceUrl:'https://money.udn.com/money/story/12040/9732923'},
  {id:'drone',name:'無人機',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['Drone','UAV','無人載具'],companySeeds:['雷虎','長榮航太','中光電','銘旺科','漢翔','龍德造船','亞航'],sourceUrl:'https://money.udn.com/money/story/5612/9605989'},
  {id:'heavy_electrical',name:'重電',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['重電設備','電力設備'],companySeeds:['士電','亞力','中興電','華城','東元'],sourceUrl:'https://money.udn.com/money/story/5612/9718832'},
  {id:'robot',name:'機器人',scope:'technology-fine',parentName:'科技',members:['industrial_robot'],aliases:['Robot','人形機器人','協作型機器人','機械手臂'],companySeeds:['上銀','大銀微系統','新代','和椿','台達電','達明','所羅門','全球傳動','直得','羅昇','富田','盟立','亞光','和大','宇隆','維田'],sourceUrl:'https://money.udn.com/money/story/5607/9696705'},
  {id:'machine_tool',name:'工具機',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['工具機族群','Machine Tool'],companySeeds:['上銀','程泰','東台','高鋒','瀧澤科','恩德','福裕','協易機','直得','全球傳動','百德','亞崴','喬福','大銀微系統'],sourceUrl:'https://money.udn.com/money/story/5612/9627894'},
  {id:'ai_pc',name:'AI PC',scope:'electronics-product',parentName:'電子產品',members:[],aliases:['AIPC','AI筆電','AI電腦'],companySeeds:['華碩','宏碁','仁寶','廣達','鴻海','緯創','英業達','技嘉','微星'],sourceUrl:'https://money.udn.com/money/story/5607/9546432'},
]);

const SPEC_BY_ID = new Map(TOPIC_SPECS.map(x=>[x.id,x]));
const SOURCE_TO_TOPIC = new Map();
for(const spec of TOPIC_SPECS){
  for(const id of spec.members||[]){
    if(SOURCE_TO_TOPIC.has(id)) throw new Error(`market topic source duplicated: ${id}`);
    SOURCE_TO_TOPIC.set(id,spec.id);
  }
}

function rawTagTechnology(tagId){
  let item=getTag(tagId),guard=0;
  while(item&&guard++<12){if(item.id==='tech')return true;item=item.parent?getTag(item.parent):null;}
  return false;
}
function rawDefinition(tag){
  const technology=rawTagTechnology(tag.id);
  return Object.freeze({
    id:tag.id,name:tag.name,parentId:tag.parent||'',parentName:tag.parent?getTag(tag.parent)?.name||'':'',
    aliases:Object.freeze([...(tag.aliases||[])]),scope:technology?'technology-fine':'traditional-coarse',technology,
    sourceTagIds:Object.freeze([tag.id]),active:true,synthetic:false,resolution:tag.resolution||'fine',kind:tag.kind||'business'
  });
}
function buildSpecDefinition(spec){
  const sourceAliases=[];
  for(const id of spec.members||[]){const t=getTag(id);if(t)sourceAliases.push(t.name,...(t.aliases||[]));}
  const scope=spec.scope||'technology-fine';
  return Object.freeze({
    id:spec.id,name:spec.name,parentId:'',parentName:spec.parentName||'',aliases:Object.freeze(uniq([...(spec.aliases||[]),...sourceAliases])),
    scope,technology:scope==='technology-fine'||scope==='electronics-product',sourceTagIds:Object.freeze([...(spec.members||[])]),
    active:spec.active!==false,synthetic:true,resolution:'market-topic',kind:'market-topic',companySeeds:Object.freeze([...(spec.companySeeds||[])]),sourceUrl:spec.sourceUrl||''
  });
}
const TOPIC_DEFINITIONS = new Map(TOPIC_SPECS.map(s=>[s.id,buildSpecDefinition(s)]));

function marketDefinitionForSource(tagId){
  const topicId=SOURCE_TO_TOPIC.get(String(tagId||''));
  if(topicId)return TOPIC_DEFINITIONS.get(topicId)||null;
  const tag=getTag(tagId);return tag?rawDefinition(tag):null;
}
function marketDefinitionById(id){
  if(TOPIC_DEFINITIONS.has(id))return TOPIC_DEFINITIONS.get(id);
  const tag=getTag(id);return tag?rawDefinition(tag):null;
}
function listMarketDefinitions({activeOnly=true}={}){
  const out=[];
  for(const d of TOPIC_DEFINITIONS.values())if(!activeOnly||d.active)out.push(d);
  for(const tag of listVoteEligible()){
    if(SOURCE_TO_TOPIC.has(tag.id))continue;
    if(TOPIC_DEFINITIONS.has(tag.id))continue;
    const d=rawDefinition(tag);if(!activeOnly||d.active)out.push(d);
  }
  return out.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
}
function marketTopicLinks(rawLinks=[],companyName=''){
  const byId=new Map();
  function add(def,importance='related',origin='market-topic',sourceTagId=''){
    if(!def||def.active===false)return;
    const current=byId.get(def.id),nextRank=IMPORTANCE_RANK[importance]||1,curRank=IMPORTANCE_RANK[current?.importance]||0;
    if(!current||nextRank>curRank){
      byId.set(def.id,{id:def.id,name:def.name,parent:null,parentName:def.parentName||'',importance,origin,resolution:def.resolution||'market-topic',technology:Boolean(def.technology),scope:def.scope,aliases:def.aliases||[],sourceTagIds:sourceTagId?[sourceTagId]:[]});
    }else if(sourceTagId&&!current.sourceTagIds.includes(sourceTagId))current.sourceTagIds.push(sourceTagId);
  }
  for(const link of rawLinks||[]){
    const def=marketDefinitionForSource(link.id);if(!def)continue;add(def,link.importance||'related',link.origin||'business-tag',link.id);
  }
  const key=normalizeName(companyName);
  if(key){
    for(const def of TOPIC_DEFINITIONS.values()){
      if(def.active===false||!(def.companySeeds||[]).length)continue;
      if(def.companySeeds.some(n=>normalizeName(n)===key))add(def,'related','market-topic-audit','');
    }
  }
  return [...byId.values()];
}

function auditSummary(){
  const defs=listMarketDefinitions(),synthetic=defs.filter(x=>x.synthetic),raw=defs.filter(x=>!x.synthetic);
  return {definitions:defs.length,synthetic:synthetic.length,raw:raw.length,mergedSourceTags:SOURCE_TO_TOPIC.size,directSeedTopics:synthetic.filter(x=>(x.companySeeds||[]).length).length};
}

module.exports=Object.freeze({
  version:'1.0.1',TOPIC_SPECS,listMarketDefinitions,marketDefinitionById,marketDefinitionForSource,marketTopicLinks,auditSummary,normalizeName
});
