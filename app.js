const $=id=>document.getElementById(id);

function setText(id,value){
  const el=$(id); if(el) el.textContent=value ?? "—";
}
let statusTimer=null;
function setStatus(msg,error=false){
  const el=$("statusText"); if(!el)return;
  clearTimeout(statusTimer); el.textContent=msg; el.classList.toggle("error",error); el.classList.add("show");
  if(!/正在|載入|搜尋中/.test(msg)) statusTimer=setTimeout(()=>el.classList.remove("show"),error?4200:1800);
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
  currentStock=x;
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
  updateListButtons();
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


// v2.2.2 — full target list + holdings/watchlist management.
let currentStock=null;
let targetRowsCache=[];
let targetTypeFilter="外資";
const LIST_KEYS={holdings:"stockzone_holdings_v2",watchlist:"stockzone_watchlist_v2"};

function targetFmt(n){
  const x=Number(n); return Number.isFinite(x)?x.toLocaleString("zh-TW",{maximumFractionDigits:2}):"--";
}
function targetDateValue(x){
  const d=new Date(x?.date||x?.publishedAt||x?.published||x?.time||0);
  return Number.isNaN(d.getTime())?0:d.getTime();
}
function targetPriceValue(x){return Number(x?.target ?? x?.targetPrice ?? x?.price)}
function targetBrokerName(x){return x?.broker||x?.brokerName||x?.name||"未知券商"}
function targetBrokerType(x){
  const t=String(x?.brokerType||x?.type||"");
  if(t.includes("外資"))return "外資";
  if(t.includes("本土"))return "本土";
  return "未知";
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
    if(latest>previous)return {base:previous,rule:"上調 → 前次目標價為基準"};
    if(latest<previous)return {base:latest,rule:"下調 → 最新目標價為基準"};
  }
  return {base:latest,rule:h.length>1?"維持 → 最新目標價為基準":"只有一筆 → 最新目標價為基準"};
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
  host.innerHTML=h.map((x,i)=>`<div class="history3-row"><span>${i===0?"最新":i===1?"前次":"前前次"}</span><strong>${targetFmt(targetPriceValue(x))} 元</strong><time>${String(x.date||x.publishedAt||x.published||"—").slice(0,10)}</time></div>`).join("");
}
$("mainBrokerSelect")?.addEventListener("change",e=>{
  setBrokerPref(e.target.value);
  const main=preferredMainTarget();
  renderMainTarget(main);
  renderTargetHistory3(main);
});

function renderMainTarget(main){
  const play=$("targetPlay");
  if(!main){play?.classList.add("hidden");return}
  const b=targetBasis(main);
  setText("targetBase",`${targetFmt(b.base)} 元`);
  setText("targetRule",b.rule);
  setText("target80",`${targetFmt(b.base*.80)} 元`);
  setText("target85",`${targetFmt(b.base*.85)} 元`);
  setText("target88",`${targetFmt(b.base*.88)} 元`);
  renderTargetHistory3(main);
  play?.classList.remove("hidden");
  document.querySelectorAll(".broker-row").forEach(el=>el.classList.toggle("selected",el.dataset.broker===targetBrokerName(main.row)));
}

const TARGET_CORR_KEY="stockzone_target_corrections_v231"; let editingTarget=null;
function readCorr(){try{return JSON.parse(localStorage.getItem(TARGET_CORR_KEY)||"{}")||{}}catch{return{}}}
function writeCorr(x){localStorage.setItem(TARGET_CORR_KEY,JSON.stringify(x))}
function corrKey(row){const latest=targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row;return [currentStock?.code||"",targetBrokerName(row),String(latest.date||"").slice(0,10),targetPriceValue(latest)].join("|")}
function applyCorr(rows){const c=readCorr();return rows.map(row=>{const fix=c[corrKey(row)];if(!fix)return row;const r={...row};if(fix.broker)r.broker=fix.broker;if(Number.isFinite(Number(fix.target))){r.target=Number(fix.target);r.targetHistory=targetHistoryOf(r).map((x,i)=>i===0?{...x,target:Number(fix.target)}:{...x})}return r})}
function openEdit(row){editingTarget=row;$("editBrokerName").value=targetBrokerName(row);$("editTargetPrice").value=targetPriceValue(targetHistoryOf(row)[0]||row)||"";$("targetEditModal").classList.remove("hidden")}
function closeEdit(){editingTarget=null;$("targetEditModal")?.classList.add("hidden")}
$("closeTargetEdit")?.addEventListener("click",closeEdit);$("cancelTargetEdit")?.addEventListener("click",closeEdit);
$("saveTargetEdit")?.addEventListener("click",()=>{if(!editingTarget)return;const broker=$("editBrokerName").value.trim(),target=Number($("editTargetPrice").value);if(!broker||!Number.isFinite(target)||target<=0)return setStatus("請輸入正確資料",true);const c=readCorr();c[corrKey(editingTarget)]={broker,target};writeCorr(c);targetRowsCache=applyCorr(targetRowsCache);renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget());closeEdit();setStatus("修改已儲存")});

