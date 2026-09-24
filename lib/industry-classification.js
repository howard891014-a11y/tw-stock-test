// StockZone v2.6.2.32
// Official TWSE/TPEx industry-code normalization + broad market tags.
// The company profile OpenAPI exposes SecuritiesIndustryCode (e.g. 24 = semiconductor).
// Technology codes always resolve to a technology business label; non-tech codes may use coarse votable sectors.

const INDUSTRIES = Object.freeze({
  '01': { name:'水泥工業', broadTag:'cement' },
  '02': { name:'食品工業', broadTag:'food' },
  '03': { name:'塑膠工業', broadTag:'plastics' },
  '04': { name:'紡織纖維', broadTag:'textile' },
  '05': { name:'電機機械', broadTag:'machinery' },
  '06': { name:'電器電纜', broadTag:'electrical_cable' },
  '08': { name:'玻璃陶瓷', broadTag:'glass_ceramics' },
  '09': { name:'造紙工業', broadTag:'paper' },
  '10': { name:'鋼鐵工業', broadTag:'steel' },
  '11': { name:'橡膠工業', broadTag:'rubber' },
  '12': { name:'汽車工業', broadTag:'auto' },
  '14': { name:'建材營造', broadTag:'construction' },
  '15': { name:'航運業', broadTag:'shipping' },
  '16': { name:'觀光餐旅', broadTag:'tourism' },
  '17': { name:'金融業', broadTag:'finance' },
  '18': { name:'貿易百貨', broadTag:'retail' },
  '19': { name:'綜合', broadTag:'conglomerate' },
  '20': { name:'其他', broadTag:'other_industry' },
  '21': { name:'化學工業', broadTag:'chemical' },
  '22': { name:'生技醫療業', broadTag:'biotech' },
  '23': { name:'油電燃氣業', broadTag:'oil_gas_utility' },
  '24': { name:'半導體業', technology:true, fallbackTag:'semiconductor_products_services' },
  '25': { name:'電腦及週邊設備業', technology:true, fallbackTag:'computer_peripheral_business' },
  '26': { name:'光電業', technology:true, fallbackTag:'optoelectronic_components_modules' },
  '27': { name:'通信網路業', technology:true, fallbackTag:'network_equipment' },
  '28': { name:'電子零組件業', technology:true, fallbackTag:'electronic_components_manufacturing' },
  '29': { name:'電子通路業', technology:true, fallbackTag:'electronic_distribution_business' },
  '30': { name:'資訊服務業', technology:true, fallbackTag:'information_software_services' },
  '31': { name:'其他電子業', technology:true, fallbackTag:'electronics_manufacturing_services' },
  '32': { name:'文化創意業', broadTag:'cultural_creative' },
  '33': { name:'農業科技業', broadTag:'agri_tech' },
  '35': { name:'綠能環保', broadTag:'green_energy' },
  '36': { name:'數位雲端', technology:true, fallbackTag:'digital_cloud_services' },
  '37': { name:'運動休閒', broadTag:'sports_leisure' },
  '38': { name:'居家生活', broadTag:'home_living' },
  '80': { name:'管理股票', special:true },
});

const NAME_ALIASES = Object.freeze([
  [/水泥/, '01'], [/食品/, '02'], [/塑膠|塑化/, '03'], [/紡織/, '04'], [/電機機械|機械/, '05'],
  [/電器電纜|電纜/, '06'], [/玻璃陶瓷/, '08'], [/造紙/, '09'], [/鋼鐵/, '10'], [/橡膠/, '11'], [/汽車/, '12'],
  [/建材營造|營建/, '14'], [/航運/, '15'], [/觀光|餐旅/, '16'], [/金融/, '17'], [/貿易百貨/, '18'], [/綜合/, '19'],
  [/化學/, '21'], [/生技醫療|生技/, '22'], [/油電燃氣/, '23'], [/半導體/, '24'], [/電腦.*週邊|電腦及週邊/, '25'],
  [/光電/, '26'], [/通信網路|通訊網路/, '27'], [/電子零組件/, '28'], [/電子通路/, '29'], [/資訊服務/, '30'],
  [/其他電子/, '31'], [/文化創意/, '32'], [/農業科技/, '33'], [/綠能環保|綠能/, '35'], [/數位雲端|數位科技/, '36'],
  [/運動休閒/, '37'], [/居家生活/, '38'], [/管理股票/, '80'], [/其他/, '20'],
]);

function normalizeIndustryCode(value){
  const raw=String(value??'').normalize('NFKC').trim();
  if(!raw)return '';
  const m=raw.match(/\d{1,2}/);
  return m?m[0].padStart(2,'0'):'';
}
function normalizeIndustryName(value){
  return String(value??'').normalize('NFKC').replace(/\s+/g,'').trim();
}
function industryByCode(value){
  return INDUSTRIES[normalizeIndustryCode(value)]||null;
}
function codeFromIndustryName(value){
  const text=normalizeIndustryName(value);
  if(!text)return '';
  const hit=NAME_ALIASES.find(([re])=>re.test(text));
  return hit?hit[1]:'';
}
function resolveIndustry({code='',name=''}={}){
  const normalizedCode=normalizeIndustryCode(code)||codeFromIndustryName(name);
  const item=industryByCode(normalizedCode);
  return Object.freeze({
    code:normalizedCode,
    name:item?.name||normalizeIndustryName(name)||'',
    technology:Boolean(item?.technology),
    fallbackTag:item?.fallbackTag||null,
    broadTag:item?.broadTag||null,
    special:Boolean(item?.special),
    known:Boolean(item),
  });
}
function isNativeTechnologyIndustry(input){
  return Boolean(resolveIndustry(typeof input==='object'?input:{code:input}).technology);
}
function allIndustryCodes(){return Object.keys(INDUSTRIES)}

module.exports=Object.freeze({
  version:'1.0.0',
  industries:INDUSTRIES,
  normalizeIndustryCode,
  normalizeIndustryName,
  industryByCode,
  codeFromIndustryName,
  resolveIndustry,
  isNativeTechnologyIndustry,
  allIndustryCodes,
});
