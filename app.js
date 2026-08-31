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
