// v2.5.8.9 — 三年共用歷史資料：一年加權股性＋季節性＋成長空間／勝率＋極端市場風險
// 三年日K只抓一次並快取；正常市場樣本用於股性與成長估算，系統性崩壞獨立做壓力測試。
const $=id=>document.getElementById(id);

function setText(id,value){
  const el=$(id); if(el) el.textContent=value ?? "—";
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
const STOCK_META_CACHE_KEY="stockzone_stock_meta_cache_v2573";
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
      return await readJson(await fetch(`/api/stockmeta?q=${encodeURIComponent(query)}`,{cache:"no-store"}),"股票基本資料");
    }catch(e){
      lastError=e;
      if(i<1)await new Promise(r=>setTimeout(r,260));
    }
  }
  const local=localStockMeta(query);
  if(local)return local;
  throw lastError||new Error("TWSE／TPEx 股票基本資料暫時無法取得");
}
function mergeStockMeta(data,meta){
  if(!meta)return data;
  return {...data,code:meta.code||data?.code||data?.symbol,symbol:data?.symbol||meta.symbol||meta.code,name:meta.name||data?.name||data?.shortName,shortName:meta.name||data?.shortName||data?.name,market:meta.market||data?.market||data?.marketLabel,marketLabel:meta.market||data?.marketLabel||data?.market};
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
async function dbCloseQuote(code){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
  try{
    const res=await fetch(`/api/sync-status?code=${encodeURIComponent(code)}`,{cache:"no-store",signal:controller.signal});
    if(!res.ok)return null;
    const payload=await res.json();
    return normalizeSnapshot(payload,code);
  }catch{return null}finally{clearTimeout(timer)}
}
async function misCloseQuote(code,market){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    const params=new URLSearchParams({q:String(code||"")});if(market)params.set("market",String(market));
    params.set("mode","official-close");
    const res=await fetch(`/api/sync-status?${params}`,{cache:"no-store",signal:controller.signal});
    if(!res.ok)return null;
    const payload=await res.json();
    return payload?.ok===false?null:(payload?.result||payload);
  }catch{return null}finally{clearTimeout(timer)}
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
async function yahooQuote(query,market=""){
  async function once(timeoutMs){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      return await readJson(
        await fetch(`/api/quote?q=${encodeURIComponent(query)}${market?`&market=${encodeURIComponent(market)}`:""}`,{
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
async function quote(query,market=""){
  const yahoo=await yahooQuote(query,market);
  // v2.5.7.0：盤中維持 Yahoo；盤後 MIS 已合併到 /api/sync-status，Neon 與 MIS 依最新交易日擇新者，同日優先 Neon。
  if(isTaiwanIntraday())return yahoo;
  const code=String(yahoo?.code||String(yahoo?.symbol||"").split(".")[0]||query||"").trim();
  if(!/^\d{4,6}$/.test(code))return yahoo;
  const [db,mis]=await Promise.all([dbCloseQuote(code),misCloseQuote(code,market||yahoo?.market||yahoo?.marketLabel||"")]);
  return pickAfterCloseQuote(yahoo,db,mis);
}

function shortStockName(name){
  let s=String(name||"").trim();
  if(!s)return s;
  s=s.replace(/股份有限公司$/,"").replace(/有限公司$/,"").replace(/公司$/,"");
  // UI display name: remove common legal/industry suffixes rather than maintaining one-off names.
  s=s.replace(/科技$/,"");
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
const HISTORY3Y_CACHE_KEY="stockzone_history3y_v2589",HISTORY3Y_CACHE_MS=12*60*60*1000;
function readHistory3YCache(){try{return JSON.parse(localStorage.getItem(HISTORY3Y_CACHE_KEY)||"{}")||{}}catch{return{}}}
function writeHistory3YCache(x){try{localStorage.setItem(HISTORY3Y_CACHE_KEY,JSON.stringify(x))}catch{}}
async function history3Y(query,market){
  const code=String(query||"").replace(/\.(?:TW|TWO)$/i,"").trim(),key=`${code}|${String(market||"")}`,all=readHistory3YCache(),cached=all[key];
  if(cached&&Date.now()-Number(cached.savedAt||0)<HISTORY3Y_CACHE_MS&&Array.isArray(cached.data?.history)&&cached.data.history.length>400)return cached.data;
  const params=new URLSearchParams({q:code,market:String(market||"")}),data=await readJson(await fetch(`/api/history?${params.toString()}`,{cache:"default"}),"三年歷史資料");
  all[key]={savedAt:Date.now(),data};const keys=Object.keys(all).sort((a,b)=>Number(all[b]?.savedAt||0)-Number(all[a]?.savedAt||0));for(const k of keys.slice(8))delete all[k];writeHistory3YCache(all);return data;
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
function technicalVolumeFmt(n){const x=Number(n);if(!Number.isFinite(x))return "--";if(Math.abs(x)>=10000){const w=x/10000;return `${w.toLocaleString("zh-TW",{maximumFractionDigits:w>=100?0:1})}萬`;}return x.toLocaleString("zh-TW",{maximumFractionDigits:0});}
function technicalMetrics(id,items){const el=$(id);if(!el)return;el.classList.add("tech-metrics");el.style.setProperty("--cols",String(items.length));el.innerHTML=items.map(([label,value])=>`<span class="tech-metric"><span>${label}</span><b>${value}</b></span>`).join("")}
function techTone(el,tone){if(!el)return;el.classList.remove("tone-good","tone-watch","tone-bad","tone-neutral","tone-info","tone-cyan");el.classList.add(`tone-${tone||"neutral"}`)}
function techSet(id,text,tone){const el=$(id);if(el){el.textContent=text||"--";if(tone)techTone(el,tone)}}

// v2.5.6.5 — 五階段位置 v2 + 建議玩法 v3
// 五階段 v2 會讀取 /api/technical 已回傳的歷史日 K（history），把「生命週期」與「當下狀態」分開。
// 原有技術分析 MA/Bollinger/Volume/Momentum 計分完全不改；這裡只新增路徑判讀。
let latestFiveStageResult=null;
let latestTechnicalForPlay=null;
let latestPlayStyleResult=null;
let latestHistory3Y=null;
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
  const ratio20=stageNum(t?.volume?.ratio20),score=stageNum(t?.analysis?.overall?.score),bias20=stageNum(t?.bias?.ma20)??stagePct(p,ma20),bias5=stageNum(t?.bias?.ma5)??stagePct(p,ma5);
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

  const accelerationFlags=[path.ret20!==null&&path.ret20>=10,bias20!==null&&bias20>=6,nearUpper,bullOrder,score!==null&&score>=70,rsi!==null&&rsi>=60].filter(Boolean).length;
  const acceleratingNow=above20&&(above60!==false)&&midTrendUp&&accelerationFlags>=3;
  const recentAccelerationPullback=priorAcceleration&&(path.fromHigh60===null||path.fromHigh60>=-15)&&(above60!==false)&&p>=ma20*.98&&longTrendUp&&((path.maxRet20_60??0)>=22||(path.maxBias20_60??0)>=14);
  const trendPullback=priorAcceleration&&!lifecycleReset&&(above60!==false)&&longTrendUp&&(path.fromHigh60===null||(path.fromHigh60<=-6&&path.fromHigh60>=-28))&&(ma60===null||p>=ma60*.98);
  const normalTrend=above20&&(above60!==false)&&midTrendUp&&(longTrendUp||bullOrder)&&(bullOrder||shortBull||macdBull||(score!==null&&score>=60));
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
  latestFiveStageResult=r;latestTechnicalForPlay=t;renderPlayStyle();
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

// v2.5.7.2 — 波段分析 v3：第一波 X 與後續回測分離。
// 1.5X／2X／2.5X 由「第一波後回測低點」起算，並辨識第二次回測；倍率只代表可能目標區，不代表必經路線。
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
function calculateSwingWave(r,t){
  const rows=(r?.path?.rows||stageHistory(t)).slice(-120),price=stageNum(r?.price);
  if(rows.length<25||price===null)return {valid:false,reason:"歷史K線不足"};
  const candidates=[];

  // 找一個有明確「上漲 -> 回測」的主要第一波；優先選振幅較完整、且仍屬近期結構者。
  for(let hi=12;hi<rows.length-2;hi++){
    if(!swingIsLocalHigh(rows,hi,2))continue;
    const high=swingHigh(rows[hi]);if(high===null)continue;
    const lowInfo=swingRangeMin(rows,Math.max(0,hi-35),hi-2,swingLow);
    const low=lowInfo.value;if(low===null||lowInfo.index<0)continue;
    const gain=stagePct(high,low);if(gain===null||gain<6||gain>120)continue;
    // 若 low→high 之間早已出現一次完整回測，這個 high 屬後續波，不再誤當第一波高點。
    if(swingHasCompletedPullbackBetween(rows,lowInfo.index,hi))continue;
    const pb=swingFindPullback(rows,hi,high);
    if(!pb)continue;
    const age=rows.length-1-hi;
    const score=Math.min(gain,80)+(pb.confirmed?12:3)+Math.max(0,10-age*.12)-Math.max(0,age-85)*.45;
    const candidate={low,lowIndex:lowInfo.index,high,highIndex:hi,gain,pullback:pb.dropPct,completed:pb.confirmed,pullbackLow:pb.low,pullbackIndex:pb.index,score};
    // 若這個候選後面還能辨識出完整第二波，代表它更可能是整段行情的第一波，而不是後段子波。
    candidate.secondCandidate=pb.confirmed?swingFindCompletedNextWave(rows,pb.index,pb.low):null;
    candidate.chainDepth=1+(candidate.secondCandidate?1:0);
    candidates.push(candidate);
  }
  let chosen=candidates.sort((a,b)=>b.chainDepth-a.chainDepth||b.score-a.score||a.highIndex-b.highIndex)[0]||null;

  // 若尚未形成可確認回測，保留最近正在形成的第一波。
  if(!chosen){
    const hiInfo=swingRangeMax(rows,Math.max(8,rows.length-20),rows.length,swingHigh);
    if(hiInfo.index>5){
      const lowInfo=swingRangeMin(rows,Math.max(0,hiInfo.index-35),hiInfo.index-2,swingLow);
      const gain=lowInfo.value!==null&&hiInfo.value!==null?stagePct(hiInfo.value,lowInfo.value):null;
      if(gain!==null&&gain>=6&&gain<=120)chosen={low:lowInfo.value,lowIndex:lowInfo.index,high:hiInfo.value,highIndex:hiInfo.index,gain,pullback:null,completed:false,pullbackLow:null,pullbackIndex:-1};
    }
  }
  if(!chosen)return {valid:false,reason:"近期沒有足夠明確的推進波"};

  const amplitude=chosen.high-chosen.low;
  if(!(amplitude>0))return {valid:false,reason:"波段振幅不足"};
  const firstPullback=Number.isFinite(chosen.pullbackLow)?chosen.pullbackLow:null;
  const targetBase=firstPullback??chosen.low;
  const target=m=>targetBase+amplitude*m;

  // 第一個回測完成後，再找「第二波高點 -> 第二次回測低點」。第三波暫不套新的固定倍率。
  const second=chosen.secondCandidate??(chosen.completed&&chosen.pullbackIndex>=0?swingFindCompletedNextWave(rows,chosen.pullbackIndex,chosen.pullbackLow):null);
  const secondPullbackLow=second?.pullbackLow??null;
  const activeDefenseLow=secondPullbackLow??firstPullback??chosen.low;
  const currentMultiple=(price-targetBase)/amplitude;
  const referenceHigh=secondPullbackLow!==null?(second?.high??chosen.high):chosen.high;

  let state="第一波形成中",phase="第一波形成中",nextTarget=chosen.high;
  if(firstPullback!==null&&!chosen.completed){state="第一波後回測形成中";phase="第一波後回測形成中";nextTarget=chosen.high}
  if(chosen.completed){
    if(secondPullbackLow!==null){
      if(price>=referenceHigh*1.005){state="第二次回測後再轉強";phase="第三波嘗試";nextTarget=null}
      else{state="第二波後回測";phase="第二波後回測";nextTarget=referenceHigh}
    }else if(price<chosen.high*.985){state="第一波後回測";phase="等待第二波";nextTarget=chosen.high}
    else if(price<target(1.5)){state="第二波進行中";phase="第二波進行中";nextTarget=target(1.5)}
    else if(price<target(2)){state="第二波延伸";phase="第二波延伸";nextTarget=target(2)}
    else if(price<target(2.5)){state="第二波高延伸";phase="第二波高延伸";nextTarget=target(2.5)}
    else{state="延伸過熱區";phase="高檔延伸";nextTarget=null}
  }

  let quality=50;
  if(chosen.gain>=10&&chosen.gain<=60)quality+=12;else if(chosen.gain>=6)quality+=6;
  if(chosen.pullback!==null&&chosen.pullback<=-3&&chosen.pullback>=-25)quality+=10;
  if(chosen.completed)quality+=6;
  if(secondPullbackLow!==null)quality+=4;
  if((r?.path?.ma20Slope10??-99)>.3)quality+=6;
  if((r?.path?.ma60Slope20??-99)>0)quality+=6;
  if(price>=activeDefenseLow*.98)quality+=4;else quality-=30;
  if(currentMultiple>2.7)quality-=14;
  quality=Math.round(playClamp(quality));

  return{
    valid:true,state,phase,quality,currentMultiple,nextTarget,referenceHigh,activeDefenseLow,
    baseLow:chosen.low,firstWave:chosen.high,pullbackLow:firstPullback,
    secondWaveHigh:second?.high??null,secondPullbackLow,
    ext15:target(1.5),ext20:target(2),ext25:target(2.5),targetBase,
    gainPct:chosen.gain,pullbackPct:chosen.pullback,secondPullbackPct:second?.pullbackPct??null,
    completed:chosen.completed,
    baseDate:swingDate(rows[chosen.lowIndex]),waveDate:swingDate(rows[chosen.highIndex]),
    pullbackDate:chosen.pullbackIndex>=0?swingDate(rows[chosen.pullbackIndex]):"",
    secondWaveDate:second?.highIndex>=0?swingDate(rows[second.highIndex]):"",
    secondPullbackDate:second?.pullbackIndex>=0?swingDate(rows[second.pullbackIndex]):"",
    reason:chosen.completed
      ?"第一波振幅 X 固定不變；1.5X／2X／2.5X 從第一波後回測低點起算，僅代表第二波可能目標區。"
      :"第一波尚在形成；回測低點確認後才固定第二波倍率目標。"
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
    upDays,restDays,upGain,pullback,retrace,recoveryDays,cycles:completedCycles,ret60,ret120,above20,cross20,max5,medianRange,threshold,
    shortRhythmScore,shortCycle,hybridRhythm,swingTrend,range,burst,deepRhythm,structuralReset,deepPullbacks,recoveredDeep,qualifyingShortCycles,shortLikeCycles,resetCycles,strongShort,strongSwing,stressCycles:stressCycleRows.length};
}
function calculateStockPersonality(rows){
  const all=(rows||[]).filter(x=>playRowClose(x)!==null).slice(-240);
  if(all.length<60)return calculateStockPersonalitySegment(all);
  const recent=all.slice(-160),older=all.slice(Math.max(0,all.length-240),Math.max(0,all.length-160));
  const pr=calculateStockPersonalitySegment(recent),po=older.length>=60?calculateStockPersonalitySegment(older):null;
  if(!pr?.valid)return calculateStockPersonalitySegment(all);
  const oldValid=!!po?.valid,wRecent=oldValid?70:100,wOld=oldValid?30:0;
  const blend=(a,b)=>Math.round(playClamp((Number(a)||50)*(wRecent/100)+(Number(b)||50)*(wOld/100)));
  const result={...pr,shortFit:blend(pr.shortFit,po?.shortFit),swingFit:blend(pr.swingFit,po?.swingFit),longFit:blend(pr.longFit,po?.longFit),windowDays:all.length,recentWeight:wRecent,olderWeight:wOld};
  result.detail=`股性1年｜近160日 ${wRecent}%${wOld?`／前80日 ${wOld}%`:""}${pr.detail?`｜${pr.detail}`:""}`;
  return result;
}
function seasonality3Y(rows,now=new Date()){
  const a=(rows||[]).filter(x=>playRowClose(x)!==null),q=Math.floor(now.getMonth()/3)+1,byYear=new Map();
  for(const r of a){const d=new Date(`${historyDateKey(r)}T00:00:00Z`);if(Number.isNaN(d.getTime())||Math.floor(d.getUTCMonth()/3)+1!==q)continue;const y=d.getUTCFullYear();if(!byYear.has(y))byYear.set(y,[]);byYear.get(y).push(r)}
  const samples=[];for(const [year,x] of [...byYear.entries()].sort((a,b)=>a[0]-b[0]).slice(-3)){if(x.length<15||x.some(r=>r.systemStress))continue;const first=playRowClose(x[0]),last=playRowClose(x.at(-1)),ret=stagePct(last,first);if(ret!==null)samples.push({year,ret})}
  if(!samples.length)return {valid:false,quarter:q,sample:0,label:`Q${q} 正常市場樣本不足`};
  const positives=samples.filter(x=>x.ret>0).length,median=rhythmMedian(samples.map(x=>x.ret));
  return {valid:true,quarter:q,sample:samples.length,positives,median,label:`近3年Q${q}正常市場 ${positives}/${samples.length} 上漲｜中位 ${stageFmtPct(median)}`};
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
function calculateShortEngine(r,t,breakout=playBreakoutState(r,t)){
  const rows=r?.path?.rows||stageHistory(t),price=stageNum(currentStock?.last??currentStock?.price??r?.price);if(rows.length<12||price===null)return {valid:false,state:"資料不足",score:0,tradeable:false};
  const ret1=shortReturnN(rows,1,price),ret3=shortReturnN(rows,3,price),ret5=shortReturnN(rows,5,price),ma5Slope=shortSmaSlope(rows,5,3),ma10Slope=shortSmaSlope(rows,10,3);
  const ratio20=stageNum(t?.volume?.ratio20),rsi=stageNum(t?.momentum?.rsi14),macd=shortMacdSnapshot(rows,price),kd=shortStochastic(rows),candle=shortCandleState(rows),news=shortNewsCatalyst();
  const high20=stageHigh(rows,20),high60=stageHigh(rows,60),upper=stageNum(t?.bollinger?.upper),atr=shortAtr(rows,10),targets=[];
  for(const [label,value] of [["20日高",high20],["布林上軌",upper],["60日高",high60]])if(Number.isFinite(value)&&value>price*1.003&&!targets.some(x=>Math.abs(x.value/value-1)<.003))targets.push({label,value});
  if(atr&&targets.length<2){targets.push({label:"波動延伸1",value:price+atr*1.2},{label:"波動延伸2",value:price+atr*2})}
  targets.sort((a,b)=>a.value-b.value);const resistance=targets[0]||null,resistancePct=resistance?stagePct(resistance.value,price):null;
  const ma5=stageNum(t?.ma?.ma5),ma10=stageNum(t?.ma?.ma10),support=stageNum(breakout?.confirmed?breakout.level:null)??ma10??ma5;
  let score=50;
  if(ret1!==null){if(ret1>=.5&&ret1<=4.5)score+=5;else if(ret1<=-2.5)score-=5}
  if(ret3!==null){if(ret3>=2&&ret3<=10)score+=7;else if(ret3<=-4)score-=7;else if(ret3>12)score-=2}
  if(ret5!==null){if(ret5>=3&&ret5<=15)score+=7;else if(ret5<=-6)score-=7;else if(ret5>=20)score-=7}
  if(ma5Slope!==null)score+=ma5Slope>.5?6:ma5Slope<-.5?-5:0;if(ma10Slope!==null)score+=ma10Slope>.25?4:ma10Slope<-.35?-4:0;if(ma5!==null&&ma10!==null)score+=ma5>=ma10?3:-3;
  if(ratio20!==null)score+=ratio20>=1.2&&ratio20<=2.8?8:ratio20>=1?3:ratio20<.7?-4:0;
  if(rsi!==null)score+=rsi>=55&&rsi<=72?6:rsi>=80?-9:rsi<42?-5:0;
  if(macd.hist!==null)score+=macd.hist>0?4:-3;if(macd.histDelta!==null)score+=macd.histDelta>0?3:-2;
  if(kd.k!==null&&kd.d!==null)score+=kd.k>kd.d&&kd.k>=45&&kd.k<=85?4:kd.k>=90?-4:kd.k<kd.d&&kd.k<45?-3:0;
  score+=candle.score;if(breakout?.confirmed)score+=12;else if(breakout?.failed)score-=24;else if(breakout?.fresh)score-=4;
  if(resistancePct!==null)score+=resistancePct>=2&&resistancePct<=9?5:resistancePct<1?-5:resistancePct>12?1:0;
  score=Math.round(playClamp(score));
  const chaseRisk=(rsi!==null&&rsi>=80)||((ret5??0)>=18&&(rsi??0)>=74)||((ret3??0)>=8&&resistancePct!==null&&resistancePct<1.2);
  let state="偏強整理";
  if(breakout?.failed)state="疑似假突破";else if(breakout?.fresh&&!breakout?.confirmed)state="突破待確認";else if(chaseRisk)state="追價風險高";else if(breakout?.confirmed&&(breakout.age??9)<=2&&score>=58)state="剛發動";else if(score>=72&&(ret3??0)>0)state="動能加速";else if(score<48||(ret3??0)<=-4||(macd.hist!==null&&macd.hist<0&&(macd.histDelta??0)<0))state="動能轉弱";
  const tradeable=!['疑似假突破','突破待確認','追價風險高','動能轉弱'].includes(state);
  return {valid:true,state,score,tradeable,holding:"3～5交易日",ret1,ret3,ret5,ma5Slope,ma10Slope,ratio20,rsi,macd,kd,candle,news,resistance,resistancePct,support,targets:targets.slice(0,3),breakout,chaseRisk};
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

// v2.5.8.6 — 長期玩法 v1。只使用現有資料：近四季 EPS、估值、中長期趨勢、基本面新聞；資料不足會降低完整度，不把長期當 fallback。
function longFundamentalNewsSignal(){
  const rows=Array.isArray(newsRowsCache)?newsRowsCache:[];if(!rows.length)return {score:50,label:"新聞資料待補",count:0,available:false};
  const cutoff=Date.now()-90*86400000,fresh=rows.filter(x=>{const t=newsTime(x);return !t||t>=cutoff}).slice(0,30);
  const positive=/營收.*(?:成長|年增|創高)|EPS.*(?:成長|優於|創高)|獲利.*(?:成長|年增|創高)|訂單|能見度|擴產|量產|新產品|新技術|客戶|認證|合作|需求.*成長|毛利率.*(?:提升|改善)/;
  const negative=/營收.*(?:衰退|年減|下滑)|EPS.*(?:衰退|下滑|虧損)|獲利.*(?:衰退|下滑|虧損)|減產|訂單.*(?:下修|減少)|需求.*(?:疲弱|下滑)|毛利率.*(?:下滑|惡化)|延後|取消/;
  let p=0,n=0;for(const x of fresh){const text=`${x?.title||""} ${(x?.summaryPoints||[]).join(" ")}`;if(positive.test(text))p++;if(negative.test(text))n++}
  const raw=50+Math.min(12,p*3)-Math.min(15,n*4),score=Math.round(playClamp(raw));
  const label=p>n?`基本面正向訊號 ${p} 則`:n>p?`基本面風險訊號 ${n} 則`:`近90日基本面新聞中性`;
  return {score,label,count:fresh.length,positive:p,negative:n,available:fresh.length>0};
}
function calculateLongEngine(r,t,personality=null,targetSignal=null){
  const v=latestValuationData||{},scenario=latestValuationScenario,rows=r?.path?.rows||stageHistory(t),path=r?.path||{};
  const q=(Array.isArray(v.latest4)?v.latest4:[]).map(x=>valuationNum(x?.eps)).filter(Number.isFinite).slice(0,4),ttm=valuationNum(v.ttm),latest=q[0]??null;
  const positiveQ=q.filter(x=>x>0).length;
  let earnings=50;
  if(ttm!==null)earnings+=ttm>0?8:-18;
  if(q.length){earnings+=positiveQ===q.length?10:positiveQ>=3?6:positiveQ===2?0:-10;if(latest!==null)earnings+=latest>0?3:-6;const avg=q.reduce((a,b)=>a+b,0)/q.length;if(latest!==null&&avg>0)earnings+=latest>=avg*.9?3:-3}
  earnings=Math.round(playClamp(earnings));

  const vr=playValuationResult(),fair=valuationNum(scenario?.F),price=stageNum(currentStock?.last??currentStock?.price??r?.price),target=currentTargetPrice();
  const fairGap=price>0&&fair>0?(fair/price-1)*100:null,targetGap=price>0&&target>0?(target/price-1)*100:null;
  const stateMap={"低估偏多":82,"合理偏多":70,"溢價偏多":55,"接近目標價":44,"明顯高估":28,"雙重低估":86,"估值分歧區":54,"成長預期區":50,"全面高估":20};
  let value=50;
  if(fairGap!==null){
    let gapScore=fairGap>=30?90:fairGap>=15?82:fairGap>=5?72:fairGap>=-5?60:fairGap>=-15?46:fairGap>=-25?32:20;
    const stateScore=vr?(stateMap[vr.state]??50):50;value=Math.round(gapScore*.75+stateScore*.25);
  }else if(vr)value=stateMap[vr.state]??50;
  if(vr?.confidence==='低')value=Math.round((value+50)/2);value=Math.round(playClamp(value));

  let trend=50;const ma60Slope=path.ma60Slope20,ret120=path.ret120??stageRet(rows,Math.min(120,Math.max(1,rows.length-1)));
  if(r?.flags?.above60===true)trend+=10;else if(r?.flags?.above60===false)trend-=10;
  if(Number.isFinite(ma60Slope))trend+=ma60Slope>1?12:ma60Slope>0?6:ma60Slope<-1?-12:-6;
  if(Number.isFinite(ret120))trend+=ret120>=25?12:ret120>=8?7:ret120<=-20?-12:ret120<0?-5:0;
  if(r?.stage===5)trend-=5;if(r?.flags?.lifecycleReset)trend-=12;trend=Math.round(playClamp(trend));

  const news=longFundamentalNewsSignal(),personalityScore=personality?.valid?(personality.longFit??50):50,targetScore=targetSignal?.score??50;
  const score=Math.round(playClamp(earnings*.30+value*.25+personalityScore*.15+trend*.15+targetScore*.10+news.score*.05));
  let completeness=0;if(ttm!==null)completeness+=15;if(q.length>=4)completeness+=25;else if(q.length>=2)completeness+=12;if(scenario?.F>0)completeness+=25;if(rows.length>=100)completeness+=20;else if(rows.length>=60)completeness+=10;if(news.available)completeness+=10;if(targetSignal?.available)completeness+=5;completeness=Math.min(100,completeness);
  const valuationDanger=vr&&["明顯高估","全面高估"].includes(vr.state),eligible=completeness>=65&&score>=62&&!valuationDanger&&!r?.flags?.lifecycleReset;
  let state=completeness<60?"資料仍不足":score>=76?"長期條件佳":score>=64?"可列長期觀察":score>=50?"長期條件普通":"長期條件偏弱";
  const earningsText=q.length?`近4季EPS ${positiveQ}/${q.length}季為正${ttm!==null?`｜TTM ${valuationEpsFmt(ttm)}`:""}`:(ttm!==null?`TTM EPS ${valuationEpsFmt(ttm)}`:"EPS資料不足");
  const valuationText=vr?`${vr.state}${fairGap===null?"":`｜合理價空間 ${signedPercent(fairGap)}`}`:"估值資料待補";
  const trendText=`MA60 ${Number.isFinite(ma60Slope)?stageFmtPct(ma60Slope):"--"}${Number.isFinite(ret120)?`｜120日 ${stageFmtPct(ret120)}`:""}`;
  return {valid:true,score,completeness,eligible,state,earnings,value,personalityScore,trend,targetScore,news,earningsText,valuationText,trendText,fairGap,targetGap,positiveQ,quarterCount:q.length,ttm};
}
function calibratePlayScore(raw){return Math.round(playClamp(Number(raw)||50));}

function deriveOperationProfile(scores,personality,longEngine){
  const short=Number(scores?.short)||0,swing=Number(scores?.swing)||0,long=Number(scores?.long)||0;
  const shortSwingGap=swing-short,longSwingGap=long-swing,blockedMix=!!(personality?.range||personality?.structuralReset);
  const longSwingMix=!!(longEngine?.eligible&&long>=64&&swing>=58&&long>=short+5&&Math.abs(longSwingGap)<=14);
  if(longSwingMix){
    let basePct=70;if(longSwingGap>=8)basePct=80;else if(longSwingGap<=-6)basePct=60;
    return {key:"long-swing",label:"長波混合",basePct,tacticalPct:100-basePct,note:"長期核心持有，波段倉依中期結構加減碼"};
  }
  const hybridByRhythm=!!personality?.hybridRhythm,hybridByScore=!blockedMix&&short>=58&&swing>=58&&Math.abs(shortSwingGap)<=12;
  if(hybridByRhythm||hybridByScore){let basePct=50;if(shortSwingGap>=7)basePct=60;else if(shortSwingGap<=-7)basePct=40;return {key:"mixed",label:"短波混合",basePct,tacticalPct:100-basePct,note:"波段方向保留底倉，利用短週期回測管理機動倉"}}
  if(longEngine?.eligible&&long>=Math.max(short,swing)+6)return {key:"long",label:"長期核心",basePct:100,tacticalPct:0,note:"以基本面／估值為主，技術面只做分批節奏"};
  if(short>=62&&short>=swing+10)return {key:"short",label:"純短線",basePct:10,tacticalPct:90,note:"高機動部位，避免把短線回檔完整抱住"};
  if(swing>=62&&swing>=short+10)return {key:"swing",label:"標準波段",basePct:80,tacticalPct:20,note:"以趨勢底倉為主，小部分機動調節"};
  return {key:"balanced",label:"彈性觀察",basePct:50,tacticalPct:50,note:"三玩法差距不明顯，先等訊號拉開"};
}

function calculatePlayStyle(r,t){
  if(!r)return null;
  const stage=r.stage,sub=r.substate||"",score=stageNum(t?.analysis?.overall?.score)??50,
        rsi=stageNum(t?.momentum?.rsi14),ratio20=stageNum(t?.volume?.ratio20),vr=playValuationResult(),price=stageNum(currentStock?.last??currentStock?.price??r?.price);
  const breakout=playBreakoutState(r,t),path=r.path||{},crosses=playMaCrossCount(path.rows||[],20,20),
        swingWave=calculateSwingWave(r,t),shortEngine=calculateShortEngine(r,t,breakout),personality=calculateStockPersonality((latestHistory3Y?.history?.length?latestHistory3Y.history:path.rows)||[]),
        targetSignal=targetPlaySignal(price),swingNews=swingNewsSignal(),longEngine=calculateLongEngine(r,t,personality,targetSignal);
  const rangeNoise=!!(r.flags?.tangled&&crosses>=3&&Math.abs(path.ret20??0)<=10);
  const overheated=stage===5||r.flags?.extremeHeat||(rsi!==null&&rsi>=80)||((r.bias20??0)>=18&&(rsi??0)>=74);
  const falseBreakout=breakout.fresh&&breakout.failed;
  const breakoutPending=breakout.fresh&&!breakout.confirmed&&!breakout.failed;
  const ma20Up=(path.ma20Slope10??-99)>.3,ma60Up=(path.ma60Slope20??-99)>0;
  const healthyTrend=(stage>=3&&stage<=4)&&(r.flags?.above60!==false)&&(ma20Up||ma60Up)&&!rangeNoise;
  const momentumBurst=!rangeNoise&&!overheated&&score>=68&&(rsi===null||(rsi>=52&&rsi<=76))&&(ratio20===null||ratio20>=1.05)&&(path.ret20??0)>=6;
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

  let nowShort=shortEngine?.valid?(shortEngine.score??50):score,nowSwing=score;
  if(healthyTrend)nowSwing+=9;if(ma20Up)nowSwing+=4;if(ma60Up)nowSwing+=5;if(sub.includes("回測")&&!rangeNoise)nowSwing+=5;
  if(swingWave?.valid)nowSwing+=stageClamp((swingWave.quality-50)*.20,-8,10);if(breakout.confirmed)nowSwing+=2;if(overheated){nowShort-=22;nowSwing-=14}
  nowShort=playClamp(nowShort);nowSwing=playClamp(nowSwing);

  // v2.5.8.8：三玩法直接用獨立 0～100 子分數加權，不再乘 1.35，也不再用額外 bonus 重複加分。
  const shortNewsFit=shortEngine?.news?.fit??50;
  const short=calibratePlayScore(histShort*.30+nowShort*.35+stageShort*.20+shortNewsFit*.15);
  const swing=calibratePlayScore(histSwing*.30+nowSwing*.30+stageSwing*.20+(targetSignal?.score??50)*.10+(swingNews?.score??50)*.10);
  const long=calibratePlayScore(longEngine?.score??50);
  const scores={short,swing,long},eligible={short:shortEligible,swing:swingEligible,long:!!longEngine?.eligible};
  const operationProfile=deriveOperationProfile(scores,personality,longEngine);
  const diagnostics={breakout,rangeNoise,crosses,falseBreakout,breakoutPending,healthyTrend,momentumBurst,rhythmShortTrigger,strongShortPersonality,strongSwingPersonality,overheated,stage,sub,ma20Up,ma60Up,weights:{short:"股性30%／短動能35%／階段20%／新聞15%",swing:"股性30%／中期趨勢30%／階段20%／目標價10%／新聞10%",long:"基本面30%／估值25%／長期股性15%／長趨勢15%／目標價10%／新聞5%"},shortEngine,personality,targetSignal,swingNews,longEngine};
  const common={scores,eligible,vr,swingWave,shortEngine,personality,targetSignal,swingNews,longEngine,operationProfile,diagnostics};

  // 主玩法只看三玩法獨立分數，最高分直接成為主玩法；混合型只影響買賣決策。
  let key="short";
  if(swing>short)key="swing";
  if(long>scores[key])key="long";

  const period=key==="short"?"短期":key==="swing"?"波段":"長期";
  let action="等待位置或動能改善",reason=`短線 ${short}｜波段 ${swing}｜長期 ${long}。`;
  if(key==="short"){
    if(overheated)action="追價風險高，等回測";
    else if(falseBreakout)action="疑似假突破，等重新站回突破位";
    else if(rangeNoise&&!breakout.confirmed)action="箱型反覆，等有效突破";
    else if(breakoutPending)action="待突破守穩";
    else if(!shortEligible)action=shortEngine?.state&&shortEngine.state!=="剛發動"&&shortEngine.state!=="動能加速"?shortEngine.state:"短線條件待確認";
    else action=shortEngine?.state==="剛發動"?"剛發動":shortEngine?.state==="動能加速"?"動能加速":breakout.fresh?"突破確認":"短線偏強，嚴守轉弱";
    reason=`股性：${personality?.label||"節奏待判"}；短線 ${short}｜波段 ${swing}｜長期 ${long}。`;
  }else if(key==="swing"){
    if(overheated)action="高檔過熱，等回測";
    else if(falseBreakout)action="突破失敗，等結構修復";
    else if(rangeNoise&&!breakout.confirmed)action="箱型反覆，等有效突破";
    else if(breakoutPending)action="待突破守穩";
    else if(!swingEligible)action=stage===1?"中期結構仍在築底":"波段條件待確認";
    else action=sub.includes("回測")?"回測確認，守中期趨勢":"趨勢完整，續看波段結構";
    reason=`股性：${personality?.label||"節奏待判"}；短線 ${short}｜波段 ${swing}｜長期 ${long}。`;
  }else{
    if(longEngine?.completeness<65)action=`${longEngine?.state||"長期資料待補"}｜先補資料`;
    else if(!longEngine?.eligible)action=`${longEngine?.state||"長期條件待確認"}｜留意估值與長趨勢`;
    else action=`${longEngine.state}｜以基本面與估值分批`;
    reason=`長期 ${long} 分（資料完整度 ${longEngine.completeness}%）；短線 ${short}｜波段 ${swing}。`;
  }
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
  const svg=$("playSwingSvg");if(!svg)return;
  svg.replaceChildren();
  if(!w?.valid)return;

  const actual=[
    {key:"A",title:"起漲低點",value:w.baseLow,color:"#35e5e7",kind:"low"},
    {key:"B",title:"第一波高點",value:w.firstWave,color:"#c46cff",kind:"high"}
  ];
  if(Number.isFinite(w.pullbackLow))actual.push({key:"C",title:"第一回測",value:w.pullbackLow,color:"#63a9ff",kind:"low"});
  if(Number.isFinite(w.secondWaveHigh))actual.push({key:"D",title:"第二波高點",value:w.secondWaveHigh,color:"#c46cff",kind:"high"});
  if(Number.isFinite(w.secondPullbackLow))actual.push({key:"E",title:"第二回測",value:w.secondPullbackLow,color:"#63a9ff",kind:"low"});
  actual.push({key:"NOW",title:"目前位置",value:price,color:"#34dbe6",kind:"current"});

  const targets=[
    {title:"1.5X可能",value:w.ext15,color:"#c46cff"},
    {title:"2X可能",value:w.ext20,color:"#c46cff"},
    {title:"2.5X可能",value:w.ext25,color:"#c46cff"}
  ].filter(x=>Number.isFinite(x.value));
  const vals=[...actual.map(x=>x.value),...targets.map(x=>x.value)].filter(Number.isFinite);
  const lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max((hi-lo)*.14,1),vmin=lo-pad,vmax=hi+pad;
  const y=v=>305-((v-vmin)/(vmax-vmin))*245;

  for(let i=0;i<4;i++){
    const yy=70+i*68;
    svg.append(swingWaveSvg("line",{x1:45,y1:yy,x2:775,y2:yy,class:"swing-wave-grid"}));
    const val=vmax-(vmax-vmin)*((yy-60)/245);
    svg.append(swingWaveSvg("text",{x:38,y:yy+3,class:"swing-wave-axis","text-anchor":"end"},swingWaveFmt(val)));
  }
  svg.append(swingWaveSvg("text",{x:16,y:48,class:"swing-wave-axis"},"股價"));
  svg.append(swingWaveSvg("text",{x:742,y:330,class:"swing-wave-axis"},"時間 →"));
  const avg=positionNumber(position?.avgCost);
  if(avg!==null&&avg>=vmin&&avg<=vmax){
    const cy=y(avg);svg.append(swingWaveSvg("line",{x1:45,y1:cy,x2:775,y2:cy,class:"swing-wave-cost-line"}));
    svg.append(swingWaveSvg("text",{x:770,y:Math.max(18,cy-5),class:"swing-wave-cost-text","text-anchor":"end"},`持股均價 ${swingWaveFmt(avg)}`));
  }

  const xStart=68,xEnd=545,step=actual.length>1?(xEnd-xStart)/(actual.length-1):0;
  const pts=actual.map((n,i)=>({...n,x:xStart+step*i,y:y(n.value)}));
  if(pts.length>1){
    let d=`M ${pts[0].x} ${pts[0].y}`;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],mx=(a.x+b.x)/2;
      d+=` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
    }
    svg.append(swingWaveSvg("path",{d,class:"swing-wave-path-actual"}));
  }

  // 前高／最近一波高點只做參考水平線。
  const ref=Number.isFinite(w.referenceHigh)?w.referenceHigh:w.firstWave;
  const refPt=pts.find(p=>Math.abs(p.value-ref)<1e-8&&p.kind==="high")||pts[1];
  const now=pts.at(-1);
  if(refPt&&now)svg.append(swingWaveSvg("line",{x1:refPt.x+9,y1:y(ref),x2:now.x-9,y2:y(ref),class:"swing-wave-guide"}));

  // 1.5X／2X／2.5X 是「替代目標」，不是依序必經路線：用目標區＋三條分支呈現。
  if(targets.length&&now){
    const zoneTop=Math.min(...targets.map(t=>y(t.value))),zoneBottom=Math.max(...targets.map(t=>y(t.value)));
    svg.append(swingWaveSvg("rect",{x:692,y:Math.max(18,zoneTop-16),width:84,height:Math.max(28,zoneBottom-zoneTop+32),rx:10,class:"swing-wave-target-zone"}));
    svg.append(swingWaveSvg("text",{x:734,y:Math.max(28,zoneTop-23),class:"swing-wave-target-title","text-anchor":"middle"},"可能目標區"));
    targets.forEach((t,i)=>{
      const tx=744,ty=y(t.value);
      svg.append(swingWaveSvg("path",{d:`M ${now.x+8} ${now.y} C 615 ${now.y}, 680 ${ty}, ${tx} ${ty}`,class:"swing-wave-target-ray"}));
      svg.append(swingWaveSvg("circle",{cx:tx,cy:ty,r:6,fill:t.color,class:"swing-wave-dot"}));
      swingWaveLabel(svg,tx-4,Math.max(28,ty-28),t.title,swingWaveFmt(t.value),t.color,"middle");
    });
  }

  pts.forEach((p,i)=>{
    svg.append(swingWaveSvg("circle",{cx:p.x,cy:p.y,r:p.kind==="current"?7:6,fill:p.color,class:"swing-wave-dot"}));
    let ly=p.kind==="high"?Math.max(34,p.y-38):Math.min(292,p.y+31);
    let extra="";
    if(p.kind==="current"&&Number.isFinite(w.currentMultiple))extra=`(第2波 ${w.currentMultiple.toFixed(2)}X)`;
    swingWaveLabel(svg,p.x,ly,p.title,swingWaveFmt(p.value),p.color,"middle",extra);
  });
}

function shortFmtPct(v){return Number.isFinite(v)?`${v>=0?"+":""}${v.toFixed(1)}%`:"--"}
function shortFmtNum(v,d=1){return Number.isFinite(v)?Number(v).toFixed(d):"--"}
function resetShortAnalysis(){
  const box=$("playShortAnalysis");if(box)box.hidden=true;
  setText("playShortState","--");
  for(const id of ["shortMomentum","shortMaAccel","shortVolume","shortIndicators","shortCandle","shortNews","shortResistance"])setText(id,"--");
  setText("playShortNote","短期評分會同時看股性、動能／突破、五階段與近7日新聞；新聞不會單獨觸發短線建議。");
}
function renderShortAnalysis(x){
  const box=$("playShortAnalysis");if(!box)return;if(!["short","mixed"].includes(x?.key)){resetShortAnalysis();return}box.hidden=false;
  const s=x?.shortEngine;if(!s?.valid){setText("playShortState","資料不足");return}
  setText("playShortState",`短線狀態：${s.state}｜結構 ${s.score}分`);
  setText("shortMomentum",`1日 ${shortFmtPct(s.ret1)}｜3日 ${shortFmtPct(s.ret3)}｜5日 ${shortFmtPct(s.ret5)}`);
  setText("shortMaAccel",`MA5 ${shortFmtPct(s.ma5Slope)}｜MA10 ${shortFmtPct(s.ma10Slope)}`);
  setText("shortVolume",Number.isFinite(s.ratio20)?`20日量比 ${shortFmtNum(s.ratio20,2)}x`:`量比資料不足`);
  const macdText=s.macd?.hist===null?"MACD --":`MACD柱 ${s.macd.hist>=0?"+":""}${shortFmtNum(s.macd.hist,2)}`;
  const kdText=s.kd?.k===null?"KD --":`KD ${shortFmtNum(s.kd.k,0)}/${shortFmtNum(s.kd.d,0)}`;
  setText("shortIndicators",`RSI ${shortFmtNum(s.rsi,1)}｜${macdText}｜${kdText}`);
  setText("shortCandle",s.candle?.label||"--");setText("shortNews",s.news?.label||"新聞資料待補");
  setText("shortResistance",s.resistance?`${s.resistance.label} ${technicalFmt(s.resistance.value)}｜距離 ${shortFmtPct(s.resistancePct)}`:"上方暫無明確近端壓力");
  setText("playShortNote",`假突破濾網：${s.breakout?.failed?"未通過":s.breakout?.confirmed?"已確認":"無明顯失敗"}｜短期評分：股性30%／動能突破35%／五階段20%／新聞15%。`);
}

function resetSwingWave(){
  const box=$("playSwingAnalysis");if(box)box.hidden=true;
  const svg=$("playSwingSvg");if(svg)svg.replaceChildren();
  const legend=$("playSwingLegend");if(legend)legend.replaceChildren();
  setText("playSwingState","--");setText("playSwingGoal","第一目標：--");setText("playSwingNote","波段或短波混合時啟用。");
}
function renderSwingWave(x){
  const box=$("playSwingAnalysis");if(!box)return;
  if(!["swing","mixed","long-swing"].includes(x?.key)){resetSwingWave();return}
  box.hidden=false;
  const w=x?.swingWave,price=stageNum(latestFiveStageResult?.price),position=currentHoldingPosition();
  if(!w?.valid||price===null){
    setText("playSwingState","資料不足");setText("playSwingGoal","第一目標：--");setText("playSwingNote",w?.reason||"近期波段結構不足");
    const svg=$("playSwingSvg");if(svg)svg.replaceChildren();return;
  }
  setText("playSwingState",`目前階段：${w.phase||w.state}｜結構 ${w.quality}分`);
  const refHigh=Number.isFinite(w.referenceHigh)?w.referenceHigh:w.firstWave;
  let goal="--";
  if(Number.isFinite(w.secondPullbackLow)&&price<refHigh*.995)goal=`先回到第二波高點 ${technicalFmt(refHigh)}；突破後再評估第三波`;
  else if(price<w.firstWave*.985)goal=`先回到第一波前高 ${technicalFmt(w.firstWave)}；突破後進入第二波`;
  else if(price<w.ext15)goal=`第二波可能目標：1.5X ${technicalFmt(w.ext15)} / 2X ${technicalFmt(w.ext20)} / 2.5X ${technicalFmt(w.ext25)}`;
  else if(price<w.ext20)goal=`已到 1.5X 區；其餘可能目標為 2X ${technicalFmt(w.ext20)} 或 2.5X ${technicalFmt(w.ext25)}`;
  else if(price<w.ext25)goal=`已到 2X 區；高延伸可能目標為 2.5X ${technicalFmt(w.ext25)}`;
  else goal="已超過 2.5X 參考區，優先觀察過熱與轉弱";
  setText("playSwingGoal",`下一步：${goal}`);
  drawSwingWave(w,price,position);
  const legend=$("playSwingLegend");
  if(legend){
    const items=[
      ["#35e5e7",`起漲低點 <b>${swingWaveFmt(w.baseLow)}</b> — 第一波起點`],
      ["#c46cff",`第一波高點 <b>${swingWaveFmt(w.firstWave)}</b> — 第一波 X = ${swingWaveFmt(w.firstWave-w.baseLow)}`]
    ];
    if(Number.isFinite(w.pullbackLow))items.push(["#63a9ff",`第一回測 <b>${swingWaveFmt(w.pullbackLow)}</b> — 第二波倍率從這裡起算`]);
    if(Number.isFinite(w.secondWaveHigh))items.push(["#c46cff",`第二波高點 <b>${swingWaveFmt(w.secondWaveHigh)}</b> — 實際走勢轉折`]);
    if(Number.isFinite(w.secondPullbackLow))items.push(["#63a9ff",`第二回測 <b>${swingWaveFmt(w.secondPullbackLow)}</b> — 後續進場／防守參考`]);
    items.push(["#34dbe6",`目前位置 <b>${swingWaveFmt(price)}</b>${Number.isFinite(w.currentMultiple)?`（相對第一回測 ${w.currentMultiple.toFixed(2)}X）`:""}`]);
    if(position?.avgCost)items.push(["#ffb44b",`持股均價 <b>${swingWaveFmt(position.avgCost)}</b>${position?.shares?` ｜ ${position.shares.toLocaleString("zh-TW")} 股`:""}`]);
    items.push(["#c46cff",`可能目標區：1.5X <b>${swingWaveFmt(w.ext15)}</b> ｜ 2X <b>${swingWaveFmt(w.ext20)}</b> ｜ 2.5X <b>${swingWaveFmt(w.ext25)}</b>`]);
    legend.innerHTML=items.map(([c,t])=>`<div style="color:${c}"><i></i><span style="color:#9fb1c0">${t}</span></div>`).join("");
  }
  const dates=w.baseDate&&w.waveDate?`${w.baseDate} → ${w.waveDate}`:"";
  const p1=w.pullbackDate?`；第一回測 ${w.pullbackDate}`:"";
  const p2=w.secondPullbackDate?`；第二回測 ${w.secondPullbackDate}`:"";
  setText("playSwingNote",`${dates}${p1}${p2}。${w.reason} 第二次回測只作結構／防守參考，暫不重新套固定倍率。`);
}

function resetLongAnalysis(){
  const box=$("playLongAnalysis");if(box)box.hidden=true;
  setText("playLongState","--");setText("playLongData","資料完整度 --");
  for(const id of ["longEarnings","longValuation","longTrend","longNews"])setText(id,"--");
  setText("playLongNote","長期評分：基本面30%／估值25%／長期股性15%／長趨勢15%／目標價10%／基本面新聞5%。");
}
function renderLongAnalysis(x){
  const box=$("playLongAnalysis");if(!box)return;if(!["long","long-swing"].includes(x?.key)){resetLongAnalysis();return}box.hidden=false;
  const l=x?.longEngine;if(!l?.valid){setText("playLongState","資料不足");return}
  setText("playLongState",`${l.state}｜玩法適配 ${x.scores?.long??l.score}分`);setText("playLongData",`資料完整度 ${l.completeness}%｜不是勝率`);
  setText("longEarnings",l.earningsText||"--");setText("longValuation",l.valuationText||"--");setText("longTrend",l.trendText||"--");setText("longNews",l.news?.label||"新聞資料待補");
  setText("playLongNote","長期評分已納入長期股性與券商目標價；目前基本面仍以可取得的 EPS／估值資料為主，資料完整度只顯示、不加分。");
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
    if((l.score??0)<62)return "長期條件未達標";
    if(d.stage===1&&x?.longEngine?.trend<50)return "長趨勢待修復";
    return "待長期條件確認";
  }
  return "待確認";
}
function resetPlayStyle(note="搜尋股票後判讀"){
  setText("overviewPlayStyle","--");setText("overviewPlayStyleNote","查看建議策略");setText("playMainPeriod","--");setText("playMainAction",note);setText("playReason","三玩法永遠同時計分；是否適合現在進場則另外判斷。");setText("playPersonality","--");setText("playPersonalityNote","等待歷史日K分析");
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
  const profileText=x.operationProfile?(x.operationProfile.key==="long-swing"?`長期核心 ${x.operationProfile.basePct}%｜波段倉 ${x.operationProfile.tacticalPct}%｜${x.operationProfile.note}`:x.operationProfile.key==="mixed"?`底倉 ${x.operationProfile.basePct}%｜機動倉 ${x.operationProfile.tacticalPct}%｜${x.operationProfile.note}`:`核心 ${x.operationProfile.basePct}%｜機動 ${x.operationProfile.tacticalPct}%｜${x.operationProfile.note}`):"--";
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
function uniqueFutureTargets(items,price){
  const p=positionNumber(price),out=[];
  for(const item of items||[]){const v=positionNumber(item?.value);if(v===null||p===null||v<=p*1.002)continue;if(out.some(x=>Math.abs(x.value/v-1)<.003))continue;out.push({...item,value:v})}
  return out.sort((a,b)=>a.value-b.value);
}
function buildExpectedPlan(play,price){
  const p=positionNumber(price);if(p===null)return {mode:"--",levels:[],note:"目前股價不足"};
  const w=play?.swingWave,t=latestTechnicalForPlay||{},items=[];
  const add=(label,value,kind="structure")=>{const n=positionNumber(value);if(n!==null)items.push({label,value:n,kind})};
  let mode=play?.key||"observe",note="";
  if(mode==="mixed"){
    const se=play?.shortEngine||play?.diagnostics?.shortEngine;
    if(se?.targets?.length)for(const x of se.targets.slice(0,1))add(`機動倉 ${x.label}`,x.value,"short");
    add("波段前高",w?.referenceHigh??w?.firstWave,"resistance");add("波段1.5X可能",w?.ext15,"extension");add("波段2X可能",w?.ext20,"extension");
    note="短波混合：近端目標管理機動倉，遠端波段結構留給底倉參考。";
  }else if(mode==="long-swing"){
    add("波段前高",w?.referenceHigh??w?.firstWave,"resistance");add("綜合合理價",latestValuationScenario?.F,"valuation");add("券商目標價",currentTargetPrice(),"target");add("波段1.5X可能",w?.ext15,"extension");
    note="長波混合：波段倉先看中期前高／延伸，長期核心再看估值與券商目標。";
  }else if(mode==="swing"&&w?.valid){
    add(Number.isFinite(w.referenceHigh)?"前高確認":"第一波前高",w.referenceHigh??w.firstWave,"resistance");
    add("1.5X可能",w.ext15,"extension");add("2X可能",w.ext20,"extension");add("2.5X可能",w.ext25,"extension");
    note="波段以實際前高與第一回測後的延伸目標估算。";
  }else if(mode==="short"){
    const se=play?.shortEngine||play?.diagnostics?.shortEngine;
    if(se?.targets?.length)for(const x of se.targets)add(x.label,x.value,"short");
    else{add("突破壓力",play?.diagnostics?.breakout?.level,"breakout");add("布林上軌",t?.bollinger?.upper,"bollinger");add("60日高",t?.trend?.high60,"high60")}
    note=`短期依 ${se?.state||"動能"}與近端壓力估算。`;
  }else if(mode==="long"){
    add("綜合合理價",latestValuationScenario?.F,"valuation");add("券商目標價",currentTargetPrice(),"target");
    note="長期以內部估值與券商目標價作參考。";
  }else{
    if(w?.valid)add("結構前高",w.referenceHigh??w.firstWave,"resistance");add("布林上軌",t?.bollinger?.upper,"bollinger");add("60日高",t?.trend?.high60,"high60");
    note="目前先觀察；只顯示上方結構壓力，不代表已出現進場訊號。";
  }
  const levels=uniqueFutureTargets(items,p).slice(0,3);
  if(!levels.length)note=mode==="observe"?"目前沒有明確高於現價的近端結構目標，先等待新訊號。":"目前已接近或高於主要參考目標，優先觀察是否過熱或形成新結構。";
  return {mode,levels,note};
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
function historicalSimilarWinRate(play,price,upsidePct,downsidePct){
  const rows=((latestHistory3Y?.history?.length?latestHistory3Y.history:latestFiveStageResult?.path?.rows)||[]).filter(x=>playRowClose(x)!==null),p=positionNumber(price);
  const seasonality=seasonality3Y(rows),extreme=extremeMarketRisk(rows);
  if(rows.length<180||p===null||!Number.isFinite(upsidePct)||!Number.isFinite(downsidePct))return {valid:false,label:"樣本不足",sample:0,seasonality,extreme};
  const mode=play?.key||"observe",cfg=mode==="short"?{h:5,step:3,min:2,max:14}:mode==="swing"?{h:20,step:6,min:4,max:24}:mode==="mixed"?{h:15,step:5,min:4,max:22}:mode==="long-swing"?{h:40,step:8,min:6,max:28}:mode==="long"?{h:60,step:10,min:8,max:30}:{h:10,step:4,min:3,max:18};
  const cur=[shortReturnN(rows,5,p),stageRet(rows,20,p),stageRet(rows,60,p)],ma20=stageSmaAt(rows,20),ma60=stageSmaAt(rows,60),curAbove20=ma20?p>=ma20:null,curAbove60=ma60?p>=ma60:null,currentQuarter=Math.floor(new Date().getMonth()/3)+1,candidates=[];
  for(let i=60;i<rows.length-cfg.h;i+=cfg.step){const r5=histRetAt(rows,i,5),r20=histRetAt(rows,i,20),r60=histRetAt(rows,i,60),m20=histMaAt(rows,i,20),m60=histMaAt(rows,i,60),entry=histCloseAt(rows,i);if([r5,r20,r60,m20,m60,entry].some(v=>v===null))continue;
    if(rows.slice(Math.max(0,i-5),i+1).some(x=>x?.systemStress))continue;const forward=rows.slice(i+1,Math.min(rows.length,i+cfg.h+1));if(forward.some(x=>x?.systemStress))continue;
    const a20=entry>=m20,a60=entry>=m60;let dist=0,weights=mode==="short"?[1.2,.7,.25]:mode==="long"||mode==="long-swing"?[.25,.7,1.2]:[.45,1.0,.8];
    dist+=Math.abs(r5-(cur[0]??0))/8*weights[0]+Math.abs(r20-(cur[1]??0))/16*weights[1]+Math.abs(r60-(cur[2]??0))/32*weights[2];
    if(curAbove20!==null&&a20!==curAbove20)dist+=.65;if(curAbove60!==null&&a60!==curAbove60)dist+=.75;
    const dk=historyDateKey(rows[i]),d=dk?new Date(`${dk}T00:00:00Z`):null,q=d&&!Number.isNaN(d.getTime())?Math.floor(d.getUTCMonth()/3)+1:null;if(q!==null&&q!==currentQuarter)dist+=.18;
    candidates.push({i,entry,dist});
  }
  candidates.sort((a,b)=>a.dist-b.dist);const sample=candidates.filter(x=>x.dist<=2.2).slice(0,30);if(sample.length<5)return {valid:false,label:"樣本不足",sample:sample.length,seasonality,extreme};
  const up=stageClamp(upsidePct,cfg.min,cfg.max),down=stageClamp(Math.abs(downsidePct),2,22),mfes=[],maes=[];let wins=0;
  for(const c of sample){let outcome=0,mfe=0,mae=0;for(let j=c.i+1;j<=Math.min(rows.length-1,c.i+cfg.h);j++){const hi=playRowHigh(rows[j])??histCloseAt(rows,j),lo=swingLow(rows[j])??histCloseAt(rows,j),ur=hi===null?null:stagePct(hi,c.entry),dr=lo===null?null:stagePct(lo,c.entry);if(ur!==null)mfe=Math.max(mfe,ur);if(dr!==null)mae=Math.min(mae,dr);if(outcome===0&&hi!==null&&hi>=c.entry*(1+up/100))outcome=1;else if(outcome===0&&lo!==null&&lo<=c.entry*(1-down/100))outcome=-1}mfes.push(mfe);maes.push(mae);if(outcome===1)wins++}
  const rate=Math.round(wins/sample.length*100),confidence=sample.length>=16?"樣本中等":sample.length>=10?"樣本偏少":"樣本少";
  return {valid:true,rate,sample:sample.length,wins,horizon:cfg.h,up,down,confidence,upNear:histPercentile(mfes,.25),upFar:histPercentile(mfes,.75),downNear:histPercentile(maes,.75),downFar:histPercentile(maes,.25),seasonality,extreme};
}
function resetTradeOutputs(note="等待分析資料"){
  setText("overviewExpectedUpside","--%");setText("overviewExpectedUpsideNote",note);setText("expectedModeBadge","依玩法");setText("expectedBasisLabel","現價基準");setText("expectedRange","--%");setText("expectedDownsideRange","--%");setText("expectedWinRate","--");setText("expectedWinRateNote","樣本不足");setText("expectedExtremeRisk","--%");setText("expectedExtremeRiskNote","系統性崩壞壓力測試");setText("expectedSeasonalityNote","季節性：等待三年資料");setText("expectedBasisNote",note);setText("expectedFoot","持股會改用均價計算報酬與預估損益；觀察股維持現價基準。勝率是同檔歷史相似訊號回測，不代表未來機率。");
  const pos=$("expectedPositionSummary");if(pos)pos.hidden=true;
  for(let i=1;i<=3;i++){const box=$(`expectedTarget${i}`);if(box)box.hidden=i>1;setText(`expectedT${i}Label`,i===1?"第一目標":i===2?"主要目標":"樂觀目標");setText(`expectedT${i}Price`,"--");setText(`expectedT${i}Return`,"--");setText(`expectedT${i}Profit`,"")}
  setText("decisionModeBadge","依玩法");setText("decisionPositionNote",note);for(const id of ["decisionTrialPrice","decisionEntryPrice","decisionTrimPrice","decisionExitPrice"])setText(id,"--");for(const id of ["decisionTrialNote","decisionEntryNote","decisionTrimNote","decisionExitNote"])setText(id,"--");
}
function renderExpectedUpside(play=latestPlayStyleResult){
  const price=positionNumber(currentStock?.last??currentStock?.price??latestFiveStageResult?.price);if(price===null){resetTradeOutputs("等待股價資料");return null}
  const position=currentHoldingPosition(),base=position?.avgCost||price,plan=buildExpectedPlan(play,price),downside=buildDownsidePlan(play,price);
  const structuralReturns=plan.levels.map(x=>positionReturn(x.value,base)).filter(Number.isFinite),structuralDown=downside.levels.map(x=>positionReturn(x.value,price)).filter(Number.isFinite);
  const firstUp=plan.levels.length?positionReturn(plan.levels[0].value,price):null,nearestDown=downside.levels.length?positionReturn(downside.levels[0].value,price):null;
  const fallbackUp=play?.key==="short"?5:play?.key==="long"?15:10,fallbackDown=play?.key==="short"?-5:play?.key==="long"?-12:-8;
  const wr=historicalSimilarWinRate(play,price,Number.isFinite(firstUp)?firstUp:fallbackUp,Number.isFinite(nearestDown)?nearestDown:fallbackDown);
  const histUpPrices=wr.valid&&Number.isFinite(wr.upNear)&&Number.isFinite(wr.upFar)?[price*(1+Math.max(0,wr.upNear)/100),price*(1+Math.max(0,wr.upFar)/100)]:[];
  const returns=histUpPrices.length?histUpPrices.map(x=>positionReturn(x,base)).filter(Number.isFinite):structuralReturns;
  const downReturns=wr.valid&&Number.isFinite(wr.downNear)&&Number.isFinite(wr.downFar)?[wr.downNear,wr.downFar]:structuralDown;
  const modeName=plan.mode==="swing"?"波段":plan.mode==="short"?"短期":plan.mode==="mixed"?"短波混合":plan.mode==="long-swing"?"長波混合":plan.mode==="long"?"長期":"觀察";
  setText("expectedModeBadge",`${position?.avgCost?"持股｜":""}${modeName}`);setText("expectedBasisLabel",position?.avgCost?"上漲看均價｜下跌看現價":"現價基準");
  const range=returns.length?(returns.length===1?signedPercent(returns[0]):`${signedPercent(Math.min(...returns))} ～ ${signedPercent(Math.max(...returns))}`):"--%";
  const downRange=downReturns.length?(downReturns.length===1?signedPercent(downReturns[0]):`${signedPercent(Math.max(...downReturns))} ～ ${signedPercent(Math.min(...downReturns))}`):"--%";
  setText("expectedRange",range);setText("expectedDownsideRange",downRange);setText("overviewExpectedUpside",range);setText("overviewExpectedUpsideNote",position?.avgCost?`均價成長 ${range}｜正常風險 ${downRange}`:`${modeName}｜上 ${range} / 下 ${downRange}`);
  const basisLead=wr.valid?"上／下空間以近3年正常市場的同檔相似訊號估算；系統性崩壞樣本已從正常統計排除。":"三年相似樣本不足，暫以目前市場結構估算。";
  setText("expectedBasisNote",position?.avgCost?`${basisLead} 上漲換算以你的均價 ${technicalFmt(position.avgCost)} 為基準；下跌風險固定以現價計算。`:`${basisLead} ${plan.note}`);
  setText("expectedWinRate",wr.valid?`${wr.rate}%`:"--");setText("expectedWinRateNote",wr.valid?`${wr.confidence}｜${wr.sample}次｜${wr.horizon}日內先達目標`:`樣本不足（${wr.sample||0}次）`);
  const ex=wr.extreme||{};let exText="--%";if(ex.valid){exText=ex.sample===1?signedPercent(ex.far):`${signedPercent(ex.near)} ～ ${signedPercent(ex.far)}`}
  setText("expectedExtremeRisk",exText);setText("expectedExtremeRiskNote",ex.valid?`近3年系統性壓力 ${ex.sample} 次｜正常空間不含此樣本`:"近3年未形成足夠系統性崩壞樣本");
  const season=wr.seasonality||seasonality3Y(latestHistory3Y?.history||[]);setText("expectedSeasonalityNote",`季節性：${season?.label||"三年樣本不足"}`);

  const posBox=$("expectedPositionSummary");if(posBox){posBox.hidden=!position;if(position){setText("expectedAvgCost",position.avgCost?technicalFmt(position.avgCost):"未填");setText("expectedShares",position.shares?`${position.shares.toLocaleString("zh-TW")} 股`:"未填");const pnl=position.avgCost&&position.shares?(price-position.avgCost)*position.shares:null,pct=position.avgCost?positionReturn(price,position.avgCost):null;setText("expectedCurrentPnl",pnl===null?"待補資料":`${signedMoney(pnl)}${pct===null?"":`（${signedPercent(pct)}）`}`)}}
  for(let i=1;i<=3;i++){const item=plan.levels[i-1],box=$(`expectedTarget${i}`);if(box)box.hidden=!item;if(!item)continue;setText(`expectedT${i}Label`,item.label);setText(`expectedT${i}Price`,technicalFmt(item.value));const ret=positionReturn(item.value,base);setText(`expectedT${i}Return`,`${position?.avgCost?"對均價":"對現價"} ${signedPercent(ret)}`);const profit=position?.avgCost&&position?.shares?(item.value-position.avgCost)*position.shares:null;setText(`expectedT${i}Profit`,profit===null?"":`預估損益 ${signedMoney(profit)}`)}
  const longCaveat=["long","long-swing"].includes(play?.key)?" 長期勝率仍只回測歷史價格結構，不含歷史基本面快照。":"";
  const winNote=wr.valid?`近3年正常市場相似訊號勝率 ${wr.rate}%（${wr.sample}次）；系統性崩壞另外列為極端市場風險。${longCaveat}`:`近3年正常市場相似訊號樣本不足。${longCaveat}`;
  setText("expectedFoot",`${plan.note} 目標價位仍依目前玩法結構；成長／正常下跌空間與勝率使用三年歷史樣本。${winNote}${position?.shares?` 目前持有 ${position.shares.toLocaleString("zh-TW")} 股。`:""}`);
  return {price,position,base,plan,downside,winRate:wr};
}

function buildDecisionPlan(play,price,expected){
  const p=positionNumber(price),t=latestTechnicalForPlay||{},w=play?.swingWave,profile=play?.operationProfile||{};if(p===null)return null;
  if(profile?.key==="mixed"&&["short","swing"].includes(play?.key)){
    const se=play?.shortEngine||play?.diagnostics?.shortEngine,bo=play?.diagnostics?.breakout||{};
    const support=positionNumber(w?.activeDefenseLow??w?.secondPullbackLow??w?.pullbackLow??se?.support??t?.ma?.ma20),confirm=positionNumber(w?.referenceHigh??w?.firstWave??bo?.level),levels=expected?.plan?.levels||[];
    const trim=levels[0]?.value??confirm,exit=levels[1]?.value??w?.ext15??levels.at(-1)?.value??null;
    return {mode:"短波混合",trial:targetZone(support,.99,1.02),entry:targetZone(confirm,1,1.02),trim:targetZone(trim,.99,1.01),exit:targetZone(exit,.985,1.015),trialNote:"回測支撐附近只補機動倉；底倉不因短線震盪重複進出",entryNote:"突破前高／短壓力並守穩後，再把機動倉補足",trimNote:"先處理機動倉，底倉保留波段趨勢",exitNote:"高延伸目標或波段結構轉弱時，再評估剩餘底倉"};
  }
  if(play?.key==="swing"&&w?.valid){
    const support=positionNumber(w.activeDefenseLow??w.secondPullbackLow??w.pullbackLow??t?.ma?.ma20),confirm=positionNumber(w.referenceHigh??w.firstWave);
    const extensions=uniqueFutureTargets([{label:"1.5X",value:w.ext15},{label:"2X",value:w.ext20},{label:"2.5X",value:w.ext25}],Math.max(p,(confirm||0)*1.015));
    const trim=extensions[0]?.value??expected?.plan?.levels?.find(x=>x.value>p*1.01)?.value??null,exit=extensions[1]?.value??extensions[0]?.value??expected?.plan?.levels?.at(-1)?.value??null;
    return {mode:"波段",trial:targetZone(support,.99,1.02),entry:targetZone(confirm,1,1.02),trim:targetZone(trim,.985,1.01),exit:targetZone(exit,.985,1.015),trialNote:"回測支撐附近的小量試單參考",entryNote:p>(confirm||Infinity)*1.03?"已突破；等回測確認，不追價":"突破前高並站穩後才提高部位",trimNote:"第一延伸目標附近先收部分",exitNote:"較高延伸目標／結構轉弱時處理剩餘部位"};
  }
  if(play?.key==="short"){
    const se=play?.shortEngine||play?.diagnostics?.shortEngine,bo=play?.diagnostics?.breakout||{},support=positionNumber(se?.support??t?.ma?.ma10??t?.ma?.ma20??t?.ma?.ma5),confirm=positionNumber(bo?.level??se?.resistance?.value??t?.bollinger?.upper),levels=expected?.plan?.levels||[],entryCenter=bo?.confirmed&&bo?.level?positionNumber(bo.level):confirm;
    return {mode:"短期",trial:targetZone(support,.995,1.015),entry:targetZone(entryCenter,bo?.confirmed ? .992 : 1,bo?.confirmed?1.012:1.015),trim:targetZone(levels[0]?.value,.99,1.005),exit:targetZone(levels[1]?.value??levels[0]?.value,.99,1.01),trialNote:"短均線／突破回測附近的小量試單參考",entryNote:bo?.confirmed?"突破已確認；回測突破位守穩再提高部位":"有效突破並守穩後才提高部位",trimNote:"碰第一短壓力先收部分",exitNote:"下一短壓力／動能轉弱時處理剩餘部位"};
  }
  if(profile?.key==="long-swing"&&["long","swing"].includes(play?.key)){
    const l=play?.longEngine||{},support=positionNumber(w?.activeDefenseLow??w?.secondPullbackLow??w?.pullbackLow??t?.ma?.ma60),confirm=positionNumber(w?.referenceHigh??w?.firstWave),levels=expected?.plan?.levels||[],fair=positionNumber(latestValuationScenario?.F);
    const trim=levels[0]?.value??confirm,exit=levels[1]?.value??fair??currentTargetPrice();
    return {mode:"長波混合",trial:targetZone(support,.985,1.015),entry:targetZone(confirm,1,1.02),trim:targetZone(trim,.99,1.01),exit:targetZone(exit,.985,1.015),trialNote:"長期核心不因一般波動反覆進出；回測支撐只調整波段倉",entryNote:`波段重新轉強再補機動部位；長期適配 ${play?.scores?.long??l.score??"--"}分、資料完整度 ${l.completeness??0}%`,trimNote:"先處理波段倉，長期核心續看基本面／估值",exitNote:"長期核心只有在估值過熱、基本面或長趨勢轉弱時才大幅退出"};
  }
  if(play?.key==="long"){
    const l=play?.longEngine||{},fair=positionNumber(latestValuationScenario?.F),ma60=positionNumber(t?.ma?.ma60),support=ma60&&ma60<p*1.08?ma60:p,levels=expected?.plan?.levels||[];
    const entryCenter=(fair&&fair>p)?p:Math.min(p,support||p),trim=levels[0]?.value??fair,exit=levels[1]?.value??levels[0]?.value??currentTargetPrice();
    return {mode:"長期",trial:targetZone(support,.985,1.015),entry:targetZone(entryCenter,.97,1.01),trim:targetZone(trim,.985,1.01),exit:targetZone(exit,.985,1.015),trialNote:"以中長期支撐／估值安全邊際分批，不追單日動能",entryNote:`長期適配 ${play?.scores?.long??l.score??"--"}分、資料完整度 ${l.completeness??0}%；基本面與估值持續成立才提高部位`,trimNote:"接近內部合理價／主要目標時先回收部分",exitNote:"高於主要估值區且基本面或長趨勢轉弱時處理剩餘部位"};
  }
  return {mode:"觀察",trial:null,entry:null,trim:null,exit:null,trialNote:"目前先觀察，不主動試單",entryNote:"等待玩法確認後再計算",trimNote:"持股可先看上方結構壓力",exitNote:"尚未形成完整操作計畫"};
}
function renderDecision(play=latestPlayStyleResult,expected=null){
  const price=positionNumber(currentStock?.last??currentStock?.price??latestFiveStageResult?.price);if(price===null)return;
  expected=expected||{price,position:currentHoldingPosition(),plan:buildExpectedPlan(play,price)};const d=buildDecisionPlan(play,price,expected),position=expected.position||currentHoldingPosition(),profile=play?.operationProfile;if(!d)return;
  setText("decisionModeBadge",`${position?.avgCost?"持股｜":""}${d.mode}`);
  const split=profile?(profile.key==="long-swing"?`｜部位：長期核心 ${profile.basePct}%／波段倉 ${profile.tacticalPct}%`:profile.key==="mixed"?`｜部位：底倉 ${profile.basePct}%／機動 ${profile.tacticalPct}%`:`｜部位：核心 ${profile.basePct}%／機動 ${profile.tacticalPct}%`):"";
  if(position){const pnl=position.avgCost&&position.shares?(price-position.avgCost)*position.shares:null,pct=position.avgCost?positionReturn(price,position.avgCost):null;setText("decisionPositionNote",`持股均價 ${position.avgCost?technicalFmt(position.avgCost):"未填"}｜${position.shares?`${position.shares.toLocaleString("zh-TW")} 股`:"股數未填"}${pnl===null?"":`｜目前 ${signedMoney(pnl)}（${signedPercent(pct)}）`}${split}`)}else setText("decisionPositionNote",`未在持股清單：依目前股價與市場結構計算${split}；觀察清單不套用個人持股資料。`);
  setText("decisionTrialPrice",targetZoneText(d.trial));setText("decisionEntryPrice",targetZoneText(d.entry));setText("decisionTrimPrice",targetZoneText(d.trim));setText("decisionExitPrice",targetZoneText(d.exit));
  let trimNote=d.trimNote,exitNote=d.exitNote;
  if(position?.shares){
    if(["mixed","long-swing"].includes(profile?.key)){const baseQty=Math.round(position.shares*profile.basePct/100),tacticalQty=Math.max(0,position.shares-baseQty),firstTrim=Math.max(1,Math.floor(tacticalQty*.5));trimNote+=`｜${profile.key==="long-swing"?"波段倉":"機動倉"}約 ${tacticalQty.toLocaleString("zh-TW")} 股，先減約 ${firstTrim.toLocaleString("zh-TW")} 股`;exitNote+=`｜${profile.key==="long-swing"?"長期核心":"底倉"}約 ${baseQty.toLocaleString("zh-TW")} 股，不因一般短期震盪強制賣出`}
    else if(position.shares>=4){const trimQty=Math.max(1,Math.floor(position.shares*.25)),remain=Math.max(0,position.shares-trimQty);trimNote+=`｜參考 25% = ${trimQty.toLocaleString("zh-TW")} 股`;exitNote+=`｜其餘 ${remain.toLocaleString("zh-TW")} 股`}
    else{trimNote+="｜股數較少，不強制切 25%";exitNote+=`｜共 ${position.shares.toLocaleString("zh-TW")} 股`}
  }
  const trimMid=d.trim?(d.trim[0]+d.trim[1])/2:null,exitMid=d.exit?(d.exit[0]+d.exit[1])/2:null;
  if(position?.avgCost&&trimMid&&trimMid<position.avgCost)trimNote+="｜此區仍低於你的均價";if(position?.avgCost&&exitMid&&exitMid<position.avgCost)exitNote+="｜此區仍低於你的均價";
  setText("decisionTrialNote",position?`${d.trialNote}；已有持股時視為加碼參考`:d.trialNote);setText("decisionEntryNote",d.entryNote);setText("decisionTrimNote",trimNote);setText("decisionExitNote",exitNote);
  setText("decisionFoot",profile?`${profile.label}：${profile.note}。價格仍由市場結構／估值決定，持股資料只調整報酬與分批股數。`:"價格來自目前玩法的結構與目標區；持股股數只用來換算分批數量，不改變市場目標價。");
}
function renderTradeOutputs(){const expected=renderExpectedUpside(latestPlayStyleResult);if(expected)renderDecision(latestPlayStyleResult,expected)}

async function loadTechnical(data){
  const code=data?.code||data?.symbol||"",market=data?.market||data?.marketLabel||"";
  resetFiveStage("讀取技術資料中…");
  try{
    const [t,hraw]=await Promise.all([technical(code,market),history3Y(code,market).catch(e=>{console.warn("三年歷史資料更新失敗",e);return null})]);
    const curCode=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");if(curCode&&String(code)!==curCode)return;
    latestHistory3Y=hraw?markSystemStress(hraw):null;const a=t.analysis||{};
    setText("technicalSource",`Yahoo｜${t.updatedAt||"--"}${latestHistory3Y?.history?.length?`｜3年 ${latestHistory3Y.history.length}筆`:""}`);
    techSet("techState",a.overall?.state||"--",a.overall?.tone); setText("techScore",a.overall?.score??"--"); setText("techHeadline",a.overall?.headline||"--");
    const overviewState=a.overall?.state||"--", overviewScore=a.overall?.score;
    setText("overviewTechnicalState",`${overviewState}${Number.isFinite(Number(overviewScore))?` ${overviewScore}分`:""}`);
    setText("overviewTechnicalNote",a.overall?.headline||a.ma?.conclusion||"--");
    techSet("techMaState",a.ma?.state||t.ma?.order||"--",a.ma?.tone); setText("techMaConclusion",a.ma?.conclusion||"--");
    technicalMetrics("techMaValues",[["5MA",technicalFmt(t.ma?.ma5)],["10MA",technicalFmt(t.ma?.ma10)],["20MA",technicalFmt(t.ma?.ma20)],["60MA",technicalFmt(t.ma?.ma60)]]);
    techSet("techBollState",a.bollinger?.state||"--",a.bollinger?.tone); setText("techBollConclusion",a.bollinger?.conclusion||"--"); technicalMetrics("techBoll",[["上軌",technicalFmt(t.bollinger?.upper)],["中軌",technicalFmt(t.bollinger?.middle)],["下軌",technicalFmt(t.bollinger?.lower)],["帶寬",technicalFmt(t.bollinger?.bandwidth,"%")]]);
    techSet("techVolumeState",a.volume?.state||"--",a.volume?.tone); setText("techVolumeConclusion",a.volume?.conclusion||"--"); technicalMetrics("techVolume",[["成交量",technicalVolumeFmt(t.volume?.current)],["5日均量",technicalVolumeFmt(t.volume?.avg5)],["20日均量",technicalVolumeFmt(t.volume?.avg20)],["量比",technicalFmt(t.volume?.ratio20)]]);
    const biasState=a.bias?.state||"--", biasTone=biasState.includes("超跌")?"cyan":biasState.includes("偏低")?"info":a.bias?.tone; techSet("techBiasState",biasState,biasTone); setText("techBiasConclusion",a.bias?.conclusion||"--"); technicalMetrics("techBias",[["5MA",technicalFmt(t.bias?.ma5,"%")],["10MA",technicalFmt(t.bias?.ma10,"%")],["20MA",technicalFmt(t.bias?.ma20,"%")],["60MA",technicalFmt(t.bias?.ma60,"%")]]);
    techSet("techTrendState",a.trend?.state||"--",a.trend?.tone); setText("techTrendConclusion",a.trend?.conclusion||"--"); technicalMetrics("techTrend",[["60日高",technicalFmt(t.trend?.high60)],["60日低",technicalFmt(t.trend?.low60)],["距高",technicalFmt(t.trend?.fromHigh60Pct,"%")],["距低",technicalFmt(t.trend?.fromLow60Pct,"%")]]);
    techSet("techMomentumState",a.momentum?.state||"--",a.momentum?.tone); setText("techMomentumConclusion",a.momentum?.conclusion||"--"); technicalMetrics("techMomentum",[["RSI",technicalFmt(t.momentum?.rsi14)],["MACD",technicalFmt(t.momentum?.macd)],["Signal",technicalFmt(t.momentum?.signal)],["Histogram",technicalFmt(t.momentum?.histogram)]]);
    const keyPoints=[a.ma?.conclusion,a.bollinger?.conclusion,a.volume?.conclusion,a.trend?.conclusion,a.momentum?.conclusion].filter(Boolean);
    const keyHost=$("techKeyPoints"); if(keyHost)keyHost.innerHTML=keyPoints.slice(0,5).map(x=>`<li>${String(x)}</li>`).join("");
    const overallBox=$("techOverview"); if(overallBox){overallBox.classList.remove("tone-good","tone-watch","tone-bad","tone-neutral");overallBox.classList.add(`tone-${a.overall?.tone||"neutral"}`);}
    setText("techSummary",a.overall?.summary||"--");
    renderFiveStage(t,Number(data?.last??data?.price??data?.regularMarketPrice));
  }catch(e){console.warn("技術資料更新失敗",e);setText("technicalSource","Yahoo｜取得失敗");resetFiveStage("技術資料取得失敗")}
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
  // Only prices calculated by StockZone (PE/PB/composite fair price) are truncated.
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
  ["valuationCompositeFair","valuationCompositeGap","valuationPeFair","valuationPeFairGap","valuationPbFair","valuationPbFairGap","valuationSummaryBps"].forEach(id=>setText(id,"--"));
  ["valuationCurrentPe","valuationPeerPe","valuationPeGap","valuationBookValue","valuationCurrentPb","valuationPeerPb","valuationPbGap"].forEach(id=>setText(id,"--"));
  setText("overviewCompositeFair","--");latestValuationScenario=null;latestValuationData=null;setText("overviewValuationScenario","--");setText("overviewValuationScenarioNote","估值情境判讀");
  const qhost=$("valuationQuarterGrid");if(qhost)qhost.innerHTML="";setText("valuationTtmEps","--");
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
  const T=currentTargetPrice(),r=scenarioClassify(x.P,x.O,x.B,x.F,T),card=$("valuationScenario");
  card?.classList.remove("scenario-tone-watch","scenario-tone-danger");if(r.tone==="watch")card?.classList.add("scenario-tone-watch");if(r.tone==="danger")card?.classList.add("scenario-tone-danger");
  setText("valuationScenarioSummary",`估值可信度：${r.confidence}｜${r.summary}${r.hasTarget===false?" 無券商目標價，本次以內部估值判讀。":""}`);
  document.querySelectorAll("#valuationScenario .scenario-cell").forEach(el=>el.classList.toggle("is-active",Number(el.dataset.scenario)===r.n));
  const active=document.querySelector(`#valuationScenario .scenario-cell[data-scenario="${r.n}"]`);if(active){const w=active.querySelector(".scenario-weight");if(w)w.textContent=`估值 ${r.valuationWeight}%｜目標價 ${r.targetWeight}%${r.hasTarget===false?"（無資料）":""}`;}
  setText("overviewValuationScenario",r.state);setText("overviewValuationScenarioNote",`${r.consensus}｜可信度${r.confidence}`);renderPlayStyle();
}
function renderValuation(v){
  latestValuationData=v||null;
  const profitable=v.profitable===true || Number(v.ttm)>0;
  const usePs=!profitable;
  const operatingPremium=usePs?v.psPremiumPct:v.pePremiumPct;
  const operatingPeer=usePs?v.peerPs:v.peerPe;
  setText("valuationOperatingFairLabel",usePs?"PS 合理股價":"PE 合理股價");
  setText("valuationOperatingIcon",usePs?"PS":"PE");
  setText("valuationOperatingTitle",usePs?"股價營收比":"本益比");
  const operatingInfo=document.querySelector('#valuation .valuation-section-title [data-formula="pedef"], #valuation .valuation-section-title [data-formula="psdef"]'); if(operatingInfo){operatingInfo.dataset.formula=usePs?"psdef":"pedef"; operatingInfo.setAttribute("aria-label",usePs?"查看股價營收比定義":"查看本益比定義");}
  setText("valuationOperatingCurrentLabel",usePs?"目前 PS":"目前本益比");
  setText("valuationOperatingPeerLabel",usePs?"同業 PS 中位數":"同業平均本益比");
  const last=valuationNum(v.last), ttm=valuationNum(v.ttm), bps=valuationNum(v.bookValue), peerPb=valuationNum(v.peerPb);
  const peFair=(ttm!==null&&ttm>0&&valuationNum(v.peerPe)>0)?ttm*valuationNum(v.peerPe):null;
  const psFair=(valuationNum(v.salesPerShare)>0&&valuationNum(v.peerPs)>0)?valuationNum(v.salesPerShare)*valuationNum(v.peerPs):null;
  const operatingFair=usePs?psFair:peFair;
  const pbFair=(bps!==null&&bps>0&&peerPb!==null&&peerPb>0)?bps*peerPb:null;
  const fairVals=[operatingFair,pbFair].filter(x=>Number.isFinite(x)&&x>0);
  const compositeFair=fairVals.length?fairVals.reduce((a,b)=>a+b,0)/fairVals.length:null;
  latestValuationScenario={P:last,O:operatingFair,B:pbFair,F:compositeFair,usePs};renderValuationScenario();
  const fairGap=x=>(last!==null&&last>0&&Number.isFinite(x))?(x/last-1)*100:null;
  const renderFair=(valueId,gapId,value)=>{const el=$(gapId),gap=fairGap(value);setText(valueId,Number.isFinite(value)?valuationFmt(value,""):"資料不足");if(!el)return;el.classList.remove("risk-safe","risk-watch","risk-danger","risk-neutral");if(gap===null){el.textContent="--";el.classList.add("risk-neutral");return;}el.textContent=`較現價 ${gap>=0?"+":"-"}${valuationPercent(Math.abs(gap))}`;el.classList.add(`risk-${valuationRiskByCurrentFair(last,value)}`);};
  renderFair("valuationPeFair","valuationPeFairGap",operatingFair);renderFair("valuationPbFair","valuationPbFairGap",pbFair);renderFair("valuationCompositeFair","valuationCompositeGap",compositeFair);
  setText("overviewCompositeFair",Number.isFinite(compositeFair)?valuationFmt(compositeFair):"--");setText("valuationSummaryBps",bps!==null?valuationMetric(bps,""):"資料不足");
  setText("valuationCurrentPe",usePs?valuationMetric(v.currentPs," 倍","資料不足"):valuationMetric(v.currentPe," 倍","資料不足"));
  setText("valuationPeerPe",usePs?valuationMetric(v.peerPs," 倍","資料不足"):valuationMetric(v.peerPe," 倍","資料不足"));
  setText("valuationPeGap",Number.isFinite(Number(operatingPremium))?`${Number(operatingPremium)>=0?"+":"-"}${valuationPercent(Math.abs(Number(operatingPremium)))}`:"不適用");
  setText("valuationBookValue",valuationMetric(v.bookValue," 元","資料不足"));setText("valuationCurrentPb",valuationMetric(v.currentPb," 倍","資料不足"));setText("valuationPeerPb",valuationMetric(v.peerPb," 倍","資料不足"));setText("valuationPbGap",Number.isFinite(Number(v.pbPremiumPct))?`${Number(v.pbPremiumPct)>=0?"+":"-"}${valuationPercent(Math.abs(Number(v.pbPremiumPct)))}`:"資料不足");
  const peGap=$("valuationPeGap"),pbGap=$("valuationPbGap");
  const applyPeerRisk=(el,premium)=>{if(!el)return;el.classList.remove("valuation-premium-high","valuation-premium-low","risk-safe","risk-watch","risk-danger","risk-neutral","valuation-not-applicable");el.removeAttribute("data-tag");if(!Number.isFinite(Number(premium))){if(el.textContent.includes("不適用"))el.classList.add("valuation-not-applicable");return;}const risk=valuationRiskByPeer(premium);el.classList.add(`risk-${risk}`);el.dataset.tag=risk==="safe"?"安全":risk==="watch"?"注意":"危險";};
  applyPeerRisk(peGap,operatingPremium);applyPeerRisk(pbGap,v.pbPremiumPct);
  const statusRisk=valuationRiskByCurrentFair(last,compositeFair);let statusLabel=statusRisk==="safe"?"相對低估":statusRisk==="watch"?"接近合理":"相對高估";if(compositeFair===null)statusLabel="資料不足";
  setText("valuationStatus",statusLabel);setText("valuationStatusDetail",usePs?"虧損公司以 PS 取代 PE，與 PB 共同估值":(v.statusDetail||"--"));
  const statusEl=$("valuationStatus");if(statusEl){statusEl.classList.remove("risk-text-safe","risk-text-watch","risk-text-danger","risk-text-neutral","valuation-not-applicable");statusEl.classList.add(`risk-text-${compositeFair===null?"neutral":statusRisk}`);if(statusEl.textContent.includes("不適用"))statusEl.classList.add("valuation-not-applicable");}
  setText("valuationMethod",usePs?"Yahoo 營收／股數計算 PS；同業 PS 採中位數；再與 PB 合併":"Yahoo PE 同業比較＋PB 同業比較");
  setText("valuationNote",usePs?"近四季 EPS 為負時，以 PS（股價營收比）補位 PE；PS 合理價與 PB 合理價共同形成綜合合理價。":"估值用來判斷相對昂貴程度，不直接當作買賣價。");
  setText("valuationTtmEps",ttm!==null?valuationEpsFmt(ttm):"資料不足");
  const host=$("valuationQuarterGrid");if(host){const q=Array.isArray(v.latest4)?v.latest4:[];host.innerHTML=q.slice(0,4).map((x,i)=>`<div class="valuation-quarter-chip${i===0?" is-latest":""}"><span>${String(x.period||"")}</span><b>${valuationEpsFmt(x.eps)}</b>${i===0?'<em>最新</em>':''}</div>`).join("");}
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

function renderQuoteFields(x){
  const last=Number(x?.last ?? x?.price ?? x?.regularMarketPrice),change=Number(x?.change ?? x?.regularMarketChange),pct=Number(x?.changePct ?? x?.changePercent ?? x?.regularMarketChangePercent);
  setText("currentPrice",fmt(last));setText("metricPrice",fmt(last));setText("decisionPrice",fmt(last));
  const ch=Number.isFinite(change)?`${change>0?"+":""}${fmt(change)}${Number.isFinite(pct)?`(${pct>0?"+":""}${fmt(pct)}%)`:""}`:"—";
  setText("priceChange",ch);setText("metricChange",ch);setText("updateTime","剛剛更新");if($("updateRow"))$("updateRow").hidden=false;
  const cls=change>0?"up":change<0?"down":"";["currentPrice","priceChange","metricChange"].forEach(id=>{const el=$(id);if(el)el.className=cls});
}
function patchCurrentQuote(x){
  const incoming=String(x?.code||String(x?.symbol||"").split(".")[0]||""),current=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");
  if(!currentStock||!incoming||incoming!==current)return false;
  currentStock={...currentStock,...x,name:currentStock.name||x.name,shortName:currentStock.shortName||x.shortName,market:currentStock.market||x.market};renderQuoteFields(currentStock);updateListButtons();renderTradeOutputs();if(["swing","mixed"].includes(latestPlayStyleResult?.key))renderSwingWave(latestPlayStyleResult);return true;
}
function renderStock(x){
  currentStock=x;latestHistory3Y=null;resetPlayStyle("讀取分析資料中…");
  setText("stockName",shortStockName(x.name||x.shortName)||"—");
  setText("stockCodeLabel",`${x.code||x.symbol||"—"} | ${x.market||"台股"}`);
  setText("marketLabel","");
  renderQuoteFields(x);updateListButtons();beginNews();rememberStockMeta(x);
}
let activeSearchSeq=0;
async function search(){
  const input=$("stockCode"),btn=$("searchButton"),q=input?.value.trim();
  if(!q){setStatus("請輸入股票名稱或代碼",true);return}
  const seq=++activeSearchSeq;btn.disabled=true;setStatus("搜尋股票…");
  try{
    // v2.5.7.3：主畫面只等待行情。股票身分、目標價、新聞改背景補齊，避免第一次搜尋被 20～30 秒的外部來源卡住。
    let meta=localStockMeta(q)||cachedStockMeta(q);
    const metaPromise=meta?Promise.resolve(meta):stockMeta(q).catch(e=>{console.warn("股票身分背景補查失敗",e);return null});
    let data=await quote(meta?.code||q,meta?.market||"");
    if(seq!==activeSearchSeq)return;
    if(!meta){
      // 只給身分補查很短的機會；逾時就先顯示行情，之後再無感更新中文名／市場別。
      meta=await Promise.race([metaPromise,new Promise(r=>setTimeout(()=>r(null),450))]);
    }
    if(!meta)meta=localStockMeta(data?.code||data?.symbol)||cachedStockMeta(data?.code||data?.symbol);
    if(!meta&&/[\u3400-\u9fff]/.test(q)&&data)meta={code:data.code||String(data.symbol||"").split(".")[0],name:q,market:data.market||data.marketLabel||"",symbol:data.symbol};
    data=mergeStockMeta(data,meta);renderStock(data);setView("overview");
    loadValuation(data);loadTechnical(data);loadDisposal(data);beginTargetSearch(data.code||data.symbol||q);
    setStatus(`搜尋成功：${shortStockName(data.name)||data.code||q}`);btn.disabled=false;

    const code=String(data.code||String(data.symbol||"").split(".")[0]||q),name=data.name||data.shortName||"";
    // 身分資料晚到時，只修正標題／市場，不重跑整頁。
    void metaPromise.then(m=>{if(!m||seq!==activeSearchSeq)return;const curCode=String(currentStock?.code||String(currentStock?.symbol||"").split(".")[0]||"");if(curCode&&String(m.code||"")!==curCode)return;currentStock=mergeStockMeta(currentStock,m);rememberStockMeta(currentStock);setText("stockName",shortStockName(currentStock.name||currentStock.shortName)||"—");setText("stockCodeLabel",`${currentStock.code||currentStock.symbol||"—"} | ${currentStock.market||"台股"}`)});
    // 慢來源並行刷新；舊快取已先顯示，不再阻塞搜尋按鈕與主畫面。
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
    const d=await quote(code,base.market||""),last=Number(d.last??d.price??d.regularMarketPrice);
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

function setView(view){
  const screeningViews=new Set(["screening","fundflow","featured","simulation"]),management=view==="management";
  const mode=screeningViews.has(view)?"screening":management?"management":"analysis";
  document.body.classList.remove("mode-analysis","mode-screening","mode-management");
  document.body.classList.add(`mode-${mode}`);
  if(view==="screening")view="fundflow";
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

document.querySelectorAll(".settings-open").forEach(btn=>btn.addEventListener("click",()=>{
  $("settingsModal")?.classList.remove("hidden");
  $("sidebar")?.classList.remove("open"); $("overlay")?.classList.remove("show");
}));
$("closeSettings")?.addEventListener("click",()=>$("settingsModal")?.classList.add("hidden"));
$("settingsModal")?.addEventListener("click",e=>{if(e.target===$("settingsModal"))$("settingsModal").classList.add("hidden")});


// v2.5.1.11 valuation formula and definition info
(function(){
 const formulas={
  pe:{title:"PE／PS 合理價",text:"獲利公司：近四季 EPS × 同業平均 PE；近四季虧損：每股營收 × 同業 PS 中位數"},
  pb:{title:"PB 合理價",text:"每股淨值（BPS）× 同業平均 PB"},
  composite:{title:"綜合合理價",text:"獲利公司使用 PE 合理價；虧損公司以 PS 合理價補位，再與 PB 合理價各 50% 合併。"},
  epsdef:{title:"EPS 獲利能力",text:"EPS 是每股盈餘，代表公司每一股普通股能分配到多少獲利；數值越高，代表每股獲利能力越強。"},
  pedef:{title:"本益比",text:"本益比＝股價 ÷ 每股盈餘（EPS），代表市場願意用多少倍的價格購買公司目前的每股獲利。"},
  psdef:{title:"股價營收比",text:"股價營收比（PS）＝股價 ÷ 每股營收，代表市場願意用多少倍的價格購買公司每股所創造的營收；當近四季 EPS 為負、PE 不適用時，用 PS 作為營運估值的替代指標。"},
  pbdef:{title:"股價淨值比",text:"股價淨值比＝股價 ÷ 每股淨值（BPS），代表股價相對公司每股帳面淨資產價值的倍數。"},
  scenariodef:{title:"九情境代號說明",text:"P＝現價；O＝營運合理價（獲利公司使用 PE 合理價，虧損公司使用 PS 合理價）；B＝PB 合理價；F＝綜合合理價；T＝券商目標價；≈＝兩者接近（目前以差距 ±5% 判定）；＜、＞代表價格大小關係。沒有券商目標價時，T 不納入該次判定，目標價權重也不扣分。"}
 };
 const pop=$("valuationFormulaPopover"), title=$("valuationFormulaTitle"), text=$("valuationFormulaText");
 document.addEventListener("click",e=>{
  const btn=e.target.closest?.(".formula-info");
  if(btn&&pop){const f=formulas[btn.dataset.formula];if(f){title.textContent=f.title;text.textContent=f.text;pop.hidden=false;}return;}
  if(e.target.closest?.(".formula-popover-close")){if(pop)pop.hidden=true;}
 });
})();
