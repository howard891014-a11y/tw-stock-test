// StockZone v2.6.2.32
// Business Tag Engine v2
//
// Design rule:
// 1) Technology/electronics are classified by fine-grained business/technology tags.
// 2) Traditional/financial industries may use a coarse sector tag directly.
// 3) Only voteEligible tags are allowed to enter the daily market-business vote.
// 4) Parent/category/theme tags remain searchable/displayable, but do not compete in Top N.

function tag(id, name, parent, options = {}) {
  return Object.freeze({
    id,
    name,
    parent: parent || null,
    kind: options.kind || "business",
    resolution: options.resolution || "fine",
    voteEligible: Boolean(options.voteEligible),
    aliases: Object.freeze([...(options.aliases || [])]),
    note: options.note || "",
  });
}

const TAGS = Object.freeze([
  // ---------- Technology / electronics category nodes (not market-votable) ----------
  tag("tech", "科技電子", null, { kind: "sector", resolution: "coarse" }),
  tag("semiconductor", "半導體", "tech", { kind: "sector", resolution: "coarse" }),
  tag("ic_design", "IC設計", "semiconductor", { kind: "subsector", resolution: "coarse", aliases: ["晶片設計"] }),
  tag("wafer_process", "晶圓製造與製程", "semiconductor", { kind: "subsector", resolution: "coarse" }),
  tag("semiconductor_material", "半導體材料", "semiconductor", { kind: "subsector", resolution: "coarse" }),
  tag("semiconductor_equipment", "半導體設備", "semiconductor", { kind: "subsector", resolution: "coarse" }),
  tag("advanced_packaging", "先進封裝", "semiconductor", { kind: "subsector", resolution: "coarse" }),
  tag("semiconductor_test", "半導體測試", "semiconductor", { kind: "subsector", resolution: "coarse" }),
  tag("optical", "光通訊與光電", "tech", { kind: "sector", resolution: "coarse", aliases: ["光通訊", "光電"] }),
  tag("pcb", "PCB與載板", "tech", { kind: "sector", resolution: "coarse", aliases: ["PCB", "印刷電路板"] }),
  tag("server", "伺服器與資料中心", "tech", { kind: "sector", resolution: "coarse", aliases: ["伺服器", "資料中心"] }),
  tag("thermal", "散熱", "tech", { kind: "sector", resolution: "coarse" }),
  tag("power_electronics", "電源與功率電子", "tech", { kind: "sector", resolution: "coarse" }),
  tag("passive", "被動元件", "tech", { kind: "sector", resolution: "coarse" }),
  tag("display", "顯示與面板", "tech", { kind: "sector", resolution: "coarse" }),
  tag("storage", "記憶體與儲存", "tech", { kind: "sector", resolution: "coarse" }),
  tag("automation", "自動化與設備", "tech", { kind: "sector", resolution: "coarse" }),
  tag("connector", "連接器與高速傳輸", "tech", { kind: "sector", resolution: "coarse" }),
  tag("computing", "電腦與週邊", "tech", { kind: "sector", resolution: "coarse" }),
  tag("networking", "網路與通訊設備", "tech", { kind: "sector", resolution: "coarse" }),
  tag("software", "軟體與數位服務", "tech", { kind: "sector", resolution: "coarse" }),
  tag("imaging", "光學與影像", "tech", { kind: "sector", resolution: "coarse" }),
  tag("electronics_services", "電子製造與通路", "tech", { kind: "sector", resolution: "coarse" }),


  // ---------- Technology minimum business labels ----------
  // These are only used when a native technology company has not yet matched a more specific
  // product/process tag. They are business labels (not "other" buckets), so technology companies
  // never fall back to a generic coarse/other label. More specific curated/official-chain tags win.
  tag("semiconductor_products_services", "半導體產品／服務", "semiconductor", { voteEligible: true, aliases: ["半導體產品", "半導體服務"] }),
  tag("optoelectronic_components_modules", "光電元件／模組", "optical", { voteEligible: true, aliases: ["光電元件", "光電模組"] }),
  tag("electronic_components_manufacturing", "電子零組件製造", "tech", { voteEligible: true, aliases: ["電子零組件"] }),
  tag("information_software_services", "資訊軟體服務", "software", { voteEligible: true, aliases: ["資訊服務", "軟體服務"] }),
  tag("electronics_manufacturing_services", "電子製造／設備服務", "electronics_services", { voteEligible: true, aliases: ["電子設備整合服務", "電子製造設備服務"] }),
  tag("digital_cloud_services", "數位平台／雲端服務", "software", { voteEligible: true, aliases: ["數位平台", "數位雲端服務"] }),

  // ---------- IC design ----------
  tag("asic", "ASIC", "ic_design", { voteEligible: true, aliases: ["客製化晶片", "客製晶片", "ASIC晶片"] }),
  tag("asic_design_service", "ASIC設計服務", "ic_design", { voteEligible: true, aliases: ["ASIC服務", "ASIC design service", "IC設計服務"] }),
  tag("soc", "SoC", "ic_design", { voteEligible: true, aliases: ["系統單晶片", "系統級晶片"] }),
  tag("mcu", "MCU", "ic_design", { voteEligible: true, aliases: ["微控制器", "微控制器晶片"] }),
  tag("pmic", "PMIC", "ic_design", { voteEligible: true, aliases: ["電源管理IC", "電源管理晶片"] }),
  tag("display_driver_ic", "顯示驅動IC", "ic_design", { voteEligible: true, aliases: ["DDI", "Driver IC", "驅動IC"] }),
  tag("touch_controller_ic", "觸控IC", "ic_design", { voteEligible: true, aliases: ["觸控控制IC"] }),
  tag("network_ic", "網通IC", "ic_design", { voteEligible: true, aliases: ["網路IC", "乙太網路IC"] }),
  tag("high_speed_ic", "高速傳輸IC", "ic_design", { voteEligible: true, aliases: ["高速介面IC", "高速I/O IC"] }),
  tag("retimer", "Retimer", "ic_design", { voteEligible: true, aliases: ["重定時器", "Retimer IC"] }),
  tag("ai_accelerator", "AI加速晶片", "ic_design", { voteEligible: true, aliases: ["AI晶片", "NPU", "AI Accelerator"] }),
  tag("cpu", "CPU", "ic_design", { voteEligible: true, aliases: ["中央處理器"] }),
  tag("gpu", "GPU", "ic_design", { voteEligible: true, aliases: ["圖形處理器"] }),
  tag("semiconductor_ip", "半導體IP", "ic_design", { voteEligible: true, aliases: ["矽智財", "IP授權", "IC IP"] }),
  tag("memory_controller", "記憶體控制IC", "ic_design", { voteEligible: true, aliases: ["Memory Controller"] }),
  tag("ssd_controller", "SSD控制IC", "ic_design", { voteEligible: true, aliases: ["SSD Controller", "固態硬碟控制IC"] }),
  tag("security_ic", "安全晶片", "ic_design", { voteEligible: true, aliases: ["Security IC", "安全IC"] }),

  // ---------- Wafer manufacturing / power semiconductor ----------
  tag("advanced_foundry", "先進製程晶圓代工", "wafer_process", { voteEligible: true, aliases: ["先進製程代工"] }),
  tag("mature_foundry", "成熟製程晶圓代工", "wafer_process", { voteEligible: true, aliases: ["成熟製程代工"] }),
  tag("specialty_process", "特殊製程", "wafer_process", { voteEligible: true, aliases: ["Specialty Process"] }),
  tag("mosfet", "MOSFET", "wafer_process", { voteEligible: true, aliases: ["功率MOSFET", "MOS管"] }),
  tag("igbt", "IGBT", "wafer_process", { voteEligible: true, aliases: ["絕緣閘雙極電晶體"] }),
  tag("gan_power", "GaN功率半導體", "wafer_process", { voteEligible: true, aliases: ["GaN", "氮化鎵功率元件"] }),
  tag("sic_power", "SiC功率半導體", "wafer_process", { voteEligible: true, aliases: ["SiC", "碳化矽功率元件"] }),
  tag("wafer", "矽晶圓", "wafer_process", { voteEligible: true, aliases: ["Silicon Wafer", "晶圓材料"] }),
  tag("epitaxy", "磊晶", "wafer_process", { voteEligible: true, aliases: ["Epitaxy", "磊晶片"] }),
  tag("photomask", "光罩", "wafer_process", { voteEligible: true, aliases: ["Photomask", "光掩模"] }),

  // ---------- Semiconductor materials ----------
  tag("photoresist", "光阻", "semiconductor_material", { voteEligible: true, aliases: ["Photoresist"] }),
  tag("cmp_slurry", "CMP材料", "semiconductor_material", { voteEligible: true, aliases: ["CMP研磨液", "CMP Slurry"] }),
  tag("specialty_gas", "半導體特氣", "semiconductor_material", { voteEligible: true, aliases: ["電子特氣", "Specialty Gas"] }),
  tag("wet_chemicals", "半導體濕製程化學品", "semiconductor_material", { voteEligible: true, aliases: ["濕製程化學品", "電子化學品"] }),
  tag("precursor", "半導體前驅物", "semiconductor_material", { voteEligible: true, aliases: ["Precursor", "前驅物"] }),
  tag("quartz_parts", "石英耗材", "semiconductor_material", { voteEligible: true, aliases: ["石英零件", "Quartz Parts"] }),
  tag("silicon_parts", "矽耗材", "semiconductor_material", { voteEligible: true, aliases: ["矽零件", "Silicon Parts"] }),
  tag("semiconductor_other_material", "其他半導體材料", "semiconductor_material", { voteEligible: true }),

  // ---------- Semiconductor equipment ----------
  tag("wet_process_equipment", "濕製程設備", "semiconductor_equipment", { voteEligible: true, aliases: ["清洗設備", "濕式設備"] }),
  tag("coating_develop_equipment", "塗佈顯影設備", "semiconductor_equipment", { voteEligible: true, aliases: ["Coater Developer"] }),
  tag("deposition_equipment", "薄膜沉積設備", "semiconductor_equipment", { voteEligible: true, aliases: ["CVD設備", "PVD設備", "ALD設備"] }),
  tag("etch_equipment", "蝕刻設備", "semiconductor_equipment", { voteEligible: true, aliases: ["Etch Equipment"] }),
  tag("bonding_equipment", "鍵合設備", "semiconductor_equipment", { voteEligible: true, aliases: ["Bonding Equipment", "混合鍵合設備"] }),
  tag("laser_processing_equipment", "雷射製程設備", "semiconductor_equipment", { voteEligible: true, aliases: ["雷射設備", "Laser Processing"] }),
  tag("semiconductor_automation_equipment", "半導體自動化設備", "semiconductor_equipment", { voteEligible: true, aliases: ["半導體自動化", "自動化搬運設備"] }),
  tag("semiconductor_other_equipment", "其他半導體設備", "semiconductor_equipment", { voteEligible: true }),

  // ---------- Advanced packaging ----------
  tag("cowos", "CoWoS", "advanced_packaging", { voteEligible: true, aliases: ["CoWoS封裝", "Chip-on-Wafer-on-Substrate"] }),
  tag("soic", "SoIC", "advanced_packaging", { voteEligible: true, aliases: ["SoIC封裝", "System on Integrated Chips"] }),
  tag("info_packaging", "InFO", "advanced_packaging", { voteEligible: true, aliases: ["InFO封裝", "Integrated Fan-Out"] }),
  tag("copos", "CoPoS", "advanced_packaging", { voteEligible: true, aliases: ["CoPoS封裝"] }),
  tag("foplp", "FOPLP", "advanced_packaging", { voteEligible: true, aliases: ["扇出型面板級封裝", "Fan-Out Panel Level Packaging"] }),
  tag("glass_substrate", "玻璃基板", "advanced_packaging", { voteEligible: true, aliases: ["Glass Substrate", "玻璃載板"] }),
  tag("advanced_packaging_equipment", "先進封裝設備", "advanced_packaging", { voteEligible: true, aliases: ["封裝設備"] }),
  tag("advanced_packaging_material", "先進封裝材料", "advanced_packaging", { voteEligible: true, aliases: ["封裝材料"] }),
  tag("osat", "封裝測試服務", "advanced_packaging", { voteEligible: true, aliases: ["OSAT", "封測"] }),

  // ---------- Semiconductor testing ----------
  tag("ate", "ATE測試設備", "semiconductor_test", { voteEligible: true, aliases: ["自動測試設備", "ATE"] }),
  tag("handler", "測試分選機", "semiconductor_test", { voteEligible: true, aliases: ["Handler", "分選機"] }),
  tag("probe_card", "探針卡", "semiconductor_test", { voteEligible: true, aliases: ["Probe Card"] }),
  tag("test_socket", "測試座", "semiconductor_test", { voteEligible: true, aliases: ["Test Socket", "測試介面"] }),
  tag("burn_in", "老化測試", "semiconductor_test", { voteEligible: true, aliases: ["Burn-in", "燒機測試"] }),
  tag("semiconductor_test_service", "IC測試服務", "semiconductor_test", { voteEligible: true, aliases: ["晶片測試服務"] }),

  // ---------- Optical / photonics ----------
  tag("cpo", "CPO", "optical", { voteEligible: true, aliases: ["共同封裝光學", "Co-Packaged Optics"] }),
  tag("npo", "NPO", "optical", { voteEligible: true, aliases: ["Near-Packaged Optics", "近封裝光學"] }),
  tag("silicon_photonics", "矽光子", "optical", { voteEligible: true, aliases: ["Silicon Photonics"] }),
  tag("optical_module", "光通訊模組", "optical", { voteEligible: true, aliases: ["光模組", "Optical Module"] }),
  tag("optical_engine", "光引擎", "optical", { voteEligible: true, aliases: ["Optical Engine"] }),
  tag("optical_transceiver", "光收發器", "optical", { voteEligible: true, aliases: ["Transceiver", "光收發模組"] }),
  tag("laser_vcsel", "雷射/VCSEL", "optical", { voteEligible: true, aliases: ["VCSEL", "雷射二極體"] }),
  tag("fiber_component", "光纖元件", "optical", { voteEligible: true, aliases: ["光纖連接器", "光纖被動元件"] }),

  // ---------- PCB / substrate ----------
  tag("abf_substrate", "ABF載板", "pcb", { voteEligible: true, aliases: ["ABF", "ABF IC載板"] }),
  tag("bt_substrate", "BT載板", "pcb", { voteEligible: true, aliases: ["BT", "BT IC載板"] }),
  tag("ccl", "CCL", "pcb", { voteEligible: true, aliases: ["銅箔基板", "Copper Clad Laminate"] }),
  tag("hdi", "HDI", "pcb", { voteEligible: true, aliases: ["高密度互連板"] }),
  tag("fpcb", "FPCB", "pcb", { voteEligible: true, aliases: ["軟板", "柔性印刷電路板"] }),
  tag("rigid_flex", "軟硬結合板", "pcb", { voteEligible: true, aliases: ["Rigid-Flex"] }),
  tag("general_pcb", "一般PCB", "pcb", { voteEligible: true, aliases: ["一般印刷電路板"] }),
  tag("copper_foil", "銅箔", "pcb", { voteEligible: true, aliases: ["電解銅箔"] }),
  tag("glass_fiber_cloth", "玻纖布", "pcb", { voteEligible: true, aliases: ["玻璃纖維布"] }),
  tag("pcb_equipment", "PCB設備", "pcb", { voteEligible: true, aliases: ["電路板設備"] }),

  // ---------- Server / data center ----------
  tag("ai_server", "AI伺服器", "server", { voteEligible: true, aliases: ["AI Server"] }),
  tag("server_odm", "伺服器ODM", "server", { voteEligible: true, aliases: ["Server ODM", "伺服器代工"] }),
  tag("server_motherboard", "伺服器主機板", "server", { voteEligible: true, aliases: ["Server Motherboard"] }),
  tag("bmc", "BMC", "server", { voteEligible: true, aliases: ["基板管理控制器", "Baseboard Management Controller"] }),
  tag("server_chassis", "伺服器機殼", "server", { voteEligible: true, aliases: ["Server Chassis"] }),
  tag("server_rack", "伺服器機櫃", "server", { voteEligible: true, aliases: ["Rack", "機櫃"] }),
  tag("server_rail", "伺服器滑軌", "server", { voteEligible: true, aliases: ["滑軌", "Server Rail"] }),
  tag("server_cable", "伺服器高速線材", "server", { voteEligible: true, aliases: ["高速線材", "高速傳輸線"] }),

  // ---------- Thermal ----------
  tag("air_cooling", "氣冷散熱", "thermal", { voteEligible: true, aliases: ["Air Cooling"] }),
  tag("liquid_cooling", "液冷散熱", "thermal", { voteEligible: true, aliases: ["Liquid Cooling", "水冷"] }),
  tag("cold_plate", "冷板", "thermal", { voteEligible: true, aliases: ["Cold Plate"] }),
  tag("cdu", "CDU", "thermal", { voteEligible: true, aliases: ["冷卻液分配單元", "Coolant Distribution Unit"] }),
  tag("quick_disconnect", "液冷快接頭", "thermal", { voteEligible: true, aliases: ["QD", "Quick Disconnect"] }),
  tag("fan", "風扇", "thermal", { voteEligible: true, aliases: ["散熱風扇"] }),
  tag("heat_pipe_vapor_chamber", "熱管/均熱板", "thermal", { voteEligible: true, aliases: ["Heat Pipe", "Vapor Chamber", "均熱板"] }),

  // ---------- Power / passive / connector ----------
  tag("server_psu", "伺服器電源", "power_electronics", { voteEligible: true, aliases: ["Server PSU", "伺服器電源供應器"] }),
  tag("power_supply", "電源供應器", "power_electronics", { voteEligible: true, aliases: ["PSU"] }),
  tag("ups", "UPS", "power_electronics", { voteEligible: true, aliases: ["不斷電系統"] }),
  tag("power_module", "功率模組", "power_electronics", { voteEligible: true, aliases: ["Power Module"] }),
  tag("mlcc", "MLCC", "passive", { voteEligible: true, aliases: ["積層陶瓷電容"] }),
  tag("resistor", "電阻", "passive", { voteEligible: true, aliases: ["晶片電阻"] }),
  tag("inductor", "電感", "passive", { voteEligible: true, aliases: ["功率電感"] }),
  tag("capacitor", "電容", "passive", { voteEligible: true, aliases: ["鋁電容", "固態電容"] }),
  tag("crystal_oscillator", "石英元件", "passive", { voteEligible: true, aliases: ["晶振", "Crystal Oscillator"] }),
  tag("high_speed_connector", "高速連接器", "connector", { voteEligible: true, aliases: ["High-Speed Connector"] }),
  tag("general_connector", "連接器", "connector", { voteEligible: true, aliases: ["Connector"] }),
  tag("cable_assembly", "線束/線材組件", "connector", { voteEligible: true, aliases: ["Cable Assembly", "線材"] }),

  // ---------- Memory / storage ----------
  tag("dram", "DRAM", "storage", { voteEligible: true, aliases: ["動態隨機存取記憶體"] }),
  tag("nand", "NAND Flash", "storage", { voteEligible: true, aliases: ["NAND", "NAND快閃記憶體"] }),
  tag("nor_flash", "NOR Flash", "storage", { voteEligible: true, aliases: ["NOR", "NOR快閃記憶體"] }),
  tag("hbm", "HBM", "storage", { voteEligible: true, aliases: ["高頻寬記憶體", "High Bandwidth Memory"] }),
  tag("ssd", "SSD", "storage", { voteEligible: true, aliases: ["固態硬碟"] }),
  tag("memory_module", "記憶體模組", "storage", { voteEligible: true, aliases: ["Memory Module"] }),

  // ---------- Display ----------
  tag("lcd_panel", "LCD面板", "display", { voteEligible: true, aliases: ["LCD"] }),
  tag("oled", "OLED", "display", { voteEligible: true, aliases: ["OLED面板"] }),
  tag("mini_led", "Mini LED", "display", { voteEligible: true, aliases: ["MiniLED"] }),
  tag("micro_led", "Micro LED", "display", { voteEligible: true, aliases: ["MicroLED"] }),
  tag("touch_panel", "觸控面板", "display", { voteEligible: true, aliases: ["Touch Panel"] }),

  // ---------- Automation ----------
  tag("aoi", "AOI", "automation", { voteEligible: true, aliases: ["自動光學檢測", "Automatic Optical Inspection"] }),
  tag("machine_vision", "機器視覺", "automation", { voteEligible: true, aliases: ["Machine Vision"] }),
  tag("factory_automation", "工廠自動化", "automation", { voteEligible: true, aliases: ["FA", "Factory Automation"] }),
  tag("industrial_robot", "工業機器人", "automation", { voteEligible: true, aliases: ["機械手臂", "Industrial Robot"] }),

  // ---------- Network / communications ----------
  tag("network_equipment", "網路設備", "networking", { voteEligible: true, aliases: ["路由器", "交換器", "閘道器", "Networking Equipment"] }),
  tag("optical_communication_equipment", "光通訊設備", "networking", { voteEligible: true, aliases: ["光傳輸設備"] }),
  tag("wireless_communication_equipment", "無線通訊設備", "networking", { voteEligible: true, aliases: ["無線網通設備"] }),
  tag("telecom_service_business", "電信服務", "networking", { voteEligible: true, aliases: ["電信服務業"] }),

  // ---------- Computing / peripherals ----------
  tag("industrial_pc", "工業電腦", "computing", { voteEligible: true, aliases: ["IPC", "Industrial PC"] }),
  tag("graphics_card", "顯示卡", "computing", { voteEligible: true, aliases: ["VGA", "Graphics Card"] }),
  tag("storage_system", "儲存系統", "computing", { voteEligible: true, aliases: ["磁碟儲存系統", "Storage System"] }),
  tag("computer_peripheral_business", "電腦週邊設備", "computing", { voteEligible: true, aliases: ["電腦周邊設備"] }),
  tag("embedded_system", "嵌入式系統", "computing", { voteEligible: true, aliases: ["Embedded System"] }),
  tag("bios_firmware", "BIOS/韌體", "computing", { voteEligible: true, aliases: ["BIOS", "Firmware"] }),

  // ---------- Imaging ----------
  tag("optical_lens", "光學鏡頭", "imaging", { voteEligible: true, aliases: ["光學鏡片", "鏡頭"] }),
  tag("camera_module", "相機模組", "imaging", { voteEligible: true, aliases: ["Camera Module"] }),
  tag("security_surveillance", "安全監控", "imaging", { voteEligible: true, aliases: ["監控系統", "Security Surveillance"] }),

  // ---------- Software / digital services ----------
  tag("software_development", "軟體開發", "software", { voteEligible: true, aliases: ["應用軟體", "系統軟體設計開發"] }),
  tag("system_integration", "系統整合", "software", { voteEligible: true, aliases: ["SI", "系統整合服務"] }),
  tag("data_processing", "資料處理", "software", { voteEligible: true, aliases: ["資料處理服務"] }),
  tag("cloud_service", "雲端服務", "software", { voteEligible: true, aliases: ["Cloud Service", "雲端平台"] }),
  tag("cybersecurity", "資安", "software", { voteEligible: true, aliases: ["資訊安全", "Cybersecurity"] }),
  tag("ai_solution", "AI應用/解決方案", "software", { voteEligible: true, aliases: ["AI解決方案", "人工智慧應用"] }),

  // ---------- Electronics manufacturing / automation ----------
  tag("ems_odm", "電子製造服務", "electronics_services", { voteEligible: true, aliases: ["EMS", "電子代工"] }),
  tag("electronic_distribution_business", "電子通路", "electronics_services", { voteEligible: true, aliases: ["IC通路", "電子零組件通路"] }),
  tag("automation_machine", "自動化機台", "automation", { voteEligible: true, aliases: ["自動化設備機台"] }),

  // ---------- Full-market technology fallback buckets ----------
  // Used only when a listed/OTC technology company has no finer curated/official-chain tag yet.
  tag("semiconductor_other_business", "半導體其他業務", "semiconductor", { voteEligible: false, resolution: "fallback" }),
  tag("electronic_components_other", "電子零組件其他", "tech", { voteEligible: false, resolution: "fallback" }),
  tag("computer_peripheral_other", "電腦週邊其他", "computing", { voteEligible: false, resolution: "fallback" }),
  tag("optoelectronics_other", "光電其他", "optical", { voteEligible: false, resolution: "fallback" }),
  tag("communication_other", "通信網路其他", "networking", { voteEligible: false, resolution: "fallback" }),
  tag("information_service_other", "資訊服務其他", "software", { voteEligible: false, resolution: "fallback" }),
  tag("electronic_distribution_other", "電子通路其他", "electronics_services", { voteEligible: false, resolution: "fallback" }),
  tag("other_electronics_business", "其他電子業務", "electronics_services", { voteEligible: false, resolution: "fallback" }),
  tag("digital_cloud_other", "數位雲端其他", "software", { voteEligible: false, resolution: "fallback" }),

  // ---------- Coarse traditional / non-tech market-votable sectors ----------
  tag("finance", "金融", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["金融保險"] }),
  tag("shipping", "航運", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["海運", "航空運輸"] }),
  tag("steel", "鋼鐵", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("cement", "水泥", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("plastics", "塑化", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["塑膠"] }),
  tag("chemical", "化工", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["化學工業"] }),
  tag("textile", "紡織", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["紡織纖維"] }),
  tag("food", "食品", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("machinery", "機械", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("auto", "汽車", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["汽車零組件"] }),
  tag("construction", "營建", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["營建建材", "建設"] }),
  tag("retail", "零售通路", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["百貨", "通路"] }),
  tag("tourism", "觀光餐旅", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["觀光", "餐旅"] }),
  tag("biotech", "生技醫療", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["生技", "醫療"] }),
  tag("telecom", "電信", null, { kind: "sector", resolution: "coarse", voteEligible: false }),
  tag("green_energy", "綠能", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["再生能源"] }),
  tag("defense", "國防軍工", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["軍工", "國防"] }),
  tag("electrical_cable", "電器電纜", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["電纜"] }),
  tag("glass_ceramics", "玻璃陶瓷", null, { kind: "sector", resolution: "coarse", voteEligible: true, aliases: ["玻璃"] }),
  tag("paper", "造紙", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("rubber", "橡膠", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("conglomerate", "綜合", null, { kind: "sector", resolution: "coarse", voteEligible: false }),
  tag("other_industry", "其他產業", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("oil_gas_utility", "油電燃氣", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("cultural_creative", "文化創意", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("agri_tech", "農業科技", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("sports_leisure", "運動休閒", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
  tag("home_living", "居家生活", null, { kind: "sector", resolution: "coarse", voteEligible: true }),
]);

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—－\/／()（）·・]+/g, "");
}

const BY_ID = new Map(TAGS.map((x) => [x.id, x]));
const BY_NAME = new Map();
for (const item of TAGS) {
  for (const raw of [item.name, ...item.aliases]) {
    const key = normalizeKey(raw);
    if (!key || BY_NAME.has(key)) continue;
    BY_NAME.set(key, item);
  }
}

function getTag(id) {
  return BY_ID.get(String(id || "")) || null;
}

function resolveTag(value) {
  if (!value) return null;
  const byId = getTag(value);
  if (byId) return byId;
  return BY_NAME.get(normalizeKey(value)) || null;
}

function isVoteEligible(value) {
  const item = typeof value === "object" && value ? value : resolveTag(value);
  return Boolean(item?.voteEligible);
}

function listChildren(parentId) {
  return TAGS.filter((x) => x.parent === parentId);
}

function listVoteEligible() {
  return TAGS.filter((x) => x.voteEligible);
}

module.exports = Object.freeze({
  version: "2.2.0",
  tags: TAGS,
  normalizeKey,
  getTag,
  resolveTag,
  isVoteEligible,
  listChildren,
  listVoteEligible,
});
