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
    if(!row||last===null)return null;
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
    const last=toNumber(x.close_price),previousClose=toNumber(x.previous_close);if(last===null)return null;
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
  const code=symbol.split(".")[0],officialStock=official||{code,market:symbol.endsWith(".TWO")?"上櫃":"上市"};
  const officialPreviousPromise=fetchOfficialPrevious(officialStock);
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5d&includePrePost=false&events=div%2Csplits`;
  const response=await fetch(url,{headers:HEADERS});if(!response.ok)return null;
  const json=await response.json(),result=json?.chart?.result?.[0];if(!result?.meta)return null;
  const meta=result.meta,timestamps=result.timestamp||[],quote=result.indicators?.quote?.[0]||{},closes=quote.close||[];
  let last=toNumber(meta.regularMarketPrice),lastTime=toNumber(meta.regularMarketTime),barLast=null,barTime=null;
  for(let i=closes.length-1;i>=0;i--){const close=toNumber(closes[i]),ts=toNumber(timestamps[i]);if(close!==null&&ts!==null){barLast=close;barTime=ts;break}}
  if(barLast!==null&&(last===null||lastTime===null||barTime>=lastTime)){last=barLast;lastTime=barTime}
  if(last===null)return null;
  const officialPrevious=await officialPreviousPromise;
  const previousClose=officialPrevious??toNumber(meta.regularMarketPreviousClose??meta.chartPreviousClose??meta.previousClose);
  const change=previousClose!==null?last-previousClose:null,changePct=previousClose&&change!==null?(change/previousClose)*100:null;
  return{source:"Yahoo Finance",symbol,code,name:shortName(FALLBACK_NAMES[code]||official?.name||meta.shortName||meta.longName||code),market:official?.market||(symbol.endsWith(".TWO")?"上櫃":"上市"),last,previousClose,change,changePct,high:toNumber(meta.regularMarketDayHigh),low:toNumber(meta.regularMarketDayLow),open:toNumber(meta.regularMarketOpen),quoteTime:lastTime?new Date(lastTime*1000).toISOString():new Date().toISOString()};
}
async function handler(req,res){
  const mode=String(req.query?.mode||"").trim().toLowerCase();
  if(mode==="meta")return stockmetaHandler(req,res);
  res.setHeader("Cache-Control","no-store");res.setHeader("Access-Control-Allow-Origin","*");
  const query=String(req.query.q||req.query.code||"").trim();if(!query)return res.status(400).json({ok:false,error:"請輸入股票名稱或代碼"});
  const marketHint=String(req.query.market||"").trim();
  try{
    if(mode==="db-close"){
      const result=await dbCloseQuote(query,marketHint);
      if(!result)return res.status(404).json({ok:false,error:"本機收盤資料暫無此股票"});
      return res.status(200).json({ok:true,...result,fetchedAt:new Date().toISOString()});
    }
    const stock=await resolveStock(query,marketHint);if(!stock)return res.status(404).json({ok:false,error:"查無此股票名稱或代碼"});
    let result=null;
    // v2.6.5.15：盤中由官方 TWSE/TPEx MIS 優先提供最新成交價，Yahoo 只當 fallback。
    // 避免 Yahoo 台股常見的盤初延遲，並保留 v2.6.5.14 的盤後 DB-first 路徑。
    if(mode==="live")result=await fetchMisQuote(stock);
    if(!result){
      if(stock.market==="上櫃")result=await fetchYahoo(`${stock.code}.TWO`,stock);
      else if(stock.market==="上市")result=await fetchYahoo(`${stock.code}.TW`,stock);
      else{
        const [tw,two]=await Promise.all([fetchYahoo(`${stock.code}.TW`,{...stock,market:"上市"}),fetchYahoo(`${stock.code}.TWO`,{...stock,market:"上櫃"})]);
        result=tw||two;
      }
    }
    if(!result)return res.status(404).json({ok:false,error:mode==="live"?"官方 MIS／Yahoo 暫無可用行情":"Yahoo 查無此股票"});
    return res.status(200).json({ok:true,...result,fetchedAt:new Date().toISOString()});
  }catch(error){return res.status(502).json({ok:false,error:"股票名稱或行情暫時無法取得",detail:error.message})}
}
module.exports=handler;
module.exports._test={toNumber,cleanName,shortName,marketLabel,misNumber,misTradeDate,misQuoteTime,resolveStock,dbResolveStock,dbCloseQuote,fetchMisQuote};
