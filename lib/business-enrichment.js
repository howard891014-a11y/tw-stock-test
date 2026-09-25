// StockZone v2.6.5.0 — full-market blind coverage / official MOPS business-profile enrichment
//
// Purpose:
// - Scan EVERY listed/OTC company, regardless of whether it already has one or more tags.
// - Fetch official MOPS t05st03 `mainBusiness` text in small batches.
// - Convert concrete product/service wording into existing fine business tags.
// - Add discovered raw tags and market topics without replacing prior evidence.
// - Re-run cached main-business text locally whenever the blind-coverage engine version changes.

const { getTag, isVoteEligible } = require('./business-tags');
const { resolveCompanyBusinessTags, summarizeProfiles, parseAutoBusinessTags } = require('./company-business-tags');
const { marketTopicLinks, marketDefinitionForSource, detectMarketTopicEvidence, parseAutoMarketTopics } = require('./market-topic-taxonomy');

const MOPS_PROFILE_URL = 'https://mops.twse.com.tw/mops/api/t05st03';
const MOPS_HEADERS = Object.freeze({
  'Content-Type':'application/json',
  'Accept':'application/json',
  'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer':'https://mops.twse.com.tw/mops/',
  'Origin':'https://mops.twse.com.tw',
});

function clean(v){return String(v??'').normalize('NFKC').replace(/\u3000/g,' ').replace(/\s+/g,' ').trim();}
function norm(v){return clean(v).toLowerCase();}
function uniq(arr){return [...new Set((arr||[]).filter(Boolean))];}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function cellValue(result,key){const c=result?.[key];return c&&typeof c==='object'&&!c.isHidden?clean(c.value):'';}

function validFineTag(id){const t=getTag(id);return Boolean(t&&t.resolution==='fine'&&isVoteEligible(t));}
function validVotableTag(id){const t=getTag(id);return Boolean(t&&isVoteEligible(t));}

