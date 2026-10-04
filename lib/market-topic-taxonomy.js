// StockZone v2.6.6.10 — Market Topic Taxonomy layer
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
  return String(v||'').normalize('NFKC').trim()
    .replace(/\s+/g,'')
    .replace(/[＊*]/g,'')
    .replace(/(?:-KY創|-KY|-DR|-創)$/i,'')
    .replace(/(?:股份有限公司|有限公司|公司)$/,'')
    // Preserve market-topic continuity when an existing listed company is replaced by
    // a holding-company listing (e.g. 中光電 5371 -> 中光電投控 3718).
    // Both the seed name and the live profile name pass through this same normalizer.
    .replace(/(?:投資控股|投控|控股)$/,'');
}
function uniq(xs){return [...new Set((xs||[]).filter(Boolean).map(String))];}
function cleanEvidenceText(v){return String(v||'').normalize('NFKC').replace(/\u3000/g,' ').replace(/\s+/g,' ').trim();}
function parseAutoMarketTopics(value){
  if(Array.isArray(value))return value.map(String).map(x=>x.trim()).filter(Boolean);
  if(value&&typeof value==='object'){
    if(Array.isArray(value.topics))return value.topics.map(String).map(x=>x.trim()).filter(Boolean);
    if(Array.isArray(value.ids))return value.ids.map(String).map(x=>x.trim()).filter(Boolean);
    return [];
  }
  const raw=String(value||'').trim();if(!raw)return [];
  try{const j=JSON.parse(raw);return parseAutoMarketTopics(j);}catch{return []}
}

// Blind Coverage Engine v1 — direct market-topic evidence.
// Raw product/business tags are still discovered by business-enrichment.js. These rules are for
// themes that are commonly traded as a market topic but do not always map 1:1 to one raw business tag.
// A score >= 85 is safe for automatic additive assignment; 60–84 is audit-only.
const TOPIC_EVIDENCE_RULES=Object.freeze({
  glass_substrate:{strong:[/\bTGV\b/iu,/glass\s*(?:core|substrate|via|interposer)/iu,/玻璃(?:核心)?基板/iu,/玻璃(?:載板|中介層|通孔|穿孔)/iu],support:[/先進封裝|封裝|鑽孔|雷射|電鍍|填孔|蝕刻|檢測/iu]},
  foplp:{strong:[/\bFOPLP\b/iu,/fan[- ]?out\s*panel[- ]?level/iu,/面板級封裝/iu,/扇出型面板級封裝/iu],support:[/先進封裝|封裝設備|RDL|重佈線/iu]},
  cowos:{strong:[/\bCoWoS\b/iu,/chip[- ]?on[- ]?wafer[- ]?on[- ]?substrate/iu],support:[/先進封裝|2\.5D|interposer|中介層/iu]},
  copos:{strong:[/\bCoPoS\b/iu],support:[/先進封裝|panel|面板/iu]},
  soic:{strong:[/\bSoIC\b/iu],support:[/先進封裝|3D封裝|混合鍵合/iu]},
  cpo_silicon_photonics:{strong:[/\bCPO\b/iu,/co[- ]?packaged\s*optics/iu,/矽光子/iu,/silicon\s*photonics/iu],support:[/光通訊|光引擎|共同封裝光學/iu]},
  bbu:{strong:[/\bBBU\b/iu,/battery\s*backup\s*unit/iu,/備援電池(?:模組|系統)?/iu,/800\s*V\s*DC/iu,/800VDC/iu,/800伏.*直流/iu,/\bHVDC\b/iu],support:[/伺服器|server|資料中心|data\s*center|電池模組|電源架構/iu]},
  leo_satellite:{strong:[/低軌衛星/iu,/low[- ]?earth[- ]?orbit/iu,/\bLEO\b.*(?:satellite|衛星)/iu,/Starlink/iu],support:[/衛星通訊|衛星終端|satellite\s*communication/iu]},
  drone:{strong:[/無人機/iu,/\bUAV\b/iu,/\bdrone\b/iu,/無人載具/iu],support:[/飛控|航太|軍工/iu]},
  heavy_electrical:{strong:[/重電/iu],support:[/變壓器/iu,/GIS/iu,/配電盤/iu,/開關設備/iu,/輸配電/iu,/電網/iu,/電力設備/iu]},
  robot:{strong:[/人形機器人/iu,/協作型機器人/iu,/工業機器人/iu,/機械手臂/iu,/服務型機器人/iu,/智能服務機器人/iu,/AI影像機器人/iu],support:[/機器人/iu,/robot/iu,/自動化/iu]},
  machine_tool:{strong:[/工具機/iu,/加工中心機?/iu,/CNC.*(?:車床|銑床|工具機)/iu],support:[/車床/iu,/銑床/iu,/磨床/iu,/數控/iu]},
  ai_pc:{strong:[/\bAI\s*PC\b/iu,/AI筆電/iu,/AI電腦/iu,/Copilot\+?\s*PC/iu],support:[/NPU/iu,/筆記型電腦|notebook|laptop|PC/iu]},
  consumer_brand_device:{strong:[/平板電腦/iu,/\btablet(?:\s*PC)?\b/iu,/\biPad\b/iu,/智慧手機/iu,/行動電話/iu,/手機(?:產品|終端|整機)/iu,/\bsmartphone\b/iu,/mobile\s*(?:phone|device)/iu,/穿戴式?裝置/iu,/智慧手錶/iu,/智慧手環/iu,/\bwearable(?:\s*device)?\b/iu,/smart\s*watch/iu,/遊戲主機/iu,/電玩主機/iu,/game\s*console/iu,/智慧家庭(?:產品|設備|裝置)?/iu,/智慧家居(?:產品|設備|裝置)?/iu,/smart\s*home/iu,/藍牙耳機/iu,/真無線耳機/iu,/頭戴式耳機/iu,/\bheadphones?\b/iu,/消費(?:性)?音響/iu,/數位相機/iu,/運動相機/iu,/攝影機/iu,/digital\s*camera/iu,/action\s*camera/iu],support:[/消費性電子|終端產品|智慧裝置|行動裝置|遊戲硬體|影音產品|影像產品|IoT/iu]},
  thermal:{strong:[/液冷/iu,/水冷/iu,/cold\s*plate/iu,/冷板/iu,/\bCDU\b/iu,/散熱模組/iu,/散熱元件/iu,/均熱板/iu,/vapor\s*chamber/iu],support:[/散熱/iu,/伺服器|server|資料中心/iu]},
  power_semiconductor:{strong:[/\bMOSFET\b/iu,/\bIGBT\b/iu,/碳化矽|\bSiC\b/iu,/氮化鎵|\bGaN\b/iu,/功率半導體/iu,/功率元件/iu],support:[/功率IC|電源管理/iu]},
  passive:{strong:[/\bMLCC\b/iu,/積層陶瓷電容/iu],support:[/被動元件/iu,/電阻|電感|電容|晶振|石英元件/iu]},
  semiconductor_test_equipment_market:{strong:[/晶圓測試卡/iu,/IC測試板/iu,/測試載板/iu,/探針用測試治具/iu,/半導體測試探針/iu,/IC測試探針/iu,/\bATE\b/iu,/測試分選機/iu,/\bhandler\b/iu],support:[/探針卡|probe card|test socket|測試座|半導體測試/iu]},
  optical_communication_market:{strong:[/光通訊(?:產品|元件|模組|設備|系統)/iu,/光纖通訊(?:產品|元件|模組|設備|系統)/iu,/光收發(?:器|模組)/iu],support:[/光纖|雷射|檢光器|資料中心/iu]},
  semiconductor_equipment:{strong:[/半導體設備(?:及|與|相關|零組件|之|製造|設計|維修|安裝|買賣)/iu,/晶圓(?:製程)?設備/iu],support:[/設備|精密傳動|自動化/iu]},
  semiconductor_material:{strong:[/電子級化學品/iu,/半導體(?:特氣|材料|化學品)/iu,/高純度半導體材料/iu],support:[/純化|化學品|材料/iu]},
});

