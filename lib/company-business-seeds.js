// StockZone v2.6.2.33-C4
// High-confidence company-name business seeds from the TWSE/TPEx Industry Value Chain platform.
// These are additive to the hand-curated symbol map in company-business-tags.js.
// Runtime resolution is name-based so the seed layer does not need to hardcode stock codes.

function uniq(xs){ return [...new Set(xs.map(x=>String(x||'').trim()).filter(Boolean))]; }

const GROUPS = Object.freeze({
  // v2.6.2.33-C4 — anchors for the final 26-company one-by-one cleanup.
  biomedical_health: uniq(['數泓科','永悅健康-創','明基材']),
  solder_material: uniq(['晟楠']),
  functional_electronic_material: uniq(['久威','汎瑋材料']),
  precision_metal_mask: uniq(['旭暉應材']),
  emc_protection_component: uniq(['穩得']),
  rfid_tag: uniq(['永道-KY']),
  digital_remittance: uniq(['東聯互動']),
  renewable_energy_equipment: uniq(['安葆']),
  pcb_tooling: uniq(['尖點']),
  ferrite_magnetic_component: uniq(['越峰']),
  image_sensor_module: uniq(['菱光']),
  surface_treatment: uniq(['匯鑽科']),
  digital_media_streaming: uniq(['愛爾達-創']),
  // v2.6.2.33-C2 — anchors for second-pass MOPS fine tags.
  keyboard_input_device: uniq(['達方','群光','致伸']),
  consumer_electronics: uniq(['宏碁','華碩','無敵']),
  audio_component: uniq(['東科-KY','美律','志豐']),
  test_measurement_instrument: uniq(['固緯','致茂']),
  semiconductor_facility_engineering: uniq(['漢唐','亞翔','聖暉*','洋基工程','帆宣']),
  holographic_optical_material: uniq(['光群雷']),
  optocoupler: uniq(['冠西電']),
  relay_sensor: uniq(['百容']),
  precision_metal_components: uniq(['鉅祥','位速','州巧']),
  card_reader: uniq(['連宇']),
  pos_payment_terminal: uniq(['虹堡','振樺電']),
  hdd_component: uniq(['銘異']),
  antenna_rf: uniq(['耀登','譁裕']),
  rf_testing_certification: uniq(['耕興','東研信超']),
  cover_glass: uniq(['正達']),
  acoustic_component: uniq(['志豐','美律']),
  automotive_electronics: uniq(['同致','輝創','胡連']),
  automotive_sensor: uniq(['橙的','同致']),
  pi_film: uniq(['達邁']),
  online_game: uniq(['歐買尬','傳奇']),
  ecommerce_platform: uniq(['網家','富邦媒','創業家']),
  digital_platform: uniq(['數字','尚凡']),
  payment_platform: uniq(['LINEPAY','綠界科技*']),
  digital_identity_antifraud: uniq(['GOGOLOOK']),
  iot_solution: uniq(['研華','凌華']),
  smart_meter_energy_management: uniq(['玖鼎']),
  led_lighting: uniq(['湯石照明']),
  battery_material: uniq(['立凱-KY']),
  semiconductor_analysis_service: uniq(['閎康','汎銓','宜特']),
  e_paper: uniq(['元太']),
  pcba_ems: uniq(['泰詠','台表科']),
  automatic_data_capture: uniq(['欣技']),
  it_distribution: uniq(['建達','展碁國際','大聯大']),
  // v2.6.2.33-C3 — anchors for the third-pass unresolved pool.
  display_device: uniq(['瑞軒']),
  vacuum_coating_service: uniq(['友威科','岱稜']),
  keypad_mechanical_component: uniq(['閎暉']),
  infrared_thermal_sensor: uniq(['熱映']),
  electromechanical_switch: uniq(['崧騰']),
  solar_system_engineering: uniq(['國碩']),
  solar_conductive_paste: uniq(['碩禾']),
  ceramic_substrate: uniq(['九豪']),
  capacitor_foil: uniq(['立敦']),
  optical_filter_coating: uniq(['統新']),
  sip_module_packaging: uniq(['訊芯-KY']),
  screen_printing_mesh: uniq(['倉和']),
  it_service: uniq(['中湛']),
  consumer_electronics_retail: uniq(['全國電']),
  // v2.6.2.31 — verified advanced-packaging cross-theme audit.
  // These overlays complement product-category tags with platform/process exposure.
  cowos: uniq(['萬潤','志聖','辛耘','均華','弘塑']),
  soic: uniq(['萬潤','志聖','均華']),
  // v2.6.2.30 — coarse-theme cleanup.
  // 國防軍工保留為可投票題材，使用直接公開國防業務的上市公司作為 anchor。
  // 「電信」與「綜合」兩個粗分類已在 business-tags 停止投票：前者與「電信服務」重複，
  // 後者目前沒有可驗證的現行公司群，避免為了消滅 0 家而硬塞。
  defense: uniq(['漢翔','龍德造船','雷虎']),
  // v2.6.2.29 A2 — zero-company taxonomy repair.
  // These are related/high-confidence listed-company mappings so every fine business
  // definition has at least one usable company anchor instead of showing a 0-company card.
  // Where a tag is a technology/supply-chain theme rather than a pure-play product,
  // the seed remains `related` at runtime and therefore cannot override curated core tags.
  retimer: uniq(['譜瑞-KY','祥碩']),
  ai_accelerator: uniq(['世芯-KY','創意','智原']),
  cpu: uniq(['威盛']),
  gpu: uniq(['威盛','世芯-KY','創意']),
  security_ic: uniq(['神盾','新唐']),
  mature_foundry: uniq(['聯電','世界','力積電','台積電']),
  specialty_process: uniq(['世界','聯電','力積電','漢磊']),
  gan_power: uniq(['漢磊','嘉晶']),
  sic_power: uniq(['漢磊','嘉晶']),
  silicon_parts: uniq(['崇越','中砂']),
  coating_develop_equipment: uniq(['志聖','東捷']),
  deposition_equipment: uniq(['天虹','京鼎']),
  etch_equipment: uniq(['天虹','京鼎']),
  semiconductor_other_equipment: uniq(['台達電','致茂','志聖','德律','辛耘','弘塑','均豪','均華','鈦昇','東捷']),
  copos: uniq(['志聖','萬潤']),
  foplp: uniq(['群創','晶彩科','由田','辛耘','弘塑','鈦昇','群翊','東捷','均豪','志聖','萬潤']),
  glass_substrate: uniq(['群創','台玻','東捷','雷科','鈦昇','創新服務','欣興','臻鼎-KY','TPK-KY','正達','晶呈科技','川寶','群翊','友威科','蔚華科','南電','景碩']),
  handler: uniq(['鴻勁','致茂']),
  burn_in: uniq(['京元電子','欣銓','矽格']),
  npo: uniq(['上詮','光聖','波若威']),
  silicon_photonics: uniq(['上詮','光聖','波若威','聯亞']),
  rigid_flex: uniq(['台郡','嘉聯益','臻鼎-KY','燿華']),
  server_cable: uniq(['貿聯-KY','信邦','良維','鴻呈']),
  quick_disconnect: uniq(['富世達','佳必琪']),
  ups: uniq(['碩天','台達電','飛宏']),
  high_speed_connector: uniq(['嘉澤','貿聯-KY','優群','佳必琪']),
  hbm: uniq(['日月光投控','力成','矽格']),
  oled: uniq(['錸寶','友達','群創']),
  mini_led: uniq(['富采','友達','群創']),
  micro_led: uniq(['富采','友達','錼創科技-KY創']),
  aoi: uniq(['由田','牧德','晶彩科','德律']),
  machine_vision: uniq(['所羅門','由田','凌華']),
  embedded_system: uniq(['研華','凌華','威強電','樺漢','艾訊']),
  camera_module: uniq(['致伸','佳能','華晶科']),
  cloud_service: uniq(['伊雲谷','是方','中華電','精誠','叡揚']),
  cybersecurity: uniq(['敦陽科','零壹','邁達特','關貿','中華資安','安碁資訊','叡揚','創泓科技']),
  ems_odm: uniq(['鴻海','和碩','緯創','仁寶','廣達']),

  // v2.6.2.28 A — high-confidence semiconductor / photonics mapping addendum.
  // Only direct or clearly related public-company evidence is added here; ambiguous names remain unmapped.
  photomask: uniq(['光罩','翔耀']),
  photoresist: uniq(['永光','新應材']),
  cmp_slurry: uniq(['三福化']),
  specialty_gas: uniq(['台特化','晶呈科技']),
  wet_chemicals: uniq(['三福化','勝一','新應材']),
  precursor: uniq(['台特化']),
  quartz_parts: uniq(['崇越']),
  semiconductor_other_material: uniq(['崇越','華立','達興材料','新應材']),
  power_module: uniq(['強茂','富鼎','光鼎']),
  optical_engine: uniq(['上詮','光聖','波若威']),
  advanced_packaging_material: uniq(['新應材','三福化','長興','華立']),

  // v2.6.2.28 A — additional direct industry-chain mappings for previously empty fine tags.
  mosfet: uniq(['富鼎']),
  igbt: uniq(['富鼎']),
  fpcb: uniq(['嘉聯益','台郡','臻鼎-KY']),
  server_rack: uniq(['勤誠','晟銘電','營邦']),
  mlcc: uniq(['國巨','華新科','禾伸堂']),
  resistor: uniq(['台達電','國巨*','大同','興勤','大毅','華新科','聚鼎','天二科技','光頡','鑫科','信昌電','艾華','雷科','富致','能率網通','福華']),
  inductor: uniq(['台達電','國巨*','華新科','崇越','鈞寶','耀勝','千如','臺慶科','光頡','鈺鎧','松上','信昌電','百徽','佳邦','迅德','今展科','聯寶','能率網通']),
  capacitor: uniq(['台達電','國巨*','凱美','環科','立隆電','華新科','禾伸堂','日電貿','鈺邦','堡達','華容','信昌電','雷科','佳邦','金山電','蜜望實','能率網通']),
  crystal_oscillator: uniq(['國巨*','敦吉','希華','華新科','禾伸堂','晶技','鈞寶','台嘉碩','鑫科','安碁','佳邦','聯寶','能率網通','加高','泰藝']),
  lcd_panel: uniq(['友達','群創']),
  electronic_distribution_business: uniq(['聯強','華立','增你強','威健','文曄','益登','全科','弘憶股','安馳','大聯大','豐藝','巨路','至上','利機','茂綸','擎亞']),

  // TPEx Industry Value Chain L000: PCB materials / board manufacturing / process equipment.
  glass_fiber_cloth: uniq(['南亞','台玻','富喬','崇越電','建榮','德宏']),
  copper_foil: uniq(['南亞','榮科','崇越電','金居']),
  ccl: uniq([
    '南亞','長興','廣宇','台光電','華立','聯茂','聚鼎','台郡','台虹','騰輝電子-KY',
    '律勝','亞電','光譜','凱崴','台燿','聚和','尚茂'
  ]),
  general_pcb: uniq([
    '華通','楠梓電','廣宇','敬鵬','燿華','金像電','毅嘉','欣興','健鼎','晟鈦','同泰','定穎投控','瀚宇博','競國','柏承','嘉聯益','精成科','定穎','台郡','同欣電','圓裕','南電','志超','泰鼎-KY','臻鼎-KY',
    '好德','富榮綱','宇環','旭軟','新復興','邑昇','美而快','佳總','光譜','高技','霖宏','松上','育富','雷科','慶生','立誠','鉅橡','博智'
  ]),
  pcb_equipment: uniq([
    '恩德','志聖','揚博','華立','德律','晶彩科','牧德','迅得','聯策','惠特','暉盛-創','長廣','昶昕',
    '川寶','光洋科','港建*','由田','敘豐','陽程','科嶠','達航科技','聖暉*','群翊','亞泰金屬','鏵友益','和亞智慧'
  ]),

  // TPEx Industry Value Chain K000: connector design / assembly / manufacturing.
  general_connector: uniq([
    '鴻海','佳世達','正崴','敦吉','建通','良得電','百容','健和興','今皓','鴻名','信邦','譁裕','台端','維熹','嘉澤','宏致','鎰勝','金橋','浪凡','佳必琪','詮欣','驊陞','圓裕','瀚荃','貿聯-KY','康控-KY',
    '好德','優群','建舜電','長盛','矽瑪','華盈','凡甲','映興','艾恩特','湧德','連展投控','慕康生醫','宣德','同協','信音','禾昌','幃翔','中探針','胡連','良維','詠昇','鴻呈','正淩'
  ]),

  // TPEx Industry Value Chain F000: cooling, BIOS, surveillance and broad computer peripherals.
  air_cooling: uniq([
    '台達電','鴻準','技嘉','建準','敦吉','奇鋐','泰碩','尼得科超眾','邁科','聯德控股-KY','動力-KY',
    '協禧','雙鴻','力致','皇龍','鑫聯大投控','雷笛克光學','宣德','業強','元山','安鈦克','華宏','安力-KY'
  ]),
  bios_firmware: uniq(['華碩','鑫聯大投控','系微']),
  security_surveillance: uniq([
    '士電','光寶科','台達電','鴻海','佳世達','大同','圓剛','隴華','百容','普安','歐格','喬鼎','奇偶','晶睿','慧友','鈞泰','大鵬科CLMX',
    '昇銳','杭特','哲固','鑫聯大投控','天鉞電','協益','聰泰','彩富','順發','豪勉','京晨科','勝品','欣普羅'
  ]),
  computer_peripheral_business: uniq([
    '光寶科','鴻海','中環','仁寶','精英','佳世達','宏碁','華碩','倫飛','昆盈','大同','技嘉','微星','友通','輔信','圓剛','新巨','承啟','燦坤','盟立','百容','歐格','威強電','建碁','喬鼎','緯創','誠研','碩天','圓展','神達','致伸','事欣科','虹堡','亞弘電','天瀚','宏正','研揚','宏碁遊戲-創','振樺電','偉聯',
    '艾訊','精確','東碩','微端','英濟','寶德','西柏','其陽','鑫科','鑫聯大投控','宜鼎','系統電','訊達電腦','廣明','艾華','晉泰','安鈦克','邑錡','仁大資訊','福華','大世科','欣厚-KY'
  ]),

  // TPEx Industry Value Chain H000: touch controller IC and touch panel.
  touch_controller_ic: uniq(['義隆','敦吉','原相','禾瑞亞']),
  touch_panel: uniq([
    '銘旺科','敦吉','全台','精金','融程電','群創','洋華','凌巨','TPK-KY',
    '禾瑞亞','富晶通','熒茂','晶達','萬達光電','創為精密'
  ]),

  // TPEx Industry Value Chain D000: IC categories whose names map 1:1 to existing fine tags.
  mcu: uniq([
    '台達電','偉詮電','義隆','聯陽','聯詠','凌通','凌陽創新','松翰','盛群',
    '笙泉','金麗科','陞達科技','通泰','普誠','研通','鈺太','應廣','佑華','雅特力-KY'
  ]),
  pmic: uniq([
    '台達電','偉詮電','聯發科','聯詠','虹冠電','通嘉','瑞鼎','凌通','天鈺','力智','威鋒電子','來頡','矽創','致新','富鼎','矽力*-KY',
    '笙泉','點晶','尼克森','類比科','聚積','力士','杰力','普誠','上亞科技','茂達','沛亨','大中','全宇昕','鈺太','廣閎科','博盛半導體'
  ]),
  memory_controller: uniq(['鑫創','點序','群聯']),
  network_ic: uniq(['瑞昱','聯發科','聯傑','立積','達發','亞信','信驊','茂達','宏觀','天擎','九暘']),
  display_driver_ic: uniq(['聯詠','敦泰','瑞鼎','天鈺','矽創','晶宏','聚積','普誠','力領科技','譜瑞-KY']),

  // v2.6.2.33 — product/process-level expansion from TPEx official Industry Value Chain.
  // Goal: replace native-tech baseline-only labels with concrete roles. Membership is additive:
  // a diversified company may legitimately receive multiple fine tags.
  asic_design_service: uniq(['凌陽','智原','創意','全訊','晶心科','芯鼎','世芯-KY','泰谷','力旺','緯致','億而得','M31','安國','巨有科技','群聯']),
  led_driver_ic: uniq(['台達電','聯陽','天鈺','矽力*-KY','點晶','聚積','普誠','茂達']),
  optical_comm_ic: uniq(['凱鈺','宏觀','元澄半導體']),
  light_source_management_ic: uniq(['矽創','矽力*-KY','昇佳電子']),
  consumer_ic: uniq(['台達電','凌陽','偉詮電','聯發科','義隆','聯陽','聯詠','揚智','鈺寶-創','晶相光','新唐','凌通','凌陽創新','芯鼎','威鋒電子','矽創','笙泉','海德威','點晶','聚積','禾瑞亞','笙科','太欣','通泰','合邦','普誠','驊訊','神盾','九齊','宏觀','安格','久昌','君曜','佑華','安國','傑霖科技']),
  memory_ic: uniq(['旺宏','華邦電','南亞科','晶豪科','愛普*','鈺創']),
  hdd_controller_ic: uniq(['凌陽','英柏得']),
  io_interface_ic: uniq(['凌陽','聯陽','祥碩','迅杰','威鋒電子','精拓科','創惟','旺玖','晶焱','宏觀','鈺太','安格','安國','智微','映智']),
  display_controller_ic: uniq(['聯發科','聯詠','凌通','聚積','普誠']),
  optical_storage_controller_ic: uniq(['凌陽','聯發科']),
  image_sensor_ic: uniq(['凌陽','聯詠','矽創','原相','映智']),

  osat: uniq(['南染','福懋','華泰','旺宏','台亞','菱生','超豐','京元電子','聯鈞','日月光投控','力成','矽格','同欣電','華東','福懋科','南茂','微矽電子-創','欣銓','台星科','典範','精材','利機','單井','逸昌','勤凱科技','立衛','頎邦','雷科','久元','竑騰','捷創科技','博大','駿吉-KY']),
  dram: uniq(['華邦電','南亞科','力積電','漢磊']),
  nor_flash: uniq(['旺宏','華邦電']),
  wafer_manufacturing: uniq(['聯電','台積電','旺宏','台亞','華邦電','大同','南亞科','統懋','全新','嘉晶','台勝科','新唐','全訊','力積電','昇陽半導體','穩懋','漢磊','世界','中美晶','合晶','環球晶','宏捷科','環宇-KY']),
  discrete_semiconductor: uniq(['麗正','台亞','茂矽','統懋','強茂','誠創','光環','德微','漢磊','台半','元隆','IET-KY','環宇-KY']),
  semiconductor_process_test_equipment: uniq(['致茂','志聖','德律','京鼎','晶彩科','辛耘','有成精密','全訊','崇越','宏正','迅得','穎崴','聯策','惠特','采鈺','創控','天虹','聚賢研發-創','暉盛-創','鴻勁','長廣','倍利科','羅昇','好德','公準','泰谷','漢科','由田','台灣精材','敘豐','世禾','家登','台特化','三聯','聖暉*','雷科','日揚','旺矽','精測','瑞耘','朋億*','群翊','信紘科','矽科宏晟','美達科技','華景電','濾能','千附精密','鏵友益','宏碩系統','家碩','華洋精機','意德士科技','明遠精密','光焱科技','竑騰','耀穎','捷創科技','創新服務','漢測','鈦昇','翔名','華宏','千附']),
  semiconductor_chemicals_materials: uniq(['永光','長興','中華化','揚博','華立','昇貿','德淵','國精化','三福化','雙鍵','達興材料','崇越','台蠟','光洋科','鑫科','新應材','晶呈科技','台特化','中美晶']),
  packaging_test_equipment: uniq(['台達電','致茂','志聖','德律','蔚華科','辛耘','上品','宏正','迅得','穎崴','天虹','聚賢研發-創','暉盛-創','頌勝科技','倍利科','長華*','川寶','港建*','弘塑','倚強科','泰谷','漢科','由田','單井','世禾','博磊','台特化','均豪','三聯','聖暉*','豪勉','旺矽','久元','均華','美達科技','濾能','意德士科技','銳澤','光焱科技','印能科技','和亞智慧','創新服務','漢測','鈦昇','東捷','建暐']),
  ic_substrate: uniq(['敦吉','景碩','和碩','同欣電','易華電','長華*','利機','雷科','駿吉-KY']),
  leadframe: uniq(['順德','百容','一詮','健策','界霖','長華*','佳穎','利機','長科*']),
  ic_module: uniq(['福懋','台達電','創見','立萬利','凌航','鈺寶-創','全訊','同欣電','福懋科','宇瞻','威剛','泰谷','尚立','利機','廣穎電通','安國','品安','商丞','群聯','駿吉-KY']),
  ic_distribution: uniq(['台達電','聯強','敦吉','華立','禾伸堂','增你強','威健','文曄','益登','全科','弘憶股','安馳','大聯大','豐藝','巨路','至上','三顧','昱捷','泰谷','尚立','利機','堡達','博士旺','陞達科技','亞矽','茂綸','方土昶','倍微','華豫寧','光菱','志旭','全達','巨虹','擎亞','群聯']),

  display_chemicals_materials: uniq(['永光','長興','勝一','華立','德淵','國精化','三福化','達興材料','光洋科','鑫科','新應材','晶呈科技','台特化']),
  ito_substrate: uniq(['台亞','安可']),
  backlight_source: uniq(['億光','一詮','佰鴻','日電貿','榮創','誠創','宏齊','長華*','亞帝歐','臺龍']),
  display_frame: uniq(['大同','達運','乙盛-KY','台翰','臺龍','勁豐']),
  optical_film: uniq(['揚明光','迎輝','光耀','友輝','長興','台亞','大同','達運','長華*','茂林-KY','崇越電','元創精密','華宏']),
  backlight_module: uniq(['大同','達運','瑞儀','台表科','先益','中光電投控','中光電','臺龍','勁豐','福華']),
  display_module: uniq(['大同','億光','兆赫','憶聲','全台','眾福科','彩晶','達運','豐藝','台表科','華凌','錸寶','凌巨','晶達','智晶','光聯','青雲','新門','久正','晶采','福華']),
  display_process_test_equipment: uniq(['致茂','志聖','晶彩科','辛耘','上品','宏正','迅得','天虹','聚賢研發-創','暉盛-創','羅昇','川寶','由田','敘豐','陽程','世禾','均豪','彩富','聖暉*','廣運','高僑','易發','朋億*','群翊','信紘科','矽科宏晟','鏵友益','華洋精機','銳澤','東捷']),
  led_epitaxy: uniq(['台亞','吉祥全','新世紀','富采','光鋐','同欣電','台表科','華上','泰谷','晶呈科技','立軒']),
  led_package_module: uniq(['中釉','光寶科','大同','億光','吉祥全','禾伸堂','佰鴻','夆典','麗清','新世紀','榮創','艾笛森','富采','弘凱','崇越','華興','宏齊','光鼎','同欣電','台表科','聯嘉','李洲','利機','勤凱科技','雷笛克光學','雷科','立軒','久元','福華','立碁']),
  solar_cell: uniq(['昇貿','聯合再生','太極','元晶','晶呈科技','中美晶','茂迪']),
  solar_module: uniq(['科風','昇貿','聯合再生','太極','有成精密','崇越','元晶','安集','新晶投控','中美晶','茂迪','博大']),

  chipset: uniq(['威盛','豐藝','鑫聯大投控','旺玖']),
  motherboard: uniq(['金寶','鴻海','精英','華碩','技嘉','微星','威盛','映泰','承啟','百容','威強電','華擎','和碩','鑫聯大投控','青雲','捷波','立端']),
  computer_chassis: uniq(['首利','光寶科','鴻海','鴻準','技嘉','可成','神基','晟銘電','全漢','偉訓','柏騰','谷崧','事欣科','和碩','迎廣','華孚','勤誠','濱川','及成','錦明','英濟','旭品','曜越','鑫聯大投控','能率','宣德','富驊','安鈦克','崴寶','森田']),
  battery_module: uniq(['全漢','禾伸堂','順達','加百裕','西勝','鑫聯大投控','新盛力','新普','台達電','致茂','台表科','興能高','聚和','長園科']),
  io_interface_card: uniq(['華碩','微星','互億','東碩','泓格','鑫聯大投控']),
  hard_disk_drive: uniq(['金寶','華碩','光洋科','鑫聯大投控']),
  optical_drive: uniq(['華碩','鑫聯大投控']),
  flash_storage_device: uniq(['華碩','創見','增你強','十銓','互億','宇瞻','威剛','東碩','建舜電','鑫聯大投控','廣穎電通','品安','群聯']),
  video_capture_card: uniq(['圓剛','東碩','鑫聯大投控','聰泰']),
  optical_disc: uniq(['中環','錸德','吉祥全','鈺德','鑫聯大投控']),
  hinge: uniq(['信錦','新日興','鑫禾','富世達','錦明','兆利','鑫聯大投控']),
  precision_mold: uniq(['信錦','鴻海','鴻準','敦吉','百容','揚明光','新至陞','銘鈺','佳凌','詮欣','華孚','台翰','和勤','及成','英濟','佳穎','鑫聯大投控','宣德','同協','欣厚-KY','安力-KY']),
  notebook_pc: uniq(['台達電','鴻海','仁寶','精英','宏碁','英業達','華碩','藍天','倫飛','大同','技嘉','微星','廣達','燦坤','百容','神基','緯創','和碩','茂訊','鑫聯大投控','訊達電腦','順發','海柏特','仁大資訊','大世科']),
  desktop_pc: uniq(['台達電','鴻海','精英','宏碁','華碩','大同','技嘉','微星','輔信','燦坤','緯創','和碩','茂訊','鑫聯大投控','訊達電腦','順發','海柏特','仁大資訊','大世科']),
  thin_client: uniq(['台達電','華碩','倫飛','技嘉','鼎元','燦坤','麗臺','百容','茂訊','鑫聯大投控','順發','海柏特']),
  office_imaging_equipment: uniq(['全友','金寶','鴻海','佳世達','宏碁','大同','虹光','燦坤','百容','亞光','永崴投控','致伸','天瀚','鼎翰','鑫聯大投控','中光電投控','亞泰','科誠','協益','中光電','東友','順發','全譜','海柏特','能率網通']),
  server_system: uniq(['光寶科','鴻海','仁寶','佳世達','宏碁','華碩','大同','技嘉','微星','承啟','燦坤','華擎','神達','緯穎','永擎','大綜','寶德','營邦','鑫聯大投控','訊達電腦','順發','豪勉','晉泰','仁大資訊','大世科']),

  wired_communication_equipment: uniq(['三洋電','東訊','大同','百容','合勤控','神準','台林','訊達電腦','普萊德','宇智','榮群','大世科']),
  filter_oscillator: uniq(['國巨*','敦吉','希華','華新科','禾伸堂','晶技','鈞寶','台嘉碩','鑫科','安碁','佳邦','聯寶','能率網通','加高','泰藝']),
  software_distribution: uniq(['大同','三商電','凌群','華經','零壹','邁達特','精誠','資拓宏宇','中華資安','大綜','力新','三聯','上奇','訊達電腦','順發','晉泰','宏碁資訊','倍力','德鴻','博弘','創泓科技','昕奇雲端','仁大資訊','精誠金融','大世科']),

  network_equipment: uniq([
    '光寶科','台達電','鴻海','仁寶','友訊','智邦','佳世達','華碩','大同','友通','仲琦','百容','兆赫','歐格','星通','盛達','訊舟','建漢','明泰','譁裕','展達','智易','海華','合勤控','正文','和碩','中磊','友勁','百一','互億','居易','宏正','啟碁','瑞祺電通','鋐寶科技','大鵬科CLMX',
    '璟德','神準','其陽','康聯訊','台聯電','新復興','台林','宣德','訊達電腦','振曜','華電網','豪勉','鑫永洋','立端','普萊德','宇智','互動','啟發電','是方','創泓科技','榮群','德勝','凱碩','康全電訊','常珵','大世科','智捷','安瑞-KY'
  ]),
  optical_communication_equipment: uniq([
    '華榮','合機','台達電','東訊','佳世達','環科','百容','兆赫','盛達','圓展','合勤控','宏正','光聖','台通','達運光電','眾達-KY',
    '波若威','光環','上詮','聯光通','台聯電','振曜','華電網','普萊德','宇智','互動','啟發電','榮群','德勝','康全電訊','萊德光電-KY'
  ]),
  wireless_communication_equipment: uniq([
    '光寶科','台達電','金寶','台揚','鴻海','東訊','仁寶','佳世達','華碩','隴華','美律','神腦','百容','兆赫','宏達電','盛達','建漢','譁裕','合勤控','神達','遠傳','和碩','百一','啟碁','詠業','華冠',
    '璟德','鼎天','德晉','昇達科','環天科','西柏','研勤','榮昌','鐿鈦','正能量智能','台林','協益','亞元','振曜','華電網','普萊德','韋僑','威潤','宇智','互動','啟發電','海柏特','德勝'
  ]),
  telecom_service_business: uniq(['中華電','台灣大','遠傳','富爾特','統振','宇智']),
  cable_assembly: uniq([
    '大山','榮星','合機','正崴','敦吉','今皓','信邦','巨路','佳必琪','詮欣','台通','貿聯-KY','崇越電','宣德','萬泰科','岳豐','宇智','鴻呈',
    '廣宇','太空梭','鴻碩','聯穎','鎰勝','瀚荃','好德','樺晟','東碩','松普','萬旭','詠昇'
  ]),
  power_supply: uniq([
    '首利','光寶科','台達電','致茂','技嘉','群光','環科','新巨','聯昌','飛宏','百容','神基','全漢','偉訓','立德','聯德','迎廣','康舒','群電',
    '僑威','幸康','曜越','鑫聯大投控','亞元','海韻電','岳豐','安鈦克','保銳'
  ]),
  industrial_pc: uniq([
    '仁寶','佳世達','倫飛','技嘉','微星','研華','友通','輔信','百容','歐格','神基','威強電','融程電','華擎','精聯','大眾控','事欣科','凌華','飛捷','樺漢','研揚','攸泰科技',
    '艾訊','茂訊','哲固','安勤','泓格','磐儀','鼎翰','營邦','鑫聯大投控','台林','同亨','振曜','欣技','立端','廣錠','維田','鑫創電子','海柏特','宸曜','廣積','伍豐','新漢'
  ]),
  graphics_card: uniq(['華碩','技嘉','微星','圓剛','承啟','麗臺','華擎','鑫聯大投控','青雲','撼訊','捷波']),
  storage_system: uniq(['華碩','普安','喬鼎','昇銳','營邦','鑫聯大投控']),
  optical_lens: uniq([
    '鴻海','佳能','敦吉','百容','大立光','亞光','華晶科','玉晶光','揚明光','佳凌','今國光','中揚光','澤米',
    '先進光','聯一光電','新鉅科','鑫聯大投控','久禾光','保勝光學','伯特光'
  ]),
  memory_module: uniq(['創見','凌航','十銓','宇瞻','威剛','廣穎電通','品安','商丞','群聯']),
  automation_machine: uniq(['倚強科','富晶通','豪勉','高僑','易發','群翊','竹陞科技','榮田','鈦昇']),
  industrial_robot: uniq(['上銀','竹陞科技']),
  software_development: uniq([
    '廣豐','台達電','大同','三商電','凌群','華經','資通','敦陽科','喬鼎','一零四','達明','訊連','邁達特','關貿','精誠','宏正','資拓宏宇','現觀科','中華資安','倍利科',
    '嘉實','訊聯基因','緯致','凱衛','力新','寶碩','蒙恬','智崴','中菲','國眾','三聯','訊達電腦','華電網','晉泰','松崗','神盾','勤崴國際','普鴻','叡揚','宏碁資訊'
  ]),
  system_integration: uniq([
    '佳世達','致茂','大同','三商電','凌群','華經','資通','敦陽科','鴻名','零壹','喬鼎','一零四','達明','邁達特','關貿','精誠','宏正','資拓宏宇','中華資安','倍利科',
    '大綜','嘉實','大塚','訊聯基因','凱衛','力新','坤悅','新鼎','寶碩','凌網','天剛','中菲','國眾','三聯','上奇','訊達電腦','驊宏資','華電網','豪勉','晉泰'
  ]),
  data_processing: uniq([
    '大同','三商電','凌群','華經','邁達特','關貿','精誠','資拓宏宇','現觀科','中華資安',
    '訊聯基因','三聯','台灣銘板','宏碁資訊','倍力','德鴻','意藍','碩網','精誠金融','和亞智慧','達人網','大世科'
  ]),
  ai_solution: uniq([
    '台達電','凌群','資通','敦陽科','普安','零壹','達明','邁達特','群電','資拓宏宇','聯策','伊雲谷','羅昇','佳世達','威盛','宏達電','訊連','現觀科',
    '昇銳','研勤','中光電投控','緯致','新鼎','鈺創','中光電','聰泰','訊達電腦','華電網','東捷資訊','竹陞科技','叡揚','宏碁資訊','偉康科技','騰雲','德鴻','意藍','博弘','碩網','創泓科技','昕奇雲端','和亞智慧','達人網','大世科','普萊德','勤崴國際','虎門科技','長佳智能'
  ])
});

function normalizeCompanyName(value){
  return String(value||'').normalize('NFKC').trim().replace(/\s+/g,'').replace(/[＊*]/g,'').replace(/(?:-KY創|-KY|-DR|-創)$/i,'').replace(/(?:股份有限公司|有限公司|公司)$/,'');
}

const NAME_TAGS = new Map();
for(const [tagId,names] of Object.entries(GROUPS)){
  for(const name of names){
    const key=normalizeCompanyName(name);
    if(!key)continue;
    if(!NAME_TAGS.has(key))NAME_TAGS.set(key,new Set());
    NAME_TAGS.get(key).add(tagId);
  }
}

function tagsForCompanyName(name){
  const set=NAME_TAGS.get(normalizeCompanyName(name));
  return set?[...set]:[];
}

module.exports=Object.freeze({
  version:'2.3.2',
  groups:GROUPS,
  normalizeCompanyName,
  tagsForCompanyName,
  seededCompanyNames:Object.freeze([...NAME_TAGS.keys()])
});