function renderBrokerRows(){
  const host=$("brokerRows");
  if(!host)return;
  const rows=targetRowsCache.map(targetCandidate).filter(Boolean)
    .filter(x=>targetBrokerType(x.row)===targetTypeFilter)
    .sort((a,b)=>b.time-a.time);
  if(!rows.length){
    host.innerHTML=`<p>目前沒有${targetTypeFilter}目標價。</p>`;
    return;
  }
  host.innerHTML=rows.map((x,i)=>{
    const d=x.latest.date||x.latest.publishedAt||x.latest.published||"—";
    const src=x.latest?.sourceUrl||x.row?.sourceUrl||"";
    return `<div class="broker-row" data-broker="${targetBrokerName(x.row).replace(/"/g,"&quot;")}" data-index="${i}">
      <span><b>${targetBrokerName(x.row)}</b><small class="broker-type">${targetBrokerType(x.row)}</small></span>
      <strong>${targetFmt(targetPriceValue(x.latest))}</strong><time>${String(d).slice(0,10)}</time>
      <span class="broker-actions">${src?`<a href="${src}" target="_blank" rel="noopener" onclick="event.stopPropagation()">來源</a>`:""}<button type="button" data-edit-target="${i}" onclick="event.stopPropagation()">修改</button></span>
    </div>`;
  }).join("");
  host.querySelectorAll(".broker-row").forEach((el,i)=>el.addEventListener("click",()=>{
    setBrokerPref(targetBrokerName(rows[i].row));
    fillMainBrokerSelect();
    renderMainTarget(rows[i]);
  }));
  host.querySelectorAll("[data-edit-target]").forEach(btn=>btn.addEventListener("click",()=>openEdit(rows[Number(btn.dataset.editTarget)].row)));
}
function renderTargetPlay(payload){
  targetRowsCache=applyCorr(normalizeTargetRows(payload));
  renderBrokerRows();
  fillMainBrokerSelect();
  renderMainTarget(preferredMainTarget());
}
async function loadTargetPlay(code,name){
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    const res=await fetch(`/api/targets?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}`,{cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    renderTargetPlay(await readJson(res,"目標價"));
  }catch(e){
    console.warn("目標價載入失敗",e);
    if($("brokerRows"))$("brokerRows").innerHTML="<p>目標價暫時無法載入。</p>";
    $("targetPlay")?.classList.add("hidden");
  }
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

// ---------- holdings / watchlist ----------
function readList(type){
  try{const v=JSON.parse(localStorage.getItem(LIST_KEYS[type])||"[]");return Array.isArray(v)?v:[]}catch{return[]}
}
function writeList(type,rows){localStorage.setItem(LIST_KEYS[type],JSON.stringify(rows))}
function stockKey(x){return String(x?.code||x?.symbol||"")}
function snapshotStock(x){
  return {code:x.code||x.symbol||"",name:x.name||x.shortName||"",last:Number(x.last??x.price??x.regularMarketPrice),market:x.market||"台股",savedAt:new Date().toISOString()}
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
      <small>${x.market||"台股"}</small>
    </div>
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
document.querySelectorAll("[data-manage-jump]").forEach(btn=>btn.addEventListener("click",()=>{
  const type=btn.dataset.manageJump;
  document.querySelector(`[data-manage-tab="${type}"]`)?.click();
  $("stockManagement")?.scrollIntoView({behavior:"smooth",block:"start"});
  $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
}));
document.querySelectorAll("[data-search-jump]").forEach(btn=>btn.addEventListener("click",()=>{
  $("stockCode")?.focus();window.scrollTo({top:0,behavior:"smooth"});
}));

renderLists();

function setView(view){
  document.querySelectorAll("[data-view-panel]").forEach(p=>p.classList.toggle("active-view",p.dataset.viewPanel===view));
  document.querySelectorAll(".section-tabs [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".side-group [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
  window.scrollTo({top:document.querySelector(".stock-head")?.offsetTop||0,behavior:"smooth"});
}
document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
document.querySelectorAll("[data-view-open]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.viewOpen)));
setView("overview");