// Strong, product-level rules only. Deliberately avoid generic words such as
// "半導體", "電子零組件" or "光電"; those would merely recreate the old coarse fallback.
const RULES = Object.freeze([
  // IC design / semiconductor devices
  ['mcu', /\b(mcu|microcontroller)\b|微控制器|微處理控制器/iu],
  ['pmic', /\bpmic\b|電源管理(?:ic|晶片|積體電路)|power management ic/iu],
  ['display_driver_ic', /顯示(?:器)?驅動(?:ic|晶片|積體電路)|\bddi\b|display driver/iu],
  ['touch_controller_ic', /觸控(?:控制)?(?:ic|晶片|積體電路)|touch controller/iu],
  ['network_ic', /網路(?:通訊)?(?:ic|晶片|積體電路)|乙太網(?:路)?(?:ic|晶片)|ethernet (?:ic|chip)/iu],
  ['high_speed_ic', /高速(?:傳輸|介面)(?:ic|晶片)|serdes|pcie.*(?:ic|晶片)|usb.*(?:ic|晶片)/iu],
  ['retimer', /retimer|重定時/iu],
  ['ai_accelerator', /ai(?:加速|運算)(?:晶片|ic)|\bnpu\b|ai accelerator/iu],
  ['gpu', /\bgpu\b|圖形處理器|繪圖晶片/iu],
  ['cpu', /\bcpu\b|中央處理器/iu],
  ['semiconductor_ip', /矽智財|半導體\s*ip|\bic\s*ip\b|ip授權/iu],
  ['ssd_controller', /ssd.*控制|固態硬碟.*控制|flash controller/iu],
  ['memory_controller', /記憶體.*控制(?:ic|晶片)|memory controller/iu],
  ['security_ic', /安全(?:ic|晶片)|security ic|secure element/iu],
  ['led_driver_ic', /led.*驅動(?:ic|晶片)|led driver/iu],
  ['optical_comm_ic', /光通訊(?:ic|晶片)|optical communication ic/iu],
  ['image_sensor_ic', /影像感測(?:ic|晶片)|cmos image sensor|\bcis\b/iu],
  ['memory_ic', /記憶體(?:ic|晶片|積體電路)|memory ic/iu],
  ['consumer_ic', /消費性(?:ic|晶片|積體電路)|consumer ic/iu],
  ['asic_design_service', /asic.*設計服務|ic設計服務|晶片設計服務|design service/iu],
  ['asic', /\basic\b|客製(?:化)?晶片|客製(?:化)?ic/iu],
  ['soc', /\bsoc\b|系統單晶片|系統級晶片/iu],

  // wafer / power semiconductor
  ['mosfet', /\bmosfet\b|功率mos/iu],
  ['igbt', /\bigbt\b|絕緣閘雙極/iu],
  ['gan_power', /氮化鎵|\bgan\b/iu],
  ['sic_power', /碳化矽|\bsic\b/iu],
  ['epitaxy', /磊晶|epitax/iu],
  ['photomask', /光罩|photomask/iu],
  ['wafer', /矽晶圓|silicon wafer|晶圓材料/iu],
  ['advanced_foundry', /(?:3|5|7|2)奈米.*(?:晶圓|製程|代工)|先進製程.*(?:晶圓|代工)/iu],
  ['mature_foundry', /成熟製程.*(?:晶圓|代工)|晶圓代工/iu],
  ['wafer_manufacturing', /晶圓製造|wafer fabrication|wafer manufacturing/iu],
  ['discrete_semiconductor', /分離式半導體|二極體|整流器|diode|rectifier/iu],

  // semiconductor materials
  ['photoresist', /光阻|photoresist/iu],
  ['cmp_slurry', /cmp.*(?:研磨|材料|slurry)|研磨液/iu],
  ['specialty_gas', /電子特氣|半導體特氣|specialty gas/iu],
  ['precursor', /前驅物|precursor/iu],
  ['quartz_parts', /石英.*(?:零件|耗材|坩堝)|quartz/iu],
  ['silicon_parts', /矽.*(?:零件|耗材)|silicon parts/iu],
  ['wet_chemicals', /電子化學品|濕製程化學|高純度化學/iu],
  ['semiconductor_chemicals_materials', /半導體.*(?:材料|化學)|電子材料/iu],

  // semiconductor equipment / packaging / test
  ['wet_process_equipment', /(?:晶圓|半導體).*(?:清洗|濕式|濕製程).*設備|wet process/iu],
  ['coating_develop_equipment', /塗佈.*顯影|coater.*developer/iu],
  ['deposition_equipment', /(?:cvd|pvd|ald|薄膜沉積).*設備/iu],
  ['etch_equipment', /蝕刻.*設備|etch.*equipment/iu],
  ['bonding_equipment', /(?:鍵合|貼合|bonding).*設備/iu],
  ['laser_processing_equipment', /雷射.*(?:加工|製程|設備)|laser processing/iu],
  ['semiconductor_automation_equipment', /半導體.*(?:自動化|搬運|傳送).*設備|晶圓.*自動化/iu],
  ['semiconductor_process_test_equipment', /半導體.*(?:製程|檢測|量測).*設備|晶圓.*(?:檢測|量測).*設備/iu],
  ['packaging_test_equipment', /(?:封裝|封測).*設備|packaging.*test.*equipment/iu],
  ['advanced_packaging_equipment', /先進封裝.*設備/iu],
  ['advanced_packaging_material', /先進封裝.*材料/iu],
  ['cowos', /\bcowos\b/iu],
  ['soic', /\bsoic\b/iu],
  ['info_packaging', /\binfo\b.*(?:封裝|package)|integrated fan.?out/iu],
  ['copos', /\bcopos\b/iu],
  ['foplp', /\bfoplp\b|面板級封裝|panel level package/iu],
  ['glass_substrate', /玻璃(?:基板|載板|核心基板|通孔|穿孔)|\bTGV\b|glass\s*(?:substrate|core|via)/iu],
  ['ic_substrate', /ic(?:封裝)?基板|封裝基板|package substrate/iu],
  ['leadframe', /導線架|leadframe/iu],
  ['osat', /封裝測試(?:服務|代工)|封測代工|\bosat\b/iu],
  ['semiconductor_test_service', /(?:晶片|ic|半導體).*測試(?:服務|代工)|測試代工/iu],
  ['ate', /(?:自動)?測試設備|\bate\b/iu],
  ['handler', /(?:測試)?分選機|handler/iu],
  ['probe_card', /探針卡|probe card/iu],
  ['test_socket', /測試座|test socket/iu],
  ['burn_in', /老化測試|burn.?in/iu],

  // PCB / substrates / connectors
  ['abf_substrate', /\babf\b.*(?:載板|基板)|abf substrate/iu],
  ['bt_substrate', /\bbt\b.*(?:載板|基板)|bt substrate/iu],
  ['ccl', /銅箔基板|覆銅板|\bccl\b/iu],
  ['hdi', /\bhdi\b|高密度互連板/iu],
  ['fpcb', /\bfpcb\b|軟性(?:印刷)?電路板|柔性電路板/iu],
  ['rigid_flex', /軟硬結合板|rigid.?flex/iu],
  ['general_pcb', /印刷電路板|電路板|\bpcb\b/iu],
  ['copper_foil', /銅箔(?!基板)|copper foil/iu],
  ['glass_fiber_cloth', /玻璃纖維布|玻纖布/iu],
  ['pcb_equipment', /pcb.*設備|電路板.*設備/iu],
  ['high_speed_connector', /高速連接器|高速.*connector/iu],
  ['general_connector', /連接器|connector/iu],
  ['cable_assembly', /線束|線材組件|cable assembly|連接線/iu],

  // server / computer / power / thermal
  ['ai_server', /ai伺服器|ai server/iu],
  ['server_odm', /伺服器.*(?:odm|代工)|server odm/iu],
  ['server_motherboard', /伺服器.*主機板/iu],
  ['server_chassis', /伺服器.*機殼/iu],
  ['server_rack', /伺服器.*機櫃|rack server/iu],
  ['server_rail', /伺服器.*滑軌|server rail/iu],
  ['server_cable', /伺服器.*(?:高速)?線材/iu],
  ['server_system', /伺服器(?:系統|產品|設備)|server system/iu],
  ['motherboard', /主機板|motherboard/iu],
  ['computer_chassis', /電腦.*(?:機殼|機構件)|computer chassis/iu],
  ['notebook_pc', /筆記型電腦|筆電|notebook|laptop/iu],
  ['desktop_pc', /桌上型電腦|desktop pc/iu],
  ['industrial_pc', /工業電腦|industrial pc|\bipc\b/iu],
  ['embedded_system', /嵌入式(?:系統|電腦)|embedded system/iu],
  ['graphics_card', /顯示卡|graphics card/iu],
  ['storage_system', /儲存系統|storage system/iu],
  ['office_imaging_equipment', /印表機|掃描器|掃瞄器|投影機/iu],
  ['battery_module', /電池模組|battery pack|電池組/iu],
  ['power_supply', /電源供應器|電源供應器|power supply/iu],
  ['server_psu', /伺服器.*電源|server psu/iu],
  ['ups', /\bups\b|不斷電系統/iu],
  ['power_module', /功率模組|power module/iu],
  ['liquid_cooling', /液冷|水冷|liquid cooling/iu],
  ['cold_plate', /冷板|cold plate/iu],
  ['cdu', /\bcdu\b|冷卻液分配/iu],
  ['heat_pipe_vapor_chamber', /熱管|均熱板|vapor chamber/iu],
  ['fan', /散熱風扇|風扇|blower/iu],
  ['air_cooling', /氣冷散熱|散熱模組|散熱器|heatsink/iu],

  // memory / storage
  ['dram', /\bdram\b/iu],
  ['nand', /\bnand\b/iu],
  ['nor_flash', /\bnor\b.*flash|nor flash/iu],
  ['hbm', /\bhbm\b/iu],
  ['ssd', /\bssd\b|固態硬碟/iu],
  ['memory_module', /記憶體模組|memory module/iu],
  ['flash_storage_device', /隨身碟|記憶卡|flash storage/iu],

  // passive components
  ['mlcc', /\bmlcc\b|積層陶瓷電容/iu],
  ['resistor', /電阻|resistor/iu],
  ['inductor', /電感|inductor/iu],
  ['capacitor', /電容|capacitor/iu],
  ['crystal_oscillator', /石英(?:晶體|元件|振盪器)|crystal oscillator/iu],
  ['filter_oscillator', /濾波器|振盪器|filter|oscillator/iu],

  // display / optical / imaging
  ['lcd_panel', /lcd.*面板|液晶面板/iu],
  ['oled', /\boled\b/iu],
  ['mini_led', /mini\s*led/iu],
  ['micro_led', /micro\s*led/iu],
  ['touch_panel', /觸控面板|touch panel/iu],
  ['display_module', /顯示(?:器)?模組|液晶模組|display module/iu],
  ['backlight_module', /背光模組|backlight module/iu],
  ['optical_film', /光學膜|稜鏡片|polarizer|偏光片/iu],
  ['ito_substrate', /ito.*(?:玻璃|基板)|導電玻璃/iu],
  ['led_epitaxy', /led.*磊晶/iu],
  ['led_package_module', /led.*(?:封裝|模組)/iu],
  ['solar_cell', /太陽能電池|solar cell/iu],
  ['solar_module', /太陽能模組|solar module/iu],
  ['optical_lens', /光學鏡頭|鏡片|optical lens/iu],
  ['camera_module', /相機模組|攝影模組|camera module/iu],
  ['security_surveillance', /監控|安防|security surveillance|dvr|nvr/iu],
  ['cpo', /\bcpo\b|co.?packaged optics/iu],
  ['npo', /\bnpo\b/iu],
  ['silicon_photonics', /矽光子|silicon photonics/iu],
  ['optical_transceiver', /光收發|transceiver/iu],
  ['optical_module', /光通訊模組|optical module/iu],
  ['optical_engine', /光引擎|optical engine/iu],
  ['laser_vcsel', /\bvcsel\b|雷射二極體|laser diode/iu],
  ['fiber_component', /光纖(?:元件|組件)|fiber optic/iu],

  // networking / communications
  ['optical_communication_equipment', /光通訊.*(?:設備|系統)|光纖通訊設備/iu],
  ['wireless_communication_equipment', /無線通訊.*(?:設備|系統)|wifi|wi-fi|5g.*設備|基地台/iu],
  ['wired_communication_equipment', /有線通訊.*(?:設備|系統)|寬頻設備|cable modem/iu],
  ['network_equipment', /網路.*(?:設備|交換器|路由器)|switch|router|gateway/iu],
  ['telecom_service_business', /電信服務|行動通訊服務|固網服務/iu],

  // automation / electronics services
  ['aoi', /\baoi\b|自動光學檢測/iu],
  ['machine_vision', /機器視覺|machine vision/iu],
  ['industrial_robot', /工業機器人|industrial robot/iu],
  ['factory_automation', /工廠自動化|智慧工廠|factory automation/iu],
  ['automation_machine', /自動化.*(?:機台|設備)|自動化設備/iu],
  ['ems_odm', /電子製造服務|\bems\b|電子代工|odm.*製造/iu],
  ['ic_distribution', /ic.*(?:代理|經銷|通路)|半導體.*(?:代理|經銷|通路)/iu],
  ['electronic_distribution_business', /電子零組件.*(?:代理|經銷|通路)|電子元件.*(?:代理|經銷)/iu],

  // software / digital
  ['cybersecurity', /資安|資訊安全|cybersecurity|cyber security/iu],
  ['cloud_service', /雲端服務|cloud service|\bsaas\b|\bpaas\b|\biaas\b/iu],
  ['ai_solution', /人工智慧|ai解決方案|ai應用|machine learning|機器學習/iu],
  ['system_integration', /系統整合|system integration/iu],
  ['software_development', /軟體開發|軟體設計|software development/iu],
  ['software_distribution', /軟體.*(?:代理|經銷|通路)|software distribution/iu],
  ['data_processing', /資料處理|數據處理|data processing|大數據/iu],

  // v2.6.2.33-C2 — second-pass rules learned from actual unresolved MOPS descriptions.
  // These remain product/service specific; no generic industry-word fallbacks are used.
  ['keyboard_input_device', /鍵盤|滑鼠|keyboard|mouse|薄膜開關|membrane switch/iu],
  ['consumer_electronics', /消費性電子|影音電子|智慧裝置|多媒體播放|電子辭典|學習機/iu],
  ['audio_component', /喇叭|揚聲器|音箱|音響(?:產品|設備)?|speaker|聲音輸出/iu],
  ['test_measurement_instrument', /示波器|電子負載|電源供應測試|量測儀器|測試儀器|test\s*(?:and|&)\s*measurement/iu],
  ['semiconductor_facility_engineering', /高科技廠房|無塵室|潔淨室|廠務工程|整廠工程|機電整合工程|半導體廠務/iu],
  ['holographic_optical_material', /雷射全像|全像膜|防偽膜|holographic/iu],
  ['optocoupler', /光耦合器|光耦|photocoupler|opto.?coupler/iu],
  ['relay_sensor', /磁簧|reed\s*(?:relay|switch)|繼電器/iu],
  ['precision_metal_components', /精密沖壓|金屬沖壓|冷鍛|精密金屬|沖壓零件|五金零件|金屬機構件/iu],
  ['card_reader', /讀卡機|讀卡器|smart\s*card\s*reader|rfid\s*reader/iu],
  ['pos_payment_terminal', /pos(?:系統|機|終端)?|銷售點終端|支付終端|刷卡機/iu],
  ['hdd_component', /硬碟(?:機)?零組件|磁頭|hdd.*(?:component|part)|硬碟機.*零件/iu],
  ['antenna_rf', /天線|射頻元件|rf\s*(?:module|component)|微波元件/iu],
  ['rf_testing_certification', /sar測試|emc測試|emi測試|射頻測試|電磁相容.*測試|驗證服務|測試認證/iu],
  ['cover_glass', /cover\s*glass|強化玻璃|光電玻璃|顯示器玻璃|玻璃加工.*顯示/iu],
  ['acoustic_component', /蜂鳴器|buzzer|聲學元件|受話器|麥克風元件/iu],
  ['automotive_electronics', /汽車電子|車用電子|車用電裝|車載電子|automotive electronics/iu],
  ['automotive_sensor', /胎壓|tpms|車用感測|倒車雷達|停車感測/iu],
  ['pi_film', /聚醯亞胺|polyimide|\bpi膜\b|pi\s*film/iu],
  ['online_game', /線上遊戲|網路遊戲|online\s*game|遊戲軟體|遊戲營運/iu],
  ['ecommerce_platform', /電子商務|網路購物|電商平台|購物網站|e-?commerce/iu],
  ['digital_platform', /數位平台|網路平台|媒合平台|生活服務平台|內容平台/iu],
  ['payment_platform', /第三方支付|電子支付|行動支付|支付平台|收付款服務/iu],
  ['digital_identity_antifraud', /來電辨識|防詐|反詐|數位身分|身分驗證|陌生來電/iu],
  ['iot_solution', /物聯網|\biot\b|\baiot\b|智慧聯網|聯網解決方案/iu],
  ['smart_meter_energy_management', /智慧電表|電表.*通訊|電能管理|能源管理系統|smart\s*meter/iu],
  ['led_lighting', /led.*(?:照明|燈具)|照明燈具|lighting/iu],
  ['battery_material', /正極材料|陰極材料|磷酸鐵鋰|鋰電池材料|電池材料/iu],
  ['semiconductor_analysis_service', /故障分析|可靠度分析|材料分析|半導體分析|晶圓分析|fa\s*分析/iu],
  ['e_paper', /電子紙|e\s*ink|e-?paper/iu],
  ['pcba_ems', /\bpcba\b|smt.*(?:組裝|代工)|電路板組裝|電子組裝代工/iu],
  ['automatic_data_capture', /條碼掃描|條碼讀取|\baidc\b|自動資料收集|資料擷取終端/iu],
  ['it_distribution', /資訊產品.*(?:代理|經銷|通路)|電腦.*(?:代理|經銷|通路)|it產品.*(?:代理|經銷)|科技產品通路/iu],
  // v2.6.2.33-C3 — third-pass wording seen in the final unresolved pool.
  ['asic', /特殊應用積體電路|應用積體電路/iu],
  ['display_device', /(?:lcd\s*tv|液晶顯示器|液晶電視|顯示器產品)/iu],
  ['vacuum_coating_service', /真空(?:鍍膜|蒸鍍)|濺鍍|sputter|vacuum\s*coating/iu],
  ['keypad_mechanical_component', /按鍵(?:飾品)?|機構整合元件|keypad/iu],
  ['infrared_thermal_sensor', /紅外線(?:偵測器|感測器)|熱感測器|infrared.*sensor/iu],
  ['electromechanical_switch', /電控裝置|(?:產品)?開關(?:與控制電路)?|開關模組|插座/iu],
  ['solar_system_engineering', /太陽能光電工程|太陽能電廠|solar.*(?:epc|plant)/iu],
  ['solar_conductive_paste', /太陽能.*導電漿|導電漿(?:料)?/iu],
  ['ceramic_substrate', /陶瓷基板|氧化鋁.*基板|氮化鋁.*基板|\bdbc\b.*基板/iu],
  ['capacitor_foil', /化成鋁箔|腐蝕鋁箔|電解電容.*鋁箔|電容器.*鋁箔/iu],
  ['optical_filter_coating', /薄膜濾光片|光學鍍膜|濾光片/iu],
  ['sip_module_packaging', /(?:系統|sip).*模組封裝|模組.*封裝測試/iu],
  ['screen_printing_mesh', /精密網版|網版製造|網印耗材|絲網印刷/iu],
  ['it_service', /資訊服務|資訊系統維運|系統維護服務/iu],
  ['consumer_electronics_retail', /家用電器.*買賣|家電.*(?:銷售|通路)|3c.*(?:銷售|通路)/iu],

  // v2.6.2.33-C4 — final-tail wording for the last 26 unresolved companies.
  ['biomedical_health', /醫療器材|智慧醫療|數位健康|健康資訊系統|生醫產品/iu],
  ['solder_material', /焊錫(?:條|絲)|錫球|錫膏|助焊|solder/iu],
  ['functional_electronic_material', /電子功能材料|導電散熱|emi材料|絕緣材料|功能性材料|機能材料/iu],
  ['precision_metal_mask', /高精細金屬遮罩|精密金屬遮罩|蒸鍍遮罩|metal\s*mask/iu],
  ['emc_protection_component', /emc及線路保護|線路保護元件|esd保護元件/iu],
  ['rfid_tag', /rfid電子標籤|rfid標籤|電子標籤/iu],
  ['digital_remittance', /移工匯兌|跨境匯兌|跨境匯款|數位匯款/iu],
  ['renewable_energy_equipment', /再生能源.*發電設備|發電、?輸電、?配電|能源技術服務|氫氣發電/iu],
  ['pcb_tooling', /(?:pcb|電子線路板).*(?:鑽針|銑刀)|微型鑽針|專用切削刀具/iu],
  ['ferrite_magnetic_component', /鐵氧|磁鐵芯|磁性組件|電磁組件/iu],
  ['image_sensor_module', /影像感測.*模組|cism|線性感測模組|contact\s*image\s*sensor/iu],
  ['surface_treatment', /金屬表面處理|精密電鍍|電鍍代工|表面處理製程/iu],
  ['digital_media_streaming', /ott|數位內容|數位影音|轉播|串流影音/iu],

  // Common wording variants seen in the MOPS records.
  ['security_surveillance', /監視系統|監控系統|監視器|閉路電視|cctv|影像監控/iu],
  ['optical_film', /偏光板|偏光膜|光學薄膜|光學膜片/iu],
  ['solar_cell', /太陽能電池|太陽電池/iu],
  ['solar_module', /太陽能模組|太陽光電模組/iu],
  ['power_supply', /交換式電源|電源供應器|電源轉換器|adapter|電源適配器/iu],
  ['ups', /不斷電系統|不斷電電源|ups電源/iu],
  ['automation_machine', /自動化機械|自動化機台|自動化設備|專用機/iu],
  ['ems_odm', /電子產品組裝|電子產品代工|組裝加工|ems代工/iu],
  ['software_development', /資訊系統開發|應用軟體|軟體系統|程式設計|資訊軟體/iu],
  ['system_integration', /資訊系統整合|系統建置|系統整合服務|弱電整合/iu],
]);

