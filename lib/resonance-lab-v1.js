/* StockZone 共振研究室 R1 — 可重現的價格資料驗證、進場視角研究候選、不可覆蓋快照。
 * 不改動正式 V4.3.1／共振價格原始計算；歷史價格基準測試不等於正式目標歷史重算。
 * Browser: window.StockZoneResonanceLab; Node: require('...')
 */
(function (root, factory) {
  const api = factory();
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
  // R1.1：只新增「60 日間距 × 60 個起點」的穩定度檢驗。
  // 原始 backtestPriceBaselines、entryCandidate、simulateTrade、reachabilityProfile 公式完全保留。
  const ROLLING_VERSION='resonance-lab-r1.1-roll60';
  function backtestRollingOffsets(input,{warmup=120,stride=60,offsets=60,costPct=.5,trainFraction=.7}={}){
    const normalized=cleanBars(input),bars=normalized.bars;
    if(!normalized.valid)return {valid:false,reason:'K線有效性或公司行動檢查未通過',coverage:{days:bars.length,errors:normalized.errors.slice(0,5),largeJumps:normalized.largeJumps}};
    const gap=Math.max(1,Math.floor(stride)),numOffsets=Math.min(gap,Math.max(1,Math.floor(offsets)));
    const begin=Math.max(119,Math.floor(warmup)-1),end=bars.length-1-Math.max(...STRATEGIES.map(x=>x.days));
    if(end<begin+gap)return {valid:false,reason:'資料不足以提供60日間距的滾動組'};
    const groups=[],seenDates=new Set(),rankingCounts=Object.fromEntries(STRATEGIES.map(x=>[x.key,0]));
    const winnerOf=items=>[...items].sort((a,b)=>{
      // 比較的唯一排名依據：同一批進場日的平均淨報酬。未另造績效分數。
      const v=(b.avgPct??-Infinity)-(a.avgPct??-Infinity);
      return v||STRATEGIES.findIndex(x=>x.key===a.key)-STRATEGIES.findIndex(x=>x.key===b.key);
    })[0];
    for(let offset=0;offset<numOffsets;offset++){
      const dates=[],tradesByKey=Object.fromEntries(STRATEGIES.map(x=>[x.key,[]]));
      for(let i=begin+offset;i<=end;i+=gap){
        dates.push(bars[i].date);seenDates.add(bars[i].date);
        for(const style of STRATEGIES){
          const trade=simulateTrade(bars,i,style,costPct);
          if(trade)tradesByKey[style.key].push(trade);
        }
      }
      if(dates.length<4||STRATEGIES.some(x=>tradesByKey[x.key].length!==dates.length))continue;
      const ranked=STRATEGIES.map(x=>({key:x.key,label:x.label,avgPct:summarise(tradesByKey[x.key]).avgPct}));
      const best=winnerOf(ranked);
      rankingCounts[best.key]++;
      // 時序留後驗證：前段訓練只用已結束的交易結果，後段不參與策略選擇。
      const cut=Math.max(1,Math.min(dates.length-1,Math.floor(dates.length*trainFraction)));
      const trained=winnerOf(STRATEGIES.map(x=>({key:x.key,label:x.label,avgPct:summarise(tradesByKey[x.key].slice(0,cut)).avgPct})));
      const testSelected=summarise(tradesByKey[trained.key].slice(cut));
      const testSwing=summarise(tradesByKey.swing.slice(cut));
      const rawLift=testSelected.avgPct-testSwing.avgPct;
      groups.push({offset,signals:dates.length,first:dates[0],last:dates.at(-1),
        best:best.key,bestLabel:best.label,avgNetByStyle:ranked,
        trainCount:cut,testCount:dates.length-cut,trainBest:trained.key,trainBestLabel:trained.label,
        testSelectedAvgPct:testSelected.avgPct,testSwingAvgPct:testSwing.avgPct,testLiftPct:round(rawLift)});
    }
    if(!groups.length)return {valid:false,reason:'無足夠的滾動樣本'};
    const sumAvg=values=>round(avg(values.filter(Number.isFinite)));
    const byStrategy=STRATEGIES.map(x=>{
      const samples=groups.map(g=>g.avgNetByStyle.find(v=>v.key===x.key).avgPct);
      const againstSwing=groups.map(g=>g.avgNetByStyle.find(v=>v.key===x.key).avgPct-g.avgNetByStyle.find(v=>v.key==='swing').avgPct);
      return {key:x.key,label:x.label,topGroups:rankingCounts[x.key],topPct:round(100*rankingCounts[x.key]/groups.length,1),
        meanGroupAvgPct:sumAvg(samples),minGroupAvgPct:round(Math.min(...samples)),maxGroupAvgPct:round(Math.max(...samples)),
        betterThanSwingGroups:againstSwing.filter(x=>x>0.00001).length};
    });
    const lift=groups.map(g=>g.testLiftPct),positive=lift.filter(x=>x>0.00001).length;
    const oosPickCounts=Object.fromEntries(STRATEGIES.map(x=>[x.key,groups.filter(g=>g.trainBest===x.key).length]));
    const ordered=[...byStrategy].sort((a,b)=>b.topGroups-a.topGroups||b.meanGroupAvgPct-a.meanGroupAvgPct);
    return {valid:true,version:ROLLING_VERSION,method:'60日不重疊組內抽樣 × 60種起始位移；保留原始五種策略公式',
      assumptions:{warmup,stride:gap,offsets:numOffsets,costPct,trainingPct:trainFraction*100,ranking:'每組平均淨報酬最高（未加入新評分公式）',
        caveat:'60組高度相關，並非60次獨立驗證；跨組有大量共同市場行情，不得把不同組樣本數直接相加當成獨立筆數。'},
      coverage:{from:bars[0].date,to:bars.at(-1).date,groups:groups.length,distinctSignalDates:seenDates.size,
        minGroupSignals:Math.min(...groups.map(g=>g.signals)),maxGroupSignals:Math.max(...groups.map(g=>g.signals)),
        totalGroupSignals:groups.reduce((n,g)=>n+g.signals,0)},
      byStrategy,stableTop:ordered[0],
      chronological:{method:'每個60日位移組：前70%歷史樣本選平均淨報酬最高的策略；剩餘30%只做驗證，與固定波段比較',
        groupCount:groups.length,positiveLiftGroups:positive,positiveLiftPct:round(100*positive/groups.length,1),
        meanNetLiftPct:sumAvg(lift),medianNetLiftPct:round(median(lift)),selectedByTraining:oosPickCounts},
      groups};
  }
  function rollingPanelHtml(rolling){
    if(!rolling?.valid)return `<div style="margin-top:12px;padding:12px;border:1px solid #f4c9cb;border-radius:12px">滾動驗證無法執行：${String(rolling?.reason||'資料不足').replace(/</g,'&lt;')}</div>`;
    const safe=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const pct=v=>v===null||v===undefined?'—':`${v>0?'+':''}${v}%`;
    const sorted=[...rolling.byStrategy].sort((a,b)=>b.topGroups-a.topGroups||b.meanGroupAvgPct-a.meanGroupAvgPct);
    const rows=sorted.map(x=>`<tr><td style="padding:8px 5px;text-align:left">${safe(x.label)}</td><td style="padding:8px 5px;text-align:right">${x.topGroups}/${rolling.coverage.groups}</td><td style="padding:8px 5px;text-align:right">${x.topPct}%</td><td style="padding:8px 5px;text-align:right">${pct(x.meanGroupAvgPct)}</td><td style="padding:8px 5px;text-align:right">${pct(x.minGroupAvgPct)} ～ ${pct(x.maxGroupAvgPct)}</td></tr>`).join('');
    const chrono=rolling.chronological;
    return `<section class="sz-r1-roll" style="margin-top:16px;padding:13px 10px;border:1px solid #dcd8fb;border-radius:12px;background:linear-gradient(180deg,#f8f7ff,#fff);color:#30334a;line-height:1.55;font-size:13px;white-space:normal">
      <div style="font-size:15px;font-weight:800;color:#6251a6;margin-bottom:7px">60日 × 60組滾動穩定性驗證（R1.1）</div>
      <div style="margin-bottom:9px">原本18筆基準回測保留不變；額外平移起始日0～59日，每組約 <b>${rolling.coverage.minGroupSignals}～${rolling.coverage.maxGroupSignals}筆</b>。合計涵蓋 <b>${rolling.coverage.distinctSignalDates}個不同歷史進場日</b>，不是獨立交易筆數。</div>
      <div style="overflow-x:auto"><table style="border-collapse:collapse;min-width:450px;width:100%;font-size:12px"><thead><tr style="background:#eeeafb"><th style="padding:7px 5px;text-align:left">玩法</th><th style="padding:7px 5px;text-align:right">排名第一組數</th><th style="padding:7px 5px;text-align:right">占比</th><th style="padding:7px 5px;text-align:right">組均淨報酬</th><th style="padding:7px 5px;text-align:right">組間範圍</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p style="margin:11px 0 7px"><b>起點穩定度：</b>${safe(rolling.stableTop.label)}在 ${rolling.stableTop.topGroups}/${rolling.coverage.groups} 組平均淨報酬排名第一。排名只比同組的平均淨報酬，尚未考慮個人承受回撤能力。</p>
      <div style="padding:10px;background:#eef6ff;border-radius:9px"><b>時序留後驗證（70%／30%）：</b>每組只用前70%選玩法，再拿後30%比較固定波段。後段平均淨報酬差 <b>${pct(chrono.meanNetLiftPct)}</b>；${chrono.positiveLiftGroups}/${chrono.groupCount}組優於波段。<div style="margin-top:5px;color:#526078">這是在檢查歷史選玩法能否延續，不是現在買進的預測成功率。</div></div>
      <p style="color:#65657d;margin:9px 0 0"><b>統計限制：</b>60組使用高度相關的相鄰日期，即使組內最多持有60D且互不重疊，也不可把60組視為獨立實驗；排名不會自動覆寫V4.3、研究候選、原始交易計畫或共振價格。</p>
    </section>`;
  }
  function backtestWithRolling(input,options={}){
    const baseline=backtestPriceBaselines(input,options);
    if(!baseline.valid)return baseline;
    const rolling=backtestRollingOffsets(input,{warmup:options.warmup??120,stride:60,offsets:60,costPct:options.costPct??.5});
    baseline.rolling=rolling;
    // app.js 是同步把18筆報表寫進 div；此 microtask 在其後追加滾動報表，不改 app.js。
    if(typeof document!=='undefined'&&typeof Promise!=='undefined'){
      Promise.resolve().then(()=>{
        const el=document.getElementById('szLabBacktest');
        if(!el||!el.innerHTML||el.textContent.includes('按「執行五年價格基準回測」開始'))return;
        const previous=el.querySelector('.sz-r1-roll');if(previous)previous.remove();
        el.insertAdjacentHTML('beforeend',rollingPanelHtml(rolling));
      });
    }
    return baseline;
  }

  return {VERSION,ROLLING_VERSION,HORIZONS,STRATEGIES,cleanBars,contextAt,entryCandidate,simulateTrade,backtestPriceBaselines:backtestWithRolling,backtestRollingOffsets,reachabilityProfile,createSnapshot,appendUpdate,evaluateSnapshot};
});
