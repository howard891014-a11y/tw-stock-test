/* StockZone V4.3.1 | 長期基準×中期結構轉型確認：研究候選，獨立於正式玩法及進出場。
 * 不讀代號，不用估值／目標價／法人／即時技術／當下 W3 作玩法加減分。
 * 市場分類不完整時不宣稱已剔除全部系統性回檔；不以不完整樣本作確證。
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StockZonePlayV4=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
  const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
  const median=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const j=Math.floor(a.length/2);return a.length%2?a[j]:(a[j-1]+a[j])/2};
  const div=(a,b)=>a!==null&&b!==null&&b!==0?a/b:null;
  const gradeNames={strong:'長抱財務基礎強',good:'長抱財務基礎尚佳',ordinary:'長抱財務基礎一般',weak:'長抱理由偏弱',unknown:'長期財報不足'};
  const rhythmNames={persistent:'多年趨勢續航',recovering:'多波回檔可恢復',tradeable:'反覆可交易波段',roundtrip:'漲後經常回原點',unresolved:'多年股性證據不足'};
  // V4 數值維持不變：只更換兩項資料判讀，不靠樣本主觀答案反向調權重。
  const grid={strong:{persistent:85,recovering:75,tradeable:65,roundtrip:50,unresolved:70},good:{persistent:75,recovering:65,tradeable:55,roundtrip:40,unresolved:60},ordinary:{persistent:60,recovering:50,tradeable:40,roundtrip:30,unresolved:45},weak:{persistent:40,recovering:35,tradeable:25,roundtrip:20,unresolved:30},unknown:{persistent:70,recovering:55,tradeable:40,roundtrip:30,unresolved:null}};

  const quarterKey=r=>{
    if(!r||typeof r!=='object')return null;
    let y=num(r.year),q=num(r.quarterNo??r.q);
    if(y!==null&&y<1911)y+=1911;
    if(y!==null&&q!==null&&y>=2000&&q>=1&&q<=4)return y*4+q-1;
    const raw=String(r.period??r.quarter??r.yearQuarter??r.date??'');
    const m=raw.match(/(\d{3,4})\D*[Qq季]\s*([1-4])/)||raw.match(/(\d{3,4})\s*[-/]?\s*([1-4])\s*[Qq季]/);
    if(!m)return null;
    y=+m[1];if(y<1911)y+=1911;q=+m[2];return y*4+q-1;
  };
  const revenue=(r,depth=0)=>{for(const k of ['revenue','totalRevenue','operatingRevenue','netRevenue','sales','salesRevenue','revenueTotal','quarterlyRevenue','revenueAmount']){const x=num(r?.[k]);if(x!==null)return x;}if(depth<2)for(const k of ['financialData','incomeStatement','quarterlyFinancials','financials','data']){const x=r?.[k];if(x&&typeof x==='object'){const v=revenue(x,depth+1);if(v!==null)return v}}return null};
  function financialDurability(rows){
    // 依真實年度／季度對齊；只使用查詢當下已公布資料，缺季不以0或推估填充。
    const entries=new Map();for(const x of Array.isArray(rows)?rows:[]){const k=quarterKey(x);if(k===null)continue;entries.set(k,{eps:num(x.eps),rev:revenue(x),om:num(x.operatingMargin??x.operatingMarginPct??x.opMargin),gm:num(x.grossMargin??x.grossMarginPct)});}
    const ordered=[...entries].sort((a,b)=>a[0]-b[0]);const recent=ordered.slice(-20),eps=recent.map(x=>x[1].eps).filter(x=>x!==null),rev=recent.map(x=>x[1].rev).filter(x=>x!==null),ttm=[];
    for(let i=3;i<recent.length;i++){const w=recent.slice(i-3,i+1);if(w.every((x,j)=>j===0||x[0]===w[j-1][0]+1)&&w.every(x=>x[1].eps!==null))ttm.push({key:recent[i][0],eps:w.reduce((s,x)=>s+x[1].eps,0)});}
    const yoy=[];for(const [k,x] of recent){const p=entries.get(k-4);if(x.rev!==null&&p?.rev>0)yoy.push((x.rev/p.rev-1)*100)}
    let peak=0,maxTtmDrawdown=0;for(const x of ttm){if(x.eps>peak)peak=x.eps;if(peak>0)maxTtmDrawdown=Math.max(maxTtmDrawdown,(1-x.eps/peak)*100)}
    const posRatio=eps.length?eps.filter(x=>x>0).length/eps.length:null,
      revPositiveRatio=yoy.length?yoy.filter(x=>x>=0).length/yoy.length:null,
      yoyDownRatio=yoy.length?yoy.filter(x=>x<=-10).length/yoy.length:null,
      ttmPositiveRatio=ttm.length?ttm.filter(x=>x.eps>0).length/ttm.length:null;
    // 至少12個同期間財報季度與8個同比才支持長期／循環性分類；短期成長不等於護城河。
    const sufficient=recent.length>=12&&eps.length>=12&&ttm.length>=8&&yoy.length>=8;
    const cyclical=sufficient&&(maxTtmDrawdown>=65||((yoyDownRatio??0)>=.5&&maxTtmDrawdown>=40)||posRatio<.75);
    const durable=sufficient&&!cyclical&&(posRatio??0)>=.92&&(ttmPositiveRatio??0)>=.9&&(revPositiveRatio??0)>=.60&&maxTtmDrawdown<45;
    const stable=sufficient&&!cyclical&&(posRatio??0)>=.80&&(revPositiveRatio??0)>=.45&&maxTtmDrawdown<65;
    return {available:recent.length>0,sufficient,quarters:recent.length,epsQuarters:eps.length,yoyQuarters:yoy.length,ttmQuarters:ttm.length,
      positiveEpsRatio:posRatio,revenueGrowthRatio:revPositiveRatio,negativeRevenueRatio:yoyDownRatio,maxTtmDrawdownPct:ttm.length?maxTtmDrawdown:null,
      cyclical,durable,stable,moatVerified:false,moatNote:'財報耐久度不是市場市占率；缺少可查證市占／競爭優勢來源，不自動宣稱產業護城河'};
  }
  function fundamentalBasis(a,rows){
    const q=num(a?.companyQuality),continuation=num(a?.continuation),stability=num(a?.stability?.score),risk=num(a?.risk?.score),confidence=num(a?.operationalConfidence);
    const durability=financialDurability(rows);
    if([q,continuation,stability,risk,confidence].some(x=>x===null)||confidence<55)
      return {tier:'unknown',label:gradeNames.unknown,complete:false,confidence:confidence??0,durability,reason:'原版營運資料不足；未用估值及目標價補空缺'};
    let tier='ordinary';
    if(risk>=55||q<40||continuation<35)tier='weak';
    else if(q>=62&&continuation>=55&&stability>=52&&risk<=40)tier='good';
    // 延續性要有跨景氣區間的長期證據；不能用連續兩季高分直接判定長抱基礎強。
    if(durability.sufficient){
      if(durability.cyclical)tier=tier==='weak'?'weak':(q<55||continuation<50?'weak':'ordinary');
      else if(durability.durable&&q>=72&&continuation>=68&&stability>=65&&risk<=25)tier='strong';
      else if(!durability.stable&&tier==='good')tier='ordinary';
    }
    const complete=durability.sufficient;
    const stats=durability.sufficient?`EPS正值${Math.round(durability.positiveEpsRatio*100)}%｜營收同比非負${Math.round(durability.revenueGrowthRatio*100)}%｜TTM獲利最大回落${durability.maxTtmDrawdownPct?.toFixed(1)}%`:`只有EPS ${durability.epsQuarters}季／同比 ${durability.yoyQuarters}期（長期需至少12／8）`;
    return {tier,label:gradeNames[tier],complete,confidence:confidence??0,durability,
      reason:`營運品質${q}｜成長延續${continuation}｜穩定${stability}｜風險${risk}｜${stats}；未驗證產業市占與護城河`};
  }

  // V4.3：沿用原版 rhythmZigZag 的「反轉百分比確認」轉折點演算法。
  // 僅已確認的 pivot A低→B高→C低→D高構成完整循環；尾端未確認 pivot 不得計入。
  function completedWavePivots(rows,thresholdPct){
    const a=(rows||[]).filter(x=>num(x?.close)>0);if(a.length<12)return [];
    const closes=a.map(x=>num(x.close));let trend=0,pivotI=0,pivotP=closes[0],extI=0,extP=closes[0],scanMinI=0,scanMin=closes[0],scanMaxI=0,scanMax=closes[0];const pivots=[];
    const pct=(x,b)=>b>0?(x/b-1)*100:null;
    for(let i=1;i<closes.length;i++){
      const c=closes[i];if(c<scanMin){scanMin=c;scanMinI=i}if(c>scanMax){scanMax=c;scanMaxI=i}
      if(trend===0){
        const up=pct(c,scanMin),down=pct(c,scanMax);
        if(up!==null&&up>=thresholdPct){pivotI=scanMinI;pivotP=scanMin;pivots.push({i:pivotI,p:pivotP,type:'low'});trend=1;extI=i;extP=c;scanMax=c;scanMaxI=i}
        else if(down!==null&&down<=-thresholdPct){pivotI=scanMaxI;pivotP=scanMax;pivots.push({i:pivotI,p:pivotP,type:'high'});trend=-1;extI=i;extP=c;scanMin=c;scanMinI=i}
        continue;
      }
      if(trend===1){if(c>=extP){extP=c;extI=i}const rev=pct(c,extP);if(rev!==null&&rev<=-thresholdPct){pivots.push({i:extI,p:extP,type:'high'});trend=-1;extI=i;extP=c;scanMin=c;scanMinI=i}}
      else{if(c<=extP){extP=c;extI=i}const rev=pct(c,extP);if(rev!==null&&rev>=thresholdPct){pivots.push({i:extI,p:extP,type:'low'});trend=1;extI=i;extP=c;scanMax=c;scanMaxI=i}}
    }
    if(trend===1&&extI>pivots.at(-1)?.i)pivots.push({i:extI,p:extP,type:'high',open:true});
    if(trend===-1&&extI>pivots.at(-1)?.i)pivots.push({i:extI,p:extP,type:'low',open:true});
    return pivots;
  }
  function structuralHistory(rows){
    const a=orderedBars(rows).map(x=>({c:num(x?.close),date:String(x?.date||''),high:num(x?.high),low:num(x?.low),regime:x?.w3Regime??x?.marketRegime??null,warning:x?.w3Warning}));
    const total=a.length,officialTags=a.filter(x=>['RiskOn','RiskOff','on','off','warning'].includes(String(x.regime))&&typeof x.warning==='boolean').length,
      verifiedNormal=total>0&&officialTags>=Math.ceil(total*.95),validNormal=x=>!verifiedNormal||(['RiskOn','on'].includes(String(x.regime))&&x.warning===false);
    const ranges=[];
    for(let i=1;i<total;i++){
      const prev=a[i-1].c,h=a[i].high??a[i].c,l=a[i].low??a[i].c;
      if(prev>0&&h>=l)ranges.push((h-l)/prev*100);
    }
    const threshold=clamp((median(ranges)??2.2)*1.35,2.5,6.0);
    const pivotInput=a.map(x=>({close:x.c}));
    const pivots=completedWavePivots(pivotInput,threshold).filter(x=>!x.open);
    const cycles=[],bandMoves=[];
    for(let i=0;i+3<pivots.length;i+=2){
      const [A,B,C,D]=pivots.slice(i,i+4);
      if(A.type!=='low'||B.type!=='high'||C.type!=='low'||D.type!=='high')continue;
      if(!(A.p>0&&B.p>A.p&&C.p<B.p&&D.p>C.p))continue;
      const rise=(B.p/A.p-1)*100,drop=(1-C.p/B.p)*100;
      if(rise<threshold*2)continue;
      const span=a.slice(A.i,D.i+1);if(!span.every(validNormal))continue;
      const amplitude=B.p-A.p,retrace=(B.p-C.p)/amplitude,
        recovered=D.p>=B.p*.97,
        recoveryDays=recovered?D.i-C.i:null,
        // V4.3.1: 碰到前高不等於恢復成功。必須有完整的後續60交易日可供驗證，
        // 並以第41~60日收盤中位數確認價帶仍在原高點的97%以上。
        // 如果窗口還沒結束（或含已標記的W3風控期），結果為null，而不是失敗。
        recoveryWindowReady=D.i+60<total&&a.slice(D.i+1,D.i+61).every(validNormal),
        postRecoveryMedian=recoveryWindowReady?median(a.slice(D.i+41,D.i+61).map(x=>x.c)):null,
        sustainedRecovered=recoveryWindowReady?(recovered&&postRecoveryMedian>=B.p*.97):null,
        // 價格區間是否提高要看相鄰已完成波浪的「底」，不看固定日幅度高低。
        higherFloor=C.p>=A.p*1.05,
        terminalRetention=(D.p-A.p)/amplitude;
      const after120=B.i+120<total&&a.slice(B.i,B.i+121).every(validNormal)?(a[B.i+120].c-A.p)/amplitude:null;
      const episode={start:a[A.i].date,highDate:a[B.i].date,pullbackDate:a[C.i].date,nextHighDate:a[D.i].date,
        low:A.p,high:B.p,pullbackLow:C.p,nextHigh:D.p,risePct:rise,drawdownPct:drop,retracePct:retrace*100,
        pullbackDays:C.i-B.i,recovered,recoveryDays,recoveryWindowReady,postRecoveryMedian,sustainedRecovered,
        higherFloor,roundtrip:C.p<=A.p*1.05,
        terminalRetention,retained120:after120,complete:true};
      cycles.push(episode);
      bandMoves.push(higherFloor?1:0);
    }
    const retentions=cycles.map(x=>x.retained120).filter(Number.isFinite),mret=median(retentions),
      recovered=cycles.filter(x=>x.recovered).length,roundtrips=cycles.filter(x=>x.roundtrip).length,
      sustainedMature=cycles.filter(x=>x.sustainedRecovered!==null),sustainedRecovered=sustainedMature.filter(x=>x.sustainedRecovered).length,
      // 至少三輪可驗證，才讓「持續恢復」取代舊的單次觸前高門檻；樣本不足時保留V4.3判斷但標明待確認。
      recoveredForTier=sustainedMature.length>=3?sustainedRecovered:recovered,
      higherBandRate=cycles.length?cycles.filter(x=>x.higherFloor).length/cycles.length:null,
      recentHigherBandRate=cycles.length?cycles.slice(-5).filter(x=>x.higherFloor).length/cycles.slice(-5).length:null;
    const closes=a.map(x=>x.c),annualReturns=[];
    for(let i=252;i<total;i+=60)if(a.slice(i-252,i+1).every(validNormal))annualReturns.push((closes[i]/closes[i-252]-1)*100);
    if(total>=253&&(total-1-252)%60!==0&&a.slice(-253).every(validNormal))annualReturns.push((closes.at(-1)/closes[total-253]-1)*100);
    const recentAnnualMedian=median(annualReturns.slice(-5));
    // 平穩單邊多年趨勢可能根本沒有3次夠深的回檔；不可把「無深回」錯判成資料不足。
    // 只有多個成熟價帶連續墊高、沒有明顯回原點且長期樣本足夠時，才用價帶路徑輔證。
    const steadyBands=[];
    for(let i=0;i+126<=total;i+=126){const segment=a.slice(i,i+126);if(segment.every(validNormal))steadyBands.push(median(segment.map(x=>x.c)))}
    const bandRises=steadyBands.slice(1).map((x,i)=>(x/steadyBands[i]-1)*100);
    const stableTrend=total>=600&&steadyBands.length>=5&&bandRises.slice(-4).every(x=>x>=5)&&steadyBands.at(-1)>=steadyBands.at(-5)*1.40;
    // 延續V4.2門檻、重新指定證據口徑；成熟波段不足時，不能用固定90日窗硬湊完整循環。
    const cycleSufficient=total>=400&&cycles.length>=3&&retentions.length>=3;
    const sufficient=cycleSufficient||stableTrend;
    const cycleRetention=median(cycles.map(x=>x.terminalRetention));
    let tier=stableTrend&&!cycleSufficient?'persistent':'unresolved';
    if(cycleSufficient){
      // 「漲完回原點」需要完整週期中多次真實跌回原起點，而非近期報酬弱就判定。
      if((mret??0)<=.33&&roundtrips/cycles.length>=.5&&((recentAnnualMedian??99)<=8||(recentHigherBandRate??1)<=.35||(higherBandRate??1)<.5))tier='roundtrip';
      else if((mret??0)>=.65&&(higherBandRate??0)>=.65&&roundtrips/cycles.length<=.25)tier='persistent';
      else if((mret??0)>=.48&&recoveredForTier>=2&&(higherBandRate??0)>=.45)tier='recovering';
      else tier='tradeable';
    }
    return {tier,label:rhythmNames[tier],available:total>0,sufficient,days:total,episodes:cycles.length,
      thresholdPct:threshold,retentionMedian:mret,completeWaveRetentionMedian:cycleRetention,structuralEvidence:cycleSufficient?'completed_waves':stableTrend?'sustained_price_bands':'insufficient',
      roundtripRate:cycles.length?roundtrips/cycles.length:null,recoveryRate:cycles.length?recovered/cycles.length:null,
      sustainedRecoveryRate:sustainedMature.length?sustainedRecovered/sustainedMature.length:null,
      sustainedRecoveryMature:sustainedMature.length,sustainedRecoveryCount:sustainedRecovered,
      sustainedRecoveryWindowDays:60,sustainedRecoveryValidationReady:sustainedMature.length>=3,
      medianRecoveryDays:median(cycles.map(x=>x.recoveryDays)),
      bandChecks:cycles.length,higherBandRate,recentHigherBandRate,recentAnnualMedian,
      marketRegimeVerified:verifiedNormal,episodesDetail:cycles,
      reason:`多年樣本${total}日｜原版轉折門檻${threshold.toFixed(1)}%｜完整低高低高${cycles.length}輪（可觀察120日留存${retentions.length}輪）｜120日留存中位${mret===null?'--':(mret*100).toFixed(0)+'%'}｜真實回起點${cycles.length?Math.round(roundtrips/cycles.length*100)+'%':'--'}｜多波底部墊高${higherBandRate===null?'--':Math.round(higherBandRate*100)+'%'}｜曾觸及前高${cycles.length?Math.round(recovered/cycles.length*100)+'%':'--'}｜60日維持前高${sustainedMature.length?sustainedRecovered+'/'+sustainedMature.length:'待驗證'}${sustainedMature.length<3?'（未滿3輪，不用於升級）':''}${stableTrend?'｜多年成熟價帶連續墊高（無足夠完整深回）':''}${verifiedNormal?'｜已核對W3正常期':'｜W3長期分段未驗證'}`};
  }
  function rhythmBasis(p,history){
    const s=structuralHistory(history);
    if(s.sufficient)return {...s,complete:s.marketRegimeVerified,provisional:!s.marketRegimeVerified};
    // 不再因最近160日一次成功修復就升長波，也不因最近重置頻繁就宣稱永久只能短線。
    // 多年資料不足，保留中性「可交易」候選並明確標註研究無法定案。
    if(!p?.valid&&!s.available)return {tier:'unresolved',label:rhythmNames.unresolved,complete:false,provisional:true,reason:'股性與多年K線均不足',structural:s};
    const pCycles=num(p?.completeCycles)??0;
    return {tier:p?.kind==='range'&&pCycles>=3?'roundtrip':'tradeable',label:p?.kind==='range'&&pCycles>=3?rhythmNames.roundtrip:rhythmNames.tradeable,
      complete:false,provisional:true,structural:s,reason:`${s.reason}｜有效樣本不足，不把一次恢復或近期重置當成多年結論`};
  }
  function profile(core){const n=Math.round(clamp(core,10,90)/5)*5,key=n>=80?'long':n>=65?'long-swing':n>=45?'swing':n>=25?'mixed':'short';const label={long:'長期','long-swing':'長波',swing:'波段',mixed:'短波',short:'短期'}[key];return {key,label,period:label,basePct:n,tacticalPct:100-n};}
  const asPct=x=>x===null?'--':(100*x).toFixed(0)+'%';
  function orderedBars(history){
    const byDate=new Map();
    for(const item of Array.isArray(history)?history:[]){
      const date=String(item?.date||'').slice(0,10),c=num(item?.close),v=num(item?.volume);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!(c>0)||v===0)continue;
      // 同一有效交易日以後出現的修正資料為準；不接受未標日期K線。
      byDate.set(date,item);
    }
    return [...byDate].sort((a,b)=>a[0].localeCompare(b[0])).map(x=>x[1]);
  }
  function orderedQuarters(rows){
    const map=new Map();for(const item of Array.isArray(rows)?rows:[]){const k=quarterKey(item);if(k!==null)map.set(k,item)}
    return [...map].sort((a,b)=>a[0]-b[0]);
  }
  // 2–5年的資料是基準；最近12個月不參加多年基準評價，只能作「是否轉型」證據。
  function longHorizon(history,fundamentalRows){
    const bars=orderedBars(history),quarters=orderedQuarters(fundamentalRows);
    const daysReserved=252,quartersReserved=4;
    return {bars,quarters,daysReserved,quartersReserved,
      baseBars:bars.length>daysReserved?bars.slice(0,-daysReserved):[],
      midBars:bars.slice(-daysReserved),
      baseQuarterRows:quarters.length>quartersReserved?quarters.slice(0,-quartersReserved).map(x=>x[1]):[],
      lastQuarterRows:quarters.slice(-quartersReserved).map(x=>x[1]),
      firstDate:bars[0]?.date??null,asOf:bars.at(-1)?.date??null};
  }
  // 長期營運耐久性：只用較早已公布的季度建立基準，當期基本面評估不冒充多年護城河。
  function fundamentalLongBasis(currentAssessment,baseRows,allRows){
    const d=financialDurability(baseRows);
    if(!d.sufficient){
      const fallback=fundamentalBasis(currentAssessment,allRows);
      return {...fallback,complete:false,durability:d,longBaselineVerified:false,
        reason:`長期財報基準不足（保留當期營運候選，不能證明2–5年持續性）｜${fallback.reason}`};
    }
    let tier='ordinary';
    if(d.positiveEpsRatio<.65||d.ttmPositiveRatio<.60)tier='weak';
    else if(d.cyclical)tier='ordinary';
    else if(d.durable&&d.epsQuarters>=16&&d.yoyQuarters>=12&&d.positiveEpsRatio===1&&d.revenueGrowthRatio>=.70&&d.maxTtmDrawdownPct<30)tier='strong';
    else if(d.durable||d.stable&&d.revenueGrowthRatio>=.55)tier='good';
    return {tier,label:gradeNames[tier],complete:true,longBaselineVerified:true,
      confidence:num(currentAssessment?.operationalConfidence),durability:d,
      reason:`長期已公布財報：EPS ${d.epsQuarters}季正值率${asPct(d.positiveEpsRatio)}｜營收同比非負${asPct(d.revenueGrowthRatio)}｜獲利峰值回落${d.maxTtmDrawdownPct?.toFixed(1)}%｜${d.cyclical?'景氣循環跡象':'耐久性檢查'}；不等於已驗證護城河`};
  }
  function priceMidTransition(bars){
    const window=63,last=bars.slice(-window*4),n=last.length;
    if(n<window*4)return {ready:false,direction:'insufficient',reason:`中期需252有效交易日（現有${n}）`,bands:[],marketRegimeVerified:false};
    const annotated=last.filter(x=>['on','off','RiskOn','RiskOff','warning'].includes(String(x?.w3Regime??x?.marketRegime))&&typeof x?.w3Warning==='boolean');
    // OFF／預警不是股性樣本；只用當時W3驗證為正常的交易日取每段價帶中位。
    // 欠缺逐日W3資料可描繪原始趨勢，但絕不啟動玩法轉型。
    const verified=annotated.length===last.length;
    const isNormal=x=>['on','RiskOn'].includes(String(x?.w3Regime??x?.marketRegime))&&x?.w3Warning===false;
    const groups=Array.from({length:4},(_,i)=>last.slice(i*window,(i+1)*window));
    const normalCounts=groups.map(g=>g.filter(isNormal).length);
    const normal=verified&&normalCounts.every(count=>count>=40)&&normalCounts.reduce((a,b)=>a+b,0)>=Math.ceil(252*.75);
    const groupsForBand=normal?groups.map(g=>g.filter(isNormal)):groups;
    const bands=groupsForBand.map(g=>median(g.map(x=>num(x?.close))));
    const changes=bands.slice(1).map((x,i)=>(x/bands[i]-1)*100);
    const growth=changes.every(x=>x>=4)&&bands[3]/bands[0]>=1.15;
    const weakness=changes.every(x=>x<=-4)&&bands[3]/bands[0]<=.85;
    const direction=growth?'improving':weakness?'deteriorating':'unchanged';
    return {ready:true,marketRegimeVerified:verified,normal,provisional:!normal,direction,bands,changes,normalCounts,
      reason:`四段63日中位數：${bands.map(x=>x?.toFixed(1)).join('→')}｜${changes.map(x=>x.toFixed(1)+'%').join('／')}｜${normal?`正常期樣本${normalCounts.join('/')}`:verified?`W3風控期過多，各段正常期樣本${normalCounts.join('/')}，不調玩法`:'W3預警歷史未驗證，僅供觀察'}`};
  }
  function financialMidTransition(ordered){
    const a=ordered.slice(-8);
    if(a.length<8||!a.every((x,i)=>i===0||x[0]===a[i-1][0]+1))return {ready:false,direction:'insufficient',reason:'中期至少需連續8季EPS與營收同比'};
    const v=a.map(x=>({key:x[0],eps:num(x[1]?.eps),rev:revenue(x[1])})),old=v.slice(0,4),recent=v.slice(4);
    if(v.some(x=>x.eps===null||x.rev===null)||old.some(x=>!(x.rev>0)))return {ready:false,direction:'insufficient',reason:'連續8季中有EPS／營收缺欄或基期營收為零'};
    const before=old.reduce((s,x)=>s+x.eps,0),after=recent.reduce((s,x)=>s+x.eps,0);
    const revenueYoys=recent.map((x,i)=>(x.rev/old[i].rev-1)*100),positiveRevenue=revenueYoys.filter(x=>x>=0).length,negativeRevenue=revenueYoys.filter(x=>x<=-10).length;
    const grow=before>0&&after>=before*1.25&&recent.every(x=>x.eps>0)&&positiveRevenue>=3;
    const shrink=before>0&&after<=before*.7&&negativeRevenue>=3;
    const direction=grow?'improving':shrink?'deteriorating':'unchanged';
    return {ready:true,direction,ttmBefore:before,ttmNow:after,revenueYoys,
      reason:`前四季EPS合計${before.toFixed(2)}→近四季${after.toFixed(2)}；營收同比非負${positiveRevenue}/4、衰退逾10% ${negativeRevenue}/4｜${direction==='unchanged'?'不構成結構轉型':'偵測到持續變化'}`};
  }
  function mediumReview(horizon){
    const p=priceMidTransition(horizon.midBars),f=financialMidTransition(horizon.quarters);
    let state='unchanged',delta=0;
    // 升降級須有兩類獨立持續性證據，且中期逐日W3無預警、無OFF，缺任一條件均不調整。
    if(p.ready&&f.ready&&p.marketRegimeVerified&&p.normal){
      if(p.direction==='improving'&&f.direction==='improving'){state='confirmed_improvement';delta=5}
      else if(p.direction==='deteriorating'&&f.direction==='deteriorating'){state='confirmed_deterioration';delta=-5}
    }else if(p.direction===f.direction&&['improving','deteriorating'].includes(p.direction))state='pending_market_validation';
    const alert=f.ready&&f.ttmBefore>0&&f.ttmNow<=f.ttmBefore*.5;
    return {state,delta,alert,price:p,fundamental:f,
      reason:`中期：${state==='confirmed_improvement'?'基本面及多年價格結構同步改善（+5）':state==='confirmed_deterioration'?'基本面及價格結構同步惡化（-5）':state==='pending_market_validation'?'結構同向但市場正常期尚未驗證，未調整':alert?'長期獲利疑似顯著惡化，提示重新覆核，不直接改玩法':'沒有足夠雙重結構證據，維持長期玩法'}｜財報：${f.reason}｜價格：${p.reason}`};
  }
  function classify({personality,fundamental,fundamentalRows,history,holdingLock}={}){
    const horizon=longHorizon(history,fundamentalRows);
    const f=fundamentalLongBasis(fundamental,horizon.baseQuarterRows,fundamentalRows),
      p=rhythmBasis(personality,horizon.baseBars),review=mediumReview(horizon);
    const original=grid[f.tier]?.[p.tier];
    if(original===null||original===undefined)return {available:false,reason:'長期營運與多年股性都不足，不能製造50/50',fundamental:f,rhythm:p,medium:review};
    const base=profile(original),final=profile(original+review.delta),provisional=!f.complete||!p.complete||!p.marketRegimeVerified;
    const out={...final,available:true,provisional,
      confidence:provisional?'長期資料／W3正常期未完整驗證（研究暫定）':'長期資料足夠（尚未樣本外回測）',
      fundamental:f,rhythm:p,medium:review,longBaseline:base,asOf:horizon.asOf,
      historyDays:horizon.bars.length,longHistoryDays:horizon.baseBars.length,mediumHistoryDays:horizon.midBars.length,
      modelVersion:'SZ-PLAY-V4.3.1-RECOVERY-FIX',
      explanation:`長期基準：${f.label} × ${p.label} → 核心 ${base.basePct}%｜中期：${review.delta?review.delta>0?'+5%':'-5%':'維持'} → 研究核心${final.basePct}%`};
    if(holdingLock?.styleKey){const allowed={short:[10,20],mixed:[25,40],swing:[45,60],'long-swing':[65,75],long:[80,90]}[holdingLock.styleKey];if(allowed){const c=clamp(out.basePct,...allowed);out.locked={key:holdingLock.styleKey,basePct:c,tacticalPct:100-c,why:'已建倉交易玩法鎖定，動態比例只限原區間'}}}
    return out;
  }
  // 以下保留 .27 原波段倍率／共振候選功能，不改正式來源及進出場。
  function tacticalLevels(wave,price){
    const p=num(price),pullback=num(wave?.pullbackLow),base=num(wave?.baseLow),top=num(wave?.firstWave);
    if(!wave?.valid||p===null||p<=0||base===null||top===null||top<=base)return {available:false,reason:'缺少有效第一波及目前股價，不能硬填機動倉目標'};
    const tiers=[['1.5X',wave?.ext15],['2X',wave?.ext20],['2.5X',wave?.ext25]].map(([label,v])=>({label,value:num(v)}));
    if(tiers.some(x=>x.value===null)||tiers.some((x,i)=>i&&x.value<=tiers[i-1].value))return {available:false,reason:'倍率目標缺失或順序異常'};
    const confirmed=!!wave?.completed&&pullback!==null,points=tiers.map(x=>({...x,relativePct:(x.value/p-1)*100,status:p>=x.value?'已越過':p>=x.value*.985?'臨近':'尚未到達'})),next=points.find(x=>x.value>p);
    return {available:true,confirmed,provisional:!confirmed,tiers:points,next:next||null,extensionMax:num(wave?.extensionMax),base:pullback??base,firstWaveX:top-base,reason:confirmed?'原版確認回測低點＋第一波價差X':'回測尚未確認；倍率供觀察'};
  }
  function resonanceDataConfidence(rawStrength,assessment){const raw=num(rawStrength);if(raw===null)return {available:false,confidence:null,raw:null,reason:'原版共振不存在'};const operational=num(assessment?.operationalConfidence),penalty=operational===null?12:Math.round(clamp((80-operational)*.15,0,12));return {available:true,raw:Math.round(raw),confidence:Math.round(clamp(raw-penalty,0,100)),penalty,note:penalty?`營運資料完整度${operational===null?'未知':operational+'%'}：扣${penalty}點（研究候選）`:'營運資料完整'};}
  function manageTactical({wave,price,resonance,technicalConfirmed=false,w3}={}){const result=tacticalLevels(wave,price);if(!result.available)return {...result,action:'insufficient'};const w3Regime=String(w3?.regime||'').toLowerCase();if(w3Regime==='riskoff'||w3Regime==='off')return {...result,action:'market_risk_priority'};if(w3?.warning===true)return {...result,action:'market_warning_priority'};if(w3Regime!==''&&w3Regime!=='riskon'&&w3Regime!=='on')return {...result,action:'w3_unknown'};if(!result.confirmed)return {...result,action:'observe_unconfirmed'};if(!result.next)return {...result,action:'extension_review'};const quality=num(resonance?.confidence),near=result.next.relativePct<=3,meets=quality!==null&&quality>=60&&technicalConfirmed===true;return {...result,action:near?(meets?'consider_tactical_trim':'observe_confirmation'):'wait_target'};}
  return Object.freeze({completedWavePivots,VERSION:'SZ-PLAY-V4.3.1-RECOVERY-FIX',quarterKey,financialDurability,fundamentalBasis,structuralHistory,rhythmBasis,orderedBars,orderedQuarters,longHorizon,fundamentalLongBasis,financialMidTransition,priceMidTransition,mediumReview,profile,classify,tacticalLevels,manageTactical,resonanceDataConfidence});
});