// Exact-code overrides are only used when the MOPS text is too generic to expose the
// actual product line. They are additive and still validated against the fine-tag registry.

// Final cleanup for profiles that are still completely unclassified (usually special/management-stock
// industry codes). Technology wording is handled by RULES above; otherwise use only clear, broad
// traditional-industry signals. This avoids forcing a vague "other" bucket merely to reach 100%.
const BROAD_RULES = Object.freeze([
  ['food', /食品|飲料|烘焙|乳品|肉品|水產食品|調味品|餐飲食品|保健食品製造/iu],
  ['biotech', /生技|生物科技|藥品|製藥|醫療器材|醫療設備|檢測試劑|健康照護|醫美|疫苗/iu],
  ['construction', /營建|建設|建築工程|土木工程|不動產開發|住宅開發|廠辦開發/iu],
  ['finance', /銀行|證券|保險|金融控股|投資信託|期貨|票券|融資租賃/iu],
  ['retail', /百貨|零售|量販|超商|通路銷售|商品買賣|連鎖門市/iu],
  ['tourism', /飯店|旅館|餐廳|餐旅|旅行社|觀光|休閒渡假/iu],
  ['shipping', /海運|航運|船舶運輸|貨櫃運輸|航空運輸|物流運輸/iu],
  ['steel', /鋼鐵|鋼材|不鏽鋼|鋼管|型鋼|冷軋|熱軋/iu],
  ['textile', /紡織|成衣|布料|紗線|染整|纖維|織布/iu],
  ['chemical', /化學品|化工|樹脂|塗料|工業化學|特用化學|化學材料/iu],
  ['plastics', /塑膠製品|塑膠加工|塑化|塑膠原料|pvc|聚酯|聚丙烯/iu],
  ['rubber', /橡膠製品|輪胎|橡膠材料/iu],
  ['paper', /造紙|紙漿|紙品|工業用紙|紙器/iu],
  ['glass_ceramics', /玻璃製品|陶瓷|玻璃加工|玻璃容器/iu],
  ['machinery', /機械設備|工具機|產業機械|機械製造|泵浦|空壓機|傳動機械/iu],
  ['motorcycle', /機車(?:零組件)?|摩托車(?:零組件)?/iu],
  ['electrical_cable', /電線電纜|電纜製造|電力線纜|漆包線/iu],
  ['auto', /汽車製造|汽車零組件|車體|底盤|輪圈|煞車系統/iu],
  ['oil_gas_utility', /石油|天然氣|燃氣|加油站|油品|電力事業|發電事業/iu],
  ['green_energy', /再生能源|太陽能電廠|風力發電|綠能服務|廢棄物處理|資源回收/iu],
  ['cultural_creative', /文創|出版|影視製作|藝文|廣告製作|內容製作/iu],
  ['agri_tech', /農業|農產品|種苗|畜牧|漁業|農業科技/iu],
  ['sports_leisure', /健身器材|運動用品|高爾夫|休閒用品|自行車用品/iu],
  ['home_living', /家具|家飾|居家用品|廚具|衛浴|寢具/iu],
  ['defense', /國防|軍工|軍用|武器系統|無人機.*軍|軍方/iu],
]);

