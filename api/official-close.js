const HEADERS={
  "User-Agent":"Mozilla/5.0",
  "Accept":"application/json,text/plain,*/*",
  "Referer":"https://mis.twse.com.tw/stock/index.jsp"
};

function toNumber(v){
  if(v===null||v===undefined)return null;
  const s=String(v).replace(/,/g,"").trim();
  if(!s||s==="-"||s==="--")return null;
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}
function tradeDate(v){
  const s=String(v||"").replace(/\D/g,"");
  if(s.length>=8)return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return "";
}
function quoteTime(row){
  const t=toNumber(row?.tlong);
  if(t!==null&&t>1e12)return new Date(t).toISOString();
  const d=String(row?.d||"").replace(/\D/g,"");
  const tm=String(row?.t||"").trim();
  if(d.length>=8&&/^\d{1,2}:\d{2}:\d{2}$/.test(tm)){
    const [hh,mm,ss]=tm.split(":").map(Number);
    const utc=Date.UTC(Number(d.slice(0,4)),Number(d.slice(4,6))-1,Number(d.slice(6,8)),hh-8,mm,ss);
    return new Date(utc).toISOString();
  }
  return new Date().toISOString();
}
async function fetchChannel(code,channel){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const exCh=`${channel}_${code}.tw`;
    const url=`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    const r=await fetch(url,{headers:HEADERS,signal:controller.signal});
    if(!r.ok)throw new Error(`MIS HTTP ${r.status}`);
    const j=await r.json();
    const row=(Array.isArray(j?.msgArray)?j.msgArray:[]).find(x=>String(x?.c||"").trim()===code)||j?.msgArray?.[0];
    const last=toNumber(row?.z);
    if(!row||last===null)return null;
    const previousClose=toNumber(row?.y);
    const change=previousClose!==null?last-previousClose:null;
    return{
      source:"官方 MIS",
      code,
      name:String(row?.nf||row?.n||"").trim(),
      market:channel==="otc"?"上櫃":"上市",
      symbol:`${code}.${channel==="otc"?"TWO":"TW"}`,
      last,
      previousClose,
      change,
      changePct:previousClose&&change!==null?(change/previousClose)*100:null,
      open:toNumber(row?.o),
      high:toNumber(row?.h),
      low:toNumber(row?.l),
      quoteTime:quoteTime(row),
      tradeDate:tradeDate(row?.d),
      officialClose:true
    };
  }finally{clearTimeout(timer)}
}

module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("Access-Control-Allow-Origin","*");
  const raw=String(req.query.q||req.query.code||"").trim().toUpperCase();
  const code=raw.replace(/\.(?:TW|TWO)$/i,"");
  if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:"股票代碼格式錯誤"});
  const market=String(req.query.market||"");
  const channels=/上櫃|OTC/i.test(market)?["otc"]:/上市|TSE/i.test(market)?["tse"]:["tse","otc"];
  let lastError=null;
  for(const channel of channels){
    try{
      const result=await fetchChannel(code,channel);
      if(result)return res.status(200).json({ok:true,result,fetchedAt:new Date().toISOString()});
    }catch(e){lastError=e}
  }
  return res.status(404).json({ok:false,error:"MIS 暫無可用收盤價",detail:lastError?.message||"no valid last price"});
};