function detectMarketTopicEvidence(text,{minScore=0}={}){
  const t=cleanEvidenceText(text);if(!t)return [];
  const out=[];
  for(const [id,rule] of Object.entries(TOPIC_EVIDENCE_RULES)){
    const strong=(rule.strong||[]).filter(re=>re.test(t)).map(re=>re.source);
    const support=(rule.support||[]).filter(re=>re.test(t)).map(re=>re.source);
    if(!strong.length){
      // Some market groups are commonly described as a product cluster instead of the market nickname.
      if(id==='heavy_electrical'&&support.length>=2){
        const score=Math.min(84,60+support.length*6);if(score>=minScore)out.push({id,score,terms:support,kind:'support-cluster'});
      }
      if(id==='machine_tool'&&support.length>=2){
        const score=Math.min(92,85+(support.length-2)*3);if(score>=minScore)out.push({id,score,terms:support,kind:'support-cluster'});
      }
      continue;
    }
    const score=Math.min(100,85+(strong.length-1)*7+Math.min(8,support.length*3));
    if(score>=minScore)out.push({id,score,terms:uniq([...strong,...support]),kind:'strong'});
  }
  // Generic exact-name/alias hints are audit-only. They never reach the auto-assign threshold by themselves.
  // Skip ambiguous phrases that create obvious false candidates (e.g. 背光模組 contains 光模組,
  // 熱交換器 contains 交換器, and generic 電子零組件 says almost nothing about a market theme).
  const noisyAuditAliases=new Set(['電子零組件','電子零組件製造','顯示器','LCD','交換器','光模組','被動元件','ODM','OEM','IC測試','驅動IC']);
  for(const def of listMarketDefinitions({activeOnly:true})){
    if(out.some(x=>x.id===def.id))continue;
    const candidates=uniq([def.name,...(def.aliases||[])]).filter(x=>{
      const c=cleanEvidenceText(x);return c.length>=3&&!['科技','金融','傳產','其他產業','機械','化工','塑化','綠能'].includes(c)&&!noisyAuditAliases.has(c);
    });
    const hits=candidates.filter(x=>{
      const c=cleanEvidenceText(x);if(!c)return false;
      if(/^[A-Za-z0-9+\-./ ]+$/.test(c)){
        const esc=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(?:^|[^A-Za-z0-9])${esc}(?:$|[^A-Za-z0-9])`,'i').test(t);
      }
      return t.includes(c);
    });
    if(hits.length){const score=Math.min(78,60+Math.min(18,hits.length*6));if(score>=minScore)out.push({id:def.id,score,terms:hits,kind:'alias-hint'});}
  }
  return out.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}

// High-confidence market groups from the v2.6.3.5 taxonomy audit.
// `members` are detailed source tags. They remain available as aliases/roles but no longer
// need to produce separate XY lines when the market normally trades them as one group.
const TOPIC_SPECS = Object.freeze([
  {id:'thermal',name:'散熱',scope:'technology-fine',parentName:'科技',members:['air_cooling','liquid_cooling','cold_plate','cdu','quick_disconnect','fan','heat_pipe_vapor_chamber'],aliases:['氣冷','液冷','水冷','冷板','CDU','QD','快接頭','風扇','均熱板','Vapor Chamber']},
  {id:'passive',name:'被動元件',scope:'technology-fine',parentName:'科技',members:['mlcc','resistor','inductor','capacitor','crystal_oscillator','filter_oscillator','capacitor_foil','emc_protection_component','ferrite_magnetic_component'],aliases:['MLCC','電阻','電感','電容','石英元件','晶振','濾波器','EMC元件','磁性元件']},
  {id:'power_semiconductor',name:'功率半導體',scope:'technology-fine',parentName:'半導體',members:['mosfet','igbt','gan_power','sic_power','discrete_semiconductor'],aliases:['功率元件','MOSFET','IGBT','GaN','SiC','分離式半導體'],referenceSeeds:['大中','尼克森','朋程','力士'],referenceSymbols:['6435','3317','8255','4923'],referenceSourceUrl:'https://money.udn.com/money/story/5607/9580503'},
  // Conservative de-duplication: merge only market lines whose static seed membership is almost the same.
  // Detailed source tags are preserved for search/evidence; only the Fundflow market-topic line is consolidated.
  {id:'mature_foundry',name:'成熟／特殊製程晶圓代工',scope:'technology-fine',parentName:'晶圓製造與製程',members:['mature_foundry','specialty_process'],aliases:['成熟製程代工','特殊製程','Specialty Process']},
  {id:'fpcb',name:'FPCB／軟硬結合板',scope:'technology-fine',parentName:'PCB與載板',members:['fpcb','rigid_flex'],aliases:['FPCB','軟板','柔性印刷電路板','軟硬結合板','Rigid-Flex']},
  {id:'abf_substrate',name:'IC載板／ABF／BT',scope:'technology-fine',parentName:'PCB與載板',members:['abf_substrate','bt_substrate','ic_substrate'],aliases:['IC載板','ABF載板','ABF','BT載板','BT','封裝載板'],companySeeds:['欣興','景碩','南電','臻鼎-KY'],companySymbols:['3037','3189','8046','4958']},
  {id:'ccl',name:'PCB材料／CCL／銅箔／玻纖布',scope:'technology-fine',parentName:'PCB與載板',members:['ccl','copper_foil','glass_fiber_cloth'],aliases:['PCB材料','CCL','銅箔基板','銅箔','玻纖布','玻璃纖維布']},
  {id:'server_chassis',name:'伺服器機殼／機櫃／滑軌',scope:'technology-fine',parentName:'伺服器與資料中心',members:['server_chassis','server_rack','server_rail'],aliases:['Server Chassis','伺服器機殼','伺服器機櫃','Server Rack','機櫃','伺服器滑軌','Server Rail','滑軌']},
  {id:'ai_server',name:'AI伺服器／Server ODM',scope:'technology-fine',parentName:'伺服器與資料中心',members:['ai_server','server_odm','server_motherboard','server_system'],aliases:['AI Server','伺服器','Server System','Server ODM','伺服器代工','伺服器主機板','Server Motherboard']},
  {id:'automotive_electronics',name:'車用電子／感測',scope:'technology-fine',parentName:'電子製造與通路',members:['automotive_electronics','automotive_sensor'],aliases:['車用電子','車用電裝','車用感測器','TPMS','胎壓感測']},
  {id:'mini_led',name:'Mini／Micro LED',scope:'technology-fine',parentName:'顯示與面板',members:['mini_led','micro_led'],aliases:['Mini LED','MiniLED','Micro LED','MicroLED']},
  {id:'ic_distribution',name:'電子／IC通路',scope:'technology-fine',parentName:'電子製造與通路',members:['ic_distribution','electronic_distribution_business'],aliases:['IC通路','IC經銷','電子通路','電子零組件通路']},
  {id:'asic',name:'ASIC',scope:'technology-fine',parentName:'IC設計',members:['asic','asic_design_service'],aliases:['客製化晶片','客製晶片','ASIC設計服務']},
  {id:'high_speed_ic',name:'高速傳輸IC',scope:'technology-fine',parentName:'IC設計',members:['high_speed_ic','retimer'],aliases:['高速介面IC','Retimer','重定時器']},
  {id:'semiconductor_equipment',name:'半導體設備',scope:'technology-fine',parentName:'半導體',members:['wet_process_equipment','coating_develop_equipment','deposition_equipment','etch_equipment','bonding_equipment','laser_processing_equipment','semiconductor_automation_equipment','semiconductor_other_equipment','semiconductor_process_test_equipment','packaging_test_equipment','advanced_packaging_equipment'],aliases:['半導體製程設備','半導體檢測設備','封測設備','先進封裝設備','濕製程設備','蝕刻設備','沉積設備','鍵合設備','雷射設備']},
  {id:'semiconductor_material',name:'半導體材料',scope:'technology-fine',parentName:'半導體',members:['photoresist','cmp_slurry','specialty_gas','wet_chemicals','precursor','quartz_parts','silicon_parts','semiconductor_other_material','semiconductor_chemicals_materials'],aliases:['光阻','CMP材料','半導體特氣','電子化學品','前驅物','石英耗材','矽耗材']},
  {id:'it_services_market',name:'資服／雲端',scope:'technology-fine',parentName:'科技',members:['information_software_services','software_development','system_integration','data_processing','it_service','digital_cloud_services','cloud_service'],aliases:['資訊服務','軟體服務','軟體開發','系統整合','SI','資料處理','IT Service','雲端','雲端服務','Cloud Service','數位雲端服務']},
  {id:'ems_odm',name:'電子代工',scope:'technology-fine',parentName:'科技',members:['electronics_manufacturing_services','ems_odm','pcba_ems'],aliases:['EMS','ODM','電子製造服務','PCBA','SMT組裝']},
  {id:'acoustic_component',name:'聲學元件',scope:'technology-fine',parentName:'消費性電子',members:['audio_component','acoustic_component'],aliases:['音訊元件','揚聲器','喇叭','蜂鳴器','Buzzer']},
  {id:'cpo_silicon_photonics',name:'CPO／矽光子',scope:'technology-fine',parentName:'科技',members:['cpo','npo','silicon_photonics','optical_engine'],aliases:['CPO','NPO','矽光子','Silicon Photonics','光引擎'],companySeeds:['鴻勁'],companySymbols:['7769'],referenceSeeds:['台積電','訊芯-KY','日月光投控','聯鈞','眾達-KY','華星光','全新','IET-KY','環宇-KY','光環','智邦','穎崴','旺矽','精測','創威','聯光通'],referenceSymbols:['2330','6451','3711','3450','4977','4979','2455','4971','4991','3234','2345','6515','6223','6510','6530','4903'],referenceSourceUrl:'https://money.udn.com/money/story/124512/9716792'},
  {id:'optical_communication_market',name:'光通訊',scope:'technology-fine',parentName:'科技',members:['optical_module','optical_transceiver','laser_vcsel','fiber_component','optical_communication_equipment'],aliases:['光模組','光收發器','VCSEL','光纖元件','光通訊設備']},
  {id:'solar_market',name:'太陽能',scope:'traditional-coarse',parentName:'綠能',members:['solar_cell','solar_module','solar_system_engineering','solar_conductive_paste'],aliases:['太陽能電池','太陽能模組','太陽能電廠','Solar EPC','太陽能導電漿']},
  {id:'networking_market',name:'網通',scope:'technology-fine',parentName:'科技',members:['network_equipment','wired_communication_equipment','wireless_communication_equipment'],aliases:['網路設備','有線通訊設備','無線通訊設備','路由器','交換器']},
  {id:'panel_market',name:'面板',scope:'technology-fine',parentName:'消費性電子',members:['lcd_panel','touch_panel','display_chemicals_materials','ito_substrate','backlight_source','display_frame','optical_film','backlight_module','display_module','display_process_test_equipment','cover_glass','precision_metal_mask'],aliases:['LCD','觸控面板','背光模組','顯示器模組','面板設備','Cover Glass','顯示器']},
  {id:'automation_market',name:'自動化設備',scope:'technology-fine',parentName:'科技',members:['factory_automation','automation_machine','machine_vision'],aliases:['工廠自動化','自動化機台','機器視覺','FA']},
  {id:'semiconductor_test_equipment_market',name:'半導體測試／介面',scope:'technology-fine',parentName:'半導體',members:['ate','handler','probe_card','test_socket'],aliases:['ATE','測試分選機','Handler','測試介面','探針卡','Probe Card','測試座','Test Socket']},
  {id:'cowos',name:'CoWoS',scope:'technology-fine',parentName:'先進封裝',members:['cowos'],aliases:['Chip-on-Wafer-on-Substrate'],referenceSeeds:['日月光投控','京元電子','鈦昇','盟立','均豪','漢唐','洋基工程','帆宣'],referenceSymbols:['3711','2449','8027','2464','5443','2404','6691','6196'],referenceSourceUrl:'https://money.udn.com/money/story/5612/7332224'},
  {id:'foplp',name:'FOPLP',scope:'technology-fine',parentName:'先進封裝',members:['foplp'],aliases:['面板級封裝','Panel Level Packaging','PLP'],companySeeds:['群創','晶彩科','由田','辛耘','弘塑','鈦昇','群翊','東捷','均豪','志聖','萬潤'],companySymbols:['3481','3535','3455','3583','3131','8027','6664','8064','5443','2467','6187']},
  {id:'glass_substrate',name:'玻璃基板',scope:'technology-fine',parentName:'先進封裝',members:['glass_substrate'],aliases:['TGV','Glass Core','Glass Substrate','Glass Interposer','玻璃核心基板','玻璃載板','玻璃中介層','玻璃穿孔'],companySeeds:['台玻','群創','東捷','雷科','鈦昇','創新服務','悅城','欣興','臻鼎-KY','TPK-KY','正達','晶呈科技','川寶','群翊','友威科','蔚華科','南電','景碩'],companySymbols:['1802','3481','8064','6207','8027','7828','6405','3037','4958','3673','3149','4768','1595','6664','3580','3055','8046','3189'],referenceSeeds:['友達','富喬','辛耘','弘塑','志聖','牧德','日月光投控'],referenceSymbols:['2409','1815','3583','3131','2467','3563','3711'],sourceUrl:'https://www.managertoday.com.tw/articles/view/72588',referenceSourceUrl:'https://www.businessweekly.com.tw/business/blog/3021521'},
  {id:'osat',name:'封測',scope:'technology-fine',parentName:'半導體',members:['osat','semiconductor_test_service','burn_in'],aliases:['OSAT','封裝測試','IC測試','晶片測試','老化測試','Burn-in']},
  {id:'power_supply',name:'電源供應器',scope:'technology-fine',parentName:'科技',members:['server_psu','power_supply'],aliases:['PSU','Server PSU','伺服器電源']},
  {id:'high_speed_transmission_market',name:'高速傳輸',scope:'technology-fine',parentName:'科技',members:['high_speed_connector','server_cable'],aliases:['高速連接器','高速線材','高速傳輸線']},
  // Legacy topic kept searchable as one bucket, but excluded from Fundflow because it is no longer an active rotation theme.
  {id:'optical_storage_market',name:'光儲存',scope:'electronics-product',parentName:'消費性電子',members:['optical_drive','optical_disc'],aliases:['光碟機','光碟片'],active:false},

  // Missing market themes found in the audit. These are direct market overlays with explicit company seeds.
  {id:'bbu',name:'AI資料中心電源／BBU／800VDC',scope:'technology-fine',parentName:'科技',members:[],aliases:['BBU','備援電池模組','Battery Backup Unit','伺服器BBU','800VDC','800V DC','800V直流供電','HVDC'],companySeeds:['AES-KY','新普','順達','新盛力','系統電','台達電','光寶科','康舒'],referenceSeeds:['加百裕','興能高'],referenceSymbols:['3323','6558'],sourceUrl:'https://money.udn.com/money/story/11162/9617815',referenceSourceUrl:'https://money.udn.com/money/story/5612/9695336'},
  {id:'leo_satellite',name:'低軌衛星',scope:'technology-fine',parentName:'科技',members:[],aliases:['LEO','Starlink','衛星通訊'],companySeeds:['華通','昇達科','金寶','台燿','中美晶','攸泰科技','事欣科'],referenceSeeds:['台揚','兆赫','稜研科技','啟碁','穩懋','聯茂','敬鵬','金像電','燿華','智易','友訊'],referenceSymbols:['2314','2485','7812','6285','3105','6213','2355','2368','2367','3596','2332'],sourceUrl:'https://money.udn.com/money/story/12040/9732923',referenceSourceUrl:'https://money.udn.com/money/story/5607/9554547'},
  {id:'drone',name:'無人機',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['Drone','UAV','無人載具'],companySeeds:['雷虎','長榮航太','中光電','銘旺科','漢翔','龍德造船','亞航'],sourceUrl:'https://money.udn.com/money/story/5612/9605989'},
  {id:'heavy_electrical',name:'重電',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['重電設備','電力設備'],companySeeds:['士電','亞力','中興電','華城','東元'],sourceUrl:'https://money.udn.com/money/story/5612/9718832'},
  {id:'robot',name:'機器人',scope:'technology-fine',parentName:'科技',members:['industrial_robot'],aliases:['Robot','人形機器人','協作型機器人','機械手臂'],companySeeds:['上銀','大銀微系統','新代','和椿','台達電','達明','所羅門','全球傳動','直得','羅昇','富田','盟立','亞光','和大','宇隆','維田'],referenceSeeds:['氣立'],referenceSymbols:['4555'],sourceUrl:'https://money.udn.com/money/story/5607/9696705',referenceSourceUrl:'https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=f933aeee-bc0c-4797-afe8-fcebf6f04cbf'},
  {id:'machine_tool',name:'工具機',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['工具機族群','Machine Tool'],companySeeds:['上銀','程泰','東台','高鋒','瀧澤科','恩德','福裕','協易機','直得','全球傳動','百德','亞崴','喬福','大銀微系統'],sourceUrl:'https://money.udn.com/money/story/5612/9627894'},
  {id:'ai_pc',name:'AI PC',scope:'electronics-product',parentName:'消費性電子',members:[],aliases:['AIPC','AI筆電','AI電腦'],companySeeds:['華碩','宏碁','仁寶','廣達','鴻海','緯創','英業達','技嘉','微星'],sourceUrl:'https://money.udn.com/money/story/5607/9546432'},
  // Consumer/end-device layer: only products people directly buy/use. Upstream materials, foundry, PCB, thermal, PMIC and server infrastructure stay outside this scope.
  {id:'consumer_notebook',name:'PC／Notebook',scope:'electronics-product',parentName:'消費性電子',members:['notebook_pc','desktop_pc'],aliases:['筆記型電腦','Laptop','Notebook PC','桌上型電腦','Desktop PC']},
  {id:'consumer_peripherals',name:'Consumer Peripherals',scope:'electronics-product',parentName:'消費性電子',members:['keyboard_input_device','computer_peripheral_business','flash_storage_device','card_reader','graphics_card'],aliases:['消費性週邊','電腦週邊','鍵盤','滑鼠','記憶卡','隨身碟','讀卡機','顯示卡']},
  {id:'consumer_brand_device',name:'消費電子終端',scope:'electronics-product',parentName:'消費性電子',members:['consumer_electronics','display_device'],aliases:['Consumer Electronics','智慧裝置','影音電子','TV','Display','智慧手機','Smartphone','Mobile','平板','Tablet','穿戴裝置','Wearable','遊戲主機','Game Console','智慧家庭','Smart Home','耳機','Headphone','數位相機','Camera'],companySeeds:['宏碁','華碩','宏達電','大同']},

  // v2.6.6.8 final taxonomy freeze — market-facing labels added for companies formerly hidden in other_industry.
  {id:'functional_material',name:'功能性材料',scope:'traditional-coarse',parentName:'材料',members:[],aliases:['功能材料']},
  {id:'aerospace',name:'航太',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['航空航太']},
  {id:'medical_device',name:'醫材',scope:'traditional-coarse',parentName:'生技醫療',members:[],aliases:['醫療器材']},
  {id:'asset_property',name:'資產／營建',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['資產股']},
  {id:'logistics',name:'物流',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['倉儲物流']},
  {id:'special_metal',name:'特殊金屬',scope:'traditional-coarse',parentName:'材料',members:[],aliases:['特殊合金']},
  {id:'real_estate_service',name:'房仲／代銷',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['房仲','代銷']},
  {id:'education_service',name:'教育服務',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['教育']},
  {id:'media',name:'媒體',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['影音媒體']},
  {id:'engineering_service',name:'工程服務',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['工程']},
  {id:'funeral_service',name:'殯葬服務',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['殯葬']},
  {id:'hygiene_products',name:'衛生用品',scope:'traditional-coarse',parentName:'消費',members:[],aliases:['衛生材料']},
  {id:'building_material',name:'建材',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['建築材料']},
  {id:'property_management',name:'物業管理',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['物業']},
  {id:'investment',name:'投資',scope:'traditional-coarse',parentName:'金融',members:[],aliases:['投資控股']},
  {id:'parking_service',name:'停車場',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['停車服務']},
  {id:'car_rental',name:'汽車租賃',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['租車']},
  {id:'precision_metal_components',name:'精密金屬件',scope:'traditional-coarse',parentName:'材料',members:[],aliases:['精密金屬']},
  {id:'metal_packaging',name:'金屬包材',scope:'traditional-coarse',parentName:'材料',members:[],aliases:['金屬包裝']},
  {id:'packaging',name:'包材',scope:'traditional-coarse',parentName:'材料',members:[],aliases:['包裝材料']},
  {id:'printing',name:'印刷',scope:'traditional-coarse',parentName:'傳產',members:[],aliases:['印刷業']},
  {id:'security_service',name:'保全',scope:'traditional-coarse',parentName:'服務',members:[],aliases:['保全服務']},
  {id:'lead_material_recycling',name:'鉛材料／資源循環',scope:'traditional-coarse',parentName:'材料',members:[],aliases:['鉛材料','資源循環']}
]);

const LEGACY_TOPIC_ALIASES=Object.freeze({
  cloud_market:'it_services_market',
  test_interface_market:'semiconductor_test_equipment_market',
  dc800:'bbu',
  consumer_display:'consumer_brand_device',consumer_audio:'consumer_brand_device',consumer_camera:'consumer_brand_device',
  consumer_tablet:'consumer_brand_device',consumer_mobile:'consumer_brand_device',consumer_wearable:'consumer_brand_device',
  consumer_game_console:'consumer_brand_device',consumer_smart_home:'consumer_brand_device',
  bt_substrate:'abf_substrate',ic_substrate:'abf_substrate',
  copper_foil:'ccl',glass_fiber_cloth:'ccl',
  server_rack:'server_chassis',server_rail:'server_chassis',
  server_odm:'ai_server',server_motherboard:'ai_server',server_system:'ai_server',
  automotive_sensor:'automotive_electronics'
});
function canonicalTopicId(id){const raw=String(id||'');return LEGACY_TOPIC_ALIASES[raw]||raw;}

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
    active:spec.active!==false,synthetic:true,resolution:'market-topic',kind:'market-topic',companySeeds:Object.freeze([...(spec.companySeeds||[])]),companySymbols:Object.freeze([...(spec.companySymbols||[])]),referenceSeeds:Object.freeze([...(spec.referenceSeeds||[])]),referenceSymbols:Object.freeze([...(spec.referenceSymbols||[])]),sourceUrl:spec.sourceUrl||'',referenceSourceUrl:spec.referenceSourceUrl||''
  });
}
const TOPIC_DEFINITIONS = new Map(TOPIC_SPECS.map(s=>[s.id,buildSpecDefinition(s)]));


// Curated market-reference overlays discovered by full-market blind audit. These are intentionally
// separate from MOPS text matching: MOPS often describes a company too broadly to expose a newly
// traded product/theme. The overlay works for both synthetic market topics and direct business topics.
const MARKET_REFERENCE_OVERRIDES=Object.freeze({
  hbm:{names:['南亞科','華邦電','愛普','力積電','京元電子','辛耘','萬潤'],codes:['2408','2344','6531','6770','2449','3583','6187']},
  drone:{names:['亞光','華晶科','佳能','攸泰科技'],codes:['3019','3059','2374','6928']},
  leo_satellite:{names:['同欣電','譁裕'],codes:['6271','3419']},
  cpo_silicon_photonics:{names:['前鼎'],codes:['4908']},
  heavy_electrical:{names:['合機','大亞'],codes:['1618','1609']},
  robot:{names:['亞德客-KY','廣明'],codes:['1590','6188']},
  bbu:{names:['興能高'],codes:['6558']},
  hdd_component:{names:['百達-KY','銘鈺'],codes:['2236','4545']},
  foplp:{names:['鑫科','台虹','友威科','友達','力成','京元電子','欣銓','矽格','台星科','台積電'],codes:['3663','8039','3580','2409','6239','2449','3264','6257','3265','2330']},
  oled:{names:['智晶','華凌'],codes:['5245','6916']},
  pneumatic_component:{names:['亞德客-KY','氣立'],codes:['1590','4555']},
  water_treatment_engineering:{names:['天意能創','山林水'],codes:['4530','8473']},
  bios_firmware:{names:['研通','華豫寧'],codes:['6229','6474']},
  display_controller_ic:{names:['瑞鼎','奕力-KY'],codes:['3592','6962']},
  motor_driver_ic:{names:['點晶','類比科','廣閎科'],codes:['3288','3438','6693']},
  optical_lens:{names:['淳安','輝創','虎山'],codes:['6283','6722','7736']},
  image_sensor_ic:{names:['晶相光'],codes:['3530']},
  ai_server:{names:['鴻海','華碩','台達電','光寶科','大綜'],codes:['2317','2357','2308','2301','3147']},
  cpu:{names:['威盛','金麗科'],codes:['2388','3228']},
  // CPU market line intentionally excludes distributors/holding companies even when broad value-chain sources list them.
  // 晶心科 is processor IP, so it remains 矽智財 rather than direct CPU product.
  consumer_brand_device:{names:['聲寶','燦星網'],codes:['1604','4930']},
  chipset:{names:['威盛','旺玖'],codes:['2388','6233']},
  abf_substrate:{names:['欣興','景碩','南電','臻鼎-KY'],codes:['3037','3189','8046','4958']},
  hdi:{names:['臻鼎-KY','華通','燿華'],codes:['4958','2313','2367']},
  server_chassis:{names:['晟銘電','迎廣'],codes:['3013','6117']},
  bmc:{names:['新唐','系微'],codes:['4919','6231']},
  // v2.6.6.0 full-market membership audit — additive, exact company overlays.
  // These repair companies whose official business wording is too generic to reach the
  // intended XY topic reliably.  They do not merge or rename any topic.
  wafer:{names:['中美晶','嘉晶'],codes:['5483','3016']},
  automatic_data_capture:{names:['鼎翰','精聯'],codes:['3611','3652']},
  ssd:{names:['威剛','創見','宇瞻','宜鼎','十銓','廣穎電通'],codes:['3260','2451','8271','5289','4967','4973']},
  semiconductor_ip:{names:['晶心科'],codes:['6533']},
  defense:{names:['鑫創電子'],codes:['6680']},
  io_interface_card:{names:['威強電','弘憶股','磐儀'],codes:['3022','3312','3594']},
  power_module:{names:['聯寶'],codes:['6821']},
  optical_communication_market:{names:['統新','東典光電','康聯訊'],codes:['6426','6588','3672']},
  security_surveillance:{names:['陞泰'],codes:['8072']},
  cable_assembly:{names:['長盛','維熹','映興','良維'],codes:['3492','3501','3597','6290']},
  electrical_cable:{names:['泰碩'],codes:['3338']},
  panel_market:{names:['瑞軒'],codes:['2489']},
  advanced_packaging_material:{names:['長華*'],codes:['8070']},
  renewable_energy_equipment:{names:['中興電','盈正','寶碩'],codes:['1513','3628','5210']},
  functional_electronic_material:{names:['勤凱科技'],codes:['4760']},
  precision_mold:{names:['晟銘電','健策','禾昌'],codes:['3013','3653','6158']},
  sip_module_packaging:{names:['日月光投控'],codes:['3711']},
  optocoupler:{names:['光寶科'],codes:['2301']},
});

// v2.6.6.0 exact-code topic safety exclusions from the same full-market audit.
// Keep these at the Fundflow market-topic boundary in addition to raw-business exclusions:
// old cached auto tags / market-topic evidence must not be able to re-introduce a known false
// membership while the existing compact XY history is being rebuilt taxonomy-only.
const MARKET_TOPIC_EXCLUSIONS_BY_SYMBOL=Object.freeze({
  '1410':Object.freeze(['osat']),
  '1434':Object.freeze(['osat','ic_module']),
  '1541':Object.freeze(['motor_driver_ic']),
  '1569':Object.freeze(['acoustic_component']),
  '1604':Object.freeze(['electrical_cable']),
  '1614':Object.freeze(['electrical_cable']),
  '1626':Object.freeze(['electrical_cable','consumer_electronics_retail']),
  '2062':Object.freeze(['electromechanical_switch']),
  '2357':Object.freeze(['consumer_electronics_retail']),
  '2371':Object.freeze(['wafer_manufacturing']),
  '2426':Object.freeze(['power_semiconductor']),
  '2937':Object.freeze(['acoustic_component']),
  '3021':Object.freeze(['consumer_electronics_retail']),
  '3066':Object.freeze(['power_semiconductor']),
  '3234':Object.freeze(['power_semiconductor']),
  '3264':Object.freeze(['memory_ic']),
  '3339':Object.freeze(['power_semiconductor']),
  '3376':Object.freeze(['consumer_electronics_retail']),
  '3531':Object.freeze(['power_semiconductor']),
  '3548':Object.freeze(['consumer_electronics_retail']),
  '3663':Object.freeze(['vacuum_coating_service']),
  '3707':Object.freeze(['dram']),
  '4768':Object.freeze(['led_epitaxy']),
  '4908':Object.freeze(['power_semiconductor']),
  '4930':Object.freeze(['electrical_cable','consumer_electronics_retail']),
  '4956':Object.freeze(['power_semiconductor']),
  '5206':Object.freeze(['it_services_market']),
  '5321':Object.freeze(['general_pcb']),
  '5356':Object.freeze(['acoustic_component']),
  '5398':Object.freeze(['general_connector']),
  '6130':Object.freeze(['pmic']),
  '6164':Object.freeze(['power_semiconductor']),
  '6165':Object.freeze(['general_connector']),
  '6168':Object.freeze(['power_semiconductor']),
  '6222':Object.freeze(['led_epitaxy']),
  '6226':Object.freeze(['power_semiconductor']),
  '6261':Object.freeze(['image_sensor_ic']),
  '6269':Object.freeze(['pi_film']),
  '6271':Object.freeze(['led_epitaxy','abf_substrate']),
  '6278':Object.freeze(['led_epitaxy']),
  '6485':Object.freeze(['nand']),
  '8064':Object.freeze(['vacuum_coating_service']),
  '8111':Object.freeze(['power_semiconductor']),
  '8240':Object.freeze(['bmc','thermal','semiconductor_equipment']),
  '8299':Object.freeze(['nand']),
  // v2.6.6.10 full taxonomy semantic audit — exact false memberships.
  '3443':Object.freeze(['gpu']), // 創意 = ASIC/NRE, not GPU vendor
  '3661':Object.freeze(['gpu']), // 世芯-KY = ASIC/NRE, not GPU vendor
  '3094':Object.freeze(['chipset']), // 聯傑 = network controller IC
  '3709':Object.freeze(['chipset','hard_disk_drive','battery_module']), // holding company, stale product seeds
  '6189':Object.freeze(['chipset']), // IC distributor, not chipset designer
  '1785':Object.freeze(['hard_disk_drive']), // sputtering/precious-metal target material, not HDD product
  '2312':Object.freeze(['hard_disk_drive']), // EMS, not HDD product
  '2357':Object.freeze(['consumer_electronics_retail','hard_disk_drive']), // brand vendor, not HDD product maker
  '2360':Object.freeze(['battery_module']), // test/measurement equipment
  '3015':Object.freeze(['battery_module']), // PSU
  '3026':Object.freeze(['battery_module']), // passive/components
  '6278':Object.freeze(['led_epitaxy','battery_module']), // SMT service, not battery module
  '6477':Object.freeze(['battery_module']), // solar module != battery module
  '6509':Object.freeze(['battery_module']), // specialty chemicals
  '3532':Object.freeze(['wafer_manufacturing']), // silicon wafer material; belongs wafer
  '5483':Object.freeze(['wafer_manufacturing']), // silicon/solar wafer material; belongs wafer
  '6488':Object.freeze(['wafer_manufacturing']), // silicon wafer material; belongs wafer
  '3016':Object.freeze(['wafer_manufacturing']), // epitaxial wafer; belongs wafer/epitaxy
  '8028':Object.freeze(['wafer_manufacturing']), // reclaimed/thinning service, not wafer fab

  // v2.6.6.1 IC載板 boundary — final audited market line is direct organic
  // package-substrate manufacturers only.  Adjacent supply-chain roles stay in
  // their own equipment/material/ceramic/COF/test-interface topics.
  '1591':Object.freeze(['abf_substrate']),
  '2459':Object.freeze(['abf_substrate']),
  '3444':Object.freeze(['abf_substrate']),
  '3485':Object.freeze(['abf_substrate']),
  '4938':Object.freeze(['abf_substrate']),
  '6207':Object.freeze(['abf_substrate']),
  '6552':Object.freeze(['abf_substrate']),
  '6683':Object.freeze(['abf_substrate']),
  '8070':Object.freeze(['abf_substrate']),
});

function isMarketTopicExcluded(symbol,id){
  const code=String(symbol||'').trim().match(/\d{4,6}/)?.[0]||String(symbol||'').trim();
  const deny=MARKET_TOPIC_EXCLUSIONS_BY_SYMBOL[code];
  return Boolean(deny&&deny.includes(canonicalTopicId(id)));
}

function marketDefinitionForSource(tagId){
  const topicId=SOURCE_TO_TOPIC.get(String(tagId||''));
  if(topicId)return TOPIC_DEFINITIONS.get(topicId)||null;
  const tag=getTag(tagId);return tag?rawDefinition(tag):null;
}
function marketDefinitionById(id){
  const key=canonicalTopicId(id);
  if(TOPIC_DEFINITIONS.has(key))return TOPIC_DEFINITIONS.get(key);
  const tag=getTag(key);return tag?rawDefinition(tag):null;
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
const FINAL_TOPIC_ALIASES=Object.freeze({
  "auto_finance":"finance",
  "biomedical_health":"biotech",
  "cable_assembly":"general_connector",
  "cable_tv":"telecom_service_business",
  "ceramic_substrate":"functional_electronic_material",
  "digital_identity_antifraud":"cybersecurity",
  "digital_media_streaming":"media",
  "digital_remittance":"payment_platform",
  "electronic_components_manufacturing":"power_supply",
  "furniture":"home_living",
  "hdd_controller_ic":"storage_controller_ic",
  "image_sensor_module":"image_sensor_ic",
  "keypad_mechanical_component":"precision_mold",
  "memory_controller":"storage_controller_ic",
  "motor_driver_ic":"pmic",
  "motorcycle":"auto",
  "nand":"memory_ic",
  "optical_storage_controller_ic":"storage_controller_ic",
  "pcb_tooling":"pcb_equipment",
  "rfid_tag":"automatic_data_capture",
  "screen_printing_mesh":"functional_electronic_material",
  "security_service":"security_surveillance",
  "sip_module_packaging":"osat",
  "solder_material":"functional_electronic_material",
  "ssd":"memory_module",
  "ssd_controller":"storage_controller_ic",
  "thin_client":"consumer_notebook",
  "vacuum_coating_service":"surface_treatment"
});
const FINAL_TOPIC_NAMES=Object.freeze({
  "abf_substrate":"ABF載板",
  "acoustic_component":"聲學",
  "advanced_foundry":"先進製程",
  "advanced_packaging_material":"先進封裝材料",
  "agri_tech":"農業科技",
  "ai_accelerator":"AI ASIC",
  "ai_pc":"AI PC",
  "ai_server":"AI伺服器",
  "ai_solution":"AI應用",
  "antenna_rf":"天線／RF",
  "aoi":"AOI",
  "asic":"ASIC",
  "auto":"汽機車零組件",
  "automatic_data_capture":"自動辨識",
  "automation_market":"自動化",
  "automotive_electronics":"車用電子",
  "battery_material":"電池材料",
  "battery_module":"儲能／電池模組",
  "bbu":"BBU",
  "bios_firmware":"BIOS／韌體",
  "biotech":"生技醫療",
  "bmc":"BMC",
  "camera_module":"相機模組",
  "ccl":"CCL／銅箔基板",
  "cement":"水泥",
  "ceramic_substrate":"陶瓷基板",
  "chemical":"化工",
  "chipset":"晶片組",
  "computer_chassis":"機殼",
  "construction":"營建",
  "consumer_brand_device":"消費電子",
  "consumer_electronics_retail":"3C通路",
  "consumer_ic":"消費IC",
  "consumer_notebook":"NB／筆電",
  "consumer_peripherals":"電腦周邊",
  "copos":"CoPoS",
  "cowos":"CoWoS",
  "cpo_silicon_photonics":"CPO／矽光子",
  "cpu":"CPU／處理器",
  "cultural_creative":"文化娛樂",
  "cybersecurity":"資安",
  "defense":"軍工",
  "digital_media_streaming":"影音串流",
  "digital_platform":"數位平台",
  "display_controller_ic":"顯示控制IC",
  "display_driver_ic":"驅動IC",
  "dram":"DRAM",
  "drone":"無人機",
  "e_paper":"電子紙",
  "ecommerce_platform":"電商",
  "electrical_cable":"電線電纜",
  "electromechanical_switch":"開關元件",
  "electronic_components_manufacturing":"電子零組件製造",
  "embedded_system":"嵌入式系統",
  "ems_odm":"EMS／ODM",
  "epitaxy":"磊晶",
  "finance":"金融",
  "food":"食品",
  "foplp":"FOPLP",
  "fpcb":"FPCB",
  "functional_electronic_material":"功能性電子材料",
  "general_connector":"連接器",
  "general_pcb":"PCB",
  "glass_ceramics":"玻璃／陶瓷",
  "glass_substrate":"玻璃基板供應鏈",
  "gpu":"GPU",
  "green_energy":"綠能",
  "hard_disk_drive":"HDD",
  "hbm":"HBM",
  "hdd_component":"HDD零組件",
  "hdi":"HDI",
  "heavy_electrical":"重電",
  "high_speed_ic":"高速傳輸IC",
  "high_speed_transmission_market":"高速傳輸",
  "hinge":"轉軸",
  "holographic_optical_material":"全像光學材料",
  "home_living":"居家生活",
  "ic_distribution":"IC通路",
  "ic_module":"IC模組",
  "image_sensor_ic":"CIS／影像感測",
  "industrial_pc":"工業電腦",
  "infrared_thermal_sensor":"紅外線／熱感測",
  "io_interface_card":"介面卡",
  "io_interface_ic":"高速介面IC",
  "iot_solution":"IoT",
  "it_distribution":"資訊通路",
  "it_services_market":"資訊服務",
  "leadframe":"導線架",
  "led_driver_ic":"LED驅動IC",
  "led_epitaxy":"LED磊晶",
  "led_lighting":"LED照明",
  "led_package_module":"LED封裝",
  "leo_satellite":"低軌衛星",
  "light_source_management_ic":"光源管理IC",
  "machine_tool":"工具機",
  "machinery":"機械",
  "mature_foundry":"成熟製程",
  "mcu":"MCU",
  "media":"媒體",
  "memory_controller":"記憶體控制IC",
  "memory_ic":"記憶體",
  "memory_module":"記憶體模組／SSD",
  "mini_led":"Mini LED",
  "motherboard":"主機板",
  "network_ic":"網通IC",
  "networking_market":"網通",
  "nor_flash":"NOR Flash",
  "office_imaging_equipment":"辦公設備",
  "oil_gas_utility":"油氣／公用事業",
  "oled":"OLED",
  "online_game":"遊戲",
  "optical_comm_ic":"光通訊IC",
  "optical_communication_market":"光通訊",
  "optical_filter_coating":"光學鍍膜",
  "optical_lens":"光學鏡頭",
  "optocoupler":"光耦合器",
  "osat":"封測",
  "panel_market":"面板供應鏈",
  "paper":"造紙",
  "passive":"被動元件",
  "payment_platform":"電子支付",
  "pcb_equipment":"PCB設備",
  "photomask":"光罩",
  "pi_film":"PI膜",
  "plastics":"塑化",
  "pmic":"PMIC",
  "pneumatic_component":"氣動元件",
  "pos_payment_terminal":"POS",
  "power_module":"功率模組",
  "power_semiconductor":"功率半導體",
  "power_supply":"電源供應",
  "precision_metal_components":"精密金屬件",
  "precision_mold":"模具／機構件",
  "relay_sensor":"繼電器／感測",
  "renewable_energy_equipment":"再生能源設備",
  "retail":"百貨零售",
  "rf_testing_certification":"RF檢測",
  "robot":"機器人",
  "rubber":"橡膠",
  "security_ic":"安全IC",
  "security_surveillance":"安控",
  "semiconductor_analysis_service":"半導體分析",
  "semiconductor_equipment":"半導體設備",
  "semiconductor_facility_engineering":"半導體廠務",
  "semiconductor_ip":"矽智財",
  "semiconductor_material":"半導體材料",
  "semiconductor_products_services":"半導體服務",
  "semiconductor_test_equipment_market":"半導體測試設備",
  "server_chassis":"伺服器機殼",
  "shipping":"航運",
  "smart_meter_energy_management":"智慧電網",
  "soc":"SoC",
  "software_distribution":"軟體服務",
  "soic":"SoIC",
  "solar_market":"太陽能",
  "sports_leisure":"運動休閒",
  "steel":"鋼鐵",
  "storage_controller_ic":"儲存控制IC",
  "storage_system":"儲存設備",
  "surface_treatment":"表面處理",
  "telecom_service_business":"電信",
  "test_measurement_instrument":"量測儀器",
  "textile":"紡織",
  "thermal":"散熱",
  "touch_controller_ic":"觸控IC",
  "tourism":"觀光餐旅",
  "ups":"UPS",
  "video_capture_card":"影音擷取",
  "wafer":"矽晶圓",
  "wafer_manufacturing":"晶圓製造／代工",
  "water_treatment_engineering":"水處理"
});
const FINAL_DROP_TOPICS=new Set(['other_industry','info_packaging']);
const FINAL_COMPANY_TOPICS=Object.freeze({
 '1604':['consumer_brand_device'],'2349':['consumer_brand_device'],'3050':['consumer_brand_device'],'4930':['consumer_brand_device'],'1342':['functional_material','aerospace'],'1416':['asset_property'],'1435':['asset_property'],'1437':['asset_property'],'1443':['logistics'],'1516':['steel'],'1584':['defense','special_metal'],'2221':['auto'],'2348':['construction','real_estate_service'],'2496':['education_service'],'2514':['asset_property'],'2614':['media','ecommerce_platform'],'2724':['tourism'],'2904':['logistics'],'3040':['consumer_brand_device'],'3284':['printing'],'4154':['biotech'],'4430':['textile'],'4529':['machinery'],'4541':['aerospace'],'4556':['machinery','water_treatment_engineering'],'5209':['engineering_service','it_services_market'],'5276':['general_connector','auto'],'5284':['aerospace','precision_metal_components'],'5314':['biotech'],'5345':['power_supply'],'5398':['biotech'],'5450':['textile','functional_material'],'5481':['it_services_market'],'5530':['funeral_service'],'5604':['logistics'],'5871':['finance'],'6179':['solar_market','engineering_service'],'6184':['telecom_service_business'],'6199':['funeral_service'],'6464':['telecom_service_business'],'6504':['hygiene_products'],'6585':['functional_material'],'6592':['finance'],'6625':['cultural_creative'],'6655':['building_material'],'6721':['property_management'],'6881':['engineering_service'],'6901':['investment'],'6904':['machinery'],'6914':['parking_service'],'6952':['food'],'6957':['home_living'],'6958':['finance'],'7777':['investment'],'7855':['car_rental'],'8033':['defense','drone'],'8342':['precision_metal_components'],'8354':['functional_material'],'8401':['printing'],'8404':['textile'],'8411':['metal_packaging'],'8421':['packaging'],'8426':['home_living'],'8435':['water_treatment_engineering'],'8437':['education_service'],'8442':['sports_leisure'],'8444':['building_material'],'8463':['building_material'],'8466':['building_material'],'8481':['sports_leisure'],'8488':['metal_packaging'],'8489':['education_service'],'8905':['food'],'8906':['printing'],'8916':['textile'],'8921':['printing'],'8929':['hygiene_products'],'8935':['functional_material','sports_leisure'],'8936':['water_treatment_engineering'],'8937':['green_energy'],'8942':['building_material'],'9902':['asset_property'],'9905':['metal_packaging'],'9907':['metal_packaging'],'9917':['security_surveillance'],'9919':['hygiene_products'],'9925':['security_surveillance'],'9927':['lead_material_recycling'],'9928':['media'],'9929':['printing'],'9933':['engineering_service'],'9938':['textile'],'9939':['packaging'],'9940':['real_estate_service'],'9941':['finance'],'9942':['auto'],'9944':['textile','functional_material'],'9945':['construction']
});
function finalTopicId(id){return FINAL_TOPIC_ALIASES[String(id||'')]||String(id||'');}

function marketTopicLinks(rawLinks=[],companyName='',companyCode='',context={}){
  const byId=new Map();
  function add(def,importance='related',origin='market-topic',sourceTagId=''){
    if(!def||def.active===false)return;
    const canonicalId=finalTopicId(def.id);if(FINAL_DROP_TOPICS.has(canonicalId))return;
    const canonicalDef=marketDefinitionById(canonicalId)||def;
    if(isMarketTopicExcluded(companyCode,def.id)||isMarketTopicExcluded(companyCode,canonicalId))return;
    const current=byId.get(canonicalId),nextRank=IMPORTANCE_RANK[importance]||1,curRank=IMPORTANCE_RANK[current?.importance]||0;
    if(!current||nextRank>curRank){
      byId.set(canonicalId,{id:canonicalId,name:FINAL_TOPIC_NAMES[canonicalId]||canonicalDef.name,parent:null,parentName:canonicalDef.parentName||'',importance,origin,resolution:canonicalDef.resolution||'market-topic',technology:Boolean(canonicalDef.technology),scope:canonicalDef.scope,aliases:canonicalDef.aliases||[],sourceTagIds:sourceTagId?[sourceTagId]:[]});
    }else if(sourceTagId&&!current.sourceTagIds.includes(sourceTagId))current.sourceTagIds.push(sourceTagId);
  }
  for(const link of rawLinks||[]){
    const def=marketDefinitionForSource(link.id);if(!def)continue;add(def,link.importance||'related',link.origin||'business-tag',link.id);
  }
  const key=normalizeName(companyName),code=String(companyCode||'').trim();
  if(key||code){
    for(const def of TOPIC_DEFINITIONS.values()){
      if(def.active===false)continue;
      const seedNameHit=key&&(def.companySeeds||[]).some(n=>normalizeName(n)===key);
      const seedCodeHit=code&&(def.companySymbols||[]).some(x=>String(x)===code);
      const refNameHit=key&&(def.referenceSeeds||[]).some(n=>normalizeName(n)===key);
      const refCodeHit=code&&(def.referenceSymbols||[]).some(x=>String(x)===code);
      if(seedNameHit||seedCodeHit)add(def,'related','market-topic-audit','');
      if(refNameHit||refCodeHit)add(def,'related','market-reference','');
    }
    for(const [topicId,ref] of Object.entries(MARKET_REFERENCE_OVERRIDES)){
      const nameHit=key&&(ref.names||[]).some(n=>normalizeName(n)===key);
      const codeHit=code&&(ref.codes||[]).some(x=>String(x)===code);
      if(nameHit||codeHit){const def=marketDefinitionById(topicId);if(def)add(def,'related','market-reference','');}
    }
  }
  // Blind-coverage persisted topics are additive and independent of whether the company already had another tag.
  for(const id of parseAutoMarketTopics(context?.autoMarketTopics??context?.auto_market_topics)){
    const def=marketDefinitionById(id);if(def)add(def,'related','blind-coverage','');
  }
  // On-the-fly high-confidence evidence makes cached MOPS text useful immediately after a deploy,
  // even before that profile is rewritten by the next enrichment batch.
  const evidence=detectMarketTopicEvidence(context?.mainBusiness??context?.main_business??'',{minScore:85});
  for(const hit of evidence){const def=marketDefinitionById(hit.id);if(def)add(def,'related','blind-coverage-evidence','');}
  for(const id of FINAL_COMPANY_TOPICS[code]||[]){const def=marketDefinitionById(id);if(def)add(def,'related','final-taxonomy-freeze','');}
  return [...byId.values()];
}

function auditSummary(){
  const defs=listMarketDefinitions(),synthetic=defs.filter(x=>x.synthetic),raw=defs.filter(x=>!x.synthetic);
  return {definitions:defs.length,synthetic:synthetic.length,raw:raw.length,mergedSourceTags:SOURCE_TO_TOPIC.size,directSeedTopics:synthetic.filter(x=>(x.companySeeds||[]).length).length};
}

module.exports=Object.freeze({
  version:'2.1.1',TOPIC_SPECS,TOPIC_EVIDENCE_RULES,MARKET_REFERENCE_OVERRIDES,MARKET_TOPIC_EXCLUSIONS_BY_SYMBOL,isMarketTopicExcluded,LEGACY_TOPIC_ALIASES,canonicalTopicId,listMarketDefinitions,marketDefinitionById,marketDefinitionForSource,
  marketTopicLinks,detectMarketTopicEvidence,parseAutoMarketTopics,auditSummary,normalizeName,FINAL_TOPIC_ALIASES,FINAL_TOPIC_NAMES,FINAL_COMPANY_TOPICS
});