function classifyBroadBusinessText(text){
  const t=norm(text); if(!t)return [];
  const hits=[];
  for(const [id,re] of BROAD_RULES){if(re.test(t)&&validVotableTag(id))hits.push(id);}
  return uniq(hits).slice(0,4);
}

const CODE_OVERRIDES = Object.freeze({
  // v2.6.2.33-C6 final four TDRs (technology profiles only; non-tech 9110 uses BROAD_RULES).
  '910861':['ai_solution','digital_platform','system_integration','software_development'],
  '911608':['cybersecurity','system_integration','led_lighting','infrared_thermal_sensor'],
  '9136':['computer_chassis','consumer_electronics'],
  '2363':['asic'],                         // special-application IC
  '2406':['solar_system_engineering'],     // solar EPC / plant equipment
  '2433':['office_imaging_equipment','network_equipment'],
  '2489':['display_device'],
  '3287':['consumer_electronics'],
  '3290':['precision_mold'],
  '3296':['power_supply','ups','smart_meter_energy_management'],
  '3303':['vacuum_coating_service','optical_film'],
  '3311':['keypad_mechanical_component'],
  '3373':['infrared_thermal_sensor'],
  '3484':['electromechanical_switch','general_connector'],
  '3580':['vacuum_coating_service'],
  '3691':['solar_conductive_paste'],
  '4942':['precision_mold'],
  '5215':['keyboard_input_device'],
  '6127':['ceramic_substrate'],
  '6128':['office_imaging_equipment'],
  '6175':['capacitor_foil'],
  '6236':['it_service'],
  '6281':['consumer_electronics_retail','it_distribution'],
  '6405':['cover_glass','glass_substrate'],
  '6426':['optical_filter_coating'],
  '6451':['sip_module_packaging','osat'],
  '6525':['osat','mosfet','igbt'],
  '6538':['screen_printing_mesh'],
  '6546':['wireless_communication_equipment'],
  '6573':['discrete_semiconductor'],

  // v2.6.2.33-C4 — one-by-one mapping of the final 26 unresolved companies.
  '2432':['consumer_electronics','embedded_system','ai_solution'],
  '3631':['solder_material'],
  '6114':['functional_electronic_material','general_connector','capacitor','optical_film','cover_glass'],
  '6584':['server_rail'],
  '6698':['precision_metal_mask','leadframe','biomedical_health'],
  '6761':['emc_protection_component','rf_testing_certification','electronic_distribution_business'],
  '6855':['factory_automation','biomedical_health','software_development'],
  '6863':['rfid_tag','antenna_rf','card_reader','system_integration'],
  '6921':['high_speed_ic','retimer'],
  '6967':['functional_electronic_material'],
  '7738':['digital_remittance','telecom_service_business'],
  '7749':['ai_accelerator'],
  '7753':['display_device','led_lighting'],
  '7792':['renewable_energy_equipment'],
  '7805':['storage_system'],
  '7835':['biomedical_health','ai_solution','software_development'],
  '8021':['pcb_tooling','pcb_equipment'],
  '8047':['laser_processing_equipment'],
  '8121':['ferrite_magnetic_component'],
  '8183':['pcba_ems','automotive_electronics','biomedical_health'],
  '8215':['optical_film','battery_material','biomedical_health'],
  '8249':['image_sensor_module','infrared_thermal_sensor','laser_processing_equipment'],
  '8284':['software_development','digital_platform'],
  '8416':['software_distribution','software_development'],
  '8431':['surface_treatment'],
  '8487':['digital_media_streaming','digital_platform'],
});

