const $=id=>document.getElementById(id),KEY="twStockBrokerV40",HISTORY_KEY="twStockSearchHistoryV1",CORR_KEY="twStockTargetCorrectionsV1";
const oldState=JSON.parse(localStorage.getItem("twStockBrokerV23")||localStorage.getItem("twStockBrokerV22")||"null");
let state=JSON.parse(localStorage.getItem(KEY)||JSON.stringify(oldState||{holdings:[],watchlist:[],sortModes:{holdings:"custom",watchlist:"custom"}}));
state.holdings??=[];state.watchlist??=[];state.sortModes??={holdings:"custom",watchlist:"custom"};
for(const list of [state.holdings,state.watchlist])for(const stock of list)stock.primaryBrokerKey??="";
let searchHistory=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]"),corrections=JSON.parse(localStorage.getItem(CORR_KEY)||"{}"),searched=null,currentPage="search";
const expanded={holdings:new Set(),watchlist:new Set()},busy=new Set();
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const saveHistory=()=>localStorage.setItem(HISTORY_KEY,JSON.stringify(searchHistory));
const saveCorrections=()=>localStorage.setItem(CORR_KEY,JSON.stringify(corrections));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>n==null||Number.isNaN(Number(n))?"—":Number(n).toLocaleString("zh-TW",{maximumFractionDigits:2});
const displayName=v=>String(v||"").replace(/股份有限公司$/g,"").replace(/有限公司$/g,"").replace(/科技股份$/g,"").replace(/科技$/g,"").trim();
const quoteTime=v=>{if(!v)return"尚未更新";return new Date(v).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).replace(/\//g,"/").replace(",","");};
const date=v=>v?new Date(v).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}):"日期不明";
const ageDays=v=>v?Math.max(0,Math.floor((Date.now()-new Date(v))/86400000)):Infinity;
const age=v=>{if(!v)return"日期不明";const d=ageDays(v);return d?`${d}天前`:"今天"};
const within360=v=>ageDays(v)<=360;
function status(t,e=false){
  const el=$("statusText");el.className=e?"status error":"status";
  const loading=!e&&/(?:\.{3}|…+)$/.test(String(t));
  if(loading){
    const base=String(t).replace(/(?:\.{3}|…+)$/,""),dots='<span class="loading-dots" aria-label="載入中"><i>•</i><i>•</i><i>•</i></span>';
    el.innerHTML=`${esc(base)}${dots}`;
  }else el.textContent=t;
}
async function readJson(r,label){const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw Error(`${label} API 未正常部署（HTTP ${r.status}）`)}if(!r.ok||!j.ok)throw Error(j.error||`${label}查詢失敗`);return j}
async function quote(query){return readJson(await fetch(`/api/quote?q=${encodeURIComponent(query)}`,{cache:"no-store"}),"股價")}
async function targets(code,name){const j=await readJson(await fetch(`/api/targets?code=${code}&name=${encodeURIComponent(name||"")}`,{cache:"no-store"}),"目標價");return j.brokers||[]}
async function load(query){const q=await quote(query);let brokers=[],targetError="";try{brokers=await targets(q.code,q.name)}catch(e){targetError=e.message}return{...q,brokers,targetError,lastRefresh:new Date().toISOString()}}
function normalizeHistoryItem(x){return{target:x?.target,date:x?.date||null,title:x?.title||"",sourceUrl:x?.sourceUrl||"",periodType:x?.periodType||"unknown",periodLabel:x?.periodLabel||"",revisionReason:x?.revisionReason||"unknown",revisionReasonLabel:x?.revisionReasonLabel||""}}
function rowKey(x){return x.brokerKey||`${x.broker||"未知券商"}:${x.title||""}:${x.target||""}`}
function correctionKey(code,row){
  const rawTarget=row?._rawTarget??row?.target??"";
  const rawBroker=row?._rawBroker??row?.broker??"";
  return `${code}|${row?.sourceUrl||""}|${String(row?.date||"").slice(0,10)}|${rawTarget}|${rawBroker}`;
}
function correctedRow(code,row){
  if(!row)return row;
  const key=correctionKey(code,row),c=corrections[key];
  if(c?.hidden)return null;
  const out={...row,_correctionKey:key,_rawTarget:row._rawTarget??row.target,_rawBroker:row._rawBroker??row.broker};
  if(c?.target!=null){out.target=Number(c.target);out.manualTarget=!!c.manualTarget}
  if(c?.broker){out.broker=c.broker;out.brokerKey=`manual:${c.broker}`;out.brokerType=c.brokerType||out.brokerType||"未知";out.manualBroker=!!c.manualBroker}
  if(Array.isArray(out.targetHistory)){
    out.targetHistory=out.targetHistory.map((h,i)=>{
      if(i!==0)return h;
      const x={...h};
      if(c?.target!=null)x.target=Number(c.target);
      return x;
    });
  }
  return out;
}
function correctedRows(code,rows=[]){return rows.map(r=>correctedRow(code,r)).filter(Boolean)}
function findStoredStock(type,index){return type&&state[type]?.[index]?state[type][index]:null}
function updateCorrection(code,row,patch){
  const key=row._correctionKey||correctionKey(code,row);
  corrections[key]={...(corrections[key]||{}),...patch,updatedAt:new Date().toISOString()};
  saveCorrections();
}
async function reparseSource(stock,row,mode){
  if(!row.sourceUrl)throw Error("這筆資料沒有可重新解析的來源");
  const r=await fetch("/api/corrections",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:row.sourceUrl,code:stock.code,name:stock.name,mode,currentTarget:row.target,currentBroker:row.broker})});
  return readJson(r,"來源重新解析");
}
function brokerTypeByName(name){
  if(/高盛|摩根|花旗|美銀|瑞銀|瑞信|野村|麥格理|匯豐|滙豐|里昂|巴克萊|德意志|外資/.test(name))return"外資";
  if(/元大|群益|凱基|富邦|國泰|永豐|統一|兆豐|第一金|華南|玉山|台新|康和|宏遠|國票|新光|中信|中國信託/.test(name))return"本土";
  return"未知";
}
async function repairRow(type,index,row,kind){
  const stock=findStoredStock(type,index)||searched;
  if(!stock)return;
  if(kind==="old"){
    if(!confirm("確定刪除這筆目標價？之後重新整理也不會再顯示。"))return;
    updateCorrection(stock.code,row,{hidden:true});
    renderAll();if(!type)show(searched);return;
  }
  let parsed=null;
  try{parsed=await reparseSource(stock,row,kind)}catch{}
  if(kind==="target"){
    let value=parsed?.target;
    let manual=false;
    if(!Number.isFinite(Number(value))||Number(value)<=0){
      value=prompt("重新解析失敗，請輸入正確目標價：",String(row.target??""));
      if(value==null)return;
      manual=true;
    }
    value=Number(value);
    if(!Number.isFinite(value)||value<=0)return alert("目標價格式錯誤");
    updateCorrection(stock.code,row,{target:value,manualTarget:manual,hidden:false});
  }else if(kind==="broker"){
    let value=String(parsed?.broker||"").trim(),manual=false;
    if(!value||value==="未知券商"){
      value=prompt("重新解析失敗，請輸入正確券商名稱：",row.broker==="未知券商"?"":row.broker);
      if(value==null)return;
      value=value.trim();manual=true;
    }
    if(!value)return alert("券商名稱不可空白");
    updateCorrection(stock.code,row,{broker:value,brokerType:brokerTypeByName(value),manualBroker:manual,hidden:false});
  }
  renderAll();if(!type)show(searched);
}
function editManualCorrection(type,index,row,field){
  const stock=findStoredStock(type,index)||searched;if(!stock)return;
  const key=row._correctionKey||correctionKey(stock.code,row),c=corrections[key]||{};
  if(!confirm("按「確定」修改手動修正；按「取消」可選擇刪除修正。")){
    if(confirm("刪除此手動修正並恢復官方資料？")){
      if(field==="target"){delete c.target;delete c.manualTarget}else{delete c.broker;delete c.brokerType;delete c.manualBroker}
      if(!c.target&&!c.broker&&!c.hidden)delete corrections[key];else corrections[key]=c;
      saveCorrections();renderAll();if(!type)show(searched);
    }
    return;
  }
  if(field==="target"){
    const v=prompt("修改目標價：",String(row.target??""));if(v==null)return;
    const n=Number(v);if(!Number.isFinite(n)||n<=0)return alert("目標價格式錯誤");
    updateCorrection(stock.code,row,{target:n,manualTarget:true});
  }else{
    const v=prompt("修改券商名稱：",row.broker||"");if(v==null||!v.trim())return;
    updateCorrection(stock.code,row,{broker:v.trim(),brokerType:brokerTypeByName(v.trim()),manualBroker:true});
  }
  renderAll();if(!type)show(searched);
}

