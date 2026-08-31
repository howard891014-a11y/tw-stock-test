const $=id=>document.getElementById(id);

function setText(id,value){
  const el=$(id); if(el) el.textContent=value ?? "—";
}
function setStatus(msg,error=false){
  const el=$("statusText"); if(!el)return;
  el.textContent=msg; el.classList.toggle("error",error);
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
async function quote(query){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    return await readJson(
      await fetch(`/api/quote?q=${encodeURIComponent(query)}`,{
        cache:"no-store",signal:controller.signal
      }),
      "股價"
    );
  }catch(e){
    if(e.name==="AbortError") throw new Error("股價查詢逾時");
    throw e;
  }finally{clearTimeout(timer)}
}
function renderStock(x){
  const last=Number(x.last ?? x.price ?? x.regularMarketPrice);
  const change=Number(x.change ?? x.regularMarketChange);
  const pct=Number(x.changePct ?? x.changePercent ?? x.regularMarketChangePercent);

  setText("stockName",x.name||x.shortName||"—");
  setText("stockCodeLabel",x.code||x.symbol||"—");
  setText("marketLabel",`${x.market||"台股"}｜Yahoo Finance`);
  setText("currentPrice",fmt(last));
  setText("metricPrice",fmt(last));
  setText("decisionPrice",fmt(last));

  const ch=Number.isFinite(change)
    ? `${change>0?"+":""}${fmt(change)}${Number.isFinite(pct)?`（${pct>0?"+":""}${fmt(pct)}%）`:""}`
    : "—";
  setText("priceChange",ch);
  setText("metricChange",ch);
  setText("updateTime","剛剛更新");

  const cls=change>0?"up":change<0?"down":"";
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
  setStatus("正在搜尋股票…");
  try{
    const data=await quote(q);
    renderStock(data);
    setStatus(`搜尋成功：${data.name||data.code||q}`);
    loadTargetPlay(data.code||data.symbol||q,data.name||data.shortName||"");
  }catch(e){
    console.error(e);
    setStatus(`搜尋失敗：${e.message}`,true);
  }finally{
    btn.disabled=false;
  }
}

$("searchButton")?.addEventListener("click",search);
$("stockCode")?.addEventListener("keydown",e=>{if(e.key==="Enter")search()});

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


// v2.2.1 — restore the original target-price playstyle only.
function targetFmt(n){
  const x=Number(n); return Number.isFinite(x)?x.toLocaleString("zh-TW",{maximumFractionDigits:2}):"--";
}
function targetDateValue(x){
  const d=new Date(x?.date||x?.publishedAt||x?.published||x?.time||0);
  return Number.isNaN(d.getTime())?0:d.getTime();
}
function targetPriceValue(x){
  return Number(x?.target ?? x?.targetPrice ?? x?.price);
}
function targetBrokerName(x){
  return x?.broker||x?.brokerName||x?.name||"未知券商";
}
function targetHistoryOf(x){
  const h=x?.history||x?.records||x?.targets;
  return Array.isArray(h)?h:[x];
}
function normalizeTargetRows(payload){
  if(Array.isArray(payload))return payload;
  for(const k of ["brokers","targets","items","results","data"]){
    if(Array.isArray(payload?.[k]))return payload[k];
  }
  return [];
}
function pickMainTarget(rows){
  const candidates=[];
  for(const row of rows){
    const history=targetHistoryOf(row)
      .filter(r=>Number.isFinite(targetPriceValue(r)))
      .sort((a,b)=>targetDateValue(b)-targetDateValue(a));
    if(!history.length)continue;
    candidates.push({row,history,latest:history[0],time:targetDateValue(history[0])});
  }
  candidates.sort((a,b)=>b.time-a.time);
  return candidates[0]||null;
}
function targetBasis(main){
  const h=main.history;
  const latest=targetPriceValue(h[0]);
  const previous=h.length>1?targetPriceValue(h[1]):NaN;
  if(Number.isFinite(previous)){
    if(latest>previous)return {base:previous,rule:"上調 → 前次目標價為基準"};
    if(latest<previous)return {base:latest,rule:"下調 → 最新目標價為基準"};
  }
  return {base:latest,rule:h.length>1?"維持 → 最新目標價為基準":"只有一筆 → 最新目標價為基準"};
}
function renderTargetPlay(payload){
  const rows=normalizeTargetRows(payload);
  const host=$("brokerRows"),play=$("targetPlay");
  const main=pickMainTarget(rows);
  if(!main){
    if(host)host.innerHTML="<p>目前沒有可用目標價。</p>";
    play?.classList.add("hidden"); return;
  }
  const b=targetBasis(main), latest=main.latest;
  if(host){
    const date=latest.date||latest.publishedAt||latest.published||"—";
    host.innerHTML=`<div><span>${targetBrokerName(main.row)}</span><span>${targetFmt(targetPriceValue(latest))}</span><span>${String(date).slice(0,10)}</span></div>`;
  }
  setText("mainBroker",targetBrokerName(main.row));
  setText("targetBase",`${targetFmt(b.base)} 元`);
  setText("targetRule",b.rule);
  setText("target80",`${targetFmt(b.base*.80)} 元`);
  setText("target85",`${targetFmt(b.base*.85)} 元`);
  setText("target88",`${targetFmt(b.base*.88)} 元`);
  play?.classList.remove("hidden");
}
async function loadTargetPlay(code,name){
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    const res=await fetch(`/api/targets?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}`,{cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    const data=await readJson(res,"目標價");
    renderTargetPlay(data);
  }catch(e){
    console.warn("目標價載入失敗",e);
    const host=$("brokerRows"); if(host)host.innerHTML="<p>目標價暫時無法載入。</p>";
    $("targetPlay")?.classList.add("hidden");
  }
}
