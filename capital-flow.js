/* StockZone Capital Flow — independent presentation layer. No XY/Phase/Path requests. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const state={summary:null,detail:null,opened:'',loading:false,lastFetch:0,query:'',scope:'all',filter:'all',sort:'x',limit:32,stockFilter:'candidates',stockSort:'gap',sequence:0,stockMatches:[],searchPending:false,searchError:false};
const n=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const signed=(v,{pct=false,d=1}={})=>{const x=n(v);return x===null?'—':`${x>0?'+':''}${x.toFixed(d)}${pct?'%':''}`;};
const tone=v=>n(v)===null?'neutral':Number(v)>0?'up':Number(v)<0?'down':'neutral';
const scopeText=v=>String(v||'').includes('technology')?'科技':v==='electronics-product'?'電子產品':'傳產／金融';
const marketText=m=>!m?.aligned?'大盤資料未同步':m.regime==='RiskOff'?'大盤・風險防禦':m.regime==='RiskOn'?'大盤・風險偏好':'大盤・狀態待定';
const labelSort={x:'中期資金',momentum:'資金動能',breadth:'資金廣度',candidate:'個股機會'};
function setStatus(msg,problem=false){const el=$('cfState');if(el){el.textContent=msg;el.classList.toggle('cf-error',problem);}}
function pill(label,value,opts={}){return `<div class="cf-stat"><small>${label}</small><b class="${opts.signed?'cf-'+tone(value):''}">${opts.text||signed(value,{pct:!!opts.percent,d:opts.d??1})}</b>${opts.sub?`<em>${opts.sub}</em>`:''}</div>`;}
function note(s){return esc(String(s||'').split('。')[0]||'資料正在整理');}
function setButtons(which,key){document.querySelectorAll(`[data-cf-${which}]`).forEach(b=>{const on=b.dataset[`cf${which.charAt(0).toUpperCase()+which.slice(1)}`]===key;b.classList.toggle('is-on',on);b.setAttribute('aria-pressed',String(on));});}
function summaryCards(){const rows=state.summary?.sectors||[],valid=rows.filter(s=>s.x!==null&&s.flow5Pct!==null),inflow=valid.filter(s=>s.flow5Pct>0),improving=valid.filter(s=>s.dx3!==null&&s.dx3>=3),wide=valid.filter(s=>s.breadthPct!==null&&s.breadthPct>=60&&s.flow5Pct>0),chances=valid.reduce((a,s)=>a+(s.opportunityCount||0),0);
  $('cfMetrics').innerHTML=`${pill('法人近5日淨流入產業',inflow.length,{text:String(inflow.length),sub:`共 ${valid.length} 個有效產業`})}${pill('資金動能改善',improving.length,{text:String(improving.length),sub:'X20近3日增加≥3'})}${pill('資金廣泛流入',wide.length,{text:String(wide.length),sub:'買超廣度≥60%'})}${pill('資金先行個股',chances,{text:String(chances),sub:'候選數・可能跨產業重複'})}`;
  $('cfMarket').textContent=marketText(state.summary?.market);$('cfAsOf').textContent=state.summary?.asOf?`資料日 ${state.summary.asOf.replaceAll('-','/')}`:'資料待補';
}
function filtered(){const list=state.summary?.sectors||[];const matched=new Set(state.stockMatches);let rows=list.filter(s=>{
   if(state.scope==='tech'&&!['technology-fine','electronics-product'].includes(s.scope))return false;
   if(state.scope==='traditional'&&s.scope!=='traditional-coarse')return false;
   if(state.filter==='inflow'&&!(s.flow5Pct>0))return false;
   if(state.filter==='reverse'&&!(state.summary?.market?.aligned&&state.summary.market.regime==='RiskOff'&&s.x>0&&s.flow5Pct>0&&s.breadthPct>=50))return false;
   const q=state.query.trim().toLowerCase();return !q||matched.has(s.tagId)||[s.name,s.parentName,s.tagId].some(t=>String(t||'').toLowerCase().includes(q));
 });
 const val=(s)=>state.sort==='breadth'?(s.breadthPct??-10000):state.sort==='momentum'?(s.dx3??-10000):state.sort==='candidate'?((s.opportunityCount||0)*10+(s.x||0)*.05):(s.x??-10000);
 rows.sort((a,b)=>val(b)-val(a)||(b.flow5Pct??-10000)-(a.flow5Pct??-10000));return rows;
}
function rowHtml(s,i){const b=s.breadthPct===null?0:Math.max(0,Math.min(100,s.breadthPct)),positive=s.x!==null&&s.x>0;
 const status=s.flow5Pct===null?'資料待補':s.flow5Pct>0?(s.dx3>=3?'流入增強':'法人淨流入'):(s.dx3<=-3?'撤退加快':'法人淨流出');
 return `<button type="button" class="cf-sector" data-cf-open="${esc(s.tagId)}" aria-label="查看${esc(s.name)}的法人資金與個股機會">
 <div class="cf-row-head"><span class="cf-rank">${String(i+1).padStart(2,'0')}</span><span class="cf-row-title"><b>${esc(s.name)}</b><small>${esc(scopeText(s.scope))} · ${s.valid}/${s.members} 家有效</small></span><span class="cf-status ${s.flow5Pct>0?'is-positive':s.flow5Pct<0?'is-negative':''}">${esc(status)}</span><span class="cf-chevron">›</span></div>
 <div class="cf-row-grid"><div><small>X20・資金位置</small><strong class="cf-${tone(s.x)}">${signed(s.x,{d:1})}</strong></div><div><small>法人近5日</small><strong class="cf-${tone(s.flow5Pct)}">${signed(s.flow5Pct,{pct:true})}</strong></div><div><small>3日動能 ΔX</small><strong class="cf-${tone(s.dx3)}">${signed(s.dx3)}</strong></div><div><small>流入廣度</small><strong>${s.breadthPct===null?'—':s.breadthPct.toFixed(0)+'%'}</strong></div></div>
 <div class="cf-breadth-track"><i style="width:${b}%"></i></div><div class="cf-row-bottom"><span>${note(s.reading)}。</span>${s.opportunityCount?`<b>${s.opportunityCount} 檔資金先行</b>`:''}</div>
 </button>`;
}
function renderList(){const data=state.summary;if(!data)return;summaryCards();const rows=filtered(),shown=rows.slice(0,state.limit);
 $('cfCount').textContent=`${state.searchPending?'正在搜尋公司／代號… · ':''}符合 ${rows.length} 個產業・依${labelSort[state.sort]}排序`;
 $('cfList').innerHTML=shown.map(rowHtml).join('')||`<div class="cf-empty">${state.searchPending?'正在比對公司名稱及股票代號…':state.searchError?'公司搜尋暫時失敗，仍可搜尋產業名稱。':'找不到符合條件的產業或成分股，可調整搜尋文字或篩選條件。'}</div>`;
 const more=$('cfMore');more.hidden=shown.length>=rows.length;more.textContent=`顯示更多產業（${shown.length}/${rows.length}）`;
 setButtons('scope',state.scope);setButtons('sort',state.sort);setButtons('filter',state.filter);
}
function detailStockHtml(s,i){const match=s.candidate;return `<div class="cf-stock ${match?'cf-stock-match':''}">
 <div class="cf-stock-head"><span class="cf-stock-index">${String(i+1).padStart(2,'0')}</span><span class="cf-stock-name"><b>${esc(s.name)}</b><small>${esc(s.code)} · ${s.importance==='core'?'核心公司':'相關公司'}</small></span>${match?'<span class="cf-stock-badge">資金先行</span>':`<span class="cf-stock-muted">${esc(s.signal)}</span>`}</div>
 <div class="cf-stock-values"><span><small>X20</small><strong class="cf-${tone(s.x)}">${signed(s.x)}</strong></span><span><small>法人5日</small><strong class="cf-${tone(s.flow5Pct)}">${signed(s.flow5Pct,{pct:true})}</strong></span><span><small>股價5日</small><strong class="cf-${tone(s.return5Pct)}">${signed(s.return5Pct,{pct:true})}</strong></span><span><small>股價20日</small><strong class="cf-${tone(s.return20Pct)}">${signed(s.return20Pct,{pct:true})}</strong></span></div></div>`;}
function stockSort(stocks){return stocks.sort((a,b)=>{
 if(state.stockSort==='flow')return (b.flow5Pct??-999)-(a.flow5Pct??-999);
 if(state.stockSort==='price')return (a.return5Pct??999)-(b.return5Pct??999);
 return Number(b.candidate)-Number(a.candidate)||((b.flow5Pct??-999)-(a.flow5Pct??-999));
});}
function renderDetail(){const d=state.detail;if(!d)return;const s=d.sector;const candidates=d.stocks.filter(x=>x.candidate),sorted=stockSort(d.stocks.filter(x=>state.stockFilter==='all'||x.candidate));
 $('cfDetailTitle').textContent=s.name;$('cfDetailMeta').textContent=`${esc(scopeText(s.scope))}・${s.members} 家成分股・資料日 ${d.asOf||'--'}`;
 $('cfDetailKPIs').innerHTML=`${pill('X20・法人資金位置',s.x,{signed:true,sub:'沿用既有標準化X20'})}${pill('近5日法人流量',s.flow5Pct,{signed:true,percent:true,sub:'淨買賣金額／成交值'})}${pill('近3日資金動能',s.dx3,{signed:true,sub:s.momentum.label})}${pill('流入廣度',s.breadthPct,{percent:true,sub:`${s.inflowCount}/${s.breadthValid} 檔法人買超`})}`;
 $('cfCoreBreadth').textContent=s.coreBreadthPct===null?'核心公司資料不足':`核心公司流入廣度 ${signed(s.coreBreadthPct,{pct:true,d:0})}（${s.coreInflowCount}/${s.coreBreadthValid}）`;
 $('cfReading').textContent=s.reading;
 $('cfPotentialCount').textContent=`${candidates.length} 檔符合初步篩選`;
 const all=$('cfStockAll'),match=$('cfStockCandidates');all.classList.toggle('is-on',state.stockFilter==='all');match.classList.toggle('is-on',state.stockFilter==='candidates');
 $('cfStockList').innerHTML=sorted.map(detailStockHtml).join('')||'<div class="cf-empty">本產業目前沒有同時符合「法人資金流入、股價尚未大漲」條件的個股。可按「全部成分股」查看。</div>';
 $('cfStockListTotal').textContent=`顯示 ${sorted.length} / ${d.stocks.length} 家`;
 $('cfStockSort').value=state.stockSort;
 const path=d.history||[],xvalues=path.map(z=>z.x).filter(v=>v!==null),flow=path.map(z=>z.flow5Pct).filter(v=>v!==null);
 $('cfTrend').innerHTML=`<div class="cf-trend-title"><b>資金位置・近${path.length}個交易日</b><small>保留既有 X20 計算結果</small></div>${sparkline(path,'x',xvalues)}<div class="cf-trend-dates"><span>${esc(path[0]?.date||'')}</span><span>${esc(path.at(-1)?.date||'')}</span></div><div class="cf-mini-legend">● X20 強度　　近5日法人流量 ${signed(s.flow5Pct,{pct:true})}</div>`;
}
function sparkline(data,key,values){if(values.length<2)return '<p class="cf-empty">歷史資料不足</p>';const mi=Math.min(0,...values),ma=Math.max(0,...values),range=Math.max(1,ma-mi),w=720,h=120;
 const pts=data.map((r,i)=>({x:20+i*680/Math.max(1,data.length-1),y:r[key]===null?null:108-(r[key]-mi)/range*92}));
 const segments=[];let curr=[];for(const p of pts){if(p.y===null){if(curr.length>1)segments.push(curr);curr=[];}else curr.push(p);}if(curr.length>1)segments.push(curr);
 const zeroY=108-(0-mi)/range*92;
 return `<svg class="cf-spark" role="img" aria-label="產業 X20 歷史走勢" viewBox="0 0 720 120" preserveAspectRatio="none"><line x1="16" x2="704" y1="${zeroY.toFixed(2)}" y2="${zeroY.toFixed(2)}" stroke="#d6e3ed" stroke-dasharray="5 6"/>${segments.map(a=>`<polyline fill="none" stroke="#437fae" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${a.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}"/>`).join('')}${pts.filter(p=>p.y!==null).slice(-1).map(p=>`<circle r="5" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" fill="#3678ad" stroke="white" stroke-width="2"/>`).join('')}</svg>`;
}
async function load(force=false){
 if(state.loading)return;
 const current=Date.now();if(!force&&state.summary&&current-state.lastFetch<180000){renderList();return;}
 state.loading=true;setStatus('正在整理產業法人資金…');
 try{const res=await fetch(`/api/capital-flow?view=summary${force?`&refresh=${current}`:''}`,{cache:force?'no-store':'default'});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'資料讀取失敗');state.summary=data;state.lastFetch=Date.now();renderList();setStatus(`已更新・${data.asOf||''}`);if(state.opened)void open(state.opened);}
 catch(e){setStatus(`讀取失敗：${e.message}`,true);if(!state.summary)$('cfList').innerHTML='<div class="cf-empty">無法連線到資金資料，請稍後重試。</div>';}
 finally{state.loading=false;}
}
async function open(tagId){
 const id=String(tagId||'');if(!id)return;
 state.opened=id;state.detail=null;const serial=++state.sequence;
 $('cfOverview').hidden=true;$('cfDetail').hidden=false;$('cfDetailTitle').textContent='讀取產業資料中…';$('cfStockList').innerHTML='<div class="cf-empty">正在載入完整成分股的法人與股價資料…</div>';
 $('cfDetail').scrollIntoView({behavior:'smooth',block:'start'});
 try{const res=await fetch(`/api/capital-flow?view=detail&tagId=${encodeURIComponent(id)}`);const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'資料讀取失敗');if(serial!==state.sequence||state.opened!==id)return;state.detail=data;state.stockFilter='candidates';renderDetail();}
 catch(e){if(serial===state.sequence){$('cfDetailTitle').textContent='載入失敗';$('cfStockList').innerHTML=`<div class="cf-empty">${esc(e.message)}</div>`;}}
}
function back(){++state.sequence;state.opened='';state.detail=null;$('cfDetail').hidden=true;$('cfOverview').hidden=false;renderList();$('cfOverview').scrollIntoView({behavior:'smooth',block:'start'});}
let searchTimer=null;
let searchSequence=0;
function updateSearch(value){
  state.query=value;state.limit=32;state.stockMatches=[];state.searchError=false;
  if(searchTimer!==null)clearTimeout(searchTimer);
  const q=String(value||'').trim();
  const seq=++searchSequence;
  state.searchPending=Boolean(q);
  renderList();
  if(!q)return;
  // Debounced lookup maps a company name/code to every classified sector; industry-name search stays local.
  searchTimer=setTimeout(async()=>{
    try{
      const response=await fetch(`/api/capital-flow?view=search&q=${encodeURIComponent(q)}`);
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'查詢失敗');
      if(seq!==searchSequence)return;
      state.stockMatches=Array.isArray(data.tagIds)?data.tagIds:[];
    }catch(e){
      if(seq!==searchSequence)return;
      state.searchError=true;state.stockMatches=[];
    }finally{
      if(seq===searchSequence){state.searchPending=false;renderList();}
    }
  },250);
}
function init(){if(!$('cfOverview'))return;
 $('cfRefresh')?.addEventListener('click',()=>load(true));
 $('cfSearch')?.addEventListener('input',e=>updateSearch(e.target.value||''));
 document.querySelectorAll('[data-cf-scope]').forEach(b=>b.addEventListener('click',()=>{state.scope=b.dataset.cfScope;state.limit=32;renderList()}));
 document.querySelectorAll('[data-cf-sort]').forEach(b=>b.addEventListener('click',()=>{state.sort=b.dataset.cfSort;state.limit=32;renderList()}));
 document.querySelectorAll('[data-cf-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.cfFilter;state.limit=32;renderList()}));
 $('cfMore')?.addEventListener('click',()=>{state.limit+=32;renderList()});
 $('cfList')?.addEventListener('click',e=>{const item=e.target.closest('[data-cf-open]');if(item)void open(item.dataset.cfOpen)});
 $('cfBack')?.addEventListener('click',back);
 $('cfStockCandidates')?.addEventListener('click',()=>{state.stockFilter='candidates';renderDetail()});
 $('cfStockAll')?.addEventListener('click',()=>{state.stockFilter='all';renderDetail()});
 $('cfStockSort')?.addEventListener('change',e=>{state.stockSort=e.target.value;renderDetail()});
}
window.StockZoneCapital={load,refresh:()=>load(true),init,back};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
