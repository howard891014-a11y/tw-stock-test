const HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*"};
const MASTER_SOURCES=[
  {url:"https://openapi.twse.com.tw/v1/opendata/t187ap03_L",market:"上市"},
  {url:"https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",market:"上櫃"},
  {url:"https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R",market:"興櫃"}
];
let masterCache=null,masterAt=0;
function toNumber(v){const n=Number(v);return Number.isFinite(n)?n:null}
function pick(row,keys){for(const k of keys){const v=row?.[k];if(v!=null&&String(v).trim())return String(v).trim()}return""}
async function fetchJson(url,ms=4500){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{headers:HEADERS,signal:c.signal});if(!r.ok)return[];const j=await r.json();return Array.isArray(j)?j:[]}catch{return[]}finally{clearTimeout(t)}}
async function securityMaster(){
  if(masterCache&&Date.now()-masterAt<12*3600_000)return masterCache;
  const sets=await Promise.all(MASTER_SOURCES.map(async src=>(await fetchJson(src.url)).map(row=>({
    code:pick(row,["公司代號","證券代號","SecuritiesCompanyCode"]),
    name:pick(row,["公司簡稱","公司名稱","證券名稱","CompanyAbbreviation"]),
    market:src.market
  })).filter(x=>/^\d{4,6}$/.test(x.code)&&x.name)));
  const map=new Map();for(const x of sets.flat())if(!map.has(x.code))map.set(x.code,x);
  masterCache=[...map.values()];masterAt=Date.now();return masterCache;
}
async function resolve(query){
  const q=String(query||"").trim();const master=await securityMaster();
  if(/^\d{4,6}$/.test(q)){const x=master.find(s=>s.code===q);return x||{code:q,name:"",market:""}}
  const exact=master.find(s=>s.name===q),partial=master.find(s=>s.name.includes(q)||q.includes(s.name));
  if(exact||partial)return exact||partial;
  const url=`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`;
  const rows=await fetchJson(url);const quotes=rows.quotes||[];
  const hit=quotes.find(x=>/\.(TW|TWO)$/.test(x.symbol||"")&&(String(x.longname||"").includes(q)||String(x.shortname||"").includes(q)))||quotes.find(x=>/\.(TW|TWO)$/.test(x.symbol||""));
  if(!hit)return null;const code=String(hit.symbol).split(".")[0],known=master.find(s=>s.code===code);
  return known||{code,name:q,market:hit.symbol.endsWith(".TWO")?"上櫃":"上市"};
}
async function fetchYahoo(symbol,official){const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5d&includePrePost=false&events=div%2Csplits`;const response=await fetch(url,{headers:HEADERS});if(!response.ok)return null;const json=await response.json(),result=json?.chart?.result?.[0];if(!result?.meta)return null;const meta=result.meta,timestamps=result.timestamp||[],quote=result.indicators?.quote?.[0]||{},closes=quote.close||[];let last=toNumber(meta.regularMarketPrice),lastTime=toNumber(meta.regularMarketTime);if(last===null){for(let i=closes.length-1;i>=0;i--){const close=toNumber(closes[i]);if(close!==null){last=close;lastTime=timestamps[i]||lastTime;break}}}if(last===null)return null;const previousClose=toNumber(meta.chartPreviousClose??meta.previousClose),change=previousClose!==null?last-previousClose:null,changePct=previousClose&&change!==null?(change/previousClose)*100:null,code=symbol.split(".")[0];return{source:"Yahoo Finance",symbol,code,name:official?.name||meta.longName||meta.shortName||code,market:official?.market||(symbol.endsWith(".TWO")?"上櫃":"上市"),last,previousClose,change,changePct,high:toNumber(meta.regularMarketDayHigh),low:toNumber(meta.regularMarketDayLow),open:toNumber(meta.regularMarketOpen),quoteTime:lastTime?new Date(lastTime*1000).toISOString():new Date().toISOString()}}
module.exports=async function handler(req,res){res.setHeader("Cache-Control","no-store");res.setHeader("Access-Control-Allow-Origin","*");const query=String(req.query.q||req.query.code||"").trim();if(!query)return res.status(400).json({ok:false,error:"請輸入股票名稱或代碼"});try{const security=await resolve(query);if(!security?.code)return res.status(404).json({ok:false,error:"查無此股票名稱或代碼"});let result=await fetchYahoo(`${security.code}.TW`,security);if(!result)result=await fetchYahoo(`${security.code}.TWO`,security);if(!result)return res.status(404).json({ok:false,error:"Yahoo 查無此股票"});return res.status(200).json({ok:true,...result,fetchedAt:new Date().toISOString()})}catch(error){return res.status(502).json({ok:false,error:"Yahoo 行情暫時無法取得",detail:error.message})}}