function classifyBusinessText(text,{industryCode='',code='',allowBroad=false}={}){
  const t=norm(text);
  const hits=[];
  if(t){ for(const [id,re] of RULES){ if(re.test(t)&&validFineTag(id))hits.push(id); } }
  for(const id of (CODE_OVERRIDES[String(code)]||[])){ if(validFineTag(id))hits.push(id); }
  // Keep a compact, useful label set. Specific tags are additive; duplicated concepts collapse.
  const unique=uniq(hits).filter(id=>![
    'semiconductor_products_services','optoelectronic_components_modules','electronic_components_manufacturing',
    'information_software_services','electronics_manufacturing_services','digital_cloud_services','computer_peripheral_business'
  ].includes(id));
  if(unique.length)return unique.slice(0,24);
  // For completely unclassified special-industry profiles only, broad traditional tags are acceptable.
  return allowBroad?classifyBroadBusinessText(text):[];
}

async function fetchMopsProfile(code,{timeoutMs=10000}={}){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(MOPS_PROFILE_URL,{method:'POST',headers:MOPS_HEADERS,body:JSON.stringify({companyId:String(code)}),signal:controller.signal});
    if(!r.ok)throw new Error(`MOPS HTTP ${r.status}`);
    const j=await r.json();
    if(Number(j?.code)!==200||!j?.result||typeof j.result!=='object')throw new Error(clean(j?.message)||'MOPS 無公司結果');
    return {
      code:String(code),
      mainBusiness:cellValue(j.result,'mainBusiness'),
      website:cellValue(j.result,'internetAddress'),
      companyName:cellValue(j.result,'companyName'),
      companyAbbreviation:cellValue(j.result,'companyAbbreviation'),
    };
  }finally{clearTimeout(timer)}
}

