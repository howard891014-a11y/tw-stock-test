/* StockZone Capital Flow — independent presentation layer. No XY/Phase/Path requests. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const state={summary:null,detail:null,opened:'',loading:false,lastFetch:0,query:'',scope:'all',filter:'returning',sort:'auto',limit:10,stockFilter:'core',stockSort:'buy',period:'5',sequence:0};
const n=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const signed=(v,{pct=false,d=1}={})=>{const x=n(v);return x===null?'—':`${x>0?'+':''}${x.toFixed(d)}${pct?'%':''}`;};
const tone=v=>n(v)===null?'neutral':Number(v)>0?'up':Number(v)<0?'down':'neutral';
const scopeText=v=>String(v||'').includes('technology')?'科技':v==='electronics-product'?'電子產品':'傳產／金融';
function cfTradeDate(v){
 const s=String(v||'').trim();
 const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(iso)return iso[0];
 const explicit=s.match(/\b(20\d{2})\b/);if(explicit){const d=new Date(s);return Number.isNaN(+d)?'--':d.toISOString().slice(0,10);}
 const m=s.match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i);
 if(m){
  const year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Taipei',year:'numeric'}).format(new Date()));
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].toLowerCase())+1;
  const today=Date.now();
  const nearest=[year-1,year,year+1].map(y=>({y,d:Date.UTC(y,month-1,Number(m[2]))})).sort((a,b)=>Math.abs(a.d-today)-Math.abs(b.d-today))[0];
  return `${nearest.y}-${String(month).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;
 }
 return '--';
}
const marketText=m=>!m?.aligned?'大盤資料未同步':m.regime==='RiskOff'?'大盤・風險防禦':m.regime==='RiskOn'?'大盤・風險偏好':'大盤・狀態待定';
const labelSort={money:'法人近5日淨額',x:'中期資金強度',momentum:'近3日強度變化',breadth:'核心資金廣度'};
const modeHelp={
  all:{title:'全部產業｜查看整體資金分布',description:'不依資金狀態篩選；可比較各產業的中期資金強度與近5日法人淨額。包含方向不明或資料尚未齊全的產業。'},
  returning:{title:'資金回流｜觀察中期偏弱、近期流入的產業',description:'中期資金強度≤0、近5日法人淨額>0。中期尚未轉強，但近期有資金流入；不代表資金剛由流出轉為流入，也不表示適合買進。'},
  aligned:{title:'強勢延續｜觀察中期強、近期也流入的產業',description:'中期資金強度>0、近5日法人淨額>0。中期與近期資金方向相同；不保證未來持續走強。'},
  warning:{title:'轉弱警訊｜觀察中期仍強、近期卻流出的產業',description:'中期資金強度>0、近5日法人淨額<0。中期仍偏強但近期有資金流出；提醒觀察，不等於已確認反轉。'},
  weak:{title:'弱勢延續｜觀察中期弱、近期也流出的產業',description:'中期資金強度≤0、近5日法人淨額<0。中期與近期資金皆偏弱；不代表一定會繼續下跌。'}
};
const scopeLabels={all:'全部產業',tech:'科技／電子',traditional:'傳產／金融'};
const autoSort={all:'money',returning:'momentum',aligned:'money',warning:'money',weak:'money'};
function effectiveSort(){return state.sort==='auto'?(autoSort[state.filter]||'money'):state.sort;}
function outflowMode(){return state.filter==='warning'||state.filter==='weak';}
function sortDescending(key){return !(outflowMode()&&(key==='money'||key==='momentum'||key==='x'));}
function modeSortSentence(){const key=effectiveSort(),reverse=outflowMode();
  if(key==='money')return reverse?'依法人近5日淨流出金額由多到少排列，先看近期流出較大的產業。':'依法人近5日淨流入金額由多到少排列，先看近期流入較大的產業。';
  if(key==='momentum')return reverse?'依近3日強度變化由低到高排列，先看中期強度惡化較多的產業。':'依近3日強度變化由高到低排列，先看中期強度改善較多的產業（不是法人金額的加速度）。';
  if(key==='x')return reverse?'依中期資金強度由低到高排列，先看中期強度較弱的產業。':'依中期資金強度由高到低排列，先看中期強度較強的產業。';
  if(reverse)return '依核心公司5日賣超家數占比由高到低排列，先看賣壓較普遍的產業。';
  return '依核心公司5日買超家數占比由高到低排列，先看買盤較普遍的產業。';
}
function refreshObserveHelp(count){
  const info=modeHelp[state.filter]||modeHelp.all,key=effectiveSort(),auto=state.sort==='auto';
  const title=$('cfObserveTitle'),desc=$('cfObserveDescription'),order=$('cfSortExplanation'),cond=$('cfCombinationExplain');
  if(title)title.textContent=info.title;
  if(desc)desc.textContent=info.description;
  if(order)order.textContent=`${auto?'自動排序':'自訂排序'}：${modeSortSentence()}`;
  const scope=scopeLabels[state.scope]||scopeLabels.all;
  if(cond)cond.textContent=state.query.trim()?`搜尋「${state.query.trim()}」：列出所有相關產業（搜尋時暫不限制觀察狀態與產業範圍），共 ${count} 個產業。`:`目前條件：${scope}・${state.filter==='all'?'全部狀態':({'returning':'資金回流','aligned':'強勢延續','warning':'轉弱警訊','weak':'弱勢延續'}[state.filter]||'全部')}・${auto?'依觀察目的自動排序':labelSort[key]}${state.query.trim()?'・搜尋「'+state.query.trim()+'」':''}。${count} 個產業符合條件。`;
  const scopeSel=$('cfScopeSelect'),sortSel=$('cfSortSelect');if(scopeSel)scopeSel.value=state.scope;if(sortSel)sortSel.value=state.sort;
}
function setStatus(msg,problem=false){const el=$('cfState');if(el){el.textContent=problem?msg:'';el.hidden=!problem;el.classList.toggle('cf-error',problem);}}
function pill(label,value,opts={}){return `<div class="cf-stat"><small>${label}</small><b class="${opts.signed?'cf-'+tone(value):''}">${opts.text||signed(value,{pct:!!opts.percent,d:opts.d??1})}</b>${opts.sub?`<em>${opts.sub}</em>`:''}</div>`;}
function note(s){return esc(String(s||'').split('。')[0]||'資料正在整理');}
function setButtons(which,key){document.querySelectorAll(`[data-cf-${which}]`).forEach(b=>{const on=b.dataset[`cf${which.charAt(0).toUpperCase()+which.slice(1)}`]===key;b.classList.toggle('is-on',on);b.setAttribute('aria-pressed',String(on));});}
// Monetary TOP10 is a separate cached model. Existing flow1Pct/flow5Pct/中期資金強度,
// sector strength and smart-selection signals are intentionally untouched.
function top10Group(rows,positive){
  const key=state.period==='1'?'money1E8':'money5E8';
  const label=state.period==='1'?'今日':'近5日';
  const choices=rows.filter(s=>n(s[key])!==null&&(positive?s[key]>0:s[key]<0));
  choices.sort((a,b)=>positive?(b[key]-a[key])||String(a.tagId).localeCompare(String(b.tagId)):(a[key]-b[key])||String(a.tagId).localeCompare(String(b.tagId)));
  const display=choices.slice(0,10),type=positive?'in':'out';
  return `<section class="cf-top10-group ${type}" aria-label="${label}法人淨${positive?'流入':'流出'}前十產業">
    <h3 class="cf-top10-heading">${positive?'資金流入 TOP 10':'資金流出 TOP 10'}<span class="cf-top10-direction">${positive?'▲ 流入':'▼ 流出'}</span></h3>
    <small class="cf-top10-caption">${label}法人估算淨額（億元）</small>
    ${display.length?display.map((s,i)=>`<button class="cf-top10-row" type="button" data-cf-open="${esc(s.tagId)}" title="${esc(s.name)}｜${signed(s[key],{d:1})}億元｜點選查看產業成分股"><span class="cf-top10-rank">${i+1}</span><span class="cf-top10-name">${esc(s.name)}</span><strong class="cf-top10-flow">${signed(s[key],{d:1})}億</strong></button>`).join(''):'<div class="cf-top10-empty">此期間沒有符合條件的產業</div>'}
  </section>`;
}
function summaryCards(){
  const data=state.summary,rows=data?.sectors||[],money=data?.capitalMoney;
  const key=state.period==='1'?'money1E8':'money5E8';
  const eligible=rows.filter(s=>n(s[key])!==null&&Number(s[state.period==='1'?'moneyCoreValid1':'moneyCoreValid5'])>0);
  const ready=!!money?.ready&&money.asOf===cfTradeDate(data?.asOf);
  $('cfMetrics').innerHTML=ready?
    (top10Group(eligible,true)+top10Group(eligible,false)+
      `<small class="cf-top10-note">法人資金為股域 StockZone 整理、調整後的估算數據，僅供觀察，非實際成交金額。</small>`):
    `<div class="cf-top10-empty" style="grid-column:1/-1">法人金額資料尚未同步完成，暫不以舊版比例替代。可稍後重新整理。</div>`;
  const market=$('cfMarket');if(market)market.textContent=marketText(data?.market);
  const dateString=cfTradeDate(data?.asOf);
  for(const id of ['cfAsOfBadge','cfSectorDateBadge']){const date=$(id);if(date){date.textContent=dateString;date.dateTime=dateString==='--'?'':dateString;}}
  document.querySelectorAll('[data-cf-period]').forEach(b=>{const on=b.dataset.cfPeriod===state.period;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
}
function corePct(s){const v=n(s.moneyCoreValid5),b=n(s.moneyCoreBuy5);return v>0&&b!==null?100*b/v:null;}
function isMoneyReady(){return !!state.summary?.capitalMoney?.ready&&state.summary.capitalMoney.asOf===cfTradeDate(state.summary?.asOf);}
function filtered(){const list=state.summary?.sectors||[];const searching=!!state.query.trim();let rows=list.filter(s=>{
  if(!searching&&state.scope==='tech'&&!['technology-fine','electronics-product'].includes(s.scope))return false;
  if(!searching&&state.scope==='traditional'&&s.scope!=='traditional-coarse')return false;
  if(!searching&&state.filter!=='all'&&s.observation?.key!==state.filter)return false;
  const q=state.query.trim().toLowerCase();return !q||[s.name,s.parentName,s.tagId,s.stockSearchText].some(t=>String(t||'').toLowerCase().includes(q));
 });
 const selected=effectiveSort(),reverse=outflowMode();
 const value=s=>{
   if(selected==='money')return n(s.money5E8);
   if(selected==='breadth'){
     const v=n(s.moneyCoreValid5),part=n(reverse?s.moneyCoreSell5:s.moneyCoreBuy5);
     return v>0&&part!==null?100*part/v:null;
   }
   if(selected==='momentum')return n(s.dx3);
   return n(s.x);
 };
 const desc=sortDescending(selected);
 rows.sort((a,b)=>{
   const av=value(a),bv=value(b);
   if(av===null&&bv!==null)return 1;
   if(av!==null&&bv===null)return -1;
   if(av!==null&&bv!==null&&av!==bv)return desc?bv-av:av-bv;
   const ma=n(a.money5E8),mb=n(b.money5E8);
   if(ma!==null&&mb!==null&&ma!==mb)return reverse?ma-mb:mb-ma;
   return String(a.tagId).localeCompare(String(b.tagId));
 });
 return rows;
}
function rowHtml(s,i){
 const breadth=corePct(s),b=breadth===null?0:Math.max(0,Math.min(100,breadth)),v=Number(s.moneyCoreValid5)||0;
 const status=s.observation||{key:'unknown',label:'待補資料'};
 const label=status.key==='aligned'?'強勢延續':status.key==='returning'?'資金回流':status.key==='warning'?'轉弱警訊':status.key==='weak'?'弱勢延續':status.label;
 return `<button type="button" class="cf-sector" data-cf-open="${esc(s.tagId)}" aria-label="查看${esc(s.name)}的產業資金觀察與成分股">
 <div class="cf-row-head"><span class="cf-rank">${String(i+1).padStart(2,'0')}</span><span class="cf-row-title"><b>${esc(s.name)}</b><small>${esc(scopeText(s.scope))} · ${s.valid}/${s.members} 家成分股有效</small></span><span class="cf-status cf-status-${esc(status.key)}">${esc(label)}</span><span class="cf-chevron">›</span></div>
 <div class="cf-row-grid"><div><small>中期強度</small><strong class="cf-${tone(s.x)}">${signed(s.x,{d:1})}</strong></div><div><small>5日法人淨額</small><strong class="cf-${tone(s.money5E8)}">${signed(s.money5E8,{d:1})}${n(s.money5E8)===null?'':'億'}</strong></div><div><small>3日強度變化</small><strong class="cf-${tone(s.dx3)}">${signed(s.dx3)}</strong></div><div><small>核心買超占比</small><strong>${breadth===null?'—':breadth.toFixed(0)+'%'}</strong></div></div>
 <div class="cf-breadth-track"><i style="width:${b}%"></i></div><div class="cf-row-bottom"><span>${esc(note(s.reading))}。</span><b>${v<3?'個股主導・': ''}核心公司 ${v} 家</b></div>
 </button>`;
}
function renderList(){const data=state.summary;if(!data)return;summaryCards();const rows=filtered(),shown=rows.slice(0,state.limit);
 refreshObserveHelp(rows.length);
 $('cfList').innerHTML=shown.map(rowHtml).join('')||'<div class="cf-empty">目前沒有符合條件的產業。可切換觀察狀態查看其他產業。</div>';
 const more=$('cfMore');more.hidden=rows.length<=10;more.textContent=state.limit===10?'顯示更多產業':'收合產業列表';
 setButtons('filter',state.filter);
}
function detailStockHtml(s,i){
 const money=n(s.money5RawE8);
 return `<div class="cf-stock"><div class="cf-stock-head"><span class="cf-stock-index">${String(i+1).padStart(2,'0')}</span><span class="cf-stock-name"><b>${esc(s.name)}</b><small>${esc(s.code)} · ${s.importance==='core'?'核心公司':'相關公司'}</small></span><span class="cf-stock-badge cf-stock-badge-${esc(s.importance)}">${s.importance==='core'?'核心':'相關'}</span></div>
 <div class="cf-stock-values"><span><small>法人5日淨額</small><strong class="cf-${tone(money)}">${signed(money,{d:2})}${money===null?'':'億'}</strong></span><span><small>法人5日比</small><strong class="cf-${tone(s.flow5Pct)}">${signed(s.flow5Pct,{pct:true})}</strong></span><span><small>股價近5日</small><strong class="cf-${tone(s.return5Pct)}">${signed(s.return5Pct,{pct:true})}</strong></span><span><small>股價近20日</small><strong class="cf-${tone(s.return20Pct)}">${signed(s.return20Pct,{pct:true})}</strong></span></div></div>`;
}
function stockSort(stocks){return stocks.sort((a,b)=>{
 const av=n(a.money5RawE8),bv=n(b.money5RawE8);
 if(state.stockSort==='sell')return (av??1e14)-(bv??1e14);
 if(state.stockSort==='flow')return (n(b.flow5Pct)??-1e14)-(n(a.flow5Pct)??-1e14);
 return (bv??-1e14)-(av??-1e14);
 });}
function renderDetail(){const d=state.detail;if(!d)return;const s=d.sector;
 const stocks=d.stocks.filter(x=>state.stockFilter==='all'||x.importance===state.stockFilter),sorted=stockSort(stocks);
 const v=Number(s.moneyCoreValid5)||0,buy=Number(s.moneyCoreBuy5)||0,sell=Number(s.moneyCoreSell5)||0;
 const badge=v<3?'・個股主導':'',o=s.observation?.key==='warning'?'轉弱警訊':(s.observation?.label||'待補資料');
 $('cfDetailTitle').textContent=s.name;
 $('cfDetailMeta').textContent=`${scopeText(s.scope)} · ${s.members} 家成分股 · 資料日 ${d.asOf||'--'} · ${o}${badge}`;
 $('cfDetailKPIs').innerHTML=`${pill('法人5日估算淨額',s.money5E8,{signed:true,d:2,sub:'億元・核心＋相關'})}${pill('核心公司歸屬',s.moneyCore5E8,{signed:true,d:2,sub:'億元・分配後'})}${pill('相關公司歸屬',s.moneyRelated5E8,{signed:true,d:2,sub:'億元・分配後'})}${pill('中期資金強度',s.x,{signed:true,sub:'原模型，未修改'})}${pill('近3日強度變化',s.dx3,{signed:true,sub:s.momentum.label})}${pill('產業近5日漲幅',s.price5Pct,{signed:true,percent:true,sub:'價格已實現變動'})}`;
 $('cfCoreBreadth').textContent=v?`核心公司近5日：買超 ${buy}/${v} 家・賣超 ${sell}/${v} 家${v<3?'；樣本少，屬個股主導':''}`:'近5日核心資金廣度資料待補';
 $('cfReading').textContent=s.reading;
 $('cfPotentialCount').textContent=`共 ${d.stocks.length} 家 · 核心 ${d.stocks.filter(x=>x.importance==='core').length} 家 / 相關 ${d.stocks.filter(x=>x.importance==='related').length} 家`;
 document.querySelectorAll('[data-cf-stock-filter]').forEach(btn=>{const on=btn.dataset.cfStockFilter===state.stockFilter;btn.classList.toggle('is-on',on);btn.setAttribute('aria-pressed',String(on));});
 $('cfStockList').innerHTML=sorted.map(detailStockHtml).join('')||'<div class="cf-empty">此分類沒有對應的成分股資料。</div>';
 $('cfStockListTotal').textContent=`顯示 ${sorted.length} / ${d.stocks.length} 家`;
 $('cfStockSort').value=state.stockSort;
 const path=d.history||[],xvalues=path.map(z=>z.x).filter(v=>v!==null);
 $('cfTrend').innerHTML=`<div class="cf-trend-title"><b>中期資金強度・近${path.length}個交易日</b></div>${sparkline(path,'x',xvalues)}<div class="cf-trend-dates"><span>${esc(path[0]?.date||'')}</span><span>${esc(path.at(-1)?.date||'')}</span></div><div class="cf-mini-legend">● 中期強度走勢　　產業5日股價 ${signed(s.price5Pct,{pct:true})}</div>`;
}
function sparkline(data,key,values){if(values.length<2)return '<p class="cf-empty">歷史資料不足</p>';const mi=Math.min(0,...values),ma=Math.max(0,...values),range=Math.max(1,ma-mi),w=720,h=120;
 const pts=data.map((r,i)=>({x:20+i*680/Math.max(1,data.length-1),y:r[key]===null?null:108-(r[key]-mi)/range*92}));
 const segments=[];let curr=[];for(const p of pts){if(p.y===null){if(curr.length>1)segments.push(curr);curr=[];}else curr.push(p);}if(curr.length>1)segments.push(curr);
 const zeroY=108-(0-mi)/range*92;
 return `<svg class="cf-spark" role="img" aria-label="產業資金強度歷史走勢" viewBox="0 0 720 120" preserveAspectRatio="none"><line x1="16" x2="704" y1="${zeroY.toFixed(2)}" y2="${zeroY.toFixed(2)}" stroke="#d6e3ed" stroke-dasharray="5 6"/>${segments.map(a=>`<polyline fill="none" stroke="#437fae" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${a.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}"/>`).join('')}${pts.filter(p=>p.y!==null).slice(-1).map(p=>`<circle r="5" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" fill="#3678ad" stroke="white" stroke-width="2"/>`).join('')}</svg>`;
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
 try{const res=await fetch(`/api/capital-flow?view=detail&tagId=${encodeURIComponent(id)}`);const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'資料讀取失敗');if(serial!==state.sequence||state.opened!==id)return;state.detail=data;state.stockFilter='core';state.stockSort='buy';renderDetail();}
 catch(e){if(serial===state.sequence){$('cfDetailTitle').textContent='載入失敗';$('cfStockList').innerHTML=`<div class="cf-empty">${esc(e.message)}</div>`;}}
}
function back(){++state.sequence;state.opened='';state.detail=null;$('cfDetail').hidden=true;$('cfOverview').hidden=false;renderList();$('cfOverview').scrollIntoView({behavior:'smooth',block:'start'});}
function init(){if(!$('cfOverview'))return;
 $('cfRefresh')?.addEventListener('click',()=>load(true));
 $('cfSearch')?.addEventListener('input',e=>{state.query=e.target.value||'';state.limit=10;renderList()});
 $('cfScopeSelect')?.addEventListener('change',e=>{state.scope=e.target.value;state.limit=10;renderList()});
 $('cfSortSelect')?.addEventListener('change',e=>{state.sort=e.target.value;state.limit=10;renderList()});
 document.querySelectorAll('[data-cf-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.cfFilter;state.sort='auto';state.limit=10;renderList()}));
 $('cfMore')?.addEventListener('click',()=>{state.limit=state.limit===10?Number.MAX_SAFE_INTEGER:10;renderList()});
 $('cfList')?.addEventListener('click',e=>{const item=e.target.closest('[data-cf-open]');if(item)void open(item.dataset.cfOpen)});
 $('cfMetrics')?.addEventListener('click',e=>{const item=e.target.closest('[data-cf-open]');if(item)void open(item.dataset.cfOpen)});
 document.querySelectorAll('[data-cf-period]').forEach(b=>b.addEventListener('click',()=>{state.period=b.dataset.cfPeriod==='1'?'1':'5';if(state.summary)summaryCards()}));
 $('cfBack')?.addEventListener('click',back);
 document.querySelectorAll('[data-cf-stock-filter]').forEach(b=>b.addEventListener('click',()=>{state.stockFilter=b.dataset.cfStockFilter;renderDetail()}));
 $('cfStockSort')?.addEventListener('change',e=>{state.stockSort=e.target.value;renderDetail()});
}
window.StockZoneCapital={load,refresh:()=>load(true),init,back};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
