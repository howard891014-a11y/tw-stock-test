const stockmetaHandler=require("../lib/stockmeta-service");
const {getSql}=require("../lib/db");
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
    .trim();
}
function marketLabel(v){const s=String(v||"");return /上櫃|OTC|TPEX|TWO/i.test(s)?"上櫃":/上市|TWSE|TSE/i.test(s)?"上市":""}
function symbolFor(code,market){return `${code}${market==="上櫃"?".TWO":".TW"}`}
function taipeiParts(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return{date:`${p.year}-${p.month}-${p.day}`,weekday:p.weekday||"",minutes:Number(p.hour||0)*60+Number(p.minute||0)};
}
function taipeiDateFromEpoch(sec){
  const n=Number(sec);if(!Number.isFinite(n))return "";
  try{return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(n*1000))}catch{return ""}
}
const LIVE_QUOTE_STALE_MS=60*1000;
const OPEN_DUAL_SOURCE_UNTIL_MINUTES=9*60+10;
function quoteEpochMs(q){
  const t=Date.parse(String(q?.quoteTime||""));
  return Number.isFinite(t)?t:null;
}
function isFreshLiveQuote(q,now=new Date()){
  const c=taipeiParts(now),tradeDate=String(q?.tradeDate||taipeiDateFromEpoch((quoteEpochMs(q)||0)/1000));
  if(!q||tradeDate!==c.date)return false;
  const t=quoteEpochMs(q);if(t===null)return false;
  const age=now.getTime()-t;
  return age>=-60*1000&&age<=LIVE_QUOTE_STALE_MS;
}
function newerLiveQuote(a,b){
  if(!a)return b||null;if(!b)return a;
  const ta=quoteEpochMs(a)??-Infinity,tb=quoteEpochMs(b)??-Infinity;
  return tb>ta?b:a;
}
function derivePreviousCloseFromBars(timestamps,closes,tradeDate){
  if(!tradeDate||!Array.isArray(timestamps)||!Array.isArray(closes))return null;
  let bestTs=-Infinity,best=null;
  for(let i=0;i<Math.min(timestamps.length,closes.length);i++){
    const ts=toNumber(timestamps[i]),close=toNumber(closes[i]);
    if(ts===null||close===null||close<=0)continue;
    const d=taipeiDateFromEpoch(ts);
    if(d&&d<tradeDate&&ts>bestTs){bestTs=ts;best=close}
  }
  return best;
}
function rebaseQuotePreviousClose(q,previousClose){
  if(!q)return q;
  const pc=toNumber(previousClose),last=toNumber(q.last);
  if(pc===null||pc<=0||last===null||last<=0)return q;
  const change=last-pc;
  return{...q,previousClose:pc,change,changePct:(change/pc)*100};
}
function quoteCacheControl(mode){
  if(mode==="live")return "no-store";
  const c=taipeiParts();
  if(["Sat","Sun"].includes(c.weekday))return "public, s-maxage=21600, stale-while-revalidate=43200";
  if(c.minutes>=13*60+35)return "public, s-maxage=21600, stale-while-revalidate=43200";
  if(c.minutes<9*60)return "public, s-maxage=300, stale-while-revalidate=1800";
  return "no-store";
}
function liveStockHint(query,marketHint=""){
  const code=cleanName(query).replace(/\.(?:TW|TWO)$/i,"");
  if(!/^\d{4,6}$/.test(code))return null;
  // v2.6.5.23: intraday polling already knows the stock code (and usually the
  // market).  Do not hit Neon just to resolve the same identity every 30s.
  // If market is unknown, MIS can safely probe both tse/otc channels.
  return{code,name:FALLBACK_NAMES[code]||"",market:marketLabel(marketHint)};
}
async function fetchJson(url,timeoutMs=4500){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{headers:HEADERS,signal:c.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}finally{clearTimeout(timer)}}
const MIS_HEADERS={...HEADERS,"Referer":"https://mis.twse.com.tw/stock/index.jsp"};
function misNumber(v){
  if(v===null||v===undefined)return null;
  const s=String(v).replace(/,/g,"").trim();
  if(!s||s==="-"||s==="--")return null;
  const n=Number(s);return Number.isFinite(n)?n:null;
}
function misTradeDate(v){
  const s=String(v||"").replace(/\D/g,"");
  return s.length>=8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:"";
}
function misQuoteTime(row){
  const t=misNumber(row?.tlong);
  if(t!==null&&t>1e12)return new Date(t).toISOString();
  const d=String(row?.d||"").replace(/\D/g,""),tm=String(row?.t||"").trim();
  if(d.length>=8&&/^\d{1,2}:\d{2}:\d{2}$/.test(tm)){
    const [hh,mm,ss]=tm.split(":").map(Number);
    return new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(4,6))-1,Number(d.slice(6,8)),hh-8,mm,ss)).toISOString();
  }
  return new Date().toISOString();
}
async function fetchMisChannel(stock,channel){
  const code=String(stock?.code||"").trim();
  if(!/^\d{4,6}$/.test(code))return null;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const exCh=`${channel}_${code}.tw`;
    const url=`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    const r=await fetch(url,{headers:MIS_HEADERS,signal:controller.signal});
    if(!r.ok)throw new Error(`MIS HTTP ${r.status}`);
    const j=await r.json();
    const row=(Array.isArray(j?.msgArray)?j.msgArray:[]).find(x=>String(x?.c||"").trim()===code)||j?.msgArray?.[0];
    const last=misNumber(row?.z);
    if(!row||last===null||last<=0)return null;
    const previousClose=misNumber(row?.y),change=previousClose!==null?last-previousClose:null;
    const market=channel==="otc"?"上櫃":"上市";
    return{
      source:"TWSE/TPEx MIS 即時",realtime:true,officialClose:false,
      symbol:symbolFor(code,market),code,
      name:shortName(row?.nf||row?.n||stock?.name||FALLBACK_NAMES[code]||code),market,
      last,previousClose,change,changePct:previousClose&&change!==null?(change/previousClose)*100:null,
      open:misNumber(row?.o),high:misNumber(row?.h),low:misNumber(row?.l),
      quoteTime:misQuoteTime(row),tradeDate:misTradeDate(row?.d)
    };
  }finally{clearTimeout(timer)}
}
async function fetchMisQuote(stock){
  const market=marketLabel(stock?.market);
  const channels=market==="上櫃"?["otc"]:market==="上市"?["tse"]:["tse","otc"];
  for(const channel of channels){
    try{const result=await fetchMisChannel(stock,channel);if(result)return result}catch(e){console.warn("[quote] MIS fallback",stock?.code,channel,e?.message||e)}
  }
  return null;
}

async function dbResolveStock(query,marketHint=""){
  const q=cleanName(query),hint=marketLabel(marketHint);
  if(!q)return null;
  try{
    const sql=getSql();
    const codeLike=/^\d{4,6}$/.test(q);
    const compact=q.replace(/[-－]/g,"");
    const exact=await sql.query(`
      SELECT stock_code,stock_name,market
      FROM market_company_profile
      WHERE ($1='' OR market=$1)
        AND (
          stock_code=$2 OR stock_name=$2 OR
          REPLACE(REPLACE(stock_name,'-',''),'－','')=$3
        )
      ORDER BY CASE WHEN stock_code=$2 THEN 0 WHEN stock_name=$2 THEN 1 ELSE 2 END, market, stock_code
      LIMIT 8
    `,[hint,q,compact]);
    if(exact.length){
      const x=exact[0];return{code:String(x.stock_code),name:shortName(x.stock_name),market:String(x.market||hint)};
    }
    if(!codeLike&&q.length>=2){
      const partial=await sql.query(`
        SELECT stock_code,stock_name,market
        FROM market_company_profile
        WHERE ($1='' OR market=$1) AND stock_name ILIKE '%' || $2 || '%'
        ORDER BY LENGTH(stock_name),stock_code
        LIMIT 3
      `,[hint,q]);
      if(partial.length===1){const x=partial[0];return{code:String(x.stock_code),name:shortName(x.stock_name),market:String(x.market||hint)}}
    }
  }catch(e){console.warn("[quote] DB stock resolve fallback",e?.message||e)}
  return null;
}

async function dbCloseQuote(query,marketHint=""){
  const q=cleanName(query),hint=marketLabel(marketHint),compact=q.replace(/[-－]/g,"");
  if(!q)return null;
  try{
    const sql=getSql();
    let rows=await sql.query(`
      SELECT p.stock_code,p.stock_name AS profile_name,p.market,
             s.trade_date,s.close_price,s.previous_close,s.open_price,s.high_price,s.low_price,
             s.quote_time,s.source,s.updated_at,s.stock_name
      FROM market_company_profile p
      JOIN price_snapshot s ON s.stock_code=p.stock_code AND s.market=p.market
      WHERE ($1='' OR p.market=$1)
        AND (p.stock_code=$2 OR p.stock_name=$2 OR REPLACE(REPLACE(p.stock_name,'-',''),'－','')=$3)
      ORDER BY CASE WHEN p.stock_code=$2 THEN 0 WHEN p.stock_name=$2 THEN 1 ELSE 2 END, p.market, p.stock_code
      LIMIT 3
    `,[hint,q,compact]);
    if(!rows.length&&!/^\d{4,6}$/.test(q)&&q.length>=2){
      rows=await sql.query(`
        SELECT p.stock_code,p.stock_name AS profile_name,p.market,
               s.trade_date,s.close_price,s.previous_close,s.open_price,s.high_price,s.low_price,
               s.quote_time,s.source,s.updated_at,s.stock_name
        FROM market_company_profile p
        JOIN price_snapshot s ON s.stock_code=p.stock_code AND s.market=p.market
        WHERE ($1='' OR p.market=$1) AND p.stock_name ILIKE '%' || $2 || '%'
        ORDER BY LENGTH(p.stock_name),p.stock_code
        LIMIT 2
      `,[hint,q]);
      if(rows.length!==1)return null;
    }
    const x=rows[0];if(!x)return null;
    const last=toNumber(x.close_price),previousClose=toNumber(x.previous_close);if(last===null||last<=0)return null;
    const change=previousClose!==null?last-previousClose:null,changePct=previousClose&&change!==null?(change/previousClose)*100:null;
    const market=String(x.market||hint||"");
    return{
      source:"Neon price_snapshot",officialClose:true,
      symbol:symbolFor(String(x.stock_code),market),code:String(x.stock_code),
      name:shortName(x.stock_name||x.profile_name||FALLBACK_NAMES[x.stock_code]||x.stock_code),market,
      last,previousClose,change,changePct,
      open:toNumber(x.open_price),high:toNumber(x.high_price),low:toNumber(x.low_price),
      quoteTime:x.quote_time||x.updated_at||null,tradeDate:x.trade_date?String(x.trade_date).slice(0,10):null
    };
  }catch(e){console.warn("[quote] DB close fallback",e?.message||e);return null}
}

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
async function resolveStock(query,marketHint=""){
  const q=cleanName(query),hint=marketLabel(marketHint);
  const db=await dbResolveStock(q,hint);if(db)return db;
  // DB is the steady-state resolver.  The official whole-market list is only a fallback
  // when the local company master is unavailable or a newly listed stock is not synced yet.
  if(/^\d{4,6}$/.test(q))return{code:q,name:FALLBACK_NAMES[q]||"",market:hint};
  const stocks=await officialStocks();
  const exact=stocks.find(x=>x.name===q)||stocks.find(x=>x.name.replace(/[-－]/g,"")===q.replace(/[-－]/g,""));
  if(exact)return exact;
  const partial=stocks.filter(x=>x.name.includes(q));
  if(partial.length===1)return partial[0];
  if(FALLBACK_CODES[q])return{code:FALLBACK_CODES[q],name:q,market:""};
  return null;
}
async function fetchYahoo(symbol,official){
  const code=symbol.split(".")[0];
  // v2.6.5.60: use a moving period window instead of a static range=5d URL.
  // The dynamic period2 also gives Yahoo/CDN a changing cache key during live trading.
  const nowSec=Math.floor(Date.now()/1000),period1=nowSec-6*24*60*60,period2=nowSec+120;
  const query=`interval=1m&period1=${period1}&period2=${period2}&includePrePost=false&events=div%2Csplits`;
  const urls=[
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`
  ];
  let lastError=null;
  for(const url of urls){
    try{
      const response=await fetch(url,{headers:HEADERS});if(!response.ok){lastError=new Error(`Yahoo HTTP ${response.status}`);continue}
      const json=await response.json(),result=json?.chart?.result?.[0];if(!result?.meta){lastError=new Error("Yahoo chart result missing");continue}
      const meta=result.meta,timestamps=result.timestamp||[],quote=result.indicators?.quote?.[0]||{},closes=quote.close||[];
      let last=toNumber(meta.regularMarketPrice),lastTime=toNumber(meta.regularMarketTime),barLast=null,barTime=null;
      for(let i=closes.length-1;i>=0;i--){const close=toNumber(closes[i]),ts=toNumber(timestamps[i]);if(close!==null&&close>0&&ts!==null){barLast=close;barTime=ts;break}}
      if(barLast!==null&&(last===null||lastTime===null||barTime>=lastTime)){last=barLast;lastTime=barTime}
      if(last===null||last<=0){lastError=new Error("Yahoo price missing or invalid");continue}
      const tradeDate=taipeiDateFromEpoch(lastTime);
      // v2.6.5.61: Yahoo meta.previousClose can briefly point at an intraday/opening reference
      // during the first minutes. Derive the prior session close from the actual 1-minute bars first.
      const barPreviousClose=derivePreviousCloseFromBars(timestamps,closes,tradeDate);
      const previousClose=barPreviousClose??toNumber(meta.regularMarketPreviousClose??meta.chartPreviousClose??meta.previousClose);
      const change=previousClose!==null?last-previousClose:null,changePct=previousClose&&change!==null?(change/previousClose)*100:null;
      return{source:"Yahoo Finance",realtime:true,officialClose:false,symbol,code,name:shortName(FALLBACK_NAMES[code]||official?.name||meta.shortName||meta.longName||code),market:official?.market||(symbol.endsWith(".TWO")?"上櫃":"上市"),last,previousClose,change,changePct,high:toNumber(meta.regularMarketDayHigh),low:toNumber(meta.regularMarketDayLow),open:toNumber(meta.regularMarketOpen),quoteTime:lastTime?new Date(lastTime*1000).toISOString():new Date().toISOString(),tradeDate};
    }catch(e){lastError=e}
  }
  if(lastError)throw lastError;
  return null;
}

