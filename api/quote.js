const HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*"};
const FALLBACK_NAMES={"2330":"台積電","2454":"聯發科","3017":"奇鋐","6187":"萬潤","7769":"鴻勁","2467":"志聖","4919":"新唐","8064":"東捷"};
const FALLBACK_CODES=Object.fromEntries(Object.entries(FALLBACK_NAMES).map(([code,name])=>[name,code]));
let stockCache=null,stockCacheAt=0;
function toNumber(v){const n=Number(v);return Number.isFinite(n)?n:null}
function cleanName(v){return String(v||"").trim().replace(/\s+/g," ")}
function shortName(v){
  return cleanName(v)
    .replace(/股份有限公司$/g,"")
    .replace(/有限公司$/g,"")
    .replace(/科技$/g,"")
    .trim();
}
async function fetchJson(url){const r=await fetch(url,{headers:HEADERS});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}
async function officialStocks(){
  if(stockCache&&Date.now()-stockCacheAt<6*60*60*1000)return stockCache;
  const rows=[];
  const sources=[
    ["https://openapi.twse.com.tw/v1/opendata/t187ap03_L","上市"],
    ["https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O","上櫃"]
  ];
  await Promise.all(sources.map(async([url,market])=>{
    try{
      const data=await fetchJson(url);
      for(const x of Array.isArray(data)?data:[]){
        const code=String(x["公司代號"]||x.SecuritiesCompanyCode||x.Code||"").trim();
        const name=shortName(x["公司簡稱"]||x.CompanyName||x.Name||"");
        if(/^\d{4,6}$/.test(code)&&name)rows.push({code,name,market});
      }
    }catch{}
  }));
  for(const[code,name]of Object.entries(FALLBACK_NAMES))if(!rows.some(x=>x.code===code))rows.push({code,name,market:""});
  stockCache=rows;stockCacheAt=Date.now();return rows;
}
async function resolveStock(query){
  const q=cleanName(query),stocks=await officialStocks();
  if(/^\d{4,6}$/.test(q))return stocks.find(x=>x.code===q)||{code:q,name:FALLBACK_NAMES[q]||"",market:""};
  const exact=stocks.find(x=>x.name===q)||stocks.find(x=>x.name.replace(/[-－]/g,"")===q.replace(/[-－]/g,""));
  if(exact)return exact;
  const partial=stocks.filter(x=>x.name.includes(q));
  if(partial.length===1)return partial[0];
  if(FALLBACK_CODES[q])return{code:FALLBACK_CODES[q],name:q,market:""};
  return null;
}
async function fetchOfficialPrevious(stock){
  try{
    const prefix=stock?.market==="上櫃"?"otc":"tse";
    const channel=`${prefix}_${stock.code}.tw`;
    const url=`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channel)}&json=1&delay=0`;
    const data=await fetchJson(url),row=data?.msgArray?.[0];
    const previous=toNumber(String(row?.y||"").replace(/,/g,""));
    return previous&&previous>0?previous:null;
  }catch{return null}
}
async function fetchYahoo(symbol,official){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5d&includePrePost=false&events=div%2Csplits`;
  const response=await fetch(url,{headers:HEADERS});if(!response.ok)return null;
  const json=await response.json(),result=json?.chart?.result?.[0];if(!result?.meta)return null;
  const meta=result.meta,timestamps=result.timestamp||[],quote=result.indicators?.quote?.[0]||{},closes=quote.close||[];
  let last=toNumber(meta.regularMarketPrice),lastTime=toNumber(meta.regularMarketTime);
  if(last===null){for(let i=closes.length-1;i>=0;i--){const close=toNumber(closes[i]);if(close!==null){last=close;lastTime=timestamps[i]||lastTime;break}}}
  if(last===null)return null;
  const code=symbol.split(".")[0];
  const officialPrevious=await fetchOfficialPrevious(official||{code,market:symbol.endsWith(".TWO")?"上櫃":"上市"});
  const previousClose=officialPrevious??toNumber(meta.regularMarketPreviousClose??meta.chartPreviousClose??meta.previousClose);
  const change=previousClose!==null?last-previousClose:null,changePct=previousClose&&change!==null?(change/previousClose)*100:null;
  return{source:"Yahoo Finance",symbol,code,name:shortName(official?.name||FALLBACK_NAMES[code]||meta.shortName||meta.longName||code),market:official?.market||(symbol.endsWith(".TWO")?"上櫃":"上市"),last,previousClose,change,changePct,high:toNumber(meta.regularMarketDayHigh),low:toNumber(meta.regularMarketDayLow),open:toNumber(meta.regularMarketOpen),quoteTime:lastTime?new Date(lastTime*1000).toISOString():new Date().toISOString()};
}
module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","no-store");res.setHeader("Access-Control-Allow-Origin","*");
  const query=String(req.query.q||req.query.code||"").trim();if(!query)return res.status(400).json({ok:false,error:"請輸入股票名稱或代碼"});
  try{
    const stock=await resolveStock(query);if(!stock)return res.status(404).json({ok:false,error:"查無此股票名稱或代碼"});
    let result=null;
    if(stock.market==="上櫃")result=await fetchYahoo(`${stock.code}.TWO`,stock);
    else if(stock.market==="上市")result=await fetchYahoo(`${stock.code}.TW`,stock);
    else{result=await fetchYahoo(`${stock.code}.TW`,stock);if(!result)result=await fetchYahoo(`${stock.code}.TWO`,stock)}
    if(!result)return res.status(404).json({ok:false,error:"Yahoo 查無此股票"});
    return res.status(200).json({ok:true,...result,fetchedAt:new Date().toISOString()});
  }catch(error){return res.status(502).json({ok:false,error:"股票名稱或行情暫時無法取得",detail:error.message})}
};
