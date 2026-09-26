// v2.6.1.3 — technical analysis rebuilt around direction / risk / stage; legacy technical score retired.
// 五年日K只抓一次並快取；近期股性維持一年加權，五年資料用於季節性／相似訊號／成長空間／極端風險。
const $=id=>document.getElementById(id);

function setText(id,value){
  const el=$(id); if(el) el.textContent=value ?? "—";
}

function overviewPlayMetricLabel(play){
  if(!play)return "--";
  const p=String(play.period||"");
  if(["短期","短波","波段","長波","長期"].includes(p))return p;
  const key=String(play.key||"");
  if(key==="short")return "短期";
  if(key==="mixed")return "短波";
  if(key==="swing")return "波段";
  if(key==="long-swing")return "長波";
  if(key==="long")return "長期";
  return p||"--";
}
let statusTimer=null;
function setStatus(msg,error=false){
  const el=$("statusText"); if(!el)return;
  clearTimeout(statusTimer);
  const loading=/^(?:搜尋股票|搜尋目標價|搜尋新聞|搜尋摘要相關新聞)(?:…|\.\.\.)?$/.test(String(msg||""));
  el.innerHTML=loading?`${String(msg).replace(/…|\.\.\.$/,"")}<span class="search-wave" aria-hidden="true"><i>•</i><i>•</i><i>•</i></span>`:msg;
  el.classList.toggle("error",error);el.classList.add("show");
  if(!loading){const ms=msg==="請先搜尋股票"?1500:(error?4200:1800);statusTimer=setTimeout(()=>el.classList.remove("show"),ms)}
}
function fmt(n){
  const x=Number(n);
  if(!Number.isFinite(x)) return "—";
  return x.toLocaleString("zh-TW",{maximumFractionDigits:2});
}
async function readJson(res,label){
  const text=await res.text();
  let data;
  try{data=JSON.parse(text)}catch{throw new Error(`${label}回傳格式錯誤`)}
  if(!res.ok || data?.ok===false) throw new Error(data?.error||`${label}查詢失敗（HTTP ${res.status}）`);
  return data;
}
const LOCAL_STOCK_META={
  "1595":{code:"1595",name:"川寶",market:"上櫃",symbol:"1595.TWO"},"川寶":{code:"1595",name:"川寶",market:"上櫃",symbol:"1595.TWO"},
  "6187":{code:"6187",name:"萬潤",market:"上櫃",symbol:"6187.TWO"},"萬潤":{code:"6187",name:"萬潤",market:"上櫃",symbol:"6187.TWO"},
  "8064":{code:"8064",name:"東捷",market:"上櫃",symbol:"8064.TWO"},"東捷":{code:"8064",name:"東捷",market:"上櫃",symbol:"8064.TWO"},
  "2330":{code:"2330",name:"台積電",market:"上市",symbol:"2330.TW"},"台積電":{code:"2330",name:"台積電",market:"上市",symbol:"2330.TW"}
};
function localStockMeta(query){return LOCAL_STOCK_META[String(query||"").trim()]||null}
function stockIndustryValue(...sources){
  for(const x of sources){
    if(!x||typeof x!=="object")continue;
    for(const k of ["industry","industryName","sector","sectorName","companyIndustry","industryCategory","industry_type","產業別","產業類別","產業"]){
      const v=String(x?.[k]??"").trim();
      if(v&&v!=="--"&&v!=="—"&&v!=="N/A")return v;
    }
  }
  return "";
}
function stockHeaderMeta(stock){
  const code=String(stock?.code||String(stock?.symbol||"").split(".")[0]||"—"),market=String(stock?.market||stock?.marketLabel||"台股").trim();
  return [code,market].filter(Boolean).join(" | ");
}
const STOCK_META_CACHE_KEY="stockzone_stock_meta_cache_v2625";
function readStockMetaCache(){try{return JSON.parse(localStorage.getItem(STOCK_META_CACHE_KEY)||"{}")||{}}catch{return{}}}
function cachedStockMeta(query){
  const q=String(query||"").trim(),all=readStockMetaCache(),hit=all[q];
  if(!hit)return null;
  const age=Date.now()-Number(hit.savedAt||0);if(!Number.isFinite(age)||age>30*24*60*60*1000)return null;
  return hit;
}
function rememberStockMeta(stock){
  const code=String(stock?.code||String(stock?.symbol||"").split(".")[0]||"").trim(),name=shortStockName(stock?.name||stock?.shortName||""),market=stock?.market||stock?.marketLabel||"";
  if(!/^\d{4,6}$/.test(code))return;
  const row={code,name,market,symbol:stock?.symbol||`${code}${market==="上櫃"?".TWO":".TW"}`,savedAt:Date.now()},all=readStockMetaCache();
  all[code]=row;if(name)all[name]=row;localStorage.setItem(STOCK_META_CACHE_KEY,JSON.stringify(all));
}
async function stockMeta(query){
  let lastError=null;
  for(let i=0;i<2;i++){
    try{
      return await readJson(await fetch(`/api/quote?mode=meta&q=${encodeURIComponent(query)}`,{cache:"no-store"}),"股票基本資料");
    }catch(e){
      lastError=e;
      if(i<1)await new Promise(r=>setTimeout(r,260));
    }
  }
  const local=localStockMeta(query);
  if(local)return local;
  throw lastError||new Error("TWSE／TPEx 股票基本資料暫時無法取得");
}
function preferredStockName(...values){
  const names=[...new Set(values.map(shortStockName).filter(Boolean))];
  if(!names.length)return "";
  return names.sort((a,b)=>a.length-b.length||a.localeCompare(b,"zh-Hant"))[0];
}
function mergeStockMeta(data,meta){
  if(!meta)return data;
  const industry=stockIndustryValue(meta,data),name=preferredStockName(data?.name,data?.shortName,meta?.name,meta?.shortName);
  return {...data,code:meta.code||data?.code||data?.symbol,symbol:data?.symbol||meta.symbol||meta.code,name:name||meta.name||data?.name||data?.shortName,shortName:name||meta.name||data?.shortName||data?.name,market:meta.market||data?.market||data?.marketLabel,marketLabel:meta.market||data?.marketLabel||data?.market,industry};
}

function taipeiMarketClock(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return{weekday:parts.weekday||"",minutes:Number(parts.hour||0)*60+Number(parts.minute||0)};
}
function isTaiwanIntraday(now=new Date()){
  const {weekday,minutes}=taipeiMarketClock(now);
  return !["Sat","Sun"].includes(weekday)&&minutes>=9*60&&minutes<13*60+30;
}
function dayKey(v){
  const m=String(v||"").match(/(20\d{2})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return m?`${m[1]}-${m[2]}-${m[3]}`:"";
}
function numeric(v){const n=Number(v);return Number.isFinite(n)?n:null}
function snapshotRow(root){
  const queue=[root],seen=new Set();
  while(queue.length){
    const x=queue.shift();
    if(!x||typeof x!=="object"||seen.has(x))continue;seen.add(x);
    const close=numeric(x.close_price??x.closePrice);
    const date=dayKey(x.trade_date??x.tradeDate);
    if(close!==null&&date)return x;
    for(const v of Object.values(x))if(v&&typeof v==="object")queue.push(v);
  }
  return null;
}
function normalizeSnapshot(payload,code){
  if(payload?.found===false)return null;
  const row=snapshotRow(payload);if(!row)return null;
  const last=numeric(row.close_price??row.closePrice),previousClose=numeric(row.previous_close??row.previousClose),change=previousClose!==null&&last!==null?last-previousClose:null;
  if(last===null)return null;
  return{source:"Neon price_snapshot",code:String((row.stock_code??row.stockCode??code)||""),name:row.stock_name??row.stockName??"",market:row.market??"",last,previousClose,change,changePct:previousClose&&change!==null?(change/previousClose)*100:null,open:numeric(row.open_price??row.openPrice),high:numeric(row.high_price??row.highPrice),low:numeric(row.low_price??row.lowPrice),quoteTime:row.quote_time??row.quoteTime??row.updated_at??row.updatedAt??null,tradeDate:dayKey(row.trade_date??row.tradeDate),officialClose:true};
}
async function dbCloseQuote(query,market=""){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
  try{
    const params=new URLSearchParams({mode:"db-close",q:String(query||"")});if(market)params.set("market",String(market));
    const res=await fetch(`/api/quote?${params.toString()}`,{cache:"no-store",signal:controller.signal});
    if(!res.ok)return null;
    const payload=await res.json();
    return payload?.ok===false?null:payload;
  }catch{return null}finally{clearTimeout(timer)}
}
const MIS_CLOSE_VERIFY_KEY="stockzone_mis_close_verify_v26211";
function taipeiCloseVerifyCycle(now=new Date()){
  let date="",weekday="",minutes=0;
  try{
    const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    date=`${parts.year}-${parts.month}-${parts.day}`;weekday=parts.weekday||"";minutes=Number(parts.hour||0)*60+Number(parts.minute||0);
  }catch{date=now.toISOString().slice(0,10)}
  const phase=["Sat","Sun"].includes(weekday)?"off":minutes>=13*60+30?"post":"pre";
  return `${date}:${phase}`;
}
function readMisCloseVerify(code){
  try{
    const all=JSON.parse(localStorage.getItem(MIS_CLOSE_VERIFY_KEY)||"{}");
    const row=all?.[String(code||"")];
    return row?.cycle===taipeiCloseVerifyCycle()?row:null;
  }catch{return null}
}
function writeMisCloseVerify(code,result){
  try{
    const all=JSON.parse(localStorage.getItem(MIS_CLOSE_VERIFY_KEY)||"{}");
    all[String(code||"")]={cycle:taipeiCloseVerifyCycle(),checkedAt:new Date().toISOString(),result:result||null};
    const entries=Object.entries(all).sort((a,b)=>String(b[1]?.checkedAt||"").localeCompare(String(a[1]?.checkedAt||""))).slice(0,120);
    localStorage.setItem(MIS_CLOSE_VERIFY_KEY,JSON.stringify(Object.fromEntries(entries)));
  }catch{}
}
async function misCloseQuote(code,market,{oncePerCycle=true}={}){
  if(oncePerCycle){
    const cached=readMisCloseVerify(code);
    if(cached)return cached.result||null;
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    const params=new URLSearchParams({q:String(code||"")});if(market)params.set("market",String(market));
    params.set("mode","official-close");
    const res=await fetch(`/api/sync-status?${params}`,{cache:"no-store",signal:controller.signal});
    if(!res.ok){if(oncePerCycle)writeMisCloseVerify(code,null);return null}
    const payload=await res.json(),result=payload?.ok===false?null:(payload?.result||payload);
    if(oncePerCycle)writeMisCloseVerify(code,result);
    return result;
  }catch{if(oncePerCycle)writeMisCloseVerify(code,null);return null}finally{clearTimeout(timer)}
}
function pickAfterCloseQuote(yahoo,db,mis){
  const candidates=[db,mis].filter(Boolean);
  if(!candidates.length)return yahoo;
  candidates.sort((a,b)=>{
    const da=dayKey(a.tradeDate),dbk=dayKey(b.tradeDate);
    if(da!==dbk)return da>dbk?-1:1;
    const pa=/Neon/i.test(String(a.source||""))?1:0,pb=/Neon/i.test(String(b.source||""))?1:0;
    return pb-pa;
  });
  const best=candidates[0];
  return{...yahoo,...best,code:best.code||yahoo?.code,symbol:best.symbol||yahoo?.symbol,name:best.name||yahoo?.name,shortName:best.name||yahoo?.shortName,market:best.market||yahoo?.market,marketLabel:best.market||yahoo?.marketLabel};
}
async function yahooQuote(query,market="",options={}){
  async function once(timeoutMs){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      return await readJson(
        await fetch(`/api/quote?q=${encodeURIComponent(query)}${market?`&market=${encodeURIComponent(market)}`:""}${options?.live?"&mode=live":""}`,{
          cache:"no-store",signal:controller.signal
        }),
        "股價"
      );
    }finally{clearTimeout(timer)}
  }
  try{return await once(15000)}catch(e){
    const retryable=e?.name==="AbortError"||/逾時|Failed to fetch|network|fetch/i.test(String(e?.message||""));
    if(!retryable)throw e;
    await new Promise(r=>setTimeout(r,350));
    try{return await once(20000)}catch(e2){if(e2?.name==="AbortError")throw new Error("股價查詢逾時");throw e2}
  }
}
async function quote(query,market="",options={}){
  // v2.6.5.16：盤後仍先走自己的全市場 price_snapshot；盤中則請後端優先走官方 TWSE/TPEx MIS。
  // v2.6.5.14 的 DB-first 快速搜尋保留；Yahoo 只作盤中 MIS 或盤後 DB 缺資料時的 fallback。
  if(!isTaiwanIntraday()){
    const fast=await dbCloseQuote(query,market);
    if(fast)return fast;
  }
  const intraday=isTaiwanIntraday();
  const yahoo=await yahooQuote(query,market,{live:intraday});
  if(intraday)return yahoo;
  const code=String(yahoo?.code||String(yahoo?.symbol||"").split(".")[0]||query||"").trim();
  if(!/^\d{4,6}$/.test(code))return yahoo;
  const verifyClose=options?.verifyClose===true;
  const dbPromise=dbCloseQuote(code,market||yahoo?.market||yahoo?.marketLabel||""),misPromise=verifyClose?misCloseQuote(code,market||yahoo?.market||yahoo?.marketLabel||""):Promise.resolve(null);
  const [db,mis]=await Promise.all([dbPromise,misPromise]);
  return pickAfterCloseQuote(yahoo,db,mis);
}
async function autoListQuote(code,market=""){
  if(isTaiwanIntraday())return quote(code,market,{verifyClose:false});
  const db=await dbCloseQuote(code,market);
  if(db)return db;
  // Neon 暫時沒有快照時才回退 Yahoo；背景清單永遠不做 MIS 核對。
  return yahooQuote(code,market);
}

function shortStockName(name){
  let s=String(name||"").trim();
  if(!s)return s;
  s=s.replace(/股份有限公司$/,"").replace(/有限公司$/,"").replace(/公司$/,"");
  return s;
}

function dispositionDateClient(y,m,d){const yy=Number(y),mm=Number(m),dd=Number(d),year=yy<1911?yy+1911:yy;if(!Number.isFinite(year)||year<1900||year>2200||mm<1||mm>12||dd<1||dd>31)return "";return `${year}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`}
function dispositionDatesClient(s=""){const text=String(s||""),out=[];for(const m of text.matchAll(/(?:^|[^\d])(\d{3,4})\s*(?:[\/.\-]|年)\s*(\d{1,2})\s*(?:[\/.\-]|月)\s*(\d{1,2})(?:日)?/g)){const x=dispositionDateClient(m[1],m[2],m[3]);if(x)out.push(x)}for(const m of text.matchAll(/(?:^|[^\d])(\d{7,8})(?!\d)/g)){const z=m[1],x=z.length===7?dispositionDateClient(z.slice(0,3),z.slice(3,5),z.slice(5,7)):dispositionDateClient(z.slice(0,4),z.slice(4,6),z.slice(6,8));if(x)out.push(x)}return [...new Set(out)]}
function rocDispositionPeriodClient(row){if(row?.periodStart&&row?.periodEnd)return {start:row.periodStart,end:row.periodEnd};const raw=String(row?.DispositionPeriod||row?.DisposalPeriod||row?.["處置起訖時間"]||row?.["處置起迄時間"]||row?.DisposalCondition||row?.DispositionReasons||""),dates=dispositionDatesClient(raw);return dates.length>=2?{start:dates[0],end:dates.at(-1)}:{start:"",end:""}}

function taipeiDateClient(){try{return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function clientDisposalInterval(rows){const t=(rows||[]).map(x=>String(x?.DisposalCondition||x?.DispositionReasons||"")).join(" "),m=t.match(/(?:每|約每)\s*(\d+)\s*分鐘/);return m?`${m[1]}分盤處置`:"處置撮合時間依官方公告"}
function clientDisposalPeriod(rows){for(const row of rows||[]){const p=rocDispositionPeriodClient(row);if(p.start&&p.end)return `${p.start.replace(/-/g,"/")}～${p.end.replace(/-/g,"/")}`}return "處置期間依官方公告"}
async function repairTpexDisposalInBrowser(d,query,market){
  if(!String(market||"").includes("上櫃")||d?.availability?.disposal!==false)return d;
  try{
    const r=await fetch("https://www.tpex.org.tw/openapi/v1/tpex_disposal_information",{cache:"no-store",headers:{Accept:"application/json"}});
    if(!r.ok)return d;
    const all=await r.json();if(!Array.isArray(all))return d;
    const code=String(query||"").replace(/\.(?:TW|TWO)$/i,"").trim(),today=taipeiDateClient();
    const matched=all.filter(x=>String(x?.SecuritiesCompanyCode||x?.SecuritiesCode||x?.Code||"").trim()===code);
    const active=matched.filter(x=>{const p=rocDispositionPeriodClient(x);return p.start&&p.end&&today>=p.start&&today<=p.end});
    d.availability={...(d.availability||{}),disposal:true};
    d.official={...(d.official||{}),disposalRows:matched.slice(0,8),activeDisposalRows:active.slice(0,5)};
    d.sources={...(d.sources||{}),disposal:"TPEx OpenAPI（瀏覽器直接補抓）"};
    if(active.length){
      d.state="處置中";d.risk="高";d.stateNote=clientDisposalInterval(active);d.riskNote="已進入處置期間";d.riskDistance=clientDisposalPeriod(active);d.summary="TPEx 官方已公告處置，請直接以處置起訖日與措施為準。";
    }else if(d.state==="資料不足"){
      const att=Array.isArray(d.official?.attentionRows)&&d.official.attentionRows.length>0,warning=Boolean(d.official?.warning);
      d.state=warning||att?"注意股票":"正常";d.stateNote=warning?"官方已列累計次數異常預警":att?"若進入處置：2分盤":"目前未列為處置股票";
      if(d.risk==="--")d.risk=warning?"高":att?"中":"低";
      d.riskDistance=warning?"最快下一交易日可能處置":"官方處置公告已正常核對";
      d.summary=warning?"TPEx 官方處置公告已由瀏覽器直接補抓；目前未處置，但已列累計次數異常預警。":att?"TPEx 官方處置公告已由瀏覽器直接補抓；目前未處置，但今日列為注意股票。":"TPEx 官方處置公告已由瀏覽器直接補抓；目前未列為處置股票。";
    }
  }catch(e){console.warn("TPEx 瀏覽器端處置補抓失敗",e)}
  return d;
}
async function disposal(query,market,price){
  const params=new URLSearchParams({q:String(query||""),market:String(market||""),price:String(price??""),v:"2.5.4.14"});
  const d=await readJson(await fetch(`/api/disposal?${params.toString()}`,{cache:"no-store"}),"處置資料");
  return await repairTpexDisposalInBrowser(d,query,market);
}
function disposalToneClass(state){return state==="處置中"?"disposal-state-danger":state==="注意股票"||state==="注意股"?"disposal-state-watch":""}
function disposalDots(id,count,total,dangerAt){
  const host=$(id);if(!host)return;const n=Math.max(0,Math.min(total,Number(count)||0));host.innerHTML=Array.from({length:total},(_,i)=>`<span class="disposal-dot${i<n?(n>=dangerAt?" danger":" on"):""}"></span>`).join("");
}
function disposalTag(id,count,total){const el=$(id);if(!el)return;const left=Math.max(0,total-(Number(count)||0));el.textContent=left===0?"達標":left===1?"警戒":"安全";el.style.background=left===0?"rgba(255,95,111,.2)":left===1?"rgba(255,201,67,.18)":"#34475a";el.style.color=left===0?"#ff7b87":left===1?"#ffd04d":"#edf4fa"}
function resetDisposal(msg="搜尋股票後判讀"){
  setText("disposalState","--");setText("disposalStateNote",msg);setText("disposalRisk","--");setText("disposalRiskNote","--");setText("disposalRiskDistance","--");
  [["disposalDots3","disposalCount3","disposalTag3",3],["disposalDots10","disposalCount10","disposalTag10",6],["disposalDots30","disposalCount30","disposalTag30",12]].forEach(([d,c,t,n])=>{disposalDots(d,0,n,n);setText(c,`-- / ${n}`);setText(t,"--")});
  const reason=$('disposalReasonList');if(reason)reason.querySelectorAll('div').forEach(x=>x.classList.remove('active'));setText("disposalReasonNote","尚未取得今日注意資訊");
  setText("disposalPriceLine","--");setText("disposalPriceLineGap","僅價格款估算");setText("disposalExVolume","資料判讀");setText("disposalExTurnover","資料判讀");setText("disposalExEtf","不適用");setText("disposalExOther","不適用");setText("disposalSummary",msg);setText("overviewDisposalState","--");setText("overviewDisposalRisk","處置風險 --");
}
function renderDisposal(d){
  const panel=$("disposal");if(panel){panel.classList.remove("disposal-state-watch","disposal-state-danger");const c=disposalToneClass(d.state);if(c)panel.classList.add(c)}
  setText("disposalState",d.state||"正常");setText("disposalStateNote",d.stateNote||"目前未列為注意股票");setText("disposalRisk",d.risk||"低");setText("disposalRiskNote",d.riskNote||"--");const periodLabel=d?.state==="處置中"&&d?.disposalPeriod?.label?d.disposalPeriod.label:d.riskDistance;setText("disposalRiskDistance",periodLabel||"--");
  const counts=d.counts||{};const c3=Number(counts.d3)||0,c10=Number(counts.d10)||0,c30=Number(counts.d30)||0;
  disposalDots("disposalDots3",c3,3,3);disposalDots("disposalDots10",c10,6,6);disposalDots("disposalDots30",c30,12,12);
  if(d.countsAvailable===false){
    setText("disposalCount3","-- / 3");setText("disposalCount10","-- / 6");setText("disposalCount30","-- / 12");setText("disposalTag3","--");setText("disposalTag10","--");setText("disposalTag30","--");
  }else{
    setText("disposalCount3",`${c3} / 3`);setText("disposalCount10",`${c10} / 6`);setText("disposalCount30",`${c30} / 12`);disposalTag("disposalTag3",c3,3);disposalTag("disposalTag10",c10,6);disposalTag("disposalTag30",c30,12);
  }
  const keys=new Set(Array.isArray(d.reasonKeys)?d.reasonKeys:[]), rows=$('disposalReasonList')?.querySelectorAll('div')||[];rows.forEach((x,i)=>x.classList.toggle('active',keys.has(["price","volume","turnover","concentration","valuation","margin","sbl"][i])));setText("disposalReasonNote",d.reasonText||"今日未發布注意資訊");
  const ex=d.exceptions||{};const setEx=(id,val,tone)=>{const e=$(id);if(!e)return;e.textContent=val||"資料不足";e.classList.remove("good","watch","bad");if(tone)e.classList.add(tone)};setEx("disposalExVolume",ex.volume?.label,ex.volume?.tone);setEx("disposalExTurnover",ex.turnover?.label,ex.turnover?.tone);setEx("disposalExEtf",ex.etf?.label,ex.etf?.tone);setEx("disposalExOther",ex.other?.label,ex.other?.tone);
  if(d.priceLine&&Number.isFinite(Number(d.priceLine.value))){setText("disposalPriceLine",`${fmt(d.priceLine.value)} 元`);setText("disposalPriceLineGap",d.priceLine.note||"僅價格款估算");const e=$("disposalPriceLine");if(e){e.classList.remove("good","watch","bad");e.classList.add(d.priceLine.tone||"")}}else{setText("disposalPriceLine","資料不足");setText("disposalPriceLineGap",d.priceLine?.note||"無法估算")}
  setText("disposalSummary",d.summary||"--");setText("overviewDisposalState",d.state||"正常");setText("overviewDisposalRisk",`處置風險 ${d.risk||"低"}`);
}
async function loadDisposal(stock){
  resetDisposal("讀取官方注意／處置資料中…");
  try{const code=stock?.code||stock?.symbol||"",price=Number(stock?.last??stock?.price??stock?.regularMarketPrice);const d=await disposal(code,stock?.market||stock?.marketLabel||"",price);renderDisposal(d)}catch(e){console.warn("處置資料更新失敗",e);resetDisposal(`處置資料暫時無法取得：${e.message}`)}
}
async function technical(query,market){
  const params=new URLSearchParams({q:String(query||""),market:String(market||"")});
  return await readJson(await fetch(`/api/technical?${params.toString()}`,{cache:"no-store"}),"技術資料");
}
const HISTORY5Y_CACHE_KEY="stockzone_history5y_v2591",HISTORY5Y_CACHE_MS=12*60*60*1000;
function readHistory5YCache(){try{return JSON.parse(localStorage.getItem(HISTORY5Y_CACHE_KEY)||"{}")||{}}catch{return{}}}
function writeHistory5YCache(x){try{localStorage.setItem(HISTORY5Y_CACHE_KEY,JSON.stringify(x))}catch{}}
async function history5Y(query,market){
  const code=String(query||"").replace(/\.(?:TW|TWO)$/i,"").trim(),key=`${code}|${String(market||"")}`,all=readHistory5YCache(),cached=all[key];
  if(cached&&Date.now()-Number(cached.savedAt||0)<HISTORY5Y_CACHE_MS&&Array.isArray(cached.data?.history)&&cached.data?.windowYears===5&&cached.data.history.length>180)return cached.data;
  const params=new URLSearchParams({q:code,market:String(market||"")}),data=await readJson(await fetch(`/api/technical?mode=history&${params.toString()}`,{cache:"default"}),"歷史資料");
  all[key]={savedAt:Date.now(),data};const keys=Object.keys(all).sort((a,b)=>Number(all[b]?.savedAt||0)-Number(all[a]?.savedAt||0));for(const k of keys.slice(8))delete all[k];writeHistory5YCache(all);return data;
}

const FUNDAMENTALS_CACHE_KEY="stockzone_fundamentals_v26123",FUNDAMENTALS_CACHE_MS=6*60*60*1000;
function readFundamentalsCache(){try{return JSON.parse(localStorage.getItem(FUNDAMENTALS_CACHE_KEY)||"{}")||{}}catch{return{}}}
function writeFundamentalsCache(x){try{localStorage.setItem(FUNDAMENTALS_CACHE_KEY,JSON.stringify(x))}catch{}}
function fundamentalQuarterInfo(row){
  if(!row||typeof row!=="object")return null;
  let year=Number(row?.year),quarter=Number(row?.quarterNo??row?.q);
  if(Number.isFinite(year)&&year<1911)year+=1911;
  if(!(quarter>=1&&quarter<=4))quarter=null;
  if(Number.isFinite(year)&&quarter)return {year,quarter,key:`${year}Q${quarter}`,stamp:year*10+quarter};
  const raw=String(row?.period??row?.quarter??row?.yearQuarter??row?.date??"").trim();
  let m=raw.match(/(\d{3,4})\D*[Qq季]\s*([1-4])/);
  if(!m)m=raw.match(/(\d{3,4})\s*[-/]?\s*([1-4])\s*[Qq季]/);
  if(m){year=Number(m[1]);if(year<1911)year+=1911;quarter=Number(m[2]);return {year,quarter,key:`${year}Q${quarter}`,stamp:year*10+quarter};}
  const d=new Date(raw);
  if(Number.isFinite(d.getTime())){year=d.getFullYear();quarter=Math.floor(d.getMonth()/3)+1;return {year,quarter,key:`${year}Q${quarter}`,stamp:year*10+quarter};}
  const ts=Number(row?.timestamp);
  if(Number.isFinite(ts)){const dt=new Date(ts>1e12?ts:ts*1000);if(Number.isFinite(dt.getTime())){year=dt.getFullYear();quarter=Math.floor(dt.getMonth()/3)+1;return {year,quarter,key:`${year}Q${quarter}`,stamp:year*10+quarter};}}
  return null;
}
function fundamentalSortedRows(data){
  const rows=(Array.isArray(data?.quarters)?data.quarters:[]).filter(x=>x&&typeof x==="object");
  return rows.slice().sort((a,b)=>(fundamentalQuarterInfo(b)?.stamp??-Infinity)-(fundamentalQuarterInfo(a)?.stamp??-Infinity));
}
function fundamentalRevenueValue(row){
  if(!row||typeof row!=="object")return null;
  const keys=["revenue","totalRevenue","operatingRevenue","netRevenue","sales","salesRevenue","revenueTotal","quarterlyRevenue","revenueAmount"];
  for(const key of keys){const n=fundamentalScalar(row?.[key]);if(n!==null)return n}
  for(const key of ["financialData","incomeStatement","quarterlyFinancials","financials","data"]){const child=row?.[key];if(child&&typeof child==="object"){const n=fundamentalRevenueValue(child);if(n!==null)return n}}
  return null;
}
function fundamentalMonthlyPct(monthly,kind="yoy"){
  if(!monthly||typeof monthly!=="object")return null;
  const keys=kind==="cumulative"
    ?["cumulativeYoyPct","cumulativeYoYPct","cumulativeYoy","cumulativeYoY","cumYoyPct","cumYoYPct","cumYoy","cumYoY","accumulatedYoyPct","yearToDateYoyPct","ytdYoyPct"]
    :["yoyPct","yoYPct","yoy","yoY","revenueYoyPct","revenueYoYPct","revenueYoy","revenueYoY","yearOverYearPct","yearOverYear","growthYoyPct","growthYoYPct"];
  for(const key of keys){const n=fundamentalScalar(monthly?.[key]);if(n!==null)return n}
  if(kind==="yoy"){
    const cur=fundamentalScalar(monthly?.revenue??monthly?.currentRevenue??monthly?.thisMonthRevenue),prev=fundamentalScalar(monthly?.lastYearRevenue??monthly?.yearAgoRevenue??monthly?.previousYearRevenue??monthly?.sameMonthLastYearRevenue);
    if(cur!==null&&prev!==null&&prev!==0)return (cur/prev-1)*100;
  }
  return null;
}
function fundamentalValueFilled(v){return !(v===null||v===undefined||v==="")}
function mergeFundamentalObject(primary,fallback){
  const a=primary&&typeof primary==="object"?primary:{},b=fallback&&typeof fallback==="object"?fallback:{};
  const out={...b};
  for(const [k,v] of Object.entries(a)){
    if(!fundamentalValueFilled(v))continue;
    if(v&&typeof v==="object"&&!Array.isArray(v)&&b?.[k]&&typeof b[k]==="object"&&!Array.isArray(b[k]))out[k]=mergeFundamentalObject(v,b[k]);
    else out[k]=v;
  }
  return out;
}
function fundamentalRowsHaveMargins(data){
  const rows=fundamentalSortedRows(data),off=data?.officialStatement||null;
  const valid=n=>n!==null&&Number.isFinite(n);
  const hasGross=valid(fundamentalMarginValue(off,"gross"))||rows.some(x=>valid(fundamentalMarginValue(x,"gross")));
  const hasOperating=valid(fundamentalMarginValue(off,"operating"))||rows.some(x=>valid(fundamentalMarginValue(x,"operating")));
  return hasGross&&hasOperating;
}
function fundamentalPayloadNeedsSupplement(data){
  const rows=fundamentalSortedRows(data),eps=rows.map(x=>valuationNum(x?.eps)).filter(Number.isFinite),rev=rows.map(fundamentalRevenueValue).filter(Number.isFinite),monthly=data?.monthlyRevenue||null;
  const hasMonthly=fundamentalMonthlyPct(monthly,"yoy")!==null;
  return !fundamentalRowsHaveMargins(data)||(!hasMonthly&&rev.length<5)||eps.length<5;
}
function mergeFundamentalPayload(primary,fallback){
  const a=primary&&typeof primary==="object"?primary:{},b=fallback&&typeof fallback==="object"?fallback:{};
  const aq=Array.isArray(a.quarters)?a.quarters:[],bq=Array.isArray(b.quarters)?b.quarters:[];
  const rowKey=(x,i)=>fundamentalQuarterInfo(x)?.key||String(x?.period||x?.quarter||x?.date||x?.yearQuarter||`#${i}`);
  const bmap=new Map(bq.map((x,i)=>[rowKey(x,i),x]));
  const mergedQ=aq.map((x,i)=>mergeFundamentalObject(x,bmap.get(rowKey(x,i))));
  const seen=new Set(aq.map((x,i)=>rowKey(x,i)));
  bq.forEach((x,i)=>{if(!seen.has(rowKey(x,i)))mergedQ.push(x)});
  const source=[a.source,b.source].filter(Boolean).filter((x,i,arr)=>arr.indexOf(x)===i).join("＋");
  return {...b,...a,quarters:fundamentalSortedRows({quarters:mergedQ.length?mergedQ:(aq.length?aq:bq)}),officialStatement:mergeFundamentalObject(a.officialStatement,b.officialStatement),monthlyRevenue:mergeFundamentalObject(a.monthlyRevenue,b.monthlyRevenue),company:mergeFundamentalObject(a.company,b.company),profile:mergeFundamentalObject(a.profile,b.profile),financialData:mergeFundamentalObject(a.financialData,b.financialData),source:source||a.source||b.source};
}
async function fundamentals(query,market){
  const code=String(query||"").replace(/\.(?:TW|TWO)$/i,"").trim(),key=`${code}|${String(market||"")}`,all=readFundamentalsCache(),cached=all[key];
  if(cached&&Date.now()-Number(cached.savedAt||0)<FUNDAMENTALS_CACHE_MS&&Array.isArray(cached.data?.quarters))return cached.data;
  const params=new URLSearchParams({q:code,market:String(market||"")});
  const fallbackParams=new URLSearchParams({mode:"fundamentals",q:code,market:String(market||"")});
  let data=null;
  try{
    data=await readJson(await fetch(`/api/fundamentals?${params.toString()}`,{cache:"no-store"}),"長期基本面");
    if(fundamentalPayloadNeedsSupplement(data)){
      try{
        const supplement=await readJson(await fetch(`/api/technical?${fallbackParams.toString()}`,{cache:"no-store"}),"長期基本面補充");
        data=mergeFundamentalPayload(data,supplement);
      }catch(supplementError){console.warn("基本面毛利率／營益率補充失敗",supplementError)}
    }
  }catch(primaryError){
    console.warn("官方基本面獨立路由失敗，改用 Yahoo 基本面 fallback",primaryError);
    data=await readJson(await fetch(`/api/technical?${fallbackParams.toString()}`,{cache:"no-store"}),"長期基本面 fallback");
  }
  all[key]={savedAt:Date.now(),data};const keys=Object.keys(all).sort((a,b)=>Number(all[b]?.savedAt||0)-Number(all[a]?.savedAt||0));for(const k of keys.slice(12))delete all[k];writeFundamentalsCache(all);return data;
}
async function loadFundamentals(stock){
  const code=String(stock?.code||String(stock?.symbol||"").split(".")[0]||""),market=stock?.market||stock?.marketLabel||"";
  try{
    const data=await fundamentals(code,market),cur=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");
    if(cur&&cur!==code)return;latestFundamentalData=data;renderFundamentalOverview();const industry=stockIndustryValue(data,data?.company,data?.profile,data?.officialStatement);if(industry&&currentStock)currentStock={...currentStock,industry};if(latestValuationData)renderValuation(latestValuationData);if(latestFiveStageResult&&latestTechnicalForPlay)renderPlayStyle();
  }catch(e){console.warn("長期基本面更新失敗",e);const cur=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");if(!cur||cur===code){latestFundamentalData=null;resetFundamentalOverview("資料不足");if(latestFiveStageResult&&latestTechnicalForPlay)renderPlayStyle()}}
}

function historyDateKey(x){if(x?.date)return dayKey(x.date);const ts=Number(x?.timestamp);return Number.isFinite(ts)?dayKey(new Date(ts*1000).toISOString()):""}
function markSystemStress(data){
  const stock=(Array.isArray(data?.history)?data.history:[]).filter(x=>stageNum(x?.close)!==null),bench=(Array.isArray(data?.benchmark?.history)?data.benchmark.history:[]).filter(x=>stageNum(x?.close)!==null);
  if(!stock.length)return {...data,history:[]};
  const bmap=new Map(),bclose=bench.map(x=>stageNum(x.close));
  for(let i=0;i<bench.length;i++){const d=historyDateKey(bench[i]);if(!d)continue;const c=bclose[i],r1=i>0?stagePct(c,bclose[i-1]):null,r5=i>=5?stagePct(c,bclose[i-5]):null,r20=i>=20?stagePct(c,bclose[i-20]):null;const stress=(r1!==null&&r1<=-5.5)||(r5!==null&&r5<=-8)||(r20!==null&&r20<=-15);bmap.set(d,{stress,r1,r5,r20})}
  const rows=stock.map(x=>{const m=bmap.get(historyDateKey(x));return {...x,systemStress:!!m?.stress,marketRet1:m?.r1??null,marketRet5:m?.r5??null,marketRet20:m?.r20??null}});
  return {...data,history:rows,stressDays:rows.filter(x=>x.systemStress).length};
}
function technicalFmt(n,suffix=""){const x=Number(n);return Number.isFinite(x)?`${x.toLocaleString("zh-TW",{maximumFractionDigits:2})}${suffix}`:"--"}
function overviewIntFmt(n,suffix=""){const x=Number(n);if(!Number.isFinite(x))return "--";const v=x<0?Math.ceil(x):Math.floor(x);return `${v.toLocaleString("zh-TW")}${suffix}`;}
function overviewZoneIntText(zone){return Array.isArray(zone)&&zone.length===2?`${overviewIntFmt(zone[0])} ～ ${overviewIntFmt(zone[1])}`:"--"}
function technicalVolumeFmt(n){const x=Number(n);if(!Number.isFinite(x))return "--";if(Math.abs(x)>=10000){const w=x/10000;return `${w.toLocaleString("zh-TW",{maximumFractionDigits:w>=100?0:1})}萬`;}return x.toLocaleString("zh-TW",{maximumFractionDigits:0});}
function technicalMetrics(id,items){const el=$(id);if(!el)return;el.classList.add("tech-metrics");el.style.setProperty("--cols",String(items.length));el.innerHTML=items.map(([label,value])=>`<span class="tech-metric"><span>${label}</span><b>${value}</b></span>`).join("")}
function techTone(el,tone){if(!el)return;el.classList.remove("tone-good","tone-watch","tone-bad","tone-neutral","tone-info","tone-cyan");el.classList.add(`tone-${tone||"neutral"}`)}
function techSet(id,text,tone){const el=$(id);if(el){el.textContent=text||"--";if(tone)techTone(el,tone)}}

let latestTechnicalDirection=null;
let latestTechnicalPersonality=null;
let latestTechnicalSeasonality=null;

function techSignedClamp(n,min=-100,max=100){return Math.max(min,Math.min(max,Number(n)||0))}
function techUnit(v){return Math.max(-1,Math.min(1,Number(v)||0))}
function techWeightedSignal(items){
  let sum=0,w=0;
  for(const item of items||[]){const v=Number(item?.[0]),wt=Number(item?.[1]);if(!Number.isFinite(v)||!Number.isFinite(wt)||wt<=0)continue;sum+=techUnit(v)*wt;w+=wt}
  return {value:w?techUnit(sum/w):0,coverage:w};
}
function techFactorLabel(v){const x=Number(v)||0;return x>=.28?'偏多':x<=-.28?'偏空':'中性'}
function techFactorTone(v){const x=Number(v)||0;return x>=.28?'good':x<=-.28?'bad':'watch'}
function techTanh(v,scale=1){const x=Number(v);return Number.isFinite(x)?Math.tanh(x/scale):0}
function technicalDirectionFactors(t,price){
  const p=stageNum(price),ma5=stageNum(t?.ma?.ma5),ma10=stageNum(t?.ma?.ma10),ma20=stageNum(t?.ma?.ma20),ma60=stageNum(t?.ma?.ma60),rows=stageHistory(t),path=buildStagePath(t,p,ma5,ma10,ma20,ma60);
  const maParts=[];
  if(p!==null&&ma5!==null)maParts.push([p>=ma5?1:-1,10]);
  if(p!==null&&ma10!==null)maParts.push([p>=ma10?1:-1,12]);
  if(p!==null&&ma20!==null)maParts.push([p>=ma20?1:-1,18]);
  if(p!==null&&ma60!==null)maParts.push([p>=ma60?1:-1,18]);
  if([ma5,ma10,ma20].every(Number.isFinite))maParts.push([ma5>=ma10&&ma10>=ma20?1:ma5<=ma10&&ma10<=ma20?-1:(ma5>=ma20?.35:-.35),22]);
  if(Number.isFinite(path.ma20Slope10))maParts.push([techTanh(path.ma20Slope10,1.4),10]);
  if(Number.isFinite(path.ma60Slope20))maParts.push([techTanh(path.ma60Slope20,1.8),10]);
  const ma=techWeightedSignal(maParts);

  const ratio20=stageNum(t?.volume?.ratio20),ret5=shortReturnN(rows,5,p),ret20=stageRet(rows,20,p),volTrend=.62*techTanh(ret5,4)+.38*techTanh(ret20,10),volAmp=ratio20===null?.72:stageClamp(.55+.45*(ratio20/1.15),.45,1.25),volume={value:techUnit(volTrend*volAmp),coverage:(ret5!==null||ret20!==null)?1:0};

  const upper=stageNum(t?.bollinger?.upper),middle=stageNum(t?.bollinger?.middle),lower=stageNum(t?.bollinger?.lower),bollParts=[];
  if(p!==null&&middle!==null)bollParts.push([p>=middle?1:-1,55]);
  if(p!==null&&upper!==null&&lower!==null&&upper>lower){const pct=(p-lower)/(upper-lower);bollParts.push([techUnit((pct-.5)*2),45])}
  const bollinger=techWeightedSignal(bollParts);

  const bias20=stageNum(t?.bias?.ma20)??stagePct(p,ma20),bias60=stageNum(t?.bias?.ma60)??stagePct(p,ma60),biasParts=[];
  if(bias20!==null)biasParts.push([techTanh(bias20,7),65]);if(bias60!==null)biasParts.push([techTanh(bias60,11),35]);
  const bias=techWeightedSignal(biasParts);if(Math.abs(bias20??0)>=22)bias.value*=.82;

  const trendParts=[];if(Number.isFinite(path.ret20))trendParts.push([techTanh(path.ret20,10),30]);if(Number.isFinite(path.ret60))trendParts.push([techTanh(path.ret60,18),28]);if(Number.isFinite(path.ma60Slope20))trendParts.push([techTanh(path.ma60Slope20,2),22]);
  if(p!==null){const hi=stageNum(t?.trend?.high60)??path.high60,lo=stageNum(t?.trend?.low60)??path.low60;if(hi!==null&&lo!==null&&hi>lo)trendParts.push([techUnit(((p-lo)/(hi-lo)-.5)*2),20])}
  const trend=techWeightedSignal(trendParts);

  const rsi=stageNum(t?.momentum?.rsi14),hist=stageNum(t?.momentum?.histogram),macd=stageNum(t?.momentum?.macd),signal=stageNum(t?.momentum?.signal),momentumParts=[];
  if(rsi!==null)momentumParts.push([techUnit((rsi-50)/25),42]);
  if(hist!==null)momentumParts.push([hist>0?1:hist<0?-1:0,38]);
  else if(macd!==null&&signal!==null)momentumParts.push([macd>=signal?1:-1,38]);
  if(Number.isFinite(ret5))momentumParts.push([techTanh(ret5,5),20]);
  const momentum=techWeightedSignal(momentumParts);

  return {ma,volume,bollinger,bias,trend,momentum,path,bias20,rsi,ratio20,ret5,ret20};
}
function technicalSeasonalityModifier(season){
  if(!season?.valid||!(season.sample>0))return 0;
  const hit=(season.positives/season.sample-.5)*2,med=techTanh(season.median,10),quality=stageClamp(season.sample/4,.35,1);
  return techSignedClamp((hit*.55+med*.45)*8*quality,-8,8);
}
function technicalPersonalityMagnitude(personality){
  const map={'swing-trend':1.08,hybrid:1.00,'short-cycle':.90,burst:.94,'high-vol-short':.84,range:.74,reset:.62,mixed:.90,unknown:.82};
  return map[personality?.kind]??.90;
}
function technicalHiddenPosition(direction,stageResult=null){
  const idx=Number(direction?.index)||0,p=direction?.personality||{},stage=stageResult?.stage??3;
  let core=50+idx*.16;
  core+=({1:-10,2:-3,3:10,4:4,5:-10})[stage]??0;
  core+=({'swing-trend':10,hybrid:4,'short-cycle':-7,burst:-9,'high-vol-short':-12,range:-6,reset:-15,mixed:0,unknown:0})[p.kind]??0;
  if(direction?.riskLevel==='高')core-=8;else if(direction?.riskLevel==='低'&&direction?.direction==='偏多')core+=3;
  core=Math.round(stageClamp(core,15,85)/5)*5;
  return {corePct:core,tacticalPct:100-core};
}
function technicalRiskAssessment(direction,stageResult=null){
  const f=direction?.factors||{},p=direction?.personality||{},season=direction?.seasonality||{},risks=[];let risk=0;
  const stage=stageResult?.stage??null;
  if(stage===5){risk+=3;risks.push('高檔過熱')}
  if((f.bias20??0)>=15){risk+=2;risks.push('20MA乖離偏高')}
  if((f.rsi??0)>=78){risk+=2;risks.push('RSI過熱')}
  if((f.ratio20??0)>=1.5&&direction?.direction==='偏空'){risk+=2;risks.push('放量走弱')}
  if(['high-vol-short','reset'].includes(p.kind)){risk+=2;risks.push(p.kind==='reset'?'股性有深回重置':'股性波動偏大')}
  else if(p.kind==='range'){risk+=1;risks.push('箱型反覆')}
  if(season?.valid&&season.sample>=3&&season.positives/season.sample<=.34&&(season.median??0)<0){risk+=1;risks.push('季節性偏弱')}
  if(direction?.direction==='偏空'){risk+=1;risks.push('方向偏空')}
  const level=risk>=4?'高':risk>=2?'中':'低',tone=level==='高'?'bad':level==='中'?'watch':'good';
  const text=risks.length?`${level}｜${risks.slice(0,3).join('、')}`:`${level}｜結構暫無明顯額外風險`;
  return {level,tone,text,points:risk};
}
function calculateTechnicalDirection(t,price,personality=null,seasonality=null){
  const f=technicalDirectionFactors(t,price),weights={ma:.25,volume:.20,trend:.20,momentum:.15,bollinger:.10,bias:.10},parts=[['ma',f.ma],['volume',f.volume],['trend',f.trend],['momentum',f.momentum],['bollinger',f.bollinger],['bias',f.bias]];
  let sum=0,coverage=0;for(const [k,x] of parts){const w=weights[k];if((x?.coverage??0)<=0)continue;sum+=(x.value||0)*w;coverage+=w}
  const base=coverage?sum/coverage:0,personalityMag=technicalPersonalityMagnitude(personality),seasonMod=technicalSeasonalityModifier(seasonality),index=techSignedClamp(base*100*personalityMag+seasonMod),direction=index>=18?'偏多':index<=-18?'偏空':'整理',tone=direction==='偏多'?'good':direction==='偏空'?'bad':'watch';
  const agreement=coverage?parts.reduce((acc,[k,x])=>{const w=weights[k];if((x?.coverage??0)<=0)return acc;const sign=Math.sign(index),xs=Math.sign(x.value||0);return acc+(sign===0?Math.abs(x.value||0)<.28:(xs===sign||Math.abs(x.value||0)<.18)?w:0)},0)/coverage:0;
  const labels=Object.fromEntries(parts.map(([k,x])=>[k,{value:x.value,label:techFactorLabel(x.value),tone:techFactorTone(x.value)}]));
  const result={direction,tone,index,baseIndex:base*100,coverage:Math.round(coverage*100),agreement:Math.round(agreement*100),labels,factors:{...f,bias20:f.bias20,rsi:f.rsi,ratio20:f.ratio20},personality,seasonality,seasonModifier:seasonMod};
  const risk=technicalRiskAssessment(result,null);result.riskLevel=risk.level;result.riskTone=risk.tone;result.riskText=risk.text;result.hiddenPosition=technicalHiddenPosition(result,null);
  return result;
}
function technicalDirectionScaleLevel(d,stageResult=null){
  const stage=Number(stageResult?.stage);
  if(Number.isFinite(stage)&&stage>=1&&stage<=5)return stage;
  const x=Number(d?.index)||0;
  if(x>=58)return 5;
  if(x>=18)return 4;
  if(x<=-58)return 1;
  if(x<=-18)return 2;
  return 3;
}
function technicalOverviewPositionLabel(stageResult){
  const stage=Number(stageResult?.stage);
  return ({1:'築底整理',2:'轉強修復',3:'趨勢爬坡',4:'主升加速',5:'高檔過熱'})[stage]||'五階段判讀中';
}
function technicalOverviewInsight(d,stageResult=null){
  if(!d)return '--';
  const raw=String(d.riskText||'').replace(/[。.]$/,'');
  return raw||'暫無明顯額外風險';
}
function updateTechnicalOverview(d,stageResult=null){
  if(!d)return;
  setText('techSummary',technicalOverviewInsight(d,stageResult));
  const scale=$('techDirectionScale'),level=technicalDirectionScaleLevel(d,stageResult);
  if(scale){
    scale.dataset.level=String(level);
    scale.querySelectorAll('.tech-scale-item').forEach(el=>el.classList.toggle('is-active',Number(el.dataset.level)===level));
  }
}
function refreshTechnicalDirectionAfterStage(stageResult){
  if(!latestTechnicalDirection)return;
  const risk=technicalRiskAssessment(latestTechnicalDirection,stageResult);latestTechnicalDirection.riskLevel=risk.level;latestTechnicalDirection.riskTone=risk.tone;latestTechnicalDirection.riskText=risk.text;latestTechnicalDirection.hiddenPosition=technicalHiddenPosition(latestTechnicalDirection,stageResult);
  updateTechnicalOverview(latestTechnicalDirection,stageResult);
}
function technicalDirectionHeadline(d){
  if(!d)return '--';const p=d.personality?.label||'股性資料不足',s=d.seasonality?.valid?`Q${d.seasonality.quarter}季節性${d.seasonality.median>=0?'偏正向':'偏弱'}`:'季節性樣本不足';
  return `六項技術綜合${d.direction}｜${p}｜${s}`;
}

// v2.5.6.5 — 五階段位置 v2 + 建議玩法 v3
// 五階段 v2 會讀取 /api/technical 已回傳的歷史日 K（history），把「生命週期」與「當下狀態」分開。
// 原有技術分析 MA/Bollinger/Volume/Momentum 計分完全不改；這裡只新增路徑判讀。
let latestFiveStageResult=null;
let latestTechnicalForPlay=null;
let latestPlayStyleResult=null;
let latestHistory5Y=null;
let latestFundamentalData=null;

function resetFundamentalOverview(msg="資料待補"){
  ["fundamentalEpsYoy","fundamentalRevenueYoy","fundamentalGrossMargin","fundamentalOperatingMargin","fundamentalStability","fundamentalCompanyQuality","fundamentalContinuation","fundamentalGrowthStrength","fundamentalGrowthTrend","fundamentalProfitQuality","fundamentalStabilityScore","fundamentalRisk","fundamentalConfidence","fundamentalValuationPressure","fundamentalPriceAttractiveness"].forEach(id=>setText(id,"--"));
  ["fundamentalCompanyQualityNote","fundamentalContinuationNote","fundamentalGrowthStrengthNote","fundamentalGrowthTrendNote","fundamentalProfitQualityNote","fundamentalStabilityScoreNote","fundamentalRiskNote"].forEach(id=>setText(id,msg==="讀取中"?"讀取中…":"等待資料"));
  setText("fundamentalConfidenceNote","營運＋估值資料");
  setText("fundamentalValuationPressureNote","等待估值資料");
  setText("fundamentalPriceAttractivenessNote","等待估值資料");
  setText("fundamentalEpsDetail",msg==="讀取中"?"讀取中…":"等待資料");
  setText("fundamentalRevenueDetail",msg==="讀取中"?"讀取中…":"等待資料");
  setText("fundamentalGrossDetail",msg==="讀取中"?"讀取中…":"等待資料");
  setText("fundamentalOperatingDetail",msg==="讀取中"?"讀取中…":"等待資料");
  setText("fundamentalSource","基本面來源待補");
  ["fundamentalCompanyCard","fundamentalContinuationCard","valuationPressureCard","valuationAttractivenessCard"].forEach(id=>{const el=$(id);if(el)delete el.dataset.tone});
  const chip=$("fundamentalOverviewChip");
  if(chip){chip.textContent=msg;chip.classList.remove("is-good","is-watch","is-weak");}
}
function fundamentalMainMargin(value){const x=valuationNum(value);return x===null?"--":`${x.toFixed(1)}%`}
function ppChangeText(delta){const x=valuationNum(delta);return x===null?"年變化待補":`年變化 ${x>=0?"+":""}${x.toFixed(1)}pp`}
function fundamentalScalar(v){
  if(v===null||v===undefined||v==="")return null;
  if(typeof v==="object"){
    for(const key of ["raw","value","number","amount"]){const n=fundamentalScalar(v?.[key]);if(n!==null)return n}
    if(typeof v?.fmt==="string"){const n=fundamentalScalar(v.fmt);if(n!==null)return n}
    return null;
  }
  if(typeof v==="string"){
    const s=v.replace(/,/g,"").trim(),pct=s.endsWith("%");
    const n=Number(pct?s.slice(0,-1):s);return Number.isFinite(n)?n:null;
  }
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function fundamentalMarginValue(row,kind,depth=0,seen=new Set()){
  if(!row||typeof row!=="object"||depth>3||seen.has(row))return null;
  seen.add(row);
  const isGross=kind==="gross";
  const directKeys=isGross
    ?["grossMargin","grossMargins","grossMarginPct","grossProfitMargin","grossProfitMargins","grossProfitMarginPct","gross_margin","gross_margins","gross_margin_pct"]
    :["operatingMargin","operatingMargins","operatingMarginPct","operatingProfitMargin","operatingProfitMargins","operatingProfitMarginPct","operating_margin","operating_margins","operating_margin_pct"];
  let zeroCandidate=false;
  for(const key of directKeys){
    const n=fundamentalScalar(row?.[key]);
    if(n===null)continue;
    const pct=Math.abs(n)<=1.5?n*100:n;
    const officialZero=row?.marginSource==="official"||row?.sourceType==="official"||row?.official===true;
    if(Math.abs(pct)<0.05&&!officialZero){zeroCandidate=true;continue}
    if(Number.isFinite(pct))return pct;
  }
  const revenue=fundamentalRevenueValue(row);
  const profitKeys=isGross
    ?["grossProfit","grossIncome","gross_profit","grossProfitAmount"]
    :["operatingIncome","operatingProfit","incomeFromOperations","operating_income","operating_profit","operatingIncomeLoss"];
  let profit=null;
  for(const key of profitKeys){const n=fundamentalScalar(row?.[key]);if(n!==null){profit=n;break}}
  if(revenue!==null&&revenue!==0&&profit!==null){
    const pct=profit/revenue*100;
    const officialZero=row?.marginSource==="official"||row?.sourceType==="official"||row?.official===true;
    if(Math.abs(pct)>=0.05||officialZero)return pct;
    zeroCandidate=true;
  }
  const preferred=["financialData","summaryDetail","defaultKeyStatistics","incomeStatement","incomeStatementHistory","quarterlyFinancials","financials"];
  for(const key of preferred){const child=row?.[key];if(child&&typeof child==="object"){const n=fundamentalMarginValue(child,kind,depth+1,seen);if(n!==null)return n}}
  // Exact 0 from Yahoo is often a placeholder for a missing margin. Do not present it as real 0.0% unless a future source explicitly marks it as valid.
  return zeroCandidate?null:null;
}
function fundamentalMarginFromSources(kind,...sources){for(const source of sources){const n=fundamentalMarginValue(source,kind);if(n!==null)return n}return null;}

function fundamentalComment(assessment){
  if(!assessment)return "基本面資料不足，暫時無法完成評語。";
  const company=assessment.companyQuality>=78?"公司本身體質強":assessment.companyQuality>=64?"公司本身不差":assessment.companyQuality>=50?"公司體質普通":"公司體質偏弱";
  const continuation=assessment.continuation>=76?"目前成長持續力高":assessment.continuation>=58?"目前成長仍有一定持續力":"目前成長持續力偏弱";
  const trend=assessment.trend?.label||"";
  let tail="";
  if(trend==="加速成長")tail="，而且成長動能仍在加速";
  else if(trend==="成長減速")tail="，但成長動能正在減速";
  else if(trend==="衰退改善")tail="，營運則正在改善";
  else if(trend==="持續衰退")tail="，目前仍處於衰退階段";
  if(assessment.risk?.label==="高")tail+="，基本面風險偏高";
  else if(assessment.risk?.label==="中")tail+="，仍有部分基本面風險需要留意";
  return `${company}，${continuation}${tail}。`;
}
function renderFundamentalOverview(){
  const host=$("fundamentalOverviewChip");
  if(!host) return;
  if(!latestFundamentalData){resetFundamentalOverview("資料待補");return}
  const fund=longQuantitativeFundamentals(latestValuationData||{}), assessment=buildFundamentalAssessment(fund,latestValuationData||{}), data=latestFundamentalData||{}, off=data?.officialStatement||null, monthly=data?.monthlyRevenue||null, latest=fund.latest||{};
  const chip=$("fundamentalOverviewChip");
  if(chip){
    chip.classList.remove("is-good","is-watch","is-weak");
    chip.textContent=assessment.companyQuality>=78?"營運強":assessment.companyQuality>=64?"營運佳":assessment.companyQuality>=50?"營運普通":"營運偏弱";
    chip.classList.add(assessment.companyQuality>=64?"is-good":assessment.companyQuality>=50?"is-watch":"is-weak");
  }
  setText("fundamentalEpsYoy", fund?.yoyEps?.available && Number.isFinite(fund?.yoyEps?.pct) ? signedPercent(fund.yoyEps.pct) : "--");
  setText("fundamentalEpsDetail", `QoQ ${fund?.qoqEps?.available && Number.isFinite(fund?.qoqEps?.pct) ? signedPercent(fund.qoqEps.pct) : "--"}${fund?.ttmPair?.available && Number.isFinite(fund?.ttmPair?.pct) ? `｜TTM ${signedPercent(fund.ttmPair.pct)}` : ""}`);

  const monthlyYoy=fundamentalMonthlyPct(monthly,"yoy"),monthlyCum=fundamentalMonthlyPct(monthly,"cumulative");
  const revenueMain = monthlyYoy!==null ? signedPercent(monthlyYoy) : (fund?.yoyRev?.available && Number.isFinite(fund?.yoyRev?.pct) ? signedPercent(fund.yoyRev.pct) : "--");
  const revenueDetail = monthlyYoy!==null
    ? `累計 YoY ${monthlyCum!==null ? signedPercent(monthlyCum) : "--"}${monthly?.period ? `｜${monthly.period}` : ""}`
    : (fund?.yoyRev?.available && Number.isFinite(fund?.yoyRev?.pct) ? `近4季 YoY 中位 ${fund?.revTrendPct !== null && Number.isFinite(fund?.revTrendPct) ? signedPercent(fund.revTrendPct) : "--"}` : "營收成長資料不足");
  setText("fundamentalRevenueYoy", revenueMain);
  setText("fundamentalRevenueDetail", revenueDetail);

  if(off?.marginApplicable===false){
    setText("fundamentalGrossMargin", "不適用");
    setText("fundamentalGrossDetail", `${off?.financialTypeLabel||"金融類"} 不看毛利率`);
    setText("fundamentalOperatingMargin", "不適用");
    setText("fundamentalOperatingDetail", `${off?.financialTypeLabel||"金融類"} 不看營益率`);
  }else{
    const grossOfficial=fundamentalMarginValue(off,"gross"), opOfficial=fundamentalMarginValue(off,"operating"), grossLatest=fundamentalMarginValue(latest,"gross"), opLatest=fundamentalMarginValue(latest,"operating"), grossYearAgo=fundamentalMarginValue((fund?.rows||[])[4],"gross"), opYearAgo=fundamentalMarginValue((fund?.rows||[])[4],"operating");
    const grossNow = fundamentalMarginFromSources("gross",off,latest,data?.financialData);
    const opNow = fundamentalMarginFromSources("operating",off,latest,data?.financialData);
    const grossDelta = grossNow!==null && grossYearAgo!==null ? grossNow-grossYearAgo : null;
    const opDelta = opNow!==null && opYearAgo!==null ? opNow-opYearAgo : null;
    setText("fundamentalGrossMargin", fundamentalMainMargin(grossNow));
    setText("fundamentalGrossDetail", grossNow===null ? "毛利率資料不足" : `${ppChangeText(grossDelta)}${off?.period ? `｜${off.period}` : (latest?.period ? `｜${latest.period}` : "")}`);
    setText("fundamentalOperatingMargin", fundamentalMainMargin(opNow));
    setText("fundamentalOperatingDetail", opNow===null ? "營益率資料不足" : `${ppChangeText(opDelta)}${off?.period ? `｜${off.period}` : (latest?.period ? `｜${latest.period}` : "")}`);
  }
  const signalTone=(id,tone)=>{const el=$(id)?.closest?.(".fundamental-signal");if(el)el.dataset.tone=tone||""};
  const cardTone=(id,tone)=>{const el=$(id);if(el)el.dataset.tone=tone||""};
  const scoreTone=n=>n>=70?"good":n>=50?"watch":"bad";
  setText("fundamentalCompanyQuality",`${assessment.companyQuality} / 100`);setText("fundamentalCompanyQualityNote",assessment.companyQuality>=78?"公司體質強":assessment.companyQuality>=64?"公司體質中上":assessment.companyQuality>=50?"公司體質普通":"公司體質偏弱");signalTone("fundamentalCompanyQuality",scoreTone(assessment.companyQuality));
  setText("fundamentalContinuation",`${assessment.continuation} / 100`);setText("fundamentalContinuationNote",assessment.continuation>=76?"持續力高":assessment.continuation>=58?"持續力中":"持續力偏弱");signalTone("fundamentalContinuation",scoreTone(assessment.continuation));
  setText("fundamentalGrowthStrength",`${assessment.growthStrength} / 100`);setText("fundamentalGrowthStrengthNote",assessment.growthStrength>=78?"成長強勁":assessment.growthStrength>=64?"成長良好":assessment.growthStrength>=50?"成長普通":"成長偏弱");signalTone("fundamentalGrowthStrength",scoreTone(assessment.growthStrength));
  setText("fundamentalGrowthTrend",assessment.trend.label);setText("fundamentalGrowthTrendNote",assessment.trend.note);signalTone("fundamentalGrowthTrend",assessment.trend.score>=70?"good":assessment.trend.score>=50?"watch":"bad");
  setText("fundamentalProfitQuality",`${assessment.profitQuality.score} / 100`);setText("fundamentalProfitQualityNote",assessment.profitQuality.label);signalTone("fundamentalProfitQuality",scoreTone(assessment.profitQuality.score));
  setText("fundamentalStabilityScore",`${assessment.stability.score} / 100`);setText("fundamentalStabilityScoreNote",assessment.stability.label);signalTone("fundamentalStabilityScore",scoreTone(assessment.stability.score));
  setText("fundamentalRisk",`${assessment.risk.label}風險`);setText("fundamentalRiskNote",assessment.risk.note);signalTone("fundamentalRisk",assessment.risk.tone);
  setText("fundamentalConfidence",`${assessment.dataConfidence}%`);setText("fundamentalConfidenceNote",`營運 ${assessment.operationalConfidence}%｜估值 ${assessment.valuation.confidence}%`);signalTone("fundamentalConfidence",assessment.dataConfidence>=75?"good":assessment.dataConfidence>=55?"watch":"bad");
  setText("fundamentalValuationPressure",`${assessment.valuation.pressureLabel}壓力`);setText("fundamentalValuationPressureNote",assessment.valuation.state||"估值資料不足");cardTone("valuationPressureCard",assessment.valuation.pressureLabel==="低"?"good":assessment.valuation.pressureLabel==="中"?"watch":"bad");
  setText("fundamentalPriceAttractiveness",`${assessment.priceAttractiveness} / 100`);setText("fundamentalPriceAttractivenessNote",assessment.priceAttractiveness>=70?"目前價格具吸引力":assessment.priceAttractiveness>=50?"目前價格吸引力普通":"目前價格吸引力偏低");cardTone("valuationAttractivenessCard",scoreTone(assessment.priceAttractiveness));
  setText("fundamentalStability",fundamentalComment(assessment));
  setText("fundamentalSource", fund?.sourceText || "基本面來源待補");
}

function stageNum(v){const n=Number(v);return Number.isFinite(n)?n:null}
function stagePct(price,base){const p=stageNum(price),b=stageNum(base);return p!==null&&b!==null&&b!==0?(p/b-1)*100:null}
function stageFmtPct(v){const n=stageNum(v);return n===null?"--":`${n>=0?"+":""}${n.toFixed(1)}%`}
function stageClamp(n,min,max){return Math.max(min,Math.min(max,n))}
function stageHistory(t){return (Array.isArray(t?.history)?t.history:[]).filter(x=>stageNum(x?.close)!==null).slice(-180)}
function stageSmaAt(rows,n,end=rows.length){if(end<n)return null;let s=0,c=0;for(let i=end-n;i<end;i++){const v=stageNum(rows[i]?.close);if(v===null)return null;s+=v;c++}return c===n?s/n:null}
function stageRet(rows,n,current=null){if(rows.length<=n)return null;const p=current??stageNum(rows.at(-1)?.close),b=stageNum(rows.at(-1-n)?.close);return stagePct(p,b)}
function stageHigh(rows,n){const a=rows.slice(-n).map(x=>stageNum(x?.high)??stageNum(x?.close)).filter(Number.isFinite);return a.length?Math.max(...a):null}
function stageLow(rows,n){const a=rows.slice(-n).map(x=>stageNum(x?.low)??stageNum(x?.close)).filter(Number.isFinite);return a.length?Math.min(...a):null}
function stageMaSlope(rows,n,lookback){const now=stageSmaAt(rows,n),before=stageSmaAt(rows,n,Math.max(n,rows.length-lookback));return now!==null&&before!==null?stagePct(now,before):null}
function stageAboveMaRatio(rows,window=60,n=20){const a=rows.slice(-window);let hit=0,total=0;const offset=rows.length-a.length;for(let j=0;j<a.length;j++){const i=offset+j,end=i+1;if(end<n)continue;const ma=stageSmaAt(rows,n,end),c=stageNum(rows[i]?.close);if(ma===null||c===null)continue;total++;if(c>=ma)hit++}return total?hit/total:null}
function stageMaxRollingBias(rows,window=60,n=20){let best=null;const from=Math.max(n-1,rows.length-window);for(let i=from;i<rows.length;i++){const ma=stageSmaAt(rows,n,i+1),c=stageNum(rows[i]?.close);const x=stagePct(c,ma);if(x!==null&&(best===null||x>best))best=x}return best}
function stageMaxRollingReturn(rows,window=60,n=20){let best=null;const from=Math.max(n,rows.length-window);for(let i=from;i<rows.length;i++){const c=stageNum(rows[i]?.close),b=stageNum(rows[i-n]?.close),x=stagePct(c,b);if(x!==null&&(best===null||x>best))best=x}return best}
function buildStagePath(t,p,ma5,ma10,ma20,ma60){
  const rows=stageHistory(t),high60=stageHigh(rows,60),low60=stageLow(rows,60),high120=stageHigh(rows,120),low120=stageLow(rows,120);
  const ret20=stageRet(rows,20,p),ret60=stageRet(rows,60,p),ret120=stageRet(rows,Math.min(119,rows.length-1),p);
  const ma20Slope10=stageMaSlope(rows,20,10),ma20Slope20=stageMaSlope(rows,20,20),ma60Slope20=stageMaSlope(rows,60,20);
  const maVals=[ma5,ma10,ma20].filter(Number.isFinite),maSpreadPct=maVals.length>=2&&ma20?stagePct(Math.max(...maVals),Math.min(...maVals)):null;
  return {rows,ret20,ret60,ret120,high60,low60,high120,low120,fromHigh60:stagePct(p,high60),fromHigh120:stagePct(p,high120),fromLow60:stagePct(p,low60),fromLow120:stagePct(p,low120),ma20Slope10,ma20Slope20,ma60Slope20,maSpreadPct:maSpreadPct===null?null:Math.abs(maSpreadPct),above20Ratio20:stageAboveMaRatio(rows,20,20),above20Ratio60:stageAboveMaRatio(rows,60,20),maxBias20_60:stageMaxRollingBias(rows,60,20),maxRet20_60:stageMaxRollingReturn(rows,60,20)};
}
function calculateFiveStage(t,currentPrice){
  const p=[currentPrice,t?.price,t?.last,t?.close,t?.latest?.close].map(stageNum).find(x=>x!==null)??null;
  const ma5=stageNum(t?.ma?.ma5),ma10=stageNum(t?.ma?.ma10),ma20=stageNum(t?.ma?.ma20),ma60=stageNum(t?.ma?.ma60);
  if(p===null||ma20===null)return null;
  const upper=stageNum(t?.bollinger?.upper),lower=stageNum(t?.bollinger?.lower),bandwidth=stageNum(t?.bollinger?.bandwidth),rsi=stageNum(t?.momentum?.rsi14),hist=stageNum(t?.momentum?.histogram),macd=stageNum(t?.momentum?.macd),signal=stageNum(t?.momentum?.signal);
  const ratio20=stageNum(t?.volume?.ratio20),dirIndex=Number(latestTechnicalDirection?.index)||0,bias20=stageNum(t?.bias?.ma20)??stagePct(p,ma20),bias5=stageNum(t?.bias?.ma5)??stagePct(p,ma5);
  const path=buildStagePath(t,p,ma5,ma10,ma20,ma60),above20=p>=ma20,above60=ma60===null?null:p>=ma60,shortBull=ma5!==null&&ma10!==null&&ma5>=ma10,bullOrder=shortBull&&ma10!==null&&ma10>=ma20&&(ma60===null||ma20>=ma60),macdBull=hist!==null?hist>=0:(macd!==null&&signal!==null?macd>=signal:false),nearUpper=upper!==null&&p>=upper*.985,aboveUpper=upper!==null&&p>=upper;

  // 「生命週期重置」：曾經主升過不代表永遠保留高階段。大幅回撤＋中長均線轉弱＋長期在線下，才重新視為築底。
  let resetScore=0;
  if(ma60!==null&&p<ma60*.98)resetScore++;
  if(path.ma60Slope20!==null&&path.ma60Slope20<=-2)resetScore++;
  if(path.fromHigh120!==null&&path.fromHigh120<=-35)resetScore++;
  if(path.above20Ratio60!==null&&path.above20Ratio60<=.35)resetScore++;
  if(ma60!==null&&ma20<ma60&&(path.ma20Slope10??0)<=0)resetScore++;
  const lifecycleReset=resetScore>=3&&(path.fromHigh120===null||path.fromHigh120<=-20);

  // 近期是否曾經真正發動：用歷史最大乖離／20日漲幅記住「走過的路」，避免回測時瞬間掉回第1階段。
  const priorAcceleration=(path.maxBias20_60!==null&&path.maxBias20_60>=10)||(path.maxRet20_60!==null&&path.maxRet20_60>=15)||(path.ret60!==null&&path.ret60>=15);
  const longTrendUp=(path.ma60Slope20!==null?path.ma60Slope20>0.5:(ma60!==null&&p>=ma60));
  const midTrendUp=(path.ma20Slope10!==null?path.ma20Slope10>0.5:above20);
  const tangled=(path.maSpreadPct!==null&&path.maSpreadPct<=4)&&Math.abs(path.ma20Slope10??0)<=1.5;

  // 第5階段必須是「多個過熱證據共振」，不再因單一 20MA 乖離 >15% 就直接判噴太遠。
  const heatFlags=[bias20!==null&&bias20>=15,rsi!==null&&rsi>=78,aboveUpper||(nearUpper&&bias20!==null&&bias20>=10),path.fromHigh60!==null&&path.fromHigh60>=-2,path.ret20!==null&&path.ret20>=20,ratio20!==null&&ratio20>=1.5].filter(Boolean).length;
  const extremeHeat=(rsi!==null&&rsi>=80&&heatFlags>=3)||(bias20!==null&&bias20>=25&&heatFlags>=3)||heatFlags>=5;

  const accelerationFlags=[path.ret20!==null&&path.ret20>=10,bias20!==null&&bias20>=6,nearUpper,bullOrder,dirIndex>=35,rsi!==null&&rsi>=60].filter(Boolean).length;
  const acceleratingNow=above20&&(above60!==false)&&midTrendUp&&accelerationFlags>=3;
  const recentAccelerationPullback=priorAcceleration&&(path.fromHigh60===null||path.fromHigh60>=-15)&&(above60!==false)&&p>=ma20*.98&&longTrendUp&&((path.maxRet20_60??0)>=22||(path.maxBias20_60??0)>=14);
  const trendPullback=priorAcceleration&&!lifecycleReset&&(above60!==false)&&longTrendUp&&(path.fromHigh60===null||(path.fromHigh60<=-6&&path.fromHigh60>=-28))&&(ma60===null||p>=ma60*.98);
  const normalTrend=above20&&(above60!==false)&&midTrendUp&&(longTrendUp||bullOrder)&&(bullOrder||shortBull||macdBull||dirIndex>=18);
  const repairState=!lifecycleReset&&((p>=ma20*.97&&(macdBull||(rsi!==null&&rsi>=45)))||(priorAcceleration&&(path.fromHigh120===null||path.fromHigh120>-35)&&(ma60===null||p>=ma60*.94||(path.ma60Slope20??-99)>=-1.5)));

  let stage=1;
  if(extremeHeat&&!lifecycleReset)stage=5;
  else if((acceleratingNow||recentAccelerationPullback)&&!lifecycleReset)stage=4;
  else if((normalTrend||trendPullback)&&!lifecycleReset)stage=3;
  else if(repairState)stage=2;

  let name,substate,summary;
  if(stage===1){name="築底整理";substate=lifecycleReset&&tangled?"築底修復":bandwidth!==null&&bandwidth<=14?"低檔收斂":"線下整理";summary=lifecycleReset?"先前趨勢已明顯重置，目前屬低檔整理／修復，等待重新站回中期均線與突破整理區。":"中期趨勢尚未建立，先以築底整理看待。"}
  if(stage===2){name="轉強修復";substate=above20&&tangled?"箱型轉強確認":!above20&&priorAcceleration?"回測修復":above20&&macdBull?"剛站回確認":"轉強確認";summary=substate==="箱型轉強確認"?"股價回到中期均線上方，但均線仍糾結／斜率不足，先等箱型壓力突破。":substate==="回測修復"?"先前有發動紀錄，但目前仍在中期均線下方修復，需重新站回後才算真正轉強。":"結構正在修復，已接近轉強，但仍需均線與動能進一步確認。"}
  if(stage===3){name="趨勢爬坡";substate=!above20||((path.fromHigh60??0)<=-8&&priorAcceleration)?"主升後回測":bullOrder?"穩定爬坡":"趨勢爬坡";summary=substate==="主升後回測"?"中長期趨勢仍保留，但短線正在消化前一段漲幅；回測完成前不視為新的加速段。":"中短期趨勢向上，屬正常爬坡結構。"}
  if(stage===4){name="主升加速";const pullback=(path.fromHigh60??0)<=-6&&(rsi===null||rsi<60||!macdBull);substate=pullback?"加速後回測":priorAcceleration&&(path.ret20??0)>=8?"再發動":"主升加速";summary=substate==="加速後回測"?"先前已進入明顯加速段，目前回到中期支撐附近消化過熱，主結構尚未被破壞。":substate==="再發動"?"先前已有發動紀錄，整理後再次轉強，屬主升段中的再發動。":"趨勢進入加速區，追價風險同步提高。"}
  if(stage===5){name="高檔過熱";substate=(rsi!==null&&rsi>=85)||(bias20!==null&&bias20>=25)?"極度過熱":"噴太遠";summary="乖離、動能、布林位置與近期漲幅出現多項過熱共振，優先等回測，不把『短線太熱』直接改判成長期。"}

  const signals=[];
  if(bias20!==null)signals.push(`20MA乖離 ${stageFmtPct(bias20)}`);
  if(path.fromHigh60!==null)signals.push(`距60日高 ${stageFmtPct(path.fromHigh60)}`);
  if(path.ma60Slope20!==null)signals.push(`MA60斜率 ${stageFmtPct(path.ma60Slope20)}`);
  if(path.ret20!==null)signals.push(`20日 ${stageFmtPct(path.ret20)}`);
  if(rsi!==null)signals.push(`RSI ${rsi.toFixed(1)}`);
  return {stage,name,substate,summary,signals:signals.slice(0,4),bias20,bias5,price:p,path,flags:{lifecycleReset,priorAcceleration,tangled,extremeHeat,macdBull,bullOrder,above20,above60}};
}
function resetFiveStage(note="搜尋股票後判讀"){
  const card=$("stagePositionCard");
  if(card){card.classList.remove("stage-1","stage-2","stage-3","stage-4","stage-5");card.style.setProperty("--stage-progress","0%");card.querySelectorAll("[data-stage]").forEach(x=>x.classList.remove("active","done"));}
  const fill=$("stageProgressFill");if(fill)fill.style.width="0%";
  const ov=$("overviewStageState");if(ov){ov.classList.remove("stage-1","stage-2","stage-3","stage-4","stage-5");ov.textContent="--"}
  setText("overviewStageNote","查看目前位置");setText("stageTitle","--");setText("stageSummary",note);setText("stageSignals","--");
  latestFiveStageResult=null;latestTechnicalForPlay=null;resetPlayStyle(note);
}
function renderFiveStage(t,currentPrice){
  const r=calculateFiveStage(t,currentPrice);if(!r){resetFiveStage("技術資料不足，暫無法判讀");return}
  const pct=`${Math.max(0,Math.min(100,(r.stage-1)*25))}%`,card=$("stagePositionCard");
  if(card){card.classList.remove("stage-1","stage-2","stage-3","stage-4","stage-5");card.classList.add(`stage-${r.stage}`);card.style.setProperty("--stage-progress",pct);card.querySelectorAll("[data-stage]").forEach(x=>{const n=Number(x.dataset.stage);x.classList.toggle("active",n===r.stage);x.classList.toggle("done",n<=r.stage);});}
  const fill=$("stageProgressFill");if(fill)fill.style.width=pct;
  const ov=$("overviewStageState");if(ov){ov.classList.remove("stage-1","stage-2","stage-3","stage-4","stage-5");ov.classList.add(`stage-${r.stage}`);ov.textContent=r.name;}
  setText("overviewStageNote",`第${r.stage}階段｜${r.substate}`);setText("stageTitle",`${r.stage}. ${r.name}｜${r.substate}`);setText("stageSummary",r.summary);setText("stageSignals",r.signals.join("｜"));
  latestFiveStageResult=r;latestTechnicalForPlay=t;refreshTechnicalDirectionAfterStage(r);
  try{renderPlayStyle()}catch(e){console.warn("玩法／長期基本面渲染失敗，不影響技術與五階段",e);resetPlayStyle("玩法計算暫時失敗");latestFiveStageResult=r;latestTechnicalForPlay=t}
}

// 建議玩法 v5：先辨識股性節奏，再用資格制＋短線專屬引擎比較短期／波段。
// 這版補兩個防呆：① 假突破確認 ② 箱型反覆濾網；避免單日突破就判短線，也避免盤整區來回切玩法。
function playClamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0))}
function playFitLabel(n){return n>=78?"高":n>=58?"中高":n>=42?"中":"低"}
function playValuationResult(){const x=latestValuationScenario;if(!x)return null;return scenarioClassify(x.P,x.O,x.B,x.F,currentTargetPrice())}
function playRowClose(x){return stageNum(x?.close)}
function playRowHigh(x){return stageNum(x?.high)??playRowClose(x)}
function playRowVolume(x){return stageNum(x?.volume)}
function playPriorHigh(rows,index,lookback=20){const a=rows.slice(Math.max(0,index-lookback),index).map(playRowHigh).filter(Number.isFinite);return a.length?Math.max(...a):null}
function playAvgVolume(rows,index,lookback=20){const a=rows.slice(Math.max(0,index-lookback),index).map(playRowVolume).filter(x=>Number.isFinite(x)&&x>0);return a.length>=Math.min(10,lookback)?a.reduce((x,y)=>x+y,0)/a.length:null}
function playMaCrossCount(rows,window=20,n=20){
  const from=Math.max(n-1,rows.length-window),states=[];
  for(let i=from;i<rows.length;i++){
    const ma=stageSmaAt(rows,n,i+1),c=playRowClose(rows[i]);if(ma===null||c===null)continue;
    const d=stagePct(c,ma);if(d===null||Math.abs(d)<.6)states.push(0);else states.push(d>0?1:-1);
  }
  let prev=0,count=0;for(const x of states){if(!x)continue;if(prev&&x!==prev)count++;prev=x}return count;
}
function playBreakoutState(r,t){
  const rows=r?.path?.rows||[];if(rows.length<25)return {fresh:false,confirmed:false,failed:false,age:null,level:null,volumeRatio:null,margin:null};
  const from=Math.max(20,rows.length-5);let hit=null;
  for(let i=from;i<rows.length;i++){
    const c=playRowClose(rows[i]),level=playPriorHigh(rows,i,20);if(c===null||level===null)continue;
    const margin=stagePct(c,level);if(margin!==null&&margin>=.3){hit={i,c,level,margin};break}
  }
  if(!hit)return {fresh:false,confirmed:false,failed:false,age:null,level:null,volumeRatio:null,margin:null};
  const after=rows.slice(hit.i).map(playRowClose).filter(Number.isFinite),current=after.at(-1),avgV=playAvgVolume(rows,hit.i,20),v=playRowVolume(rows[hit.i]);
  const volumeRatio=avgV&&v? v/avgV : stageNum(t?.volume?.ratio20),age=rows.length-1-hit.i;
  const held=after.every(x=>x>=hit.level*.98),twoCloses=after.filter(x=>x>=hit.level*.995).length>=2;
  const strongDay=hit.margin>=1.5&&(volumeRatio===null||volumeRatio>=1.3)&&current>=hit.level*1.005;
  const confirmed=!((current??0)<hit.level*.985)&&held&&(twoCloses||strongDay);
  const failed=(current??0)<hit.level*.985||after.slice(1).some(x=>x<hit.level*.97);
  return {fresh:true,confirmed,failed,age,level:hit.level,volumeRatio,margin:hit.margin};
}

// 波段基礎工具：保留舊版局部高低點／回測辨識，作為多波 Pivot 樣本不足時的容錯。
// v2.6.0.2 起，主要波段結構由完整多波 Pivot 引擎負責。
function swingLow(x){return stageNum(x?.low)??playRowClose(x)}
function swingHigh(x){return stageNum(x?.high)??playRowClose(x)}
function swingDate(x){return String(x?.date||x?.tradeDate||x?.datetime||"").slice(0,10)}
function swingRangeMin(rows,from,to,getter){
  let v=null,idx=-1;
  for(let i=Math.max(0,from);i<Math.min(rows.length,to);i++){
    const n=getter(rows[i]);if(n===null)continue;
    if(v===null||n<v){v=n;idx=i}
  }
  return {value:v,index:idx};
}
function swingRangeMax(rows,from,to,getter){
  let v=null,idx=-1;
  for(let i=Math.max(0,from);i<Math.min(rows.length,to);i++){
    const n=getter(rows[i]);if(n===null)continue;
    if(v===null||n>v){v=n;idx=i}
  }
  return {value:v,index:idx};
}
function swingIsLocalHigh(rows,i,w=2){
  const h=swingHigh(rows[i]);if(h===null)return false;
  for(let j=Math.max(0,i-w);j<=Math.min(rows.length-1,i+w);j++){if(j!==i&&(swingHigh(rows[j])??-Infinity)>h)return false}
  return true;
}
function swingIsLocalLow(rows,i,w=2){
  const l=swingLow(rows[i]);if(l===null)return false;
  for(let j=Math.max(0,i-w);j<=Math.min(rows.length-1,i+w);j++){if(j!==i&&(swingLow(rows[j])??Infinity)<l)return false}
  return true;
}
function swingFindPullback(rows,highIndex,highValue,{maxBars=28,minDrop=2.5,minRebound=3,reboundBars=8}={}){
  const end=Math.min(rows.length,highIndex+1+maxBars);let pending=null;
  for(let i=highIndex+2;i<end;i++){
    if(!swingIsLocalLow(rows,i,2))continue;
    const low=swingLow(rows[i]);if(low===null)continue;
    const drop=stagePct(low,highValue);if(drop===null||drop>-minDrop)continue;
    const reboundInfo=swingRangeMax(rows,i+1,Math.min(rows.length,i+1+reboundBars),swingHigh);
    const rebound=reboundInfo.value===null?null:stagePct(reboundInfo.value,low);
    const item={low,index:i,dropPct:drop,reboundPct:rebound,confirmed:rebound!==null&&rebound>=minRebound};
    if(item.confirmed)return item;
    if(!pending||low<pending.low)pending=item;
  }
  // 若資料尾端正在回測，保留暫定低點，但不視為完成。
  if(pending&&pending.index>=rows.length-4)return pending;
  return null;
}
function swingHasCompletedPullbackBetween(rows,lowIndex,highIndex){
  for(let hi=lowIndex+3;hi<highIndex-2;hi++){
    if(!swingIsLocalHigh(rows,hi,2))continue;
    const high=swingHigh(rows[hi]),base=swingLow(rows[lowIndex]);if(high===null||base===null)continue;
    const rise=stagePct(high,base);if(rise===null||rise<6)continue;
    const pb=swingFindPullback(rows,hi,high,{maxBars:Math.max(3,Math.min(24,highIndex-hi)),minDrop:2.5,minRebound:3,reboundBars:7});
    if(pb?.confirmed&&pb.index<highIndex)return true;
  }
  return false;
}
function swingFindCompletedNextWave(rows,fromIndex,fromLow){
  for(let hi=fromIndex+3;hi<rows.length-3;hi++){
    if(!swingIsLocalHigh(rows,hi,2))continue;
    const high=swingHigh(rows[hi]);if(high===null)continue;
    const rise=stagePct(high,fromLow);if(rise===null||rise<6||rise>140)continue;
    const pb=swingFindPullback(rows,hi,high,{maxBars:24,minDrop:2.5,minRebound:3,reboundBars:7});
    if(pb?.confirmed)return {high,highIndex:hi,risePct:rise,pullbackLow:pb.low,pullbackIndex:pb.index,pullbackPct:pb.dropPct};
  }
  return null;
}

// v2.6.0.2 — 多波 Pivot 結構：以動態波動閾值建立低/高交替 pivot，
// 深回或跌破前波起點時自動結束舊結構並從新低點重算；最多保留近期 4 個推進波供畫面與決策使用。
function swingPivotMedian(values){
  const a=(values||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function swingPivotThreshold(rows){
  const ranges=[];
  for(let i=1;i<(rows||[]).length;i++){
    const h=swingHigh(rows[i]),l=swingLow(rows[i]),pc=playRowClose(rows[i-1]);
    if(h===null||l===null||pc===null||pc<=0)continue;ranges.push((h-l)/pc*100);
  }
  const med=swingPivotMedian(ranges)??2.2;return stageClamp(med*1.35,2.5,6.0);
}
function swingBuildPivots(rows,thresholdPct){
  const a=rows||[];if(a.length<12)return [];
  let trend=0,scanLow=null,scanLowI=-1,scanHigh=null,scanHighI=-1,ext=null,extI=-1;const out=[];
  const add=(i,p,type,open=false)=>{if(i<0||!Number.isFinite(p))return;const prev=out.at(-1);if(prev?.type===type){const replace=type==="low"?p<prev.p:p>prev.p;if(replace)out[out.length-1]={i,p,type,open};return}out.push({i,p,type,open})};
  for(let i=0;i<a.length;i++){
    const low=swingLow(a[i]),high=swingHigh(a[i]);if(low===null||high===null)continue;
    if(scanLow===null||low<scanLow){scanLow=low;scanLowI=i}if(scanHigh===null||high>scanHigh){scanHigh=high;scanHighI=i}
    if(trend===0){
      const up=scanLow>0?(high/scanLow-1)*100:null,down=scanHigh>0?(low/scanHigh-1)*100:null;
      if(up!==null&&up>=thresholdPct){add(scanLowI,scanLow,"low");trend=1;ext=high;extI=i;scanHigh=high;scanHighI=i}
      else if(down!==null&&down<=-thresholdPct){add(scanHighI,scanHigh,"high");trend=-1;ext=low;extI=i;scanLow=low;scanLowI=i}
      continue;
    }
    if(trend===1){
      if(ext===null||high>=ext){ext=high;extI=i}
      const rev=ext>0?(low/ext-1)*100:null;
      if(rev!==null&&rev<=-thresholdPct){add(extI,ext,"high");trend=-1;ext=low;extI=i;scanLow=low;scanLowI=i;scanHigh=high;scanHighI=i}
    }else{
      if(ext===null||low<=ext){ext=low;extI=i}
      const rev=ext>0?(high/ext-1)*100:null;
      if(rev!==null&&rev>=thresholdPct){add(extI,ext,"low");trend=1;ext=high;extI=i;scanHigh=high;scanHighI=i;scanLow=low;scanLowI=i}
    }
  }
  if(extI>=0){if(trend===1)add(extI,ext,"high",true);else if(trend===-1)add(extI,ext,"low",true)}
  return out;
}
function swingBuildMultiStructure(rows,price){
  const threshold=swingPivotThreshold(rows),pivots=swingBuildPivots(rows,threshold);if(pivots.length<2)return {valid:false,threshold,pivots,reason:"多波 Pivot 尚未形成"};
  let start=pivots.findIndex(x=>x.type==="low");if(start<0)return {valid:false,threshold,pivots,reason:"近期找不到有效起漲低點"};
  let legs=[],resets=[],i=start,guard=0;
  while(i<pivots.length-1&&guard++<40){
    const low=pivots[i];if(low?.type!=="low"){i++;continue}
    const high=pivots[i+1];if(high?.type!=="high"){i++;continue}
    const risePct=stagePct(high.p,low.p),amp=high.p-low.p;if(!(amp>0)||risePct===null||risePct<Math.max(4.5,threshold*.85)){i+=2;continue}
    const nextLow=pivots[i+2]?.type==="low"?pivots[i+2]:null;
    let pullbackPct=null,retracePct=null,reset=false,resetReason="";
    if(nextLow){
      pullbackPct=stagePct(nextLow.p,high.p);retracePct=(high.p-nextLow.p)/amp*100;
      const brokeBase=nextLow.p<low.p*.99,deep=Number.isFinite(retracePct)&&retracePct>70;
      reset=brokeBase||deep;if(reset)resetReason=brokeBase?"跌破前波起點":"回吐超過 70%";
    }
    if(reset&&nextLow){
      resets.push({fromLow:low.p,high:high.p,newBase:nextLow.p,index:nextLow.i,date:swingDate(rows[nextLow.i]),reason:resetReason,retracePct});legs=[];i+=2;continue;
    }
    const prevHigh=legs.at(-1)?.high??null;
    legs.push({number:legs.length+1,low:low.p,lowIndex:low.i,lowDate:swingDate(rows[low.i]),high:high.p,highIndex:high.i,highDate:swingDate(rows[high.i]),risePct,amplitude:amp,highOpen:!!high.open,pullbackLow:nextLow?.p??null,pullbackIndex:nextLow?.i??-1,pullbackDate:nextLow?swingDate(rows[nextLow.i]):"",pullbackOpen:!!nextLow?.open,pullbackPct,retracePct,higherHigh:prevHigh===null?null:high.p>=prevHigh*.985});
    if(!nextLow)break;i+=2;
  }
  if(!legs.length)return {valid:false,threshold,pivots,resets,reason:"舊波已重置，新推進波尚未形成"};
  // 若結構很長，只保留完整計數，但繪圖使用最近四波；起始第一波仍保留給 X 倍率基準。
  const first=legs[0],last=legs.at(-1),completedPullbacks=legs.filter(x=>Number.isFinite(x.pullbackLow)),lastPullback=completedPullbacks.at(-1)?.pullbackLow??null;
  let activeWave=last.pullbackLow!==null?last.number+1:last.number;
  if(last.highOpen)activeWave=last.number;
  const activeDefenseLow=last.pullbackLow??last.low??lastPullback??first.low;
  const referenceHigh=last.pullbackLow!==null?last.high:(legs.length>1?(legs.at(-2)?.high??first.high):first.high);
  const recentReset=resets.at(-1)||null,resetAge=recentReset?rows.length-1-recentReset.index:null;
  const higherHighs=legs.slice(1).filter(x=>x.higherHigh===true).length,lowerHighs=legs.slice(1).filter(x=>x.higherHigh===false).length,
        healthyPullbacks=legs.filter(x=>Number.isFinite(x.retracePct)&&x.retracePct>=18&&x.retracePct<=70).length;
  let qualityAdj=Math.min(10,(legs.length-1)*3)+Math.min(6,higherHighs*2)+Math.min(6,healthyPullbacks*2)-Math.min(10,lowerHighs*4);
  if(price<activeDefenseLow*.98)qualityAdj-=18;if(resetAge!==null&&resetAge<=12)qualityAdj+=2;
  let phase,state;
  if(last.pullbackLow!==null&&last.pullbackOpen){phase=`第${last.number}波回測中`;state=`等待第${last.number+1}波確認`}
  else if(last.highOpen){phase=`第${last.number}波進行中`;state=last.number>=3?`多波延伸・第${last.number}波`:`第${last.number}波推進`}
  else if(last.pullbackLow!==null){phase=`第${last.number}波回測完成`;state=`等待第${last.number+1}波`}
  else{phase=`第${last.number}波形成中`;state=`第${last.number}波形成中`}
  return {valid:true,threshold,pivots,legs,resets,waveCount:legs.length,activeWave,activeDefenseLow,referenceHigh,phase,state,qualityAdj,recentReset,resetAge,higherHighs,lowerHighs,healthyPullbacks};
}

function calculateSwingWave(r,t,breakout=playBreakoutState(r,t)){
  const rows=(r?.path?.rows||stageHistory(t)).slice(-120),price=stageNum(r?.price);
  if(rows.length<25||price===null)return {valid:false,reason:"歷史K線不足"};
  const multi=swingBuildMultiStructure(rows,price);let chosen=null,second=null;

  if(multi?.valid&&multi.legs?.length){
    const a=multi.legs[0],b=multi.legs[1];
    chosen={low:a.low,lowIndex:a.lowIndex,high:a.high,highIndex:a.highIndex,gain:a.risePct,pullback:a.pullbackPct,completed:Number.isFinite(a.pullbackLow)&&!a.pullbackOpen,pullbackLow:a.pullbackLow,pullbackIndex:a.pullbackIndex};
    if(b)second={high:b.high,highIndex:b.highIndex,risePct:b.risePct,pullbackLow:b.pullbackLow,pullbackIndex:b.pullbackIndex,pullbackPct:b.pullbackPct};
  }else{
    const candidates=[];
    // Pivot 尚不足時沿用舊版找法作容錯，避免剛起漲股票整張卡直接失效。
    for(let hi=12;hi<rows.length-2;hi++){
      if(!swingIsLocalHigh(rows,hi,2))continue;const high=swingHigh(rows[hi]);if(high===null)continue;
      const lowInfo=swingRangeMin(rows,Math.max(0,hi-35),hi-2,swingLow),low=lowInfo.value;if(low===null||lowInfo.index<0)continue;
      const gain=stagePct(high,low);if(gain===null||gain<6||gain>120)continue;if(swingHasCompletedPullbackBetween(rows,lowInfo.index,hi))continue;
      const pb=swingFindPullback(rows,hi,high);if(!pb)continue;const age=rows.length-1-hi,score=Math.min(gain,80)+(pb.confirmed?12:3)+Math.max(0,10-age*.12)-Math.max(0,age-85)*.45;
      const candidate={low,lowIndex:lowInfo.index,high,highIndex:hi,gain,pullback:pb.dropPct,completed:pb.confirmed,pullbackLow:pb.low,pullbackIndex:pb.index,score};candidate.secondCandidate=pb.confirmed?swingFindCompletedNextWave(rows,pb.index,pb.low):null;candidate.chainDepth=1+(candidate.secondCandidate?1:0);candidates.push(candidate);
    }
    chosen=candidates.sort((a,b)=>b.chainDepth-a.chainDepth||b.score-a.score||a.highIndex-b.highIndex)[0]||null;
    if(!chosen){
      const hiInfo=swingRangeMax(rows,Math.max(8,rows.length-20),rows.length,swingHigh);
      if(hiInfo.index>5){const lowInfo=swingRangeMin(rows,Math.max(0,hiInfo.index-35),hiInfo.index-2,swingLow),gain=lowInfo.value!==null&&hiInfo.value!==null?stagePct(hiInfo.value,lowInfo.value):null;if(gain!==null&&gain>=6&&gain<=120)chosen={low:lowInfo.value,lowIndex:lowInfo.index,high:hiInfo.value,highIndex:hiInfo.index,gain,pullback:null,completed:false,pullbackLow:null,pullbackIndex:-1}}
    }
    if(chosen)second=chosen.secondCandidate??(chosen.completed&&chosen.pullbackIndex>=0?swingFindCompletedNextWave(rows,chosen.pullbackIndex,chosen.pullbackLow):null);
  }
  if(!chosen)return {valid:false,reason:multi?.reason||"近期沒有足夠明確的推進波",pivotThreshold:multi?.threshold??null};

  const amplitude=chosen.high-chosen.low;if(!(amplitude>0))return {valid:false,reason:"波段振幅不足"};
  const firstPullback=Number.isFinite(chosen.pullbackLow)?chosen.pullbackLow:null,targetBase=firstPullback??chosen.low,target=m=>targetBase+amplitude*m;
  const legs=multi?.valid?multi.legs:[
    {number:1,low:chosen.low,lowIndex:chosen.lowIndex,lowDate:swingDate(rows[chosen.lowIndex]),high:chosen.high,highIndex:chosen.highIndex,highDate:swingDate(rows[chosen.highIndex]),risePct:chosen.gain,amplitude,pullbackLow:firstPullback,pullbackIndex:chosen.pullbackIndex,pullbackDate:chosen.pullbackIndex>=0?swingDate(rows[chosen.pullbackIndex]):"",pullbackPct:chosen.pullback,retracePct:firstPullback===null?null:(chosen.high-firstPullback)/amplitude*100},
    ...(second?[{number:2,low:firstPullback??chosen.low,lowIndex:chosen.pullbackIndex,lowDate:chosen.pullbackIndex>=0?swingDate(rows[chosen.pullbackIndex]):"",high:second.high,highIndex:second.highIndex,highDate:swingDate(rows[second.highIndex]),risePct:second.risePct,amplitude:second.high-(firstPullback??chosen.low),pullbackLow:second.pullbackLow,pullbackIndex:second.pullbackIndex,pullbackDate:second.pullbackIndex>=0?swingDate(rows[second.pullbackIndex]):"",pullbackPct:second.pullbackPct}]:[])
  ];
  const secondPullbackLow=legs[1]?.pullbackLow??second?.pullbackLow??null,activeDefenseLow=multi?.valid?multi.activeDefenseLow:(secondPullbackLow??firstPullback??chosen.low),referenceHigh=multi?.valid?multi.referenceHigh:(secondPullbackLow!==null?(second?.high??chosen.high):chosen.high),activeWave=multi?.valid?multi.activeWave:(secondPullbackLow!==null?3:firstPullback!==null?2:1),waveCount=multi?.valid?multi.waveCount:legs.length;
  const currentMultiple=(price-targetBase)/amplitude,activeBase=positionNumber(activeDefenseLow)??targetBase,activeMultiple=(price-activeBase)/amplitude;
  const activeTargets=[1,1.5,2].map(m=>({label:`第${activeWave}波 ${m}X`,multiple:m,value:activeBase+amplitude*m}));

  let state=multi?.valid?multi.state:"第一波形成中",phase=multi?.valid?multi.phase:"第一波形成中";
  if(!multi?.valid){
    if(firstPullback!==null&&!chosen.completed){state="第一波後回測形成中";phase="第一波後回測形成中"}
    if(chosen.completed){
      if(secondPullbackLow!==null){if(price>=referenceHigh*1.005){state="第二次回測後再轉強";phase="第三波嘗試"}else{state="第二波後回測";phase="第二波後回測"}}
      else if(price<chosen.high*.985){state="第一波後回測";phase="等待第二波"}
      else if(price<target(1.5)){state="第二波進行中";phase="第二波進行中"}
      else if(price<target(2)){state="第二波延伸";phase="第二波延伸"}
      else if(price<target(2.5)){state="第二波高延伸";phase="第二波高延伸"}
      else{state="延伸過熱區";phase="高檔延伸"}
    }
  }

  const bollingerPath=bollingerPathSignal(rows,t,price,breakout),macdLifecycle=macdLifecycleSignal(rows,t,price,bollingerPath,breakout);let quality=50;
  if(chosen.gain>=10&&chosen.gain<=60)quality+=12;else if(chosen.gain>=6)quality+=6;
  if(chosen.pullback!==null&&chosen.pullback<=-3&&chosen.pullback>=-25)quality+=10;if(chosen.completed)quality+=6;if(secondPullbackLow!==null)quality+=4;
  if((r?.path?.ma20Slope10??-99)>.3)quality+=6;if((r?.path?.ma60Slope20??-99)>0)quality+=6;if(price>=activeDefenseLow*.98)quality+=4;else quality-=30;
  if(currentMultiple>2.7&&!multi?.valid)quality-=14;if(multi?.valid)quality+=multi.qualityAdj??0;
  if(bollingerPath?.upwardExpansion)quality+=8;else if(bollingerPath?.trendExpansion)quality+=5;else if(bollingerPath?.breakdown)quality-=14;if(macdLifecycle?.valid)quality+=macdLifecycle.swingAdj;quality=Math.round(playClamp(quality));
  const macdAttack=!macdLifecycle?.valid||["重新攻擊","攻擊擴張"].includes(macdLifecycle.state);let extensionMax=1.5;if(!bollingerPath?.breakdown&&quality>=60)extensionMax=2;if(!bollingerPath?.breakdown&&((((bollingerPath?.upwardExpansion||bollingerPath?.trendExpansion)&&macdAttack)&&quality>=66)||price>=target(2)*.985))extensionMax=2.5;
  const projected=[...activeTargets,...[{label:"結構 1.5X",multiple:1.5,value:target(1.5)},{label:"結構 2X",multiple:2,value:target(2)},{label:"結構 2.5X",multiple:2.5,value:target(2.5)}]].filter(x=>Number.isFinite(x.value)&&x.value>price*1.002).sort((a,b)=>a.value-b.value),nextTarget=projected[0]?.value??referenceHigh;

  return{
    valid:true,state,phase,quality,currentMultiple,activeMultiple,nextTarget,referenceHigh,activeDefenseLow,bollingerPath,macdLifecycle,extensionMax,
    baseLow:chosen.low,firstWave:chosen.high,pullbackLow:firstPullback,secondWaveHigh:legs[1]?.high??second?.high??null,secondPullbackLow,
    thirdWaveHigh:legs[2]?.high??null,thirdPullbackLow:legs[2]?.pullbackLow??null,fourthWaveHigh:legs[3]?.high??null,fourthPullbackLow:legs[3]?.pullbackLow??null,
    ext15:target(1.5),ext20:target(2),ext25:target(2.5),targetBase,activeTargets,waveLegs:legs,pivots:multi?.pivots??[],pivotThreshold:multi?.threshold??null,waveCount,activeWave,
    structuralResetCount:multi?.resets?.length??0,recentReset:multi?.recentReset??null,resetAge:multi?.resetAge??null,
    gainPct:chosen.gain,pullbackPct:chosen.pullback,secondPullbackPct:legs[1]?.pullbackPct??second?.pullbackPct??null,completed:chosen.completed,
    baseDate:swingDate(rows[chosen.lowIndex]),waveDate:swingDate(rows[chosen.highIndex]),pullbackDate:chosen.pullbackIndex>=0?swingDate(rows[chosen.pullbackIndex]):"",
    secondWaveDate:legs[1]?.highDate??(second?.highIndex>=0?swingDate(rows[second.highIndex]):""),secondPullbackDate:legs[1]?.pullbackDate??(second?.pullbackIndex>=0?swingDate(rows[second.pullbackIndex]):""),
    reason:multi?.valid
      ?`多波 Pivot 使用 ${multi.threshold.toFixed(1)}% 動態反轉閾值；目前辨識 ${waveCount} 個推進波、作用中第 ${activeWave} 波${multi.resets.length?`，已自動重置舊結構 ${multi.resets.length} 次`:""}。深回超過 70% 或跌破前波起點時，舊波結束並從新低點重新計算。`
      :chosen.completed?"Pivot 樣本不足時使用舊版容錯：第一波振幅 X 固定，倍率從第一波後回測低點起算。":"第一波尚在形成；回測低點確認後才固定倍率目標。"
  };
}


// v2.5.8.4 — 股性節奏引擎 v3：先看「回吐前波多少」，再看實際跌幅；深回超過 70% 視為結構重置，不直接當短線。
function rhythmMedian(values){
  const a=(values||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function rhythmFiveDayReturns(rows){
  const out=[];for(let i=5;i<(rows||[]).length;i++){const c=playRowClose(rows[i]),b=playRowClose(rows[i-5]),v=stagePct(c,b);if(v!==null)out.push(v)}return out;
}
function rhythmRangePct(rows){
  const out=[];for(let i=1;i<(rows||[]).length;i++){const h=playRowHigh(rows[i]),l=swingLow(rows[i]),pc=playRowClose(rows[i-1]);if(h===null||l===null||pc===null||pc===0)continue;out.push((h-l)/pc*100)}return out;
}
function rhythmMomentumRuns(rows){
  const states=[];for(let i=5;i<(rows||[]).length;i++){
    const c=playRowClose(rows[i]),b3=playRowClose(rows[i-3]),b5=playRowClose(rows[i-5]);if(c===null||b3===null||b5===null)continue;
    const r3=stagePct(c,b3),r5=stagePct(c,b5),up=(r3??-99)>=1.2||(r5??-99)>=2.4;states.push(up?'up':'rest');
  }
  const runs=[];for(const st of states){const last=runs.at(-1);if(last&&last.type===st)last.days++;else runs.push({type:st,days:1})}
  const core=runs.slice(1,-1),upRuns=core.filter(x=>x.type==='up').map(x=>x.days),restRuns=core.filter(x=>x.type==='rest').map(x=>x.days);let cycles=0;
  for(let i=1;i<runs.length-1;i++)if(runs[i-1].type==='up'&&runs[i].type==='rest'&&runs[i+1]?.type==='up')cycles++;
  return {upDays:rhythmMedian(upRuns),restDays:rhythmMedian(restRuns),cycles,runs};
}
function rhythmZigZag(rows,thresholdPct){
  const a=(rows||[]).filter(x=>playRowClose(x)!==null);if(a.length<12)return [];
  const closes=a.map(playRowClose);let trend=0,pivotI=0,pivotP=closes[0],extI=0,extP=closes[0],scanMinI=0,scanMin=closes[0],scanMaxI=0,scanMax=closes[0];const pivots=[];
  for(let i=1;i<closes.length;i++){
    const c=closes[i];if(c<scanMin){scanMin=c;scanMinI=i}if(c>scanMax){scanMax=c;scanMaxI=i}
    if(trend===0){
      const up=stagePct(c,scanMin),down=stagePct(c,scanMax);
      if(up!==null&&up>=thresholdPct){pivotI=scanMinI;pivotP=scanMin;pivots.push({i:pivotI,p:pivotP,type:'low'});trend=1;extI=i;extP=c;scanMax=c;scanMaxI=i}
      else if(down!==null&&down<=-thresholdPct){pivotI=scanMaxI;pivotP=scanMax;pivots.push({i:pivotI,p:pivotP,type:'high'});trend=-1;extI=i;extP=c;scanMin=c;scanMinI=i}
      continue;
    }
    if(trend===1){
      if(c>=extP){extP=c;extI=i}
      const rev=stagePct(c,extP);if(rev!==null&&rev<=-thresholdPct){pivots.push({i:extI,p:extP,type:'high'});trend=-1;extI=i;extP=c;scanMin=c;scanMinI=i}
    }else{
      if(c<=extP){extP=c;extI=i}
      const rev=stagePct(c,extP);if(rev!==null&&rev>=thresholdPct){pivots.push({i:extI,p:extP,type:'low'});trend=1;extI=i;extP=c;scanMax=c;scanMaxI=i}
    }
  }
  if(trend===1&&extI>pivots.at(-1)?.i)pivots.push({i:extI,p:extP,type:'high',open:true});
  if(trend===-1&&extI>pivots.at(-1)?.i)pivots.push({i:extI,p:extP,type:'low',open:true});
  return pivots;
}
function rhythmRetraceShortScore(v){
  if(!Number.isFinite(v))return 50;
  if(v<25)return 15;if(v<35)return 28;if(v<45)return 45;if(v<=60)return 88;if(v<=70)return 68;return 15;
}
function rhythmActualDropShortScore(v){
  if(!Number.isFinite(v))return 50;
  if(v<5)return 18;if(v<8)return 32;if(v<10)return 48;if(v<=15)return 92;if(v<=20)return 72;return 25;
}
function rhythmDurationShortScore(upDays,restDays){
  if(!Number.isFinite(upDays)||!Number.isFinite(restDays))return 50;
  if(upDays<=10&&restDays<=10)return 92;if(upDays<=12&&restDays<=12)return 76;if(upDays<=15&&restDays<=15)return 55;return 24;
}
function rhythmRecoveryShortScore(recovered,recoveryDays){
  if(!recovered)return 15;if(!Number.isFinite(recoveryDays))return 35;
  if(recoveryDays<=8)return 95;if(recoveryDays<=12)return 82;if(recoveryDays<=18)return 55;return 34;
}
function calculateStockPersonalitySegment(rows){
  const a=(rows||[]).filter(x=>playRowClose(x)!==null).slice(-160);
  if(a.length<60)return {valid:false,label:'股性資料不足',kind:'unknown',shortBias:0,swingBias:0,shortFit:50,swingFit:50,longFit:50};

  const ranges=rhythmRangePct(a),medianRange=rhythmMedian(ranges)??2.2,
        threshold=stageClamp(medianRange*1.35,2.5,6.0),pivots=rhythmZigZag(a,threshold),
        momentumRuns=rhythmMomentumRuns(a),upLegs=[],restLegs=[],cycleRows=[],stressCycleRows=[];
  for(let i=1;i<pivots.length;i++){
    const x=pivots[i-1],y=pivots[i],days=Math.max(1,y.i-x.i),ret=stagePct(y.p,x.p);if(ret===null)continue;
    const stressLeg=a.slice(Math.max(0,x.i),Math.min(a.length,y.i+1)).some(r=>r?.systemStress);
    if(x.type==='low'&&y.type==='high'&&ret>0&&!stressLeg)upLegs.push({days,ret,from:x,to:y});
    if(x.type==='high'&&y.type==='low'&&ret<0&&!stressLeg)restLegs.push({days,ret,from:x,to:y});
  }

  // 完整週期：起漲低點 A → 高點 B → 回測低點 C → 下一個高點 D。
  // 回吐比例 = (B-C)/(B-A)。這是本版最核心的股性判斷，不再只看 C 相對 B 跌了幾%。
  for(let i=0;i+3<pivots.length;i++){
    const A=pivots[i],B=pivots[i+1],C=pivots[i+2],D=pivots[i+3];
    if(A.type!=='low'||B.type!=='high'||C.type!=='low'||D.type!=='high')continue;
    const amplitude=B.p-A.p;if(!(amplitude>0))continue;
    const risePct=stagePct(B.p,A.p),actualDrop=Math.abs(stagePct(C.p,B.p)??0),retracePct=(B.p-C.p)/amplitude*100,
          upDays=Math.max(1,B.i-A.i),restDays=Math.max(1,C.i-B.i),recovered=D.p>=B.p*.97,
          recoveryDays=recovered?Math.max(1,D.i-C.i):null;
    const cycleScore=.40*rhythmRetraceShortScore(retracePct)+.25*rhythmActualDropShortScore(actualDrop)+.20*rhythmDurationShortScore(upDays,restDays)+.15*rhythmRecoveryShortScore(recovered,recoveryDays);
    const row={risePct,actualDrop,retracePct,upDays,restDays,recovered,recoveryDays,cycleScore,A,B,C,D};
    const stressPullback=a.slice(Math.max(0,B.i),Math.min(a.length,C.i+1)).some(x=>x?.systemStress);
    if(stressPullback)stressCycleRows.push(row);else cycleRows.push(row);
  }

  const zigUpDays=rhythmMedian(upLegs.map(x=>x.days)),zigRestDays=rhythmMedian(restLegs.map(x=>x.days)),
        upDays=rhythmMedian(cycleRows.map(x=>x.upDays))??momentumRuns.upDays??zigUpDays,
        restDays=rhythmMedian(cycleRows.map(x=>x.restDays))??momentumRuns.restDays??zigRestDays,
        upGain=rhythmMedian(upLegs.map(x=>x.ret)),pullback=rhythmMedian(cycleRows.map(x=>x.actualDrop))??rhythmMedian(restLegs.map(x=>Math.abs(x.ret))),
        retrace=rhythmMedian(cycleRows.map(x=>x.retracePct)),recoveryDays=rhythmMedian(cycleRows.filter(x=>x.recovered).map(x=>x.recoveryDays)),
        shortRhythmScore=rhythmMedian(cycleRows.map(x=>x.cycleScore));
  const ret60=stageRet(a,Math.min(60,a.length-1)),ret120=stageRet(a,Math.min(120,a.length-1)),
        above20=stageAboveMaRatio(a,60,20),cross20=playMaCrossCount(a,60,20),five=rhythmFiveDayReturns(a),
        max5=five.length?Math.max(...five):null;
  const completedCycles=cycleRows.length||Math.max(momentumRuns.cycles,Math.min(upLegs.length,restLegs.length)),
        rising=(ret60??0)>=3||(ret120??0)>=8,
        fastCycle=(upDays??99)>=2&&(upDays??99)<=10&&(restDays??99)>=2&&(restDays??99)<=11,
        stableTrend=(above20??0)>=.68&&cross20<=4&&(ret60??0)>=8;

  const qualifyingShortCycles=cycleRows.filter(x=>x.cycleScore>=68&&x.actualDrop>=10&&x.retracePct>=45&&x.retracePct<=70&&x.upDays<=12&&x.restDays<=12&&x.recovered&&(x.recoveryDays??99)<=12).length,
        shortLikeCycles=cycleRows.filter(x=>x.cycleScore>=60&&x.retracePct<=70&&x.upDays<=11&&x.restDays<=12).length,
        deepPullbacks=cycleRows.filter(x=>x.actualDrop>=10).length,
        recoveredDeep=cycleRows.filter(x=>x.actualDrop>=10&&x.recovered&&(x.recoveryDays??99)<=12).length,
        resetCycles=cycleRows.filter(x=>x.retracePct>70).length,
        shallowSwingCycles=cycleRows.filter(x=>x.retracePct<45&&x.actualDrop<10).length;
  const structuralReset=cycleRows.length>=2&&resetCycles>=Math.max(2,Math.ceil(cycleRows.length*.5));
  const deepRhythm=cycleRows.length>=2&&qualifyingShortCycles>=2&&qualifyingShortCycles>=Math.ceil(cycleRows.length*.5);
  const burst=!structuralReset&&(((zigUpDays??upDays??99)<=6&&(upGain??0)>=14)||(completedCycles>=2&&fastCycle&&(max5??0)>=12&&(shortRhythmScore??0)>=58));
  const shortCycle=!structuralReset&&!deepRhythm&&completedCycles>=2&&rising&&fastCycle&&(shortRhythmScore??0)>=58&&shortLikeCycles>=2;
  // 高波動波段：大方向仍上升，但波段內反覆出現 10% 左右深回；適合保留底倉、機動倉做短線。
  const hybridRhythm=!structuralReset&&!deepRhythm&&cycleRows.length>=2&&rising&&deepPullbacks>=2&&recoveredDeep>=1
    &&(retrace??0)>=28&&(retrace??0)<=58&&(pullback??0)>=8&&(ret120??0)>=10&&(upDays??99)<=18;
  const range=!deepRhythm&&!structuralReset&&!hybridRhythm&&((cross20>=7&&Math.abs(ret60??0)<=12)||(completedCycles>=3&&!rising&&Math.abs(ret120??0)<=15));
  const swingTrend=!range&&!deepRhythm&&!shortCycle&&!hybridRhythm&&!structuralReset&&(
    (stableTrend&&((retrace??0)<50||shallowSwingCycles>=Math.max(1,Math.floor(cycleRows.length/2))))||
    ((upDays??0)>=12&&(upGain??0)>=8&&(retrace===null||retrace<50))
  );

  let kind='mixed',label='混合節奏',shortBias=0,swingBias=0;
  if(structuralReset){kind='reset';label='深回重置';shortBias=-10;swingBias=-12}
  else if(deepRhythm){kind='high-vol-short';label='高波動短週期';shortBias=24;swingBias=-16}
  else if(range){kind='range';label='箱型震盪';shortBias=-7;swingBias=-10}
  else if(burst){kind='burst';label='爆發短線';shortBias=16;swingBias=-8}
  else if(shortCycle){kind='short-cycle';label='短週期墊高';shortBias=16;swingBias=-9}
  else if(hybridRhythm){kind='hybrid';label='高波動波段';shortBias=8;swingBias=12}
  else if(swingTrend){kind='swing-trend';label='波段趨勢';shortBias=-6;swingBias=18}
  else{
    if(cycleRows.length>=2&&(shortRhythmScore??0)>=62&&fastCycle){shortBias+=7;swingBias-=3}
    if(stableTrend&&(retrace===null||retrace<45)){swingBias+=10;shortBias-=3}
    if((upDays??0)>=13){swingBias+=6;shortBias-=2}
    // 單看 10%+ 跌幅只能小幅影響，避免又把大多數高波動股全部吸成短線。
    if((pullback??0)>=10&&cycleRows.length>=2)shortBias+=2;
    if(cross20>=6){shortBias-=2;swingBias-=5}
  }

  let shortFit=50+shortBias,swingFit=50+swingBias;
  if(kind==='high-vol-short'){shortFit=Math.max(shortFit,82);swingFit=Math.min(swingFit,40)}
  else if(kind==='short-cycle'){shortFit=Math.max(shortFit,72);swingFit=Math.min(swingFit,50)}
  else if(kind==='burst'){shortFit=Math.max(shortFit,76);swingFit=Math.min(swingFit,45)}
  else if(kind==='hybrid'){shortFit=Math.max(shortFit,62);swingFit=Math.max(swingFit,70);if(Math.abs(shortFit-swingFit)>14)shortFit=swingFit-12}
  else if(kind==='swing-trend'){swingFit=Math.max(swingFit,82);shortFit=Math.min(shortFit,42)}
  else if(kind==='range'){shortFit=Math.min(shortFit,42);swingFit=Math.min(swingFit,40)}
  else if(kind==='reset'){shortFit=Math.min(shortFit,40);swingFit=Math.min(swingFit,38)}
  shortFit=Math.round(playClamp(shortFit));swingFit=Math.round(playClamp(swingFit));

  // 長期股性：看能否長時間保留趨勢與獲利，不把「高波動」本身直接等同長期不適合。
  let longFit=50;
  if(kind==='swing-trend')longFit=80;
  else if(kind==='hybrid')longFit=64;
  else if(kind==='short-cycle')longFit=48;
  else if(kind==='burst')longFit=44;
  else if(kind==='high-vol-short')longFit=40;
  else if(kind==='range')longFit=42;
  else if(kind==='reset')longFit=28;
  else{
    if((ret120??0)>=25)longFit+=10;else if((ret120??0)>=8)longFit+=5;else if((ret120??0)<0)longFit-=8;
    if((above20??0)>=.68)longFit+=5;if(cross20>=7)longFit-=6;if(resetCycles>=2)longFit-=12;if(deepPullbacks>=3)longFit-=5;
  }
  longFit=Math.round(playClamp(longFit));

  // strongShort 只允許「反覆深回＋快速恢復」的高可信股性觸發，避免再次全部變短線。
  const strongShort=kind==='high-vol-short'&&qualifyingShortCycles>=2&&shortFit-swingFit>=28,
        strongSwing=kind==='swing-trend'&&swingFit-shortFit>=25;
  const parts=[];
  if(upDays!==null)parts.push(`典型上漲 ${Math.round(upDays)}日`);
  if(restDays!==null)parts.push(`整理 ${Math.round(restDays)}日`);
  if(retrace!==null)parts.push(`回吐前波 ${retrace.toFixed(0)}%`);
  if(pullback!==null)parts.push(`實際回檔 ${pullback.toFixed(1)}%`);
  if(recoveryDays!==null)parts.push(`恢復約 ${Math.round(recoveryDays)}日`);
  if(cycleRows.length)parts.push(`完整循環 ${cycleRows.length}次`);
  if(resetCycles)parts.push(`>70%重置 ${resetCycles}次`);
  if(stressCycleRows.length)parts.push(`系統性回檔排除 ${stressCycleRows.length}次`);

  return {valid:true,kind,label,detail:parts.join('｜')||'歷史節奏已分析',shortBias,swingBias,shortFit,swingFit,longFit,
    upDays,restDays,upGain,pullback,retrace,recoveryDays,cycles:completedCycles,completeCycles:cycleRows.length,ret60,ret120,above20,cross20,max5,medianRange,threshold,
    shortRhythmScore,shortCycle,hybridRhythm,swingTrend,range,burst,deepRhythm,structuralReset,deepPullbacks,recoveredDeep,qualifyingShortCycles,shortLikeCycles,resetCycles,strongShort,strongSwing,stressCycles:stressCycleRows.length};
}
function calculateStockPersonality(rows){
  const all=(rows||[]).filter(x=>playRowClose(x)!==null).slice(-1260);
  if(all.length<60)return calculateStockPersonalitySegment(all);
  const recent=all.slice(-160),older=all.slice(Math.max(0,all.length-240),Math.max(0,all.length-160)),historical=all.slice(0,Math.max(0,all.length-240));
  const pr=calculateStockPersonalitySegment(recent),po=older.length>=60?calculateStockPersonalitySegment(older):null;
  if(!pr?.valid)return calculateStockPersonalitySegment(all);
  const histSegments=[];
  for(let end=historical.length;end>=60&&histSegments.length<5;end-=160){const seg=historical.slice(Math.max(0,end-160),end),x=calculateStockPersonalitySegment(seg);if(x?.valid)histSegments.push(x)}
  const histMedian=key=>rhythmMedian(histSegments.map(x=>Number(x?.[key])).filter(Number.isFinite)),histValid=histSegments.length>0,oldValid=!!po?.valid;
  let wRecent=100,wOld=0,wHistory=0;if(oldValid&&histValid){wRecent=63;wOld=27;wHistory=10}else if(oldValid){wRecent=70;wOld=30}else if(histValid){wRecent=90;wHistory=10}
  const blend=key=>{const total=wRecent+wOld+wHistory,rv=Number(pr?.[key])||50,ov=Number(po?.[key])||50,hv=histMedian(key)??50;return Math.round(playClamp((rv*wRecent+ov*wOld+hv*wHistory)/total))};
  // 股性「種類」仍由最近160日決定；舊資料只提供適性分數的歷史底色，避免多年以前的節奏硬改現在分類。
  const result={...pr,shortFit:blend('shortFit'),swingFit:blend('swingFit'),longFit:blend('longFit'),windowDays:all.length,recentWeight:wRecent,olderWeight:wOld,historyWeight:wHistory,historySegments:histSegments.length,
    historicalBaseline:histValid?{shortFit:Math.round(histMedian('shortFit')),swingFit:Math.round(histMedian('swingFit')),longFit:Math.round(histMedian('longFit'))}:null};
  const historyYears=Math.min(5,Math.max(1,Math.round(all.length/252)));
  result.weightingDetail=`近160日 ${wRecent}%${wOld?`／前80日 ${wOld}%`:""}${wHistory?`／更早歷史 ${wHistory}%（${histSegments.length}段）`:""}`;
  result.detail=`歷史資料${historyYears}年｜完整循環 ${Number.isFinite(pr.completeCycles)?pr.completeCycles:(pr.cycles||0)}次｜系統性回檔排除 ${pr.stressCycles||0}次`;
  return result;
}

function seasonalityQuarter5Y(rows,quarter){
  const byYear=new Map();
  for(const r of (rows||[])){
    const close=playRowClose(r);if(close===null)continue;
    const key=historyDateKey(r),d=new Date(`${key}T00:00:00Z`);
    if(Number.isNaN(d.getTime())||Math.floor(d.getUTCMonth()/3)+1!==quarter)continue;
    const year=d.getUTCFullYear();
    if(!byYear.has(year))byYear.set(year,[]);
    byYear.get(year).push(r);
  }
  const samples=[];
  for(const [year,x0] of [...byYear.entries()].sort((a,b)=>a[0]-b[0]).slice(-5)){
    const x=x0.slice().sort((a,b)=>String(historyDateKey(a)).localeCompare(String(historyDateKey(b))));
    // 季節性保留真實市場狀況，不再因 systemStress 排除整季；只要求有基本交易資料。
    if(x.length<15)continue;
    const first=playRowClose(x[0]),last=playRowClose(x.at(-1)),ret=stagePct(last,first);
    if(ret!==null)samples.push({year,ret});
  }
  if(!samples.length)return {valid:false,quarter,sample:0,positives:0,positiveRate:null,median:null};
  const positives=samples.filter(x=>x.ret>0).length,median=rhythmMedian(samples.map(x=>x.ret)),positiveRate=Math.round(positives/samples.length*100);
  return {valid:true,quarter,sample:samples.length,positives,positiveRate,median,samples};
}
function seasonality5Y(rows,now=new Date()){
  const q=Math.floor(now.getMonth()/3)+1;
  const quarters={};
  for(let i=1;i<=4;i++)quarters[i]=seasonalityQuarter5Y(rows,i);
  const current=quarters[q];
  if(!current?.valid)return {valid:false,quarter:q,sample:0,quarters,label:`近5年Q${q}｜樣本不足`};
  const yearsText=current.sample>=5?"近5年":`近5年（${current.sample}年樣本）`;
  return {...current,quarters,label:`${yearsText}Q${q}｜${current.positiveRate}%上漲｜中位報酬 ${stageFmtPct(current.median)}`};
}

// v2.5.8.1 — 短線玩法專屬引擎。新聞只做低權重修正，核心資格仍由技術／突破決定。
function shortCurrentDate(){return dayKey(currentStock?.tradeDate||currentStock?.quoteTime||new Date().toISOString())}
function shortReturnN(rows,n,price){
  if(!rows?.length||!Number.isFinite(price))return null;
  const lastDate=swingDate(rows.at(-1)),includesCurrent=!!(lastDate&&shortCurrentDate()&&lastDate===shortCurrentDate());
  const idx=rows.length-1-(includesCurrent?n:Math.max(0,n-1));
  const base=playRowClose(rows[Math.max(0,idx)]);return base===null?null:stagePct(price,base);
}
function shortSmaSlope(rows,n,lookback=3){
  const now=stageSmaAt(rows,n),before=stageSmaAt(rows,n,Math.max(n,rows.length-lookback));
  return now!==null&&before!==null?stagePct(now,before):null;
}
function shortEma(values,period){
  if(values.length<period)return [];
  const k=2/(period+1),out=[];let prev=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=0;i<period-1;i++)out.push(null);out.push(prev);
  for(let i=period;i<values.length;i++){prev=values[i]*k+prev*(1-k);out.push(prev)}return out;
}
function shortMacdSnapshot(rows,price){
  let values=(rows||[]).map(playRowClose).filter(Number.isFinite);if(values.length<35)return {macd:null,signal:null,hist:null,histDelta:null};
  const lastDate=swingDate(rows.at(-1)),includesCurrent=!!(lastDate&&shortCurrentDate()&&lastDate===shortCurrentDate());
  if(Number.isFinite(price)){if(includesCurrent)values[values.length-1]=price;else values.push(price)}
  const e12=shortEma(values,12),e26=shortEma(values,26),macd=values.map((_,i)=>e12[i]!==null&&e26[i]!==null?e12[i]-e26[i]:null);
  const validIdx=macd.map((v,i)=>v===null?null:i).filter(Number.isFinite),macdVals=validIdx.map(i=>macd[i]);if(macdVals.length<9)return {macd:null,signal:null,hist:null,histDelta:null};
  const sigVals=shortEma(macdVals,9),sigMap=new Map();validIdx.forEach((idx,j)=>sigMap.set(idx,sigVals[j]));
  const i=values.length-1,prev=i-1,m=macd[i],s=sigMap.get(i),pm=macd[prev],ps=sigMap.get(prev),hist=m!==null&&Number.isFinite(s)?m-s:null,prevHist=pm!==null&&Number.isFinite(ps)?pm-ps:null;
  return {macd:m,signal:Number.isFinite(s)?s:null,hist,histDelta:hist!==null&&prevHist!==null?hist-prevHist:null};
}

// v2.5.9.4 — MACD 動能生命週期：零軸只當趨勢背景，柱體縮短／短柱蓄力／重新放大才決定攻擊節奏。
function macdHistogramSeries(rows,price){
  let values=(rows||[]).map(playRowClose).filter(Number.isFinite);if(values.length<35)return [];
  const lastDate=swingDate(rows.at(-1)),includesCurrent=!!(lastDate&&shortCurrentDate()&&lastDate===shortCurrentDate());
  if(Number.isFinite(price)){if(includesCurrent)values[values.length-1]=price;else values.push(price)}
  const e12=shortEma(values,12),e26=shortEma(values,26),macd=values.map((_,i)=>e12[i]!==null&&e26[i]!==null?e12[i]-e26[i]:null),validIdx=macd.map((v,i)=>v===null?null:i).filter(Number.isFinite),macdVals=validIdx.map(i=>macd[i]);
  if(macdVals.length<9)return [];
  const sigVals=shortEma(macdVals,9),sigMap=new Map();validIdx.forEach((idx,j)=>sigMap.set(idx,sigVals[j]));
  const out=[];for(const i of validIdx){const m=macd[i],sg=sigMap.get(i);if(m===null||!Number.isFinite(sg))continue;out.push({i,macd:m,signal:sg,hist:m-sg})}return out;
}
function macdLifecycleSignal(rows,t,price,bollinger=null,breakout=null){
  const series=macdHistogramSeries(rows,price),p=stageNum(price);if(series.length<12||p===null)return {valid:false,state:"MACD資料不足",score:50,shortAdj:0,swingAdj:0,entryOk:null};
  const a=series.slice(-45),h=a.map(x=>x.hist),last=a.at(-1),cur=last.hist,prev=h.at(-2),prev2=h.at(-3);
  if(![cur,prev,prev2].every(Number.isFinite))return {valid:false,state:"MACD資料不足",score:50,shortAdj:0,swingAdj:0,entryOk:null};
  const absPeak=Math.max(...h.slice(0,-1).map(x=>Math.abs(x)).filter(Number.isFinite),Math.abs(cur),1e-9),tinyLimit=absPeak*.32,recent8=h.slice(-8),priorTiny=h.slice(-9,-2),
        tinyCount=recent8.filter(x=>Math.abs(x)<=tinyLimit).length,positiveCount=recent8.filter(x=>x>0).length,priorTinyCount=priorTiny.filter(x=>Math.abs(x)<=tinyLimit).length,
        ma20Slope=stageMaSlope(rows,20,10),ma60Slope=stageMaSlope(rows,60,20),ma20=stageNum(t?.ma?.ma20),ma60=stageNum(t?.ma?.ma60),
        longTrendUp=(ma20Slope===null||ma20Slope>=0)&&(ma60Slope===null||ma60Slope>=-.15),structureIntact=(ma60===null||p>=ma60*.97)&&(ma20===null||p>=ma20*.94),
        macdAboveZero=last.macd>=0,shrinkingBelow=cur<0&&cur>prev&&prev>=prev2,shrinkingAbove=cur>0&&cur<prev&&prev<=prev2,
        longAccumulation=longTrendUp&&structureIntact&&macdAboveZero&&tinyCount>=5&&positiveCount>=3,
        twoStepExpand=cur>0&&cur>prev&&prev>prev2,reactivation=longTrendUp&&structureIntact&&priorTinyCount>=4&&twoStepExpand&&cur>tinyLimit*.65,
        attackExpansion=cur>0&&cur>prev&&(prev>prev2||prev<=0),bearExpansion=cur<0&&cur<prev&&prev<=prev2,
        bollAttack=!!(bollinger?.upwardExpansion||bollinger?.trendExpansion),breakoutOk=!!breakout?.confirmed;
  let state="動能中性",score=52,shortAdj=0,swingAdj=0,entryOk=false,note="柱體沒有形成明確擴張或衰退序列";
  if(reactivation){state="重新攻擊";score=bollAttack||breakoutOk?94:86;shortAdj=8;swingAdj=10;entryOk=true;note="短柱蓄力後柱體連續重新放大，進入再攻擊觀察"}
  else if(longAccumulation){state="長波蓄力";score=72;shortAdj=1;swingAdj=8;entryOk=false;note="零軸附近／上方連續多根短柱，長趨勢仍完整，偏長波整理蓄力"}
  else if(bearExpansion&&(!longTrendUp||!structureIntact||!macdAboveZero)){state="空方擴張";score=22;shortAdj=-8;swingAdj=-10;entryOk=false;note="零軸下柱體重新放大，空方動能增加"}
  else if(shrinkingBelow){state="攻擊觀察";score=66;shortAdj=3;swingAdj=2;entryOk=false;note="零軸下柱體連續縮短，空方動能衰退"}
  else if(attackExpansion&&longTrendUp&&structureIntact){state="攻擊擴張";score=82;shortAdj=6;swingAdj=5;entryOk=true;note="柱體連續放大，多方動能正在擴張"}
  else if(attackExpansion){state="攻擊觀察";score=64;shortAdj=2;swingAdj=1;entryOk=false;note="柱體轉強，但長趨勢／結構尚未確認，只列攻擊觀察"}
  else if(shrinkingAbove||bearExpansion){state="動能降溫";score=45;shortAdj=-4;swingAdj=1;entryOk=false;note="柱體開始縮短／轉弱，短線動能降溫但不直接視為波段破壞"}
  const delta=cur-prev,background=macdAboveZero?"零軸上趨勢背景":"零軸下趨勢背景";
  return {valid:true,state,score,shortAdj,swingAdj,entryOk,note,background,hist:cur,histDelta:delta,tinyLimit,tinyCount,positiveCount,priorTinyCount,longTrendUp,structureIntact,macdAboveZero,shrinkingBelow,shrinkingAbove,longAccumulation,reactivation,attackExpansion,bearExpansion,bollAttack,breakoutOk};
}

function shortStochastic(rows,period=9){
  if((rows||[]).length<period+2)return {k:null,d:null};const ks=[];
  for(let i=Math.max(period-1,rows.length-3);i<rows.length;i++){
    const slice=rows.slice(i-period+1,i+1),highs=slice.map(playRowHigh).filter(Number.isFinite),lows=slice.map(swingLow).filter(Number.isFinite),c=playRowClose(rows[i]);
    if(!highs.length||!lows.length||c===null)continue;const hi=Math.max(...highs),lo=Math.min(...lows);ks.push(hi===lo?50:(c-lo)/(hi-lo)*100);
  }
  const k=ks.at(-1)??null,d=ks.length?ks.reduce((a,b)=>a+b,0)/ks.length:null;return {k,d};
}
function shortAtr(rows,n=10){
  const a=(rows||[]).slice(-n);if(a.length<5)return null;const trs=[];
  for(let i=0;i<a.length;i++){const h=playRowHigh(a[i]),l=swingLow(a[i]),pc=i?playRowClose(a[i-1]):null;if(h===null||l===null)continue;trs.push(pc===null?h-l:Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)))}
  return trs.length?trs.reduce((x,y)=>x+y,0)/trs.length:null;
}
function shortCandleState(rows){
  const x=rows?.at(-1),prev=rows?.at(-2);if(!x)return {label:"K線資料不足",score:0};
  const o=stageNum(x.open),h=playRowHigh(x),l=swingLow(x),c=playRowClose(x),pc=playRowClose(prev);if(o===null||h===null||l===null||c===null||h<=l)return {label:"K線資料不足",score:0};
  const range=h-l,body=Math.abs(c-o)/range,upper=(h-Math.max(o,c))/range,lower=(Math.min(o,c)-l)/range,chg=pc===null?null:stagePct(c,pc);
  if(upper>=.45&&body>=.25)return {label:"長上影，短壓力明顯",score:-5};
  if(chg!==null&&chg>=2.5&&c>o&&body>=.5)return {label:"強勢實體，收盤靠高",score:5};
  if(body<=.18)return {label:"十字整理，等待方向",score:-1};
  if(c>o&&lower>=.3)return {label:"下影承接",score:3};
  if(chg!==null&&chg<=-2.5&&c<o)return {label:"實體轉弱",score:-5};
  return {label:c>=o?"偏多實體":"偏弱實體",score:c>=o?2:-2};
}
function shortNewsCatalyst(){
  const rows=Array.isArray(newsRowsCache)?newsRowsCache:[];if(!rows.length)return {label:"新聞資料待補",score:0,fit:50,count:0,available:false};
  const cutoff=Date.now()-7*86400000,fresh=rows.filter(x=>{const t=newsTime(x);return !t||t>=cutoff}).slice(0,12);if(!fresh.length)return {label:"近7日無明顯催化",score:0,fit:50,count:0,available:true};
  const pos=/調升|上修|創高|訂單|接單|擴產|量產|成長|年增|獲利|優於|合作|取得|通過|AI|CPO|CoWoS|先進封裝|新品|新產品|法說/;
  const neg=/調降|下修|衰退|虧損|年減|下滑|不如|延後|取消|處分|警示|風險|罰款|停工|減產/;
  let p=0,n=0;for(const x of fresh){const text=`${x?.title||""} ${(x?.summaryPoints||[]).join(" ")}`;if(pos.test(text))p++;if(neg.test(text))n++}
  let delta=0,label=`近期新聞中性（${fresh.length}則）`;
  if(n>p&&n>=1){delta=-Math.min(5,2+n);label=`風險關鍵字 ${n} 則`}
  else if(p>n&&p>=1){delta=Math.min(5,2+p);label=`題材／正向關鍵字 ${p} 則`}
  return {label,score:delta,fit:Math.round(playClamp(50+delta*5)),count:fresh.length,positive:p,negative:n,available:true};
}
// v2.5.9.2 — 布林路徑保持獨立：窄口只代表能量壓縮；v2.5.9.4 新增 MACD 動能生命週期，但不改布林參數。
function bollingerBandwidthSeries(rows,period=20,lookback=150){
  const a=(rows||[]).filter(x=>playRowClose(x)!==null).slice(-(lookback+period+12));if(a.length<period+8)return [];
  const closes=a.map(playRowClose),out=[];
  for(let i=period-1;i<a.length;i++){
    const w=closes.slice(i-period+1,i+1),mid=w.reduce((x,y)=>x+y,0)/period;if(!(mid>0))continue;
    const variance=w.reduce((x,y)=>x+(y-mid)*(y-mid),0)/period,sd=Math.sqrt(Math.max(0,variance)),upper=mid+sd*2,lower=mid-sd*2,bw=(upper-lower)/mid*100;
    out.push({index:i,date:swingDate(a[i]),width:bw,middle:mid,upper,lower,close:closes[i]});
  }
  return out;
}
function bollingerPathSignal(rows,t,price,breakout=null){
  const series=bollingerBandwidthSeries(rows,20,150),p=stageNum(price);if(series.length<25||p===null)return {valid:false,score:50,state:"布林資料不足",percentile:null};
  const hist=series.slice(-120),recent=hist.slice(-10),latest=hist.at(-1),current=stageNum(t?.bollinger?.bandwidth)??latest?.width??null;
  if(current===null)return {valid:false,score:50,state:"布林資料不足",percentile:null};
  const floor=recent.reduce((a,b)=>!a||b.width<a.width?b:a,null),floorWidth=floor?.width??current,widths=hist.map(x=>x.width).filter(Number.isFinite),percentile=widths.length?widths.filter(x=>x<=floorWidth).length/widths.length*100:null;
  const expansionRatio=floorWidth>0?current/floorWidth:1,prev3=hist.slice(-4,-1).map(x=>x.width).filter(Number.isFinite),prevMedian=rhythmMedian(prev3),expanding=expansionRatio>=1.10&&(prevMedian===null||current>=prevMedian*1.03);
  const upper=stageNum(t?.bollinger?.upper)??latest?.upper??null,middle=stageNum(t?.bollinger?.middle)??latest?.middle??null,lower=stageNum(t?.bollinger?.lower)??latest?.lower??null,
        ma5=stageNum(t?.ma?.ma5),ma10=stageNum(t?.ma?.ma10),ratio20=stageNum(t?.volume?.ratio20),maBull=ma5!==null&&ma10!==null?ma5>=ma10:true,
        upperBreak=upper!==null&&p>=upper*.995,volumeOk=ratio20===null||ratio20>=1.05,compressed=percentile!==null&&percentile<=15,extreme=percentile!==null&&percentile<=5,
        bullishConfirm=!!(breakout?.confirmed||upperBreak)&&maBull,upwardExpansion=compressed&&expanding&&bullishConfirm&&volumeOk,
        trendExpansion=!compressed&&expanding&&upperBreak&&maBull&&volumeOk,breakdown=(lower!==null&&p<lower*.995)||(middle!==null&&p<middle*.985&&ma5!==null&&ma10!==null&&ma5<ma10&&expanding);
  let score=50,state="布林正常";
  if(extreme&&!bullishConfirm){score=53;state="極端窄口蓄力"}
  else if(compressed&&!bullishConfirm){score=51;state="窄口蓄力"}
  if(bullishConfirm&&!expanding){score=Math.max(score,65);state=compressed?"窄口向上確認":"上軌突破待張口"}
  if(trendExpansion){score=80;state="沿上軌擴張"}
  if(upwardExpansion){score=90;state=extreme?"極端窄口後向上張口":"窄口後向上張口"}
  if(breakdown){score=24;state="下軌擴張／波段轉弱"}
  const level=percentile===null?"--":percentile<=5?"極端壓縮":percentile<=10?"高度壓縮":percentile<=30?"偏窄":"正常";
  return {valid:true,score,state,level,bandwidth:current,squeezeBandwidth:floorWidth,percentile,expansionRatio,expanding,compressed,extreme,upperBreak,maBull,volumeOk,upwardExpansion,trendExpansion,breakdown,upper,middle,lower,
    note:`${level}｜近120日壓縮百分位 ${percentile===null?"--":percentile.toFixed(0)+"%"}｜帶寬 ${current.toFixed(1)}%${expanding?"｜張口中":""}`};
}

// v2.5.9.2 — 短期玩法也建立自己的短波段價格結構；只看最近 20～60 日日K，不沿用中期波段倍率。
function calculateShortWave(rowsInput,priceInput){
  const rows=(rowsInput||[]).filter(x=>playRowClose(x)!==null).slice(-60),price=stageNum(priceInput);
  if(rows.length<20||price===null)return {valid:false,reason:"短波K線不足",targets:[]};
  const candidates=[];
  for(let hi=7;hi<rows.length-2;hi++){
    if(!swingIsLocalHigh(rows,hi,1))continue;
    const high=swingHigh(rows[hi]);if(high===null)continue;
    const lowInfo=swingRangeMin(rows,Math.max(0,hi-18),hi-1,swingLow),low=lowInfo.value;
    if(low===null||lowInfo.index<0)continue;
    const gain=stagePct(high,low);if(gain===null||gain<3||gain>45)continue;
    const pb=swingFindPullback(rows,hi,high,{maxBars:14,minDrop:1.2,minRebound:1.3,reboundBars:5});
    if(!pb)continue;
    const age=rows.length-1-hi,score=Math.min(30,gain)+(pb.confirmed?12:4)+Math.max(0,14-age*.7);
    candidates.push({low,lowIndex:lowInfo.index,high,highIndex:hi,gain,pb,score});
  }
  let chosen=candidates.sort((a,b)=>b.score-a.score||b.highIndex-a.highIndex)[0]||null;
  if(!chosen){
    const hi=swingRangeMax(rows,Math.max(7,rows.length-18),rows.length,swingHigh);
    if(hi.index>4){
      const lo=swingRangeMin(rows,Math.max(0,hi.index-18),hi.index-1,swingLow),gain=lo.value!==null&&hi.value!==null?stagePct(hi.value,lo.value):null;
      if(gain!==null&&gain>=3&&gain<=45)chosen={low:lo.value,lowIndex:lo.index,high:hi.value,highIndex:hi.index,gain,pb:null,score:45};
    }
  }
  if(!chosen)return {valid:false,reason:"近期沒有明確短波推進",targets:[]};
  const amplitude=chosen.high-chosen.low;if(!(amplitude>0))return {valid:false,reason:"短波振幅不足",targets:[]};
  const pullbackLow=chosen.pb?.low??null,targetBase=pullbackLow??chosen.low,target=m=>targetBase+amplitude*m,currentMultiple=(price-targetBase)/amplitude;
  let quality=48;if(chosen.gain>=5&&chosen.gain<=25)quality+=12;if(chosen.pb?.confirmed)quality+=12;if(chosen.pb?.dropPct<=-1.5&&chosen.pb?.dropPct>=-12)quality+=8;if(currentMultiple>=0&&currentMultiple<=2.2)quality+=7;if(price<targetBase*.985)quality-=20;
  quality=Math.round(playClamp(quality));
  const targets=[{label:"短波1X",value:target(1),multiple:1},{label:"短波1.5X",value:target(1.5),multiple:1.5},{label:"短波2X",value:target(2),multiple:2}];
  return {valid:true,quality,state:chosen.pb?.confirmed?"短波回測後延伸":"短波形成中",baseLow:chosen.low,firstHigh:chosen.high,pullbackLow,targetBase,amplitude,currentMultiple,targets,
    baseDate:swingDate(rows[chosen.lowIndex]),highDate:swingDate(rows[chosen.highIndex]),pullbackDate:chosen.pb?.index>=0?swingDate(rows[chosen.pb.index]):"",reason:"短波只使用近期結構；動能分數決定可採用 1X／1.5X／2X 的哪一層，並受近端壓力與最大合理延伸限制。"};
}
function shortWaveTargetPlan(wave,score,price,atr,bollinger,macdLifecycle){
  if(!wave?.valid||!(price>0))return {reasonable:[],optimistic:null,optimisticEnabled:false,capPct:null,optimisticCapPct:null};
  const maxMultiple=score>=76?2:score>=62?1.5:1,atrPct=atr&&price?atr/price*100:2,
        capPct=stageClamp(5+atrPct*2+(score-50)*.08,5,16),optimisticCapPct=stageClamp(Math.max(capPct+12,capPct*2),12,35);
  const future=wave.targets.filter(x=>x.value>price*1.002),reasonable=future.filter(x=>x.multiple<=maxMultiple&&x.value<=price*(1+capPct/100)).map(x=>({...x,kind:"shortwave",targetClass:"reasonable"}));
  const lastReasonable=reasonable.at(-1)?.value??price,optMaxMultiple=score>=72?2:score>=58?1.5:1;
  const optimistic=future.filter(x=>x.value>lastReasonable*1.002&&x.multiple<=optMaxMultiple&&x.value<=price*(1+optimisticCapPct/100)).sort((a,b)=>a.value-b.value)[0]||null;
  const macdAttack=!macdLifecycle?.valid||["重新攻擊","攻擊擴張"].includes(macdLifecycle.state),optimisticEnabled=!!optimistic&&!!(bollinger?.upwardExpansion||bollinger?.trendExpansion)&&macdAttack;
  return {reasonable,optimistic:optimistic?{...optimistic,kind:"shortwave",targetClass:"optimistic",enabled:optimisticEnabled}:null,optimisticEnabled,capPct,optimisticCapPct};
}
function calculateShortEngine(r,t,breakout=playBreakoutState(r,t)){
  const rows=r?.path?.rows||stageHistory(t),price=stageNum(currentStock?.last??currentStock?.price??r?.price);if(rows.length<12||price===null)return {valid:false,state:"資料不足",score:0,tradeable:false};
  const ret1=shortReturnN(rows,1,price),ret3=shortReturnN(rows,3,price),ret5=shortReturnN(rows,5,price),ma5Slope=shortSmaSlope(rows,5,3),ma10Slope=shortSmaSlope(rows,10,3);
  const ratio20=stageNum(t?.volume?.ratio20),rsi=stageNum(t?.momentum?.rsi14),macd=shortMacdSnapshot(rows,price),kd=shortStochastic(rows),candle=shortCandleState(rows),news=shortNewsCatalyst();
  const high20=stageHigh(rows,20),high60=stageHigh(rows,60),upper=stageNum(t?.bollinger?.upper),atr=shortAtr(rows,10),pressureTargets=[],shortWave=calculateShortWave(rows,price),bollinger=bollingerPathSignal(rows,t,price,breakout),macdLifecycle=macdLifecycleSignal(rows,t,price,bollinger,breakout);
  for(const [label,value] of [["20日高",high20],["布林上軌",upper],["60日高",high60]])if(Number.isFinite(value)&&value>price*1.003&&!pressureTargets.some(x=>Math.abs(x.value/value-1)<.003))pressureTargets.push({label,value,kind:"pressure"});
  if(atr&&pressureTargets.length<2){pressureTargets.push({label:"波動延伸1",value:price+atr*1.2,kind:"pressure"},{label:"波動延伸2",value:price+atr*2,kind:"pressure"})}
  pressureTargets.sort((a,b)=>a.value-b.value);const resistance=pressureTargets[0]||null,resistancePct=resistance?stagePct(resistance.value,price):null;
  const ma5=stageNum(t?.ma?.ma5),ma10=stageNum(t?.ma?.ma10),support=stageNum(breakout?.confirmed?breakout.level:null)??ma10??ma5;
  let score=50;
  if(ret1!==null){if(ret1>=.5&&ret1<=4.5)score+=5;else if(ret1<=-2.5)score-=5}
  if(ret3!==null){if(ret3>=2&&ret3<=10)score+=7;else if(ret3<=-4)score-=7;else if(ret3>12)score-=2}
  if(ret5!==null){if(ret5>=3&&ret5<=15)score+=7;else if(ret5<=-6)score-=7;else if(ret5>=20)score-=7}
  if(ma5Slope!==null)score+=ma5Slope>.5?6:ma5Slope<-.5?-5:0;if(ma10Slope!==null)score+=ma10Slope>.25?4:ma10Slope<-.35?-4:0;if(ma5!==null&&ma10!==null)score+=ma5>=ma10?3:-3;
  if(ratio20!==null)score+=ratio20>=1.2&&ratio20<=2.8?8:ratio20>=1?3:ratio20<.7?-4:0;
  if(rsi!==null)score+=rsi>=55&&rsi<=72?6:rsi>=80?-9:rsi<42?-5:0;
  if(macd.hist!==null)score+=macd.hist>0?2:-2;if(macdLifecycle?.valid)score+=macdLifecycle.shortAdj;
  if(kd.k!==null&&kd.d!==null)score+=kd.k>kd.d&&kd.k>=45&&kd.k<=85?4:kd.k>=90?-4:kd.k<kd.d&&kd.k<45?-3:0;
  score+=candle.score;if(breakout?.confirmed)score+=12;else if(breakout?.failed)score-=24;else if(breakout?.fresh)score-=4;
  if(resistancePct!==null)score+=resistancePct>=2&&resistancePct<=9?5:resistancePct<1?-5:resistancePct>12?1:0;
  if(shortWave?.valid)score+=stageClamp((shortWave.quality-50)*.10,-4,6);
  if(bollinger?.valid){if(bollinger.upwardExpansion)score+=6;else if(bollinger.trendExpansion)score+=4;else if(bollinger.breakdown)score-=8}
  score=Math.round(playClamp(score));
  const shortPlan=shortWaveTargetPlan(shortWave,score,price,atr,bollinger,macdLifecycle),shortWaveTargets=shortPlan.reasonable,shortWaveOptimisticTarget=shortPlan.optimistic,targets=[...pressureTargets];
  for(const x of shortWaveTargets)if(!targets.some(y=>Math.abs(y.value/x.value-1)<.003))targets.push(x);
  if(shortWaveOptimisticTarget?.enabled&&!targets.some(y=>Math.abs(y.value/shortWaveOptimisticTarget.value-1)<.003))targets.push(shortWaveOptimisticTarget);targets.sort((a,b)=>a.value-b.value);
  const chaseRisk=(rsi!==null&&rsi>=80)||((ret5??0)>=18&&(rsi??0)>=74)||((ret3??0)>=8&&resistancePct!==null&&resistancePct<1.2);
  let state="偏強整理";
  if(breakout?.failed)state="疑似假突破";else if(breakout?.fresh&&!breakout?.confirmed)state="突破待確認";else if(chaseRisk)state="追價風險高";
  else if(macdLifecycle?.state==="重新攻擊"&&score>=58)state="重新攻擊";
  else if(macdLifecycle?.state==="攻擊擴張"&&score>=58)state="攻擊擴張";
  else if(macdLifecycle?.state==="長波蓄力")state="長波蓄力";
  else if(macdLifecycle?.state==="攻擊觀察")state="攻擊觀察";
  else if(macdLifecycle?.state==="動能降溫")state="動能降溫";
  else if(macdLifecycle?.state==="空方擴張")state="動能轉弱";
  else if(breakout?.confirmed&&(breakout.age??9)<=2&&score>=58)state="剛發動";else if(score>=72&&(ret3??0)>0)state="動能加速";else if(score<48||(ret3??0)<=-4)state="動能轉弱";
  const tradeable=!['疑似假突破','突破待確認','追價風險高','動能轉弱','長波蓄力','攻擊觀察','動能降溫'].includes(state),shortTargetCapPct=shortPlan.capPct,shortOptimisticCapPct=shortPlan.optimisticCapPct;
  return {valid:true,state,score,tradeable,holding:"3～5交易日",ret1,ret3,ret5,ma5Slope,ma10Slope,ratio20,rsi,macd,macdLifecycle,kd,candle,news,resistance,resistancePct,support,targets:targets.slice(0,5),pressureTargets:pressureTargets.slice(0,3),shortWave,shortWaveTargets,shortWaveOptimisticTarget,shortTargetCapPct,shortOptimisticCapPct,bollingerSignal:bollinger,breakout,chaseRisk};
}


// v2.5.8.8 — 新聞與目標價改成獨立 0～100 子分數，避免在其他模組重複加分。
function swingNewsSignal(){
  const rows=Array.isArray(newsRowsCache)?newsRowsCache:[];if(!rows.length)return {score:50,label:"新聞資料待補",count:0,available:false};
  const cutoff=Date.now()-60*86400000,fresh=rows.filter(x=>{const t=newsTime(x);return !t||t>=cutoff}).slice(0,24);
  const pos=/法說.*(?:上修|樂觀|成長)|展望.*(?:上修|樂觀|成長)|訂單|能見度|擴產|量產|客戶|認證|合作|營收.*(?:成長|年增|創高)|獲利.*(?:成長|年增|創高)|需求.*成長|資本支出/;
  const neg=/法說.*(?:下修|保守)|展望.*(?:下修|保守)|訂單.*(?:下修|減少)|需求.*(?:疲弱|下滑)|營收.*(?:衰退|年減|下滑)|獲利.*(?:衰退|下滑|虧損)|減產|延後|取消/;
  let p=0,n=0;for(const x of fresh){const text=`${x?.title||""} ${(x?.summaryPoints||[]).join(" ")}`;if(pos.test(text))p++;if(neg.test(text))n++}
  const score=Math.round(playClamp(50+Math.min(25,p*4)-Math.min(30,n*5)));
  return {score,label:p>n?`中期正向訊號 ${p} 則`:n>p?`中期風險訊號 ${n} 則`:`近60日新聞中性`,count:fresh.length,positive:p,negative:n,available:fresh.length>0};
}
function targetPlaySignal(price){
  const all=allTargetCandidates().slice(0,12),p=Number(price);if(!(p>0)||!all.length)return {score:50,label:"目標價資料待補",available:false,count:0,gap:null};
  const latest=all.map(x=>({price:targetPriceValue(x.latest),time:x.time,history:x.history})).filter(x=>Number.isFinite(x.price)&&x.price>0);
  if(!latest.length)return {score:50,label:"目標價資料待補",available:false,count:0,gap:null};
  const med=rhythmMedian(latest.map(x=>x.price)),gap=(med/p-1)*100;let score=50;
  if(gap>=30)score=88;else if(gap>=15)score=80;else if(gap>=5)score=68;else if(gap>=0)score=56;else if(gap>=-5)score=46;else if(gap>=-15)score=34;else score=22;
  const newest=Math.max(...latest.map(x=>x.time||0)),ageDays=newest>0?(Date.now()-newest)/86400000:null;
  if(ageDays!==null){if(ageDays<=30)score+=5;else if(ageDays<=90)score+=2;else if(ageDays>180)score-=6}
  let ups=0,downs=0;
  for(const x of latest){if((x.history||[]).length<2)continue;const a=targetPriceValue(x.history[0]),b=targetPriceValue(x.history[1]);if(!(a>0&&b>0))continue;if(a>b)ups++;else if(a<b)downs++}
  if(ups>downs)score+=Math.min(7,(ups-downs)*2);else if(downs>ups)score-=Math.min(7,(downs-ups)*2);
  score=Math.round(playClamp(score));
  return {score,label:`目標價中位空間 ${signedPercent(gap)}`,available:true,count:latest.length,gap,median:med,ageDays,ups,downs};
}

// v2.5.9.6 — 長期基本面 v3：官方財報／月營收優先；缺資料不再把剩餘權重放大。
function longFundamentalNewsSignal(){
  const rows=Array.isArray(newsRowsCache)?newsRowsCache:[];if(!rows.length)return {score:50,label:"新聞資料待補",detail:"展望／訂單／產能資料待補",count:0,available:false};
  const cutoff=Date.now()-120*86400000,fresh=rows.filter(x=>{const t=newsTime(x);return !t||t>=cutoff}).slice(0,36);
  const positive=/營收.*(?:成長|年增|創高)|EPS.*(?:成長|優於|創高)|獲利.*(?:成長|年增|創高)|訂單.*(?:增加|成長|強勁|回升|滿載|能見度|優於)|能見度.*(?:佳|提升|延長)|擴產|量產|新產品|新技術|客戶.*(?:新增|擴大|導入)|認證|合作|需求.*(?:成長|回升|強勁)|毛利率.*(?:提升|改善)|展望.*(?:上修|樂觀|成長)|法說.*(?:上修|樂觀|成長)/;
  const negative=/營收.*(?:衰退|年減|下滑)|EPS.*(?:衰退|下滑|虧損)|獲利.*(?:衰退|下滑|虧損)|減產|訂單.*(?:下修|減少)|需求.*(?:疲弱|下滑)|毛利率.*(?:下滑|惡化)|延後|取消|展望.*(?:下修|保守)|法說.*(?:下修|保守)/;
  const cats={outlook:0,orders:0,capacity:0,industry:0};let p=0,n=0;
  for(const x of fresh){const text=`${x?.title||""} ${(x?.summaryPoints||[]).join(" ")}`;if(positive.test(text))p++;if(negative.test(text))n++;if(/法說|展望|財測|預估|營運.*(?:成長|改善|轉強|保守)/.test(text))cats.outlook++;if(/訂單|接單|能見度|出貨|需求/.test(text))cats.orders++;if(/產能|擴產|量產|稼動率|資本支出/.test(text))cats.capacity++;if(/產業|市場需求|供需|AI|CPO|CoWoS|先進封裝|ASIC|散熱|玻璃基板/.test(text))cats.industry++}
  const raw=50+Math.min(15,p*3)-Math.min(18,n*4),score=Math.round(playClamp(raw));
  const label=p>n?`基本面正向訊號 ${p} 則`:n>p?`基本面風險訊號 ${n} 則`:`近120日基本面新聞中性`;
  const catText=[["展望",cats.outlook],["訂單",cats.orders],["產能",cats.capacity],["產業",cats.industry]].filter(x=>x[1]>0).map(x=>`${x[0]} ${x[1]}`).join("｜"),detail=`${label}${catText?`｜${catText}`:""}`;
  return {score,label,detail,count:fresh.length,positive:p,negative:n,categories:cats,available:fresh.length>0};
}
function fundamentalPair(cur,base,kind="eps"){
  const c=valuationNum(cur),b=valuationNum(base);if(c===null||b===null)return {available:false,score:50,label:"--",pct:null,state:null};
  if(kind==="eps"){
    if(b===0)return {available:false,score:c>0?92:c<0?12:50,label:"--",pct:null,state:c>0?"轉盈":c<0?"轉虧":"持平"};
    const pct=b<0?(c-b)/Math.abs(b)*100:(c/b-1)*100;
    if(c>0&&b<0)return {available:true,score:92,label:signedPercent(pct),pct,state:"轉盈"};
    if(c<=0&&b>0)return {available:true,score:12,label:signedPercent(pct),pct,state:"轉虧"};
    if(c<=0&&b<0)return {available:true,score:c>b?58:28,label:signedPercent(pct),pct,state:c>b?"虧損收斂":"虧損擴大"};
    const score=pct>=50?92:pct>=25?85:pct>=10?76:pct>=0?64:pct>=-10?50:pct>=-25?35:20;
    return {available:true,score,label:signedPercent(pct),pct,state:null};
  }
  if(!(b>0))return {available:false,score:50,label:"--",pct:null,state:null};
  const pct=(c/b-1)*100,score=pct>=30?90:pct>=15?82:pct>=5?72:pct>=0?62:pct>=-5?50:pct>=-15?35:20;
  return {available:true,score,label:signedPercent(pct),pct,state:null};
}
function marginSignal(cur,yearAgo){
  const c=valuationNum(cur),b=valuationNum(yearAgo);if(c===null)return {available:false,score:50,delta:null};if(b===null)return {available:true,score:50,delta:null};
  const d=c-b,score=d>=3?86:d>=1?76:d>=0?64:d>=-1?50:d>=-3?34:20;return {available:true,score,delta:d};
}
function medianNums(a){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
function fundamentalPctSignal(pct,kind="revenue"){
  const p=valuationNum(pct);if(p===null)return {available:false,score:50,label:"--",pct:null};let score;
  if(kind==="revenue")score=p>=30?90:p>=15?82:p>=5?72:p>=0?62:p>=-5?50:p>=-15?35:20;
  else score=p>=50?92:p>=25?85:p>=10?76:p>=0?64:p>=-10?50:p>=-25?35:20;
  return {available:true,score,label:signedPercent(p),pct:p};
}
function longQuantitativeFundamentals(v){
  const data=latestFundamentalData||{},rows=fundamentalSortedRows(data),off=data?.officialStatement||null,monthly=data?.monthlyRevenue||null;
  const eps=rows.map(x=>valuationNum(x.eps)),rev=rows.map(fundamentalRevenueValue),gm=rows.map(x=>fundamentalMarginValue(x,"gross")),om=rows.map(x=>fundamentalMarginValue(x,"operating"));
  const yoyEps=fundamentalPair(eps[0],eps[4],"eps"),qoqEps=fundamentalPair(eps[0],eps[1],"eps"),ttmNow=eps.slice(0,4).filter(Number.isFinite),ttmPrev=eps.slice(4,8).filter(Number.isFinite),ttmPair=ttmNow.length===4&&ttmPrev.length===4?fundamentalPair(ttmNow.reduce((a,b)=>a+b,0),ttmPrev.reduce((a,b)=>a+b,0),"eps"):{available:false,score:50,label:"--",pct:null};
  const epsSignals=[[yoyEps,.65],[qoqEps,.20],[ttmPair,.15]].filter(x=>x[0].available),epsW=epsSignals.reduce((a,x)=>a+x[1],0),officialEps=valuationNum(off?.eps);
  let epsScore=epsW?Math.round(epsSignals.reduce((a,x)=>a+x[0].score*x[1],0)/epsW):null;
  if(epsScore===null&&officialEps!==null)epsScore=officialEps>0?62:officialEps===0?45:25;

  const yoyRev=fundamentalPair(rev[0],rev[4],"revenue"),revYoys=[];for(let i=0;i<Math.min(4,rev.length-4);i++){const z=fundamentalPair(rev[i],rev[i+4],"revenue");if(z.available&&Number.isFinite(z.pct))revYoys.push(z.pct)}
  const revTrendPct=medianNums(revYoys),revTrendScore=revTrendPct===null?null:(revTrendPct>=20?86:revTrendPct>=10?78:revTrendPct>=3?68:revTrendPct>=0?60:revTrendPct>=-8?46:30);
  const quarterlyRevenueScore=yoyRev.available?Math.round(revTrendScore===null?yoyRev.score:yoyRev.score*.7+revTrendScore*.3):null;
  const monthYoy=fundamentalPctSignal(fundamentalMonthlyPct(monthly,"yoy"),"revenue"),cumYoy=fundamentalPctSignal(fundamentalMonthlyPct(monthly,"cumulative"),"revenue");
  const officialRevSignals=[[monthYoy,.7],[cumYoy,.3]].filter(x=>x[0].available),officialRevW=officialRevSignals.reduce((a,x)=>a+x[1],0),officialRevenueScore=officialRevW?Math.round(officialRevSignals.reduce((a,x)=>a+x[0].score*x[1],0)/officialRevW):null;
  let revenueScore=officialRevenueScore!==null?(quarterlyRevenueScore!==null?Math.round(officialRevenueScore*.75+quarterlyRevenueScore*.25):officialRevenueScore):quarterlyRevenueScore;

  const marginApplicable=off?.marginApplicable!==false,officialGm=fundamentalMarginValue(off,"gross"),officialOm=fundamentalMarginValue(off,"operating"),seriesGross=marginSignal(gm[0],gm[4]),seriesOperating=marginSignal(om[0],om[4]);
  let gross={available:false,score:50,delta:null},operating={available:false,score:50,delta:null};
  if(marginApplicable){
    if(seriesGross.available)gross=seriesGross;else if(officialGm!==null)gross={available:true,score:50,delta:null};
    if(seriesOperating.available)operating=seriesOperating;else if(officialOm!==null)operating={available:true,score:50,delta:null};
  }

  const posEps=eps.slice(0,8).filter(Number.isFinite),positive=posEps.filter(x=>x>0).length;let stabilityScore=null;if(posEps.length>=4){const ratio=positive/posEps.length;stabilityScore=ratio>=1?86:ratio>=.875?80:ratio>=.75?72:ratio>=.625?62:ratio>=.5?50:ratio>=.375?38:25;if(ttmPair.available)stabilityScore=playClamp(stabilityScore+(ttmPair.score>=64?5:ttmPair.score<=35?-7:0))}

  const fallbackQ=(Array.isArray(v?.latest4)?v.latest4:[]).map(x=>valuationNum(x?.eps)).filter(Number.isFinite).slice(0,4),fallbackTtm=valuationNum(v?.ttm);
  if(epsScore===null&&fallbackQ.length){let old=50,positiveQ=fallbackQ.filter(x=>x>0).length;if(fallbackTtm!==null)old+=fallbackTtm>0?8:-18;old+=positiveQ===fallbackQ.length?10:positiveQ>=3?6:positiveQ===2?0:-10;epsScore=Math.round(playClamp(old))}
  if(stabilityScore===null&&fallbackQ.length>=4){const r=fallbackQ.filter(x=>x>0).length/fallbackQ.length;stabilityScore=r===1?80:r>=.75?68:r>=.5?50:30}

  // 一般業固定保留完整權重；缺一欄給中性 50，不把剩餘欄位放大。金融／金控／保險等毛利率不適用，使用明確的產業版權重。
  let weights;
  if(off&&off.marginApplicable===false)weights=[['eps',epsScore,.40],['revenue',revenueScore,.30],['stability',stabilityScore,.30]];
  else weights=[['eps',epsScore,.30],['revenue',revenueScore,.25],['gross',gross.available?gross.score:null,.15],['operating',operating.available?operating.score:null,.15],['stability',stabilityScore,.15]];
  const score=Math.round(playClamp(weights.reduce((a,x)=>a+(x[1]??50)*x[2],0)));

  const epsCount=eps.filter(Number.isFinite).length,revCount=rev.filter(Number.isFinite).length,gmCount=gm.filter(Number.isFinite).length,omCount=om.filter(Number.isFinite).length;
  let coverage=0;if(epsCount>=8)coverage+=15;else if(epsCount>=5)coverage+=11;else if(officialEps!==null||fallbackQ.length>=4)coverage+=8;
  if(monthYoy.available||cumYoy.available)coverage+=10;else if(revCount>=5)coverage+=7;
  if(off){if(off.marginApplicable===false)coverage+=10;else{if(officialGm!==null||gmCount>=5)coverage+=5;if(officialOm!==null||omCount>=5)coverage+=5}}
  else{if(gmCount>=5)coverage+=5;if(omCount>=5)coverage+=5}
  if(posEps.length>=6||fallbackQ.length>=4)coverage+=5;coverage=Math.min(40,coverage);

  const epsText=epsCount>=2?`YoY ${yoyEps.label}｜QoQ ${qoqEps.label}${ttmPair.available?`｜TTM ${ttmPair.label}`:""}`:officialEps!==null?`官方累計 EPS ${valuationEpsFmt(officialEps)}${off?.period?`｜${off.period}`:""}`:(fallbackQ.length?`近4季 ${fallbackQ.filter(x=>x>0).length}/${fallbackQ.length} 季為正${fallbackTtm!==null?`｜TTM ${valuationEpsFmt(fallbackTtm)}`:""}`:"EPS資料不足");
  let revenueText="營收成長資料不足";if(monthYoy.available||cumYoy.available)revenueText=`月營收 YoY ${monthYoy.label}${cumYoy.available?`｜累計 YoY ${cumYoy.label}`:""}${monthly?.period?`｜${monthly.period}`:""}`;else if(yoyRev.available)revenueText=`季營收 YoY ${yoyRev.label}${revTrendPct!==null?`｜近4季YoY中位 ${signedPercent(revTrendPct)}`:""}`;
  const gm0=Number.isFinite(gm[0])&&Math.abs(gm[0])>=0.05?gm[0]:null,om0=Number.isFinite(om[0])&&Math.abs(om[0])>=0.05?om[0]:null;
  let marginText;if(off?.marginApplicable===false)marginText=`${off?.financialTypeLabel||"金融類"}｜毛利率／營益率不適用`;else if(officialGm!==null||officialOm!==null)marginText=`毛利 ${officialGm!==null?`${officialGm.toFixed(1)}%`:"--"}｜營益 ${officialOm!==null?`${officialOm.toFixed(1)}%`:"--"}｜官方累計${off?.period?` ${off.period}`:""}`;else if(gm0!==null||om0!==null)marginText=`毛利 ${gm0!==null?`${gm0.toFixed(1)}%${seriesGross.delta!==null?` (${seriesGross.delta>=0?"+":""}${seriesGross.delta.toFixed(1)}pp)`:""}`:"--"}｜營益 ${om0!==null?`${om0.toFixed(1)}%${seriesOperating.delta!==null?` (${seriesOperating.delta>=0?"+":""}${seriesOperating.delta.toFixed(1)}pp)`:""}`:"--"}`;else marginText="利潤率資料不足";
  const stabilityText=posEps.length>=4?`近${posEps.length}季 ${positive}/${posEps.length} 季EPS為正${ttmPair.available?`｜TTM ${ttmPair.label}`:""}`:fallbackQ.length>=4?`近4季 ${fallbackQ.filter(x=>x>0).length}/4 季EPS為正`:"獲利穩定度資料不足";
  const sourceText=data?.source||([off||monthly?"TWSE／TPEx官方":"",rows.length?"Yahoo歷史補充":""].filter(Boolean).join("＋")||"基本面來源待補");
  return {score,coverage,rows,epsCount,revCount,gmCount,omCount,epsScore,revenueScore,grossScore:gross.available?gross.score:null,operatingScore:operating.available?operating.score:null,stabilityScore,epsText,revenueText,marginText,stabilityText,yoyEps,qoqEps,ttmPair,yoyRev,revTrendPct,latest:rows[0]||{},officialStatement:off,monthlyRevenue:monthly,sourceText};
}
function fundamentalAvg(a){const x=(a||[]).filter(Number.isFinite);return x.length?x.reduce((s,n)=>s+n,0)/x.length:null}
function fundamentalStd(a){const x=(a||[]).filter(Number.isFinite);if(x.length<2)return null;const m=fundamentalAvg(x);return Math.sqrt(x.reduce((s,n)=>s+(n-m)*(n-m),0)/x.length)}
function fundamentalYoySeries(rows,getter,kind){const out=[];for(let i=0;i<Math.min(4,Math.max(0,rows.length-4));i++){const x=fundamentalPair(getter(rows[i]),getter(rows[i+4]),kind);if(x.available&&Number.isFinite(x.pct))out.push(x.pct)}return out}
function fundamentalTrendAssessment(fund){
  const rows=fund?.rows||[],epsSeries=fundamentalYoySeries(rows,x=>valuationNum(x?.eps),"eps"),revSeries=fundamentalYoySeries(rows,fundamentalRevenueValue,"revenue"),signals=[];
  const one=arr=>{if(!arr.length)return null;const recent=fundamentalAvg(arr.slice(0,Math.min(2,arr.length))),older=arr.length>=4?fundamentalAvg(arr.slice(2,4)):arr.length>=2?arr.at(-1):null;return {recent,older,delta:Number.isFinite(recent)&&Number.isFinite(older)?recent-older:null}};
  const e=one(epsSeries),r=one(revSeries);if(e&&Number.isFinite(e.delta))signals.push({delta:e.delta,current:e.recent,w:.55});if(r&&Number.isFinite(r.delta))signals.push({delta:r.delta,current:r.recent,w:.45});
  if(!signals.length){const month=fundamentalMonthlyPct(fund?.monthlyRevenue,"yoy"),cum=fundamentalMonthlyPct(fund?.monthlyRevenue,"cumulative");if(month!==null&&cum!==null)signals.push({delta:month-cum,current:month,w:1})}
  if(!signals.length)return {available:false,label:"趨勢資料不足",score:50,delta:null,current:null,note:"需要較完整的季度／月營收成長序列"};
  const tw=signals.reduce((s,x)=>s+x.w,0),delta=signals.reduce((s,x)=>s+x.delta*x.w,0)/tw,current=signals.reduce((s,x)=>s+x.current*x.w,0)/tw;
  let label,score;if(current>=5&&delta>=8){label="加速成長";score=88}else if(current>=5&&delta>-8){label="穩定成長";score=76}else if(current>=0&&delta<=-8){label="成長減速";score=52}else if(current<0&&delta>=8){label="衰退改善";score=62}else if(current<0){label="持續衰退";score=28}else{label="成長持平";score=58}
  return {available:true,label,score,delta,current,note:`目前成長 ${signedPercent(current)}｜動能變化 ${signedPercent(delta)}`};
}
function fundamentalProfitQuality(fund){
  const rows=fund?.rows||[],off=fund?.officialStatement||{},marginApplicable=off?.marginApplicable!==false,grossNow=fundamentalMarginFromSources("gross",off,rows[0],latestFundamentalData?.financialData),opNow=fundamentalMarginFromSources("operating",off,rows[0],latestFundamentalData?.financialData),grossAgo=fundamentalMarginValue(rows[4],"gross"),opAgo=fundamentalMarginValue(rows[4],"operating"),grossDelta=grossNow!==null&&grossAgo!==null?grossNow-grossAgo:null,opDelta=opNow!==null&&opAgo!==null?opNow-opAgo:null;
  const epsPct=Number.isFinite(fund?.yoyEps?.pct)?fund.yoyEps.pct:null,revPct=Number.isFinite(fund?.yoyRev?.pct)?fund.yoyRev.pct:fundamentalMonthlyPct(fund?.monthlyRevenue,"yoy");
  let bridge=null;if(epsPct!==null&&revPct!==null)bridge=stageClamp(55+(epsPct-revPct)*.25,25,85);
  const parts=[];if(marginApplicable&&fund?.grossScore!==null)parts.push([fund.grossScore,.25]);if(marginApplicable&&fund?.operatingScore!==null)parts.push([fund.operatingScore,.40]);if(bridge!==null)parts.push([bridge,.35]);if(!parts.length&&Number.isFinite(fund?.epsScore))parts.push([fund.epsScore,.6],[fund?.revenueScore??50,.4]);
  const tw=parts.reduce((s,x)=>s+x[1],0),score=tw?Math.round(playClamp(parts.reduce((s,x)=>s+x[0]*x[1],0)/tw)):50;
  let label=score>=78?"獲利品質改善":score>=64?"獲利品質穩健":score>=48?"獲利品質普通":"獲利品質惡化";
  const notes=[];if(grossDelta!==null)notes.push(`毛利 ${grossDelta>=0?"+":""}${grossDelta.toFixed(1)}pp`);if(opDelta!==null)notes.push(`營益 ${opDelta>=0?"+":""}${opDelta.toFixed(1)}pp`);if(bridge!==null)notes.push(`EPS/營收差 ${signedPercent(epsPct-revPct)}`);
  return {score,label,grossDelta,opDelta,bridge,note:notes.join("｜")||(marginApplicable?"利潤率序列不足":"金融類以獲利／營收成長替代利潤率")};
}
function fundamentalStabilityAssessment(fund){
  const eps=(fund?.rows||[]).map(x=>valuationNum(x?.eps)).filter(Number.isFinite).slice(0,8),epsYoy=fundamentalYoySeries(fund?.rows||[],x=>valuationNum(x?.eps),"eps"),revYoy=fundamentalYoySeries(fund?.rows||[],fundamentalRevenueValue,"revenue");
  const positiveScore=Number.isFinite(fund?.stabilityScore)?fund.stabilityScore:50,stds=[fundamentalStd(epsYoy),fundamentalStd(revYoy)].filter(Number.isFinite),std=stds.length?fundamentalAvg(stds):null,consistency=std===null?50:std<=12?90:std<=22?80:std<=35?68:std<=55?54:38,score=Math.round(playClamp(positiveScore*.60+consistency*.40));
  const positive=eps.filter(x=>x>0).length,label=score>=80?"高穩定":score>=65?"中高穩定":score>=50?"一般穩定":"高波動";
  return {score,label,std,note:`近${eps.length||"--"}季 ${positive}/${eps.length||"--"} 季 EPS 為正${std!==null?`｜成長波動 ${std.toFixed(1)}`:""}`};
}
function fundamentalRiskAssessment(fund,trend,quality){
  const risks=[];let points=0,month=fundamentalMonthlyPct(fund?.monthlyRevenue,"yoy"),rev=month!==null?month:(fund?.yoyRev?.pct??null),eps=fund?.yoyEps?.pct??null;
  if(fund?.yoyEps?.state==="轉虧"){points+=38;risks.push("EPS轉虧")}else if(Number.isFinite(eps)&&eps<=-25){points+=24;risks.push("EPS明顯衰退")}
  if(Number.isFinite(rev)&&rev<=-15){points+=24;risks.push("營收明顯衰退")}else if(Number.isFinite(rev)&&rev<0){points+=10;risks.push("營收負成長")}
  if(Number.isFinite(quality?.grossDelta)&&quality.grossDelta<=-3){points+=12;risks.push("毛利率惡化")}
  if(Number.isFinite(quality?.opDelta)&&quality.opDelta<=-3){points+=20;risks.push("營益率惡化")}
  if(trend?.label==="成長減速"){points+=10;risks.push("成長減速")}if(trend?.label==="持續衰退"){points+=16;risks.push("持續衰退")}
  points=Math.round(stageClamp(points,0,100));const label=points>=56?"高":points>=26?"中":"低",tone=label==="高"?"bad":label==="中"?"watch":"good";
  return {score:points,label,tone,items:risks,note:risks.length?risks.slice(0,3).join("、"):"暫無明顯基本面惡化訊號"};
}
function valuationFundamentalAssessment(v=latestValuationData||{}){
  const vr=playValuationResult(),scenario=latestValuationScenario,profile=scenario?.profile||null,price=valuationNum(scenario?.P??v?.last),fair=valuationNum(profile?.center??scenario?.F),gap=price&&fair?(fair/price-1)*100:null;
  let attractiveness=Number.isFinite(profile?.attractiveness)?profile.attractiveness:50;
  if(!Number.isFinite(profile?.attractiveness)){
    if(gap!==null)attractiveness=gap>=30?90:gap>=15?82:gap>=5?72:gap>=-5?60:gap>=-15?46:gap>=-25?32:20;
    const legacyState=vr?.state||"估值資料不足";if(["明顯高估","全面高估"].includes(legacyState))attractiveness=Math.min(attractiveness,28);if(["低估偏多","雙重低估"].includes(legacyState))attractiveness=Math.max(attractiveness,78);if(vr?.confidence==='低')attractiveness=Math.round((attractiveness+50)/2);
  }
  attractiveness=Math.round(playClamp(attractiveness));const pressure=Number.isFinite(profile?.pressure)?profile.pressure:100-attractiveness,pressureLabel=profile?.pressureLabel||(pressure>=70?"高":pressure>=48?"中":"低"),state=profile?.position||vr?.state||"估值資料不足";
  const fields=[scenario?.P,scenario?.O,scenario?.B,scenario?.F,v?.ttm,v?.bookValue].filter(x=>valuationNum(x)!==null).length,dataCoverage=Math.round(fields/6*100),estimateConfidence=Number.isFinite(profile?.confidence)?profile.confidence:null;
  const rangeText=profile?.available&&profile.low>0&&profile.high>0?`${valuationFmt(profile.low)}～${valuationFmt(profile.high)}`:null;
  return {available:gap!==null||!!vr,attractiveness,pressure,pressureLabel,state,gap,confidence:dataCoverage,estimateConfidence,range:profile,note:gap===null?state:`${state}｜合理價空間 ${signedPercent(gap)}${rangeText?`｜合理區 ${rangeText}`:""}`};
}

function buildFundamentalAssessment(fund=longQuantitativeFundamentals(latestValuationData||{}),v=latestValuationData||{}){
  const growthParts=[[fund?.epsScore,.55],[fund?.revenueScore,.45]].filter(x=>Number.isFinite(x[0])),gw=growthParts.reduce((s,x)=>s+x[1],0),growthStrength=gw?Math.round(playClamp(growthParts.reduce((s,x)=>s+x[0]*x[1],0)/gw)):50;
  const trend=fundamentalTrendAssessment(fund),quality=fundamentalProfitQuality(fund),stability=fundamentalStabilityAssessment(fund),risk=fundamentalRiskAssessment(fund,trend,quality),valuation=valuationFundamentalAssessment(v);
  const companyQuality=Math.round(playClamp(growthStrength*.35+quality.score*.35+stability.score*.30)),continuation=Math.round(playClamp(growthStrength*.35+trend.score*.25+quality.score*.25+stability.score*.15-risk.score*.12));
  const operationalConfidence=Math.round(stageClamp((Number(fund?.coverage)||0)/40*100,0,100)),dataConfidence=Math.round(operationalConfidence*.70+valuation.confidence*.30),priceAttractiveness=valuation.attractiveness;
  const corePct=Math.round(stageClamp(companyQuality*.65+priceAttractiveness*.35-risk.score*.08,15,90));
  const companyLabel=companyQuality>=78?"強":companyQuality>=64?"中強":companyQuality>=50?"普通":"弱",continuationLabel=continuation>=76?"高":continuation>=58?"中":"低";
  return {growthStrength,trend,profitQuality:quality,stability,risk,valuation,companyQuality,companyLabel,continuation,continuationLabel,priceAttractiveness,dataConfidence,operationalConfidence,corePct};
}
function fundamentalResonanceAdjustment(assessment,mode="swing"){
  if(!assessment)return {points:0,label:"基本面待補"};const trust=stageClamp((assessment.dataConfidence||0)/100,.25,1),op=((assessment.continuation-50)/50)*8,val=((assessment.priceAttractiveness-50)/50)*3,riskPenalty=assessment.risk.score>50?(assessment.risk.score-50)/50*3:0,scale=mode==="long"?1:mode==="long-swing"?.9:mode==="swing"?.65:mode==="mixed"?.4:.2,points=Math.round(stageClamp((op+val-riskPenalty)*trust*scale,-12,10));
  return {points,label:`營運${assessment.companyLabel}｜延續性${assessment.continuationLabel}｜估值壓力${assessment.valuation.pressureLabel}`};
}
function calculateLongEngine(r,t,personality=null,targetSignal=null){
  const v=latestValuationData||{},scenario=latestValuationScenario,rows=r?.path?.rows||stageHistory(t),path=r?.path||{},fund=longQuantitativeFundamentals(v),basicAssessment=buildFundamentalAssessment(fund,v),earnings=fund.score;
  const fair=valuationNum(scenario?.F),price=stageNum(currentStock?.last??currentStock?.price??r?.price),target=currentTargetPrice(),fairGap=price>0&&fair>0?(fair/price-1)*100:null,targetGap=price>0&&target>0?(target/price-1)*100:null;
  let trend=50;const ma60Slope=path.ma60Slope20,ret120=path.ret120??stageRet(rows,Math.min(120,Math.max(1,rows.length-1)));
  if(r?.flags?.above60===true)trend+=10;else if(r?.flags?.above60===false)trend-=10;if(Number.isFinite(ma60Slope))trend+=ma60Slope>1?12:ma60Slope>0?6:ma60Slope<-1?-12:-6;if(Number.isFinite(ret120))trend+=ret120>=25?12:ret120>=8?7:ret120<=-20?-12:ret120<0?-5:0;if(r?.stage===5)trend-=5;if(r?.flags?.lifecycleReset)trend-=12;trend=Math.round(playClamp(trend));
  const news=longFundamentalNewsSignal(),value=basicAssessment.priceAttractiveness,score=Math.round(playClamp(basicAssessment.companyQuality*.55+value*.20+trend*.15+news.score*.10));
  let completeness=Math.round(stageClamp(basicAssessment.dataConfidence*.75+(rows.length>=100?15:rows.length>=60?8:0)+(news.available?10:0),0,100));
  const valuationDanger=basicAssessment.valuation.pressureLabel==="高",eligible=completeness>=65&&basicAssessment.companyQuality>=64&&value>=35&&!valuationDanger&&!r?.flags?.lifecycleReset;
  let state=completeness<60?"資料仍不足":basicAssessment.companyQuality>=78&&value>=45?"基本面條件佳":basicAssessment.companyQuality>=64?"營運佳、留意估值":basicAssessment.companyQuality>=50?"基本面普通":"基本面偏弱";
  const valuationText=basicAssessment.valuation.note,trendText=`MA60 ${Number.isFinite(ma60Slope)?stageFmtPct(ma60Slope):"--"}${Number.isFinite(ret120)?`｜120日 ${stageFmtPct(ret120)}`:""}`;
  return {valid:true,score,completeness,eligible,state,earnings,value,personalityScore:personality?.valid?(personality.longFit??50):50,trend,targetScore:targetSignal?.score??50,news,fundamentals:fund,basicAssessment,earningsText:fund.epsText,revenueText:fund.revenueText,marginText:fund.marginText,stabilityText:fund.stabilityText,valuationText,trendText,fairGap,targetGap,ttm:valuationNum(v.ttm)};
}
function calibratePlayScore(raw){return Math.round(playClamp(Number(raw)||50));}
function fundamentalCoreTendency(longEngine){
  const a=longEngine?.basicAssessment;if(!a)return {available:false,corePct:50,label:"基本面資料不足"};
  const trust=stageClamp((a.dataConfidence||0)/100,.35,1),core=50+(a.corePct-50)*trust;
  return {available:true,corePct:Math.round(core),label:`基本面｜公司${a.companyLabel}・估值壓力${a.valuation.pressureLabel}・可信度${a.dataConfidence}%`};
}
function targetCoreTendency(targetSignal){
  const gap=Number(targetSignal?.gap);if(!targetSignal?.available||!Number.isFinite(gap))return {available:false,corePct:50,label:"目標價資料不足"};
  const core=gap>=50?78:gap>=30?72:gap>=15?64:gap>=5?57:gap>=0?50:gap>=-5?44:gap>=-15?34:24;
  return {available:true,corePct:core,label:`目標價空間 ${signedPercent(gap)}`};
}
function profileFromCorePct(corePct){
  const core=Math.round(stageClamp(corePct,10,90)/5)*5,tactical=100-core;
  if(core>=80)return {key:"long",label:"長期",period:"長期",basePct:core,tacticalPct:tactical,note:"核心倉為主，機動倉只做節奏調整"};
  if(core>=65)return {key:"long-swing",label:"長波",period:"長波",basePct:core,tacticalPct:tactical,note:"核心倉偏重，機動倉做中期波段調節"};
  if(core>=45)return {key:"swing",label:"波段",period:"波段",basePct:core,tacticalPct:tactical,note:"核心與機動接近，以完整波段管理部位"};
  if(core>=25)return {key:"mixed",label:"短波",period:"短波",basePct:core,tacticalPct:tactical,note:"機動倉偏重，保留部分核心並做短波調節"};
  return {key:"short",label:"短期",period:"短期",basePct:core,tacticalPct:tactical,note:"高機動配置，以短期節奏為主"};
}
function deriveFinalPositionProfile(longEngine,targetSignal){
  const tech=Number(latestTechnicalDirection?.hiddenPosition?.corePct),modules=[];
  if(Number.isFinite(tech))modules.push({key:"technical",name:"技術",corePct:tech,weight:.40,available:true});
  const fund=fundamentalCoreTendency(longEngine);if(fund.available)modules.push({key:"fundamental",name:"基本面",corePct:fund.corePct,weight:.45,available:true,label:fund.label});
  const target=targetCoreTendency(targetSignal);if(target.available)modules.push({key:"target",name:"目標價",corePct:target.corePct,weight:.15,available:true,label:target.label});
  if(!modules.length)return {...profileFromCorePct(50),modules:[],formula:"資料不足，暫以 50/50"};
  const tw=modules.reduce((a,b)=>a+b.weight,0),raw=modules.reduce((a,b)=>a+b.corePct*b.weight,0)/tw,profile=profileFromCorePct(raw);
  profile.modules=modules;profile.formula=modules.map(x=>`${x.name} ${Math.round(x.corePct)}%`).join("｜");return profile;
}

function calculatePlayStyle(r,t){
  if(!r)return null;
  const stage=r.stage,sub=r.substate||"",dirIndex=Number(latestTechnicalDirection?.index)||0,
        rsi=stageNum(t?.momentum?.rsi14),ratio20=stageNum(t?.volume?.ratio20),vr=playValuationResult(),price=stageNum(currentStock?.last??currentStock?.price??r?.price);
  const breakout=playBreakoutState(r,t),path=r.path||{},crosses=playMaCrossCount(path.rows||[],20,20),
        swingWave=calculateSwingWave(r,t,breakout),shortEngine=calculateShortEngine(r,t,breakout),personality=calculateStockPersonality((latestHistory5Y?.history?.length?latestHistory5Y.history:path.rows)||[]),
        targetSignal=targetPlaySignal(price),swingNews=swingNewsSignal(),longEngine=calculateLongEngine(r,t,personality,targetSignal);
  const rangeNoise=!!(r.flags?.tangled&&crosses>=3&&Math.abs(path.ret20??0)<=10);
  const overheated=stage===5||r.flags?.extremeHeat||(rsi!==null&&rsi>=80)||((r.bias20??0)>=18&&(rsi??0)>=74);
  const falseBreakout=breakout.fresh&&breakout.failed;
  const breakoutPending=breakout.fresh&&!breakout.confirmed&&!breakout.failed;
  const ma20Up=(path.ma20Slope10??-99)>.3,ma60Up=(path.ma60Slope20??-99)>0;
  const healthyTrend=(stage>=3&&stage<=4)&&(r.flags?.above60!==false)&&(ma20Up||ma60Up)&&!rangeNoise;
  const momentumBurst=!rangeNoise&&!overheated&&dirIndex>=25&&(rsi===null||(rsi>=52&&rsi<=76))&&(ratio20===null||ratio20>=1.05)&&(path.ret20??0)>=6;
  const strongShortPersonality=!!personality?.strongShort,strongSwingPersonality=!!personality?.strongSwing;
  const rhythmShortTrigger=!!(personality?.valid&&!personality.structuralReset&&(
    (personality.deepRhythm&&(personality.qualifyingShortCycles??0)>=2)||
    (personality.shortCycle&&(personality.cycles??0)>=2&&(personality.shortRhythmScore??0)>=60)||
    personality.burst||personality.hybridRhythm
  )&&shortEngine?.valid&&shortEngine?.tradeable!==false&&(shortEngine.score??0)>=55&&((path.ret20??0)>=0||(shortEngine.ret5??0)>=0||breakout.confirmed));

  let shortEligible=!overheated&&!falseBreakout&&stage>=2&&stage<=4&&shortEngine?.tradeable!==false&&((breakout.fresh&&breakout.confirmed&&breakout.age<=4)||momentumBurst||rhythmShortTrigger);
  let swingEligible=!overheated&&!falseBreakout&&stage>=2&&stage<=4&&(healthyTrend||(stage===2&&breakout.fresh&&breakout.confirmed&&ma20Up)||personality?.hybridRhythm);
  if(strongShortPersonality)swingEligible=false;
  if(strongSwingPersonality&&!breakout.confirmed&&!momentumBurst)shortEligible=false;
  if(rangeNoise&&!breakout.confirmed){shortEligible=false;swingEligible=false}
  if(breakoutPending){shortEligible=false;if(stage===2||rangeNoise)swingEligible=false}

  const histShort=personality?.valid?(personality.shortFit??50):50,histSwing=personality?.valid?(personality.swingFit??50):50;
  let stageShort=50,stageSwing=50;
  if(stage===1){stageShort=34;stageSwing=36}
  if(stage===2){stageShort=58;stageSwing=48}
  if(stage===3){stageShort=46;stageSwing=76}
  if(stage===4){stageShort=sub.includes("回測")?55:74;stageSwing=sub.includes("回測")?79:72}
  if(stage===5){stageShort=30;stageSwing=42}
  if(healthyTrend)stageSwing+=8;if(momentumBurst)stageShort+=10;if(breakout.confirmed){stageShort+=9;stageSwing+=2}if(rangeNoise){stageShort-=20;stageSwing-=20}
  stageShort=playClamp(stageShort);stageSwing=playClamp(stageSwing);

  let nowShort=shortEngine?.valid?(shortEngine.score??50):stageClamp(50+dirIndex*.45,0,100),nowSwing=stageClamp(50+dirIndex*.45,0,100);
  if(healthyTrend)nowSwing+=9;if(ma20Up)nowSwing+=4;if(ma60Up)nowSwing+=5;if(sub.includes("回測")&&!rangeNoise)nowSwing+=5;
  if(swingWave?.valid)nowSwing+=stageClamp((swingWave.quality-50)*.20,-8,10);if(breakout.confirmed)nowSwing+=2;if(overheated){nowShort-=22;nowSwing-=14}
  nowShort=playClamp(nowShort);nowSwing=playClamp(nowSwing);

  // v2.5.8.8：三玩法直接用獨立 0～100 子分數加權，不再乘 1.35，也不再用額外 bonus 重複加分。
  const shortNewsFit=shortEngine?.news?.fit??50;
  const short=calibratePlayScore(histShort*.30+nowShort*.35+stageShort*.20+shortNewsFit*.15);
  const swing=calibratePlayScore(histSwing*.30+nowSwing*.30+stageSwing*.20+(targetSignal?.score??50)*.10+(swingNews?.score??50)*.10);
  const long=calibratePlayScore(longEngine?.score??50);
  const scores={short,swing,long},eligible={short:shortEligible,swing:swingEligible,long:!!longEngine?.eligible};
  const operationProfile=deriveFinalPositionProfile(longEngine,targetSignal);
  const diagnostics={breakout,rangeNoise,crosses,falseBreakout,breakoutPending,healthyTrend,momentumBurst,rhythmShortTrigger,strongShortPersonality,strongSwingPersonality,overheated,stage,sub,ma20Up,ma60Up,weights:{technical:"技術40%",fundamental:"基本面45%（含營運＋估值）",target:"目標價15%"},shortEngine,personality,targetSignal,swingNews,longEngine};
  const common={scores,eligible,vr,swingWave,shortEngine,personality,targetSignal,swingNews,longEngine,operationProfile,diagnostics};

  // v2.6.1.3：短期／短波／波段／長波／長期只負責顯示；真正主參數是最終核心倉／機動倉比例。
  const key=operationProfile?.key||"swing",period=operationProfile?.period||"波段";
  const action=operationProfile?.note||"依核心／機動比例管理部位";
  const reason=`核心 ${operationProfile?.basePct??50}%｜機動 ${operationProfile?.tacticalPct??50}%｜${operationProfile?.formula||"等待模組資料"}`;
  return {key,period,action,reason,...common};
}

function swingWaveSvg(tag,attrs={},text=""){
  const el=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));
  if(text!=="")el.textContent=text;
  return el;
}
function swingWaveFmt(v){return Number.isFinite(v)?technicalFmt(v):"--"}
function swingWaveLabel(svg,x,y,title,value,color,anchor="middle",extra=""){
  const g=swingWaveSvg("g");
  const t1=swingWaveSvg("text",{x,y,fill:color,class:"swing-wave-label","text-anchor":anchor},title);
  const t2=swingWaveSvg("text",{x,y:y+15,fill:"#eef6fb",class:"swing-wave-value","text-anchor":anchor},value);
  g.append(t1,t2);
  if(extra){g.append(swingWaveSvg("text",{x,y:y+28,fill:color,class:"swing-wave-multiple","text-anchor":anchor},extra))}
  svg.append(g);
}
function drawSwingWave(w,price,position=null){
  const svg=$("playSwingSvg");if(!svg)return;svg.replaceChildren();if(!w?.valid)return;
  const allLegs=w.waveLegs||[],legs=allLegs.length<=4?allLegs:[allLegs[0],...allLegs.slice(-3)],actual=[];
  if(legs.length){
    actual.push({key:"A",title:"結構起點",value:legs[0].low,color:"#35e5e7",kind:"low"});
    for(const leg of legs){
      actual.push({key:`H${leg.number}`,title:`第${leg.number}波高點`,value:leg.high,color:"#c46cff",kind:"high",wave:leg.number});
      if(Number.isFinite(leg.pullbackLow))actual.push({key:`L${leg.number}`,title:`第${leg.number}回測`,value:leg.pullbackLow,color:"#63a9ff",kind:"low",wave:leg.number});
    }
  }else{
    actual.push({key:"A",title:"起漲低點",value:w.baseLow,color:"#35e5e7",kind:"low"},{key:"B",title:"第一波高點",value:w.firstWave,color:"#c46cff",kind:"high"});
    if(Number.isFinite(w.pullbackLow))actual.push({key:"C",title:"第一回測",value:w.pullbackLow,color:"#63a9ff",kind:"low"});
  }
  // 避免回測低點同時又作下一波起點時重複畫點。
  const dedup=[];for(const n of actual){const prev=dedup.at(-1);if(prev&&Math.abs(prev.value/n.value-1)<.00001&&prev.kind==="low"&&n.kind==="low")continue;dedup.push(n)}
  let shown=dedup;if(shown.length>8)shown=[shown[0],...shown.slice(-7)];shown=[...shown,{key:"NOW",title:"目前位置",value:price,color:"#34dbe6",kind:"current"}];
  const rawTargets=[...(w.activeTargets||[]),{label:"結構1.5X",value:w.ext15},{label:"結構2X",value:w.ext20},{label:"結構2.5X",value:w.ext25}].filter(x=>Number.isFinite(x.value)&&x.value>price*1.002).sort((a,b)=>a.value-b.value),targets=[];
  for(const t of rawTargets){if(targets.some(x=>Math.abs(x.value/t.value-1)<.006))continue;targets.push({title:t.label,value:t.value,color:"#c46cff"});if(targets.length>=3)break}
  const vals=[...shown.map(x=>x.value),...targets.map(x=>x.value)].filter(Number.isFinite);if(!vals.length)return;const lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max((hi-lo)*.14,1),vmin=lo-pad,vmax=hi+pad,y=v=>305-((v-vmin)/(vmax-vmin))*245;
  for(let i=0;i<4;i++){const yy=70+i*68;svg.append(swingWaveSvg("line",{x1:45,y1:yy,x2:775,y2:yy,class:"swing-wave-grid"}));const val=vmax-(vmax-vmin)*((yy-60)/245);svg.append(swingWaveSvg("text",{x:38,y:yy+3,class:"swing-wave-axis","text-anchor":"end"},swingWaveFmt(val)))}
  svg.append(swingWaveSvg("text",{x:16,y:48,class:"swing-wave-axis"},"股價"));svg.append(swingWaveSvg("text",{x:742,y:330,class:"swing-wave-axis"},"時間 →"));
  const avg=positionNumber(position?.avgCost);if(avg!==null&&avg>=vmin&&avg<=vmax){const cy=y(avg);svg.append(swingWaveSvg("line",{x1:45,y1:cy,x2:775,y2:cy,class:"swing-wave-cost-line"}));svg.append(swingWaveSvg("text",{x:770,y:Math.max(18,cy-5),class:"swing-wave-cost-text","text-anchor":"end"},`持股均價 ${swingWaveFmt(avg)}`))}
  const xStart=68,xEnd=545,step=shown.length>1?(xEnd-xStart)/(shown.length-1):0,pts=shown.map((n,i)=>({...n,x:xStart+step*i,y:y(n.value)}));
  if(pts.length>1){let d=`M ${pts[0].x} ${pts[0].y}`;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],mx=(a.x+b.x)/2;d+=` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}svg.append(swingWaveSvg("path",{d,class:"swing-wave-path-actual"}))}
  const ref=Number.isFinite(w.referenceHigh)?w.referenceHigh:w.firstWave,refPt=[...pts].reverse().find(q=>q.kind==="high"&&Math.abs(q.value/ref-1)<.008),now=pts.at(-1);if(refPt&&now)svg.append(swingWaveSvg("line",{x1:refPt.x+9,y1:y(ref),x2:now.x-9,y2:y(ref),class:"swing-wave-guide"}));
  if(targets.length&&now){const zoneTop=Math.min(...targets.map(t=>y(t.value))),zoneBottom=Math.max(...targets.map(t=>y(t.value)));svg.append(swingWaveSvg("rect",{x:692,y:Math.max(18,zoneTop-16),width:84,height:Math.max(28,zoneBottom-zoneTop+32),rx:10,class:"swing-wave-target-zone"}));svg.append(swingWaveSvg("text",{x:734,y:Math.max(28,zoneTop-23),class:"swing-wave-target-title","text-anchor":"middle"},"多波目標"));targets.forEach(t=>{const tx=744,ty=y(t.value);svg.append(swingWaveSvg("path",{d:`M ${now.x+8} ${now.y} C 615 ${now.y}, 680 ${ty}, ${tx} ${ty}`,class:"swing-wave-target-ray"}));svg.append(swingWaveSvg("circle",{cx:tx,cy:ty,r:6,fill:t.color,class:"swing-wave-dot"}));swingWaveLabel(svg,tx-4,Math.max(28,ty-28),t.title,swingWaveFmt(t.value),t.color,"middle")})}
  pts.forEach(p=>{svg.append(swingWaveSvg("circle",{cx:p.x,cy:p.y,r:p.kind==="current"?7:6,fill:p.color,class:"swing-wave-dot"}));let ly=p.kind==="high"?Math.max(34,p.y-38):Math.min(292,p.y+31),extra="";if(p.kind==="current")extra=`(作用中第 ${w.activeWave||1} 波${Number.isFinite(w.activeMultiple)?` ${w.activeMultiple.toFixed(2)}X`:""})`;swingWaveLabel(svg,p.x,ly,p.title,swingWaveFmt(p.value),p.color,"middle",extra)});
}

function shortFmtPct(v){return Number.isFinite(v)?`${v>=0?"+":""}${v.toFixed(1)}%`:"--"}
function shortFmtNum(v,d=1){return Number.isFinite(v)?Number(v).toFixed(d):"--"}
function drawShortWave(wave,price,targets=[]){
  const svg=$("shortWaveSvg");if(!svg)return;svg.replaceChildren();if(!wave?.valid)return;
  const vals=[wave.baseLow,wave.firstHigh,wave.pullbackLow,price,...(targets||[]).map(x=>x.value)].filter(Number.isFinite);if(!vals.length)return;
  const min=Math.min(...vals),max=Math.max(...vals),pad=Math.max((max-min)*.18,max*.015,1),lo=min-pad,hi=max+pad,y=v=>190-(v-lo)/(hi-lo)*145;
  for(let gy=45;gy<=190;gy+=48)svg.append(swingWaveSvg("line",{x1:20,y1:gy,x2:680,y2:gy,class:"short-wave-grid"}));
  const points=[{x:45,v:wave.baseLow,label:"A 起漲"},{x:190,v:wave.firstHigh,label:"B 前高"}];
  if(Number.isFinite(wave.pullbackLow))points.push({x:325,v:wave.pullbackLow,label:"C 回測"});
  points.push({x:440,v:price,label:"現價",current:true});
  const pathPts=points.map(p=>`${p.x},${y(p.v)}`).join(" ");svg.append(swingWaveSvg("polyline",{points:pathPts,fill:"none",stroke:"#54d8ff","stroke-width":4,"stroke-linejoin":"round","stroke-linecap":"round"}));
  points.forEach(p=>{svg.append(swingWaveSvg("circle",{cx:p.x,cy:y(p.v),r:p.current?6:5,fill:p.current?"#fff":"#54d8ff"}));svg.append(swingWaveSvg("text",{x:p.x,y:Math.max(18,y(p.v)-14),class:"short-wave-label","text-anchor":"middle"},`${p.label} ${technicalFmt(p.v)}`))});
  (targets||[]).slice(0,3).forEach((t,i)=>{const x=515+i*78,yy=y(t.value);svg.append(swingWaveSvg("line",{x1:x,y1:yy,x2:680,y2:yy,class:"short-wave-target-line"}));svg.append(swingWaveSvg("circle",{cx:x,cy:yy,r:4,fill:"#bb78ff"}));svg.append(swingWaveSvg("text",{x:Math.min(675,x+5),y:yy-8,class:"short-wave-target-label","text-anchor":i===2?"end":"start"},`${t.label} ${technicalFmt(t.value)}`))});
}
function resetShortAnalysis(){
  const box=$("playShortAnalysis");if(box)box.hidden=true;
  setText("playShortState","--");
  for(const id of ["shortMomentum","shortMaAccel","shortVolume","shortIndicators","shortCandle","shortNews","shortResistance","shortWaveStructure","shortWaveGoal"])setText(id,"--");
  const svg=$("shortWaveSvg");if(svg)svg.replaceChildren();
  setText("playShortNote","短期評分會同時看股性、動能／突破、五階段與近7日新聞；新聞不會單獨觸發短線建議。");
}
function renderShortAnalysis(x){
  const box=$("playShortAnalysis");if(!box)return;if(!["short","mixed"].includes(x?.key)){resetShortAnalysis();return}box.hidden=false;
  const s=x?.shortEngine;if(!s?.valid){setText("playShortState","資料不足");return}
  setText("playShortState",`短線狀態：${s.state}｜結構 ${s.score}分`);
  setText("shortMomentum",`1日 ${shortFmtPct(s.ret1)}｜3日 ${shortFmtPct(s.ret3)}｜5日 ${shortFmtPct(s.ret5)}`);
  setText("shortMaAccel",`MA5 ${shortFmtPct(s.ma5Slope)}｜MA10 ${shortFmtPct(s.ma10Slope)}`);
  setText("shortVolume",Number.isFinite(s.ratio20)?`20日量比 ${shortFmtNum(s.ratio20,2)}x`:`量比資料不足`);
  const macdText=s.macd?.hist===null?"MACD --":`MACD柱 ${s.macd.hist>=0?"+":""}${shortFmtNum(s.macd.hist,2)}`,macdLife=s.macdLifecycle?.valid?s.macdLifecycle.state:"MACD狀態不足";
  const kdText=s.kd?.k===null?"KD --":`KD ${shortFmtNum(s.kd.k,0)}/${shortFmtNum(s.kd.d,0)}`;
  setText("shortIndicators",`RSI ${shortFmtNum(s.rsi,1)}｜${macdText}｜${macdLife}｜${kdText}`);
  setText("shortCandle",s.candle?.label||"--");setText("shortNews",s.news?.label||"新聞資料待補");
  setText("shortResistance",s.resistance?`${s.resistance.label} ${technicalFmt(s.resistance.value)}｜距離 ${shortFmtPct(s.resistancePct)}`:"上方暫無明確近端壓力");
  const sw=s.shortWave;setText("shortWaveStructure",sw?.valid?`${sw.state}｜結構 ${sw.quality}分｜目前 ${Number.isFinite(sw.currentMultiple)?sw.currentMultiple.toFixed(2):"--"}X`:sw?.reason||"短波結構不足");
  const usable=s.shortWaveTargets||[],opt=s.shortWaveOptimisticTarget,boll=s.bollingerSignal,reasonableText=usable.length?usable.map(x=>`${x.label} ${technicalFmt(x.value)}`).join(" / "):"尚無";
  const optimisticText=opt?`${opt.label} ${technicalFmt(opt.value)}（${opt.enabled?"布林＋MACD已啟用":"待布林張口＋MACD攻擊確認"}）`:"尚無下一級結構目標";
  setText("shortWaveGoal",`合理：${reasonableText}｜樂觀：${optimisticText}｜正常上限 ${s.shortTargetCapPct?.toFixed?.(1)??"--"}%／樂觀上限 ${s.shortOptimisticCapPct?.toFixed?.(1)??"--"}%`);
  drawShortWave(sw,stageNum(currentStock?.last??currentStock?.price??latestFiveStageResult?.price),[...usable,...(opt?[{...opt,label:`${opt.enabled?"樂觀":"樂觀候選"} ${opt.label}`}]:[])]);
  setText("playShortNote",`假突破濾網：${s.breakout?.failed?"未通過":s.breakout?.confirmed?"已確認":"無明顯失敗"}｜布林：${boll?.state||"資料不足"}${Number.isFinite(boll?.percentile)?`（壓縮百分位 ${boll.percentile.toFixed(0)}%）`:""}｜MACD：${s.macdLifecycle?.state||"資料不足"}。ATR 決定正常合理範圍；布林張口判斷波動擴張，MACD柱體生命週期判斷蓄力／降溫／重新攻擊，兩者確認才啟用下一級樂觀短波目標。`);
}

function resetSwingWave(){
  const box=$("playSwingAnalysis");if(box)box.hidden=true;
  const svg=$("playSwingSvg");if(svg)svg.replaceChildren();
  const legend=$("playSwingLegend");if(legend)legend.replaceChildren();
  setText("playSwingState","--");setText("playSwingGoal","第一目標：--");setText("playSwingNote","波段或短波混合時啟用。");
}
function renderSwingWave(x){
  const box=$("playSwingAnalysis");if(!box)return;if(!["swing","mixed","long-swing"].includes(x?.key)){resetSwingWave();return}box.hidden=false;
  const w=x?.swingWave,price=stageNum(latestFiveStageResult?.price),position=currentHoldingPosition();
  if(!w?.valid||price===null){setText("playSwingState","資料不足");setText("playSwingGoal","第一目標：--");setText("playSwingNote",w?.reason||"近期波段結構不足");const svg=$("playSwingSvg");if(svg)svg.replaceChildren();return}
  const waveText=w.waveCount?`｜多波 ${w.waveCount}｜作用中第 ${w.activeWave||1} 波`:"";setText("playSwingState",`目前階段：${w.phase||w.state}${waveText}｜結構 ${w.quality}分｜MACD ${w.macdLifecycle?.state||"資料不足"}`);
  const refHigh=Number.isFinite(w.referenceHigh)?w.referenceHigh:w.firstWave,activeTargets=(w.activeTargets||[]).filter(t=>Number.isFinite(t.value)&&t.value>price*1.002).sort((a,b)=>a.value-b.value),legacyTargets=[{label:"結構1.5X",value:w.ext15},{label:"結構2X",value:w.ext20},{label:"結構2.5X",value:w.ext25}].filter(t=>Number.isFinite(t.value)&&t.value>price*1.002).sort((a,b)=>a.value-b.value),future=[];
  for(const t of [...activeTargets,...legacyTargets].sort((a,b)=>a.value-b.value)){if(future.some(q=>Math.abs(q.value/t.value-1)<.006))continue;future.push(t);if(future.length>=3)break}
  let goal="--";
  if(Number.isFinite(refHigh)&&price<refHigh*.995)goal=`先突破前一波高點 ${technicalFmt(refHigh)}，再確認第 ${w.activeWave||2} 波延伸`;
  else if(future.length)goal=`第 ${w.activeWave||1} 波下一目標：${future.map(t=>`${t.label} ${technicalFmt(t.value)}`).join(" / ")}`;
  else if(price>=w.ext25*.995)goal="已超過主要結構倍率區，優先觀察過熱、回測與新 Pivot 重算";
  else goal=`等待第 ${w.activeWave||1} 波新高／新回測 Pivot 確認`;
  const extText=Number.isFinite(w.extensionMax)?`｜目前布林＋MACD路徑允許延伸至 ${w.extensionMax}X`:"";setText("playSwingGoal",`下一步：${goal}${extText}`);drawSwingWave(w,price,position);
  const legend=$("playSwingLegend");if(legend){const items=[],allLegs=w.waveLegs||[],legs=allLegs.length<=4?allLegs:[allLegs[0],...allLegs.slice(-3)];if(legs.length){items.push(["#35e5e7",`結構起點 <b>${swingWaveFmt(legs[0].low)}</b>${legs[0].lowDate?`｜${legs[0].lowDate}`:""}`]);for(const leg of legs){items.push(["#c46cff",`第${leg.number}波高點 <b>${swingWaveFmt(leg.high)}</b>${leg.highDate?`｜${leg.highDate}`:""}`]);if(Number.isFinite(leg.pullbackLow))items.push(["#63a9ff",`第${leg.number}回測 <b>${swingWaveFmt(leg.pullbackLow)}</b>${Number.isFinite(leg.retracePct)?`｜回吐 ${leg.retracePct.toFixed(0)}%`:""}`])}}else{items.push(["#35e5e7",`起漲低點 <b>${swingWaveFmt(w.baseLow)}</b>`],["#c46cff",`第一波高點 <b>${swingWaveFmt(w.firstWave)}</b>`])}
    items.push(["#34dbe6",`目前位置 <b>${swingWaveFmt(price)}</b>｜作用中第 <b>${w.activeWave||1}</b> 波${Number.isFinite(w.activeMultiple)?`｜相對作用中防守 ${w.activeMultiple.toFixed(2)}X`:""}`]);if(position?.avgCost)items.push(["#ffb44b",`持股均價 <b>${swingWaveFmt(position.avgCost)}</b>${position?.shares?` ｜ ${position.shares.toLocaleString("zh-TW")} 股`:""}`]);if(w.structuralResetCount)items.push(["#ff8d78",`舊結構已自動重置 <b>${w.structuralResetCount}</b> 次${w.recentReset?.date?`｜最近 ${w.recentReset.date}`:""}`]);items.push(["#c46cff",`結構倍率：1.5X <b>${swingWaveFmt(w.ext15)}</b> ｜ 2X <b>${swingWaveFmt(w.ext20)}</b> ｜ 2.5X <b>${swingWaveFmt(w.ext25)}</b>`]);legend.innerHTML=items.map(([c,t])=>`<div style="color:${c}"><i></i><span style="color:#9fb1c0">${t}</span></div>`).join("")}
  const dates=w.baseDate&&w.waveDate?`${w.baseDate} → ${w.waveDate}`:"",p1=w.pullbackDate?`；第一回測 ${w.pullbackDate}`:"",p2=w.secondPullbackDate?`；第二回測 ${w.secondPullbackDate}`:"",pivot=Number.isFinite(w.pivotThreshold)?` Pivot 反轉閾值 ${w.pivotThreshold.toFixed(1)}%。`:"",boll=w.bollingerPath,bollText=boll?.valid?` 布林路徑：${boll.state}${Number.isFinite(boll.percentile)?`（近120日壓縮百分位 ${boll.percentile.toFixed(0)}%）`:""}；布林只判斷壓縮／張口。`:"",macdText=w.macdLifecycle?.valid?` MACD：${w.macdLifecycle.state}（${w.macdLifecycle.note}）；MACD只判斷動能生命週期。`:"";
  setText("playSwingNote",`${dates}${p1}${p2}。${w.reason}${pivot}${bollText}${macdText} 多波 Pivot 會把最近有效回測當作用中防守；深回或跌破前波起點時自動關閉舊波並重新起算，不再把過期 C 點永久沿用。`);
}

function resetLongAnalysis(){
  const box=$("playLongAnalysis");if(box)box.hidden=true;
  setText("playLongState","--");setText("playLongData","資料完整度 --");
  for(const id of ["longEarnings","longRevenue","longMargins","longStability","longValuation","longTrend","longNews"])setText(id,"--");
  setText("playLongNote","長期模組由基本面大模組提供營運品質＋估值證據；玩法名稱改由最終核心倉／機動倉比例決定。");
}
function renderLongAnalysis(x){
  const box=$("playLongAnalysis");if(!box)return;if(!["long","long-swing"].includes(x?.key)){resetLongAnalysis();return}box.hidden=false;
  const l=x?.longEngine;if(!l?.valid){setText("playLongState","資料不足");return}setText("playLongState",l.state||"--");setText("playLongData",`資料完整度 ${l.completeness}%｜不是勝率`);
  setText("longEarnings",l.earningsText||"--");setText("longRevenue",l.revenueText||"--");setText("longMargins",l.marginText||"--");setText("longStability",l.stabilityText||"--");setText("longValuation",l.valuationText||"--");setText("longTrend",l.trendText||"--");setText("longNews",l.news?.detail||l.news?.label||"展望／訂單／產能資料待補");
  setText("playLongNote",`基本面主來源：${l.fundamentals?.sourceText||"TWSE／TPEx 官方"}。一般業缺欄位採中性值，不會把剩餘權重放大；金融／金控／保險使用不含毛利率的適用權重。資料完整度只顯示、不加分。`);
}

function playEligibilityReason(key,x){
  if(!x)return "待資料";const d=x.diagnostics||{},se=x.shortEngine||{},l=x.longEngine||{};
  if(key==="short"){
    if(d.overheated||se.state==="追價風險高")return "追價風險高";
    if(d.falseBreakout||se.state==="疑似假突破")return "假突破未過濾";
    if(d.breakoutPending||se.state==="突破待確認")return "待突破守穩";
    if(se.state==="動能轉弱")return "待動能轉強";
    if((se.ratio20??1)<1)return "待量能放大";
    if(!d.momentumBurst&&!d.rhythmShortTrigger&&!d.breakout?.confirmed)return "待短線觸發";
    return "待進場訊號";
  }
  if(key==="swing"){
    if(d.rangeNoise)return "待箱型突破";
    if(d.overheated)return "待回測降溫";
    if(d.stage===1)return "待中期轉強";
    if(!d.healthyTrend&&!x.personality?.hybridRhythm)return "待趨勢確認";
    return "待回測／突破確認";
  }
  if(key==="long"){
    if((l.completeness??0)<65)return `資料完整度 ${l.completeness??0}%`;
    if(l.value<=35)return "估值偏高";
    if((l.score??0)<64)return "長期條件未達標";
    if(d.stage===1&&x?.longEngine?.trend<50)return "長趨勢待修復";
    return "待長期條件確認";
  }
  return "待確認";
}
function resetPlayStyle(note="搜尋股票後判讀"){
  setText("overviewPlayStyle","--");setText("overviewPlayStyleNote","查看建議策略");setText("playMainPeriod","--");setText("playMainAction",note);setText("playReason","玩法名稱由最終核心倉／機動倉比例轉換。");setText("playPersonality","--");setText("playPersonalityNote","等待歷史日K分析");
  setText("playPositionMode","--");setText("playPositionModeNote","等待短線／波段股性分流");
  for(const k of ["Short","Swing","Long"]){setText(`play${k}Label`,"--");setText(`play${k}Score`,"--");const bar=$(`play${k}Bar`);if(bar)bar.style.width="0%";}
  document.querySelectorAll("#playStyleCard .playstyle-fit-row").forEach(x=>x.classList.remove("is-main"));
  latestPlayStyleResult=null;resetShortAnalysis();resetSwingWave();resetLongAnalysis();resetTradeOutputs(note);
}
function renderPlayStyle(){
  const x=calculatePlayStyle(latestFiveStageResult,latestTechnicalForPlay);if(!x){resetPlayStyle("等待技術資料");return}
  const map={short:"Short",swing:"Swing",long:"Long"};
  for(const [key,id] of Object.entries(map)){
    const n=Number(x.scores?.[key]);if(!Number.isFinite(n)){setText(`play${id}Label`,"資料不足");setText(`play${id}Score`,"--");const bar=$(`play${id}Bar`);if(bar)bar.style.width="0%";continue}
    let label=playFitLabel(n);
    if(key==="long"){
      const gate=x.eligible?.long===false?`｜${playEligibilityReason("long",x)}`:"";
      label=`${label}${gate}｜資料完整度 ${x.longEngine?.completeness??0}%`;
    }else if(x.eligible?.[key]===false)label+=`｜${playEligibilityReason(key,x)}`;
    setText(`play${id}Label`,label);setText(`play${id}Score`,`${n}分`);const bar=$(`play${id}Bar`);if(bar)bar.style.width=`${n}%`;
  }
  document.querySelectorAll("#playStyleCard .playstyle-fit-row").forEach(el=>{const k=el.dataset.play;const main=x.key==="mixed"?(k==="short"||k==="swing"):x.key==="long-swing"?(k==="swing"||k==="long"):k===x.key;el.classList.toggle("is-main",main)});
  setText("playPersonality",x.personality?.label||"股性資料不足");setText("playPersonalityNote",x.personality?.detail||"歷史樣本不足，暫不調整玩法分流");
  setText("playPositionMode",x.operationProfile?.label||"--");
  const profileText=x.operationProfile?`核心倉 ${x.operationProfile.basePct}%｜機動倉 ${x.operationProfile.tacticalPct}%｜${x.operationProfile.note}`:"--";
  setText("playPositionModeNote",profileText);
  setText("playMainPeriod",x.period);setText("playMainAction",x.action);setText("playReason",x.reason);setText("overviewPlayStyle",x.period.replace("｜"," "));setText("overviewPlayStyleNote",x.action);
  latestPlayStyleResult=x;renderShortAnalysis(x);renderSwingWave(x);renderLongAnalysis(x);renderTradeOutputs();
}

// v2.5.8.0 — 持股個人化輸出。市場目標價不因持股成本改寫；均價/股數只改變報酬、損益與分批數量呈現。
function positionNumber(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null}
function currentStockCode(){return String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"")}
function currentHoldingPosition(code=currentStockCode()){
  const row=readList("holdings").find(x=>stockKey(x)===String(code));if(!row)return null;
  const avgCost=positionNumber(row.avgCost),rawShares=positionNumber(row.shares),shares=rawShares===null?null:Math.max(1,Math.floor(rawShares));
  return {...row,avgCost,shares};
}
function signedPercent(v){const n=Number(v);return Number.isFinite(n)?`${n>=0?"+":""}${n.toLocaleString("zh-TW",{maximumFractionDigits:1,minimumFractionDigits:0})}%`:"--"}
function signedMoney(v){const n=Number(v);return Number.isFinite(n)?`${n>=0?"+":"-"}${Math.abs(Math.round(n)).toLocaleString("zh-TW")} 元`:"--"}
function positionReturn(target,base){const t=positionNumber(target),b=positionNumber(base);return t!==null&&b!==null?(t/b-1)*100:null}
function targetZone(center,lo=.99,hi=1.01){const c=positionNumber(center);if(c===null)return null;return [c*lo,c*hi].sort((a,b)=>a-b)}
function targetZoneText(zone){return Array.isArray(zone)&&zone.length===2?`${technicalFmt(zone[0])} ～ ${technicalFmt(zone[1])}`:"--"}
function decisionEntryText(d){return targetZoneText(d?.entryCandidate??d?.entry)}
function uniqueFutureTargets(items,price){
  const p=positionNumber(price),out=[];
  for(const item of items||[]){const v=positionNumber(item?.value);if(v===null||p===null||v<=p*1.002)continue;if(out.some(x=>Math.abs(x.value/v-1)<.003))continue;out.push({...item,value:v})}
  return out.sort((a,b)=>a.value-b.value);
}
// v2.5.9.3 — 連續式目標共振：不再用 ±5% 當硬開關，也不再以單一「備援價」取代其他資料。
// 所有價格來源都保留；同一家族只取對當前目標區貢獻最高的一點，距離越遠以高斯衰減降低影響。
function resonanceClamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0))}
function resonanceBrokerQuality(main){
  if(!main)return 45;const ts=Number(main.time)||Date.parse(String(main.latest?.date||main.latest?.publishedAt||""))||0,age=ts?Math.max(0,(Date.now()-ts)/86400000):999;
  return age<=30?95:age<=90?88:age<=180?76:age<=365?64:52;
}
function resonanceValuationQuality(){
  const vr=playValuationResult(),c=String(vr?.confidence||latestValuationScenario?.confidence||"");let q=c.includes("高")?88:c.includes("中")?72:58;
  const state=String(vr?.state||"");if(/全面高估|明顯高估/.test(state))q-=18;if(/估值分歧/.test(state))q-=12;return resonanceClamp(q);
}
function resonanceBandwidthPct(play){
  const vol=Number(play?.personality?.medianRange);return Math.max(3.5,Math.min(6.5,3.5+(Number.isFinite(vol)?vol*.32:0)));
}
function resonanceSourceRelevance(play,family){
  const map={
    short:{shortwave:100,pressure:95,swing:58,broker:38,valuation:30},
    swing:{swing:100,broker:92,valuation:80,pressure:72,shortwave:48},
    long:{valuation:100,broker:100,swing:58,pressure:35,shortwave:25},
    observe:{pressure:82,swing:78,valuation:72,broker:68,shortwave:62}
  };
  const profile=play?.operationProfile||{},mix=(a,b,wa)=>Math.round((map[a]?.[family]??55)*wa+(map[b]?.[family]??55)*(1-wa));
  if(profile.key==="long-swing"){const core=resonanceClamp(profile.basePct??70,0,100)/100;return mix("long","swing",core)}
  if(profile.key==="mixed"){const base=resonanceClamp(profile.basePct??50,0,100)/100;return mix("swing","short",base)}
  const mode=["short","swing","long"].includes(play?.key)?play.key:"observe";
  return map[mode]?.[family]??55;
}
function resonancePathScore(play,target,price){
  const tech=50,stage=latestFiveStageResult?.stage??2,stageScore=({1:35,2:58,3:80,4:84,5:42})[stage]??55,key=play?.key||"observe",profile=play?.operationProfile||{};
  const shortEngine=play?.shortEngine?.score??50,swingEngine=play?.swingWave?.quality??tech,longEngine=play?.longEngine?.score??50;
  let engine=key==="short"?shortEngine:key==="long"?longEngine:key==="swing"?swingEngine:tech;
  if(key==="mixed"){const base=resonanceClamp(profile.basePct??50,0,100)/100;engine=swingEngine*base+shortEngine*(1-base)}
  if(key==="long-swing"){const core=resonanceClamp(profile.basePct??70,0,100)/100;engine=longEngine*core+swingEngine*(1-core)}
  const boll=key==="short"?play?.shortEngine?.bollingerSignal:play?.swingWave?.bollingerPath,bollScore=boll?.valid?(boll.score??50):50,
        macdLife=key==="short"?play?.shortEngine?.macdLifecycle:(play?.swingWave?.macdLifecycle??play?.shortEngine?.macdLifecycle),macdScore=macdLife?.valid?(macdLife.score??50):50,gap=price>0&&target>0?(target/price-1)*100:0;
  let distanceScore=88;if(key==="short"&&gap>16)distanceScore=Math.max(20,88-(gap-16)*2.2);else if(key==="mixed"&&gap>35)distanceScore=Math.max(28,88-(gap-35)*1.05);else if(key==="swing"&&gap>55)distanceScore=Math.max(35,88-(gap-55)*.75);else if(key==="long-swing"&&gap>90)distanceScore=Math.max(40,88-(gap-90)*.48);else if(key==="long"&&gap>130)distanceScore=Math.max(45,88-(gap-130)*.35);
  return Math.round(resonanceClamp(tech*.24+stageScore*.20+engine*.20+bollScore*.16+macdScore*.12+distanceScore*.08));
}
function resonanceDistanceDecay(center,value,bandwidthPct){
  if(!(center>0&&value>0))return 0;const d=Math.abs(value/center-1)*100,b=Math.max(.8,bandwidthPct);return Math.exp(-.5*Math.pow(d/b,2));
}
function resonanceStrengthLabel(cluster){
  if(!cluster)return "尚無目標";if((cluster.familyCount||0)<2)return "單一來源";const n=cluster.adjustedStrength??cluster.strength??0;return n>=78?"強共振":n>=62?"中度共振":"弱共振";
}
function resonanceContinuousPeaks(points,bandwidthPct,play,price){
  const valid=(points||[]).filter(x=>Number.isFinite(x?.value)&&x.value>price*1.002),families=[...new Set(valid.map(x=>x.family))];if(!valid.length)return [];
  const seeds=valid.map(x=>x.value);
  for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++)if(valid[i].family!==valid[j].family){
    const a=valid[i],b=valid[j],wa=Math.max(1,a.quality*a.relevance),wb=Math.max(1,b.quality*b.relevance);seeds.push((a.value*wa+b.value*wb)/(wa+wb));
  }
  const familyMaxBase=new Map();for(const f of families){const a=valid.filter(x=>x.family===f);familyMaxBase.set(f,Math.max(...a.map(x=>(x.quality/100)*(x.relevance/100))))}
  const maxSupport=[...familyMaxBase.values()].reduce((a,b)=>a+b,0)||1,peaks=[];
  for(const seed of seeds){
    let center=seed,selected=[];
    for(let iter=0;iter<3;iter++){
      selected=[];
      for(const f of families){
        let best=null,bestContribution=-1;
        for(const x of valid.filter(y=>y.family===f)){
          const decay=resonanceDistanceDecay(center,x.value,bandwidthPct),base=(x.quality/100)*(x.relevance/100),contribution=base*decay;
          if(contribution>bestContribution){best={...x,decay,contribution};bestContribution=contribution}
        }
        if(best)selected.push(best);
      }
      const total=selected.reduce((a,x)=>a+x.contribution,0);if(!(total>0))break;center=selected.reduce((a,x)=>a+x.value*x.contribution,0)/total;
    }
    if(!selected.length||!(center>price*1.002))continue;
    selected=selected.map(x=>({...x,decay:resonanceDistanceDecay(center,x.value,bandwidthPct)})).map(x=>({...x,contribution:(x.quality/100)*(x.relevance/100)*x.decay}));
    const contributors=selected.filter(x=>x.contribution>=.12),zonePoints=(contributors.length?contributors:selected.slice().sort((a,b)=>b.contribution-a.contribution).slice(0,1));
    const familyCount=contributors.length||1,totalSupport=selected.reduce((a,x)=>a+x.contribution,0),density=resonanceClamp(totalSupport/maxSupport*100),weighted=selected.reduce((a,x)=>a+x.contribution,0)||1,
          avgDev=selected.reduce((a,x)=>a+Math.abs(x.value/center-1)*100*x.contribution,0)/weighted,compact=resonanceClamp(100-(avgDev/Math.max(.8,bandwidthPct))*58),
          quality=selected.reduce((a,x)=>a+x.quality*x.contribution,0)/weighted,diversity=familyCount>=4?100:familyCount===3?90:familyCount===2?74:38,path=resonancePathScore(play,center,price),
          strength=Math.round(resonanceClamp(diversity*.24+compact*.22+quality*.20+path*.22+density*.12)),gapPct=(center/price-1)*100;
    let farPenalty=0;if(play?.key==="short")farPenalty=Math.max(0,gapPct-18)*.55;else if(play?.key==="mixed")farPenalty=Math.max(0,gapPct-35)*.30;else if(play?.key==="swing")farPenalty=Math.max(0,gapPct-50)*.18;else if(play?.key==="long-swing")farPenalty=Math.max(0,gapPct-80)*.12;else if(play?.key==="long")farPenalty=Math.max(0,gapPct-110)*.08;
    const rank=strength-farPenalty+density*.04;
    peaks.push({center,points:contributors.length?contributors:zonePoints,families:contributors.map(x=>x.family),familyCount,quality:Math.round(quality),compact:Math.round(compact),density:Math.round(density),path,strength,rank,gapPct,min:Math.min(...zonePoints.map(x=>x.value)),max:Math.max(...zonePoints.map(x=>x.value)),labels:zonePoints.map(x=>x.label)});
  }
  peaks.sort((a,b)=>b.rank-a.rank||a.gapPct-b.gapPct);const distinct=[];
  for(const p of peaks){const tooClose=distinct.some(x=>Math.abs(p.center/x.center-1)*100<Math.max(2.2,bandwidthPct*.62));if(!tooClose)distinct.push(p);if(distinct.length>=8)break}
  return distinct;
}
function buildResonanceTargets(play,price){
  const p=positionNumber(price);if(p===null)return {valid:false,points:[],peaks:[],strength:0};const mode=play?.key||"observe",points=[];
  const add=(family,label,value,quality=65,meta={})=>{const v=positionNumber(value);if(v===null||v<=p*1.002)return;points.push({family,label,value:v,quality:resonanceClamp(quality),relevance:resonanceSourceRelevance(play,family),...meta})};
  const w=play?.swingWave,se=play?.shortEngine||play?.diagnostics?.shortEngine,main=preferredMainTarget(),basis=main?targetBasis(main):null,brokerQ=resonanceBrokerQuality(main),fair=positionNumber(latestValuationScenario?.F),valuationQ=resonanceValuationQuality(),t=latestTechnicalForPlay||{};
  // 短波／近期壓力
  for(const x of se?.shortWaveTargets||[])add("shortwave",`合理・${x.label}`,x.value,se?.shortWave?.quality??70,{source:"短波合理目標"});
  if(se?.shortWaveOptimisticTarget)add("shortwave",`${se.shortWaveOptimisticTarget.enabled?"樂觀":"樂觀候選"}・${se.shortWaveOptimisticTarget.label}`,se.shortWaveOptimisticTarget.value,(se?.shortWave?.quality??70)+(se.shortWaveOptimisticTarget.enabled?0:-10),{source:"短波樂觀目標"});
  for(const x of se?.pressureTargets||[])add("pressure",x.label,x.value,68,{source:"近期壓力"});
  const bo=play?.diagnostics?.breakout||se?.breakout;if(bo?.level)add("pressure","突破位",bo.level,bo.confirmed?84:bo.failed?42:62,{source:"突破結構"});
  // 中期波段倍率：即使布林目前只允許較低延伸，較遠倍率仍保留但降低品質，不直接刪掉。
  if(w?.valid){
    const bAdj=((w?.bollingerPath?.score??50)-50)*.18,max=w.extensionMax??2;
    add("pressure",w.activeWave>1?`第${Math.max(1,w.activeWave-1)}波前高`:"波段前高",w.referenceHigh??w.firstWave,72+bAdj,{source:"波段前高"});
    for(const x of w.activeTargets||[]){const penalty=x.multiple>=2?(max>=2?0:-12):x.multiple>=1.5?(max>=1.5?0:-7):0;add("swing",x.label,x.value,w.quality+bAdj-penalty,{source:"多波 Pivot 目標"})}
    add("swing","結構1.5X",w.ext15,w.quality+bAdj,{source:"波段倍率"});
    add("swing","結構2X",w.ext20,w.quality-2+bAdj+(max>=2?0:-12),{source:"波段倍率"});
    add("swing","結構2.5X",w.ext25,w.quality-6+bAdj+(max>=2.5?0:-16),{source:"波段倍率"});
  }
  // 券商與估值：同一家族多個倍率都保留，但每個目標區只取券商家族貢獻最高的一點，避免同源灌票。
  if(basis?.base>0){add("broker","目標價80%",basis.base*.80,brokerQ,{source:"券商目標"});add("broker","目標價85%",basis.base*.85,brokerQ-1,{source:"券商目標"});add("broker","目標價88%",basis.base*.88,brokerQ-2,{source:"券商目標"});add("broker","券商基準目標",basis.base,brokerQ-4,{source:"券商目標"})}
  if(fair)add("valuation","內部合理價",fair,valuationQ,{source:"估值"});
  const h60=stageNum(t?.trend?.high60);if(h60)add("pressure","60日高",h60,62,{source:"近期壓力"});
  const bandwidthPct=resonanceBandwidthPct(play),peaks=resonanceContinuousPeaks(points,bandwidthPct,play,p),mainPeak=peaks[0]||null,remaining=peaks.slice(1),secondary=remaining[0]||null,
        optimistic=remaining.filter(x=>x.center>Math.max(mainPeak?.center||0,secondary?.center||0)*1.015).sort((a,b)=>b.rank-a.rank)[0]||remaining.filter(x=>x.center>(mainPeak?.center||0)*1.03).sort((a,b)=>b.center-a.center)[0]||null,
        sourceFamilies=[...new Set(points.map(x=>x.family))],basicAssessment=play?.longEngine?.basicAssessment||null,basicAdj=fundamentalResonanceAdjustment(basicAssessment,mode),rawStrength=mainPeak?.strength??0,adjustedStrength=Math.round(resonanceClamp(rawStrength+basicAdj.points));
  return {valid:!!mainPeak,mode,bandwidthPct,tolerancePct:bandwidthPct,points,peaks,main:mainPeak,secondary,optimistic,strength:rawStrength,adjustedStrength,basicAdjustment:basicAdj.points,basicAssessment,sourceFamilies,multiSource:(mainPeak?.familyCount||0)>=2};
}
function resonanceLevel(cluster,label){return cluster?{label,value:cluster.center,kind:"resonance",cluster}:null}
function buildExpectedPlan(play,price){
  const p=positionNumber(price);if(p===null)return {mode:"--",levels:[],note:"目前股價不足",resonance:{valid:false}};
  const resonance=buildResonanceTargets(play,p),mode=play?.key||"observe";
  if(!resonance.valid)return {mode,levels:[],resonance,note:"目前沒有高於現價的可用價格來源；等待新的短波、波段、目標價或估值資料。"};
  const levels=[resonanceLevel(resonance.main,"主要目標"),resonanceLevel(resonance.secondary,"次要目標"),resonanceLevel(resonance.optimistic,"樂觀目標")].filter(Boolean),main=resonance.main;
  const note=(main?.familyCount||0)>=2
    ?`主要目標由 ${main.familyCount} 個不同價格家族以連續距離衰減形成${resonanceStrengthLabel({...main,adjustedStrength:resonance.adjustedStrength})}；基本面只調整共振可信度，不直接製造目標價格。`
    :`目前主要目標由單一價格家族主導；其他價格來源仍以距離衰減保留在模型中，沒有改用備援價。技術、布林、五階段與五年歷史負責調整可信度／排序。`;
  return {mode,levels,resonance,note};
}
function uniqueDownsideTargets(items,price){
  const p=positionNumber(price),out=[];for(const item of items||[]){const v=positionNumber(item?.value);if(v===null||p===null||v>=p*.998)continue;if(out.some(x=>Math.abs(x.value/v-1)<.004))continue;out.push({...item,value:v})}return out.sort((a,b)=>b.value-a.value);
}
function buildDownsidePlan(play,price){
  const p=positionNumber(price),t=latestTechnicalForPlay||{},w=play?.swingWave,rows=play?.personality?.valid?(latestFiveStageResult?.path?.rows||[]):(latestFiveStageResult?.path?.rows||[]),items=[];
  const add=(label,value)=>{const n=positionNumber(value);if(n!==null)items.push({label,value:n})};if(p===null)return {levels:[],note:"股價不足"};
  const mode=play?.key||"observe",se=play?.shortEngine||play?.diagnostics?.shortEngine;
  if(mode==="short"){add("短線防守",se?.support);add("MA20",t?.ma?.ma20);add("布林下軌",t?.bollinger?.lower);add("20日低",stageLow(rows,20))}
  else if(mode==="swing"||mode==="mixed"){add("波段防守",w?.activeDefenseLow??w?.secondPullbackLow??w?.pullbackLow);add("MA20",t?.ma?.ma20);add("MA60",t?.ma?.ma60);add("60日低",stageLow(rows,60))}
  else if(mode==="long-swing"){add("波段防守",w?.activeDefenseLow??w?.secondPullbackLow??w?.pullbackLow);add("MA60",t?.ma?.ma60);add("120日低",stageLow(rows,120));const fair=positionNumber(latestValuationScenario?.F);if(fair&&fair<p)add("綜合合理價",fair)}
  else if(mode==="long"){add("MA60",t?.ma?.ma60);add("120日低",stageLow(rows,120));const fair=positionNumber(latestValuationScenario?.F);if(fair&&fair<p)add("綜合合理價",fair)}
  else{add("MA20",t?.ma?.ma20);add("MA60",t?.ma?.ma60);add("60日低",stageLow(rows,60))}
  const levels=uniqueDownsideTargets(items,p).slice(0,3);return {levels,note:levels.length?"下跌空間以目前玩法的有效支撐／防守位估算。":"目前沒有明確低於現價的結構支撐。"};
}
function histCloseAt(rows,i){return stageNum(rows?.[i]?.close)}
function histRetAt(rows,i,n){if(i-n<0)return null;const a=histCloseAt(rows,i),b=histCloseAt(rows,i-n);return a!==null&&b!==null?stagePct(a,b):null}
function histMaAt(rows,i,n){if(i-n+1<0)return null;let s=0;for(let j=i-n+1;j<=i;j++){const v=histCloseAt(rows,j);if(v===null)return null;s+=v}return s/n}
function histPercentile(values,q){
  const a=(values||[]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;if(a.length===1)return a[0];
  const pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos),w=pos-lo;return a[lo]*(1-w)+a[hi]*w;
}
function extremeMarketRisk(rows){
  const a=(rows||[]).filter(x=>playRowClose(x)!==null);if(a.length<80)return {valid:false,sample:0};
  const episodes=[];let i=1;
  while(i<a.length){if(!a[i]?.systemStress){i++;continue}const start=i;while(i+1<a.length&&a[i+1]?.systemStress)i++;const end=i,entry=histCloseAt(a,Math.max(0,start-1));let worst=0;
    if(entry!==null){for(let j=start;j<=Math.min(a.length-1,end+7);j++){const lo=swingLow(a[j])??histCloseAt(a,j),ret=lo===null?null:stagePct(lo,entry);if(ret!==null)worst=Math.min(worst,ret)}if(worst<0)episodes.push(worst)}i++}
  if(!episodes.length)return {valid:false,sample:0};
  return {valid:true,sample:episodes.length,near:histPercentile(episodes,.50),far:Math.min(...episodes),median:histPercentile(episodes,.50)};
}
function historyRecencyWeight(dateKeyValue,latestKeyValue){
  const d=Date.parse(`${dateKeyValue||""}T00:00:00Z`),latest=Date.parse(`${latestKeyValue||""}T00:00:00Z`);if(!Number.isFinite(d)||!Number.isFinite(latest))return .25;
  const ageDays=Math.max(0,(latest-d)/86400000);if(ageDays<=370)return 1;if(ageDays<=3*365.25+30)return .5;return .25;
}
function histWeightedPercentile(items,q){
  const a=(items||[]).filter(x=>Number.isFinite(x?.value)&&Number.isFinite(x?.weight)&&x.weight>0).sort((x,y)=>x.value-y.value);if(!a.length)return null;
  const total=a.reduce((s,x)=>s+x.weight,0),target=total*Math.max(0,Math.min(1,q));let acc=0;
  for(const x of a){acc+=x.weight;if(acc>=target)return x.value}return a.at(-1).value;
}
function historicalSimilarWinRate(play,price,upsidePct,downsidePct){
  const rows=((latestHistory5Y?.history?.length?latestHistory5Y.history:latestFiveStageResult?.path?.rows)||[]).filter(x=>playRowClose(x)!==null),p=positionNumber(price);
  const seasonality=seasonality5Y(rows),extreme=extremeMarketRisk(rows);
  if(rows.length<180||p===null||!Number.isFinite(upsidePct)||!Number.isFinite(downsidePct))return {valid:false,label:"樣本不足",sample:0,seasonality,extreme};
  const mode=play?.key||"observe",cfg=mode==="short"?{h:5,step:3,min:2,max:14}:mode==="swing"?{h:20,step:6,min:4,max:24}:mode==="mixed"?{h:15,step:5,min:4,max:22}:mode==="long-swing"?{h:40,step:8,min:6,max:28}:mode==="long"?{h:60,step:10,min:8,max:30}:{h:10,step:4,min:3,max:18};
  const cur=[shortReturnN(rows,5,p),stageRet(rows,20,p),stageRet(rows,60,p)],ma20=stageSmaAt(rows,20),ma60=stageSmaAt(rows,60),curAbove20=ma20?p>=ma20:null,curAbove60=ma60?p>=ma60:null,currentQuarter=Math.floor(new Date().getMonth()/3)+1,candidates=[],latestKey=historyDateKey(rows.at(-1));
  for(let i=60;i<rows.length-cfg.h;i+=cfg.step){const r5=histRetAt(rows,i,5),r20=histRetAt(rows,i,20),r60=histRetAt(rows,i,60),m20=histMaAt(rows,i,20),m60=histMaAt(rows,i,60),entry=histCloseAt(rows,i);if([r5,r20,r60,m20,m60,entry].some(v=>v===null))continue;
    if(rows.slice(Math.max(0,i-5),i+1).some(x=>x?.systemStress))continue;const forward=rows.slice(i+1,Math.min(rows.length,i+cfg.h+1));if(forward.some(x=>x?.systemStress))continue;
    const a20=entry>=m20,a60=entry>=m60;let dist=0,weights=mode==="short"?[1.2,.7,.25]:mode==="long"||mode==="long-swing"?[.25,.7,1.2]:[.45,1.0,.8];
    dist+=Math.abs(r5-(cur[0]??0))/8*weights[0]+Math.abs(r20-(cur[1]??0))/16*weights[1]+Math.abs(r60-(cur[2]??0))/32*weights[2];
    if(curAbove20!==null&&a20!==curAbove20)dist+=.65;if(curAbove60!==null&&a60!==curAbove60)dist+=.75;
    const dk=historyDateKey(rows[i]),d=dk?new Date(`${dk}T00:00:00Z`):null,q=d&&!Number.isNaN(d.getTime())?Math.floor(d.getUTCMonth()/3)+1:null;if(q!==null&&q!==currentQuarter)dist+=.18;
    const recencyWeight=historyRecencyWeight(dk,latestKey),agePenalty=recencyWeight===1?0:recencyWeight===.5?.10:.22;
    candidates.push({i,entry,dist,rankDist:dist+agePenalty,recencyWeight,date:dk});
  }
  candidates.sort((a,b)=>a.rankDist-b.rankDist);const sample=candidates.filter(x=>x.dist<=2.2).slice(0,40);if(sample.length<6)return {valid:false,label:"樣本不足",sample:sample.length,seasonality,extreme};
  // 三段時間權重固定為 40 / 40 / 20；各段內再平均分配，避免某一段只因樣本數較多就吃掉權重。
  const cohortShare=new Map([[1,.40],[.5,.40],[.25,.20]]),cohortCount=new Map();for(const c of sample)cohortCount.set(c.recencyWeight,(cohortCount.get(c.recencyWeight)||0)+1);
  const activeShare=[...cohortCount.keys()].reduce((a,k)=>a+(cohortShare.get(k)||0),0)||1;
  for(const c of sample){const share=(cohortShare.get(c.recencyWeight)||0)/activeShare,count=cohortCount.get(c.recencyWeight)||1;c.sampleWeight=share/count*sample.length}
  const up=stageClamp(upsidePct,cfg.min,cfg.max),down=stageClamp(Math.abs(downsidePct),2,22),mfes=[],maes=[],winnerMaes=[];let wins=0,weightedWins=0,totalWeight=0;
  for(const c of sample){let outcome=0,mfe=0,mae=0,winMae=null;for(let j=c.i+1;j<=Math.min(rows.length-1,c.i+cfg.h);j++){const hi=playRowHigh(rows[j])??histCloseAt(rows,j),lo=swingLow(rows[j])??histCloseAt(rows,j),ur=hi===null?null:stagePct(hi,c.entry),dr=lo===null?null:stagePct(lo,c.entry);if(ur!==null)mfe=Math.max(mfe,ur);if(dr!==null)mae=Math.min(mae,dr);if(outcome===0&&hi!==null&&hi>=c.entry*(1+up/100)){outcome=1;winMae=Math.abs(mae)}else if(outcome===0&&lo!==null&&lo<=c.entry*(1-down/100))outcome=-1}
    const w=c.sampleWeight||1;mfes.push({value:mfe,weight:w});maes.push({value:mae,weight:w});totalWeight+=w;if(outcome===1){wins++;weightedWins+=w;if(Number.isFinite(winMae))winnerMaes.push({value:winMae,weight:w})}}
  if(totalWeight<3)return {valid:false,label:"加權樣本不足",sample:sample.length,seasonality,extreme};
  const rate=Math.round(weightedWins/totalWeight*100),confidence=sample.length>=20?"樣本中等":sample.length>=12?"樣本偏少":"樣本少";
  return {valid:true,rate,sample:sample.length,wins,horizon:cfg.h,up,down,confidence,weightedSample:Number(totalWeight.toFixed(2)),recencyModel:"近1年40%／第2～3年40%／第4～5年20%",upNear:histWeightedPercentile(mfes,.25),upFar:histWeightedPercentile(mfes,.75),downNear:histWeightedPercentile(maes,.75),downFar:histWeightedPercentile(maes,.25),successMae50:histWeightedPercentile(winnerMaes,.50),successMae80:histWeightedPercentile(winnerMaes,.80),successMae90:histWeightedPercentile(winnerMaes,.90),successMaeSample:winnerMaes.length,seasonality,extreme};
}
function overviewZoneText(cluster){
  if(!cluster)return "--";const lo=positionNumber(cluster.min),hi=positionNumber(cluster.max),c=positionNumber(cluster.center);if(c===null)return "--";
  return lo!==null&&hi!==null&&Math.abs(hi/lo-1)>=.005?`${overviewIntFmt(lo)} ～ ${overviewIntFmt(hi)}`:overviewIntFmt(c);
}
function resetOverviewResonance(note="等待分析資料"){
  setText("overviewResonancePlay","等待資料");setText("overviewPlayMetric","等待資料");setText("overviewStrengthMini","共振強度：--/100");setText("overviewResonanceStrengthLabel","共振強度");setText("overviewResonanceStrength","--");setText("overviewResonanceStrengthNote",note);setText("overviewGrowthUp","--%");setText("overviewGrowthDown","--%");setText("overviewTargetZone","--");
  for(const id of ["overviewTrialPrice","overviewEntryPrice","overviewTrimPrice","overviewExitPrice","overviewTrimStopPrice","overviewFullStopPrice"])setText(id,"--");
  setText("overviewFinalDirection","--");setText("overviewFinalStrategy",note);setText("overviewFinalRisk","--");setText("overviewFinalNext","--");setText("overviewTrimStopLabel","⑤ 減碼止損");setText("overviewFullStopLabel","⑥ 全部止損");
  const svg=$("overviewResonanceSvg");if(svg)svg.replaceChildren();const src=$("overviewResonanceSources");if(src)src.replaceChildren();
}
function overviewWavePath(points,yFn){
  if(!Array.isArray(points)||points.length<2)return "";
  const getV=p=>Number.isFinite(p?.v)?p.v:p?.value;
  const firstV=getV(points[0]);
  if(!Number.isFinite(firstV)) return "";
  let d=`M ${points[0].x} ${yFn(firstV)}`;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],av=getV(a),bv=getV(b);
    if(!Number.isFinite(av)||!Number.isFinite(bv)) continue;
    const ax=a.x,ay=yFn(av),bx=b.x,by=yFn(bv),dx=bx-ax;
    d+=` C ${ax+dx*.42} ${ay}, ${ax+dx*.58} ${by}, ${bx} ${by}`;
  }
  return d;
}
function overviewNiceStep(raw){
  if(!(raw>0))return 1;
  const mag=Math.pow(10,Math.floor(Math.log10(raw))), norm=raw/mag;
  const unit=norm<=1?1:norm<=2?2:norm<=2.5?2.5:norm<=5?5:10;
  return unit*mag;
}
function overviewTickList(min,max,count=6){
  const step=overviewNiceStep((max-min)/Math.max(1,count-1));
  let lo=Math.floor(min/step)*step, hi=Math.ceil(max/step)*step;
  const ticks=[];
  for(let v=hi;v>=lo-1e-9;v-=step){ticks.push(Number(v.toFixed(6))); if(ticks.length>10)break;}
  if(ticks.length<4){for(let i=0;i<count;i++)ticks.push(hi-step*(i+1))}
  return {step,lo,hi,ticks};
}
function overviewNodeBubble(svg,x,pointY,title,value,color,opts={}){
  const titleStr=String(title||''), valueStr=String(value||'--');
  const below=!!opts.below, align=opts.align||'middle', dx=opts.dx||0, w=Math.max(92,Math.min(154,Math.max(titleStr.length*14+26,valueStr.length*15+30))), h=56, tail=10;
  let boxX=(align==='start'?x+8:align==='end'?x-w-8:x-w/2)+dx;
  boxX=Math.max(10,Math.min(750-w,boxX));
  const boxY=below?Math.min(318,pointY+18):Math.max(12,pointY-h-18);
  const tipX=Math.max(boxX+16,Math.min(boxX+w-16,x+dx)), tipY=below?boxY:boxY+h;
  const bubble=swingWaveSvg('g',{});
  bubble.append(swingWaveSvg('rect',{x:boxX,y:boxY,width:w,height:h,rx:14,fill:'#ffffff',stroke:color,'stroke-width':1.5,filter:'url(#overviewWaveBubbleShadowV2612)'}));
  if(below){bubble.append(swingWaveSvg('path',{d:`M ${tipX-9} ${boxY} L ${tipX} ${boxY-tail} L ${tipX+9} ${boxY} Z`,fill:'#ffffff',stroke:color,'stroke-width':1.5,filter:'url(#overviewWaveBubbleShadowV2612)'}));}
  else{bubble.append(swingWaveSvg('path',{d:`M ${tipX-9} ${boxY+h} L ${tipX} ${boxY+h+tail} L ${tipX+9} ${boxY+h} Z`,fill:'#ffffff',stroke:color,'stroke-width':1.5,filter:'url(#overviewWaveBubbleShadowV2612)'}));}
  bubble.append(swingWaveSvg('text',{x:boxX+w/2,y:boxY+18,class:'overview-wave-tag-title','text-anchor':'middle'},titleStr));
  bubble.append(swingWaveSvg('text',{x:boxX+w/2,y:boxY+42,class:'overview-wave-tag-price','text-anchor':'middle'},valueStr));
  svg.append(bubble);
}
function drawOverviewResonance(play,expected){
  const svg=$("overviewResonanceSvg"); if(!svg) return; svg.replaceChildren();
  const price=positionNumber(expected?.price); if(!(price>0)) return;
  const res=expected?.plan?.resonance||{}, swing=play?.swingWave, se=play?.shortEngine||play?.diagnostics?.shortEngine;
  const support=positionNumber(expected?.downside?.levels?.[0]?.value);
  const breakout=positionNumber(swing?.referenceHigh??swing?.firstWave??se?.resistance?.value??play?.diagnostics?.breakout?.level);
  const main=positionNumber(res?.main?.center??expected?.plan?.levels?.[0]?.value);
  const alt=positionNumber(expected?.plan?.levels?.[1]?.value??res?.secondary?.center??latestValuationScenario?.F);
  const mainTitle=(res?.main?.familyCount||0)>=2?"主要共振":"主要目標";
  const altTitle=(res?.secondary?.familyCount||0)>=2?"次要共振":"樂觀目標";

  const nodes=[];
  if(Number.isFinite(support)) nodes.push({title:'支撐', value:support, v:support, dot:'#3c9cff'});
  nodes.push({title:'現價', value:price, v:price, dot:'#b5bcc7'});
  if(Number.isFinite(breakout)) nodes.push({title:'前高／突破', value:breakout, v:breakout, dot:'#f2b340'});
  if(Number.isFinite(main)) nodes.push({title:mainTitle, value:main, v:main, dot:'#7a45f3'});
  if(Number.isFinite(alt) && (!Number.isFinite(main) || Math.abs(alt-main)/Math.max(1,main)>.004)) nodes.push({title:altTitle, value:alt, v:alt, dot:'#45cb93'});
  if(nodes.length<2) return;

  const left=44,right=716,top=46,bottom=220;
  const step=nodes.length>1?(right-left)/(nodes.length-1):0;
  nodes.forEach((n,i)=>n.x=left+i*step);
  const vals=nodes.map(n=>n.value).filter(Number.isFinite);
  let lo=Math.min(...vals), hi=Math.max(...vals), spread=Math.max(hi-lo, Math.max(hi,1)*0.08, 50);
  lo-=spread*0.16; hi+=spread*0.18; if(hi<=lo) hi=lo+1;
  const y=v=>bottom-((v-lo)/(hi-lo))*(bottom-top);

  const defs=swingWaveSvg('defs');
  const lineGrad=swingWaveSvg('linearGradient',{id:'overviewWaveLineGradientV2618',x1:'0%',y1:'0%',x2:'100%',y2:'0%'});
  lineGrad.append(swingWaveSvg('stop',{offset:'0%','stop-color':'#4ba6ff'}),swingWaveSvg('stop',{offset:'40%','stop-color':'#7f8fff'}),swingWaveSvg('stop',{offset:'72%','stop-color':'#8b59f6'}),swingWaveSvg('stop',{offset:'100%','stop-color':'#50c7ff'}));
  defs.append(lineGrad); svg.append(defs);

  [0.34,0.62,0.88].forEach(r=>{const gy=top+(bottom-top)*r; svg.append(swingWaveSvg('line',{x1:left,y1:gy,x2:right,y2:gy,class:'overview-wave-grid'}));});
  nodes.forEach(n=>{const yy=y(n.value); svg.append(swingWaveSvg('line',{x1:n.x,y1:yy+8,x2:n.x,y2:bottom,class:'overview-wave-vline'}));});

  const pathD=overviewWavePath(nodes,y);
  if(pathD){
    const areaD=`${pathD} L ${nodes[nodes.length-1].x} ${bottom} L ${nodes[0].x} ${bottom} Z`;
    svg.append(swingWaveSvg('path',{d:areaD,fill:'rgba(143,172,255,0.11)'}));
    svg.append(swingWaveSvg('path',{d:pathD,fill:'none',stroke:'rgba(120,145,230,0.28)','stroke-width':'15','stroke-linecap':'round','stroke-linejoin':'round'}));
    svg.append(swingWaveSvg('path',{d:pathD,fill:'none',stroke:'url(#overviewWaveLineGradientV2618)','stroke-width':'8.5','stroke-linecap':'round','stroke-linejoin':'round'}));
  }

  nodes.forEach(n=>{
    const yy=y(n.value);
    svg.append(swingWaveSvg('text',{x:n.x,y:yy-46,class:'overview-wave-tag-title','text-anchor':'middle'},n.title));
    svg.append(swingWaveSvg('text',{x:n.x,y:yy-17,class:'overview-wave-tag-price','text-anchor':'middle'},overviewIntFmt(n.value)));
    svg.append(swingWaveSvg('circle',{cx:n.x,cy:yy,r:9.5,fill:'#ffffff'}));
    svg.append(swingWaveSvg('circle',{cx:n.x,cy:yy,r:6.8,fill:n.dot}));
  });
}
function renderOverviewResonance(play,expected,decision,risk=null){
  if(!play||!expected){resetOverviewResonance();return}const res=expected?.plan?.resonance||{},mainCluster=res?.main||null,familyCount=mainCluster?.familyCount||0,resonanceStrength=res.adjustedStrength??res.strength??0;
  setText("overviewResonancePlay",`${play.period||"--"}｜${play.action||"等待訊號"}`);
  setText("overviewPlayMetric",overviewPlayMetricLabel(play));
  if(familyCount>=2){setText("overviewResonanceStrengthLabel","共振強度");setText("overviewResonanceStrength",`${resonanceStrengthLabel({...mainCluster,adjustedStrength:resonanceStrength})} ${resonanceStrength} / 100`);setText("overviewResonanceStrengthNote",`${familyCount} 類價格來源｜基本面 ${res.basicAdjustment>=0?"+":""}${res.basicAdjustment??0} 分${res.historyValidation?`｜5年驗證 ${res.historyValidation}%`:""}`)}
  else if(mainCluster){setText("overviewResonanceStrengthLabel","目標依據");setText("overviewResonanceStrength","單一來源");setText("overviewResonanceStrengthNote",`${mainCluster.points?.[0]?.source||mainCluster.points?.[0]?.label||"單一價格來源"}主導；其他來源仍以距離衰減保留${res.historyValidation?`｜5年驗證 ${res.historyValidation}%`:""}`)}
  else{setText("overviewResonanceStrengthLabel","目標依據");setText("overviewResonanceStrength","等待目標");setText("overviewResonanceStrengthNote","目前沒有高於現價的可用價格來源")}
  const strengthMini = Number.isFinite(resonanceStrength) ? `共振強度：${Math.round(resonanceStrength)}/100` : "共振強度：--/100";
  setText("overviewStrengthMini", strengthMini);
  const main=expected?.plan?.levels?.[0]?.value,up=main?positionReturn(main,expected.price):null,down=expected?.downside?.levels?.[0]?.value?positionReturn(expected.downside.levels[0].value,expected.price):null;
  setText("overviewGrowthUp",expected?.upRange|| (Number.isFinite(up)?signedPercent(up):"--%"));setText("overviewGrowthDown",expected?.downRange|| (Number.isFinite(down)?signedPercent(down):"--%"));setText("overviewTargetZone",mainCluster?overviewZoneText(mainCluster):(main?overviewIntFmt(main):"--"));
  setText("overviewTrialPrice",overviewZoneIntText(decision?.trial));setText("overviewEntryPrice",overviewZoneIntText(decision?.entryCandidate??decision?.entry));setText("overviewTrimPrice",overviewZoneIntText(decision?.trim));setText("overviewExitPrice",overviewZoneIntText(decision?.exit));setText("overviewTrimStopPrice",overviewZoneIntText(decision?.trimStop));setText("overviewFullStopPrice",overviewZoneIntText(decision?.fullStop));
  setText("overviewFinalDirection",`${play.period||"--"}｜${play.action||"等待訊號"}`);setText("overviewFinalStrategy",`${decision?.mode||play.period||"--"}｜依目標節點與確認條件分批`);
  const ex=expected?.winRate?.extreme,setRisk=expected?.downRange&&expected.downRange!=="--%"?`正常回撤 ${expected.downRange}`:Number.isFinite(down)?`正常防守 ${signedPercent(down)}`:"正常防守待確認",riskText=risk?.valid?`${risk.level.label} ${risk.score}/100｜${risk.summary}`:setRisk;setText("overviewFinalRisk",ex?.valid&&risk?.valid?`${riskText}｜極端壓力 ${signedPercent(ex.far)}`:(risk?.valid?riskText:setRisk));setText("overviewFinalNext",risk?.exitTriggered?"走壞出場條件成立，先處理風險":risk?.trimTriggered?"走壞減碼條件成立，先降部位":main?`先看 ${expected.plan.levels[0].label} ${overviewIntFmt(main)}`:"等待新目標來源");
  const host=$("overviewResonanceSources");if(host){host.replaceChildren();const pts=mainCluster?.points||[];const families=new Map();for(const x of pts){if(!families.has(x.family))families.set(x.family,[]);families.get(x.family).push(x)}for(const [family,a] of families){const chip=document.createElement("span");const name={swing:"波段倍率",broker:"券商目標",valuation:"內部估值",shortwave:"短波倍率",pressure:"前高／壓力"}[family]||family;chip.textContent=`${name}｜${a.map(x=>x.label).join("・")}`;host.append(chip)}const ba=res?.basicAssessment;if(ba){for(const txt of [`營運確認｜${ba.companyLabel} ${ba.companyQuality}/100`,`延續性｜${ba.continuationLabel} ${ba.continuation}/100`,`估值壓力｜${ba.valuation.pressureLabel}`]){const chip=document.createElement("span");chip.textContent=txt;host.append(chip)}}if(expected?.winRate?.valid){const chip=document.createElement("span");chip.textContent=`5年相似訊號｜${expected.winRate.rate}%・${expected.winRate.sample}次`;host.append(chip)}if(!families.size){const chip=document.createElement("span");chip.textContent="等待可用價格來源";host.append(chip)}}
  drawOverviewResonance(play,expected);
}
function resetTradeOutputs(note="等待分析資料"){
  resetOverviewResonance(note);
  setText("overviewExpectedUpside","--%");setText("overviewExpectedUpsideNote",note);setText("expectedModeBadge","依玩法");setText("expectedBasisLabel","現價基準");setText("expectedRange","--%");setText("expectedDownsideRange","--%");setText("expectedWinRate","--");setText("expectedWinRateNote","樣本不足");setText("expectedExtremeRisk","--%");setText("expectedExtremeRiskNote","系統性崩壞壓力測試");setText("expectedSeasonalityNote","季節性：等待五年資料");setText("expectedBasisNote",note);setText("expectedFoot","持股會改用均價計算報酬與預估損益；觀察股維持現價基準。勝率是同檔歷史相似訊號回測，不代表未來機率。");
  const pos=$("expectedPositionSummary");if(pos)pos.hidden=true;
  for(let i=1;i<=3;i++){const box=$(`expectedTarget${i}`);if(box)box.hidden=i>1;setText(`expectedT${i}Label`,i===1?"第一目標":i===2?"主要目標":"樂觀目標");setText(`expectedT${i}Price`,"--");setText(`expectedT${i}Return`,"--");setText(`expectedT${i}Profit`,"")}
  setText("decisionModeBadge","依玩法");setText("decisionRiskBadge","風險 --");const rb=$("decisionRiskBadge");if(rb)rb.classList.remove("risk-low","risk-medium","risk-high","risk-extreme");setText("decisionPositionNote",note);for(const id of ["decisionTrialPrice","decisionEntryPrice","decisionTrimPrice","decisionExitPrice","decisionTrimStopPrice","decisionFullStopPrice","overviewTrialPrice","overviewEntryPrice","overviewTrimPrice","overviewExitPrice","overviewTrimStopPrice","overviewFullStopPrice"])setText(id,"--");for(const id of ["decisionTrialNote","decisionEntryNote","decisionTrimNote","decisionExitNote","decisionTrimStopNote","decisionFullStopNote"])setText(id,"--");
  setText("decisionTrimStopLabel","減碼止損");setText("decisionFullStopLabel","全部止損");setText("adaptiveStopMode","等待資料");setText("adaptiveStopStats","--");setText("adaptiveStopCurrentTitle","現價買");setText("adaptiveStopCurrentEntry","--");setText("adaptiveStopCurrentTrim","--");setText("adaptiveStopCurrentFull","--");setText("adaptiveStopCurrentRisk","--");setText("adaptiveStopPullbackEntry","--");setText("adaptiveStopPullbackTrim","--");setText("adaptiveStopPullbackFull","--");setText("adaptiveStopPullbackRisk","--");setText("adaptiveStopNote",note);const pb=$("adaptiveStopPullbackCard");if(pb)pb.hidden=false;
}
function renderExpectedUpside(play=latestPlayStyleResult){
  const price=positionNumber(currentStock?.last??currentStock?.price??latestFiveStageResult?.price);if(price===null){resetTradeOutputs("等待股價資料");return null}
  const position=currentHoldingPosition(),base=position?.avgCost||price,plan=buildExpectedPlan(play,price),downside=buildDownsidePlan(play,price);
  const structuralReturns=plan.levels.map(x=>positionReturn(x.value,base)).filter(Number.isFinite),structuralDown=downside.levels.map(x=>positionReturn(x.value,price)).filter(Number.isFinite);
  const firstUp=plan.levels.length?positionReturn(plan.levels[0].value,price):null,nearestDown=downside.levels.length?positionReturn(downside.levels[0].value,price):null;
  const fallbackUp=play?.key==="short"?5:play?.key==="long"?15:10,fallbackDown=play?.key==="short"?-5:play?.key==="long"?-12:-8;
  const wr=historicalSimilarWinRate(play,price,Number.isFinite(firstUp)?firstUp:fallbackUp,Number.isFinite(nearestDown)?nearestDown:fallbackDown);
  if(plan?.resonance?.valid&&wr?.valid){const histScore=resonanceClamp(45+(wr.rate-50)*.7+Math.min(12,wr.sample*.4)),baseStrength=plan.resonance.adjustedStrength??plan.resonance.strength;plan.resonance.historyValidation=wr.rate;plan.resonance.adjustedStrength=Math.round(resonanceClamp(baseStrength*.85+histScore*.15))}
  const histUpPrices=wr.valid&&Number.isFinite(wr.upNear)&&Number.isFinite(wr.upFar)?[price*(1+Math.max(0,wr.upNear)/100),price*(1+Math.max(0,wr.upFar)/100)]:[];
  const returns=histUpPrices.length?histUpPrices.map(x=>positionReturn(x,base)).filter(Number.isFinite):structuralReturns;
  const downReturns=wr.valid&&Number.isFinite(wr.downNear)&&Number.isFinite(wr.downFar)?[wr.downNear,wr.downFar]:structuralDown;
  const modeName=plan.mode==="swing"?"波段":plan.mode==="short"?"短期":plan.mode==="mixed"?"短波混合":plan.mode==="long-swing"?"長波混合":plan.mode==="long"?"長期":"觀察";
  setText("expectedModeBadge",`${position?.avgCost?"持股｜":""}${modeName}`);setText("expectedBasisLabel",position?.avgCost?"上漲看均價｜下跌看現價":"現價基準");
  const range=returns.length?(returns.length===1?signedPercent(returns[0]):`${signedPercent(Math.min(...returns))} ～ ${signedPercent(Math.max(...returns))}`):"--%";
  const downRange=downReturns.length?(downReturns.length===1?signedPercent(downReturns[0]):`${signedPercent(Math.max(...downReturns))} ～ ${signedPercent(Math.min(...downReturns))}`):"--%";
  setText("expectedRange",range);setText("expectedDownsideRange",downRange);setText("overviewExpectedUpside",range);setText("overviewExpectedUpsideNote",position?.avgCost?`均價成長 ${range}｜正常風險 ${downRange}`:`${modeName}｜上 ${range} / 下 ${downRange}`);
  const basisLead=wr.valid?"上／下空間以近5年正常市場的同檔相似訊號估算；系統性崩壞樣本已從正常統計排除。":"五年相似樣本不足，暫以目前市場結構估算。";
  setText("expectedBasisNote",position?.avgCost?`${basisLead} 上漲換算以你的均價 ${technicalFmt(position.avgCost)} 為基準；下跌風險固定以現價計算。`:`${basisLead} ${plan.note}`);
  setText("expectedWinRate",wr.valid?`${wr.rate}%`:"--");setText("expectedWinRateNote",wr.valid?`${wr.confidence}｜${wr.sample}次｜${wr.horizon}日內先達上漲目標`:`樣本不足（${wr.sample||0}次）`);
  const ex=wr.extreme||{};let exText="--%";if(ex.valid){exText=ex.sample===1?signedPercent(ex.far):`${signedPercent(ex.near)} ～ ${signedPercent(ex.far)}`}
  setText("expectedExtremeRisk",exText);setText("expectedExtremeRiskNote",ex.valid?`近5年系統性壓力 ${ex.sample} 次｜正常空間不含此樣本`:"近5年未形成足夠系統性崩壞樣本");
  const season=wr.seasonality||seasonality5Y(latestHistory5Y?.history||[]);setText("expectedSeasonalityNote",`季節性：${season?.label||"五年樣本不足"}`);

  const posBox=$("expectedPositionSummary");if(posBox){posBox.hidden=!position;if(position){setText("expectedAvgCost",position.avgCost?technicalFmt(position.avgCost):"未填");setText("expectedShares",position.shares?`${position.shares.toLocaleString("zh-TW")} 股`:"未填");const pnl=position.avgCost&&position.shares?(price-position.avgCost)*position.shares:null,pct=position.avgCost?positionReturn(price,position.avgCost):null;setText("expectedCurrentPnl",pnl===null?"待補資料":`${signedMoney(pnl)}${pct===null?"":`（${signedPercent(pct)}）`}`)}}
  for(let i=1;i<=3;i++){const item=plan.levels[i-1],box=$(`expectedTarget${i}`);if(box)box.hidden=!item;if(!item)continue;setText(`expectedT${i}Label`,item.label);setText(`expectedT${i}Price`,technicalFmt(item.value));const ret=positionReturn(item.value,base);setText(`expectedT${i}Return`,`${position?.avgCost?"對均價":"對現價"} ${signedPercent(ret)}`);const profit=position?.avgCost&&position?.shares?(item.value-position.avgCost)*position.shares:null;setText(`expectedT${i}Profit`,profit===null?"":`預估損益 ${signedMoney(profit)}`)}
  const longCaveat=["long","long-swing"].includes(play?.key)?" 長期勝率仍只回測歷史價格結構，不含歷史基本面快照。":"";
  const winNote=wr.valid?`近5年正常市場相似訊號勝率 ${wr.rate}%（${wr.sample}次；${wr.recencyModel}）；系統性崩壞另外列為極端市場風險。${longCaveat}`:`近5年正常市場相似訊號樣本不足。${longCaveat}`;
  setText("expectedFoot",`${plan.note} 目標價位仍依目前玩法結構；成長／正常下跌空間與勝率使用五年歷史樣本。${winNote}${position?.shares?` 目前持有 ${position.shares.toLocaleString("zh-TW")} 股。`:""}`);
  return {price,position,base,plan,downside,winRate:wr,upRange:range,downRange};
}


// v2.6.0.1 — 正式風險標籤＋走壞型減碼／出場。
// 風險不改寫主玩法分數；只限制操作強度。獲利目標仍保留，結構走壞時決策卡切換為防守模式。
function decisionRiskLevel(score){
  const n=Math.max(0,Math.min(100,Number(score)||0));
  if(n>=72)return {key:"extreme",label:"極高",tone:"danger"};
  if(n>=50)return {key:"high",label:"高",tone:"danger"};
  if(n>=25)return {key:"medium",label:"中",tone:"watch"};
  return {key:"low",label:"低",tone:"safe"};
}
function decisionCandleRisk(rows,ratio20){
  const x=rows?.at(-1),prev=rows?.at(-2);if(!x)return {longUpper:false,heavyBear:false,label:null};
  const o=stageNum(x.open),h=playRowHigh(x),l=swingLow(x),c=playRowClose(x),pc=playRowClose(prev);if([o,h,l,c].some(v=>v===null)||h<=l)return {longUpper:false,heavyBear:false,label:null};
  const range=h-l,body=Math.abs(c-o)/range,upper=(h-Math.max(o,c))/range,chg=pc===null?null:stagePct(c,pc),vol=stageNum(x.volume),histVol=(rows||[]).slice(-21,-1).map(r=>stageNum(r.volume)).filter(Number.isFinite),avgVol=histVol.length?histVol.reduce((a,b)=>a+b,0)/histVol.length:null,vr=stageNum(ratio20)??(avgVol&&vol?vol/avgVol:null),volumeHeavy=vr!==null&&vr>=1.25;
  const longUpper=upper>=.42&&volumeHeavy&&(body>=.18||c<o),heavyBear=c<o&&body>=.55&&volumeHeavy&&(chg===null||chg<=-1.5);
  return {longUpper,heavyBear,volumeRatio:vr,label:heavyBear?"爆量長黑":longUpper?"爆量長上影":null};
}
function decisionRiskSupport(play,expected,price){
  const t=latestTechnicalForPlay||{},w=play?.swingWave,se=play?.shortEngine||play?.diagnostics?.shortEngine,p=positionNumber(price),levels=[w?.activeDefenseLow,w?.secondPullbackLow,w?.pullbackLow,se?.support,expected?.downside?.levels?.[0]?.value,t?.ma?.ma20,t?.ma?.ma60].map(positionNumber).filter(x=>x!==null&&p!==null&&x<=p*1.04&&x>=p*.55);
  return levels.length?Math.max(...levels):null;
}
function buildDecisionRisk(play,price,expected){
  const p=positionNumber(price),t=latestTechnicalForPlay||{},rows=(latestFiveStageResult?.path?.rows||stageHistory(t)).slice(-80);if(p===null)return {valid:false,score:0,level:decisionRiskLevel(0),reasons:[],trimTriggered:false,exitTriggered:false};
  const ma5=positionNumber(t?.ma?.ma5),ma10=positionNumber(t?.ma?.ma10),ma20=positionNumber(t?.ma?.ma20),ma60=positionNumber(t?.ma?.ma60),support=decisionRiskSupport(play,expected,p),ratio20=stageNum(t?.volume?.ratio20),stage=latestFiveStageResult?.stage??null,flags=latestFiveStageResult?.flags||{},w=play?.swingWave,se=play?.shortEngine||play?.diagnostics?.shortEngine,
        boll=play?.key==="short"?se?.bollingerSignal:(w?.bollingerPath??se?.bollingerSignal),macdLife=play?.key==="short"?se?.macdLifecycle:(w?.macdLifecycle??se?.macdLifecycle),candle=decisionCandleRisk(rows,ratio20),vr=playValuationResult(),fair=positionNumber(latestValuationScenario?.F),fairGap=fair?stagePct(p,fair):null,longEngine=play?.longEngine||{},fundScore=Number(longEngine?.fundamentals?.score),newsRisk=Number(longEngine?.news?.negative)||0;
  let score=8;const reasons=[],strong=[];
  const add=(pts,text,isStrong=false)=>{score+=pts;if(text&&!reasons.includes(text))reasons.push(text);if(isStrong&&text&&!strong.includes(text))strong.push(text)};
  const below5=ma5!==null&&p<ma5*.995,below10=ma10!==null&&p<ma10*.992,below20=ma20!==null&&p<ma20*.99,below60=ma60!==null&&p<ma60*.985,supportLoss=support!==null&&p<support*.99;
  if(below5)add(5,"跌破 MA5");if(below10)add(9,"跌破 MA10");if(below20)add(17,"跌破 MA20",true);if(below60)add(14,"跌破 MA60",true);if(supportLoss)add(25,"主要支撐失守",true);
  if(macdLife?.state==="動能降溫")add(7,"MACD 動能降溫");if(macdLife?.state==="空方擴張")add(20,"MACD 空方擴張",true);
  if(boll?.breakdown)add(18,"布林下軌擴張／結構轉弱",true);
  if(candle.longUpper)add(14,"爆量長上影");if(candle.heavyBear)add(22,"爆量長黑",true);
  if(stage===5)add(12,"高檔過熱／追價風險");
  const bias5=stageNum(t?.bias?.ma5),bias20=stageNum(t?.bias?.ma20);if((bias5??0)>=7)add(5,"短線乖離偏大");if((bias20??0)>=15)add(8,"中期乖離偏大");
  if(vr&&["明顯高估","全面高估"].includes(vr.state))add(vr.state==="全面高估"?14:9,`${vr.state}／估值風險`);else if(fairGap!==null&&fairGap>=25)add(8,"股價明顯高於內部合理價");
  if(Number.isFinite(fundScore)&&fundScore<38)add(12,"基本面分數偏弱",true);else if(Number.isFinite(fundScore)&&fundScore<50)add(6,"基本面動能偏弱");
  if(newsRisk>=2)add(Math.min(10,newsRisk*3),`基本面負面訊號 ${newsRisk} 則`);
  if(flags.lifecycleReset)add(20,"中長趨勢生命週期重置",true);
  score=Math.round(Math.max(0,Math.min(100,score)));
  const level=decisionRiskLevel(score),trimTriggered=!!(candle.longUpper||candle.heavyBear||below10||(below5&&macdLife?.state==="動能降溫")||stage===5&&((bias20??0)>=15||candle.longUpper)||boll?.breakdown),
        exitTriggered=!!(supportLoss||(below20&&(macdLife?.state==="空方擴張"||boll?.breakdown||candle.heavyBear))||(below60&&flags.lifecycleReset)||(strong.length>=3&&score>=72));
  const mode=play?.key||"observe",trimRef=mode==="short"?(ma5??ma10??support):mode==="swing"?(ma10??ma20??support):(ma20??ma60??support),exitRef=support??ma20??ma60,
        summary=reasons.length?reasons.slice(0,4).join("｜"):"結構未見明顯風險訊號";
  return {valid:true,score,level,reasons,strong,summary,trimTriggered,exitTriggered,trimRef,exitRef,support,candle,below5,below10,below20,below60,supportLoss,macdState:macdLife?.state??null,bollBreakdown:!!boll?.breakdown,stage,fairGap};
}

function decisionStopStructureCandidates(play,expected,entry){
  const e=positionNumber(entry),t=latestTechnicalForPlay||{},w=play?.swingWave,se=play?.shortEngine||play?.diagnostics?.shortEngine;
  if(e===null)return [];
  const raw=[
    ["MA5",t?.ma?.ma5],["MA10",t?.ma?.ma10],["布林中軌",t?.bollinger?.middle],["MA20",t?.ma?.ma20],
    ["短波回測",se?.shortWave?.pullbackLow],["短線支撐",se?.support],["波段防守",w?.activeDefenseLow],
    ["波段回測",w?.secondPullbackLow],["前波回測",w?.pullbackLow],["MA60",t?.ma?.ma60],
    ["最近有效防守",expected?.downside?.levels?.[0]?.value],["波段起漲",w?.baseLow]
  ];
  const out=[];
  for(const [label,val] of raw){const v=positionNumber(val);if(v===null||v>=e*.998||v<e*.55)continue;if(out.some(x=>Math.abs(x.value/v-1)<.0025))continue;out.push({label,value:v,distancePct:(e-v)/e*100})}
  return out.sort((a,b)=>b.value-a.value);
}
function decisionStopPersonalityNoise(play,entry){
  const e=positionNumber(entry),rows=(latestFiveStageResult?.path?.rows||stageHistory(latestTechnicalForPlay||{})).slice(-90),atr=shortAtr(rows,10),atrPct=e&&atr?atr/e*100:null,medianRange=Number(play?.personality?.medianRange),kind=play?.personality?.kind||"mixed";
  let base=Math.max(Number.isFinite(atrPct)?atrPct*.42:0,Number.isFinite(medianRange)?medianRange*.32:0,0.8);
  if(["high-vol-short","hybrid","burst"].includes(kind))base*=1.15;
  else if(kind==="swing-trend")base*=.92;
  else if(kind==="range")base*=1.05;
  return {pct:stageClamp(base,.8,4.8),atrPct:Number.isFinite(atrPct)?atrPct:null,medianRange:Number.isFinite(medianRange)?medianRange:null,kind,label:play?.personality?.label||"股性待判"};
}
function decisionStopHistoryProfile(expected){
  const wr=expected?.winRate||{},valid=!!wr?.valid,rate=valid?Number(wr.rate):null,sample=valid?Number(wr.sample):0,mae50=Number(wr?.successMae50),mae80=Number(wr?.successMae80),mae90=Number(wr?.successMae90);
  const sampleTrust=valid?stageClamp((sample||0)/20,.35,1):.35,rateTrust=valid?stageClamp(((rate||0)-40)/30,0,1):.35,trust=sampleTrust*(.65+.35*rateTrust);
  const rateFactor=!valid?1:rate>=65?1.06:rate>=50?1:rate>=40?.92:.84;
  return {valid,rate,sample,mae50:Number.isFinite(mae50)?mae50:null,mae80:Number.isFinite(mae80)?mae80:null,mae90:Number.isFinite(mae90)?mae90:null,trust,rateFactor,confidence:wr?.confidence||"樣本不足"};
}
function decisionAdaptiveStopScenario(play,expected,entry,label="進場"){
  const e=positionNumber(entry);if(e===null)return null;
  const candidates=decisionStopStructureCandidates(play,expected,e),noise=decisionStopPersonalityNoise(play,e),hist=decisionStopHistoryProfile(expected),near=candidates[0]||null;
  let deep=candidates.find(x=>!near||x.value<=near.value*(1-Math.max(.012,noise.pct*.0035)))||candidates[1]||null;
  if(deep&&near&&deep.value>=near.value)deep=null;
  const nearStruct=near?near.distancePct+noise.pct*.35:noise.pct*1.25;
  const deepStruct=deep?deep.distancePct+noise.pct*.45:Math.max(nearStruct+Math.max(1.2,noise.pct*.55),noise.pct*2.0);
  const histTrim=hist.mae50!==null?hist.mae50*(.72+.28*hist.trust)*hist.rateFactor:0,
        histFull=hist.mae80!==null?hist.mae80*(.78+.22*hist.trust)*hist.rateFactor:0;
  let trimDist=stageClamp(Math.max(nearStruct,histTrim,1.2),1.2,14),fullDist=stageClamp(Math.max(deepStruct,histFull,trimDist+Math.max(1.2,noise.pct*.45)),2.8,24);
  if(fullDist<=trimDist+.6)fullDist=Math.min(24,trimDist+Math.max(1.2,noise.pct*.45));
  const trimCenter=e*(1-trimDist/100),fullCenter=e*(1-fullDist/100),trimZone=targetZone(trimCenter,.997,1.003),fullZone=targetZone(fullCenter,.997,1.003),quality=hist.valid&&hist.rate<45?"勝率偏低，不放寬止損；較適合縮小部位或等回測":hist.valid&&hist.rate>=60&&hist.sample>=12?"勝率與樣本可用，保留股性正常震盪空間":"以結構＋股性為主，歷史樣本只作輔助";
  return {label,entry:e,trimStop:trimZone,fullStop:fullZone,trimCenter,fullCenter,trimRiskPct:-trimDist,fullRiskPct:-fullDist,near,deep,noise,hist,quality,candidates};
}
function decisionHoldingStopScenario(play,expected,price,avgCost){
  const p=positionNumber(price),avg=positionNumber(avgCost);if(p===null||avg===null)return decisionAdaptiveStopScenario(play,expected,p,"持股現況");
  const base=decisionAdaptiveStopScenario(play,expected,p,"持股現況");if(!base)return null;
  let trim=base.trimCenter,full=base.fullCenter;const pnl=positionReturn(p,avg),hist=base.hist||{},noise=base.noise?.pct??2,notes=[];
  if(Number.isFinite(pnl)&&pnl>0&&avg>trim){const costFloor=avg*(1-Math.min(1.5,noise*.25)/100);if(costFloor>trim&&costFloor<p*.998){trim=costFloor;notes.push("已有獲利，減碼線提高到接近成本保護區")}}
  if(Number.isFinite(pnl)&&pnl<0&&hist.mae80!==null&&Math.abs(pnl)>=hist.mae80){trim=p-(p-trim)*.80;full=p-(p-full)*.90;notes.push(`目前虧損已超過成功訊號 MAE80 ${hist.mae80.toFixed(1)}%，不再放寬止損`)}
  if(full>=trim){full=trim*(1-Math.max(.012,noise*.0045))}
  return {...base,trimCenter:trim,fullCenter:full,trimStop:targetZone(trim,.997,1.003),fullStop:targetZone(full,.997,1.003),trimRiskPct:positionReturn(trim,p),fullRiskPct:positionReturn(full,p),holdingPnlPct:pnl,holdingAdjustment:notes.join("｜")||"均價用來判斷已承受風險／獲利保護，市場結構仍是主體"};
}
function buildAdaptiveStopModel(play,expected,baseDecision,risk,price,position){
  const p=positionNumber(price),avg=positionNumber(position?.avgCost),trial=baseDecision?.trial,trialMid=Array.isArray(trial)?(trial[0]+trial[1])/2:null;
  if(p===null)return {valid:false};
  const holding=avg!==null;
  const currentScenario=holding?decisionHoldingStopScenario(play,expected,p,avg):decisionAdaptiveStopScenario(play,expected,p,"現價買"),pullbackEntry=trialMid&&trialMid<p*.998?trialMid:null,pullbackScenario=!holding&&pullbackEntry?decisionAdaptiveStopScenario(play,expected,pullbackEntry,"等回測買"):null;
  const active=currentScenario;
  const hist=active?.hist||{},noise=active?.noise||{},mode=holding?"holding":"new-entry",basisRisk=holding&&avg?{trim:active?.trimCenter?positionReturn(active.trimCenter,avg):null,full:active?.fullCenter?positionReturn(active.fullCenter,avg):null}:null,
        summary=`${noise.label}${Number.isFinite(noise.atrPct)?`｜ATR ${noise.atrPct.toFixed(1)}%`:""}${Number.isFinite(noise.medianRange)?`｜日波動中位 ${noise.medianRange.toFixed(1)}%`:""}${hist.valid?`｜相似勝率 ${hist.rate}%・${hist.sample}次`:"｜相似勝率樣本不足"}${hist.mae50!==null?`｜成功MAE50 ${hist.mae50.toFixed(1)}%`:""}${hist.mae80!==null?`／MAE80 ${hist.mae80.toFixed(1)}%`:""}${holding&&currentScenario?.holdingAdjustment?`｜${currentScenario.holdingAdjustment}`:""}`;
  return {valid:!!active,mode,active,current:currentScenario,pullback:pullbackScenario,avgCost:avg,basisRisk,summary,risk};
}
function decisionStopZone(ref,level="trim"){
  const c=positionNumber(ref);if(c===null)return null;
  return level==="full"?targetZone(c,.992,1.002):targetZone(c,.995,1.005);
}
function applyDecisionRisk(base,risk,price,stopModel=null){
  if(!base)return base;const p=positionNumber(price);if(p===null)return {...base,risk,stopModel};
  const out={...base,risk,stopModel,profitTrim:base.trim,profitExit:base.exit},active=stopModel?.active;
  out.trimStop=active?.trimStop??decisionStopZone(risk?.trimRef??risk?.support??p,"trim");
  out.fullStop=active?.fullStop??decisionStopZone(risk?.exitRef??risk?.support??risk?.trimRef??p,"full");
  if(out.trimStop&&out.fullStop){const tm=(out.trimStop[0]+out.trimStop[1])/2,fm=(out.fullStop[0]+out.fullStop[1])/2;if(fm>=tm){const corrected=tm*Math.max(.94,1-Math.max(.012,(active?.noise?.pct??2)*.006));out.fullStop=targetZone(corrected,.997,1.003)}}
  const trimLo=Array.isArray(out.trimStop)?positionNumber(out.trimStop[0]):null,trimHi=Array.isArray(out.trimStop)?positionNumber(out.trimStop[1]):null,trimTouched=trimHi!==null&&p<=trimHi,trimLost=trimLo!==null&&p<trimLo;
  if(risk)risk.trimTriggered=trimTouched;
  out.trimStopState=trimLost?"lost":trimTouched?"triggered":"waiting";
  out.defenseMode=risk?.exitTriggered?"exit":trimTouched?"trim":"normal";
  const trimStopTxt=targetZoneText(out.trimStop),fullStopTxt=targetZoneText(out.fullStop),stopBasis=active?.quality?`｜${active.quality}`:"";
  out.trimNote=`${base.trimNote}${trimTouched?`｜減碼止損已碰價，優先看止損 ${trimStopTxt}`:`｜獲利端照原目標；止損另看 ${trimStopTxt}`}`;
  out.exitNote=`${base.exitNote}${risk?.exitTriggered?`｜全面防守已觸發，優先看全部止損 ${fullStopTxt}`:`｜獲利端照原目標；全部止損另看 ${fullStopTxt}`}`;
  out.trimStopNote=trimLost?`減碼止損已失守｜現價 ${technicalFmt(p)} 已跌破 ${trimStopTxt}${stopBasis}`:trimTouched?`減碼止損已觸發｜現價 ${technicalFmt(p)} 已進入 ${trimStopTxt}${stopBasis}`:`減碼止損未觸發｜${trimStopTxt}｜${active?.near?`${active.near.label} ${technicalFmt(active.near.value)}＋股性緩衝`:`股性／歷史回撤估算`}${stopBasis}`;
  out.fullStopNote=risk?.exitTriggered?`全部止損已觸發｜${risk.summary}｜${fullStopTxt}${stopBasis}`:`全部止損 ${fullStopTxt}｜${active?.deep?`${active.deep.label} ${technicalFmt(active.deep.value)}＋深層緩衝`:`深層結構／歷史回撤估算`}${stopBasis}`;
  return out;
}

// v2.5.9.4 — 大量進場：結構、布林、MACD 動能週期、量能、五階段共同確認。
// v2.5.9.9 — 價格與策略分離：價位持續顯示；策略只描述目前是否可執行。
function decisionTrialState(zone,price){
  const p=positionNumber(price);if(!Array.isArray(zone)||zone.length!==2||p===null)return "試單條件待補";
  const [lo,hi]=zone;if(p>=lo&&p<=hi)return "現價進入試單區，可小量分批";
  if(p>hi)return "現價已離開試單區，不追價";
  return "現價低於試單區，等重新站回支撐再評估";
}
function decisionNearestRaisedSupport(values,price,oldSupport){
  const p=positionNumber(price),old=positionNumber(oldSupport);if(p===null)return null;const out=[];
  for(const raw of values||[]){const n=positionNumber(raw);if(n===null||n>p*1.015||n<p*.80)continue;if(old!==null&&n<=old*1.005)continue;if(out.some(x=>Math.abs(x/n-1)<.002))continue;out.push(n)}
  return out.sort((a,b)=>b-a)[0]??null;
}
function decisionTrialPlan({baseSupport,price,confirmed=false,candidates=[],lo=.995,hi=1.015,context="支撐"}={}){
  const p=positionNumber(price);if(p===null)return {zone:null,center:null,oldZone:null,raised:false,note:`${context}資料不足，暫無法計算試單區`};
  let base=positionNumber(baseSupport);
  if(base===null){
    const fallback=(candidates||[]).map(positionNumber).filter(n=>n!==null&&n<=p*1.02&&n>=p*.55).sort((a,b)=>b-a);
    base=fallback[0]??null;
  }
  if(base===null)return {zone:null,center:null,oldZone:null,raised:false,note:`${context}資料不足，暫無法計算試單區`};
  const oldZone=targetZone(base,lo,hi),missed=!!oldZone&&p>oldZone[1]*1.015;
  if(missed&&confirmed){
    const raised=decisionNearestRaisedSupport(candidates,p,base);
    if(raised!==null){const zone=targetZone(raised,lo,hi),state=decisionTrialState(zone,p);return {zone,center:raised,oldZone,raised:true,note:`原試單區 ${targetZoneText(oldZone)} 已錯過；突破確認後新支撐抬高到 ${targetZoneText(zone)}。${state}${p>zone[1]?"，等回測新支撐":""}`}}
  }
  const state=decisionTrialState(oldZone,p),tail=missed?confirmed?"；突破已確認，但新支撐尚未形成，先等回測":"；等回測或突破確認後再更新新試單區":"";
  return {zone:oldZone,center:base,oldZone,raised:false,note:`${context}試單區 ${targetZoneText(oldZone)}。${state}${tail}`};
}

function tradeEntryConfirmation(play,confirm,price){
  const p=positionNumber(price),c=positionNumber(confirm),t=latestTechnicalForPlay||{},se=play?.shortEngine||play?.diagnostics?.shortEngine,w=play?.swingWave,bo=play?.diagnostics?.breakout||se?.breakout||{},boll=play?.key==="short"?se?.bollingerSignal:w?.bollingerPath,
        macdLife=play?.key==="short"?se?.macdLifecycle:(w?.macdLifecycle??se?.macdLifecycle),ratio=stageNum(se?.ratio20??bo?.volumeRatio??t?.volume?.ratio20),stage=latestFiveStageResult?.stage??null;
  const structure=!!(c&&p&&p>=c*.995&&!bo?.failed&&(play?.key!=="short"||bo?.confirmed||p>=c*1.005)),bollOk=boll?.valid?(!boll.breakdown&&(boll.upwardExpansion||boll.trendExpansion||(boll.score??0)>=65)):null,
        macdOk=macdLife?.valid?["重新攻擊","攻擊擴張"].includes(macdLife.state):null,volumeOk=ratio===null?null:ratio>=.95,volumeWeak=ratio!==null&&ratio<.8,stageOk=stage===null?null:[2,3,4].includes(stage);
  let score=structure?30:0;if(bollOk===true)score+=20;else if(bollOk===null)score+=10;if(macdOk===true)score+=20;else if(macdOk===null)score+=10;if(volumeOk===true)score+=15;else if(volumeOk===null)score+=7;if(stageOk===true)score+=15;else if(stageOk===null)score+=7;
  const ready=!!structure&&score>=72&&!boll?.breakdown&&!volumeWeak&&stageOk!==false&&macdOk!==false,mark=x=>x===true?"✓":x===false?"×":"–",parts=[`突破${mark(structure)}`,`布林${mark(bollOk)}`,`MACD${mark(macdOk)}`,`量能${mark(volumeOk)}`,`階段${mark(stageOk)}`];
  return {ready,score:Math.round(score),structure,bollOk,macdOk,volumeOk,stageOk,ratio,stage,macdState:macdLife?.state??null,note:`確認 ${Math.round(score)}/100｜${parts.join("・")}`};
}
function buildDecisionPlan(play,price,expected){
  const p=positionNumber(price),t=latestTechnicalForPlay||{},w=play?.swingWave,profile=play?.operationProfile||{};if(p===null)return null;
  if(profile?.key==="mixed"&&["short","swing","mixed"].includes(play?.key)){
    const se=play?.shortEngine||play?.diagnostics?.shortEngine,bo=play?.diagnostics?.breakout||{};
    const support=positionNumber(w?.activeDefenseLow??w?.secondPullbackLow??w?.pullbackLow??se?.support??t?.ma?.ma20),confirm=positionNumber(w?.referenceHigh??w?.firstWave??bo?.level),levels=expected?.plan?.levels||[];
    const trim=levels[0]?.value??confirm,exit=levels[1]?.value??w?.ext15??levels.at(-1)?.value??null;
    const ec=tradeEntryConfirmation(play,confirm,p),entryCandidate=targetZone(confirm,1,1.02),trialPlan=decisionTrialPlan({baseSupport:support,price:p,confirmed:ec.ready,candidates:[confirm,bo?.level,t?.ma?.ma5,t?.ma?.ma10,t?.bollinger?.middle,t?.ma?.ma20,w?.secondPullbackLow,w?.pullbackLow,expected?.downside?.levels?.[0]?.value],lo:.99,hi:1.02,context:"機動倉支撐"});return {mode:"短波混合",trial:trialPlan.zone,trialPlan,entry:ec.ready?entryCandidate:null,entryCandidate,entryReady:ec.ready,trim:targetZone(trim,.99,1.01),exit:targetZone(exit,.985,1.015),trialNote:`${trialPlan.note}；回測支撐附近只補機動倉，底倉不因短線震盪重複進出`,entryNote:`${ec.ready?"大量進場條件達標":"大量進場候選區，條件未齊"}｜${ec.note}；突破／布林／MACD／量能／五階段共同確認後再把機動倉補足`,trimNote:"先處理機動倉，底倉保留波段趨勢",exitNote:"高延伸目標或波段結構轉弱時，再評估剩餘底倉"};
  }
  if(play?.key==="swing"&&w?.valid){
    const support=positionNumber(w.activeDefenseLow??w.secondPullbackLow??w.pullbackLow??t?.ma?.ma20),confirm=positionNumber(w.referenceHigh??w.firstWave),levels=(expected?.plan?.levels||[]).filter(x=>x.value>p*1.002).sort((a,b)=>a.value-b.value);
    const trim=levels[0]?.value??w.ext15??null,exit=levels[1]?.value??levels[0]?.value??w.ext20??null;
    const ec=tradeEntryConfirmation(play,confirm,p),entryCandidate=targetZone(confirm,1,1.02),entryReady=ec.ready&&!(p>(confirm||Infinity)*1.03),trialPlan=decisionTrialPlan({baseSupport:support,price:p,confirmed:ec.ready,candidates:[confirm,t?.ma?.ma5,t?.ma?.ma10,t?.bollinger?.middle,t?.ma?.ma20,w?.activeDefenseLow,w?.secondPullbackLow,w?.pullbackLow,expected?.downside?.levels?.[0]?.value],lo:.99,hi:1.02,context:"波段支撐"});return {mode:"波段",trial:trialPlan.zone,trialPlan,entry:entryReady?entryCandidate:null,entryCandidate,entryReady,trim:targetZone(trim,.985,1.01),exit:targetZone(exit,.985,1.015),trialNote:`${trialPlan.note}；價格優勢較高時先小量試單，不要求所有發動條件已確認`,entryNote:p>(confirm||Infinity)*1.03?`已突破偏遠，不追價｜${ec.note}；等回測確認後再提高部位`:`${ec.ready?"大量進場條件達標":"大量進場候選區，條件未齊"}｜${ec.note}；突破、布林、MACD、量能、五階段共同確認`,trimNote:"先到達的主要／次要目標附近先收部分",exitNote:"下一目標／結構轉弱時處理剩餘部位"};
  }
  if(play?.key==="short"){
    const se=play?.shortEngine||play?.diagnostics?.shortEngine,bo=play?.diagnostics?.breakout||{},support=positionNumber(se?.support??t?.ma?.ma10??t?.ma?.ma20??t?.ma?.ma5),confirm=positionNumber(bo?.level??se?.resistance?.value??t?.bollinger?.upper),levels=(expected?.plan?.levels||[]).filter(x=>x.value>p*1.002).sort((a,b)=>a.value-b.value),entryCenter=bo?.confirmed&&bo?.level?positionNumber(bo.level):confirm;
    const ec=tradeEntryConfirmation(play,entryCenter,p),entryCandidate=targetZone(entryCenter,bo?.confirmed ? .992 : 1,bo?.confirmed?1.012:1.015),trialPlan=decisionTrialPlan({baseSupport:support,price:p,confirmed:ec.ready,candidates:[entryCenter,bo?.level,t?.ma?.ma5,t?.ma?.ma10,t?.bollinger?.middle,t?.ma?.ma20,se?.shortWave?.pullbackLow,se?.support,expected?.downside?.levels?.[0]?.value],lo:.995,hi:1.015,context:"短線支撐"});return {mode:"短期",trial:trialPlan.zone,trialPlan,entry:ec.ready?entryCandidate:null,entryCandidate,entryReady:ec.ready,trim:targetZone(levels[0]?.value,.99,1.005),exit:targetZone(levels[1]?.value??levels[0]?.value,.99,1.01),trialNote:`${trialPlan.note}；價格優勢優先，容許訊號尚未完全確認`,entryNote:`${ec.ready?"大量進場條件達標":"大量進場候選區，條件未齊"}｜${ec.note}；有效突破＋布林向上／趨勢擴張＋MACD重新攻擊＋量能＋五階段共同確認`,trimNote:"碰主要短線目標先收部分",exitNote:"下一目標／動能轉弱時處理剩餘部位"};
  }
  if(profile?.key==="long-swing"&&["long","swing","long-swing"].includes(play?.key)){
    const l=play?.longEngine||{},support=positionNumber(w?.activeDefenseLow??w?.secondPullbackLow??w?.pullbackLow??t?.ma?.ma60),confirm=positionNumber(w?.referenceHigh??w?.firstWave),levels=(expected?.plan?.levels||[]).filter(x=>x.value>p*1.002).sort((a,b)=>a.value-b.value),fair=positionNumber(latestValuationScenario?.F);
    const trim=levels[0]?.value??confirm,exit=levels[1]?.value??fair??currentTargetPrice();
    const ec=tradeEntryConfirmation(play,confirm,p),entryCandidate=targetZone(confirm,1,1.02),trialPlan=decisionTrialPlan({baseSupport:support,price:p,confirmed:ec.ready,candidates:[confirm,t?.ma?.ma10,t?.ma?.ma20,t?.bollinger?.middle,t?.ma?.ma60,w?.activeDefenseLow,w?.secondPullbackLow,w?.pullbackLow,expected?.downside?.levels?.[0]?.value],lo:.985,hi:1.015,context:"波段倉支撐"});return {mode:"長波混合",trial:trialPlan.zone,trialPlan,entry:ec.ready?entryCandidate:null,entryCandidate,entryReady:ec.ready,trim:targetZone(trim,.99,1.01),exit:targetZone(exit,.985,1.015),trialNote:`${trialPlan.note}；長期核心不因一般波動反覆進出，回測支撐只調整波段倉`,entryNote:`${ec.ready?"波段倉加碼條件達標":"波段倉候選區，確認未齊"}｜${ec.note}；長期適配 ${play?.scores?.long??l.score??"--"}分、資料完整度 ${l.completeness??0}%`,trimNote:"先處理波段倉，長期核心續看基本面／估值",exitNote:"長期核心只有在估值過熱、基本面或長趨勢轉弱時才大幅退出"};
  }
  if(play?.key==="long"){
    const l=play?.longEngine||{},fair=positionNumber(latestValuationScenario?.F),ma60=positionNumber(t?.ma?.ma60),support=ma60&&ma60<p*1.08?ma60:p,levels=(expected?.plan?.levels||[]).filter(x=>x.value>p*1.002).sort((a,b)=>a.value-b.value);
    const entryCenter=(fair&&fair>p)?p:Math.min(p,support||p),trim=levels[0]?.value??fair,exit=levels[1]?.value??levels[0]?.value??currentTargetPrice();
    const trialPlan=decisionTrialPlan({baseSupport:support,price:p,confirmed:false,candidates:[t?.ma?.ma20,t?.ma?.ma60,t?.bollinger?.middle,fair,expected?.downside?.levels?.[0]?.value],lo:.985,hi:1.015,context:"中長期支撐"});return {mode:"長期",trial:trialPlan.zone,trialPlan,entry:targetZone(entryCenter,.97,1.01),entryCandidate:targetZone(entryCenter,.97,1.01),entryReady:true,trim:targetZone(trim,.985,1.01),exit:targetZone(exit,.985,1.015),trialNote:`${trialPlan.note}；以中長期支撐／估值安全邊際分批，不追單日動能`,entryNote:`長期適配 ${play?.scores?.long??l.score??"--"}分、資料完整度 ${l.completeness??0}%；基本面中的營運品質與估值條件持續成立才提高部位`,trimNote:"接近內部合理價／主要目標時先回收部分",exitNote:"高於主要估值區且基本面或長趨勢轉弱時處理剩餘部位"};
  }
  const se=play?.shortEngine||play?.diagnostics?.shortEngine,bo=play?.diagnostics?.breakout||se?.breakout||{},rows=latestFiveStageResult?.path?.rows||[],support=positionNumber(se?.support??t?.ma?.ma10??t?.ma?.ma20??t?.ma?.ma60??t?.bollinger?.middle),confirm=positionNumber(bo?.level??se?.resistance?.value??t?.bollinger?.upper??stageHigh(rows,20)),refs=[...(expected?.plan?.levels||[]),...(se?.targets||[])].map(x=>({value:positionNumber(x?.value)})).filter(x=>x.value!==null&&x.value>p*1.002).sort((a,b)=>a.value-b.value),trim=refs[0]?.value??confirm,exit=refs[1]?.value??refs[0]?.value??currentTargetPrice(),trialPlan=decisionTrialPlan({baseSupport:support,price:p,confirmed:false,candidates:[t?.ma?.ma5,t?.ma?.ma10,t?.bollinger?.middle,t?.ma?.ma20,t?.ma?.ma60,expected?.downside?.levels?.[0]?.value],lo:.995,hi:1.015,context:"觀察支撐"}),entryCandidate=targetZone(confirm,1,1.015);
  return {mode:"觀察",trial:trialPlan.zone,trialPlan,entry:null,entryCandidate,entryReady:false,trim:targetZone(trim,.99,1.01),exit:targetZone(exit,.985,1.015),trialNote:`${trialPlan.note}；目前玩法尚未確認，價位只作結構參考，不主動追價`,entryNote:entryCandidate?"大量進場參考價已保留，但策略仍是等待玩法／突破條件確認":"突破確認價資料不足，暫不主動進場",trimNote:"持股可先看上方結構壓力；未持股只作參考",exitNote:"遠端目標仍保留，等玩法成立後再決定是否執行"};
}
function renderAdaptiveStopModel(model,price,position){
  const p=positionNumber(price),holding=model?.mode==="holding",cur=model?.current,pull=model?.pullback;
  if(!model?.valid||!cur){setText("adaptiveStopMode","等待資料");setText("adaptiveStopStats","--");setText("adaptiveStopCurrentEntry","--");setText("adaptiveStopCurrentTrim","--");setText("adaptiveStopCurrentFull","--");setText("adaptiveStopCurrentRisk","--");setText("adaptiveStopPullbackEntry","--");setText("adaptiveStopPullbackTrim","--");setText("adaptiveStopPullbackFull","--");setText("adaptiveStopPullbackRisk","--");setText("adaptiveStopNote","止損資料不足");return}
  setText("adaptiveStopMode",holding?"持股均價模式":"新進場雙情境");setText("adaptiveStopStats",model.summary);
  setText("adaptiveStopCurrentTitle",holding?"持股模式":"現價買");setText("adaptiveStopCurrentEntry",holding?`均價 ${technicalFmt(model.avgCost)}｜現價 ${technicalFmt(p)}`:technicalFmt(cur.entry));setText("adaptiveStopCurrentTrim",targetZoneText(cur.trimStop));setText("adaptiveStopCurrentFull",targetZoneText(cur.fullStop));
  const basis=model?.basisRisk;setText("adaptiveStopCurrentRisk",holding?`對均價：減碼 ${Number.isFinite(basis?.trim)?signedPercent(basis.trim):"--"}｜全部 ${Number.isFinite(basis?.full)?signedPercent(basis.full):"--"}`:`對進場：減碼 ${signedPercent(cur.trimRiskPct)}｜最大 ${signedPercent(cur.fullRiskPct)}`);
  const pullCard=$("adaptiveStopPullbackCard");if(pullCard)pullCard.hidden=holding;
  if(!holding){if(pull){setText("adaptiveStopPullbackEntry",technicalFmt(pull.entry));setText("adaptiveStopPullbackTrim",targetZoneText(pull.trimStop));setText("adaptiveStopPullbackFull",targetZoneText(pull.fullStop));setText("adaptiveStopPullbackRisk",`對進場：減碼 ${signedPercent(pull.trimRiskPct)}｜最大 ${signedPercent(pull.fullRiskPct)}`)}else{setText("adaptiveStopPullbackEntry","試單區未形成");setText("adaptiveStopPullbackTrim","--");setText("adaptiveStopPullbackFull","--");setText("adaptiveStopPullbackRisk","等新的有效回測支撐")}}
  const anchorText=cur.near?`近端 ${cur.near.label} ${technicalFmt(cur.near.value)}`:"近端以股性回撤估算",deepText=cur.deep?`深層 ${cur.deep.label} ${technicalFmt(cur.deep.value)}`:"深層以歷史回撤估算";
  setText("adaptiveStopNote",`${anchorText}｜${deepText}｜${cur.quality}。減碼止損一定高於全部止損；勝率低時不會用「放寬止損」來硬撐。${holding?"持股模式會把均價與已承受損益納入防守強度。":"回測買情境沿用目前股性／相似訊號統計，真正回測發生後會依當時資料重算。"}`);
}
function renderDecision(play=latestPlayStyleResult,expected=null,risk=null){
  const price=positionNumber(currentStock?.last??currentStock?.price??latestFiveStageResult?.price);if(price===null)return;
  expected=expected||{price,position:currentHoldingPosition(),plan:buildExpectedPlan(play,price)};risk=risk||buildDecisionRisk(play,price,expected);const position=expected.position||currentHoldingPosition(),profile=play?.operationProfile,baseDecision=buildDecisionPlan(play,price,expected),stopModel=buildAdaptiveStopModel(play,expected,baseDecision,risk,price,position),d=applyDecisionRisk(baseDecision,risk,price,stopModel);if(!d)return;
  setText("decisionModeBadge",`${position?.avgCost?"持股｜":""}${d.mode}`);setText("decisionRiskBadge",risk?.valid?`風險 ${risk.level.label} ${risk.score}`:"風險 --");const riskBadge=$("decisionRiskBadge");if(riskBadge){riskBadge.classList.remove("risk-low","risk-medium","risk-high","risk-extreme");if(risk?.valid)riskBadge.classList.add(`risk-${risk.level.key}`)}
  const holdingStop=stopModel?.mode==="holding";setText("decisionTrimStopLabel",holdingStop?"持股減碼止損":"現價買減碼止損");setText("decisionFullStopLabel",holdingStop?"持股全部止損":"現價買全部止損");setText("overviewTrimStopLabel",holdingStop?"⑤ 持股減碼止損":"⑤ 現價買減碼止損");setText("overviewFullStopLabel",holdingStop?"⑥ 持股全部止損":"⑥ 現價買全部止損");
  const split=profile?(profile.key==="long-swing"?`｜部位：長期核心 ${profile.basePct}%／波段倉 ${profile.tacticalPct}%`:profile.key==="mixed"?`｜部位：底倉 ${profile.basePct}%／機動 ${profile.tacticalPct}%`:`｜部位：核心 ${profile.basePct}%／機動 ${profile.tacticalPct}%`):"";
  if(position){const pnl=position.avgCost&&position.shares?(price-position.avgCost)*position.shares:null,pct=position.avgCost?positionReturn(price,position.avgCost):null;setText("decisionPositionNote",`持股均價 ${position.avgCost?technicalFmt(position.avgCost):"未填"}｜${position.shares?`${position.shares.toLocaleString("zh-TW")} 股`:"股數未填"}${pnl===null?"":`｜目前 ${signedMoney(pnl)}（${signedPercent(pct)}）`}${split}`)}else setText("decisionPositionNote",`未在持股清單：依目前股價與市場結構計算${split}；觀察清單不套用個人持股資料。`);
  setText("decisionTrialPrice",targetZoneText(d.trial));setText("decisionEntryPrice",decisionEntryText(d));setText("decisionTrimPrice",targetZoneText(d.trim));setText("decisionExitPrice",targetZoneText(d.exit));setText("decisionTrimStopPrice",targetZoneText(d.trimStop));setText("decisionFullStopPrice",targetZoneText(d.fullStop));
  let trimNote=d.trimNote,exitNote=d.exitNote;
  if(position?.shares){
    if(["mixed","long-swing"].includes(profile?.key)){const baseQty=Math.round(position.shares*profile.basePct/100),tacticalQty=Math.max(0,position.shares-baseQty),firstTrim=Math.max(1,Math.floor(tacticalQty*.5));trimNote+=`｜${profile.key==="long-swing"?"波段倉":"機動倉"}約 ${tacticalQty.toLocaleString("zh-TW")} 股，先減約 ${firstTrim.toLocaleString("zh-TW")} 股`;exitNote+=`｜${profile.key==="long-swing"?"長期核心":"底倉"}約 ${baseQty.toLocaleString("zh-TW")} 股，不因一般短期震盪強制賣出`}
    else if(position.shares>=4){const trimQty=Math.max(1,Math.floor(position.shares*.25)),remain=Math.max(0,position.shares-trimQty);trimNote+=`｜參考 25% = ${trimQty.toLocaleString("zh-TW")} 股`;exitNote+=`｜其餘 ${remain.toLocaleString("zh-TW")} 股`}
    else{trimNote+="｜股數較少，不強制切 25%";exitNote+=`｜共 ${position.shares.toLocaleString("zh-TW")} 股`}
  }
  const trimMid=d.trim?(d.trim[0]+d.trim[1])/2:null,exitMid=d.exit?(d.exit[0]+d.exit[1])/2:null,trimStopMid=d.trimStop?(d.trimStop[0]+d.trimStop[1])/2:null,fullStopMid=d.fullStop?(d.fullStop[0]+d.fullStop[1])/2:null;
  if(position?.avgCost&&trimMid&&trimMid<position.avgCost)trimNote+="｜此區仍低於你的均價";if(position?.avgCost&&exitMid&&exitMid<position.avgCost)exitNote+="｜此區仍低於你的均價";
  let trimStopNote=d.trimStopNote,fullStopNote=d.fullStopNote;
  if(position?.shares){if(position.shares>=4){const trimQty=Math.max(1,Math.floor(position.shares*.25)),fullQty=position.shares;trimStopNote+=`｜先防守約 ${trimQty.toLocaleString("zh-TW")} 股`;fullStopNote+=`｜全部 ${fullQty.toLocaleString("zh-TW")} 股`; } else {trimStopNote+="｜股數較少，可用更保守方式處理";fullStopNote+=`｜共 ${position.shares.toLocaleString("zh-TW")} 股`;}}
  if(position?.avgCost&&trimStopMid&&trimStopMid<position.avgCost)trimStopNote+="｜此區低於你的均價";if(position?.avgCost&&fullStopMid&&fullStopMid<position.avgCost)fullStopNote+="｜此區低於你的均價";
  setText("decisionTrialNote",position?`${d.trialNote}；已有持股時視為加碼參考`:d.trialNote);setText("decisionEntryNote",d.entryNote);setText("decisionTrimNote",trimNote);setText("decisionExitNote",exitNote);setText("decisionTrimStopNote",trimStopNote);setText("decisionFullStopNote",fullStopNote);
  renderAdaptiveStopModel(stopModel,price,position);
  const riskFoot=risk?.valid?` 風險 ${risk.level.label} ${risk.score}/100：${risk.summary}。`:"";setText("decisionFoot",(profile?`${profile.label}：${profile.note}。價格仍由市場結構／估值決定，持股資料只調整報酬與分批股數。`:"價格來自目前玩法的結構與目標區；持股股數只用來換算分批數量，不改變市場目標價。")+riskFoot);
  return d;
}
function renderTradeOutputs(){const expected=renderExpectedUpside(latestPlayStyleResult);if(expected){const price=positionNumber(expected?.price??currentStock?.last??currentStock?.price),risk=buildDecisionRisk(latestPlayStyleResult,price,expected),decision=renderDecision(latestPlayStyleResult,expected,risk);renderOverviewResonance(latestPlayStyleResult,expected,decision,risk)}}

async function loadTechnical(data){
  const code=data?.code||data?.symbol||"",market=data?.market||data?.marketLabel||"";
  resetFiveStage("讀取技術資料中…");
  try{
    const [t,hraw]=await Promise.all([technical(code,market),history5Y(code,market).catch(e=>{console.warn("五年歷史資料更新失敗",e);return null})]);
    const curCode=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");if(curCode&&String(code)!==curCode)return;
    latestHistory5Y=hraw?markSystemStress(hraw):null;const a=t.analysis||{},price=Number(data?.last??data?.price??data?.regularMarketPrice),historyRows=(latestHistory5Y?.history?.length?latestHistory5Y.history:stageHistory(t));
    latestTechnicalPersonality=calculateStockPersonality(historyRows);latestTechnicalSeasonality=seasonality5Y(historyRows);latestTechnicalDirection=calculateTechnicalDirection(t,price,latestTechnicalPersonality,latestTechnicalSeasonality);
    setText("technicalSource",`Yahoo｜${t.updatedAt||"--"}${latestHistory5Y?.history?.length?`｜5年 ${latestHistory5Y.history.length}筆`:""}`);
    techSet("techState",latestTechnicalDirection?.direction||"--",latestTechnicalDirection?.tone);updateTechnicalOverview(latestTechnicalDirection,null);
    const stateIcon=document.querySelector('#technical .tech-state-icon');if(stateIcon)stateIcon.textContent=latestTechnicalDirection?.direction==='偏多'?'↑':latestTechnicalDirection?.direction==='偏空'?'↓':'↔';
    setText("overviewTechnicalState",latestTechnicalDirection?.direction||"--");
    setText("overviewTechnicalNote",technicalDirectionHeadline(latestTechnicalDirection));
    techSet("techMaState",a.ma?.state||t.ma?.order||"--",a.ma?.tone); setText("techMaConclusion",a.ma?.conclusion||"--");
    technicalMetrics("techMaValues",[["5MA",technicalFmt(t.ma?.ma5)],["10MA",technicalFmt(t.ma?.ma10)],["20MA",technicalFmt(t.ma?.ma20)],["60MA",technicalFmt(t.ma?.ma60)]]);
    techSet("techBollState",a.bollinger?.state||"--",a.bollinger?.tone); setText("techBollConclusion",a.bollinger?.conclusion||"--"); technicalMetrics("techBoll",[["上軌",technicalFmt(t.bollinger?.upper)],["中軌",technicalFmt(t.bollinger?.middle)],["下軌",technicalFmt(t.bollinger?.lower)],["帶寬",technicalFmt(t.bollinger?.bandwidth,"%")]]);
    techSet("techVolumeState",a.volume?.state||"--",a.volume?.tone); setText("techVolumeConclusion",a.volume?.conclusion||"--"); technicalMetrics("techVolume",[["成交量",technicalVolumeFmt(t.volume?.current)],["5日均量",technicalVolumeFmt(t.volume?.avg5)],["20日均量",technicalVolumeFmt(t.volume?.avg20)],["量比",technicalFmt(t.volume?.ratio20)]]);
    const biasState=a.bias?.state||"--", biasTone=biasState.includes("超跌")?"cyan":biasState.includes("偏低")?"info":a.bias?.tone; techSet("techBiasState",biasState,biasTone); setText("techBiasConclusion",a.bias?.conclusion||"--"); technicalMetrics("techBias",[["5MA",technicalFmt(t.bias?.ma5,"%")],["10MA",technicalFmt(t.bias?.ma10,"%")],["20MA",technicalFmt(t.bias?.ma20,"%")],["60MA",technicalFmt(t.bias?.ma60,"%")]]);
    techSet("techTrendState",a.trend?.state||"--",a.trend?.tone); setText("techTrendConclusion",a.trend?.conclusion||"--"); technicalMetrics("techTrend",[["60日高",technicalFmt(t.trend?.high60)],["60日低",technicalFmt(t.trend?.low60)],["距高",technicalFmt(t.trend?.fromHigh60Pct,"%")],["距低",technicalFmt(t.trend?.fromLow60Pct,"%")]]);
    techSet("techMomentumState",a.momentum?.state||"--",a.momentum?.tone); setText("techMomentumConclusion",a.momentum?.conclusion||"--"); technicalMetrics("techMomentum",[["RSI",technicalFmt(t.momentum?.rsi14)],["MACD",technicalFmt(t.momentum?.macd)],["Signal",technicalFmt(t.momentum?.signal)],["Histogram",technicalFmt(t.momentum?.histogram)]]);
    const pd=latestTechnicalPersonality||{};techSet("techPersonalityState",pd.label||"資料不足",pd.kind==='reset'?'bad':pd.kind==='range'?'watch':pd.kind==='swing-trend'?'good':'info');setText("techPersonalityConclusion",pd.valid?(pd.detail||"歷史節奏已分析"):"歷史樣本不足");const completeCycles=Number.isFinite(pd.completeCycles)?pd.completeCycles:(Number.isFinite(pd.cycles)?pd.cycles:null);technicalMetrics("techPersonality",[
      ["典型上漲",Number.isFinite(pd.upDays)?`${Math.round(pd.upDays)}日`:"--"],
      ["整理",Number.isFinite(pd.restDays)?`${Math.round(pd.restDays)}日`:"--"],
      ["回吐前波",Number.isFinite(pd.retrace)?`${pd.retrace.toFixed(0)}%`:"--"],
      ["恢復",Number.isFinite(pd.recoveryDays)?`約${Math.round(pd.recoveryDays)}日`:"--"],
      ["深度回吐",Number.isFinite(pd.resetCycles)&&Number.isFinite(completeCycles)?`${pd.resetCycles}/${completeCycles}次`:"--"]
    ]);
    const sd=latestTechnicalSeasonality||{};const seasonTone=sd.valid?(sd.median>0&&sd.positiveRate>=60?'good':sd.median<0&&sd.positiveRate<=40?'bad':'watch'):'neutral';techSet("techSeasonState",sd.valid?`Q${sd.quarter} ${sd.median>=0?'偏正':'偏弱'}`:"樣本不足",seasonTone);setText("techSeasonConclusion",sd.label||`近5年Q${sd.quarter||''}｜樣本不足`);
    const qRows=[1,2,3,4].map(q=>{const x=sd.quarters?.[q];return [`Q${q}`,x?.valid?`${x.positiveRate}%上漲｜${stageFmtPct(x.median)}`:"樣本不足"]});
    technicalMetrics("techSeason",qRows);
    const overallBox=$("techOverview"); if(overallBox){overallBox.classList.remove("tone-good","tone-watch","tone-bad","tone-neutral");overallBox.classList.add(`tone-${latestTechnicalDirection?.tone||"neutral"}`);}
    updateTechnicalOverview(latestTechnicalDirection,null);
    renderFiveStage(t,price);
  }catch(e){console.warn("技術資料更新失敗",e);latestTechnicalDirection=null;latestTechnicalPersonality=null;latestTechnicalSeasonality=null;setText("technicalSource","Yahoo｜取得失敗");resetFiveStage("技術資料取得失敗")}
}
async function valuation(query,market,price){
  const params=new URLSearchParams({q:String(query||""),market:String(market||""),price:String(price??"")});
  return await readJson(await fetch(`/api/valuation?${params.toString()}`,{cache:"no-store"}),"估值");
}
function valuationNum(n){
  if(n===null||n===undefined||n==="")return null;
  const x=Number(n);return Number.isFinite(x)?x:null;
}
function valuationTrunc(n){
  const x=valuationNum(n);return x===null?null:Math.trunc(x);
}
function valuationFmt(n,suffix=""){
  // Only prices calculated by StockZone (PE/PS/PB/composite fair price) are truncated.
  const x=valuationTrunc(n);return x!==null?`${x.toLocaleString("zh-TW")}${suffix}`:"--";
}
function valuationMetric(n,suffix="",na="--"){
  const x=valuationNum(n);return x!==null?`${x.toLocaleString("zh-TW",{maximumFractionDigits:2,minimumFractionDigits:0})}${suffix}`:na;
}
function valuationPercent(n,na="--"){
  const x=valuationNum(n);return x!==null?`${x.toLocaleString("zh-TW",{maximumFractionDigits:2,minimumFractionDigits:0})}%`:na;
}
function valuationEpsFmt(n){
  const x=valuationNum(n);
  return x!==null?x.toLocaleString("zh-TW",{maximumFractionDigits:2,minimumFractionDigits:0}):"--";
}
function valuationRiskByCurrentFair(current,fair){
  if(!(current>0&&fair>0))return "neutral";
  const premium=(current/fair-1)*100;
  return premium<-10?"safe":premium<=20?"watch":"danger";
}
function valuationRiskByPeer(premium){
  const x=valuationNum(premium);if(x===null)return "neutral";
  return x<=0?"safe":x<=30?"watch":"danger";
}
function resetValuation(msg="--"){
  setText("valuationStatus",msg);setText("valuationStatusDetail","--");
  ["valuationCompositeFair","valuationCompositeGap","valuationPeFair","valuationPeFairGap","valuationPbFair","valuationPbFairGap","valuationSummaryBps","valuationCompositeScenarioLine"].forEach(id=>setText(id,"--"));
  ["valuationCurrentPe","valuationPeerPe","valuationPeGap","valuationBookValue","valuationCurrentPb","valuationPeerPb","valuationPbGap","valuationPeWeight","valuationPsWeight","valuationPbWeight","valuationPeSuitability","valuationPsSuitability","valuationPbSuitability","valuationPrimaryModel","valuationModelReason","valuationFairRange","valuationFairRangeNote","valuationEstimateConfidence","valuationEstimateConfidenceNote","valuationEvidenceCurrentPe","valuationEvidencePeerPe","valuationEvidencePeFair","valuationEvidenceCurrentPs","valuationEvidencePeerPs","valuationEvidencePsFair","valuationEvidenceCurrentPb","valuationEvidencePeerPb","valuationEvidencePbFair","valuationEvidenceTtmEps"].forEach(id=>setText(id,"--"));
  setText("overviewCompositeFair","--");latestValuationScenario=null;latestValuationData=null;setText("overviewValuationScenario","--");setText("overviewValuationScenarioNote","估值情境判讀");
  const qhost=$("valuationQuarterGrid");if(qhost)qhost.innerHTML="";setText("valuationTtmEps","--");setText("valuationCompositeReasonLine","等待估值判讀");
}
let latestValuationScenario=null,latestValuationData=null;
function currentTargetPrice(){const main=preferredMainTarget();return main?valuationNum(targetPriceValue(main.latest)):null}
function scenarioClassify(P,O,B,F,T){
  if(!(P>0&&O>0&&B>0&&F>0))return {n:null,state:"資料不足",consensus:"資料不足",confidence:"低",tone:"watch",summary:"營運合理價或 PB 合理價資料不足，暫時無法完成九情境判讀。",condition:"資料不足",valuationWeight:100,targetWeight:0};
  const hasTarget=T>0, divergence=Math.abs(O-B)/F*100, close=divergence<=20, mid=divergence<=40;
  const near=(a,b)=>a>0&&b>0&&Math.abs(a/b-1)<=.05;
  let n,state,summary,tone="watch";
  if(close){
    if(P<F&&!near(P,F)){n=1;state="低估偏多";summary=hasTarget&&F<T?"兩種內部估值高度接近，現價低於綜合合理價，且仍低於券商目標價。":"兩種內部估值高度接近，現價低於綜合合理價；本次不依賴券商目標價即可判定內部低估。";tone="good"}
    else if(near(P,F)){n=2;state="合理偏多";summary=hasTarget&&P<T?"現價接近綜合合理價，內部估值大致合理，券商目標價仍保留上行預期。":"現價接近綜合合理價，內部估值大致合理。";tone="good"}
    else if(hasTarget&&near(P,T)){n=4;state="接近目標價";summary="現價已高於內部合理價並接近券商目標價，上行空間開始受限。"}
    else if(hasTarget&&P>T){n=5;state="明顯高估";summary="現價高於內部合理價且已高於券商目標價，估值警訊明顯。";tone="danger"}
    else {n=3;state="溢價偏多";summary=hasTarget?"現價高於內部合理價，但尚未到券商目標價，市場正給予一定成長溢價。":"現價高於內部合理價；無券商目標價時僅確認內部估值已進入溢價區。"}
  }else{
    const lo=Math.min(O,B),hi=Math.max(O,B);
    if(P<lo){n=6;state="雙重低估";summary="營運估值與 PB 雖有分歧，但現價同時低於兩者，屬雙重低估區。";tone="good"}
    else if(P<=hi){n=7;state="估值分歧區";summary="現價介於營運合理價與 PB 合理價之間，不同估值方法對合理價格看法明顯不同。"}
    else if(hasTarget&&P>T){n=9;state="全面高估";summary="現價高於兩種內部合理價，且已高於券商目標價，屬全面高估。";tone="danger"}
    else {n=8;state="成長預期區";summary=hasTarget?"現價已高於兩種內部合理價，但仍低於券商目標價，市場正在交易未來成長預期。":"現價已高於兩種內部合理價；無券商目標價，本次只確認市場價格已超越內部估值。"}
  }
  const defs={
    1:{condition:"P < F < T；O ≈ B",vw:70,tw:30},2:{condition:"P ≈ F < T；O ≈ B",vw:60,tw:40},3:{condition:"F < P < T；O ≈ B",vw:45,tw:55},
    4:{condition:"F < P ≈ T；O ≈ B",vw:40,tw:60},5:{condition:"F < T < P；O ≈ B",vw:70,tw:30},6:{condition:"P < O、B；O ≠ B",vw:80,tw:20},
    7:{condition:"P 位於 O、B 之間；O ≠ B",vw:50,tw:50},8:{condition:"P > O、B；P < T",vw:35,tw:65},9:{condition:"P > O、B、T",vw:80,tw:20}
  },d=defs[n];
  return {n,state,consensus:close?"高共識":mid?"有分歧":"高分歧",confidence:close?"高":mid?"中":"低",tone,summary,divergence,condition:d.condition,valuationWeight:hasTarget?d.vw:100,targetWeight:hasTarget?d.tw:0,hasTarget};
}
function renderValuationScenario(){
  const x=latestValuationScenario;if(!x)return;
  const T=currentTargetPrice(),r=scenarioClassify(x.P,x.O,x.B,x.F,T);
  setText("valuationCompositeScenarioLine",r.state||"--");
  setText("valuationCompositeReasonLine",`模型共識：${r.confidence}｜${r.summary}${r.hasTarget===false?" 無券商目標價，本次以內部估值判讀。":""}`);
  setText("overviewValuationScenario",r.state);setText("overviewValuationScenarioNote",`${r.consensus}｜模型共識${r.confidence}`);renderPlayStyle();
}
// v2.6.1.29 — PE / PS / PB 動態適用度引擎。
// 原則：先判斷「這個估值工具對目前公司有多適用」，再把可用模型正規化成權重；
// 不把 PE / PS / PB 固定等權，也不因單一模型缺值把缺值當成 0 元合理價。
function valuationModelWeightedScore(parts,neutral=45){
  const rows=(parts||[]).filter(x=>Number.isFinite(Number(x?.[0]))&&Number(x?.[1])>0),total=(parts||[]).reduce((s,x)=>s+(Number(x?.[1])>0?Number(x[1]):0),0),used=rows.reduce((s,x)=>s+Number(x[1]),0);
  if(!used||!total)return {score:neutral,coverage:0};
  const raw=rows.reduce((s,x)=>s+Number(x[0])*Number(x[1]),0)/used,coverage=stageClamp(used/total,0,1);
  return {score:Math.round(stageClamp(raw*coverage+neutral*(1-coverage),0,100)),coverage};
}
function valuationMarginLevelScore(v,kind){
  const x=valuationNum(v);if(x===null)return null;
  if(kind==="gross")return x>=50?90:x>=40?84:x>=30?76:x>=20?66:x>=10?52:x>=0?38:18;
  return x>=25?90:x>=18?82:x>=12?73:x>=7?62:x>=3?52:x>=0?42:18;
}
function valuationGrowthStabilityScore(std){
  const x=valuationNum(std);if(x===null)return null;return x<=10?92:x<=20?82:x<=35?70:x<=50?58:x<=80?44:30;
}
function valuationRoeScores(roe){
  const x=valuationNum(roe);if(x===null)return {pe:null,pb:null};
  const pe=x<0?15:x<5?42:x<10?62:x<20?76:x<=40?90:82;
  const pb=x<0?20:x<5?48:x<10?66:x<20?82:x<=30?90:x<=50?76:60;
  return {pe,pb};
}
function valuationIndustryAssetScore(industry){
  const s=String(industry||"");
  if(/水泥|鋼鐵|航運|營建|建材|塑膠|化學|玻璃|造紙|橡膠|紡織|汽車|電機機械|電器電纜|油電燃氣|貿易百貨/.test(s))return 82;
  if(/半導體|電子零組件|電腦|周邊|光電|通信|網路|資訊服務|數位雲端|軟體|生技|醫療/.test(s))return 28;
  return 48;
}
function valuationNormalizeModelWeights(methods){
  const available=Object.entries(methods).filter(([,m])=>m?.available&&Number.isFinite(m?.score));
  if(!available.length)return {pe:0,ps:0,pb:0};
  const raw=available.map(([k,m])=>[k,Math.max(1,m.score)*(0.65+0.35*stageClamp(m.coverage??0,0,1))]),sum=raw.reduce((s,x)=>s+x[1],0);
  const exact=Object.fromEntries(raw.map(([k,v])=>[k,v/sum*100])),rounded=Object.fromEntries(Object.keys(methods).map(k=>[k,Math.round(exact[k]||0)]));
  let diff=100-Object.values(rounded).reduce((s,n)=>s+n,0);
  if(diff){const lead=raw.slice().sort((a,b)=>b[1]-a[1])[0]?.[0];if(lead)rounded[lead]+=diff;}
  return {pe:rounded.pe||0,ps:rounded.ps||0,pb:rounded.pb||0};
}
function valuationWeightedFair(fairs,weights,keys=["pe","ps","pb"]){
  const rows=keys.map(k=>[valuationNum(fairs?.[k]),Number(weights?.[k])||0]).filter(x=>x[0]>0&&x[1]>0),sum=rows.reduce((s,x)=>s+x[1],0);
  return sum?rows.reduce((s,x)=>s+x[0]*x[1],0)/sum:null;
}
function valuationModelSuitability(v,fairs){
  const fund=longQuantitativeFundamentals(v||{}),rows=fund?.rows||[],fallback=(Array.isArray(v?.latest4)?v.latest4:[]),epsRows=rows.map(x=>valuationNum(x?.eps)).filter(Number.isFinite).slice(0,8),eps=epsRows.length>=4?epsRows:fallback.map(x=>valuationNum(x?.eps)).filter(Number.isFinite).slice(0,8);
  const positiveRatio=eps.length?eps.filter(x=>x>0).length/eps.length:null,positiveScore=positiveRatio===null?null:Math.round(20+80*positiveRatio),stability=fundamentalStabilityAssessment(fund),epsStability=eps.length>=4?stability.score:null;
  const revYoy=fundamentalYoySeries(rows,fundamentalRevenueValue,"revenue"),revStd=fundamentalStd(revYoy),revStability=valuationGrowthStabilityScore(revStd),revenueGrowth=Number.isFinite(fund?.revenueScore)?fund.revenueScore:null;
  const off=fund?.officialStatement||latestFundamentalData?.officialStatement||{},latest=fund?.latest||rows[0]||{},grossNow=fundamentalMarginFromSources("gross",off,latest,latestFundamentalData?.financialData),opNow=fundamentalMarginFromSources("operating",off,latest,latestFundamentalData?.financialData),grossQuality=valuationMarginLevelScore(grossNow,"gross"),opQuality=valuationMarginLevelScore(opNow,"operating");
  const ttm=valuationNum(v?.ttm),bps=valuationNum(v?.bookValue),roe=ttm!==null&&bps!==null&&bps>0?ttm/bps*100:null,roeScores=valuationRoeScores(roe),yoy=fund?.yoyEps||{},explosive=Number.isFinite(yoy?.pct)&&Math.abs(yoy.pct)>=200;
  let maturity=ttm!==null&&ttm>0?86:12;if(yoy?.state==="轉盈")maturity=Math.min(maturity,48);if(yoy?.state==="轉虧")maturity=10;if(explosive&&maturity>55)maturity-=12;if(positiveRatio!==null&&positiveRatio<.75)maturity=Math.min(maturity,55);
  const earningsImmaturity=Math.round(stageClamp(105-maturity,25,95)),industry=stockIndustryValue(currentStock,latestFundamentalData,latestFundamentalData?.company,latestFundamentalData?.profile,off),assetScore=valuationIndustryAssetScore(industry);

  const pe=valuationModelWeightedScore([[positiveScore,.28],[epsStability,.24],[opQuality,.18],[roeScores.pe,.15],[maturity,.15]]);
  const ps=valuationModelWeightedScore([[revenueGrowth,.28],[revStability,.22],[grossQuality,.20],[opQuality,.12],[earningsImmaturity,.18]]);
  const pb=valuationModelWeightedScore([[assetScore,.38],[bps!==null&&bps>0?100:null,.17],[roeScores.pb,.22],[epsStability,.13],[opQuality,.10]]);
  pe.available=valuationNum(fairs?.pe)>0;ps.available=valuationNum(fairs?.ps)>0;pb.available=valuationNum(fairs?.pb)>0;
  const weights=valuationNormalizeModelWeights({pe,ps,pb}),primary=Object.entries(weights).sort((a,b)=>b[1]-a[1])[0]?.[0]||"--",labels={pe:"PE",ps:"PS",pb:"PB"};
  const confidence=Math.round(stageClamp((pe.coverage*(weights.pe||0)+ps.coverage*(weights.ps||0)+pb.coverage*(weights.pb||0)),0,100));
  let reason=primary==="pe"?"獲利成熟度與 EPS 穩定性較有代表性":primary==="ps"?"營收成長／穩定性比短期 EPS 更有代表性":primary==="pb"?"資產與淨值對目前估值較有代表性":"估值資料不足";
  if(primary==="pe"&&explosive)reason="PE 仍為主，但已因 EPS 低基期／高波動降低適用度";
  return {methods:{pe,ps,pb},weights,primary,primaryLabel:labels[primary]||"--",confidence,reason,metrics:{positiveRatio,epsStability,revenueGrowth,revStability,grossNow,opNow,roe,industry,assetScore,maturity,earningsImmaturity}};
}

// v2.6.1.30 — 把 PE / PS / PB 合成「合理價區間、估值位置、估值可信度」。
// 估值可信度只描述內部估值本身是否穩健；目前不額外改變價格共振權重。
function valuationFairProfile(v,fairs,model,price){
  const weights=model?.weights||{},methods=model?.methods||{},center=valuationWeightedFair(fairs,weights),keys=["pe","ps","pb"];
  const rows=keys.map(k=>({key:k,fair:valuationNum(fairs?.[k]),weight:Number(weights?.[k])||0,score:Number(methods?.[k]?.score),coverage:Number(methods?.[k]?.coverage)})).filter(x=>x.fair>0&&x.weight>0);
  if(!(center>0)&&!rows.length)return {available:false,center:null,low:null,high:null,confidence:0,position:"資料不足",positionRisk:"neutral",dispersionPct:null,halfWidthPct:null,count:0,attractiveness:50,pressure:50,pressureLabel:"中"};
  const totalW=rows.reduce((s,x)=>s+x.weight,0)||1;
  const dispersionPct=center>0&&rows.length?Math.sqrt(rows.reduce((s,x)=>s+Math.pow((x.fair/center-1)*100,2)*x.weight,0)/totalW):0;
  const agreementScore=Math.round(stageClamp(100-dispersionPct*2.35,15,100));
  const suitability=rows.length?rows.reduce((s,x)=>s+(Number.isFinite(x.score)?x.score:45)*x.weight,0)/totalW:45;
  const modelCoverage=stageClamp(Number(model?.confidence)||0,0,100);
  const fund=longQuantitativeFundamentals(v||{}),fundCoverage=Math.round(stageClamp((Number(fund?.coverage)||0)/40*100,0,100));
  const count=rows.length,countScore=count>=3?100:count===2?78:count===1?48:0;
  let confidence=Math.round(stageClamp(modelCoverage*.25+suitability*.25+agreementScore*.25+countScore*.10+fundCoverage*.15,0,100));
  if(count===1)confidence=Math.min(confidence,65);else if(count===2)confidence=Math.min(confidence,88);
  const extra=count===1?8:count===2?2:0,halfWidthPct=stageClamp(7+dispersionPct*.70+(100-confidence)*.10+extra,8,32);
  const low=center*(1-halfWidthPct/100),high=center*(1+halfWidthPct/100),p=valuationNum(price);
  let position="資料不足",positionRisk="neutral";
  if(p>0){
    if(p<low*.90){position="明顯低估";positionRisk="safe"}
    else if(p<low){position="偏低估";positionRisk="safe"}
    else if(p<=high){position="接近合理";positionRisk="watch"}
    else if(p<=high*1.12){position="成長預期區";positionRisk="watch"}
    else if(p<=high*1.28){position="偏高估";positionRisk="danger"}
    else {position="明顯高估";positionRisk="danger"}
  }
  const centerGap=p>0?(center/p-1)*100:null;
  let attractiveness=centerGap===null?50:centerGap>=30?90:centerGap>=15?82:centerGap>=5?72:centerGap>=-5?60:centerGap>=-15?46:centerGap>=-25?32:20;
  if(position==="明顯低估")attractiveness=Math.max(attractiveness,88);
  else if(position==="偏低估")attractiveness=Math.max(attractiveness,74);
  else if(position==="接近合理")attractiveness=stageClamp(attractiveness,52,70);
  else if(position==="成長預期區")attractiveness=Math.min(attractiveness,50);
  else if(position==="偏高估")attractiveness=Math.min(attractiveness,36);
  else if(position==="明顯高估")attractiveness=Math.min(attractiveness,22);
  attractiveness=Math.round(attractiveness*(confidence/100)+50*(1-confidence/100));
  const pressure=Math.round(100-attractiveness),pressureLabel=pressure>=70?"高":pressure>=48?"中":"低";
  return {available:true,center,low,high,confidence,position,positionRisk,dispersionPct,agreementScore,suitability:Math.round(suitability),modelCoverage,fundCoverage,halfWidthPct,count,centerGap,attractiveness,pressure,pressureLabel};
}
function renderValuationModel(model){
  if(!model)return;const m=model.methods||{},w=model.weights||{};
  setText("valuationPeWeight",`${w.pe||0}%`);setText("valuationPsWeight",`${w.ps||0}%`);setText("valuationPbWeight",`${w.pb||0}%`);
  setText("valuationPeSuitability",m.pe?.available?`適用度 ${m.pe.score}/100`:`資料不足`);setText("valuationPsSuitability",m.ps?.available?`適用度 ${m.ps.score}/100`:`資料不足`);setText("valuationPbSuitability",m.pb?.available?`適用度 ${m.pb.score}/100`:`資料不足`);
  setText("valuationPrimaryModel",`${model.primaryLabel} 主導`);setText("valuationModelReason",`${model.reason}｜模型資料 ${model.confidence}%`);
}

function renderValuation(v){
  latestValuationData=v||null;
  const last=valuationNum(v.last),ttm=valuationNum(v.ttm),bps=valuationNum(v.bookValue),peerPb=valuationNum(v.peerPb);
  const peFair=(ttm!==null&&ttm>0&&valuationNum(v.peerPe)>0)?ttm*valuationNum(v.peerPe):null;
  const currentPs=valuationNum(v.currentPs),peerPs=valuationNum(v.peerPs),salesPerShare=valuationNum(v.salesPerShare)??(last>0&&currentPs>0?last/currentPs:null);
  const psFair=(salesPerShare>0&&peerPs>0)?salesPerShare*peerPs:null;
  const pbFair=(bps!==null&&bps>0&&peerPb!==null&&peerPb>0)?bps*peerPb:null;
  const model=valuationModelSuitability(v,{pe:peFair,ps:psFair,pb:pbFair}),weights=model.weights||{},primary=model.primary;
  renderValuationModel(model);
  const usePs=primary==="ps" || (primary!=="pe"&&!(peFair>0)&&psFair>0),operatingPremium=usePs?v.psPremiumPct:v.pePremiumPct;
  const operatingFair=valuationWeightedFair({pe:peFair,ps:psFair},weights,["pe","ps"]),compositeFair=valuationWeightedFair({pe:peFair,ps:psFair,pb:pbFair},weights),profile=valuationFairProfile(v,{pe:peFair,ps:psFair,pb:pbFair},model,last);
  setText("valuationOperatingFairLabel","營運合理價");
  const operatingFairInfo=$("valuationOperatingFairLabel")?.parentElement?.querySelector?.(".formula-info");if(operatingFairInfo){operatingFairInfo.dataset.formula="pe";operatingFairInfo.setAttribute("aria-label","查看營運合理價公式");}
  setText("valuationOperatingIcon",usePs?"PS":"PE");setText("valuationOperatingTitle",usePs?"股價營收比":"本益比");
  const operatingInfo=document.querySelector('#valuation .valuation-section-title [data-formula="pedef"], #valuation .valuation-section-title [data-formula="psdef"]');if(operatingInfo){operatingInfo.dataset.formula=usePs?"psdef":"pedef";operatingInfo.setAttribute("aria-label",usePs?"查看股價營收比定義":"查看本益比定義");}
  setText("valuationOperatingCurrentLabel",usePs?"目前 PS":"目前本益比");setText("valuationOperatingPeerLabel",usePs?"同業 PS 中位數":"同業平均本益比");
  latestValuationScenario={P:last,O:operatingFair,B:pbFair,F:compositeFair,usePs,model,peFair,psFair,pbFair,profile};renderValuationScenario();
  const fairGap=x=>(last!==null&&last>0&&Number.isFinite(x))?(x/last-1)*100:null;
  const renderFair=(valueId,gapId,value)=>{const el=$(gapId),gap=fairGap(value);setText(valueId,Number.isFinite(value)?valuationFmt(value,""):"資料不足");if(!el)return;el.classList.remove("risk-safe","risk-watch","risk-danger","risk-neutral");if(gap===null){el.textContent="--";el.classList.add("risk-neutral");return;}el.textContent=`較現價 ${gap>=0?"+":"-"}${valuationPercent(Math.abs(gap))}`;el.classList.add(`risk-${valuationRiskByCurrentFair(last,value)}`);};
  renderFair("valuationPeFair","valuationPeFairGap",operatingFair);renderFair("valuationPbFair","valuationPbFairGap",pbFair);renderFair("valuationCompositeFair","valuationCompositeGap",compositeFair);
  const profileTone=(id,tone)=>{const el=$(id);if(el)el.dataset.tone=tone||"neutral"};
  setText("valuationFairRange",profile?.available?`${valuationFmt(profile.low)}～${valuationFmt(profile.high)}`:"資料不足");
  setText("valuationFairRangeNote",profile?.available?`中心 ${valuationFmt(profile.center)}｜區間 ±${profile.halfWidthPct.toFixed(1)}%`:"可用估值模型不足");profileTone("valuationRangeCard","neutral");
  setText("valuationEstimateConfidence",profile?.available?`${profile.confidence}%`:"資料不足");
  setText("valuationEstimateConfidenceNote",profile?.available?`${profile.count} 模型｜分歧 ${profile.dispersionPct.toFixed(1)}%｜資料 ${profile.fundCoverage}%`:"等待模型一致性");profileTone("valuationConfidenceCard",profile?.confidence>=75?"good":profile?.confidence>=55?"watch":"bad");
  setText("overviewCompositeFair",Number.isFinite(compositeFair)?valuationFmt(compositeFair):"--");setText("valuationSummaryBps",bps!==null?valuationMetric(bps,""):"資料不足");
  setText("valuationCurrentPe",usePs?valuationMetric(v.currentPs," 倍","資料不足"):valuationMetric(v.currentPe," 倍","資料不足"));
  setText("valuationPeerPe",usePs?valuationMetric(v.peerPs," 倍","資料不足"):valuationMetric(v.peerPe," 倍","資料不足"));
  setText("valuationPeGap",Number.isFinite(Number(operatingPremium))?`${Number(operatingPremium)>=0?"+":"-"}${valuationPercent(Math.abs(Number(operatingPremium)))}`:"不適用");
  setText("valuationBookValue",valuationMetric(v.bookValue," 元","資料不足"));setText("valuationCurrentPb",valuationMetric(v.currentPb," 倍","資料不足"));setText("valuationPeerPb",valuationMetric(v.peerPb," 倍","資料不足"));setText("valuationPbGap",Number.isFinite(Number(v.pbPremiumPct))?`${Number(v.pbPremiumPct)>=0?"+":"-"}${valuationPercent(Math.abs(Number(v.pbPremiumPct)))}`:"資料不足");
  const peGap=$("valuationPeGap"),pbGap=$("valuationPbGap");
  const applyPeerRisk=(el,premium)=>{if(!el)return;el.classList.remove("valuation-premium-high","valuation-premium-low","risk-safe","risk-watch","risk-danger","risk-neutral","valuation-not-applicable");el.removeAttribute("data-tag");if(!Number.isFinite(Number(premium))){if(el.textContent.includes("不適用"))el.classList.add("valuation-not-applicable");return;}const risk=valuationRiskByPeer(premium);el.classList.add(`risk-${risk}`);el.dataset.tag=risk==="safe"?"安全":risk==="watch"?"注意":"危險";};
  applyPeerRisk(peGap,operatingPremium);applyPeerRisk(pbGap,v.pbPremiumPct);
  const statusRisk=profile?.available?profile.positionRisk:valuationRiskByCurrentFair(last,compositeFair),statusLabel=profile?.available?profile.position:(compositeFair===null?"資料不足":statusRisk==="safe"?"偏低估":statusRisk==="watch"?"接近合理":"偏高估");
  setText("valuationStatus",statusLabel);setText("valuationStatusDetail",`PE ${weights.pe||0}%｜PS ${weights.ps||0}%｜PB ${weights.pb||0}%｜估值可信度 ${profile?.available?profile.confidence+"%":"--"}`);
  const statusEl=$("valuationStatus");if(statusEl){statusEl.classList.remove("risk-text-safe","risk-text-watch","risk-text-danger","risk-text-neutral","valuation-not-applicable");statusEl.classList.add(`risk-text-${profile?.available?statusRisk:(compositeFair===null?"neutral":statusRisk)}`);if(statusEl.textContent.includes("不適用"))statusEl.classList.add("valuation-not-applicable");}
  setText("valuationMethod",`PE／PS／PB 適用度自動加權：PE ${weights.pe||0}%、PS ${weights.ps||0}%、PB ${weights.pb||0}%`);
  setText("valuationNote",`PE／PS／PB 先依適用度動態加權形成中心合理價，再依模型分歧、適用度、資料完整度形成合理價區間與估值可信度。`);
  // v2.6.1.35 — 估值小卡直接吃真實模型資料，不再靠未填值的 evidence placeholder。
  setText("valuationEvidenceCurrentPe",valuationMetric(v.currentPe," 倍","資料不足"));
  setText("valuationEvidencePeerPe",valuationMetric(v.peerPe," 倍","資料不足"));
  setText("valuationEvidencePeFair",peFair>0?valuationFmt(peFair):"資料不足");
  setText("valuationEvidenceCurrentPs",valuationMetric(v.currentPs," 倍","資料不足"));
  setText("valuationEvidencePeerPs",valuationMetric(v.peerPs," 倍","資料不足"));
  setText("valuationEvidencePsFair",psFair>0?valuationFmt(psFair):"資料不足");
  setText("valuationEvidenceCurrentPb",valuationMetric(v.currentPb," 倍","資料不足"));
  setText("valuationEvidencePeerPb",valuationMetric(v.peerPb," 倍","資料不足"));
  setText("valuationEvidencePbFair",pbFair>0?valuationFmt(pbFair):"資料不足");
  setText("valuationEvidenceTtmEps",ttm!==null?valuationEpsFmt(ttm):"資料不足");
  setText("valuationTtmEps",ttm!==null?valuationEpsFmt(ttm):"資料不足");
  const host=$("valuationQuarterGrid");if(host){const q=Array.isArray(v.latest4)?v.latest4:[];host.innerHTML=q.slice(0,4).map(x=>`<div class="valuation-quarter-chip"><span>${String(x.period||"")}</span><b>${valuationEpsFmt(x.eps)}</b></div>`).join("");}
  renderFundamentalOverview();
}
async function loadValuation(stock){
  const card=$("valuation");card?.classList.add("is-loading");resetValuation("讀取中");
  try{
    const code=stock?.code||stock?.symbol||"";
    const price=Number(stock?.last??stock?.price??stock?.regularMarketPrice);
    const data=await valuation(code,stock?.market||"",price);
    renderValuation(data);
  }catch(e){
    console.warn("估值更新失敗",e);resetValuation("資料不足");
    setText("valuationNote",`Yahoo 估值資料暫時無法取得：${e.message}`);
  }finally{card?.classList.remove("is-loading")}
}


// v2.6.2.10 — 法人最新交易日以官方最新快照錨定，避免不同股票卡在不同日期。
const INSTITUTIONAL_CACHE_KEY="stockzone_institutional_v26210",INSTITUTIONAL_CACHE_MS=20*60*1000;
let latestInstitutionalData=null;
function readInstitutionalCache(){try{return JSON.parse(localStorage.getItem(INSTITUTIONAL_CACHE_KEY)||"{}")||{}}catch{return{}}}
function writeInstitutionalCache(x){try{localStorage.setItem(INSTITUTIONAL_CACHE_KEY,JSON.stringify(x))}catch{}}
function institutionalCode(stock=currentStock){return String(stock?.code||String(stock?.symbol||"").split(".")[0]||"").replace(/\.(?:TW|TWO)$/i,"").trim()}
function institutionalSignClass(v){const x=Number(v);return Number.isFinite(x)&&x>0?"flow-up":Number.isFinite(x)&&x<0?"flow-down":""}
function institutionalFmtShares(v){
  const x=Number(v);if(!Number.isFinite(x))return "--";
  const sign=x>0?"+":x<0?"−":"" ,a=Math.abs(x);
  let body;
  if(a>=1e8)body=`${(a/1e8).toLocaleString("zh-TW",{maximumFractionDigits:a>=1e9?1:2})}億`;
  else if(a>=1e4)body=`${(a/1e4).toLocaleString("zh-TW",{maximumFractionDigits:a>=1e6?1:2})}萬`;
  else body=a.toLocaleString("zh-TW",{maximumFractionDigits:0});
  return `${sign}${body}股`;
}
function institutionalPeriod(data,key,days){const p=data?.periods?.[String(days)];if(!p||!p.complete)return null;const v=Number(p?.[key]);return Number.isFinite(v)?v:null}
function setInstitutionalFlow(id,v){const el=$(id);if(!el)return;el.textContent=v===null||v===undefined?"--":institutionalFmtShares(v);el.classList.remove("flow-up","flow-down");const cls=institutionalSignClass(v);if(cls)el.classList.add(cls)}
function institutionalStreakText(s){
  if(!s||!s.days)return "等待資料";
  if(s.direction==="flat")return "最新一日持平";
  const action=s.direction==="buy"?"買":"賣",prefix=s.days>=2?`連${s.days}${action}`:`單日${action}超`;
  return `${prefix}｜${institutionalFmtShares(s.value)}`;
}
function institutionalSign(v){const x=Number(v);return Number.isFinite(x)?(x>0?1:x<0?-1:0):null}
function institutionalActorScore(data,key){const x=Number(data?.signal?.actorScores?.[key]);return Number.isFinite(x)?x:0}
function institutionalActorState(data,key){
  const score=institutionalActorScore(data,key);
  if(score>=.65)return {label:"強勢",tone:"tone-good"};
  if(score>=.20)return {label:"偏多",tone:"tone-good"};
  if(score<=-.65)return {label:"賣壓",tone:"tone-bad"};
  if(score<=-.20)return {label:"偏空",tone:"tone-bad"};
  return {label:"中性",tone:"tone-neutral"};
}
function institutionalPeriodPhrase(data,key){
  const vals=[5,10,20].map(days=>institutionalPeriod(data,key,days)),signs=vals.map(institutionalSign);
  if(signs.every(x=>x===1))return "5／10／20日均買超";
  if(signs.every(x=>x===-1))return "5／10／20日均賣超";
  if(signs[0]===1&&signs[1]===1)return "短中期維持買超";
  if(signs[0]===-1&&signs[1]===-1)return "短中期維持賣超";
  const d1=institutionalSign(institutionalPeriod(data,key,1)),d5=signs[0];
  if(d1===1&&d5===-1)return "單日回補，但5日仍偏賣";
  if(d1===-1&&d5===1)return "單日轉賣，但5日仍偏買";
  if(d5===1)return "近5日站在買方";
  if(d5===-1)return "近5日站在賣方";
  return "近期方向仍偏中性";
}
function institutionalActorComment(data,key){
  const s=data?.streaks?.[key],streak=s?.days?institutionalStreakText(s).split("｜")[0]:"";
  const period=institutionalPeriodPhrase(data,key);
  return `${streak&&streak!=="最新一日持平"?`${streak}，`:""}${period}。`;
}
function institutionalStrength(data){
  const direct=Number(data?.signal?.strength);if(Number.isFinite(direct))return Math.max(0,Math.min(100,Math.round(direct)));
  const score=Math.abs(Number(data?.signal?.score)||0),coverage=Math.max(0,Math.min(1,(Number(data?.historyCount)||0)/20));
  const actors=["foreign","trust","dealer"].map(k=>institutionalActorScore(data,k)),dir=Number(data?.signal?.score)>0?1:Number(data?.signal?.score)<0?-1:0;
  const active=actors.filter(x=>Math.abs(x)>=.05),agreement=dir&&active.length?active.filter(x=>Math.sign(x)===dir).length/active.length:0;
  return Math.round(Math.max(0,Math.min(100,(score*.72+agreement*18)*(0.8+coverage*.2))));
}
function institutionalStrengthTone(strength,label){
  const s=String(label||"");if(/偏空/.test(s))return strength>=70?"tone-bad":"tone-watch";if(/偏多/.test(s))return strength>=70?"tone-good":"tone-watch";return "tone-neutral";
}
function institutionalDominantActor(data){
  const p20=data?.periods?.["20"]?.complete?data.periods["20"]:data?.periods?.["10"]?.complete?data.periods["10"]:data?.periods?.["5"]?.complete?data.periods["5"]:data?.periods?.["1"];
  if(!p20)return "";
  const rows=[["外資",Number(p20.foreign)],["投信",Number(p20.trust)],["自營商",Number(p20.dealer)]].filter(x=>Number.isFinite(x[1]));
  if(!rows.length)return "";rows.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));return rows[0][0];
}
function institutionalSystemJudgement(data,label,strength){
  const phrases=[["foreign","外資"],["trust","投信"],["dealer","自營商"]].map(([key,name])=>`${name}${institutionalActorComment(data,key).replace(/。$/,'')}`);
  const signs=["foreign","trust","dealer"].map(key=>Math.sign(institutionalActorScore(data,key))).filter(Boolean),aligned=signs.length>=2&&signs.every(x=>x===signs[0]);
  const dominant=institutionalDominantActor(data),coverage=Number(data?.historyCount)||0;
  const alignment=aligned?`三類法人方向一致${dominant?`，目前以${dominant}的累計買賣超規模最大`:""}`:`三類法人仍有分歧${dominant?`，目前${dominant}的累計變化最明顯`:""}`;
  const coverageNote=coverage<20?`目前取得 ${coverage} 個交易日，較長週期不足時不納入判讀。`:`已取得近20個交易日。`;
  return `${label}｜法人強度 ${strength}/100。${phrases.join("；")}。${alignment}。${coverageNote}`;
}
function resetInstitutional(note="等待資料"){
  latestInstitutionalData=null;
  const chip=$("institutionalSignalChip");if(chip){chip.textContent=note;chip.classList.remove("tone-up","tone-down","tone-watch")}
  const strengthChip=$("institutionalStrengthChip");if(strengthChip){strengthChip.textContent="法人強度 --/100";strengthChip.classList.remove("tone-good","tone-bad","tone-watch","tone-neutral")}
  setText("institutionalAsOf","TWSE／TPEx 官方資料");
  for(const key of ["Foreign","Trust","Dealer","Total"]){for(const d of [1,5,10,20])setInstitutionalFlow(`institutional${key}${d}`,null);setText(`institutional${key}Streak`,note);const state=$(`institutional${key}State`);if(state){state.textContent="--";state.className="tone-neutral"}}
  const streak=$("institutionalStreakList");if(streak)streak.innerHTML=`<span>${note}</span>`;
  setText("institutionalJudgement",note==="讀取中"?"正在讀取官方法人資料…":"搜尋股票後顯示法人籌碼方向。");
  setText("institutionalSource","資料來源：TWSE／TPEx 官方公開資料");
  resetCreditTrading(note);
}
function creditTradingValue(v){return v===null||v===undefined?"--":institutionalFmtShares(v)}
function setCreditFlow(id,v){const el=$(id);if(!el)return;el.textContent=creditTradingValue(v);el.classList.remove("flow-up","flow-down");const cls=institutionalSignClass(v);if(cls)el.classList.add(cls)}
function resetCreditTrading(note="等待資料"){
  setText("creditTradingAsOf",note);const chip=$("creditTradingSignal");if(chip){chip.textContent=note;chip.className="tone-neutral"}
  for(const key of ["Margin1","MarginBalance","Margin5","Margin10","Margin20","Short1","ShortBalance","Short5","Short10","Short20","SblSell","SblBalance","Sbl5","Sbl10","Sbl20"])setCreditFlow(`credit${key}`,null);
  setText("creditMarginUsage","使用率 --");setText("creditShortRatio","券資比 --");setText("creditSblReturn","今日還券 --");setText("creditTradingJudgement",note==="讀取中"?"正在讀取信用交易資料…":"等待信用交易歷史資料。");
}
function renderCreditTrading(c){
  if(!c?.available)return resetCreditTrading(c?.signal?.label||"資料暫缺");
  const latest=c.latest||{},periods=c.periods||{},p=n=>periods[String(n)]||{};
  setText("creditTradingAsOf",c.asOfDate?`${c.asOfDate}｜${c.historyCount||0}日歷史`:"官方資料");
  setCreditFlow("creditMargin1",p(1).marginChange);setCreditFlow("creditMarginBalance",latest.margin_balance);setCreditFlow("creditMargin5",p(5).complete?p(5).marginChange:null);setCreditFlow("creditMargin10",p(10).complete?p(10).marginChange:null);setCreditFlow("creditMargin20",p(20).complete?p(20).marginChange:null);
  setCreditFlow("creditShort1",p(1).shortChange);setCreditFlow("creditShortBalance",latest.short_balance);setCreditFlow("creditShort5",p(5).complete?p(5).shortChange:null);setCreditFlow("creditShort10",p(10).complete?p(10).shortChange:null);setCreditFlow("creditShort20",p(20).complete?p(20).shortChange:null);
  setCreditFlow("creditSblSell",latest.sbl_sell);setCreditFlow("creditSblBalance",latest.sbl_balance);setCreditFlow("creditSbl5",p(5).complete?p(5).sblChange:null);setCreditFlow("creditSbl10",p(10).complete?p(10).sblChange:null);setCreditFlow("creditSbl20",p(20).complete?p(20).sblChange:null);
  setText("creditMarginUsage",Number.isFinite(Number(latest.margin_usage_pct))?`使用率 ${Number(latest.margin_usage_pct).toFixed(1)}%`:"使用率 --");
  setText("creditShortRatio",Number.isFinite(Number(latest.short_margin_ratio))?`券資比 ${Number(latest.short_margin_ratio).toFixed(1)}%`:"券資比 --");
  setText("creditSblReturn",latest.sbl_return===null||latest.sbl_return===undefined?"今日還券 --":`今日還券 ${institutionalFmtShares(latest.sbl_return)}`);
  const sig=c.signal||{},chip=$("creditTradingSignal");if(chip){chip.textContent=sig.label||"中性";chip.className=sig.tone==="good"?"tone-good":sig.tone==="bad"?"tone-bad":sig.tone==="watch"?"tone-watch":"tone-neutral"}
  const reasons=Array.isArray(sig.reasons)&&sig.reasons.length?sig.reasons.join("；"):"信用籌碼目前沒有明顯異常組合";setText("creditTradingJudgement",`${sig.label||"中性"}｜${reasons}。`);
}
function institutionalChipTone(label){const s=String(label||"");return /偏多/.test(s)?"tone-up":/偏空/.test(s)?"tone-down":s==="中性"?"tone-watch":""}
function renderInstitutional(data){
  latestInstitutionalData=data||null;if(!data)return resetInstitutional("資料不足");
  const chip=$("institutionalSignalChip"),label=data?.signal?.label||"中性",strength=institutionalStrength(data);
  if(data?.signal&&typeof data.signal==="object"&&!Number.isFinite(Number(data.signal.strength)))data.signal.strength=strength;
  if(chip){chip.textContent=label;chip.classList.remove("tone-up","tone-down","tone-watch");const tone=institutionalChipTone(label);if(tone)chip.classList.add(tone)}
  const strengthChip=$("institutionalStrengthChip");if(strengthChip){strengthChip.textContent=`法人強度 ${strength}/100`;strengthChip.classList.remove("tone-good","tone-bad","tone-watch","tone-neutral");strengthChip.classList.add(institutionalStrengthTone(strength,label))}
  setText("institutionalAsOf",data.asOfDate?`${data.asOfDate}｜${data.market||""}`:"官方最新資料");
  const map=[["Foreign","foreign"],["Trust","trust"],["Dealer","dealer"],["Total","total"]];
  for(const [labelKey,key] of map){
    for(const days of [1,5,10,20])setInstitutionalFlow(`institutional${labelKey}${days}`,institutionalPeriod(data,key,days));
    setText(`institutional${labelKey}Streak`,institutionalActorComment(data,key));
    const state=$(`institutional${labelKey}State`),stateData=key==="total"?{label:label.replace("法人","")||"中性",tone:institutionalChipTone(label)==="tone-down"?"tone-bad":institutionalChipTone(label)==="tone-up"?"tone-good":"tone-neutral"}:institutionalActorState(data,key);
    if(state){state.textContent=stateData.label;state.className=stateData.tone}
  }
  const host=$("institutionalStreakList");
  if(host){
    host.replaceChildren();
    const names={foreign:"外資",trust:"投信",dealer:"自營商",total:"三大法人"};
    for(const key of ["foreign","trust","dealer","total"]){
      const st=data?.streaks?.[key],tag=document.createElement("span");
      tag.textContent=`${names[key]}｜${institutionalStreakText(st).split("｜")[0]}`;
      const dir=st?.direction==="buy"?"flow-up":st?.direction==="sell"?"flow-down":"";if(dir)tag.classList.add(dir);host.append(tag);
    }
  }
  setText("institutionalJudgement",institutionalSystemJudgement(data,label,strength));
  setText("institutionalSource",`資料來源：${data.source||"TWSE／TPEx 官方公開資料"}`);
  renderCreditTrading(data.creditTrading);
}

async function institutional(query,market="",force=false){
  const code=String(query||"").replace(/\.(?:TW|TWO)$/i,"").trim(),cache=readInstitutionalCache(),hit=cache[code];
  if(!force&&hit?.data&&Date.now()-Number(hit.savedAt||0)<INSTITUTIONAL_CACHE_MS)return hit.data;
  const params=new URLSearchParams({q:code,market:String(market||"")});
  const data=await readJson(await fetch(`/api/institutional?${params.toString()}`,{cache:"no-store"}),"法人動向");
  cache[code]={savedAt:Date.now(),data};const keys=Object.keys(cache).sort((a,b)=>Number(cache[b]?.savedAt||0)-Number(cache[a]?.savedAt||0));for(const k of keys.slice(20))delete cache[k];writeInstitutionalCache(cache);return data;
}
async function loadInstitutional(stock,force=false){
  const code=institutionalCode(stock),market=stock?.market||stock?.marketLabel||"",card=$("institutionalTrend");if(!code)return;
  card?.classList.add("is-loading");
  try{
    const data=await institutional(code,market,force),cur=institutionalCode(currentStock);if(cur&&cur!==code)return;renderInstitutional(data);
  }catch(e){
    console.warn("法人動向更新失敗",e);const cur=institutionalCode(currentStock);if(!cur||cur===code){latestInstitutionalData=null;resetInstitutional("資料暫缺");setText("institutionalJudgement",`TWSE／TPEx 官方法人資料暫時無法取得：${e.message}`)}
  }finally{card?.classList.remove("is-loading")}
}

function renderQuoteFields(x){
  const last=Number(x?.last ?? x?.price ?? x?.regularMarketPrice),change=Number(x?.change ?? x?.regularMarketChange),pct=Number(x?.changePct ?? x?.changePercent ?? x?.regularMarketChangePercent);
  setText("currentPrice",fmt(last));setText("metricPrice",fmt(last));setText("decisionPrice",fmt(last));
  const ch=Number.isFinite(change)?`${change>0?"+":""}${fmt(change)}${Number.isFinite(pct)?` (${pct>0?"+":""}${fmt(pct)}%)`:""}`:"—";
  setText("priceChange",ch);setText("metricChange",ch);setText("updateTime","剛剛更新");if($("updateRow"))$("updateRow").hidden=false;
  const cls=change>0?"up":change<0?"down":"";["currentPrice","priceChange","metricChange"].forEach(id=>{const el=$(id);if(el)el.className=cls});
}
function patchCurrentQuote(x){
  const incoming=String(x?.code||String(x?.symbol||"").split(".")[0]||""),current=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");
  if(!currentStock||!incoming||incoming!==current)return false;
  currentStock={...currentStock,...x,name:currentStock.name||x.name,shortName:currentStock.shortName||x.shortName,market:currentStock.market||x.market};renderQuoteFields(currentStock);updateListButtons();renderTradeOutputs();if(["swing","mixed"].includes(latestPlayStyleResult?.key))renderSwingWave(latestPlayStyleResult);return true;
}
function renderStock(x){
  currentStock=x;latestHistory5Y=null;latestFundamentalData=null;latestInstitutionalData=null;resetFundamentalOverview("讀取中");resetInstitutional("讀取中");resetPlayStyle("讀取分析資料中…");
  setText("stockName",shortStockName(x.name||x.shortName)||"—");
  setText("stockCodeLabel",stockHeaderMeta(x));
  setText("marketLabel","");
  renderQuoteFields(x);updateListButtons();beginNews();rememberStockMeta(x);
}
let activeSearchSeq=0;
async function search(){
  const input=$("stockCode"),btn=$("searchButton"),q=input?.value.trim();
  if(!q){setStatus("請輸入股票名稱或代碼",true);return}
  const seq=++activeSearchSeq;btn.disabled=true;setStatus("搜尋股票…");
  try{
    // v2.6.5.16：保留 v2.6.5.14 DB-first 搜尋；盤中 quote 改由官方 MIS 優先。盤後 quote 直接用 Neon 的
    // market_company_profile + price_snapshot 同時完成「名稱→代碼／市場」與收盤價解析。
    // 不再為每一檔第一次搜尋額外抓官方股票主檔或交易所產業類別。
    let meta=localStockMeta(q)||cachedStockMeta(q);
    let data=await quote(meta?.code||q,meta?.market||"");
    if(seq!==activeSearchSeq)return;
    if(!meta&&data){
      const code=String(data.code||String(data.symbol||"").split(".")[0]||"").trim();
      if(/^\d{4,6}$/.test(code))meta={code,name:data.name||data.shortName||(/[\u3400-\u9fff]/.test(q)?q:""),market:data.market||data.marketLabel||"",symbol:data.symbol||`${code}${String(data.market||"")==="上櫃"?".TWO":".TW"}`};
    }
    data=mergeStockMeta(data,meta);renderStock(data);setView("overview");
    loadValuation(data);loadTechnical(data);void loadFundamentals(data);void loadInstitutional(data);loadDisposal(data);beginTargetSearch(data.code||data.symbol||q);
    setStatus(`搜尋成功：${shortStockName(data.name)||data.code||q}`);btn.disabled=false;

    const code=String(data.code||String(data.symbol||"").split(".")[0]||q),name=data.name||data.shortName||"";
    // 只有 DB/Yahoo 沒帶齊身分時才背景補查；正常搜尋不再多送一個 meta request。
    if(!data?.name||!data?.market){
      void stockMeta(code||q).then(m=>{if(!m||seq!==activeSearchSeq)return;const curCode=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");if(curCode&&String(m.code||"")!==curCode)return;currentStock=mergeStockMeta(currentStock,m);rememberStockMeta(currentStock);setText("stockName",shortStockName(currentStock.name||currentStock.shortName)||"—");setText("stockCodeLabel",stockHeaderMeta(currentStock))}).catch(e=>console.warn("股票身分背景補查失敗",e));
    }
    void loadTargetPlay(code,name).catch(e=>console.warn("目標價背景更新失敗",e));
    void loadNews(code,name).catch(e=>console.warn("新聞背景更新失敗",e));
  }catch(e){
    if(seq!==activeSearchSeq)return;console.error(e);setStatus(`搜尋失敗：${e.message}`,true);
  }finally{if(seq===activeSearchSeq)btn.disabled=false}
}

$("searchButton")?.addEventListener("click",search);
$("stockCode")?.addEventListener("keydown",e=>{if(e.key==="Enter")search()});
$("manualRefreshBtn")?.addEventListener("click",async()=>{if(!currentStock)return setStatus("請先搜尋股票",true);const btn=$("manualRefreshBtn"),input=$("stockCode");if(btn)btn.disabled=true;if(input)input.value=currentStock.code||currentStock.symbol||currentStock.name||"";try{await search()}finally{if(btn)btn.disabled=false}});
document.querySelectorAll("[data-disposal-help]").forEach(btn=>btn.addEventListener("click",()=>{const type=btn.dataset.disposalHelp,title=type==="progress"?"距離處置進度":"除外／豁免條件",text=type==="progress"?"處置主要計數門檻：連續 3 個營業日達第一款，或連續 5 日／近 10 日 6 次／近 30 日 12 次達第一至第八款。畫面中的 3、10、30 日進度只顯示可直接量化的核心門檻。":"除外條件依各注意款次不同而定。價格注意警戒線是以價格異常款的公開門檻做保守估算；低於此線只能排除該價格條件，不能保證其他注意條件不成立。";setText("disposalPopoverTitle",title);setText("disposalPopoverText",text);const p=$("disposalPopover");if(p)p.hidden=false}));
$("disposalPopoverClose")?.addEventListener("click",()=>{const p=$("disposalPopover");if(p)p.hidden=true});

document.querySelectorAll("[data-scroll]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.getElementById(btn.dataset.scroll)?.scrollIntoView({behavior:"smooth",block:"start"});
    $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
  });
});
$("menuBtn")?.addEventListener("click",()=>{
  $("sidebar")?.classList.toggle("open");$("overlay")?.classList.toggle("show");
});
$("overlay")?.addEventListener("click",()=>{
  $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
});
$("mobileSearch")?.addEventListener("click",()=>{
  document.querySelector(".searchbox")?.classList.add("mobile-open");
  $("stockCode")?.focus();
  window.scrollTo({top:0,behavior:"smooth"});
});


// v2.2.2 — full target list + holdings/watchlist management.
let currentStock=null;
let targetRowsCache=[];
let targetTypeFilter="外資";
const LIST_KEYS={holdings:"stockzone_holdings_v2",watchlist:"stockzone_watchlist_v2"};

function syncMobileMarketLabel(){const el=$("marketLabel");if(!el)return;const raw=String(el.textContent||"").trim();el.dataset.shortMarket=/上櫃/.test(raw)?"上櫃":/上市/.test(raw)?"上市":"";}

function targetFmt(n){
  const x=Number(n); return Number.isFinite(x)?x.toLocaleString("zh-TW",{maximumFractionDigits:2}):"--";
}
function targetDateValue(x){
  const d=new Date(x?.date||x?.publishedAt||x?.published||x?.time||0);
  return Number.isNaN(d.getTime())?0:d.getTime();
}
function targetPriceValue(x){return Number(x?.target ?? x?.targetPrice ?? x?.price)}
function targetBrokerName(x){return x?.broker||x?.brokerName||x?.name||"未知券商"}
function inferredBrokerType(name,fallback="未知"){
 const n=String(name||"").trim();
 const foreign=["高盛","美銀","美林","里昂","摩根士丹利","大摩","摩根大通","小摩","花旗","瑞銀","UBS","野村","麥格理","滙豐","匯豐","德意志","德銀","巴克萊","瑞信","大和","法巴","法國巴黎","Jefferies","傑富瑞"];
 const local=["中信","中國信託","元大","國泰","富邦","第一金","第一金證券","永豐","永豐金","凱基","群益","兆豐","華南","統一","玉山","台新","元富","新光","康和","宏遠","亞東","台中銀","彰銀","合庫","合作金庫","土銀","國票","大展","福邦","高橋"];
 if(foreign.some(x=>n.includes(x)))return "外資";
 if(local.some(x=>n.includes(x)))return "本土";
 return fallback;
}
function targetBrokerType(x){
 const t=String(x?.brokerType||x?.type||"");
 return inferredBrokerType(targetBrokerName(x),t.includes("外資")?"外資":t.includes("本土")?"本土":"未知");
}
function targetHistoryOf(x){
  const h=x?.targetHistory||x?.history||x?.records||x?.targets;
  return Array.isArray(h)&&h.length?h:[x];
}
function normalizeTargetRows(payload){
  if(Array.isArray(payload))return payload;
  for(const k of ["brokers","targets","items","results","data"]){
    if(Array.isArray(payload?.[k]))return payload[k];
  }
  return [];
}
function targetCandidate(row){
  const history=targetHistoryOf(row)
    .filter(r=>Number.isFinite(targetPriceValue(r)))
    .sort((a,b)=>targetDateValue(b)-targetDateValue(a));
  return history.length?{row,history,latest:history[0],time:targetDateValue(history[0])}:null;
}
function pickMainTarget(rows){
  return rows.map(targetCandidate).filter(Boolean).sort((a,b)=>b.time-a.time)[0]||null;
}
function targetBasis(main){
  const h=main.history,latest=targetPriceValue(h[0]),previous=h.length>1?targetPriceValue(h[1]):NaN;
  if(Number.isFinite(previous)){
    if(latest>previous)return {base:previous,rule:"上調 → 以前次為基準"};
    if(latest<previous)return {base:latest,rule:"下調 → 以最新為基準"};
  }
  return {base:latest,rule:h.length>1?"維持 → 以最新為基準":"只有一筆 → 以最新為基準"};
}

const MAIN_BROKER_KEY="stockzone_main_broker_v232";
function brokerPrefKey(){return `${currentStock?.code||""}`}
function getBrokerPref(){try{return JSON.parse(localStorage.getItem(MAIN_BROKER_KEY)||"{}")[brokerPrefKey()]||""}catch{return""}}
function setBrokerPref(name){let x={};try{x=JSON.parse(localStorage.getItem(MAIN_BROKER_KEY)||"{}")||{}}catch{};if(name)x[brokerPrefKey()]=name;else delete x[brokerPrefKey()];localStorage.setItem(MAIN_BROKER_KEY,JSON.stringify(x))}
function allTargetCandidates(){return targetRowsCache.map(targetCandidate).filter(Boolean).sort((a,b)=>b.time-a.time)}
function fillMainBrokerSelect(){
  const sel=$("mainBrokerSelect"); if(!sel)return;
  const pref=getBrokerPref();
  const names=[...new Set(allTargetCandidates().map(x=>targetBrokerName(x.row)))];
  sel.innerHTML=`<option value="">自動選擇</option>`+names.map(n=>`<option value="${n.replace(/"/g,"&quot;")}">${n}</option>`).join("");
  if(pref&&names.includes(pref))sel.value=pref;
}
function preferredMainTarget(){
  const all=allTargetCandidates(),pref=getBrokerPref();
  if(pref){
    const hit=all.find(x=>targetBrokerName(x.row)===pref);
    if(hit)return hit;
  }
  return all[0]||null;
}
function renderTargetHistory3(main){
  const host=$("targetHistory3"); if(!host)return;
  if(!main){host.innerHTML="";return}
  const h=main.history.slice(0,3);
  host.innerHTML=h.map((x,i)=>`<div class="history3-row"><span>${i===0?"最新":i===1?"前次":"上次"}</span><strong>${targetFmt(targetPriceValue(x))}</strong><time>${String(x.date||x.publishedAt||x.published||"—").slice(0,10)}</time></div>`).join("");
}
$("mainBrokerSelect")?.addEventListener("change",e=>{
  setBrokerPref(e.target.value);
  const main=preferredMainTarget();
  renderMainTarget(main);
  renderTargetHistory3(main);
  // v2.5.9.3：券商是共振價格來源，切換後必須立即重算目標、總覽與買賣決策。
  renderTradeOutputs();
});

function renderMainTarget(main){
 const play=$("targetPlay");
 if(!main){
  play?.classList.add("hidden");
  setText("overviewNearestPrice","--"); setText("overviewNearestRate","倍率--");
  setText("overviewMainBrokerLine","目標券商：--"); renderValuationScenario(); return;
 }
 const basis=targetBasis(main);
 const current=Number(currentStock?.last??currentStock?.price??currentStock?.regularMarketPrice);
 const levels=[.80,.85,.88].map(rate=>({rate,price:Math.floor(basis.base*rate)}));
 const nearest=Number.isFinite(current)?levels.slice().sort((x,y)=>Math.abs(x.price-current)-Math.abs(y.price-current))[0]:levels[0];
 setText("overviewNearestPrice",`${targetFmt(nearest.price)}`);
 setText("overviewNearestRate",`（倍率${Math.round(nearest.rate*100)}%）`);
 setText("overviewMainBrokerLine",`${targetBrokerName(main.row)}：${targetFmt(targetPriceValue(main.latest))}`);
 setText("targetBase",`${targetFmt(basis.base)}`); setText("targetRule",basis.rule);
 setText("target80",`${targetFmt(Math.floor(basis.base*.80))}`); setText("target85",`${targetFmt(Math.floor(basis.base*.85))}`); setText("target88",`${targetFmt(Math.floor(basis.base*.88))}`);
 renderTargetHistory3(main); play?.classList.remove("hidden"); renderValuationScenario();
}
const TARGET_CORR_KEY="stockzone_target_corrections_v239"; let editingTarget=null;
function readCorr(){try{return JSON.parse(localStorage.getItem(TARGET_CORR_KEY)||"{}")||{}}catch{return{}}}
function writeCorr(x){localStorage.setItem(TARGET_CORR_KEY,JSON.stringify(x))}
function corrStableId(row,code=currentStock?.code||""){
 if(row?._corrId)return row._corrId;
 const latest=targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row||{};
 return [code,row?.originalBroker||targetBrokerName(row),String(latest?.date||latest?.publishedAt||latest?.published||"").slice(0,10),String(targetPriceValue(latest)||"")].join("|");
}
function historyCorrId(row,item,code=currentStock?.code||""){
 const broker=row?.originalBroker||targetBrokerName(row),d=String(item?.date||item?.publishedAt||item?.published||"").slice(0,10);
 return `history|${code}|${broker}|${d}|${targetPriceValue(item)}`;
}
function applyCorr(rows,code=currentStock?.code||""){
 const c=readCorr();
 return rows.map(row=>{
  const id=corrStableId(row,code),fix=c[id],r={...row,_corrId:id};
  if(fix?.deleted)return null;
  if(fix?.broker){r.broker=fix.broker;r.brokerType=fix.brokerType||inferredBrokerType(fix.broker,"未知");}
  let h=targetHistoryOf(r).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a));
  h=h.map((x,i)=>{
    const hf=c[historyCorrId(row,x,code)];
    if(hf?.deleted)return null;
    let y={...x};
    if(hf?.broker)y.broker=hf.broker;
    if(Number.isFinite(Number(hf?.target)))y.target=Number(hf.target);
    if(i===0&&Number.isFinite(Number(fix?.target)))y.target=Number(fix.target);
    return y;
  }).filter(Boolean);
  if(!h.length)return null;
  r.targetHistory=h; r.target=targetPriceValue(h[0]);
  return r;
 }).filter(Boolean);
}
function openEdit(row){
  editingTarget={row,item:null};
  const latest=targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row;
  $("editBrokerName").value=targetBrokerName(row);
  $("editTargetPrice").value=targetPriceValue(latest)||"";
  $("targetEditModal").classList.remove("hidden");
}
function openHistoryEdit(row,item){
  editingTarget={row,item};
  $("editBrokerName").value=targetBrokerName(item)||targetBrokerName(row);
  $("editTargetPrice").value=targetPriceValue(item)||"";
  $("targetEditModal").classList.remove("hidden");
}
function closeEdit(){editingTarget=null;$("targetEditModal")?.classList.add("hidden")}
$("closeTargetEdit")?.addEventListener("click",closeEdit);
$("cancelTargetEdit")?.addEventListener("click",closeEdit);

$("deleteTargetEdit")?.addEventListener("click",()=>{
 if(!editingTarget)return;
 const {row,item}=editingTarget,c=readCorr(),code=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||""),latest=item||targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row;
 const id=item?historyCorrId(row,item,code):corrStableId(row,code);
 c[id]={...(c[id]||{}),deleted:true};
 // 同時留下「股票＋券商＋日期＋目標價」紀錄級 tombstone；API 之後再抓到同一筆也不會復活。
 if(latest)c[historyCorrId(row,latest,code)]={...(c[historyCorrId(row,latest,code)]||{}),deleted:true};
 writeCorr(c);targetRowsCache=applyCorr(targetRowsCache,code);
 const all=readTargetCache();if(code){all[code]={...(all[code]||{}),rows:targetRowsCache,updatedAt:all[code]?.updatedAt||new Date().toISOString()};writeTargetCache(all)}
 closeEdit();renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget());setStatus("已刪除，此筆之後不再自動復原");
});
$("saveTargetEdit")?.addEventListener("click",()=>{
 if(!editingTarget)return;
 const broker=$("editBrokerName").value.trim(),target=Number($("editTargetPrice").value);
 if(!broker||!Number.isFinite(target)||target<=0)return setStatus("請輸入正確資料",true);
 const {row,item}=editingTarget,c=readCorr(),id=item?historyCorrId(row,item):corrStableId(row);
 c[id]={broker,target,brokerType:inferredBrokerType(broker,"未知")};writeCorr(c);
 targetRowsCache=applyCorr(targetRowsCache);
 closeEdit();renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget());setStatus("已修改");
});

const TARGET_CACHE_KEY="stockzone_target_cache_v2461";
const TARGET_SEEN_KEY="stockzone_target_seen_v2503";
let targetNewKeys=new Set(),expandedBrokerRows=new Set();
function readTargetUnread(){try{return JSON.parse(localStorage.getItem(TARGET_SEEN_KEY)||"{}")||{}}catch{return{}}}
function writeTargetUnread(x){try{localStorage.setItem(TARGET_SEEN_KEY,JSON.stringify(x))}catch{}}
function targetUnreadFor(code){return new Set(readTargetUnread()[String(code)]||[])}
function saveTargetUnread(code,set){const all=readTargetUnread();all[String(code)]=[...set];writeTargetUnread(all)}
function readTargetCache(){try{return JSON.parse(localStorage.getItem(TARGET_CACHE_KEY)||"{}")||{}}catch{return{}}}
function writeTargetCache(x){localStorage.setItem(TARGET_CACHE_KEY,JSON.stringify(x))}
function targetSig(row){const c=targetCandidate(row);if(!c)return"";return `${targetBrokerName(row)}|${targetPriceValue(c.latest)}|${String(c.latest.date||c.latest.publishedAt||"").slice(0,10)}`}
function mergeTargetRows(oldRows,newRows){
 const all=[...(newRows||[]),...(oldRows||[])],groups=new Map();
 for(const row of all){const name=targetBrokerName(row),key=`${targetBrokerType(row)}|${name}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(...targetHistoryOf(row))}
 return [...groups.entries()].map(([key,h])=>{h=h.filter(x=>Number.isFinite(targetPriceValue(x))).sort((a,b)=>targetDateValue(b)-targetDateValue(a));const uniq=[];for(const x of h){if(!uniq.some(y=>targetPriceValue(y)===targetPriceValue(x)&&String(y.date||y.publishedAt||"").slice(0,10)===String(x.date||x.publishedAt||"").slice(0,10)))uniq.push(x)}const latest=uniq[0];return latest?{...latest,broker:targetBrokerName(latest),brokerType:targetBrokerType(latest),targetHistory:uniq.slice(0,3)}:null}).filter(Boolean)
}
function cacheTargetsForStock(code,rows){const all=readTargetCache(),prev=all[code]?.rows||[];const prevSigs=new Set(prev.map(targetSig)),unread=targetUnreadFor(code);if(prev.length)for(const sig of rows.map(targetSig))if(sig&&!prevSigs.has(sig))unread.add(sig);targetNewKeys=unread;saveTargetUnread(code,unread);all[code]={rows,updatedAt:new Date().toISOString()};writeTargetCache(all)}
function isNewTarget(row){return targetNewKeys.has(targetSig(row))}
function markTargetRead(row){const sig=targetSig(row);if(!sig||!targetNewKeys.has(sig))return;targetNewKeys.delete(sig);saveTargetUnread(newsCode(),targetNewKeys);renderBrokerRows()}
function renderBrokerRows(){
  const host=$("brokerRows"); if(!host)return;
  const play=$("targetPlay");
  play?.classList.remove("hidden");
  renderMainTarget(preferredMainTarget());
  const rows=targetRowsCache.map(targetCandidate).filter(Boolean).filter(x=>targetBrokerType(x.row)===targetTypeFilter).sort((a,b)=>b.time-a.time);
  if(!rows.length){host.innerHTML=`<p>目前沒有${targetTypeFilter}目標價。</p>`;return}
  host.innerHTML=rows.map((x,i)=>{
    const d=x.latest.date||x.latest.publishedAt||x.latest.published||"—",src=x.latest?.sourceUrl||x.row?.sourceUrl||"",name=targetBrokerName(x.row),open=expandedBrokerRows.has(name);
    const history=x.history.map((h,j)=>{const hsrc=h?.sourceUrl||x.row?.sourceUrl||"";return `<div class="broker-history-row"><span>${j===0?"最新":`歷史 ${j}`}</span><strong>${targetFmt(targetPriceValue(h))}</strong><time>${String(h.date||h.publishedAt||"—").slice(0,10)}</time><span class="broker-actions history-actions"><button class="broker-menu-btn" data-history-menu="${i}-${j}" type="button">︙</button><span class="broker-menu hidden" data-history-menu-box="${i}-${j}">${hsrc?`<a href="${hsrc}" target="_blank" rel="noopener">來源</a>`:""}<button type="button" data-edit-history="${i}-${j}">修改</button></span></span></div>`}).join("");
    return `<div class="broker-row" data-index="${i}" data-target-read="${i}"><span><b>${name}</b>${isNewTarget(x.row)?'<em class="target-new">NEW</em>':''}</span><strong>${targetFmt(targetPriceValue(x.latest))}</strong><time>${String(d).slice(0,10)}</time><button class="broker-expand" data-expand="${i}" type="button">${open?"︿":"⌵"}</button><span class="broker-actions"><button class="broker-menu-btn" data-menu="${i}" type="button">︙</button><span class="broker-menu hidden" data-menu-box="${i}">${src?`<a href="${src}" target="_blank" rel="noopener">來源</a>`:""}<button type="button" data-edit-target="${i}">修改</button></span></span><div class="broker-history ${open?"":"hidden"}" data-history="${i}">${history}</div></div>`;
  }).join("");
  host.querySelectorAll("[data-target-read]").forEach(row=>row.addEventListener("click",e=>{if(e.target.closest("button,a,.broker-menu"))return;const i=Number(row.dataset.targetRead);if(rows[i])markTargetRead(rows[i].row)}));
  host.querySelectorAll("[data-expand]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const i=Number(btn.dataset.expand),name=targetBrokerName(rows[i].row);expandedBrokerRows.has(name)?expandedBrokerRows.delete(name):expandedBrokerRows.add(name);renderBrokerRows()}));
  host.querySelectorAll("[data-menu]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const box=host.querySelector(`[data-menu-box="${btn.dataset.menu}"]`);host.querySelectorAll(".broker-menu").forEach(x=>{if(x!==box)x.classList.add("hidden")});box?.classList.toggle("hidden")}));
  host.querySelectorAll("[data-edit-target]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();openEdit(rows[Number(btn.dataset.editTarget)].row)}));
  host.querySelectorAll("[data-history-menu]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const box=host.querySelector(`[data-history-menu-box="${btn.dataset.historyMenu}"]`);host.querySelectorAll(".broker-menu").forEach(x=>{if(x!==box)x.classList.add("hidden")});box?.classList.toggle("hidden")}));
  host.querySelectorAll("[data-edit-history]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const [ri,hi]=btn.dataset.editHistory.split("-").map(Number);openHistoryEdit(rows[ri].row,rows[ri].history[hi])}));
}
function filterBadKnownTarget(rows){
  const code=String(currentStock?.code||currentStock?.symbol||"");
  if(code!=="2330")return rows;
  return rows.filter(row=>!(targetBrokerName(row).includes("高盛") && Number(targetPriceValue(row))===22000));
}

function beginTargetSearch(code=String(currentStock?.code||currentStock?.symbol||"")){
  const cached=applyCorr(readTargetCache()[String(code)]?.rows||[],String(code));targetNewKeys=targetUnreadFor(code);targetRowsCache=cached;
  if(cached.length){renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget())}
  else{renderMainTarget(null);const host=$("brokerRows");if(host)host.innerHTML="<p>搜尋目標價…</p>";$("targetPlay")?.classList.add("hidden")}
}
function renderTargetPlay(payload,code=String(currentStock?.code||currentStock?.symbol||"")){
  code=String(code||"");
  const fresh=filterBadKnownTarget(applyCorr(normalizeTargetRows(payload),code));
  const cached=applyCorr(readTargetCache()[code]?.rows||[],code);
  targetRowsCache=applyCorr(mergeTargetRows(cached,fresh),code);
  cacheTargetsForStock(code,targetRowsCache);
  renderBrokerRows(); fillMainBrokerSelect(); if(targetTypeFilter==="目標")renderMainTarget(preferredMainTarget());
  if(latestFiveStageResult&&latestTechnicalForPlay)renderPlayStyle();
}
async function fetchTargetPayload(code,name){
  const cached=readTargetCache()[String(code)]?.rows||[];
  const recent=cached.length?"&recent=3":"";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  try{const res=await fetch(`/api/targets?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}${recent}`,{cache:"no-store",signal:controller.signal});return await readJson(res,"目標價")}finally{clearTimeout(timer)}
}
async function loadTargetPlay(code,name){
  const expected=String(code||"");
  try{
    const payload=await fetchTargetPayload(code,name),current=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");
    if(current!==expected)return false;renderTargetPlay(payload,expected);return true;
  }catch(e){console.warn("目標價載入失敗",e);const current=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");if(current===expected&&!targetRowsCache.length){if($("brokerRows"))$("brokerRows").innerHTML="<p>目標價暫時無法載入。</p>";$("targetPlay")?.classList.add("hidden")}if(e?.name==="AbortError")throw new Error("目標價查詢逾時");throw e}
}
// target tabs: 外資 / 本土 / 未知
document.querySelectorAll(".target-tabs button").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".target-tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    targetTypeFilter=btn.dataset.targetType||"外資";
    renderBrokerRows();
  });
});


// ---------- v2.5.0.16 news: executable event rules + event-field merge + market-data exclusion ----------
const NEWS_CACHE_KEY="stockzone_news_cache_v2517";
const NEWS_MATCH_CACHE_KEY="stockzone_news_match_cache_v2517";
const NEWS_SUMMARY_KEY="stockzone_news_summary_v2501";
const NEWS_STAR_KEY="stockzone_news_star_v2503";
const NEWS_UNREAD_KEY="stockzone_news_unread_v2503";
const NEWS_DIGEST_NEW_KEY="stockzone_news_digest_new_v2517";
let newsRowsCache=[],newsMatchRowsCache=[],newsFilter="digest";
function newsSet(key,code=newsCode()){const all=readNewsStore(key);return new Set(all[String(code)]||[])}
function saveNewsSet(key,set,code=newsCode()){const all=readNewsStore(key);all[String(code)]=[...set];writeNewsStore(key,all)}
function isNewsStarred(x){return newsSet(NEWS_STAR_KEY).has(newsKey(x))}
function isNewsNew(x){return newsSet(NEWS_UNREAD_KEY).has(newsKey(x))}
function readNewsStore(k){try{return JSON.parse(localStorage.getItem(k)||"{}")||{}}catch{return {}}}
function writeNewsStore(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
function newsCode(){return String(currentStock?.code||currentStock?.symbol||"")}
function newsTime(x){const t=Date.parse(x?.publishedAt||x?.date||"");return Number.isFinite(t)?t:0}
function newsKey(x){return `${String(x?.title||"").trim()}|${String(x?.url||"").trim()}`}
function newsMergeKey(x){return String(x?.title||"").replace(/【[^】]{0,16}】/g,"").replace(/[「」『』\[\](){ }（）｜|：:，,。！？!?\s]/g,"").replace(/即時新聞|新聞/g,"").toLowerCase()}
function pureFlowNewsTitle(title=""){
 const t=String(title||"");
 return /(?:三大法人買賣超|外資買賣超|投信買賣超|自營商買賣超|法人合計買賣超|買超股票\s*TOP\s*\d+|賣超股票\s*TOP\s*\d+|買賣超股票\s*TOP\s*\d+|外資買超金額最大|外資賣超金額最大|投信買超金額最大|投信賣超金額最大)/i.test(t)
   && !/(?:營收|獲利|毛利率|EPS|訂單|產能|擴產|量產|法說|財測|新產品|新技術|客戶|合作|漲價|降價|缺貨|供需)/i.test(t);
}
function blockedNewsItem(x){const t=`${x?.title||""} ${x?.source||""}`,u=String(x?.url||"");return /股市爆料同學會|同學風向與貼文摘要/.test(t)||/cmoney\.tw\/forum\//i.test(u)||pureFlowNewsTitle(x?.title||"")}
function mergeNews(oldRows,newRows){const rows=[];[...(newRows||[]),...(oldRows||[])].sort((a,b)=>newsTime(b)-newsTime(a)).forEach(x=>{if(!x?.title||blockedNewsItem(x))return;const k=newsMergeKey(x);const dup=rows.find(y=>{const q=newsMergeKey(y);return k===q||(k.length>18&&q.length>18&&(k.includes(q)||q.includes(k)))});if(!dup)rows.push(x)});const stars=newsSet(NEWS_STAR_KEY);rows.sort((a,b)=>(stars.has(newsKey(b))-stars.has(newsKey(a)))||(newsTime(b)-newsTime(a)));const pinned=rows.filter(x=>stars.has(newsKey(x))),normal=rows.filter(x=>!stars.has(newsKey(x))).slice(0,80);return [...pinned,...normal]}
function currentNewsSummary(){return String(readNewsStore(NEWS_SUMMARY_KEY)[newsCode()]||"").trim()}
function escNews(s=""){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function digestClean(s=""){
 let t=String(s||"").replace(/\s+/g," ").trim();
 t=t.replace(/^(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*/,"");
 t=t.replace(/^(?:護國神山|晶圓代工龍頭|全球最大晶圓代工廠|全球最大晶圓代工廠商|半導體龍頭|科技巨頭|重量級|市場焦點|指標大廠)\s*/,"");
 t=t.replace(/(?:普遍|不約而同|順利|有機會|可望|有望|備受|持續受到|相當|非常|明顯|強勁地|積極地|大舉|全力|火速|重磅|亮眼)/g,"");
 t=t.replace(/(?:吃下定心丸|成為市場焦點|備受市場關注|引發市場關注|值得關注|受到市場矚目|成為討論焦點)/g,"");
 t=t.replace(/^(?:回顧前一交易日|截至目前|從營運數字來看|從基本面來看|就營運面而言)[，,:：]?\s*/,"");
 t=t.replace(/(?:市場|法人|投資人|外界)[^，。；]{0,18}(?:認為|預期|看好|關注)[，,:：]?\s*/g,"");
 t=t.replace(/([，；])(?:顯示|反映|意味著|可見|由此可見)[^，。；]{0,24}(?=[，；。]|$)/g,"$1");
 t=t.replace(/\s+/g," ").replace(/^[，、；：:\s]+|[。；，\s]+$/g,"").replace(/，{2,}/g,"，").trim();
 return t;
}
function digestCompress(s=""){
 let t=digestClean(s);
 t=t.replace(/^(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*/,"");
 t=t.replace(/^(?:護國神山|晶圓代工龍頭|全球晶圓代工龍頭|全球最大晶圓代工廠商?|半導體龍頭|科技巨頭|重量級|市場焦點|指標大廠)\s*/,"");
 t=t.replace(/^(?:以及|並且|並|而且|但|不過|然而|即使|雖然|儘管|另外|此外|同時|至於|其中|另一方面|展望未來|回顧前一交易日)[，,:：]?\s*/,"");
 t=t.replace(/(?:不約而同|普遍|順利|備受|相當|非常|明顯|積極地|強勁地|全力|大舉|火速|強勢|重磅|驚人|亮眼|樂觀地)/g,"");
 t=t.replace(/(?:吃下定心丸|抱持樂觀看法|充滿期待|成為市場焦點|引發市場關注|值得關注|備受市場關注|受到市場矚目|成為討論焦點)/g,"");
 t=t.replace(/^(?:群益投顧|統一投顧|外資|法人|分析師|券商)(?:董事長|董座|研究員)?[^，。]{0,12}(?:表示|指出|預估|預期|認為)[，,:：]?\s*/,"");
 t=t.replace(/^(?:台積電|聯發科|新唐|萬潤|奇鋐|志聖|東捷|鴻勁)\s*[（(]\d{4,6}[）)]\s*/,(m)=>m.replace(/[（(]\d{4,6}[）)]/,""));
 t=t.replace(/(?:並預估|並指出|並表示|同時預估|同時指出)/g,"預估");
 t=t.replace(/(?:真正的|目前的|現階段的|主要的|進一步的|相關的)(?=(?:訂單|產能|營收|毛利率|EPS|需求|產品|技術|成本))/g,"");
 return t.replace(/^[，、；：:\s]+|[。；，\s]+$/g,"").replace(/，{2,}/g,"，").trim();
}
function digestEvent(s=""){
 const t=String(s||"");if(/營收/.test(t))return"revenue";if(/毛利率|毛利/.test(t))return"margin";if(/EPS|每股盈餘|淨利|獲利/.test(t))return"profit";if(/訂單|接單|能見度|需求/.test(t))return"order";if(/產能|擴產|量產|產線|稼動率/.test(t))return"capacity";if(/資本支出/.test(t))return"capex";if(/矽光子|CPO|CoWoS|先進封裝|技術|研發|產品/.test(t))return"technology";if(/客戶|合作|認證|供應鏈/.test(t))return"customer";if(/缺貨|供需|漲價|降價|庫存/.test(t))return"supply";if(/(?:營運|展望|財測|預估|預期|有望|優於|低於|持平|好轉|改善|回升|成長|衰退|轉強)/.test(t)&&/(?:20\d{2}年|\d{1,2}月|第?[一二三四1234]季|Q[1-4]|今年|明年|全年|上半年|下半年)/i.test(t))return"outlook";return"other";
}
function digestPeriod(s="",defaultYear=""){
 const t=String(s||"");let m;if((m=t.match(/(20\d{2})年\s*(\d{1,2})月/)))return `${m[1]}-${String(+m[2]).padStart(2,"0")}`;if((m=t.match(/(20\d{2})年\s*第?([一二三四1234])季/))){const q={一:1,二:2,三:3,四:4}[m[2]]||m[2];return `${m[1]}-Q${q}`}if((m=t.match(/第?([一二三四1234])季|Q([1-4])/i))){const q=m[2]||({一:1,二:2,三:3,四:4}[m[1]]||m[1]);return `Q${q}`}if((m=t.match(/(\d{1,2})月/)))return `${defaultYear||""}-${String(+m[1]).padStart(2,"0")}`;if((m=t.match(/(20\d{2})年/)))return `${m[1]}-FY`;if(/今年/.test(t))return"THIS-FY";if(/明年/.test(t))return"NEXT-FY";if(/上半年/.test(t))return"H1";if(/下半年/.test(t))return"H2";return"";
}
function digestMarketOnly(s=""){
 const t=String(s||""),market=/(?:股價|現價|收盤價|盤中價|漲幅|跌幅|漲跌|上漲|下跌|漲停|跌停|成交量|成交金額|成交張數|加權指數|大盤|櫃買指數|買超|賣超|主力|外資|投信|自營商)/i.test(t),fund=/(?:營收|毛利率|EPS|每股盈餘|淨利|獲利|訂單|能見度|需求|出貨|產能|擴產|量產|稼動率|資本支出|產品|技術|研發|認證|客戶|合作|財測|營運|展望|預估|預期|有望|優於|低於|持平|好轉|改善|回升|成長|衰退|轉強)/i.test(t);return market&&!fund;
}
function digestKey(s="",time=0){
 const t=digestCompress(s),ev=digestEvent(t),year=time?String(new Date(time).getFullYear()):"",period=digestPeriod(t,year);if(ev!=="other")return `${ev}|${period}`;return t.replace(/[\s，。；、：:（）()「」『』｜|／/!?！？]/g,"").slice(0,34);
}
function mergeDigestFacts(list){
 const sorted=[...list].sort((a,b)=>b.score-a.score||b.text.length-a.text.length||b.time-a.time);let base=sorted[0]?.text||"";
 if(!base)return"";
 const have=new Set(base.match(/\d+(?:\.\d+)?[%％億兆元張]?/g)||[]);
 for(const x of sorted.slice(1)){
   const clauses=x.text.split(/[，；。]/).map(v=>v.trim()).filter(Boolean);
   for(const c of clauses){
     const nums=c.match(/\d+(?:\.\d+)?[%％億兆元張]?/g)||[];
     if(nums.some(n=>!have.has(n))&&c.length>=5&&base.length+c.length<105){base+=`，${c}`;nums.forEach(n=>have.add(n))}
   }
 }
 return digestCompress(base);
}
function buildNewsDigest(rows){
 const pool=[];
 for(const x of rows||[])for(const raw of (Array.isArray(x.summaryPoints)?x.summaryPoints:[])){
   const p=digestCompress(raw);if(p.length<7||digestMarketOnly(p))continue;
   let score=0;if(/\d/.test(p))score+=3;if(/訂單|能見度|營收|毛利率|EPS|獲利|產能|擴產|量產|資本支出|出貨|新產品|新技術|矽光子|CPO|CoWoS|客戶|營運|展望|持平|好轉|改善|優於/.test(p))score+=4;if(/主因|導致|較去年|年增|月增|季增/.test(p))score+=2;
   const tm=newsTime(x);pool.push({text:p,key:digestKey(p,tm),score,time:tm,sourceNewsKey:newsKey(x)});
 }
 const groups=new Map();for(const x of pool){if(!groups.has(x.key))groups.set(x.key,[]);groups.get(x.key).push(x)}
 const merged=[];for(const [key,list] of groups){const text=mergeDigestFacts(list);if(text)merged.push({text,key,score:Math.max(...list.map(x=>x.score)),time:Math.max(...list.map(x=>x.time))})}
 merged.sort((a,b)=>b.score-a.score||b.time-a.time);
 const kept=[];
 for(const x of merged){const n=x.text.replace(/[\s，。；、：:（）()]/g,"");if(kept.some(y=>n.length>16&&y.n.length>16&&(n.includes(y.n)||y.n.includes(n))))continue;kept.push({...x,n});if(kept.length>=10)break}
 return kept;
}

function readDigestState(code=newsCode()){
 const all=readNewsStore(NEWS_DIGEST_NEW_KEY),raw=all[String(code)]||{};
 return {known:Array.isArray(raw.known)?raw.known:[],pending:Array.isArray(raw.pending)?raw.pending:[],active:raw.active&&typeof raw.active==="object"?raw.active:{}};
}
function writeDigestState(state,code=newsCode()){const all=readNewsStore(NEWS_DIGEST_NEW_KEY);all[String(code)]=state;writeNewsStore(NEWS_DIGEST_NEW_KEY,all)}
function digestSnapshot(rows){return buildNewsDigest(rows).map(x=>x.key)}
function updateDigestNewState(beforeRows,afterRows,code=newsCode()){
 const before=digestSnapshot(beforeRows),after=digestSnapshot(afterRows),state=readDigestState(code),now=Date.now();
 state.active=Object.fromEntries(Object.entries(state.active||{}).filter(([,exp])=>Number(exp)>now));
 if(!state.known.length){state.known=before.length?before:after;state.pending=[];writeDigestState(state,code);return}
 const baseline=new Set([...state.known,...before]);
 for(const key of after)if(!baseline.has(key)&&!state.pending.includes(key)&&!state.active[key])state.pending.push(key);
 state.known=[...new Set([...state.known,...after])].slice(-120);state.pending=state.pending.filter(k=>after.includes(k));writeDigestState(state,code);
}
function activateDigestPending(code=newsCode()){
 const state=readDigestState(code),now=Date.now(),expiry=now+24*60*60*1000;
 state.active=Object.fromEntries(Object.entries(state.active||{}).filter(([,exp])=>Number(exp)>now));
 for(const key of state.pending)if(!state.active[key])state.active[key]=expiry;
 state.pending=[];writeDigestState(state,code);return state;
}
function isDigestNew(key){const state=readDigestState(),exp=Number(state.active?.[key]||0);return exp>Date.now()}
function renderNews(){
 const host=$("newsList");if(!host)return;
 if(newsFilter==="digest"){
   activateDigestPending();
   const pts=buildNewsDigest(newsRowsCache);
   host.innerHTML=pts.length?`<article class="news-item"><div class="news-summary" style="margin-top:0;padding-top:0;border-top:0"><b>近期新聞摘要</b><ul>${pts.map(p=>`<li>${escNews(p.text)}${isDigestNew(p.key)?'<em class="target-new news-new">NEW</em>':''}</li>`).join("")}</ul></div></article>`:`<div class="news-empty">目前沒有可整理的新聞重點。</div>`;
   return;
 }
 const rows=newsFilter==="match"?newsMatchRowsCache:newsRowsCache;
 if(!rows.length){host.innerHTML=`<div class="news-empty">${newsFilter==="match"?(currentNewsSummary()?"目前沒有搜尋到符合關鍵字的相關新聞。":"請先輸入自訂關鍵字。") : "目前沒有近期新聞。"}</div>`;return}
 host.innerHTML=rows.map((x,i)=>{const pts=Array.isArray(x.summaryPoints)?x.summaryPoints.filter(Boolean):(x.summary?String(x.summary).split("\n").filter(Boolean):[]);const summary=pts.length?`<ul>${pts.map(p=>`<li>${escNews(p)}</li>`).join("")}</ul>`:(x.contentAvailable?`<p>已取得內文，但暫無符合條件的重點</p>`:`<p>暫時無法取得內文</p>`);const starred=isNewsStarred(x),fresh=isNewsNew(x);return `<article class="news-item" data-news-read="${i}"><div class="news-head"><a class="news-title" href="${escNews(x.url||"#")}" target="_blank" rel="noopener">${escNews(x.title||"")}${fresh?'<em class="target-new news-new">NEW</em>':''}</a><button class="news-star ${starred?'active':''}" data-news-star="${i}" type="button" aria-label="${starred?'取消置頂':'置頂'}">${starred?'★':'☆'}</button></div><div class="news-meta">${escNews(x.source||"")} ${x.publishedAt?`｜${new Date(x.publishedAt).toLocaleDateString("zh-TW")}`:""}</div><div class="news-summary"><b>重點整理</b>${summary}</div></article>`}).join("");
 host.querySelectorAll("[data-news-star]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const x=rows[Number(btn.dataset.newsStar)];if(!x)return;const set=newsSet(NEWS_STAR_KEY),k=newsKey(x);set.has(k)?set.delete(k):set.add(k);saveNewsSet(NEWS_STAR_KEY,set);newsRowsCache=mergeNews(newsRowsCache,[]);newsMatchRowsCache=mergeNews(newsMatchRowsCache,[]);renderNews()}));
 host.querySelectorAll("[data-news-read]").forEach(el=>el.addEventListener("click",e=>{if(e.target.closest(".news-star"))return;const x=rows[Number(el.dataset.newsRead)],set=newsSet(NEWS_UNREAD_KEY),k=newsKey(x);if(set.delete(k)){saveNewsSet(NEWS_UNREAD_KEY,set);renderNews()}}));
}
function loadNewsSummary(){const el=$("newsSummaryInput");if(el)el.value=currentNewsSummary();const st=$("newsSummaryStatus");if(st)st.textContent="此關鍵字會依目前股票分開保存"}
function beginNews(){const code=newsCode();newsRowsCache=mergeNews(readNewsStore(NEWS_CACHE_KEY)[code]?.rows||[],[]);newsMatchRowsCache=mergeNews(readNewsStore(NEWS_MATCH_CACHE_KEY)[code]?.rows||[],[]);loadNewsSummary();renderNews()}
function newsSince(rows){if(!rows?.length)return"";const newest=Math.max(...rows.map(newsTime));if(!Number.isFinite(newest)||newest<=0)return"";return new Date(newest-86400000).toISOString().slice(0,10)}
async function fetchNewsMode(code,name,mode,forceReset=false){
 const key=mode==="match"?NEWS_MATCH_CACHE_KEY:NEWS_CACHE_KEY,all=readNewsStore(key),cached=forceReset?[]:(all[String(code)]?.rows||[]),terms=mode==="match"?currentNewsSummary():"";
 if(mode==="match"&&!terms){newsMatchRowsCache=[];renderNews();return true}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
   const beforeRows=mode==="all"?mergeNews(cached,[]):[];
   const r=await fetch(`/api/news?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}&mode=${mode}${terms?`&terms=${encodeURIComponent(terms)}`:""}&v=2517`,{cache:"no-store",signal:controller.signal});
   const data=await readJson(r,"新聞"),incoming=(data.items||[]).filter(x=>!blockedNewsItem(x)),oldKeys=new Set(cached.map(newsMergeKey)),unread=newsSet(NEWS_UNREAD_KEY,code);
   if(cached.length)for(const x of incoming)if(x?.title&&!oldKeys.has(newsMergeKey(x)))unread.add(newsKey(x));saveNewsSet(NEWS_UNREAD_KEY,unread,code);
   const merged=mergeNews(cached,incoming);all[String(code)]={rows:merged,query:terms,updatedAt:new Date().toISOString()};writeNewsStore(key,all);
   const stillCurrent=String(newsCode())===String(code);
   if(mode==="match"){if(stillCurrent)newsMatchRowsCache=merged}else{updateDigestNewState(beforeRows,merged,code);if(stillCurrent)newsRowsCache=merged}
   if(stillCurrent){renderNews();if(latestFiveStageResult&&latestTechnicalForPlay)renderPlayStyle()}return true;
 }finally{clearTimeout(timer)}
}
async function loadNews(code,name){return fetchNewsMode(code,name,"all")}
$("saveNewsSummary")?.addEventListener("click",async()=>{if(!currentStock)return setStatus("請先搜尋股票",true);const all=readNewsStore(NEWS_SUMMARY_KEY),code=newsCode(),val=$("newsSummaryInput")?.value.trim()||"";all[code]=val;writeNewsStore(NEWS_SUMMARY_KEY,all);loadNewsSummary();const match=readNewsStore(NEWS_MATCH_CACHE_KEY);delete match[code];writeNewsStore(NEWS_MATCH_CACHE_KEY,match);newsMatchRowsCache=[];renderNews();if(val){setStatus("搜尋關鍵字相關新聞…");try{await fetchNewsMode(code,currentStock?.name||currentStock?.shortName||"","match",true);setStatus("關鍵字與相關新聞已更新")}catch(e){setStatus(`關鍵字已儲存，相關新聞搜尋失敗：${e.message}`,true)}}else setStatus("關鍵字已儲存")});
document.querySelectorAll("[data-news-filter]").forEach(btn=>btn.addEventListener("click",async()=>{document.querySelectorAll("[data-news-filter]").forEach(x=>x.classList.remove("active"));btn.classList.add("active");newsFilter=btn.dataset.newsFilter||"all";renderNews();if(newsFilter==="match"&&currentStock&&currentNewsSummary()){const store=readNewsStore(NEWS_MATCH_CACHE_KEY),row=store[newsCode()];if(!row||row.query!==currentNewsSummary()){try{await fetchNewsMode(newsCode(),currentStock?.name||currentStock?.shortName||"","match",true)}catch(e){console.warn("關鍵字新聞搜尋失敗",e)}}}}));

// ---------- holdings / watchlist ----------
function readList(type){
  try{const v=JSON.parse(localStorage.getItem(LIST_KEYS[type])||"[]");return Array.isArray(v)?v:[]}catch{return[]}
}
function writeList(type,rows){localStorage.setItem(LIST_KEYS[type],JSON.stringify(rows))}
function stockKey(x){return String(x?.code||x?.symbol||"")}
function snapshotStock(x){
  return {code:x.code||x.symbol||"",name:shortStockName(x.name||x.shortName),last:Number(x.last??x.price??x.regularMarketPrice),market:x.market||"台股",savedAt:new Date().toISOString()}
}
function inList(type,stock){
  const key=stockKey(stock);return !!key&&readList(type).some(x=>stockKey(x)===key)
}
function addToList(type){
  if(!currentStock)return setStatus("請先搜尋股票",true);
  const rows=readList(type),item=snapshotStock(currentStock),key=stockKey(item);
  const exists=rows.some(x=>stockKey(x)===key);
  if(exists){
    writeList(type,rows.filter(x=>stockKey(x)!==key));
    renderLists();updateListButtons();if(type==="holdings"){renderTradeOutputs();if(["swing","mixed"].includes(latestPlayStyleResult?.key))renderSwingWave(latestPlayStyleResult)}
    setStatus(`${item.name||item.code} 已從${type==="holdings"?"持股":"觀察"}清單移除`);
    return;
  }
  rows.unshift(item);writeList(type,rows);
  renderLists();updateListButtons();if(type==="holdings"){renderTradeOutputs();if(["swing","mixed"].includes(latestPlayStyleResult?.key))renderSwingWave(latestPlayStyleResult)}
  setStatus(`${item.name||item.code} 已加入${type==="holdings"?"持股":"觀察"}清單`);
}
function removeFromList(type,code){
  writeList(type,readList(type).filter(x=>stockKey(x)!==String(code)));
  renderLists();updateListButtons();if(String(code)===currentStockCode()){renderTradeOutputs();if(["swing","mixed"].includes(latestPlayStyleResult?.key))renderSwingWave(latestPlayStyleResult)}
}
function saveHoldingProfile(code,host){
  const avgEl=host.querySelector(`[data-holding-avg="${code}"]`),sharesEl=host.querySelector(`[data-holding-shares="${code}"]`),avgRaw=String(avgEl?.value||"").trim(),sharesRaw=String(sharesEl?.value||"").trim();
  const avg=avgRaw===""?null:Number(avgRaw),shares=sharesRaw===""?null:Math.floor(Number(sharesRaw));
  if(avg!==null&&(!Number.isFinite(avg)||avg<=0))return setStatus("均價需大於 0",true);
  if(shares!==null&&(!Number.isFinite(shares)||shares<=0))return setStatus("股數需為大於 0 的整數",true);
  const rows=readList("holdings"),i=rows.findIndex(x=>stockKey(x)===String(code));if(i<0)return;
  rows[i]={...rows[i],avgCost:avg,shares:shares,positionUpdatedAt:new Date().toISOString()};writeList("holdings",rows);renderLists();
  if(String(code)===currentStockCode()){renderTradeOutputs();if(["swing","mixed"].includes(latestPlayStyleResult?.key))renderSwingWave(latestPlayStyleResult)}
  setStatus(avg||shares?"持股均價／股數已儲存":"持股資料已清除");
}
function renderOneList(type,hostId){
  const host=$(hostId),rows=readList(type);
  if(!host)return;
  host.innerHTML=rows.length?rows.map(x=>{const holding=type==="holdings";return `<div class="manage-stock ${holding?"holding-row":""}">
    <div class="manage-stock-main" data-search-stock="${x.code}">
      <strong>${x.name||"—"} <small>${x.code}</small></strong>
    </div>
    <small class="list-market">${x.market||"台股"}</small>
    <strong class="list-price">${targetFmt(x.last)}</strong>
    <button class="remove-list" type="button" data-remove-type="${type}" data-remove-code="${x.code}" aria-label="刪除">×</button>
    ${holding?`<div class="holding-profile">
      <label>持股均價<input type="number" min="0" step="0.01" inputmode="decimal" data-holding-avg="${x.code}" value="${positionNumber(x.avgCost)??""}" placeholder="例如 1250"></label>
      <label>持股股數<input type="number" min="1" step="1" inputmode="numeric" data-holding-shares="${x.code}" value="${positionNumber(x.shares)?Math.floor(Number(x.shares)):""}" placeholder="例如 1000"></label>
      <button type="button" data-save-holding="${x.code}">儲存</button>
      <small class="holding-profile-note">均價影響個人報酬／解套判讀；股數用於預估損益與分批止盈數量。</small>
    </div>`:""}
  </div>`}).join(""):`<div class="manage-empty">${type==="holdings"?"尚無持股":"尚無觀察股票"}</div>`;
  host.querySelectorAll("[data-search-stock]").forEach(el=>el.addEventListener("click",()=>{
    $("stockCode").value=el.dataset.searchStock; search(); window.scrollTo({top:0,behavior:"smooth"});
  }));
  host.querySelectorAll("[data-remove-type]").forEach(btn=>btn.addEventListener("click",()=>removeFromList(btn.dataset.removeType,btn.dataset.removeCode)));
  host.querySelectorAll("[data-save-holding]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();saveHoldingProfile(btn.dataset.saveHolding,host)}));
  host.querySelectorAll(".holding-profile input").forEach(el=>el.addEventListener("click",e=>e.stopPropagation()));
}
function renderLists(){
  renderOneList("holdings","holdingsCards");renderOneList("watchlist","watchlistCards");
  setText("holdingsCount",readList("holdings").length);setText("watchlistCount",readList("watchlist").length);
}
function updateListButtons(){
  const h=$("addHoldingBtn"),w=$("addWatchBtn");
  h?.classList.toggle("in-list",currentStock&&inList("holdings",currentStock));
  w?.classList.toggle("in-list",currentStock&&inList("watchlist",currentStock));
  if(h)h.textContent=currentStock&&inList("holdings",currentStock)?"✓ 已在持股":"＋ 持股";
  if(w)w.textContent=currentStock&&inList("watchlist",currentStock)?"★ 已觀察":"☆ 觀察";
}
$("addHoldingBtn")?.addEventListener("click",()=>addToList("holdings"));
$("addWatchBtn")?.addEventListener("click",()=>addToList("watchlist"));
document.querySelectorAll("[data-manage-tab]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-manage-tab]").forEach(b=>b.classList.toggle("active",b===btn));
  document.querySelectorAll("[data-manage-panel]").forEach(p=>p.classList.toggle("active",p.dataset.managePanel===btn.dataset.manageTab));
}));
function setManagementTab(type){document.querySelectorAll("[data-manage-tab]").forEach(b=>b.classList.toggle("active",b.dataset.manageTab===type));document.querySelectorAll("[data-manage-panel]").forEach(p=>p.classList.toggle("active",p.dataset.managePanel===type));document.querySelectorAll("[data-manage-page]").forEach(b=>b.classList.toggle("active",b.dataset.managePage===type))}
document.querySelectorAll("[data-manage-page]").forEach(btn=>btn.addEventListener("click",()=>setManagementTab(btn.dataset.managePage)));
document.querySelectorAll("[data-manage-jump]").forEach(btn=>btn.addEventListener("click",()=>{setManagementTab(btn.dataset.manageJump);setView("management")}));
document.querySelectorAll("[data-search-jump]").forEach(btn=>btn.addEventListener("click",()=>{
  $("stockCode")?.focus();window.scrollTo({top:0,behavior:"smooth"});
}));

const CURRENT_QUOTE_MS=30*1000,AUTO_QUOTE_MS=5*60*1000,AUTO_TARGET_MS=2*60*60*1000;
let currentQuoteRefreshing=false,autoQuoteRefreshing=false,autoTargetRefreshing=false;
async function refreshCurrentQuote(){
  if(currentQuoteRefreshing||!currentStock||!isTaiwanIntraday())return;
  const code=String(currentStock.code||String(currentStock.symbol||"").split(".")[0]||"");if(!/^\d{4,6}$/.test(code))return;
  const market=currentStock.market||currentStock.marketLabel||"";currentQuoteRefreshing=true;
  try{const d=await quote(code,market);patchCurrentQuote(d)}catch(e){console.warn("個股盤中報價更新失敗",code,e)}finally{currentQuoteRefreshing=false}
}
function autoListStocks(){
 const byCode=new Map();
 for(const type of ["holdings","watchlist"])for(const x of readList(type))if(x.code)byCode.set(String(x.code),x);
 return [...byCode.entries()];
}
function patchAutoListStock(code,patch){
 for(const type of ["holdings","watchlist"]){
  const rows=readList(type),i=rows.findIndex(x=>String(x.code)===String(code));
  if(i>=0){rows[i]={...rows[i],...patch};writeList(type,rows)}
 }
}
async function autoPool(items,limit,fn){
 let next=0;
 async function worker(){while(next<items.length){const item=items[next++];await fn(item)}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
}
async function autoRefreshQuotes(force=false){
 if(autoQuoteRefreshing)return; autoQuoteRefreshing=true;
 try{
  const due=autoListStocks().filter(([,base])=>force||!base.quoteUpdatedAt||Date.now()-new Date(base.quoteUpdatedAt).getTime()>=AUTO_QUOTE_MS);
  await autoPool(due,3,async([code,base])=>{
   try{
    const d=await autoListQuote(code,base.market||""),last=Number(d.last??d.price??d.regularMarketPrice);
    const patch={quoteUpdatedAt:new Date().toISOString()};
    if(Number.isFinite(last))patch.last=last;
    const name=shortStockName(d.name||d.shortName||base.name);if(name)patch.name=name;
    patchAutoListStock(code,patch);renderLists();
   }catch(e){console.warn("清單股價更新失敗",code,e)}
  });
 }finally{autoQuoteRefreshing=false}
}
async function autoRefreshTargets(force=false){
 if(autoTargetRefreshing)return; autoTargetRefreshing=true;
 try{
  for(const [code,base] of autoListStocks()){
   const targetDue=force||!base.targetUpdatedAt||Date.now()-new Date(base.targetUpdatedAt).getTime()>=AUTO_TARGET_MS;
   if(!targetDue)continue;
   try{
    const payload=await fetchTargetPayload(code,base.name||""),fresh=applyCorr(normalizeTargetRows(payload),code),cache=readTargetCache(),old=applyCorr(cache[code]?.rows||[],code),merged=applyCorr(mergeTargetRows(old,fresh),code),main=pickMainTarget(merged);
    cache[code]={rows:merged,updatedAt:new Date().toISOString()};writeTargetCache(cache);
    const patch={targetUpdatedAt:new Date().toISOString()};
    if(main){patch.target=targetPriceValue(main.latest);patch.targetBroker=targetBrokerName(main.row)}
    patchAutoListStock(code,patch);renderLists();
   }catch(e){console.warn("清單目標價更新失敗",code,e)}
  }
 }finally{autoTargetRefreshing=false}
}
setTimeout(()=>{autoRefreshQuotes(true);autoRefreshTargets(true);refreshCurrentQuote()},800);
setInterval(()=>refreshCurrentQuote(),CURRENT_QUOTE_MS);
setInterval(()=>autoRefreshQuotes(false),AUTO_QUOTE_MS);
setInterval(()=>autoRefreshTargets(false),AUTO_TARGET_MS);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){refreshCurrentQuote();autoRefreshQuotes(false);autoRefreshTargets(false)}});

renderLists();

let fundflowCoverageLoading=false;
let fundflowCoverageFetchedAt=0;
let fundflowXyLoading=false;
let fundflowXyFetchedAt=0;
let fundflowXyData=null;
let fundflowScope="technology-fine";
let fundflowPhaseFilter="all";
let fundflowTrajectoryDays=10;
let fundflowSelectedTagId="";
let fundflowDetailLoading=false;
let fundflowDetailData=null;
let fundflowBrowserLoading=false;
let fundflowBrowserFetchedAt=0;
let fundflowBrowserData=null;
let fundflowBrowserQuery="";
let fundflowBrowserScope="all";
let fundflowBrowserLimit=36;
function renderFundflowCoverage(cov){
  const count=$("fundflowTagCount"),title=$("fundflowTagTitle"),detail=$("fundflowTagDetail"),badge=$("fundflowTagBadge");
  if(!count||!title||!detail||!badge)return;
  const all=Number(cov?.allMarketCompanies||cov?.profileRows||0);
  if(!all){
    title.textContent="等待公司基本資料同步";count.textContent="--";badge.textContent="待同步";
    detail.textContent="等待下一次既有 Cron 同步 TWSE＋TPEx 全市場公司母表；科技業務標籤與跨產業科技覆寫會在同步後一起統計。";return;
  }
  const techBiz=Number(cov?.technologyBusinessCompanies||cov?.techCompanies||0),nativeTech=Number(cov?.nativeTechIndustryCompanies||0),crossTech=Number(cov?.crossIndustryTechCompanies||0);
  const fine=Number(cov?.fineTechCompanies||cov?.fineMapped||0),fallback=Number(cov?.industryFallback||0),coarse=Number(cov?.coarseIndustry||0),unmapped=Number(cov?.unmappedAll||0);
  const techBizPct=all?techBiz/all*100:0,finePct=Number.isFinite(Number(cov?.fineTechPct))?Number(cov.fineTechPct):Number(cov?.fineMappedPct||0),industryCoverage=Number(cov?.masterIndustryCodeCoveragePct||0);
  const twseRows=Number(cov?.masterTwseRows||0),tpexRows=Number(cov?.masterTpexRows||0),nonStandard=Number(cov?.masterNonStandardCodeRows||0),invalid=Number(cov?.masterInvalidCodeRows||0),duplicates=Number(cov?.masterDuplicateCodeRows||0);
  title.textContent="全市場公司母表已納入";count.textContent=all.toLocaleString("zh-TW");if(!badge.dataset.locked)badge.textContent=`科技業務 ${techBizPct.toFixed(techBizPct%1?1:0)}%`;
  detail.textContent=`${all.toLocaleString("zh-TW")} 家上市櫃公司（上市 ${twseRows.toLocaleString("zh-TW")}＋上櫃 ${tpexRows.toLocaleString("zh-TW")}）｜產業代碼 ${industryCoverage.toFixed(industryCoverage%1?1:0)}%｜非4碼 ${nonStandard}｜無效碼 ${invalid}｜重複碼 ${duplicates}｜有科技業務 ${techBiz.toLocaleString("zh-TW")} 家（官方科技產業 ${nativeTech}＋跨產業科技 ${crossTech}）｜科技細標籤 ${fine} 家｜科技待細分 ${fallback} 家｜傳產/金融粗分類 ${coarse} 家${unmapped?`｜未分類 ${unmapped} 家`:""}｜科技細標籤率 ${finePct.toFixed(finePct%1?1:0)}%`;
}
async function loadFundflowCoverage(force=false){
  if(fundflowCoverageLoading)return;if(!force&&fundflowCoverageFetchedAt&&Date.now()-fundflowCoverageFetchedAt<5*60*1000)return;fundflowCoverageLoading=true;
  try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);try{const res=await fetch("/api/sync-status",{cache:"no-store",signal:controller.signal});if(!res.ok)throw new Error(`sync-status ${res.status}`);const payload=await res.json();renderFundflowCoverage(payload?.companyTagCoverage||null);fundflowCoverageFetchedAt=Date.now()}finally{clearTimeout(timer)}}catch(e){console.warn("全市場業務標籤覆蓋讀取失敗",e)}finally{fundflowCoverageLoading=false}
}
function fundflowFmt(v,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):"--"}
function fundflowSigned(v,d=1){const n=Number(v);return Number.isFinite(n)?`${n>=0?"+":""}${n.toFixed(d)}`:"--"}
function fundflowIsElectronicsProduct(g){const tagId=String(g?.tagId||"").toLowerCase(),text=`${String(g?.name||"")} ${String(g?.parentName||"")} ${tagId}`;const ids=new Set(["computer_peripheral_business","graphics_card","chipset","motherboard","computer_chassis","io_interface_card","video_capture_card","notebook_pc","desktop_pc","thin_client","office_imaging_equipment","display_module","backlight_module","lcd_panel","oled","mini_led","micro_led","touch_panel","ssd","memory_module","hard_disk_drive","optical_drive","flash_storage_device","optical_disc","camera_module","optical_lens","panel_market","ai_pc","acoustic_component","consumer_electronics"]);if(ids.has(tagId))return true;return /筆記型電腦|桌上型電腦|電腦週邊設備|顯示卡|主機板|電腦機殼|輸出入模組|視訊擷取|印表\/?掃描\/?投影設備|顯示器模組|背光模組|LCD面板|OLED|Mini LED|Micro LED|觸控面板|SSD|記憶體模組|硬碟機|光碟機|隨身碟|記憶卡|光碟片|相機模組|光學鏡頭|AI PC|聲學元件|消費性電子/.test(text)}
function fundflowScopeBucket(g){if(!g)return "all";const tagId=String(g.tagId||"").toLowerCase(),name=`${String(g.name||"")} ${String(g.parentName||"")}`;if(tagId==="finance"||/金融|銀行|證券|保險|金控/.test(name))return "finance";if(g.scope==="traditional-coarse")return "traditional";if(g.scope==="technology-fine")return fundflowIsElectronicsProduct(g)?"electronics-product":"technology-fine";return String(g.scope||"all");}
function fundflowAllowed(g){if(!g)return false;if(fundflowScope==="all")return true;return fundflowScopeBucket(g)===fundflowScope}
function fundflowPhaseBucket(g){
  const state=String(g?.phaseState||"").trim();
  if(state==="overheating"||state==="cooling")return "hotcool";
  if(state==="cold"||!state||state==="unknown")return "cold-unknown";
  return state||"cold-unknown";
}
function fundflowPhaseAllowed(g){return fundflowPhaseFilter==="all"||fundflowPhaseBucket(g)===fundflowPhaseFilter}
function fundflowEligibleGroups({phase=true}={}){return (fundflowXyData?.groups||[]).filter(g=>fundflowAllowed(g)&&(!phase||fundflowPhaseAllowed(g))&&Number(g.validCount)>=2&&Array.isArray(g.trajectory)&&g.trajectory.length>=2)}
function fundflowPhaseFilterLabel(key){return ({all:"全部階段",germination:"資金萌芽",potential:"準備攀升",mainline:"主升確認",transition:"轉換／混沌",hotcool:"過熱／冷卻","cold-unknown":"冷區／方向未明"})[key]||"全部階段"}
function renderFundflowPhaseControls(){
  const base=fundflowEligibleGroups({phase:false}),counts={all:base.length,germination:0,potential:0,mainline:0,transition:0,hotcool:0,"cold-unknown":0};
  base.forEach(g=>{const k=fundflowPhaseBucket(g);if(Object.prototype.hasOwnProperty.call(counts,k))counts[k]++});
  document.querySelectorAll("[data-fundflow-phase]").forEach(btn=>{const key=btn.dataset.fundflowPhase||"all";btn.classList.toggle("active",key===fundflowPhaseFilter);const n=btn.querySelector("[data-fundflow-phase-count]");if(n)n.textContent=String(counts[key]??0)});
  setText("fundflowPhaseSummary",`${fundflowPhaseFilterLabel(fundflowPhaseFilter)}｜圖上 ${fundflowEligibleGroups().length} 個業務`);
}
function fundflowSvg(tag,attrs={},text=""){const el=document.createElementNS("http://www.w3.org/2000/svg",tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));if(text!=="")el.textContent=text;return el}
function fundflowColor(q){return q==="potential"?"#e2a034":q==="mainline"?"#4f9f79":q==="price-led"?"#8a82c8":q==="cold"?"#9aa8b7":"#5e8fd0"}
function fundflowPhaseColor(state,q){return state==="germination"?"#d8a63e":state==="potential"?"#e49b2f":state==="mainline"?"#3f9b70":state==="overheating"?"#d97d4d":state==="cooling"?"#b36a72":state==="cold"?"#97a6b6":fundflowColor(q)}
function fundflowProjectionPoint(g,h=5){return (g?.projection?.points||[]).find(p=>Number(p.horizon)===h)||null}
function fundflowPhaseLabel(g){return g?.phaseLabel||g?.statusLabel||"轉換／混沌"}
function fundflowQuadrantLabel(q){return q==="potential"?"右下潛伏":q==="mainline"?"右上主線":q==="price-led"?"左上價強":q==="cold"?"左下冷區":"尚無XY"}
function fundflowBrowserAllowed(item){
  if(!item)return false;
  if(fundflowBrowserScope!=="all"&&fundflowScopeBucket(item)!==fundflowBrowserScope)return false;
  const q=fundflowBrowserQuery.trim().toLowerCase();if(!q)return true;
  const hay=[item.name,item.tagId,item.parentName,...(item.aliases||[]),...(item.companyNames||[]),...(item.companyCodes||[]),...(item.examples||[]).flatMap(x=>[x.name,x.code])].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}
function renderFundflowBrowser(){
  const data=fundflowBrowserData,list=$("fundflowBrowserList"),summary=$("fundflowBrowserSummary"),result=$("fundflowBrowserResultCount"),more=$("fundflowBrowserMore"),loading=$("fundflowBrowserLoading");
  if(!list||!summary||!result)return;
  if(!data){if(loading){loading.classList.remove("hidden");loading.textContent="讀取完整業務分類…"}return}
  if(loading)loading.classList.add("hidden");
  const items=(data.items||[]),countBy=scope=>items.filter(x=>fundflowScopeBucket(x)===scope).length,c=data.counts||{};summary.textContent=`定義 ${Number(c.totalDefinitions||items.length||0)}｜科技 ${countBy("technology-fine")}｜電子產品 ${countBy("electronics-product")}｜傳產 ${countBy("traditional")}｜金融 ${countBy("finance")}｜可畫 XY ${Number(c.withXY||0)}`;
  const filtered=(data.items||[]).filter(fundflowBrowserAllowed);result.textContent=`符合 ${filtered.length} 個業務`;
  const shown=filtered.slice(0,fundflowBrowserLimit);
  list.innerHTML=shown.map(item=>{
    const parent=item.parentName?`<span>${escNews(item.parentName)}</span>`:"",examples=(item.examples||[]).slice(0,3).map(x=>x.name||x.code).filter(Boolean).join("、");
    const xy=item.xyEligible?`<b class="fundflow-browser-xy ${escNews(item.quadrant||"")}">${escNews(item.phaseLabel||fundflowQuadrantLabel(item.quadrant))} · X ${fundflowFmt(item.x)} / Y ${fundflowFmt(item.y)} · C ${fundflowFmt(item.confirmation,0)} / E ${fundflowFmt(item.overheating,0)}</b>`:`<b class="fundflow-browser-xy no-xy">${escNews(item.noXYReason||"尚無XY")}</b>`;
    const meta=`${Number(item.companyCount||0)} 家${item.xyEligible?`｜有效 ${Number(item.validCount||0)}/${Number(item.memberCount||item.companyCount||0)}｜3日 X ${fundflowSigned(item.dx3)}`:""}${examples?`｜${escNews(examples)}`:""}`;
    return `<button type="button" class="fundflow-browser-item${item.xyEligible?" is-clickable":""}" data-fundflow-browser-tag="${escNews(item.tagId)}" ${item.xyEligible?"":"disabled"}><div class="fundflow-browser-name"><strong>${escNews(item.name||item.tagId)}</strong>${parent}</div>${xy}<small>${meta}</small></button>`;
  }).join("")||'<p class="fundflow-browser-empty">目前沒有符合條件的業務分類。</p>';
  if(more){more.classList.toggle("hidden",shown.length>=filtered.length);more.textContent=`顯示更多（${shown.length}/${filtered.length}）`}
  document.querySelectorAll("[data-fundflow-browser-scope]").forEach(btn=>btn.classList.toggle("active",btn.dataset.fundflowBrowserScope===fundflowBrowserScope));
}
async function loadFundflowBrowser(force=false){
  if(fundflowBrowserLoading)return;if(!force&&fundflowBrowserFetchedAt&&Date.now()-fundflowBrowserFetchedAt<5*60*1000){renderFundflowBrowser();return}fundflowBrowserLoading=true;
  const loading=$("fundflowBrowserLoading");if(loading){loading.classList.remove("hidden");loading.textContent="讀取完整業務分類…"}
  try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);try{const res=await fetch(`/api/sync-status?view=fundflow-browser&days=10`,{cache:"no-store",signal:controller.signal});fundflowBrowserData=await readJson(res,"業務瀏覽器");fundflowBrowserFetchedAt=Date.now();renderFundflowBrowser()}finally{clearTimeout(timer)}}catch(e){console.warn("業務瀏覽器讀取失敗",e);if(loading){loading.classList.remove("hidden");loading.textContent=`業務分類讀取失敗：${e?.message||e}`}}finally{fundflowBrowserLoading=false}
}
function fundflowBrowserOpen(tagId){
  const item=(fundflowBrowserData?.items||[]).find(x=>x.tagId===tagId);if(!item?.xyEligible)return;
  fundflowScope=fundflowScopeBucket(item);if(!["all","technology-fine","electronics-product","traditional","finance"].includes(fundflowScope))fundflowScope="all";
  fundflowPhaseFilter=fundflowPhaseBucket(item);renderFundflowXy();fundflowSelect(tagId,{scroll:true});
}

function fundflowSelect(tagId,{scroll=false}={}){
  const id=String(tagId||"").trim();if(!id)return;const group=(fundflowXyData?.groups||[]).find(g=>g.tagId===id);
  if(group&&!fundflowPhaseAllowed(group))fundflowPhaseFilter=fundflowPhaseBucket(group);
  fundflowSelectedTagId=id;renderFundflowPhaseControls();renderFundflowChart();loadFundflowDetail(id,false);
  if(scroll)setTimeout(()=>$("fundflowDetailCard")?.scrollIntoView({behavior:"smooth",block:"start"}),120);
}
function fundflowClearSelection(){fundflowSelectedTagId="";fundflowDetailData=null;$("fundflowDetailCard")?.classList.add("hidden");renderFundflowChart()}
function renderFundflowChart(){
  const svg=$("fundflowXySvg"),loading=$("fundflowChartLoading");if(!svg)return;svg.replaceChildren();
  if(!fundflowXyData){if(loading){loading.classList.remove("hidden");loading.textContent="等待 XY 資料"}return}if(loading)loading.classList.add("hidden");
  const W=760,H=510,L=54,R=22,T=28,B=52,pw=W-L-R,ph=H-T-B,sx=x=>L+Math.max(0,Math.min(100,Number(x)||0))/100*pw,sy=y=>T+(100-Math.max(0,Math.min(100,Number(y)||0)))/100*ph;
  [{x:L,y:T,w:pw/2,h:ph/2,fill:"#f5f3fb"},{x:L+pw/2,y:T,w:pw/2,h:ph/2,fill:"#f0faf5"},{x:L,y:T+ph/2,w:pw/2,h:ph/2,fill:"#f6f8fb"},{x:L+pw/2,y:T+ph/2,w:pw/2,h:ph/2,fill:"#fff8eb"}].forEach(q=>svg.append(fundflowSvg("rect",{x:q.x,y:q.y,width:q.w,height:q.h,fill:q.fill})));
  [0,25,50,75,100].forEach(v=>{svg.append(fundflowSvg("line",{x1:sx(v),y1:T,x2:sx(v),y2:T+ph,class:v===50?"fundflow-midline":"fundflow-gridline"}));svg.append(fundflowSvg("line",{x1:L,y1:sy(v),x2:L+pw,y2:sy(v),class:v===50?"fundflow-midline":"fundflow-gridline"}));svg.append(fundflowSvg("text",{x:sx(v),y:H-29,class:"fundflow-axis-label","text-anchor":"middle"},String(v)));svg.append(fundflowSvg("text",{x:L-10,y:sy(v)+4,class:"fundflow-axis-label","text-anchor":"end"},String(v)))});
  svg.append(fundflowSvg("text",{x:L+pw/2,y:H-8,class:"fundflow-axis-label","text-anchor":"middle"},"法人資金流 X →"));svg.append(fundflowSvg("text",{x:15,y:T+ph/2,class:"fundflow-axis-label",transform:`rotate(-90 15 ${T+ph/2})`,"text-anchor":"middle"},"市場價格強度 Y →"));
  svg.append(fundflowSvg("text",{x:L+12,y:T+21,class:"fundflow-quadrant-label"},"價格先行"));svg.append(fundflowSvg("text",{x:L+pw-12,y:T+21,class:"fundflow-quadrant-label","text-anchor":"end"},"資金＋價格共振"));svg.append(fundflowSvg("text",{x:L+12,y:T+ph-12,class:"fundflow-quadrant-label"},"冷區"));svg.append(fundflowSvg("text",{x:L+pw-12,y:T+ph-12,class:"fundflow-quadrant-label","text-anchor":"end"},"資金先行"));
  const priority=g=>{const phase={potential:520,germination:480,mainline:430,overheating:390,cooling:360,cold:80,transition:180}[g.phaseState]||180;return phase+Number(g.phaseConfidence||0)+Number(g.confirmation||0)*.25};
  // v2.6.3.0: Phase 篩選只改顯示層；不再 Top-N 截斷，符合條件的業務全部畫出。
  const groups=fundflowEligibleGroups().sort((a,b)=>priority(b)-priority(a)),selected=groups.find(g=>g.tagId===fundflowSelectedTagId)||null;
  // v2.6.3.0 E' fan background pass: 扇形只在已選題材且明細就緒時顯示，並永遠先畫在實線後方。
  // v2.6.3.1 fix: 只要有選到題材就盡量畫出扇形；若 API 沒給 high/low 邊界，則用中心線自動補一個保守展開區。
  const selectedProjection=(fundflowDetailData?.tagId===fundflowSelectedTagId&&fundflowDetailData?.projection?.points?.length?fundflowDetailData.projection:selected?.projection)||null;
  if(selected&&selectedProjection?.points?.length){
    const color=fundflowPhaseColor(selected.phaseState,selected.quadrant),cx=sx(selected.x),cy=sy(selected.y);
    const fanPts=selectedProjection.points.slice(0,Math.min(5,selectedProjection.points.length)).map((p,i)=>{
      const horizon=Math.max(1,Number(p.horizon||i+1)||i+1);
      const spreadBase=Math.max(2.4,6-horizon*.45);
      const centerX=Number.isFinite(Number(p.x))?Number(p.x):Number(selected.x);
      const centerY=Number.isFinite(Number(p.y))?Number(p.y):Number(selected.y);
      const highX=Number.isFinite(Number(p.highX))?Number(p.highX):Math.min(100,centerX+spreadBase*.9);
      const lowX=Number.isFinite(Number(p.lowX))?Number(p.lowX):Math.max(0,centerX-spreadBase*.9);
      const highY=Number.isFinite(Number(p.highY))?Number(p.highY):Math.min(100,centerY+spreadBase);
      const lowY=Number.isFinite(Number(p.lowY))?Number(p.lowY):Math.max(0,centerY-spreadBase);
      return {highX,highY,lowX,lowY};
    });
    const upper=[`${cx},${cy}`,...fanPts.map(p=>`${sx(p.highX)},${sy(p.highY)}`)],lower=[...fanPts].reverse().map(p=>`${sx(p.lowX)},${sy(p.lowY)}`),poly=[...upper,...lower].join(" ");
    svg.append(fundflowSvg("polygon",{points:poly,class:"fundflow-projection-fan is-selected",fill:color,stroke:color,"aria-hidden":"true"}));
  }
  const drawOrder=[...groups.filter(g=>g.tagId!==fundflowSelectedTagId).reverse(),...groups.filter(g=>g.tagId===fundflowSelectedTagId)];
  drawOrder.forEach(g=>{
    const selectedNow=g.tagId===fundflowSelectedTagId,dim=Boolean(fundflowSelectedTagId&&!selectedNow),color=fundflowPhaseColor(g.phaseState,g.quadrant),pts=(g.trajectory||[]).slice(-fundflowTrajectoryDays),coords=pts.map(p=>`${sx(p.x)},${sy(p.y)}`).join(" "),common={"data-fundflow-tag":g.tagId,tabindex:"0",role:"button","aria-label":`${g.name} XY 軌跡`};
    if(pts.length>1)svg.append(fundflowSvg("polyline",{points:coords,class:`fundflow-path${selectedNow?" is-selected":""}${dim?" is-dim":""}`,stroke:color,...common}));
    pts.slice(0,-1).forEach(p=>svg.append(fundflowSvg("circle",{cx:sx(p.x),cy:sy(p.y),r:selectedNow?4:3,fill:color,class:`fundflow-point-old${dim?" is-dim":""}`,...common})));
    const cx=sx(g.x),cy=sy(g.y);
    svg.append(fundflowSvg("circle",{cx,cy,r:selectedNow?8:6.5,fill:color,class:`fundflow-point-latest${selectedNow?" is-selected":""}${dim?" is-dim":""}`,...common}));
    const right=cx>L+pw*.72,top=cy<T+ph*.18,dx=right?-9:9,dy=top?16:-9;svg.append(fundflowSvg("text",{x:cx+dx,y:cy+dy,class:`fundflow-tag-label${selectedNow?" is-selected":""}${dim?" is-dim":""}`,"text-anchor":right?"end":"start",...common},g.name));
  });
  if(!groups.length)svg.append(fundflowSvg("text",{x:W/2,y:H/2,class:"fundflow-axis-label","text-anchor":"middle"},"目前這個階段／分類沒有足夠的 2 家以上業務群組"));
  svg.onclick=e=>{const node=e.target?.closest?.("[data-fundflow-tag]");if(node)fundflowSelect(node.getAttribute("data-fundflow-tag"),{scroll:false})};
  svg.onkeydown=e=>{if(e.key!=="Enter"&&e.key!==" ")return;const node=e.target?.closest?.("[data-fundflow-tag]");if(node){e.preventDefault();fundflowSelect(node.getAttribute("data-fundflow-tag"),{scroll:false})}};
}
function fundflowListHtml(groups,kind){
  if(!groups.length)return "<p>目前沒有符合條件的業務。</p>";
  return groups.slice(0,6).map(g=>{const leaders=(g.leaders||[]).slice(0,3).map(x=>x.name||x.code).filter(Boolean).join("、"),score=kind==="rising"?g.potentialScore:kind==="mainline"?g.mainlineScore:g.coolingScore,sel=g.tagId===fundflowSelectedTagId?" is-selected":"",proj=g.projection||{};return `<button type="button" class="fundflow-radar-item${sel}" data-fundflow-tag="${escNews(g.tagId)}"><b>${escNews(g.name||g.tagId)}</b><em>${fundflowFmt(score,0)}</em><small>${escNews(fundflowPhaseLabel(g))}｜X ${fundflowFmt(g.x)} / Y ${fundflowFmt(g.y)}｜C ${fundflowFmt(g.confirmation,0)} / E ${fundflowFmt(g.overheating,0)}｜3日 ΔX ${fundflowSigned(g.dx3)} / ΔY ${fundflowSigned(g.dy3)}${proj.tendency?`｜模型 ${escNews(proj.tendency)} ${fundflowFmt(proj.confidence,0)}%`:""}${leaders?`｜${escNews(leaders)}`:""}</small></button>`}).join("");
}
function renderFundflowXy(){
  const data=fundflowXyData;if(!data)return renderFundflowChart();const asOfText=data.asOf?String(data.asOf).replaceAll("-","/"):"--";setText("fundflowAsOf","");const badge=$("fundflowTagBadge");if(badge){badge.textContent=asOfText;badge.dataset.locked="1";}setText("fundflowEngineBadge",String(data.engineVersion||"XY v2").replace("xy-","XY "));
  const groups=fundflowEligibleGroups({phase:false}),rising=groups.filter(g=>g.phaseState==="potential").sort((a,b)=>Number(b.potentialScore)-Number(a.potentialScore)),mainline=groups.filter(g=>g.phaseState==="mainline").sort((a,b)=>Number(b.mainlineScore)-Number(a.mainlineScore)),cooling=groups.filter(g=>["overheating","cooling"].includes(g.phaseState)).sort((a,b)=>Number(b.coolingScore)-Number(a.coolingScore));
  setText("fundflowPotentialCount",rising.length);setText("fundflowMainlineCount",mainline.length);setText("fundflowRightCount",cooling.length);setText("fundflowDaysCount",data.trajectoryDays||0);
  const a=$("fundflowPotentialList"),b=$("fundflowMainlineList"),c=$("fundflowRightList");if(a)a.innerHTML=fundflowListHtml(rising,"rising");if(b)b.innerHTML=fundflowListHtml(mainline,"mainline");if(c)c.innerHTML=fundflowListHtml(cooling,"cooling");
  const note=$("fundflowMethodNote");if(note){const cal=data.calibration||{};note.textContent=`X v2＝法人淨資金流主體＋信用籌碼 ±15 分修正；舊成交活動 X 僅留作未來回測 baseline。Y 為價格強度，座標以 3 日 EMA 平滑。實線＝已發生；點開才顯示不確定扇形。轉態樣本 ${Number(cal.historyDays||0)} 個交易日${cal.warmup?"（暖機期，信心會自動壓低）":""}。`}
  document.querySelectorAll("[data-fundflow-scope]").forEach(btn=>btn.classList.toggle("active",btn.dataset.fundflowScope===fundflowScope));document.querySelectorAll("[data-fundflow-days]").forEach(btn=>btn.classList.toggle("active",Number(btn.dataset.fundflowDays)===fundflowTrajectoryDays));renderFundflowPhaseControls();renderFundflowChart();
}
function fundflowFactorHtml(factors,axis,priorFactors={},group={},priorPoint={}){
  const defs=axis==="x"?[["inst1","法人當日淨流強度","15%"],["inst5","法人5日淨流趨勢","30%"],["inst10","法人10日淨流趨勢","25%"],["inst20","法人20日淨流趨勢","20%"],["streak","連買／連賣持續性","5%"],["agreement","三大法人方向一致度","5%"]]:[["changePct","當日漲跌","10%"],["return3Pct","3日報酬","25%"],["return5Pct","5日報酬","30%"],["return20Pct","20日報酬","20%"],["persistence5","近5日上漲持續性","15%"]];
  const rows=defs.map(([key,label,w])=>{const v=Math.max(0,Math.min(100,Number(factors?.[key])||0)),pv=Number(priorFactors?.[key]),delta=Number.isFinite(pv)?v-pv:null;return `<div class="fundflow-factor-row"><label>${label} <small>${w}${delta===null?"":`｜3日 ${fundflowSigned(delta,0)}`}</small></label><strong>${fundflowFmt(v,0)}</strong><div class="fundflow-factor-bar"><i style="width:${v}%"></i></div></div>`});
  if(axis==="x"){
    const flow=Math.max(0,Math.min(100,Number(group.flowBreadth??group.activityBreadth)||0)),prevFlow=Number(priorPoint.flowBreadth??priorPoint.activityBreadth),concentration=Math.max(0,Math.min(100,Number(group.concentrationQuality)||0)),credit=Math.max(0,Math.min(100,Number(factors?.creditQuality)||50)),corr=Number(group.creditCorrection||0);
    rows.push(`<div class="fundflow-factor-row"><label>法人淨流入廣度 <small>群組聚合${Number.isFinite(prevFlow)?`｜3日 ${fundflowSigned(flow-prevFlow,0)}`:""}</small></label><strong>${fundflowFmt(flow,0)}%</strong><div class="fundflow-factor-bar"><i style="width:${flow}%"></i></div></div>`);
    rows.push(`<div class="fundflow-factor-row"><label>資金集中品質 <small>避免少數個股獨撐</small></label><strong>${fundflowFmt(concentration,0)}</strong><div class="fundflow-factor-bar"><i style="width:${concentration}%"></i></div></div>`);
    rows.push(`<div class="fundflow-factor-row"><label>信用籌碼修正 <small>最多 ±15 分</small></label><strong>${fundflowSigned(corr,1)}</strong><div class="fundflow-factor-bar"><i style="width:${credit}%"></i></div></div>`);
  }
  else {rows.push(`<div class="fundflow-factor-row"><label>價格強勢廣度 <small>群組聚合｜3日 ${fundflowSigned(Number(group.priceBreadth||0)-Number(priorPoint.priceBreadth||0),0)}</small></label><strong>${fundflowFmt(group.priceBreadth,0)}%</strong><div class="fundflow-factor-bar"><i style="width:${Math.max(0,Math.min(100,Number(group.priceBreadth)||0))}%"></i></div></div>`);rows.push(`<div class="fundflow-factor-row"><label>上漲廣度 <small>群組聚合｜3日 ${fundflowSigned(Number(group.upBreadth||0)-Number(priorPoint.upBreadth||0),0)}</small></label><strong>${fundflowFmt(group.upBreadth,0)}%</strong><div class="fundflow-factor-bar"><i style="width:${Math.max(0,Math.min(100,Number(group.upBreadth)||0))}%"></i></div></div>`)}
  return rows.join("");
}
function renderFundflowDetail(){
  const card=$("fundflowDetailCard"),d=fundflowDetailData;if(!card||!d)return;card.classList.remove("hidden");setText("fundflowDetailTitle",d.name||d.tagId);setText("fundflowDetailMeta",`${d.parentName?`${d.parentName}｜`:""}${String(d.asOf||"").replaceAll("-","/")}｜${d.latest?.validCount||0}/${d.latest?.memberCount||0} 家｜可靠度 ${fundflowFmt(d.latest?.reliability,0)}%`);
  setText("fundflowDetailX",fundflowFmt(d.latest?.x));setText("fundflowDetailY",fundflowFmt(d.latest?.y));setText("fundflowDetailMove",`C ${fundflowFmt(d.latest?.confirmation,0)} / E ${fundflowFmt(d.latest?.overheating,0)}`);setText("fundflowDetailStatus",`${d.latest?.phaseLabel||d.latest?.statusLabel||"--"}｜3日 ΔX ${fundflowSigned(d.latest?.dx3)} / ΔY ${fundflowSigned(d.latest?.dy3)}`);
  const proj=d.projection||{},pp=fundflowProjectionPoint({projection:proj},5);setText("fundflowDetailProjection",proj.tendency?`${proj.tendency} ${fundflowFmt(proj.confidence,0)}%`:"--");setText("fundflowDetailProjectionNote",pp?`5日中心傾向 X ${fundflowFmt(pp.x)} / Y ${fundflowFmt(pp.y)}｜方向 ${proj.direction||"--"}`:"等待模型扇形資料");
  const traj=d.trajectory||[],p3=traj[Math.max(0,traj.length-4)]||traj[0]||{},xf=$("fundflowXFactors"),yf=$("fundflowYFactors");if(xf)xf.innerHTML=fundflowFactorHtml(d.latest?.factors?.x,"x",p3?.factors?.x||{},d.latest||{},p3);if(yf)yf.innerHTML=fundflowFactorHtml(d.latest?.factors?.y,"y",p3?.factors?.y||{},d.latest||{},p3);
  const hist=$("fundflowDetailHistory");if(hist)hist.innerHTML=(d.trajectory||[]).map((p,i,arr)=>`<div class="fundflow-history-item${i===arr.length-1?" latest":""}"><b>${escNews(String(p.date||"").slice(5).replace("-","/"))}</b><strong>X ${fundflowFmt(p.x)}<br>Y ${fundflowFmt(p.y)}</strong><small>${escNews(p.phaseLabel||"")}｜C ${fundflowFmt(p.confirmation,0)} / E ${fundflowFmt(p.overheating,0)}</small></div>`).join("");
  const list=$("fundflowCompanyList");if(list)list.innerHTML=(d.companies||[]).slice(0,12).map(c=>`<div class="fundflow-company-row"><b>${escNews(c.name||c.code)}<small>${escNews(c.code)}｜${escNews(c.importance||"")}</small></b><div class="impact">X <em>${fundflowSigned(c.impactX,2)}</em>｜Y <em>${fundflowSigned(c.impactY,2)}</em></div><small>個股 X ${fundflowFmt(c.stockX)} / Y ${fundflowFmt(c.stockY)}｜法人5日 ${fundflowSigned(c.instFlow5Pct,3)}%｜信用 ${fundflowSigned(c.creditCorrection,1)} 分｜3日 ${fundflowSigned(c.return3Pct,2)}%｜5日 ${fundflowSigned(c.return5Pct,2)}%｜20日 ${fundflowSigned(c.return20Pct,2)}%</small></div>`).join("")||"<p>暫無可用公司明細。</p>";
  const note=$("fundflowDetailNote");if(note)note.textContent=`${d?.methodology?.factor||"因子熱度以 50 為中性。"}｜${d?.methodology?.impact||"公司貢獻為移除該公司後重算的座標差。"}｜${d?.methodology?.projection||"扇形是模型不確定範圍，不是保證。"}`;
  renderFundflowChart();
}
async function loadFundflowDetail(tagId,force=false){
  const id=String(tagId||"").trim();if(!id||fundflowDetailLoading)return;if(!force&&fundflowDetailData?.tagId===id&&fundflowDetailData?.trajectoryDays===fundflowTrajectoryDays){renderFundflowDetail();return}
  fundflowDetailLoading=true;const card=$("fundflowDetailCard"),loading=$("fundflowDetailLoading");if(card)card.classList.remove("hidden");if(loading){loading.classList.remove("hidden");loading.textContent="拆解 X/Y、階段、轉態扇形與公司貢獻…"}
  try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);try{const res=await fetch(`/api/sync-status?view=fundflow-detail&tag=${encodeURIComponent(id)}&days=${fundflowTrajectoryDays}`,{cache:"no-store",signal:controller.signal});fundflowDetailData=await readJson(res,"題材拆解");renderFundflowDetail()}finally{clearTimeout(timer)}}catch(e){console.warn("XY/階段 題材明細讀取失敗",e);if(loading){loading.classList.remove("hidden");loading.textContent=`明細讀取失敗：${e?.message||e}`}}finally{fundflowDetailLoading=false;if(loading&&fundflowDetailData?.tagId===id)loading.classList.add("hidden")}
}
async function loadFundflowXy(force=false,serverRefresh=false){
  if(fundflowXyLoading)return;if(!force&&fundflowXyFetchedAt&&Date.now()-fundflowXyFetchedAt<2*60*1000){renderFundflowXy();return}fundflowXyLoading=true;const loading=$("fundflowChartLoading");if(loading){loading.classList.remove("hidden");loading.textContent="計算最近業務輪動…"}
  try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);try{const res=await fetch(`/api/sync-status?view=fundflow&days=${fundflowTrajectoryDays}${serverRefresh?"&refresh=1":""}`,{cache:"no-store",signal:controller.signal});fundflowXyData=await readJson(res,"資金輪動");fundflowXyFetchedAt=Date.now();renderFundflowXy()}finally{clearTimeout(timer)}}catch(e){console.warn("XY 資金輪動讀取失敗",e);if(loading){loading.classList.remove("hidden");loading.textContent=`XY 讀取失敗：${e?.message||e}`}}finally{fundflowXyLoading=false}
}
document.querySelectorAll("[data-fundflow-scope]").forEach(btn=>btn.addEventListener("click",()=>{fundflowScope=btn.dataset.fundflowScope||"technology-fine";if(["all","technology-fine","electronics-product","traditional","finance"].includes(fundflowScope))fundflowBrowserScope=fundflowScope;const selected=(fundflowXyData?.groups||[]).find(g=>g.tagId===fundflowSelectedTagId);if(selected&&(!fundflowAllowed(selected)||!fundflowPhaseAllowed(selected)))fundflowClearSelection();renderFundflowXy();if(fundflowBrowserData)renderFundflowBrowser()}));
document.querySelectorAll("[data-fundflow-phase]").forEach(btn=>btn.addEventListener("click",()=>{fundflowPhaseFilter=btn.dataset.fundflowPhase||"all";const selected=(fundflowXyData?.groups||[]).find(g=>g.tagId===fundflowSelectedTagId);if(selected&&!fundflowPhaseAllowed(selected))fundflowClearSelection();renderFundflowXy()}));
document.querySelectorAll("[data-fundflow-days]").forEach(btn=>btn.addEventListener("click",()=>{const d=Number(btn.dataset.fundflowDays);if(![5,10,15].includes(d)||d===fundflowTrajectoryDays)return;fundflowTrajectoryDays=d;fundflowXyFetchedAt=0;fundflowDetailData=null;loadFundflowXy(true,false);if(fundflowSelectedTagId)loadFundflowDetail(fundflowSelectedTagId,true)}));
document.addEventListener("click",e=>{const item=e.target?.closest?.(".fundflow-radar-item[data-fundflow-tag]");if(item)fundflowSelect(item.dataset.fundflowTag,{scroll:true})});
document.addEventListener("click",e=>{const item=e.target?.closest?.(".fundflow-browser-item[data-fundflow-browser-tag]");if(item&&!item.disabled)fundflowBrowserOpen(item.dataset.fundflowBrowserTag)});
document.querySelectorAll("[data-fundflow-browser-scope]").forEach(btn=>btn.addEventListener("click",()=>{fundflowBrowserScope=btn.dataset.fundflowBrowserScope||"all";fundflowBrowserLimit=36;renderFundflowBrowser()}));
$("fundflowBrowserSearch")?.addEventListener("input",e=>{fundflowBrowserQuery=String(e.target?.value||"");fundflowBrowserLimit=36;renderFundflowBrowser()});
$("fundflowBrowserMore")?.addEventListener("click",()=>{fundflowBrowserLimit+=36;renderFundflowBrowser()});
$("fundflowDetailClose")?.addEventListener("click",fundflowClearSelection);

function setView(view){
  const screeningViews=new Set(["screening","fundflow","featured","simulation"]),management=view==="management";
  const mode=screeningViews.has(view)?"screening":management?"management":"analysis";
  document.body.classList.remove("mode-analysis","mode-screening","mode-management");
  document.body.classList.add(`mode-${mode}`);
  const modeEyebrow=$("modeEyebrow"); if(modeEyebrow) modeEyebrow.textContent=mode==="screening"?"智慧選股":mode==="management"?"股票管理":"個股分析";
  if(view==="screening")view="fundflow";
  if(view==="fundflow"){loadFundflowCoverage(false);loadFundflowXy(false).finally(()=>loadFundflowBrowser(false));}
  document.body.classList.toggle("view-overview",view==="overview");
  document.querySelectorAll("[data-view-panel]").forEach(p=>p.classList.toggle("active-view",p.dataset.viewPanel===view));
  document.querySelectorAll(".section-tabs [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".side-group [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".bottom-nav [data-view]").forEach(b=>b.classList.toggle("active",mode==="analysis"&&b.dataset.view==="overview"?view==="overview":mode==="screening"&&b.dataset.view==="screening"));
  $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
  window.scrollTo({top:mode==="analysis"?(document.querySelector(".stock-head")?.offsetTop||0):0,behavior:"smooth"});
}
document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
document.querySelectorAll("[data-view-open]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.viewOpen)));
setView("overview");

let historyProgressFetchedAt=0,historyProgressLoading=false;
function renderHistoryProgress(data){
  const markets=data?.markets||{},names=["上市","上櫃"];
  const layer=(key)=>{const days=names.map(m=>Number(markets?.[m]?.[key]?.tradingDays||0)),min=Math.min(...days),pct=Math.max(0,Math.min(100,min/500*100));return{days,min,pct}};
  const paint=(key,prefix)=>{const x=layer(key),bar=$(prefix+"Bar"),value=$(prefix+"Value"),detail=$(prefix+"Detail");if(bar)bar.style.width=`${x.pct.toFixed(1)}%`;if(value)value.textContent=`${x.min} / 500D`;if(detail)detail.textContent=`上市 ${x.days[0]}D｜上櫃 ${x.days[1]}D`;};
  paint("price","historyPrice");paint("institutional","historyInstitutional");paint("credit","historyCredit");
  const ready=[[$("historyLiveReady"),Boolean(data?.liveReady)],[$("historyBacktestReady"),Boolean(data?.backtestReady250)],[$("historyResearchReady"),Boolean(data?.researchReady500)]];ready.forEach(([el,ok])=>{if(!el)return;el.classList.toggle("is-ready",ok);el.textContent=`${el.id==="historyLiveReady"?"20D Live":el.id==="historyBacktestReady"?"250D Backtest":"500D Research"} ${ok?"✓":""}`.trim()});
  const updated=$("historyProgressUpdated");if(updated){const d=data?.generatedAt?new Date(data.generatedAt):null;updated.textContent=d&&!Number.isNaN(d.getTime())?`更新 ${d.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false})}`:"已更新";}
  const note=$("historyProgressNote"),warning=(data?.warnings||[])[0];if(note)note.textContent=warning?`注意：${warning}`:"目標每個交易日最多補 24D；約 20 次有效 Cron 可由 20D 推進至 500D。部署新版不會重跑既有 DB 歷史。";
}
async function loadHistoryProgress(force=false){
  if(historyProgressLoading)return;if(!force&&historyProgressFetchedAt&&Date.now()-historyProgressFetchedAt<60*1000)return;historyProgressLoading=true;
  const updated=$("historyProgressUpdated");if(updated)updated.textContent="讀取中";
  try{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);try{const res=await fetch("/api/sync-status?view=flow-data-health",{cache:"no-store",signal:controller.signal});const payload=await readJson(res,"歷史資料進度");renderHistoryProgress(payload?.flowDataHealth||payload);historyProgressFetchedAt=Date.now()}finally{clearTimeout(timer)}}catch(e){console.warn("歷史資料進度讀取失敗",e);if(updated)updated.textContent="讀取失敗"}finally{historyProgressLoading=false}
}
document.querySelectorAll(".settings-open").forEach(btn=>btn.addEventListener("click",()=>{
  $("settingsModal")?.classList.remove("hidden");
  $("sidebar")?.classList.remove("open"); $("overlay")?.classList.remove("show");
  loadHistoryProgress(false);
}));
$("closeSettings")?.addEventListener("click",()=>$("settingsModal")?.classList.add("hidden"));
$("settingsModal")?.addEventListener("click",e=>{if(e.target===$("settingsModal"))$("settingsModal").classList.add("hidden")});


// v2.5.1.11 valuation formula and definition info
(function(){
 const formulas={
  pe:{title:"營運合理價",text:"PE 合理價＝近四季 EPS × 同業 PE；PS 合理價＝每股營收 × 同業 PS。系統依 EPS 成熟度、營收品質與資料完整度自動給 PE／PS 權重，再形成營運合理價。"},
  pb:{title:"PB 合理價",text:"每股淨值（BPS）× 同業平均 PB"},
  composite:{title:"綜合合理價",text:"PE、PS、PB 先依公司目前的獲利成熟度、營收品質、ROE 與資產特性計算適用度，再正規化成權重後合成中心合理價。合理價區間會再依三種模型的價格分歧、適用度、資料完整度與可用模型數量自動放寬或收窄。"},
  modeldef:{title:"PE／PS／PB 模型權重",text:"PE 重視獲利成熟度與 EPS 穩定性；PS 重視營收成長、營收穩定與毛利品質，獲利尚未成熟時權重會提高；PB 重視淨值、ROE 代理值與產業資產特性。缺少合理價的模型不參與加權。估值可信度另外評估模型適用度、模型間價格分歧、資料完整度與可用模型數量。"},
  epsdef:{title:"EPS 獲利能力",text:"EPS 是每股盈餘，代表公司每一股普通股能分配到多少獲利；數值越高，代表每股獲利能力越強。"},
  pedef:{title:"本益比",text:"本益比＝股價 ÷ 每股盈餘（EPS），代表市場願意用多少倍的價格購買公司目前的每股獲利。"},
  psdef:{title:"股價營收比",text:"股價營收比（PS）＝股價 ÷ 每股營收，代表市場願意用多少倍的價格購買公司每股所創造的營收；除了虧損公司，當 EPS 剛轉盈、低基期失真或營收成長比短期獲利更有代表性時，PS 權重也會提高。"},
  pbdef:{title:"股價淨值比",text:"股價淨值比＝股價 ÷ 每股淨值（BPS），代表股價相對公司每股帳面淨資產價值的倍數。"},
  scenariodef:{title:"九情境代號說明",text:"P＝現價；O＝營運合理價（PE／PS 依適用度加權）；B＝PB 合理價；F＝PE／PS／PB 動態加權後的綜合合理價；T＝券商目標價；≈＝兩者接近（目前以差距 ±5% 判定）；＜、＞代表價格大小關係。沒有券商目標價時，T 不納入該次判定。"}
 };
 const pop=$("valuationFormulaPopover"), title=$("valuationFormulaTitle"), text=$("valuationFormulaText");
 document.addEventListener("click",e=>{
  const btn=e.target.closest?.(".formula-info");
  if(btn&&pop){const f=formulas[btn.dataset.formula];if(f){title.textContent=f.title;text.textContent=f.text;pop.hidden=false;}return;}
  if(e.target.closest?.(".formula-popover-close")){if(pop)pop.hidden=true;}
 });
})();
