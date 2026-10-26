/* StockZone 共振研究室 R1 — 可重現的價格資料驗證、進場視角研究候選、不可覆蓋快照。
 * 不改動正式 V4.3.1／共振價格原始計算；歷史價格基準測試不等於正式目標歷史重算。
 * Browser: window.StockZoneResonanceLab; Node: require('...')
 */
(function (root, factory) {
  const api = factory();
  // R1.4 第一階段：僅將現有三種研究「作出可追溯的研究判讀」。
  // 原本五策略公式、抽樣、歷史回測函式與 V4.3.1 的輸出完全不修改。
  if (root && root.document && typeof root.setTimeout === 'function') {
    const doc = root.document;
    const labels = {short:'短期',mixed:'短波',swing:'波段','long-swing':'長波',long:'長期'};
    const order = ['short','mixed','swing','long-swing','long'];
    const state = {report:null,bars:null,date:null,renderTimer:0};
    const el = id => doc.getElementById(id);
    const fmt = v => typeof v === 'number' && Number.isFinite(v) ? (v>0?'+':'')+v.toFixed(2)+'%' : '—';
    const safe = v => String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const style = `
      #szLabIntegrated{margin:12px 0 15px;padding:15px 14px;border:1px solid #cad8f6;
        border-radius:17px;background:linear-gradient(145deg,#f7faff,#f5f3ff);color:#263856;
        box-shadow:0 5px 17px rgba(69,100,170,.055);font-size:13px;line-height:1.65}
      #szLabIntegrated .szli-title{display:flex;align-items:center;justify-content:space-between;
        flex-wrap:wrap;gap:6px;margin-bottom:9px}
      #szLabIntegrated .szli-title b{font-size:16px;color:#263c74}
      #szLabIntegrated .szli-title small{font-size:11px;color:#64738c}
      #szLabIntegrated .szli-main{padding:10px 11px;margin-bottom:11px;background:#eaf0ff;
        border-left:3px solid #557dea;border-radius:9px;overflow-wrap:anywhere}
      #szLabIntegrated .szli-main strong{font-size:15px;color:#244dba}
      #szLabIntegrated .szli-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
      #szLabIntegrated .szli-tile{border:1px solid #e2e8f4;background:#fff;
        border-radius:10px;padding:9px 8px;min-width:0;overflow-wrap:anywhere}
      #szLabIntegrated .szli-tile small{display:block;color:#72819b;font-size:11px}
      #szLabIntegrated .szli-tile b{display:block;color:#32476e;margin:2px 0 3px;font-size:14px}
      #szLabIntegrated .szli-tile p{margin:0;color:#66738a;font-size:11.5px}
      #szLabIntegrated .szli-note{margin-top:10px;color:#6d7890;font-size:11.5px}
      #szLabOriginalReadouts{margin:8px 0 14px;padding:9px 11px;border:1px solid #e5eaf7;border-radius:11px;background:#f7f9fd}
      #szLabOriginalReadouts>summary{cursor:pointer;color:#607399;font-size:12px;font-weight:700}
      #szLabOriginalReadouts .sz-reslab-candidate,#szLabOriginalReadouts .sz-reslab-reach{margin:9px 0 0}
      @media(max-width:600px){#szLabIntegrated{padding:12px 10px}
        #szLabIntegrated .szli-grid{grid-template-columns:1fr;gap:7px}
        #szLabIntegrated .szli-tile{display:grid;grid-template-columns:70px 1fr;column-gap:5px;align-items:start}
        #szLabIntegrated .szli-tile small{grid-column:1;grid-row:1/3}
        #szLabIntegrated .szli-tile b{grid-column:2;grid-row:1;margin:0}
        #szLabIntegrated .szli-tile p{grid-column:2;grid-row:2}}
    `;
    function init(){
      const lab = doc.querySelector('.sz-reslab');
      if (!lab) return null;
      let panel = el('szLabIntegrated');
      if(!panel){
        panel=doc.createElement('section');panel.id='szLabIntegrated';
        panel.setAttribute('aria-label','三軸玩法整合研究');
        const anchor=el('szLabCandidate');
        if(anchor) lab.insertBefore(panel,anchor);else lab.appendChild(panel);
      }
      // 原本兩塊逐項文字保留可查，不再與統一摘要並排重複佔版面。
      if(!el('szLabOriginalReadouts')){
        const candidate=el('szLabCandidate'),reach=el('szLabReach');
        if(candidate&&reach){
          const details=doc.createElement('details');details.id='szLabOriginalReadouts';
          const caption=doc.createElement('summary');caption.textContent='展開原始研究候選與到達時間明細';
          details.appendChild(caption);lab.insertBefore(details,candidate);
          details.appendChild(candidate);details.appendChild(reach);
        }
      }
      if(!el('szLabIntegratedStyle')){
        const node=doc.createElement('style');node.id='szLabIntegratedStyle';node.textContent=style;
        (doc.head||doc.documentElement).appendChild(node);
      }
      return panel;
    }
    function selectBaseline(report){
      if(!report?.valid || !Array.isArray(report.results))return null;
      // 第一階段研究判讀，不是變更原回測公式：要求多數獲利、典型（中位數）獲利，
      // 再用每筆平均淨報酬／平均不利幅度比較，避免最長持有期靠少數右尾報酬霸榜。
      const eligible=report.results.filter(x=>x.stats?.avgPct>0 && x.stats?.medianPct>0 && x.stats?.winPct>=50 && x.stats?.count>=10);
      if(!eligible.length)return {key:null,reason:'18筆沒有同時符合「平均淨報酬>0、中位數>0、勝率≥50%」的玩法；不強選第一名。'};
      const sorted=eligible.map(x=>({...x,eff:x.stats.avgPct/Math.max(.01,Math.abs(x.stats.avgMaePct))}))
        .sort((a,b)=>b.eff-a.eff || a.strategy.days-b.strategy.days);
      const best=sorted[0];
      return {key:best.strategy.key,stats:best.stats,eff:best.eff,
        reason:`${best.strategy.days}日｜${best.stats.count}筆勝率 ${best.stats.winPct}%・平均淨報酬 ${fmt(best.stats.avgPct)}・中位數 ${fmt(best.stats.medianPct)}；平均不利幅度 ${fmt(best.stats.avgMaePct)}。`};
    }
    function recentInfo(){
      const s=(el('szLabCandidate')?.textContent||'');
      const m=s.match(/本次入場視角（研究候選）：(短期|短波|波段|長波|長期)｜核心傾向\s*(\d+)%/);
      return m ? {label:m[1],key:Object.keys(labels).find(k=>labels[k]===m[1]),core:Number(m[2])} : null;
    }
    function reachInfo(){
      const txt=el('szLabReach')?.textContent||'';
      const r={};
      for (const line of txt.split('\n')) {
        const m=line.match(/^(主要|次要|回測)：距現價\s*([+\-]?[\d.]+)%｜歷史同幅度20D\s*([\d.]+)%・40D\s*([\d.]+)%（(\d+)筆）/);
        if(m)r[m[1]]={distance:Number(m[2]),h20:Number(m[3]),h40:Number(m[4]),count:Number(m[5])};
      }
      return r;
    }
    function explain(baseline,recent,reach){
      if(!baseline?.key)return baseline?.reason||'請先執行五年價格基準回測，才能提出整合研究結論。';
      const base=labels[baseline.key],rt=recent?.label;
      const main=reach?.主要,secondary=reach?.次要;
      const horizon=api.STRATEGIES.find(x=>x.key===baseline.key)?.days||20;
      const comparableH=horizon<=20?20:horizon<=40?40:null;
      const more=(main&&secondary&&comparableH)?`；共振價格僅可參考歷史同幅度${comparableH}日觸及率（次要${secondary['h'+comparableH]}%、主要${main['h'+comparableH]}%），不可當作預測勝率。`:'';
      if(!rt)return `五年股性初步傾向${base}；近期候選資料不足，先不判定本次是否適合進場${more}`;
      let now;
      if (rt===base) now=`近期亦偏${rt}，兩個角度一致；進出場仍以原買賣決策條件為準`;
      else if(order.indexOf(recent.key)<order.indexOf(baseline.key)) now=`近期轉為${rt}，比五年${base}主軸短；不宜把長期優勢直接當成現在的追價依據`;
      else now=`近期偏${rt}，比五年${base}主軸長；不因此自動拉長持有期`;
      return `五年初步主軸：${base}。${now}${more}`;
    }
    function render(){
      const panel=init();if(!panel)return;
      const original=el('szLabBacktest')?.textContent||'';
      if(state.report && (original.includes('按「執行')||original.includes('無法進行價格回測'))){
        state.report=null;state.bars=null;state.date=null;
      }
      const baseline=selectBaseline(state.report),recent=recentInfo(),reach=reachInfo();
      const baselineTag=!state.report?'未回測':!baseline?.key?'無明確優勢':labels[baseline.key];
      const candidateTag=recent?.label||'資料不足';
      const candidateNote=recent?`僅當前價格條件；核心 ${recent.core}% 是候選預設值，未經倉位回測。`:'等候120根以上有效日K';
      const rMain=reach.主要,rSecondary=reach.次要;
      const reachTag=rSecondary&&rMain?`次要 ${rSecondary.distance>0?'+':''}${rSecondary.distance}%｜主要 ${rMain.distance>0?'+':''}${rMain.distance}%`:'暫無完整目標資料';
      const reachNote=rSecondary&&rMain?`歷史同幅度20日觸及：次要 ${rSecondary.h20}%／主要 ${rMain.h20}%；不是共振達標機率。`:'資料不足，不能據此推估期限';
      const summary=explain(baseline,recent,reach);
      const status=state.report?.valid?'僅供研究｜尚未接管正式玩法':'先執行一次五年回測';
      panel.innerHTML=`<div class="szli-title"><b>三軸玩法整合 · 第一階段</b><small>${safe(status)}</small></div>
        <div class="szli-main"><strong>${safe(baseline?.key?`研究主軸：${baselineTag}`:'研究判讀待確認')}</strong><div>${safe(summary)}</div></div>
        <div class="szli-grid">
          <div class="szli-tile"><small>五年整體（${state.report?.coverage?.signals??'待回測'}筆）</small><b>${safe(baselineTag)}</b><p>${safe(baseline?.reason||'保留60交易日抽樣；按下回測後比較五種策略。')}</p></div>
          <div class="szli-tile"><small>近期候選</small><b>${safe(candidateTag)}</b><p>${safe(candidateNote)}</p></div>
          <div class="szli-tile"><small>到達時間參考</small><b>${safe(reachTag)}</b><p>${safe(reachNote)}</p></div>
        </div><div class="szli-note">五年主軸採保守研究排序：平均淨報酬與中位數均為正、勝率至少50%；通過者比較平均淨報酬／平均不利幅度。這是新加入的判讀規則，非R1原始交易公式，尚未驗證能提升實際交易績效；交易玩法仍須自行確認，近期/到達時間不能直接修改原交易計畫、V4.3、W3或買賣價。</div>`;
    }
    function schedule(){root.clearTimeout(state.renderTimer);state.renderTimer=root.setTimeout(render,0);}
    // 頁面首次渲染、股票更換、近期行情或共振數值更新皆同步刷新，防止前檔結果殘留。
    function watch(){
      if(!init())return;
      const Observer=root.MutationObserver;
      if(Observer){
        for (const id of ['szLabCandidate','szLabReach','szLabBacktest']){
          const node=el(id);if(!node)continue;
          new Observer(()=>schedule()).observe(node,{childList:true,characterData:true,subtree:true});
        }
      }
      schedule();
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',watch,{once:true});else root.setTimeout(watch,0);
    const rawBacktest=api.backtestPriceBaselines;
    api.backtestPriceBaselines=function(input,options){
      const report=rawBacktest.call(this,input,options);
      // 回傳結果完全沿用原R1；只在畫面額外製作三軸研究摘要。
      state.report=report.valid?report:null;
      state.date=report.coverage?.to||null;
      schedule();
      return report;
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StockZoneResonanceLab = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';
  const VERSION = 'resonance-lab-r1.0';
  const HORIZONS = [3, 5, 10, 20, 40, 60];
  const STRATEGIES = Object.freeze([
    {key:'short',label:'短期',days:5,targetPct:5,stopPct:3.5},
    {key:'mixed',label:'短波',days:15,targetPct:10,stopPct:7},
    {key:'swing',label:'波段',days:20,targetPct:15,stopPct:9},
    {key:'long-swing',label:'長波',days:40,targetPct:23,stopPct:14},
    {key:'long',label:'長期',days:60,targetPct:30,stopPct:18}
  ]);
  const num = v => v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? +v : null);
  const valid = v => num(v) !== null && +v > 0;
  const round = (v,d=2) => Number.isFinite(v) ? +v.toFixed(d) : null;
  const pct = (a,b) => valid(a)&&valid(b) ? (a/b-1)*100 : null;
  function dateKey(raw){
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'number') return new Date(raw).toISOString().slice(0,10);
    const str = String(raw).trim();
    const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    const d = new Date(str);return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10):'';
  }
  function cleanBars(raw){
    const errors=[],out=[],duplicates=new Set();
    for(const row of Array.isArray(raw)?raw:[]){
      const date=dateKey(row?.date ?? row?.tradeDate ?? row?.trade_date),close=num(row?.close),high=num(row?.high),low=num(row?.low),open=num(row?.open);
      if(!date||!valid(open)||!valid(close)||!valid(high)||!valid(low)||high<low||close>high*1.0001||close<low*.9999||open>high*1.0001||open<low*.9999){errors.push(`異常OHLC：${date||'無日期'}`);continue}
      const normalized={date,open,high,low,close};
      if(duplicates.has(date)){errors.push(`重複日期：${date}`);continue}
      duplicates.add(date);out.push(normalized);
    }
    out.sort((a,b)=>a.date.localeCompare(b.date));
    // 極端跳空可能是未校正股票分割、減資或其他公司行動：先停止績效報表，不能直接當成報酬。
    const jumps=[];
    for(let i=1;i<out.length;i++){
      const change=pct(out[i].close,out[i-1].close);
      if(Math.abs(change)>35)jumps.push({date:out[i].date,changePct:round(change)});
    }
    return {bars:out,errors,largeJumps:jumps,valid:out.length>=150 && !jumps.length && !errors.length};
  }
  function avg(values){return values.length?values.reduce((s,v)=>s+v,0)/values.length:null}
  function median(arr){if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2}
  function pastAvg(bars,i,n){if(i+1<n)return null;let total=0;for(let j=i-n+1;j<=i;j++)total+=bars[j].close;return total/n}
  function contextAt(bars,i){
    // 只讀取 <= i 的已公開日線；不允許讀取 i+1 的任何價量來推導訊號。
    if(i<119||i>=bars.length)return {valid:false,reason:'需要至少120根進場前日K'};
    const b=bars[i],ma20=pastAvg(bars,i,20),ma60=pastAvg(bars,i,60),ma120=pastAvg(bars,i,120);
    const near=bars.slice(i-19,i+1),range60=bars.slice(i-59,i+1);
    const max20=Math.max(...near.map(x=>x.high)),min20=Math.min(...near.map(x=>x.low));
    const high60=Math.max(...range60.map(x=>x.high)),low60=Math.min(...range60.map(x=>x.low));
    const vol=avg(near.map(x=>100*(x.high-x.low)/x.close));
    return {valid:true,date:b.date,price:b.close,ma20:round(ma20),ma60:round(ma60),ma120:round(ma120),volatilityPct:round(vol),
      high20:round(max20),low20:round(min20),high60:round(high60),low60:round(low60),
      ret5Pct:round(pct(b.close,bars[i-5].close)),ret20Pct:round(pct(b.close,bars[i-20].close)),
      above20:b.close>ma20,above60:b.close>ma60,above120:b.close>ma120,
      fromHigh20Pct:round(pct(b.close,max20)),fromLow60Pct:round(pct(b.close,low60))};
  }
  function entryCandidate(bars,index){
    const c=contextAt(bars,index);if(!c.valid)return {...c,key:null};
    // V1 研究性進場視角：偏好波段。長期必須有當時已公布的基本面，因此此價格版不自動推長期。
    const reasons=[];let key='swing';
    if(c.above20&&c.above60&&c.above120&&c.ret20Pct>=7&&c.volatilityPct<4&&c.fromHigh20Pct>=-5){
      key='long-swing';reasons.push('多週期上升趨勢、波動相對平穩');
    }else if(c.volatilityPct>=6 || (c.ret5Pct>=9&&c.fromHigh20Pct>=-3)){
      key='short';reasons.push('高波動或急漲接近短期高點');
    }else if((c.ret5Pct>=4 && c.fromHigh20Pct>=-6) || (c.above20&&!c.above60)){
      key='mixed';reasons.push('短線動能明顯，但中期結構尚未完全跟上');
    }else{reasons.push(c.above60?'中期結構仍支持波段管理':'尚無足夠證據偏離預設波段');}
    const profile={short:20,mixed:35,swing:55,'long-swing':70,long:85};
    return {...c,key,label:STRATEGIES.find(x=>x.key===key)?.label||'波段',corePct:profile[key],
      reason:reasons.join('；'),method:'僅價格研究候選（未使用歷史基本面、財報或W3）'};
  }
  function simulateTrade(bars,index,strategy,costPct=.5){
    // i 日產生研究候選，i+1 日開盤執行；不能使用 i 日收盤成交。
    const entry=bars[index+1];
    if(!entry||!valid(entry.open)||index+strategy.days>=bars.length)return null;
    const entryPrice=entry.open,top=entryPrice*(1+strategy.targetPct/100),floor=entryPrice*(1-strategy.stopPct/100);
    let exitIndex=null,exitPrice=null,why='期限到期',mae=0,mfe=0;
    for(let day=index+1;day<=index+strategy.days;day++){
      const bar=bars[day];
      mae=Math.min(mae,pct(bar.low,entryPrice));mfe=Math.max(mfe,pct(bar.high,entryPrice));
      // 同一日上下目標都觸及：保守採止損先達。缺任何日K便拒絕評估。
      if(bar.open<=floor){exitIndex=day;exitPrice=bar.open;why='跳空止損';break}
      if(bar.open>=top){exitIndex=day;exitPrice=bar.open;why='跳空達標';break}
      if(bar.low<=floor){exitIndex=day;exitPrice=floor;why=bar.high>=top?'同日雙觸及→保守止損':'止損';break}
      if(bar.high>=top){exitIndex=day;exitPrice=top;why='達標';break}
    }
    if(exitIndex===null){exitIndex=index+strategy.days;exitPrice=bars[exitIndex].close}
    return {signalDate:bars[index].date,entryDate:entry.date,entryPrice,exitDate:bars[exitIndex].date,exitPrice,
      holdingBars:exitIndex-index,reason:why,netPct:round(pct(exitPrice,entryPrice)-costPct),maePct:round(mae),mfePct:round(mfe)};
  }
  function summarise(trades){
    const rs=trades.map(t=>t.netPct),negative=trades.map(t=>t.maePct);return {count:trades.length,
      winPct:round(100*trades.filter(x=>x.netPct>0).length/Math.max(1,trades.length),1),
      avgPct:round(avg(rs)),medianPct:round(median(rs)),avgMaePct:round(avg(negative)),
      worstMaePct:round(trades.length?Math.min(...negative):null),
      avgHoldDays:round(avg(trades.map(x=>x.holdingBars)),1)};
  }
  function backtestPriceBaselines(input,{warmup=120,stride=60,costPct=.5}={}){
    const normalized=cleanBars(input),bars=normalized.bars;
    if(!normalized.valid)return {valid:false,reason:normalized.largeJumps.length?'偵測到超過35%的收盤跳變，請先查核分割／減資／增資與還原價格。':`有效日K不足150根或包含異常欄位`,coverage:{days:bars.length,from:bars[0]?.date,to:bars.at(-1)?.date,errors:normalized.errors.slice(0,5),largeJumps:normalized.largeJumps}};
    const results=STRATEGIES.map(s=>({strategy:s,rows:[]}));const candidates=[];
    const start=Math.max(119,warmup-1),end=bars.length-1-Math.max(...STRATEGIES.map(s=>s.days));
    for(let i=start;i<=end;i+=Math.max(1,stride)){
      const candidate=entryCandidate(bars,i);candidates.push({date:bars[i].date,key:candidate.key,label:candidate.label,reason:candidate.reason});
      for(const result of results){const trade=simulateTrade(bars,i,result.strategy,costPct);if(trade)result.rows.push(trade)}
    }
    // 使用同一批進場日比較「依當時價格選玩法」與「永遠波段」。
    // 研究候選只看決策日以前的120根K；前70%與後30%獨立列示，避免把全樣本好壞冒充樣本外成效。
    const byStrategy=new Map(results.map(r=>[r.strategy.key,r]));
    const candidateTrades=[],swingTrades=[];
    for(let j=0;j<candidates.length;j++){
      const selected=byStrategy.get(candidates[j].key)?.rows[j],swing=byStrategy.get('swing')?.rows[j];
      if(selected&&swing){candidateTrades.push(selected);swingTrades.push(swing)}
    }
    const cutoff=Math.max(1,Math.floor(candidateTrades.length*.7));
    const pair=(start,end)=>{
      const chosen=summarise(candidateTrades.slice(start,end)),always=summarise(swingTrades.slice(start,end));
      return {candidate:chosen,alwaysSwing:always,meanNetLiftPct:round(chosen.avgPct-always.avgPct)};
    };
    const policyComparison={whole:pair(0,candidateTrades.length),earlier:pair(0,cutoff),later:pair(cutoff,candidateTrades.length),
      splitDate:candidates[cutoff]?.date||null,
      byStyle:Object.fromEntries(STRATEGIES.map(s=>[s.key,candidates.filter(c=>c.key===s.key).length]))};
    return {valid:true,version:VERSION,method:'價格基準策略對照，非 V4.3.1／共振歷史重算',
      assumptions:{signal:'前一日收盤資訊',entry:'次日開盤',fill:'同日雙觸及以先停損保守處理；跳空以開盤價',costPct,stride},
      coverage:{days:bars.length,from:bars[0].date,to:bars.at(-1).date,signals:candidates.length,warnings:normalized.errors.slice(0,5)},
      candidates,policyComparison,results:results.map(x=>({strategy:x.strategy,stats:summarise(x.rows),trades:x.rows}))};
  }
  function reachabilityProfile(input,currentPrice,targetPrice,{stride=60}={}){
    const normalized=cleanBars(input),bars=normalized.bars;
    if(!normalized.valid)return {valid:false,reason:'日K有效性或公司行動檢查未通過'};
    if(!valid(currentPrice)||!valid(targetPrice))return {valid:false,reason:'目前價格或目標價缺失'};
    const distancePct=pct(targetPrice,currentPrice),direction=distancePct>=0?'up':'down';
    if(Math.abs(distancePct)<.2)return {valid:false,reason:'與現價距離過小，沒有辨識度'};
    const periods=[],maxH=Math.max(...HORIZONS);
    for(let i=119;i+maxH<bars.length;i+=Math.max(1,stride)){
      const start=bars[i].close,level=start*(1+distancePct/100);
      let first=null;
      for(let j=1;j<=maxH;j++){
        const b=bars[i+j];
        if(direction==='up'?b.high>=level:b.low<=level){first=j;break}
      }
      periods.push({signalDate:bars[i].date,firstTouchDay:first});
    }
    if(!periods.length)return {valid:false,reason:'觀察區間不足'};
    const reached=periods.filter(x=>x.firstTouchDay!==null).map(x=>x.firstTouchDay);
    return {valid:true,version:VERSION,method:'歷史同距離幅度到達率（非共振公式歷史預測）',direction,
      distancePct:round(distancePct),sample:periods.length,stride,medianFirstTouchDay:round(median(reached),1),
      horizons:HORIZONS.map(days=>({days,hit:periods.filter(x=>x.firstTouchDay!==null&&x.firstTouchDay<=days).length,
        hitPct:round(100*periods.filter(x=>x.firstTouchDay!==null&&x.firstTouchDay<=days).length/periods.length,1)}))};
  }
  function createSnapshot({code,stockName,tradeDate,capturedAt,price,play,corePct,main,secondary,pullback,defense,source='V4.3.1'}={}){
    const asof=dateKey(tradeDate),p=num(price),core=num(corePct);
    if(!code||!asof||!valid(p)||!play)throw new Error('建立計畫需要代號、資料日期、現價與玩法');
    const priceOrNull=v=>valid(v)?round(+v,4):null;
    return {schema:1,modelVersion:VERSION,source,code:String(code),stockName:String(stockName||''),tradeDate:asof,
      capturedAt:String(capturedAt||new Date().toISOString()),initial:{price:priceOrNull(p),play:String(play),corePct:core,
        tacticalPct:core===null?null:100-core,main:priceOrNull(main),secondary:priceOrNull(secondary),pullback:priceOrNull(pullback),defense:priceOrNull(defense)},
      updates:[]};
  }
  function appendUpdate(snapshot,now){
    if(!snapshot?.initial)throw new Error('缺少原始計畫');
    const value={date:dateKey(now.date),capturedAt:String(now.capturedAt||new Date().toISOString()),
      price:valid(now.price)?round(+now.price,4):null,main:valid(now.main)?round(+now.main,4):null,
      secondary:valid(now.secondary)?round(+now.secondary,4):null,pullback:valid(now.pullback)?round(+now.pullback,4):null,
      corePct:Number.isFinite(+now.corePct)?+now.corePct:null,play:String(now.play||'')};
    if(!value.date)throw new Error('缺少本次更新日期');
    return {...snapshot,updates:[...(snapshot.updates||[]),value]};
  }
  function evaluateSnapshot(snapshot,raw){
    const normalized=cleanBars(raw),bars=normalized.bars,initial=snapshot?.initial;
    if(!snapshot?.tradeDate||!initial||normalized.largeJumps.length)return {valid:false,reason:'原始快照或股價資料不可驗證（含未校正跳變）'};
    // 僅以建立計畫之後的K線評估；同日出現的價格不能視為事前已知。
    const forward=bars.filter(b=>b.date>snapshot.tradeDate);
    const levels=[['main',initial.main,'up'],['secondary',initial.secondary,'up'],['pullback',initial.pullback,'down'],['defense',initial.defense,'down']];
    const results=levels.map(([key,target,direction])=>{
      if(!valid(target))return {key,status:'no-target',horizons:[]};
      const first=forward.findIndex(b=>direction==='up'?b.high>=target:b.low<=target);
      const horizons=HORIZONS.map(h=>({days:h,status:first>=0&&first<h?'hit':forward.length>=h?'miss':'pending'}));
      return {key,target,direction,firstTouchDay:first<0?null:first+1,firstTouchDate:first<0?null:forward[first].date,horizons};
    });
    return {valid:true,tradeDate:snapshot.tradeDate,observedDays:forward.length,results,
      caveat:'只驗證價格是否在期限內觸及；不宣稱逐日路徑、盤中觸及先後或真實可成交價格。'};
  }
  return {VERSION,HORIZONS,STRATEGIES,cleanBars,contextAt,entryCandidate,simulateTrade,backtestPriceBaselines,reachabilityProfile,createSnapshot,appendUpdate,evaluateSnapshot};
});
