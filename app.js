const $=id=>document.getElementById(id),KEY="twStockBrokerV40",HISTORY_KEY="twStockSearchHistoryV1";
const oldState=JSON.parse(localStorage.getItem("twStockBrokerV23")||localStorage.getItem("twStockBrokerV22")||"null");
let state=JSON.parse(localStorage.getItem(KEY)||JSON.stringify(oldState||{holdings:[],watchlist:[],sortModes:{holdings:"custom",watchlist:"custom"}}));
state.holdings??=[];state.watchlist??=[];state.sortModes??={holdings:"custom",watchlist:"custom"};
for(const list of [state.holdings,state.watchlist])for(const stock of list)stock.primaryBrokerKey??="";
let searchHistory=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]"),searched=null,currentPage="search";
const expanded={holdings:new Set(),watchlist:new Set()},busy=new Set();
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const saveHistory=()=>localStorage.setItem(HISTORY_KEY,JSON.stringify(searchHistory));
const fmt=n=>n==null||Number.isNaN(Number(n))?"—":Number(n).toLocaleString("zh-TW",{maximumFractionDigits:2});
const displayName=v=>String(v||"").replace(/股份有限公司$/g,"").replace(/有限公司$/g,"").replace(/科技股份$/g,"").replace(/科技$/g,"").trim();
const quoteTime=v=>{if(!v)return"尚未更新";return new Date(v).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).replace(/\//g,"/").replace(",","");};
const date=v=>v?new Date(v).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}):"日期不明";
const ageDays=v=>v?Math.max(0,Math.floor((Date.now()-new Date(v))/86400000)):Infinity;
const age=v=>{if(!v)return"日期不明";const d=ageDays(v);return d?`${d}天前`:"今天"};
const within360=v=>ageDays(v)<=360;
function status(t,e=false){$("statusText").textContent=t;$("statusText").className=e?"status error":"status"}
async function readJson(r,label){const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw Error(`${label} API 未正常部署（HTTP ${r.status}）`)}if(!r.ok||!j.ok)throw Error(j.error||`${label}查詢失敗`);return j}
async function quote(query){return readJson(await fetch(`/api/quote?q=${encodeURIComponent(query)}`,{cache:"no-store"}),"股價")}
async function targets(code,name){const j=await readJson(await fetch(`/api/targets?code=${code}&name=${encodeURIComponent(name||"")}`,{cache:"no-store"}),"目標價");return j.brokers||[]}
async function load(query){const q=await quote(query);let brokers=[],targetError="";try{brokers=await targets(q.code,q.name)}catch(e){targetError=e.message}return{...q,brokers,targetError,lastRefresh:new Date().toISOString()}}
function normalizeHistoryItem(x){return{target:x?.target,date:x?.date||null,title:x?.title||"",sourceUrl:x?.sourceUrl||"",periodType:x?.periodType||"unknown",periodLabel:x?.periodLabel||"",revisionReason:x?.revisionReason||"unknown",revisionReasonLabel:x?.revisionReasonLabel||""}}
function rowKey(x){return x.brokerKey||`${x.broker||"未知券商"}:${x.title||""}:${x.target||""}`}
function merge(oldRows=[],newRows=[]){const old=new Map(oldRows.filter(x=>within360(x.date)).map(x=>[rowKey(x),x])),fresh=new Map(newRows.filter(x=>within360(x.date)).map(x=>[rowKey(x),x])),out=[];for(const[k,x]of fresh){const o=old.get(k),changed=o&&(`${o.target}|${o.date}`!==`${x.target}|${x.date}`);const history=[...(x.targetHistory||[]),...(o?.targetHistory||[]),...(o?[o]:[])].map(normalizeHistoryItem).filter(x=>Number(x.target)>0&&within360(x.date)).filter((x,i,a)=>a.findIndex(y=>y.target===x.target&&String(y.date||"").slice(0,10)===String(x.date||"").slice(0,10))===i).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,5);out.push({...x,broker:x.broker||"未知券商",brokerKey:k,targetHistory:history,previousTarget:history[1]?.target??null,previousDate:history[1]?.date??null,hasNewTarget:!!changed,isNewBroker:!o})}return out.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))}
function basis(x){const latest=Number(x.target),previous=Number(x.previousTarget);if(Number.isFinite(previous)&&previous>0&&latest>previous)return{value:previous,label:"目標價上調，採前一次目標價"};return{value:latest,label:Number.isFinite(previous)&&previous>0&&latest<previous?"目標價下調，採最新目標價":"採最新目標價"}}
function stageForBroker(row,last){const b=basis(row),target=Number(b.value),p=Number(last);if(!Number.isFinite(target)||target<=0||!Number.isFinite(p))return null;const levels=[.8,.85,.88].map(rate=>({rate,price:target*rate}));if(p>=levels[2].price)return{rank:0,distance:0,label:"已達88%",broker:row.broker||"未知券商",price:levels[2].price,activeRate:.88,basis:target};const next=levels.find(x=>p<x.price);const distance=(next.price-p)/p*100;return{rank:1,distance,label:`距${Math.round(next.rate*100)}%還差 ${distance.toFixed(1)}%`,broker:row.broker||"未知券商",price:next.price,activeRate:next.rate,basis:target}}
function primaryRow(stock){const valid=(stock.brokers||[]).filter(x=>Number(x.target)>0&&within360(x.date));if(!valid.length)return null;if(stock.primaryBrokerKey){const selected=valid.find(x=>(x.brokerKey||x.broker)===stock.primaryBrokerKey);if(selected)return selected}return valid.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))[0]}
function bestStage(stock){const row=primaryRow(stock);return row?stageForBroker(row,stock.last):null}
function sortedItems(type){const a=state[type].map((x,index)=>({x,index}));if(state.sortModes[type]!=="targetDistance")return a;return a.sort((u,v)=>{const a=bestStage(u.x),b=bestStage(v.x);if(!a&&!b)return u.index-v.index;if(!a)return 1;if(!b)return-1;return a.rank-b.rank||a.distance-b.distance||u.index-v.index})}
function historyRows(h,start=0){return h.map((y,i)=>`<div class="history-item"><span>${start+i===0?"最新":start+i===1?"前次":`第${start+i+1}筆`}</span><strong>${fmt(y.target)}</strong><span>${date(y.date)}</span>${y.sourceUrl?`<a href="${y.sourceUrl}" target="_blank" rel="noopener">來源</a>`:""}</div>`).join("")}
function historyHtml(x){const h=(x.targetHistory?.length?x.targetHistory:[normalizeHistoryItem(x)]).slice(0,5),shown=h.slice(0,2),older=h.slice(2);return`<div class="history-list">${historyRows(shown)}</div>${older.length?`<details class="target-history"><summary>較早目標價（${older.length}）</summary>${historyRows(older,2)}</details>`:""}`}
const PERIODS=[{key:"quarter",title:"季度目標價"},{key:"annual",title:"年度目標價"},{key:"12m",title:"12個月目標價"},{key:"unknown",title:""}];
function brokerRow(x,last,primaryKey=""){const b=basis(x),info=[],stage=stageForBroker(x,last),isPrimary=(x.brokerKey||x.broker)===primaryKey;if(x.periodType&&x.periodType!=="unknown"&&x.periodLabel)info.push(`<span class="badge">${x.periodLabel}</span>`);if(x.revisionReason&&x.revisionReason!=="unknown"&&x.revisionReasonLabel)info.push(`<span class="badge">${x.revisionReasonLabel}</span>`);const rates=[.8,.85,.88];return`<div class="broker-row ${isPrimary?"primary-broker":""}"><div class="broker-head"><div><strong>${x.broker||"未知券商"}</strong> ${isPrimary?'<span class="badge primary-badge">主要</span>':''}${x.hasNewTarget?'<span class="badge new-badge">已更新</span>':''}${x.isNewBroker?'<span class="badge new-badge">新增</span>':''}</div><strong>${fmt(x.target)}</strong></div><div class="small">${date(x.date)}（${age(x.date)}）</div>${info.length?`<div class="info-line">${info.join("")}</div>`:""}${stage?`<div class="stage-line">${stage.label}</div>`:""}<div class="small">倍率基準：${fmt(b.value)}（${b.label}）</div><div class="multiplier">${rates.map(rate=>`<div class="${stage&&stage.activeRate===rate?"active-target":""}">${Math.round(rate*100)}%<br><strong>${fmt(b.value*rate)}</strong></div>`).join("")}</div>${historyHtml(x)}${x.sourceUrl?`<div class="small"><a href="${x.sourceUrl}" target="_blank" rel="noopener">查看最新來源</a></div>`:""}</div>`}
function periodGroups(list,type,last,primaryKey=""){const eligible=(list||[]).filter(x=>x.brokerType===type&&Number(x.target)>0&&within360(x.date));if(!eligible.length)return'<div class="small">近期無目標價</div>';return PERIODS.map(p=>{const a=eligible.filter(x=>(x.periodType||"unknown")===p.key);return a.length?`<div class="period-group">${p.title?`<h4>${p.title}</h4>`:""}${a.map(x=>brokerRow(x,last,primaryKey)).join("")}</div>`:""}).join("")}
function brokerSelect(list,selected,type,index){if(!type)return"";const opts=(list||[]).filter(x=>Number(x.target)>0&&within360(x.date)).map(x=>({key:x.brokerKey||x.broker,label:x.broker||"未知券商"})).filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i);if(!opts.length)return"";return`<label class="primary-broker-select">主要券商<select data-primary-broker data-type="${type}" data-i="${index}"><option value="">自動選擇</option>${opts.map(o=>`<option value="${o.key}" ${o.key===selected?"selected":""}>${o.label}</option>`).join("")}</select></label>`}
function targetSections(list,last,refreshButton="",stock=null,type="",index=-1){const primaryKey=stock?.primaryBrokerKey||"";return`<div class="target-title"><h3>目標價</h3>${refreshButton}</div>${brokerSelect(list,primaryKey,type,index)}<div class="broker-section"><h3>外資券商</h3>${periodGroups(list,"外資",last,primaryKey)}</div><div class="broker-section"><h3>本土券商</h3>${periodGroups(list,"本土",last,primaryKey)}</div><div class="broker-section"><h3>未知券商</h3>${periodGroups(list,"未知",last,primaryKey)}</div>`}
const icon=(kind,type,index,label)=>`<button class="icon-button ${kind}" data-type="${type}" data-i="${index}" aria-label="${label}" title="${label}"><span aria-hidden="true">${kind==="remove-one"?"×":"↻"}</span></button>`;
function changeHtml(x){const s=x.change>0?"+":"",c=x.change>0?"positive":x.change<0?"negative":"";return`<div class="price-change ${c}">${x.change==null?"—":`${s}${fmt(x.change)}（${s}${fmt(x.changePct)}%）`}</div>`}
function card(x,index,type){const key=`${type}:${x.code}`,open=expanded[type].has(key),stage=bestStage(x),custom=state.sortModes[type]==="custom";return`<article class="stock-card ${open?"expanded":""}" data-key="${key}" data-index="${index}" data-type="${type}" ${custom?'data-draggable="true"':''}>${icon("remove-one",type,index,"刪除股票")}<div class="stock-summary"><div class="stock-summary-main"><div class="stock-name">${displayName(x.name)||"—"} <span class="code">${x.code}</span></div><div class="meta">${x.market||""}｜${quoteTime(x.quoteTime)}</div>${type==="holdings"&&stage?`<div class="summary-stage">${stage.broker}：${stage.label}</div>`:""}</div><div class="stock-price"><div class="price-line">${icon("refresh-quote",type,index,"刷新即時股價")}<div class="price">${fmt(x.last)}</div></div>${changeHtml(x)}</div><button class="summary-toggle chevron-button" data-toggle="${key}" aria-expanded="${open}" aria-label="${open?"收合":"展開"}"><span class="chevron">⌄</span></button></div><div class="stock-detail">${targetSections(x.brokers,x.last,icon("refresh-targets",type,index,"刷新目標價"),x,type,index)}</div></article>`}
function renderList(type){const el=$(type+"List"),a=sortedItems(type);el.innerHTML=a.length?a.map(({x,index})=>card(x,index,type)).join(""):'<div class="empty">清單是空的</div>'}
function renderHistory(){const el=$("searchHistory");if(!el)return;el.innerHTML=searchHistory.length?searchHistory.map((x,i)=>`<span class="history-chip"><button class="history-search" data-history-i="${i}">${displayName(x.name)||x.code}</button><button class="history-delete" data-history-delete="${i}" aria-label="刪除 ${displayName(x.name)||x.code}">×</button></span>`).join(""):'<span class="small">尚無搜尋紀錄</span>';document.querySelectorAll("[data-history-i]").forEach(b=>b.onclick=()=>{$("stockCode").value=searchHistory[+b.dataset.historyI].code;search()});document.querySelectorAll("[data-history-delete]").forEach(b=>b.onclick=()=>{searchHistory.splice(+b.dataset.historyDelete,1);saveHistory();renderHistory()})}
function remember(x){searchHistory=searchHistory.filter(y=>y.code!==x.code);searchHistory.unshift({code:x.code,name:displayName(x.name)});searchHistory=searchHistory.slice(0,12);saveHistory();renderHistory()}
function renderAll(){renderList("holdings");renderList("watchlist");bindLists();renderHistory();document.querySelectorAll("[data-sort-list]").forEach(s=>s.value=state.sortModes[s.dataset.sortList]||"custom")}
function replaceStock(type,i,patch){state[type][i]={...state[type][i],...patch};save();renderAll()}
async function refreshQuoteOne(type,i,button){const old=state[type][i],key=`q:${type}:${i}`;if(busy.has(key))return;busy.add(key);button?.classList.add("spinning");try{const q=await quote(old.code);replaceStock(type,i,{...q,brokers:old.brokers,lastRefresh:new Date().toISOString()});status(`${old.name||old.code} 股價已刷新`)}catch(e){status(e.message,true)}finally{busy.delete(key)}}
async function refreshTargetsOne(type,i,button){const old=state[type][i],key=`t:${type}:${i}`;if(busy.has(key))return;busy.add(key);button?.classList.add("spinning");try{const rows=await targets(old.code,old.name);replaceStock(type,i,{brokers:merge(old.brokers,rows),targetError:"",lastTargetRefresh:new Date().toISOString()});status(`${old.name||old.code} 目標價已刷新`)}catch(e){status(e.message,true)}finally{busy.delete(key)}}
function bindLists(){document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=e=>{if(e.target.closest(".icon-button"))return;const[type]=b.dataset.toggle.split(":");expanded[type].has(b.dataset.toggle)?expanded[type].delete(b.dataset.toggle):expanded[type].add(b.dataset.toggle);renderAll()});document.querySelectorAll(".refresh-quote").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();refreshQuoteOne(b.dataset.type,+b.dataset.i,b)});document.querySelectorAll(".refresh-targets").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();refreshTargetsOne(b.dataset.type,+b.dataset.i,b)});document.querySelectorAll(".remove-one").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();const type=b.dataset.type,i=+b.dataset.i;if(confirm(`確定刪除 ${state[type][i]?.name||state[type][i]?.code}？`)){state[type].splice(i,1);save();renderAll()}});document.querySelectorAll("[data-primary-broker]").forEach(sel=>sel.onchange=()=>{const type=sel.dataset.type,i=+sel.dataset.i;state[type][i].primaryBrokerKey=sel.value;save();renderAll()});bindDrag()}
function show(x){searched=x;remember(x);$("searchResult").classList.remove("hidden");$("searchResult").innerHTML=`<div class="search-result-head"><div><div class="stock-name">${displayName(x.name)} <span class="code">${x.code}</span></div><div class="meta">${x.market}｜${quoteTime(x.quoteTime)}</div></div><div class="stock-price"><div class="price-line"><button id="searchQuoteRefresh" class="icon-button" aria-label="刷新即時股價"><span>↻</span></button><div class="price">${fmt(x.last)}</div></div>${changeHtml(x)}</div></div>${targetSections(x.brokers,x.last,'<button id="searchTargetsRefresh" class="icon-button" aria-label="刷新目標價"><span>↻</span></button>')}<div class="actions"><button id="addH">加入持股</button><button id="addW" class="secondary">加入觀察</button></div>`;$("addH").onclick=()=>add("holdings");$("addW").onclick=()=>add("watchlist");$("searchQuoteRefresh").onclick=async e=>{const b=e.currentTarget;b.classList.add("spinning");try{const q=await quote(searched.code);searched={...searched,...q};show(searched);status(`${searched.name} 股價已刷新`)}catch(err){status(err.message,true)}};$("searchTargetsRefresh").onclick=async e=>{const b=e.currentTarget;b.classList.add("spinning");try{searched.brokers=merge(searched.brokers,await targets(searched.code,searched.name));show(searched);status(`${searched.name} 目標價已刷新`)}catch(err){status(err.message,true)}}}
function add(type){if(state[type].some(x=>x.code===searched.code))return status("清單中已存在");state[type].push({...searched});save();renderAll();goPage(type);status("已加入清單")}
async function search(){const q=$("stockCode").value.trim();if(!q)return status("請輸入股票名稱或代碼",true);$("searchButton").disabled=true;status("正在更新股價與各券商目標價…");try{const x=await load(q);show(x);status(`更新成功：${x.name}`)}catch(e){status(e.message,true)}finally{$("searchButton").disabled=false}}
function bindDrag(){
  document.querySelectorAll('[data-draggable="true"]').forEach(card=>{
    let timer=null,dragging=false,pointerId=null,startY=0;
    const type=card.dataset.type,container=$(type+"List");
    const handle=card.querySelector(".stock-summary-main");
    if(!handle)return;
    const cleanup=()=>{
      clearTimeout(timer);timer=null;
      document.removeEventListener("pointermove",move,{passive:false});
      document.removeEventListener("pointerup",end);
      document.removeEventListener("pointercancel",end);
      card.classList.remove("drag-ready");
      document.body.classList.remove("sorting-active");
      if(pointerId!=null){try{card.releasePointerCapture(pointerId)}catch{}}
      pointerId=null;
    };
    const start=e=>{
      if(e.button!=null&&e.button!==0)return;
      if(e.target.closest(".icon-button,a,details,summary,select,input,button"))return;
      pointerId=e.pointerId;startY=e.clientY;
      try{card.setPointerCapture(pointerId)}catch{}
      document.addEventListener("pointermove",move,{passive:false});
      document.addEventListener("pointerup",end);
      document.addEventListener("pointercancel",end);
      card.classList.add("drag-ready");
      timer=setTimeout(()=>{
        dragging=true;
        card.classList.remove("drag-ready");
        card.classList.add("dragging");
        document.body.classList.add("sorting-active");
        navigator.vibrate?.(25);
      },360);
    };
    const move=e=>{
      if(e.pointerId!==pointerId)return;
      const delta=Math.abs(e.clientY-startY);
      if(!dragging){
        if(delta>28)cleanup();
        return;
      }
      e.preventDefault();
      const y=e.clientY,others=[...container.querySelectorAll('[data-draggable="true"]:not(.dragging)')];
      const after=others.find(el=>y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
      after?container.insertBefore(card,after):container.appendChild(card);
    };
    const end=e=>{
      if(e.pointerId!==pointerId)return;
      clearTimeout(timer);
      if(dragging){
        dragging=false;card.classList.remove("dragging");
        const codes=[...container.querySelectorAll(".stock-card")].map(el=>el.dataset.key.split(":").slice(1).join(":"));
        state[type].sort((a,b)=>codes.indexOf(a.code)-codes.indexOf(b.code));
        save();renderAll();
      }
      cleanup();
    };
    handle.addEventListener("pointerdown",start);
  });
}
const pages=["search","holdings","watchlist"];
function updatePageTabs(page){currentPage=page;document.querySelectorAll(".page-tab").forEach(b=>b.classList.toggle("active",b.dataset.page===page))}
function goPage(page){const i=pages.indexOf(page);if(i<0)return;$("pageTrack").scrollTo({left:$("pageTrack").clientWidth*i,behavior:"smooth"});updatePageTabs(page)}
let scrollTimer;$("pageTrack").addEventListener("scroll",()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const i=Math.round($("pageTrack").scrollLeft/$("pageTrack").clientWidth);updatePageTabs(pages[Math.max(0,Math.min(2,i))])},80)});
document.querySelectorAll(".page-tab").forEach(b=>b.onclick=()=>goPage(b.dataset.page));
$("searchButton").onclick=search;$("stockCode").onkeydown=e=>{if(e.key==="Enter")search()};document.querySelectorAll("[data-sort-list]").forEach(s=>s.onchange=()=>{state.sortModes[s.dataset.sortList]=s.value;save();renderAll()});
renderAll();
