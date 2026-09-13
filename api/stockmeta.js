const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function clean(v=''){
  return String(v??'').replace(/\u3000/g,' ').replace(/\s+/g,' ').trim();
}
function pick(obj,keys){
  for(const k of keys){
    if(obj && obj[k]!==undefined && obj[k]!==null && clean(obj[k])!=='') return clean(obj[k]);
  }
  return '';
}
async function jfetch(url,timeoutMs=4500){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*','accept-language':'zh-TW,zh;q=0.9'},redirect:'follow',signal:c.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer)}
}
function normalizeRows(rows,market){
  if(!Array.isArray(rows))return [];
  const out=[];
  for(const x of rows){
    const code=pick(x,['Code','code','SecuritiesCompanyCode','SecuritiesCode','公司代號','股票代號','證券代號']);
    const name=pick(x,['Name','name','CompanyName','SecuritiesCompanyName','公司簡稱','股票名稱','證券名稱','公司名稱']);
    if(!/^\d{4,6}$/.test(code)||!name)continue;
    out.push({code,name,market});
  }
  return out;
}
async function listedRows(){
  const urls=[
    'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
  ];
  for(const url of urls){
    try{const rows=normalizeRows(await jfetch(url),'上市');if(rows.length)return rows}catch{}
  }
  return [];
}
async function otcRows(){
  const urls=[
    'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
    'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
    'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'
  ];
  for(const url of urls){
    try{const rows=normalizeRows(await jfetch(url),'上櫃');if(rows.length)return rows}catch{}
  }
  return [];
}
function rank(row,q){
  const code=row.code,name=clean(row.name),needle=clean(q);
  if(code===needle)return 1000;
  if(name===needle)return 950;
  if(name.replace(/[-－]/g,'')===needle.replace(/[-－]/g,''))return 940;
  if(name.startsWith(needle))return 800-Math.min(100,name.length-needle.length);
  if(name.includes(needle))return 700-Math.min(100,name.length-needle.length);
  return -1;
}

module.exports=async function handler(req,res){
  const q=clean(req.query?.q||'');
  if(!q)return res.status(400).json({ok:false,error:'缺少股票名稱或代碼'});
  try{
    const [listed,otc]=await Promise.all([listedRows(),otcRows()]);
    const all=[...listed,...otc];
    const hits=all.map(x=>({...x,_score:rank(x,q)})).filter(x=>x._score>=0).sort((a,b)=>b._score-a._score||a.code.localeCompare(b.code));
    if(!hits.length)return res.status(404).json({ok:false,error:'找不到對應的台股名稱或代碼'});
    const best=hits[0];
    res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ok:true,code:best.code,name:best.name,market:best.market,symbol:`${best.code}${best.market==='上櫃'?'.TWO':'.TW'}`,matches:hits.slice(0,8).map(({_score,...x})=>x)});
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||'股票基本資料查詢失敗'});
  }
};