function merge(oldRows=[],newRows=[]){const old=new Map(oldRows.filter(x=>within360(x.date)).map(x=>[rowKey(x),x])),fresh=new Map(newRows.filter(x=>within360(x.date)).map(x=>[rowKey(x),x])),out=[];for(const[k,x]of fresh){const o=old.get(k),changed=o&&(`${o.target}|${o.date}`!==`${x.target}|${x.date}`);const history=[...(x.targetHistory||[]),...(o?.targetHistory||[]),...(o?[o]:[])].map(normalizeHistoryItem).filter(x=>Number(x.target)>0&&within360(x.date)).filter((x,i,a)=>a.findIndex(y=>y.target===x.target&&String(y.date||"").slice(0,10)===String(x.date||"").slice(0,10))===i).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,5);out.push({...x,broker:x.broker||"未知券商",brokerKey:k,targetHistory:history,previousTarget:history[1]?.target??null,previousDate:history[1]?.date??null,hasNewTarget:!!changed,isNewBroker:!o})}return out.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))}
function basis(x){const latest=Number(x.target),previous=Number(x.previousTarget);if(Number.isFinite(previous)&&previous>0&&latest>previous)return{value:previous,label:"目標價上調，採前一次目標價"};return{value:latest,label:Number.isFinite(previous)&&previous>0&&latest<previous?"目標價下調，採最新目標價":"採最新目標價"}}
function stageForBroker(row,last){const b=basis(row),target=Number(b.value),p=Number(last);if(!Number.isFinite(target)||target<=0||!Number.isFinite(p))return null;const levels=[.8,.85,.88].map(rate=>({rate,price:target*rate}));if(p>=levels[2].price)return{rank:0,distance:0,label:"已達88%",broker:row.broker||"未知券商",price:levels[2].price,activeRate:.88,basis:target};const next=levels.find(x=>p<x.price);const distance=(next.price-p)/p*100;return{rank:1,distance,label:`距${Math.round(next.rate*100)}%還差 ${distance.toFixed(1)}%`,broker:row.broker||"未知券商",price:next.price,activeRate:next.rate,basis:target}}
function primaryRow(stock){const valid=correctedRows(stock.code,stock.brokers||[]).filter(x=>Number(x.target)>0&&within360(x.date));if(!valid.length)return null;if(stock.primaryBrokerKey){const selected=valid.find(x=>(x.brokerKey||x.broker)===stock.primaryBrokerKey);if(selected)return selected}return valid.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))[0]}
function bestStage(stock){const row=primaryRow(stock);return row?stageForBroker(row,stock.last):null}
function sortedItems(type){const a=state[type].map((x,index)=>({x,index}));if(state.sortModes[type]!=="targetDistance")return a;return a.sort((u,v)=>{const a=bestStage(u.x),b=bestStage(v.x);if(!a&&!b)return u.index-v.index;if(!a)return 1;if(!b)return-1;return a.rank-b.rank||a.distance-b.distance||u.index-v.index})}
function historyRows(h,start=0,stockCode="",type="",index=-1){return h.map((y,i)=>`<div class="history-item"><span>${start+i===0?"最新":start+i===1?"前次":`第${start+i+1}筆`}</span><strong>${fmt(y.target)}</strong><span>${date(y.date)}</span>${y.sourceUrl?`<a href="${esc(y.sourceUrl)}" target="_blank" rel="noopener">來源</a>`:""}</div>`).join("")}
function historyHtml(x,stockCode="",type="",index=-1){const h=(x.targetHistory?.length?x.targetHistory:[normalizeHistoryItem(x)]).slice(0,5),shown=h.slice(0,2),older=h.slice(2);return`<div class="history-list">${historyRows(shown,0,stockCode,type,index)}</div>${older.length?`<details class="target-history"><summary>較早目標價（${older.length}）</summary>${historyRows(older,2,stockCode,type,index)}</details>`:""}`}
const PERIODS=[{key:"quarter",title:"季度目標價"},{key:"annual",title:"年度目標價"},{key:"12m",title:"12個月目標價"},{key:"unknown",title:""}];
function brokerRow(x,last,primaryKey="",stockCode="",type="",index=-1){
  const b=basis(x),info=[],stage=stageForBroker(x,last),isPrimary=(x.brokerKey||x.broker)===primaryKey;
  if(x.periodType&&x.periodType!=="unknown"&&x.periodLabel)info.push(`<span class="badge">${esc(x.periodLabel)}</span>`);
  if(x.revisionReason&&x.revisionReason!=="unknown"&&x.revisionReasonLabel)info.push(`<span class="badge">${esc(x.revisionReasonLabel)}</span>`);
  const rates=[.8,.85,.88],payload=encodeURIComponent(JSON.stringify({sourceUrl:x.sourceUrl||"",date:x.date||"",target:x._rawTarget??x.target,broker:x._rawBroker??x.broker,brokerKey:x.brokerKey||""}));
  return`<div class="broker-row ${isPrimary?"primary-broker":""}">
    <div class="broker-head"><div><strong>${esc(x.broker||"未知券商")}</strong>${x.manualBroker?` <button class="manual-edit" data-manual-field="broker" data-row="${payload}" data-type="${type}" data-i="${index}" title="修改或刪除手動修正">✎</button>`:""} ${isPrimary?'<span class="badge primary-badge">主要</span>':''}${x.hasNewTarget?'<span class="badge new-badge">已更新</span>':''}${x.isNewBroker?'<span class="badge new-badge">新增</span>':''}</div><strong>${fmt(x.target)}${x.manualTarget?` <button class="manual-edit" data-manual-field="target" data-row="${payload}" data-type="${type}" data-i="${index}" title="修改或刪除手動修正">✎</button>`:""}</strong></div>
    <div class="small">${date(x.date)}（${age(x.date)}）</div>
    ${info.length?`<div class="info-line">${info.join("")}</div>`:""}
    ${stage?`<div class="stage-line">${stage.label}</div>`:""}
    <div class="small">倍率基準：${fmt(b.value)}（${b.label}）</div>
    <div class="multiplier">${rates.map(rate=>`<div class="${stage&&stage.activeRate===rate?"active-target":""}">${Math.round(rate*100)}%<br><strong>${fmt(b.value*rate)}</strong></div>`).join("")}</div>
    ${historyHtml(x,stockCode,type,index)}
    <div class="row-actions">${x.sourceUrl?`<a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener">查看最新來源</a>`:""}<button class="repair-button" data-repair data-row="${payload}" data-type="${type}" data-i="${index}">修正</button></div>
  </div>`}
function periodGroups(list,typeName,last,primaryKey="",stockCode="",listType="",index=-1){const eligible=(list||[]).filter(x=>x.brokerType===typeName&&Number(x.target)>0&&within360(x.date));if(!eligible.length)return'<div class="small">近期無目標價</div>';return PERIODS.map(p=>{const a=eligible.filter(x=>(x.periodType||"unknown")===p.key);return a.length?`<div class="period-group">${p.title?`<h4>${p.title}</h4>`:""}${a.map(x=>brokerRow(x,last,primaryKey,stockCode,listType,index)).join("")}</div>`:""}).join("")}
function brokerSelect(list,selected,type,index){if(!type)return"";const opts=(list||[]).filter(x=>Number(x.target)>0&&within360(x.date)).map(x=>({key:x.brokerKey||x.broker,label:x.broker||"未知券商"})).filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i);if(!opts.length)return"";return`<label class="primary-broker-select">主要券商<select data-primary-broker data-type="${type}" data-i="${index}"><option value="">自動選擇</option>${opts.map(o=>`<option value="${o.key}" ${o.key===selected?"selected":""}>${o.label}</option>`).join("")}</select></label>`}
function targetSections(list,last,refreshButton="",stock=null,type="",index=-1){const code=stock?.code||searched?.code||"",rows=correctedRows(code,list),primaryKey=stock?.primaryBrokerKey||"";return`<div class="target-title"><h3>目標價</h3>${refreshButton}</div>${brokerSelect(rows,primaryKey,type,index)}<div class="broker-section"><h3>外資券商</h3>${periodGroups(rows,"外資",last,primaryKey,code,type,index)}</div><div class="broker-section"><h3>本土券商</h3>${periodGroups(rows,"本土",last,primaryKey,code,type,index)}</div><div class="broker-section"><h3>未知券商</h3>${periodGroups(rows,"未知",last,primaryKey,code,type,index)}</div>`}
const icon=(kind,type,index,label)=>`<button class="icon-button ${kind}" data-type="${type}" data-i="${index}" aria-label="${label}" title="${label}"><span aria-hidden="true">${kind==="remove-one"?"×":"↻"}</span></button>`;
function changeHtml(x){const s=x.change>0?"+":"",c=x.change>0?"positive":x.change<0?"negative":"";return`<div class="price-change ${c}">${x.change==null?"—":`${s}${fmt(x.change)}（${s}${fmt(x.changePct)}%）`}</div>`}
function card(x,index,type){const key=`${type}:${x.code}`,open=expanded[type].has(key),stage=bestStage(x),custom=state.sortModes[type]==="custom";return`<article class="stock-card ${open?"expanded":""}" data-key="${key}" data-index="${index}" data-type="${type}" ${custom?'data-draggable="true"':''}><div class="stock-summary"><div class="stock-summary-main"><div class="stock-name">${displayName(x.name)||"—"} <span class="code">${x.code}</span></div><div class="meta">${x.market||""}｜${quoteTime(x.quoteTime)}</div>${type==="holdings"&&stage?`<div class="summary-stage" title="${esc(`${stage.broker}：${stage.label}`)}">${stage.broker}：${stage.label}</div>`:""}</div><div class="stock-price"><div class="price-line">${icon("refresh-quote",type,index,"刷新即時股價")}<div class="price">${fmt(x.last)}</div></div>${changeHtml(x)}</div><div class="summary-controls">${icon("remove-one",type,index,"刪除股票")}<button class="summary-toggle chevron-button" data-toggle="${key}" aria-expanded="${open}" aria-label="${open?"收合":"展開"}"><span class="chevron">⌄</span></button></div></div><div class="stock-detail">${targetSections(x.brokers,x.last,icon("refresh-targets",type,index,"刷新目標價"),x,type,index)}</div></article>`}
function renderList(type){const el=$(type+"List"),a=sortedItems(type);el.innerHTML=a.length?a.map(({x,index})=>card(x,index,type)).join(""):'<div class="empty">清單是空的</div>'}
function renderHistory(){const el=$("searchHistory");if(!el)return;el.innerHTML=searchHistory.length?searchHistory.map((x,i)=>`<span class="history-chip"><button class="history-search" data-history-i="${i}">${displayName(x.name)||x.code}</button><button class="history-delete" data-history-delete="${i}" aria-label="刪除 ${displayName(x.name)||x.code}">×</button></span>`).join(""):'<span class="small">尚無搜尋紀錄</span>';document.querySelectorAll("[data-history-i]").forEach(b=>b.onclick=()=>{$("stockCode").value=searchHistory[+b.dataset.historyI].code;search()});document.querySelectorAll("[data-history-delete]").forEach(b=>b.onclick=()=>{searchHistory.splice(+b.dataset.historyDelete,1);saveHistory();renderHistory()})}
function remember(x){searchHistory=searchHistory.filter(y=>y.code!==x.code);searchHistory.unshift({code:x.code,name:displayName(x.name)});searchHistory=searchHistory.slice(0,12);saveHistory();renderHistory()}
function renderAll(){renderList("holdings");renderList("watchlist");bindLists();renderHistory();document.querySelectorAll("[data-sort-list]").forEach(s=>s.value=state.sortModes[s.dataset.sortList]||"custom")}
function replaceStock(type,i,patch){state[type][i]={...state[type][i],...patch};save();renderAll()}
async function refreshQuoteOne(type,i,button){const old=state[type][i],key=`q:${type}:${i}`;if(busy.has(key))return;busy.add(key);button?.classList.add("spinning");try{const q=await quote(old.code);replaceStock(type,i,{...q,brokers:old.brokers,lastRefresh:new Date().toISOString()});status(`${old.name||old.code} 股價已刷新`)}catch(e){status(e.message,true)}finally{busy.delete(key)}}
async function refreshTargetsOne(type,i,button){const old=state[type][i],key=`t:${type}:${i}`;if(busy.has(key))return;busy.add(key);button?.classList.add("spinning");try{const rows=await targets(old.code,old.name);replaceStock(type,i,{brokers:merge(old.brokers,rows),targetError:"",lastTargetRefresh:new Date().toISOString()});status(`${old.name||old.code} 目標價已刷新`)}catch(e){status(e.message,true)}finally{busy.delete(key)}}
function bindLists(){document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=e=>{if(e.target.closest(".icon-button"))return;const[type]=b.dataset.toggle.split(":");expanded[type].has(b.dataset.toggle)?expanded[type].delete(b.dataset.toggle):expanded[type].add(b.dataset.toggle);renderAll()});document.querySelectorAll(".refresh-quote").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();refreshQuoteOne(b.dataset.type,+b.dataset.i,b)});document.querySelectorAll(".refresh-targets").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();refreshTargetsOne(b.dataset.type,+b.dataset.i,b)});document.querySelectorAll(".remove-one").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();const type=b.dataset.type,i=+b.dataset.i;if(confirm(`確定刪除 ${state[type][i]?.name||state[type][i]?.code}？`)){state[type].splice(i,1);save();renderAll()}});document.querySelectorAll("[data-primary-broker]").forEach(sel=>sel.onchange=()=>{const type=sel.dataset.type,i=+sel.dataset.i;state[type][i].primaryBrokerKey=sel.value;save();renderAll()});
document.querySelectorAll("[data-repair]").forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  const row=JSON.parse(decodeURIComponent(b.dataset.row)),type=b.dataset.type||"",i=Number(b.dataset.i);
  const choice=prompt("輸入修正類型：\n1＝目標價錯誤\n2＝券商錯誤\n3＝目標價過舊","1");
  if(choice==="1")await repairRow(type,i,row,"target");
  else if(choice==="2")await repairRow(type,i,row,"broker");
  else if(choice==="3")await repairRow(type,i,row,"old");
});
document.querySelectorAll("[data-manual-field]").forEach(b=>b.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  const row=JSON.parse(decodeURIComponent(b.dataset.row));
  editManualCorrection(b.dataset.type||"",Number(b.dataset.i),row,b.dataset.manualField);
});
bindDrag()}
function show(x){searched=x;remember(x);$("searchResult").classList.remove("hidden");$("searchResult").innerHTML=`<div class="search-result-head"><div><div class="stock-name">${displayName(x.name)} <span class="code">${x.code}</span></div><div class="meta">${x.market}｜${quoteTime(x.quoteTime)}</div></div><div class="stock-price"><div class="price-line"><button id="searchQuoteRefresh" class="icon-button" aria-label="刷新即時股價"><span>↻</span></button><div class="price">${fmt(x.last)}</div></div>${changeHtml(x)}</div></div>${targetSections(x.brokers,x.last,'<button id="searchTargetsRefresh" class="icon-button" aria-label="刷新目標價"><span>↻</span></button>')}<div class="actions"><button id="addH">加入持股</button><button id="addW" class="secondary">加入觀察</button></div>`;$("addH").onclick=()=>add("holdings");$("addW").onclick=()=>add("watchlist");$("searchQuoteRefresh").onclick=async e=>{const b=e.currentTarget;b.classList.add("spinning");try{const q=await quote(searched.code);searched={...searched,...q};show(searched);status(`${searched.name} 股價已刷新`)}catch(err){status(err.message,true)}};$("searchTargetsRefresh").onclick=async e=>{const b=e.currentTarget;b.classList.add("spinning");try{searched.brokers=merge(searched.brokers,await targets(searched.code,searched.name));show(searched);status(`${searched.name} 目標價已刷新`)}catch(err){status(err.message,true)}}}
function add(type){if(state[type].some(x=>x.code===searched.code))return status("清單中已存在");state[type].push({...searched});save();renderAll();goPage(type);status("已加入清單")}
async function search(){const q=$("stockCode").value.trim();if(!q)return status("請輸入股票名稱或代碼",true);$("searchButton").disabled=true;status("正在更新股價與各券商目標價…");try{const x=await load(q);show(x);status(`更新成功：${x.name}`)}catch(e){status(e.message,true)}finally{$("searchButton").disabled=false}}
function bindDrag(){
  document.querySelectorAll('[data-draggable="true"]').forEach(card=>{
    let timer=null,dragging=false,pointerId=null,startY=0,grabOffset=0,placeholder=null;
    const type=card.dataset.type,container=$(type+"List"),handle=card.querySelector(".stock-summary-main");
    if(!handle||!container)return;
    const resetCard=()=>{
      card.style.position="";card.style.left="";card.style.top="";card.style.width="";card.style.height="";
      card.style.margin="";card.style.transform="";card.style.pointerEvents="";
      card.classList.remove("dragging","drag-ready");
    };
    const cleanup=()=>{
      clearTimeout(timer);timer=null;
      document.removeEventListener("pointermove",move,{passive:false});
      document.removeEventListener("pointerup",end);
      document.removeEventListener("pointercancel",end);
      document.body.classList.remove("sorting-active");
      if(pointerId!=null){try{card.releasePointerCapture(pointerId)}catch{}}
      pointerId=null;
    };
    const beginDrag=e=>{
      const r=card.getBoundingClientRect();
      dragging=true;grabOffset=e.clientY-r.top;
      placeholder=document.createElement("div");
      placeholder.className="stock-card-placeholder";
      placeholder.style.height=`${r.height}px`;
      container.insertBefore(placeholder,card);
      card.classList.remove("drag-ready");card.classList.add("dragging");
      Object.assign(card.style,{position:"fixed",left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`,margin:"0",transform:"none",pointerEvents:"none"});
      document.body.classList.add("sorting-active");
      navigator.vibrate?.(25);
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
      timer=setTimeout(()=>beginDrag(e),360);
    };
    const move=e=>{
      if(e.pointerId!==pointerId)return;
      if(!dragging){
        if(Math.abs(e.clientY-startY)>18){clearTimeout(timer);card.classList.remove("drag-ready");}
        return;
      }
      e.preventDefault();
      card.style.top=`${e.clientY-grabOffset}px`;
      const items=[...container.querySelectorAll(".stock-card:not(.dragging)")];
      const before=items.find(el=>e.clientY<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
      if(before)container.insertBefore(placeholder,before);else container.appendChild(placeholder);
      const edge=64;
      if(e.clientY<edge)window.scrollBy({top:-10,behavior:"auto"});
      else if(e.clientY>window.innerHeight-edge)window.scrollBy({top:10,behavior:"auto"});
    };
    const end=e=>{
      if(e.pointerId!==pointerId)return;
      clearTimeout(timer);
      if(dragging){
        dragging=false;
        if(placeholder){container.insertBefore(card,placeholder);placeholder.remove();placeholder=null;}
        resetCard();
        const codes=[...container.querySelectorAll(".stock-card")].map(el=>el.dataset.key.split(":").slice(1).join(":"));
        state[type].sort((a,b)=>codes.indexOf(a.code)-codes.indexOf(b.code));
        save();renderAll();
      }else card.classList.remove("drag-ready");
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