async function handler(req,res){
  const mode=String(req.query?.mode||"").trim().toLowerCase();
  if(mode==="meta")return stockmetaHandler(req,res);
  res.setHeader("Cache-Control",quoteCacheControl(mode));res.setHeader("Access-Control-Allow-Origin","*");
  const query=String(req.query.q||req.query.code||"").trim();if(!query)return res.status(400).json({ok:false,error:"請輸入股票名稱或代碼"});
  const marketHint=String(req.query.market||"").trim();
  try{
    if(mode==="db-close"){
      const result=await dbCloseQuote(query,marketHint);
      if(!result)return res.status(404).json({ok:false,error:"本機收盤資料暫無此股票"});
      return res.status(200).json({ok:true,...result,fetchedAt:new Date().toISOString()});
    }
    const numericHint=liveStockHint(query,marketHint);
    const stock=numericHint||await resolveStock(query,marketHint);
    if(!stock)return res.status(404).json({ok:false,error:"查無此股票名稱或代碼"});
    let result=null;
    const yahooFor=async()=>{
      if(stock.market==="上櫃")return fetchYahoo(`${stock.code}.TWO`,stock);
      if(stock.market==="上市")return fetchYahoo(`${stock.code}.TW`,stock);
      const [tw,two]=await Promise.all([fetchYahoo(`${stock.code}.TW`,{...stock,market:"上市"}),fetchYahoo(`${stock.code}.TWO`,{...stock,market:"上櫃"})]);
      return tw||two;
    };
    // v2.6.5.60: live quote latency guard.
    // 09:00~09:10 Yahoo + official MIS are both queried and the newest timestamp wins;
    // after 09:10 Yahoo remains primary, but anything older than 60s immediately falls back to MIS.
    // This path intentionally bypasses Neon for numeric live quotes.
    const clock=taipeiParts();
    if(mode==="live"&&clock.minutes<OPEN_DUAL_SOURCE_UNTIL_MINUTES){
      const [yahoo,mis]=await Promise.allSettled([yahooFor(),fetchMisQuote(stock)]);
      const y=yahoo.status==="fulfilled"?yahoo.value:null,m=mis.status==="fulfilled"?mis.value:null;
      result=newerLiveQuote(y,m);
      // Price may come from Yahoo, but the official MIS y-field is the authoritative prior close.
      if(m?.previousClose)result=rebaseQuotePreviousClose(result,m.previousClose);
    }else{
      result=await yahooFor();
      if(mode==="live"&&!isFreshLiveQuote(result)){
        const mis=await fetchMisQuote(stock);
        if(mis)result=newerLiveQuote(result,mis);
      }
    }
    if(!result)return res.status(404).json({ok:false,error:mode==="live"?"Yahoo／官方 MIS 暫無可用行情":"Yahoo 查無此股票"});
    return res.status(200).json({ok:true,...result,fetchedAt:new Date().toISOString()});
  }catch(error){return res.status(502).json({ok:false,error:"股票名稱或行情暫時無法取得",detail:error.message})}
}
module.exports=handler;
module.exports._test={toNumber,cleanName,shortName,marketLabel,misNumber,misTradeDate,misQuoteTime,taipeiParts,taipeiDateFromEpoch,quoteCacheControl,liveStockHint,isFreshLiveQuote,newerLiveQuote,derivePreviousCloseFromBars,rebaseQuotePreviousClose,resolveStock,dbResolveStock,dbCloseQuote,fetchMisQuote,fetchYahoo};
