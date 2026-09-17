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
async function yahooQuote(query){
  async function once(timeoutMs){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      return await readJson(
        await fetch(`/api/quote?q=${encodeURIComponent(query)}`,{
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
  const yahoo=await yahooQuote(query);
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

// 建議玩法 v3：先做「資格判斷」，再比較短期／波段。
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

// v2.5.7.1 — 波段分析 v2：只在「波段玩法」啟用。
// 保留第一波 X 延伸，同時辨識第一波後的回測低點，讓第二波才發現標的時有可用的進場／防守參考。
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
function calculateSwingWave(r,t){
  const rows=(r?.path?.rows||stageHistory(t)).slice(-120),price=stageNum(r?.price);
  if(rows.length<25||price===null)return {valid:false,reason:"歷史K線不足"};
  let chosen=null;

  // 先找最近一個「已完成第一波且出現回測」的推進段。
  for(let hi=rows.length-4;hi>=12;hi--){
    if(!swingIsLocalHigh(rows,hi,2))continue;
    const high=swingHigh(rows[hi]);if(high===null)continue;
    const lowInfo=swingRangeMin(rows,Math.max(0,hi-35),hi-2,swingLow);
    const low=lowInfo.value;if(low===null||lowInfo.index<0)continue;
    const gain=stagePct(high,low);
    if(gain===null||gain<6||gain>120)continue;
    const afterInfo=swingRangeMin(rows,hi+1,rows.length,swingLow);
    const afterLow=afterInfo.value;
    const pullback=afterLow===null?null:stagePct(afterLow,high);
    if(pullback!==null&&pullback<=-2.5){
      chosen={low,lowIndex:lowInfo.index,high,highIndex:hi,gain,pullback,completed:true,pullbackLow:afterLow,pullbackIndex:afterInfo.index};
      break;
    }
  }

  // 若第一波仍在延伸，使用最近 35 日的低點 -> 最近 20 日高點作為暫定第一波。
  if(!chosen){
    const hiInfo=swingRangeMax(rows,Math.max(8,rows.length-20),rows.length,swingHigh);
    if(hiInfo.index>5){
      const lowInfo=swingRangeMin(rows,Math.max(0,hiInfo.index-35),hiInfo.index-2,swingLow);
      const gain=lowInfo.value!==null&&hiInfo.value!==null?stagePct(hiInfo.value,lowInfo.value):null;
      if(gain!==null&&gain>=6&&gain<=120){
        chosen={low:lowInfo.value,lowIndex:lowInfo.index,high:hiInfo.value,highIndex:hiInfo.index,gain,pullback:null,completed:false};
      }
    }
  }
  if(!chosen)return {valid:false,reason:"近期沒有足夠明確的推進波"};

  const amplitude=chosen.high-chosen.low;
  if(!(amplitude>0))return {valid:false,reason:"波段振幅不足"};
  const target=m=>chosen.low+amplitude*m;
  const currentMultiple=(price-chosen.low)/amplitude;
  let state="第一波形成中",phase="第一波形成中",nextTarget=chosen.high;
  if(chosen.completed){
    if(price<chosen.high*.985){
      state=currentMultiple<.7?"深度回測":"第一波後回測";
      phase="第一波後回測";
      nextTarget=chosen.high;
    }else if(price<target(1.5)){
      state="第二波啟動／前高確認";phase="第二波啟動";nextTarget=target(1.5);
    }else if(price<target(2)){
      state="1.5X～2X 延伸";phase="第二波延伸";nextTarget=target(2);
    }else if(price<target(2.5)){
      state="2X～2.5X 延伸";phase="第二波延伸";nextTarget=target(2.5);
    }else{state="延伸過熱區";phase="高檔延伸";nextTarget=null}
  }
  let quality=50;
  if(chosen.gain>=10&&chosen.gain<=60)quality+=12;
  else if(chosen.gain>=6)quality+=6;
  if(chosen.pullback!==null&&chosen.pullback<=-3&&chosen.pullback>=-18)quality+=10;
  if((r?.path?.ma20Slope10??-99)>.3)quality+=6;
  if((r?.path?.ma60Slope20??-99)>0)quality+=6;
  if(currentMultiple>=.65&&currentMultiple<=1.6)quality+=10;
  if(currentMultiple>2.5)quality-=18;
  if(price<chosen.low*.98)quality-=30;
  quality=Math.round(playClamp(quality));

  return{
    valid:true,state,phase,quality,currentMultiple,nextTarget,
    baseLow:chosen.low,firstWave:chosen.high,pullbackLow:chosen.pullbackLow??null,
    ext15:target(1.5),ext20:target(2),ext25:target(2.5),
    gainPct:chosen.gain,pullbackPct:chosen.pullback,
    completed:chosen.completed,
    baseDate:swingDate(rows[chosen.lowIndex]),waveDate:swingDate(rows[chosen.highIndex]),
    pullbackDate:chosen.pullbackIndex>=0?swingDate(rows[chosen.pullbackIndex]):"",
    reason:chosen.completed?"第一波完成後，以回測低點判斷第二波位置；延伸目標仍用第一波振幅估算。":"第一波尚在形成，延伸位會隨近期高點更新。"
  };
}

function calculatePlayStyle(r,t){
  if(!r)return null;
  const stage=r.stage,sub=r.substate||"",score=stageNum(t?.analysis?.overall?.score)??50,rsi=stageNum(t?.momentum?.rsi14),ratio20=stageNum(t?.volume?.ratio20),vr=playValuationResult();
  const breakout=playBreakoutState(r,t),path=r.path||{},crosses=playMaCrossCount(path.rows||[],20,20),swingWave=calculateSwingWave(r,t);
  const rangeNoise=!!(r.flags?.tangled&&crosses>=3&&Math.abs(path.ret20??0)<=10);
  const overheated=stage===5||r.flags?.extremeHeat||(rsi!==null&&rsi>=80)||((r.bias20??0)>=18&&(rsi??0)>=74);
  const falseBreakout=breakout.fresh&&breakout.failed;
  const breakoutPending=breakout.fresh&&!breakout.confirmed&&!breakout.failed;
  const ma20Up=(path.ma20Slope10??-99)>.3,ma60Up=(path.ma60Slope20??-99)>0;
  const healthyTrend=(stage>=3&&stage<=4)&&(r.flags?.above60!==false)&&(ma20Up||ma60Up)&&!rangeNoise;
  const momentumBurst=!rangeNoise&&!overheated&&score>=68&&(rsi===null||(rsi>=52&&rsi<=76))&&(ratio20===null||ratio20>=1.05)&&(path.ret20??0)>=6;

  // 資格制：短期必須有「新鮮突破已確認」或非常明確的短線加速；波段必須有中期趨勢，箱型未突破不得硬判波段。
  let shortEligible=!overheated&&!falseBreakout&&stage>=2&&stage<=4&&((breakout.fresh&&breakout.confirmed&&breakout.age<=4)||momentumBurst);
  let swingEligible=!overheated&&!falseBreakout&&stage>=2&&stage<=4&&(healthyTrend||(stage===2&&breakout.fresh&&breakout.confirmed&&ma20Up));
  if(rangeNoise&&!breakout.confirmed){shortEligible=false;swingEligible=false}
  if(breakoutPending){shortEligible=false;if(stage===2||rangeNoise)swingEligible=false}

  let short=38,swing=40;
  short+=playClamp((score-50)*.28,-12,14);swing+=playClamp((score-50)*.18,-9,10);
  if(breakout.fresh){short+=breakout.confirmed?24:-5;swing+=breakout.confirmed?8:0;if((breakout.age??9)<=2)short+=6;if((breakout.volumeRatio??ratio20??0)>=1.3)short+=5}
  if(momentumBurst)short+=10;
  if(stage===4&&!sub.includes("回測"))short+=5;
  if(rsi!==null){if(rsi>=55&&rsi<=72)short+=5;if(rsi>=78)short-=12;if(rsi<40)short-=6}
  if(healthyTrend)swing+=20;
  if(stage===3)swing+=6;if(stage===4)swing+=8;
  if(sub.includes("回測")&&!rangeNoise)swing+=5;
  if(ma20Up)swing+=5;if(ma60Up)swing+=4;
  // 波段分析只做低權重修正；先補功能，之後再用回測統一調參。
  if(swingWave?.valid)swing+=Math.round(stageClamp((swingWave.quality-50)*.12,-4,6));
  if(rangeNoise){short-=22;swing-=24}
  if(falseBreakout){short-=35;swing-=25}
  if(overheated){short-=30;swing-=20}
  short=Math.round(playClamp(short));swing=Math.round(playClamp(swing));
  const scores={short,swing,long:null},eligible={short:shortEligible,swing:swingEligible,long:false};

  if(stage===1)return {key:"observe",period:"先觀察",action:sub.includes("築底")?"築底修復，等突破確認":"等待轉強確認",reason:`目前為第1階段「${r.name}｜${sub}」，先等中期結構轉強。`,scores,eligible,vr,swingWave};
  if(overheated)return {key:"observe",period:"先觀察",action:"過熱，等回測再評估",reason:"短線過熱訊號共振，先不追價。",scores,eligible,vr,swingWave};
  if(falseBreakout)return {key:"observe",period:"先觀察",action:"疑似假突破，等重新站回突破位",reason:"近期突破後未能守住突破區，先過濾假突破。",scores,eligible,vr,swingWave};
  if(rangeNoise&&!breakout.confirmed)return {key:"observe",period:"先觀察",action:"箱型反覆，等有效突破",reason:`近20日反覆穿越MA20 ${crosses} 次，均線仍糾結，先避免玩法來回切換。`,scores,eligible,vr,swingWave};
  if(breakoutPending)return {key:"observe",period:"先觀察",action:"突破待確認，先看1～2日",reason:"剛突破但尚未形成有效守穩，避免單日假突破。",scores,eligible,vr,swingWave};

  let key="observe";
  if(shortEligible||swingEligible){
    if(shortEligible&&swingEligible)key=short>=swing?"short":"swing";else key=shortEligible?"short":"swing";
  }
  const period=key==="short"?"短期｜3～5交易日":key==="swing"?"波段｜2～4週":"先觀察";
  let action="等待位置或動能改善",reason=`第${stage}階段「${r.name}｜${sub}」目前尚未通過短期或波段資格。`;
  if(key==="short"){
    action=breakout.fresh?"突破確認，短線3～5日":"短線動能加速，嚴守轉弱";
    reason=`近期動能與突破條件通過短期資格；短期適配 ${short} 分、波段 ${swing} 分。`;
  }else if(key==="swing"){
    action=sub.includes("回測")?"回測確認，守中期趨勢":"趨勢完整，採2～4週波段";
    reason=`MA20/60與歷史路徑通過波段資格；短期適配 ${short} 分、波段 ${swing} 分。`;
  }
  return {key,period,action,reason,scores,eligible,vr,swingWave,diagnostics:{breakout,rangeNoise,crosses,falseBreakout,breakoutPending,healthyTrend,momentumBurst}};
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
function drawSwingWave(w,price){
  const svg=$("playSwingSvg");if(!svg)return;
  svg.replaceChildren();
  if(!w?.valid)return;
  const pull=Number.isFinite(w.pullbackLow)?w.pullbackLow:Math.min(price,w.firstWave*.9);
  const vals=[w.baseLow,w.firstWave,pull,price,w.firstWave,w.ext15,w.ext20,w.ext25].filter(Number.isFinite);
  const lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max((hi-lo)*.14,1),vmin=lo-pad,vmax=hi+pad;
  const y=v=>305-((v-vmin)/(vmax-vmin))*245;
  const xs=[68,215,342,430,510,605,685,758];
  const pts=[w.baseLow,w.firstWave,pull,price,w.firstWave,w.ext15,w.ext20,w.ext25].map((v,i)=>({x:xs[i],y:y(v),v}));
  for(let i=0;i<4;i++){
    const yy=70+i*68;
    svg.append(swingWaveSvg("line",{x1:45,y1:yy,x2:775,y2:yy,class:"swing-wave-grid"}));
    const val=vmax-(vmax-vmin)*((yy-60)/245);
    svg.append(swingWaveSvg("text",{x:38,y:yy+3,class:"swing-wave-axis","text-anchor":"end"},swingWaveFmt(val)));
  }
  svg.append(swingWaveSvg("text",{x:16,y:48,class:"swing-wave-axis"},"股價"));
  svg.append(swingWaveSvg("text",{x:742,y:330,class:"swing-wave-axis"},"時間 →"));
  const d1=`M ${pts[0].x} ${pts[0].y} C 120 ${pts[0].y-18}, 160 ${pts[1].y+28}, ${pts[1].x} ${pts[1].y} S 286 ${pts[2].y-8}, ${pts[2].x} ${pts[2].y} S 392 ${pts[3].y+6}, ${pts[3].x} ${pts[3].y}`;
  svg.append(swingWaveSvg("path",{d:d1,class:"swing-wave-path-actual"}));
  const d2=`M ${pts[3].x} ${pts[3].y} C 462 ${pts[3].y+8}, 480 ${pts[4].y+8}, ${pts[4].x} ${pts[4].y} S 563 ${pts[5].y+12}, ${pts[5].x} ${pts[5].y} S 650 ${pts[6].y+10}, ${pts[6].x} ${pts[6].y} S 730 ${pts[7].y+8}, ${pts[7].x} ${pts[7].y}`;
  svg.append(swingWaveSvg("path",{d:d2,class:"swing-wave-path-proj"}));
  svg.append(swingWaveSvg("line",{x1:pts[1].x+12,y1:pts[1].y,x2:pts[4].x-12,y2:pts[4].y,class:"swing-wave-guide"}));
  const colors=["#35e5e7","#c46cff","#63a9ff","#34dbe6","#c46cff","#c46cff","#c46cff","#c46cff"];
  pts.forEach((p,i)=>svg.append(swingWaveSvg("circle",{cx:p.x,cy:p.y,r:i===3?7:6,fill:colors[i],class:"swing-wave-dot"})));
  swingWaveLabel(svg,pts[0].x,Math.min(286,pts[0].y+31),"起漲低點",swingWaveFmt(w.baseLow),"#35e5e7");
  swingWaveLabel(svg,pts[1].x,Math.max(34,pts[1].y-38),"第一波高點",swingWaveFmt(w.firstWave),"#c46cff");
  swingWaveLabel(svg,pts[2].x,Math.min(292,pts[2].y+32),"回測低點",swingWaveFmt(pull),"#63a9ff");
  swingWaveLabel(svg,pts[3].x,Math.min(290,pts[3].y+34),"目前位置",swingWaveFmt(price),"#34dbe6","middle",Number.isFinite(w.currentMultiple)?`(${w.currentMultiple.toFixed(2)}X)`:"");
  swingWaveLabel(svg,pts[4].x,Math.max(32,pts[4].y-35),"前高確認",swingWaveFmt(w.firstWave),"#c46cff");
  swingWaveLabel(svg,pts[5].x,Math.max(28,pts[5].y-31),"1.5X",swingWaveFmt(w.ext15),"#c46cff");
  swingWaveLabel(svg,pts[6].x,Math.max(28,pts[6].y-31),"2X",swingWaveFmt(w.ext20),"#c46cff");
  swingWaveLabel(svg,pts[7].x,Math.max(28,pts[7].y-31),"2.5X",swingWaveFmt(w.ext25),"#c46cff");
}
function resetSwingWave(){
  const box=$("playSwingAnalysis");if(box)box.hidden=true;
  const svg=$("playSwingSvg");if(svg)svg.replaceChildren();
  const legend=$("playSwingLegend");if(legend)legend.replaceChildren();
  setText("playSwingState","--");setText("playSwingGoal","第一目標：--");setText("playSwingNote","只在系統主玩法判定為波段時啟用。");
}
function renderSwingWave(x){
  const box=$("playSwingAnalysis");if(!box)return;
  if(x?.key!=="swing"){resetSwingWave();return}
  box.hidden=false;
  const w=x?.swingWave,price=stageNum(latestFiveStageResult?.price);
  if(!w?.valid||price===null){
    setText("playSwingState","資料不足");setText("playSwingGoal","第一目標：--");setText("playSwingNote",w?.reason||"近期波段結構不足");
    const svg=$("playSwingSvg");if(svg)svg.replaceChildren();return;
  }
  setText("playSwingState",`目前階段：${w.phase||w.state}｜結構 ${w.quality}分`);
  let goal="--";
  if(price<w.firstWave*.985)goal=`先回到前高 ${technicalFmt(w.firstWave)}，突破後看 1.5X / 2X / 2.5X`;
  else if(price<w.ext15)goal=`前高已確認，下一目標 1.5X ${technicalFmt(w.ext15)}`;
  else if(price<w.ext20)goal=`下一目標 2X ${technicalFmt(w.ext20)}`;
  else if(price<w.ext25)goal=`下一目標 2.5X ${technicalFmt(w.ext25)}`;
  else goal="已進入高檔延伸區，留意過熱與轉弱";
  setText("playSwingGoal",`第一目標：${goal}`);
  drawSwingWave(w,price);
  const legend=$("playSwingLegend");
  if(legend){
    const pull=Number.isFinite(w.pullbackLow)?w.pullbackLow:null;
    const items=[
      ["#35e5e7",`起漲低點 <b>${swingWaveFmt(w.baseLow)}</b> — 本波段起點`],
      ["#c46cff",`第一波高點 <b>${swingWaveFmt(w.firstWave)}</b> — 第一波完成`],
      ["#63a9ff",`回測低點 <b>${swingWaveFmt(pull)}</b> — 第二波進場／防守參考`],
      ["#34dbe6",`目前位置 <b>${swingWaveFmt(price)}</b> (${w.currentMultiple.toFixed(2)}X)`],
      ["#c46cff",`前高確認 <b>${swingWaveFmt(w.firstWave)}</b> — 突破後進入第二波`],
      ["#c46cff",`1.5X <b>${swingWaveFmt(w.ext15)}</b> ｜ 2X <b>${swingWaveFmt(w.ext20)}</b> ｜ 2.5X <b>${swingWaveFmt(w.ext25)}</b>`]
    ];
    legend.innerHTML=items.map(([c,t])=>`<div style="color:${c}"><i></i><span style="color:#9fb1c0">${t}</span></div>`).join("");
  }
  const dates=w.baseDate&&w.waveDate?`${w.baseDate} → ${w.waveDate}`:"";
  const pb=w.pullbackDate?`；回測低點 ${w.pullbackDate}`:"";
  setText("playSwingNote",`${dates}${pb}。${w.reason} 延伸位是結構參考，不等同券商目標價。`);
}
function resetPlayStyle(note="搜尋股票後判讀"){
  setText("overviewPlayStyle","--");setText("overviewPlayStyleNote","查看建議策略");setText("playMainPeriod","--");setText("playMainAction",note);setText("playReason","先過濾假突破與箱型反覆，再比較短期／波段；適配分不是勝率。");
  for(const k of ["Short","Swing","Long"]){setText(`play${k}Label`,k==="Long"?"待資料":"--");setText(`play${k}Score`,"--");const bar=$(`play${k}Bar`);if(bar)bar.style.width="0%";}
  document.querySelectorAll("#playStyleCard .playstyle-fit-row").forEach(x=>x.classList.remove("is-main"));
  resetSwingWave();
}
function renderPlayStyle(){
  const x=calculatePlayStyle(latestFiveStageResult,latestTechnicalForPlay);if(!x){resetPlayStyle("等待技術資料");return}
  const map={short:"Short",swing:"Swing",long:"Long"};
  for(const [key,id] of Object.entries(map)){const n=x.scores[key],ok=x.eligible?.[key]!==false;if(n===null){setText(`play${id}Label`,"待資料");setText(`play${id}Score`,"--");const bar=$(`play${id}Bar`);if(bar)bar.style.width="0%";continue}if(!ok){setText(`play${id}Label`,"不符合");setText(`play${id}Score`,"--");const bar=$(`play${id}Bar`);if(bar)bar.style.width="0%";continue}setText(`play${id}Label`,playFitLabel(n));setText(`play${id}Score`,`${n}分`);const bar=$(`play${id}Bar`);if(bar)bar.style.width=`${n}%`;}
  document.querySelectorAll("#playStyleCard .playstyle-fit-row").forEach(el=>el.classList.toggle("is-main",el.dataset.play===x.key));
  setText("playMainPeriod",x.period);setText("playMainAction",x.action);setText("playReason",x.reason);setText("overviewPlayStyle",x.period.replace("｜"," "));setText("overviewPlayStyleNote",x.action);
  renderSwingWave(x);
}

async function loadTechnical(data){
  const code=data?.code||data?.symbol||"",market=data?.market||data?.marketLabel||"";
  resetFiveStage("讀取技術資料中…");
  try{
    const t=await technical(code,market),a=t.analysis||{};
    setText("technicalSource",`Yahoo｜${t.updatedAt||"--"}`);
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
  setText("overviewCompositeFair","--");latestValuationScenario=null;setText("overviewValuationScenario","--");setText("overviewValuationScenarioNote","估值情境判讀");
  const qhost=$("valuationQuarterGrid");if(qhost)qhost.innerHTML="";setText("valuationTtmEps","--");
}
let latestValuationScenario=null;
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

function renderStock(x){
  currentStock=x;resetPlayStyle("讀取分析資料中…");
  const last=Number(x.last ?? x.price ?? x.regularMarketPrice);
  const change=Number(x.change ?? x.regularMarketChange);
  const pct=Number(x.changePct ?? x.changePercent ?? x.regularMarketChangePercent);

  setText("stockName",shortStockName(x.name||x.shortName)||"—");
  setText("stockCodeLabel",`${x.code||x.symbol||"—"} | ${x.market||"台股"}`);
  setText("marketLabel","");
  setText("currentPrice",fmt(last));
  setText("metricPrice",fmt(last));
  setText("decisionPrice",fmt(last));

  const ch=Number.isFinite(change)
    ? `${change>0?"+":""}${fmt(change)}${Number.isFinite(pct)?`(${pct>0?"+":""}${fmt(pct)}%)`:""}`
    : "—";
  setText("priceChange",ch);
  setText("metricChange",ch);
  setText("updateTime","剛剛更新");
  if($("updateRow"))$("updateRow").hidden=false;

  const cls=change>0?"up":change<0?"down":"";
  updateListButtons();
  beginNews();
  ["currentPrice","priceChange","metricChange"].forEach(id=>{
    const el=$(id); if(el) el.className=cls;
  });
}
async function search(){
  const input=$("stockCode");
  const btn=$("searchButton");
  const q=input?.value.trim();
  if(!q){setStatus("請輸入股票名稱或代碼",true);return}

  btn.disabled=true;
  setStatus("搜尋股票…");
  try{
    // 官方主檔優先，但官方任一來源暫時失敗時不可讓整個搜尋功能停擺。
    // 退回既有 Yahoo 查價流程只負責「找得到股票與行情」；若已有官方/本地身分資料，仍由它覆蓋中文名與市場別。
    let meta=null;
    try{meta=await stockMeta(q)}catch(e){console.warn("官方股票主檔暫時不可用，改用既有查價流程",e)}
    let data=await quote(meta?.code||q,meta?.market||"");
    if(!meta&&(data?.code||data?.symbol)){
      try{meta=await stockMeta(data.code||data.symbol)}catch(e){console.warn("股票身分補查失敗，保留查價結果",e)}
    }
    if(!meta)meta=localStockMeta(q)||localStockMeta(data?.code||data?.symbol);
    if(!meta&&/[\u3400-\u9fff]/.test(q)&&data){
      meta={code:data.code||String(data.symbol||"").split(".")[0],name:q,market:data.market||data.marketLabel||"",symbol:data.symbol};
    }
    data=mergeStockMeta(data,meta);
    renderStock(data);
    loadValuation(data);
    loadTechnical(data);
    loadDisposal(data);
    setView("overview");
    beginTargetSearch();
    setStatus("搜尋目標價…");
    try{await loadTargetPlay(data.code||data.symbol||q,data.name||data.shortName||"")}catch(e){console.warn("目標價更新失敗，保留其他搜尋",e)}
    setStatus("搜尋新聞…");
    try{await loadNews(data.code||data.symbol||q,data.name||data.shortName||"")}catch(e){console.warn("新聞更新失敗",e)}
    setStatus(`搜尋成功：${shortStockName(data.name)||data.code||q}`);
  }catch(e){
    console.error(e);
    setStatus(`搜尋失敗：${e.message}`,true);
  }finally{
    btn.disabled=false;
  }
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
function corrStableId(row){
 if(row?._corrId)return row._corrId;
 const latest=targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row||{};
 return [currentStock?.code||"",row?.originalBroker||targetBrokerName(row),String(latest?.date||latest?.publishedAt||latest?.published||"").slice(0,10),String(targetPriceValue(latest)||"")].join("|");
}
function historyCorrId(row,item){
 const broker=row?.originalBroker||targetBrokerName(row),d=String(item?.date||item?.publishedAt||item?.published||"").slice(0,10);
 return `history|${currentStock?.code||""}|${broker}|${d}|${targetPriceValue(item)}`;
}
function applyCorr(rows){
 const c=readCorr();
 return rows.map(row=>{
  const id=corrStableId(row),fix=c[id],r={...row,_corrId:id};
  if(fix?.deleted)return null;
  if(fix?.broker){r.broker=fix.broker;r.brokerType=fix.brokerType||inferredBrokerType(fix.broker,"未知");}
  let h=targetHistoryOf(r).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a));
  h=h.map((x,i)=>{
    const hf=c[historyCorrId(row,x)];
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
 if(!editingTarget)return; const {row,item}=editingTarget,c=readCorr(),id=item?historyCorrId(row,item):corrStableId(row);
 c[id]={...(c[id]||{}),deleted:true};writeCorr(c);targetRowsCache=applyCorr(targetRowsCache);
 closeEdit();renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget());setStatus("已刪除");
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

function beginTargetSearch(){
  targetRowsCache=[];
  renderMainTarget(null);
  const host=$("brokerRows");if(host)host.innerHTML="<p>搜尋目標價…</p>";
  $("targetPlay")?.classList.add("hidden");
}
function renderTargetPlay(payload){
  const code=String(currentStock?.code||currentStock?.symbol||"");
  const fresh=filterBadKnownTarget(applyCorr(normalizeTargetRows(payload)));
  const cached=readTargetCache()[code]?.rows||[];
  targetRowsCache=mergeTargetRows(cached,fresh);
  cacheTargetsForStock(code,targetRowsCache);
  renderBrokerRows(); fillMainBrokerSelect(); if(targetTypeFilter==="目標")renderMainTarget(preferredMainTarget());
}
async function fetchTargetPayload(code,name){
  const cached=readTargetCache()[String(code)]?.rows||[];
  const recent=cached.length?"&recent=3":"";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  try{const res=await fetch(`/api/targets?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}${recent}`,{cache:"no-store",signal:controller.signal});return await readJson(res,"目標價")}finally{clearTimeout(timer)}
}
async function loadTargetPlay(code,name){
  try{renderTargetPlay(await fetchTargetPayload(code,name));return true}catch(e){console.warn("目標價載入失敗",e);if($("brokerRows"))$("brokerRows").innerHTML="<p>目標價暫時無法載入。</p>";$("targetPlay")?.classList.add("hidden");if(e?.name==="AbortError")throw new Error("目標價查詢逾時");throw e}
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
   if(mode==="match")newsMatchRowsCache=merged;else{newsRowsCache=merged;updateDigestNewState(beforeRows,merged,code)}
   renderNews();return true;
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
    renderLists();updateListButtons();
    setStatus(`${item.name||item.code} 已從${type==="holdings"?"持股":"觀察"}清單移除`);
    return;
  }
  rows.unshift(item);writeList(type,rows);
  renderLists();updateListButtons();
  setStatus(`${item.name||item.code} 已加入${type==="holdings"?"持股":"觀察"}清單`);
}
function removeFromList(type,code){
  writeList(type,readList(type).filter(x=>stockKey(x)!==String(code)));
  renderLists();updateListButtons();
}
function renderOneList(type,hostId){
  const host=$(hostId),rows=readList(type);
  if(!host)return;
  host.innerHTML=rows.length?rows.map(x=>`<div class="manage-stock">
    <div class="manage-stock-main" data-search-stock="${x.code}">
      <strong>${x.name||"—"} <small>${x.code}</small></strong>
    </div>
    <small class="list-market">${x.market||"台股"}</small>
    <strong class="list-price">${targetFmt(x.last)}</strong>
    <button class="remove-list" type="button" data-remove-type="${type}" data-remove-code="${x.code}" aria-label="刪除">×</button>
  </div>`).join(""):`<div class="manage-empty">${type==="holdings"?"尚無持股":"尚無觀察股票"}</div>`;
  host.querySelectorAll("[data-search-stock]").forEach(el=>el.addEventListener("click",()=>{
    $("stockCode").value=el.dataset.searchStock; search(); window.scrollTo({top:0,behavior:"smooth"});
  }));
  host.querySelectorAll("[data-remove-type]").forEach(btn=>btn.addEventListener("click",()=>removeFromList(btn.dataset.removeType,btn.dataset.removeCode)));
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

const AUTO_QUOTE_MS=5*60*1000,AUTO_TARGET_MS=2*60*60*1000;
let autoQuoteRefreshing=false,autoTargetRefreshing=false;
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
    const payload=await fetchTargetPayload(code,base.name||""),fresh=normalizeTargetRows(payload),cache=readTargetCache(),old=cache[code]?.rows||[],merged=mergeTargetRows(old,fresh),main=pickMainTarget(merged);
    cache[code]={rows:merged,updatedAt:new Date().toISOString()};writeTargetCache(cache);
    const patch={targetUpdatedAt:new Date().toISOString()};
    if(main){patch.target=targetPriceValue(main.latest);patch.targetBroker=targetBrokerName(main.row)}
    patchAutoListStock(code,patch);renderLists();
   }catch(e){console.warn("清單目標價更新失敗",code,e)}
  }
 }finally{autoTargetRefreshing=false}
}
setTimeout(()=>{autoRefreshQuotes(true);autoRefreshTargets(true)},800);
setInterval(()=>autoRefreshQuotes(false),AUTO_QUOTE_MS);
setInterval(()=>autoRefreshTargets(false),AUTO_TARGET_MS);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){autoRefreshQuotes(false);autoRefreshTargets(false)}});

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