const BLIND_COVERAGE_VERSION='blind-1.0.0';
const AUTO_TOPIC_SCORE=85;
const AUDIT_TOPIC_SCORE=60;
const REFRESH_AFTER_DAYS=90;

function profileForResolver(row,autoBusinessTags=row.auto_business_tags){
  return {
    stock_code:row.stock_code,stock_name:row.stock_name,market:row.market,
    industry_code:row.industry_code,industry:row.industry,
    auto_business_tags:autoBusinessTags,
  };
}

async function loadProfiles(sql){
  return sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,main_business,internet_address,
    auto_business_tags,auto_market_topics,business_enrich_status,business_enrich_source,business_enrich_version,
    business_enrich_evidence,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
}

function blindCoverageForProfile(row,text,{allowBroad=false}={}){
  const mainBusiness=clean(text);
  const existingRaw=parseAutoBusinessTags(row.auto_business_tags);
  const discoveredRaw=classifyBusinessText(mainBusiness,{industryCode:row.industry_code,code:row.stock_code,allowBroad});
  const rawTags=uniq([...existingRaw,...discoveredRaw]);
  const evidence=detectMarketTopicEvidence(mainBusiness,{minScore:AUDIT_TOPIC_SCORE});
  const existingTopics=parseAutoMarketTopics(row.auto_market_topics);
  const discoveredTopics=evidence.filter(x=>x.score>=AUTO_TOPIC_SCORE).map(x=>x.id);
  const marketTopics=uniq([...existingTopics,...discoveredTopics]);
  return {
    rawTags,marketTopics,discoveredRaw,discoveredTopics,evidence,
    evidencePayload:{
      version:BLIND_COVERAGE_VERSION,
      rawTags:discoveredRaw,
      marketTopics:evidence.map(x=>({id:x.id,score:x.score,kind:x.kind,terms:x.terms.slice(0,8)})),
      textLength:mainBusiness.length
    }
  };
}

function sameStringSet(a,b){
  const x=uniq(a).sort(),y=uniq(b).sort();return x.length===y.length&&x.every((v,i)=>v===y[i]);
}

async function applyCachedBlindCoverage(sql,rows){
  const updates=[];
  for(const row of rows||[]){
    if(!clean(row.main_business))continue;
    const currentResolution=resolveCompanyBusinessTags(profileForResolver(row)).resolution;
    const calc=blindCoverageForProfile(row,row.main_business,{allowBroad:currentResolution==='none'});
    const existingRaw=parseAutoBusinessTags(row.auto_business_tags),existingTopics=parseAutoMarketTopics(row.auto_market_topics);
    const changed=!sameStringSet(existingRaw,calc.rawTags)||!sameStringSet(existingTopics,calc.marketTopics)||String(row.business_enrich_version||'')!==BLIND_COVERAGE_VERSION;
    if(!changed)continue;
    updates.push({
      stock_code:String(row.stock_code),auto_business_tags:calc.rawTags,auto_market_topics:calc.marketTopics,
      business_enrich_status:(calc.discoveredRaw.length||calc.discoveredTopics.length)?'blind-classified':'blind-scanned',
      business_enrich_source:'MOPS t05st03 + blind coverage',business_enrich_version:BLIND_COVERAGE_VERSION,
      business_enrich_evidence:calc.evidencePayload
    });
  }
  if(!updates.length)return {updated:0,addedRaw:0,addedTopics:0};
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        stock_code text, auto_business_tags jsonb, auto_market_topics jsonb,
        business_enrich_status text, business_enrich_source text, business_enrich_version text, business_enrich_evidence jsonb
      )
    )
    UPDATE market_company_profile p SET
      auto_business_tags=i.auto_business_tags,
      auto_market_topics=i.auto_market_topics,
      business_enrich_status=i.business_enrich_status,
      business_enrich_source=i.business_enrich_source,
      business_enrich_version=i.business_enrich_version,
      business_enrich_evidence=i.business_enrich_evidence,
      business_enrich_checked_at=NOW()
    FROM incoming i WHERE p.stock_code=i.stock_code
  `,[JSON.stringify(updates)]);
  let addedRaw=0,addedTopics=0;
  for(const u of updates){
    const old=rows.find(x=>String(x.stock_code)===u.stock_code);addedRaw+=Math.max(0,u.auto_business_tags.length-parseAutoBusinessTags(old?.auto_business_tags).length);addedTopics+=Math.max(0,u.auto_market_topics.length-parseAutoMarketTopics(old?.auto_market_topics).length);
  }
  return {updated:updates.length,addedRaw,addedTopics};
}

function staleMs(row){
  const t=row?.business_enrich_checked_at?new Date(row.business_enrich_checked_at).getTime():NaN;
  return Number.isFinite(t)?Date.now()-t:Number.POSITIVE_INFINITY;
}
function needsNetworkRefresh(row,{retry=false}={}){
  if(!clean(row?.main_business))return true;
  if(retry&&row?.business_enrich_status==='error')return true;
  return staleMs(row)>REFRESH_AFTER_DAYS*86400000;
}

async function runBusinessEnrichment({limit=60,delayMs=0,maxRunMs=46000,retry=false,concurrency=6}={}){
  const { ensureCompanyProfileSchema } = require('./sync-common');
  const { getSql } = require('./db');
  await ensureCompanyProfileSchema(); const sql=getSql();
  const beforeRows=await loadProfiles(sql); const beforeSummary=summarizeProfiles(beforeRows);

  // Phase A (fast/local): EVERY cached MOPS profile is re-evaluated, even when the company already
  // has curated/seed tags. This fixes the old "already classified => never scan for a second theme" bug.
  const cached=await applyCachedBlindCoverage(sql,beforeRows);
  let workingRows=cached.updated?await loadProfiles(sql):beforeRows;

  // Phase B (network): fill missing official main-business text and periodically refresh the oldest profiles.
  // Existing tags are additive; discovering a second/third theme never erases the first one.
  const pool=workingRows.filter(p=>needsNetworkRefresh(p,{retry})).sort((a,b)=>{
    const am=clean(a.main_business)?1:0,bm=clean(b.main_business)?1:0;if(am!==bm)return am-bm;
    const at=a.business_enrich_checked_at?new Date(a.business_enrich_checked_at).getTime():0;
    const bt=b.business_enrich_checked_at?new Date(b.business_enrich_checked_at).getTime():0;
    return at-bt||String(a.stock_code).localeCompare(String(b.stock_code));
  });
  const picked=pool.slice(0,Math.max(1,Math.min(200,Number(limit)||60)));
  const started=Date.now(),results=[];let cursor=0;
  const workers=Array.from({length:Math.max(1,Math.min(10,Number(concurrency)||6))},async()=>{
    while(true){
      if(Date.now()-started>maxRunMs-6500)return;
      const idx=cursor++;if(idx>=picked.length)return;const p=picked[idx];
      try{
        const detail=await fetchMopsProfile(p.stock_code,{timeoutMs:6500});
        const currentResolution=resolveCompanyBusinessTags(profileForResolver(p)).resolution;
        const calc=blindCoverageForProfile(p,detail.mainBusiness,{allowBroad:currentResolution==='none'});
        const status=(calc.discoveredRaw.length||calc.discoveredTopics.length)?'blind-classified':'blind-scanned';
        await sql.query(`UPDATE market_company_profile SET main_business=$2,internet_address=$3,auto_business_tags=$4::jsonb,
          auto_market_topics=$5::jsonb,business_enrich_status=$6,business_enrich_source='MOPS t05st03 + blind coverage',
          business_enrich_version=$7,business_enrich_evidence=$8::jsonb,business_enrich_checked_at=NOW() WHERE stock_code=$1`,[
          p.stock_code,detail.mainBusiness||null,detail.website||null,JSON.stringify(calc.rawTags),JSON.stringify(calc.marketTopics),status,BLIND_COVERAGE_VERSION,JSON.stringify(calc.evidencePayload)
        ]);
        results.push({code:p.stock_code,name:p.stock_name,status,rawTags:calc.rawTags,marketTopics:calc.marketTopics,
          discoveredRaw:calc.discoveredRaw,discoveredTopics:calc.discoveredTopics,mainBusiness:detail.mainBusiness.slice(0,220)});
      }catch(e){
        await sql.query(`UPDATE market_company_profile SET business_enrich_status='error',business_enrich_source='MOPS t05st03 + blind coverage',business_enrich_version=$2,business_enrich_checked_at=NOW() WHERE stock_code=$1`,[p.stock_code,BLIND_COVERAGE_VERSION]).catch(()=>{});
        results.push({code:p.stock_code,name:p.stock_name,status:'error',rawTags:[],marketTopics:[],error:String(e?.message||e)});
      }
      if(delayMs)await sleep(delayMs);
    }
  });
  await Promise.all(workers);

  // Any additive mapping change invalidates old XY membership. Engine version also guards stale persisted rows.
  const mappingChanged=cached.addedRaw>0||cached.addedTopics>0||results.some(x=>x.discoveredRaw?.length||x.discoveredTopics?.length);
  if(mappingChanged)await sql.query(`DELETE FROM market_business_xy_daily`).catch(()=>{});

  const afterRows=await loadProfiles(sql); const afterSummary=summarizeProfiles(afterRows);
  const remaining=afterRows.filter(p=>!clean(p.main_business)||String(p.business_enrich_version||'')!==BLIND_COVERAGE_VERSION).length;
  return {
    ok:true,source:'mops_blind_coverage',version:BLIND_COVERAGE_VERSION,
    cachedReclassified:cached.updated,cachedAddedRaw:cached.addedRaw,cachedAddedTopics:cached.addedTopics,
    networkQueued:pool.length,networkPicked:picked.length,processed:results.length,
    classified:results.filter(x=>x.status==='blind-classified').length,scanned:results.filter(x=>x.status==='blind-scanned').length,
    errors:results.filter(x=>x.status==='error').length,beforePending:beforeSummary.industryFallback,afterPending:afterSummary.industryFallback,
    beforeUnclassified:beforeSummary.unmappedAll,afterUnclassified:afterSummary.unmappedAll,
    remainingBlindScan:remaining,profilesWithMainBusiness:afterRows.filter(x=>clean(x.main_business)).length,totalProfiles:afterRows.length,
    elapsedMs:Date.now()-started,results:results.sort((a,b)=>String(a.code).localeCompare(String(b.code)))
  };
}

async function readBlindCoverageAudit({limit=300,minScore=AUDIT_TOPIC_SCORE}={}){
  const { ensureCompanyProfileSchema } = require('./sync-common');
  const { getSql } = require('./db');
  await ensureCompanyProfileSchema();const sql=getSql();const rows=await loadProfiles(sql),candidates=[];
  for(const p of rows){
    const text=clean(p.main_business);if(!text)continue;
    const current=resolveCompanyBusinessTags(profileForResolver(p));
    const currentRaw=new Set(current.tags.map(x=>x.id));
    const currentTopicLinks=marketTopicLinks(current.tags,p.stock_name,p.stock_code,{autoMarketTopics:p.auto_market_topics,mainBusiness:''});
    const currentTopics=new Set(currentTopicLinks.map(x=>x.id));
    const calc=blindCoverageForProfile(p,text,{allowBroad:current.resolution==='none'});
    const augmented=resolveCompanyBusinessTags(profileForResolver(p,calc.rawTags));
    const predicted=marketTopicLinks(augmented.tags,p.stock_name,p.stock_code,{autoMarketTopics:calc.marketTopics,mainBusiness:text});
    const topicEvidence=new Map(calc.evidence.map(x=>[x.id,x]));
    for(const id of calc.discoveredRaw){
      if(currentRaw.has(id))continue;const def=marketDefinitionForSource(id);
      candidates.push({code:p.stock_code,name:p.stock_name,type:'raw-tag',id,label:getTag(id)?.name||id,marketTopic:def?.name||'',score:90,evidence:'MOPS product/business rule',text:text.slice(0,260)});
    }
    for(const link of predicted){
      if(currentTopics.has(link.id))continue;
      const hit=topicEvidence.get(link.id);const score=hit?.score??(link.origin==='business-tag'||link.sourceTagIds?.length?90:70);
      if(score<minScore)continue;
      candidates.push({code:p.stock_code,name:p.stock_name,type:'market-topic',id:link.id,label:link.name,marketTopic:link.name,score,evidence:hit?`${hit.kind}: ${hit.terms.slice(0,5).join(' | ')}`:(link.sourceTagIds||[]).join(','),text:text.slice(0,260)});
    }
  }
  candidates.sort((a,b)=>b.score-a.score||String(a.code).localeCompare(String(b.code))||a.id.localeCompare(b.id));
  const high=candidates.filter(x=>x.score>=AUTO_TOPIC_SCORE),medium=candidates.filter(x=>x.score<AUTO_TOPIC_SCORE);
  return {ok:true,view:'blind-coverage',version:BLIND_COVERAGE_VERSION,totalProfiles:rows.length,withMainBusiness:rows.filter(x=>clean(x.main_business)).length,
    scanCoveragePct:rows.length?Number((rows.filter(x=>clean(x.main_business)).length/rows.length*100).toFixed(1)):0,
    candidateCount:candidates.length,highConfidence:high.length,mediumConfidence:medium.length,items:candidates.slice(0,Math.max(1,Math.min(1000,Number(limit)||300)))};
}

async function readPendingBusinessEnrichment({limit=200}={}){
  const { ensureCompanyProfileSchema } = require('./sync-common');
  const { getSql } = require('./db');
  await ensureCompanyProfileSchema();const sql=getSql();const rows=await loadProfiles(sql);
  const pending=rows.filter(p=>!clean(p.main_business)||String(p.business_enrich_version||'')!==BLIND_COVERAGE_VERSION);
  const counts={};for(const p of pending){const k=String(p.industry_code||'');counts[k]=(counts[k]||0)+1;}
  return {ok:true,mode:'blind-all-company-scan',version:BLIND_COVERAGE_VERSION,pending:pending.length,withMainBusiness:rows.filter(x=>clean(x.main_business)).length,total:rows.length,byIndustry:counts,
    items:pending.slice(0,Math.max(1,Math.min(500,Number(limit)||200))).map(p=>({code:p.stock_code,name:p.stock_name,market:p.market,industryCode:p.industry_code,industry:p.industry,status:p.business_enrich_status||'',version:p.business_enrich_version||'',checkedAt:p.business_enrich_checked_at||null,mainBusiness:p.main_business||''}))};
}

async function readUnclassifiedProfiles({limit=200}={}){
  const { ensureCompanyProfileSchema } = require('./sync-common');
  const { getSql } = require('./db');
  await ensureCompanyProfileSchema();const sql=getSql();const rows=await loadProfiles(sql);
  const items=rows.filter(p=>resolveCompanyBusinessTags(profileForResolver(p)).resolution==='none');
  const counts={};for(const p of items){const k=String(p.industry_code||'');counts[k]=(counts[k]||0)+1;}
  return {ok:true,unclassified:items.length,byIndustry:counts,items:items.slice(0,Math.max(1,Math.min(500,Number(limit)||200))).map(p=>({code:p.stock_code,name:p.stock_name,market:p.market,industryCode:p.industry_code,industry:p.industry,status:p.business_enrich_status||'',checkedAt:p.business_enrich_checked_at||null,mainBusiness:p.main_business||''}))};
}

module.exports={
  RULES,BROAD_RULES,CODE_OVERRIDES,BLIND_COVERAGE_VERSION,AUTO_TOPIC_SCORE,
  classifyBusinessText,classifyBroadBusinessText,blindCoverageForProfile,fetchMopsProfile,
  runBusinessEnrichment,readBlindCoverageAudit,readPendingBusinessEnrichment,readUnclassifiedProfiles
};
