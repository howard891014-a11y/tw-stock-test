/* StockZone v2.6.9.23 — 單一交易決策。
 * V4 決定交易玩法、共振決定目標、近期技術提供首次試單／回測及追價補倉訊號，
 * W3及結構風控優先；未持股絕不把補倉當首次買進。無自動交易。
 * 試單 5%/10% 為初期政策，非已實證最佳比例；補倉限額不得憑空推算。
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZoneUnifiedTrade=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const val=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
  const positive=x=>{const n=val(x);return n!==null&&n>0?n:null};
  // v2.6.9.23: 價格「中心」與可視「觀察帶」分開。中心供原風控/目標計算，區間僅供看盤。
  // 若沒有足夠的波動、SR8真實上下緣或共振來源分布，寧願顯示單一價而不杜撰區間。
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const around=(center,belowPct,abovePct=belowPct)=>{
    const c=positive(center);if(c===null)return null;
    const lo=positive(belowPct),hi=positive(abovePct);
    return lo!==null&&hi!==null?[c*(1-lo/100),c*(1+hi/100)]:[c,c];
  };
  const sourceBand=(level,center)=>{
    const c=positive(center),lo=positive(level?.lower),hi=positive(level?.upper);
    return c!==null&&lo!==null&&hi!==null&&lo<hi&&lo<=c*1.001&&hi>=c*.999&&hi/lo<=1.20?[lo,hi]:null;
  };
  const clusterBand=(cluster,center)=>{
    const c=positive(center),lo=positive(cluster?.min),hi=positive(cluster?.max);
    return c!==null&&lo!==null&&hi!==null&&lo<hi&&lo<=c*1.001&&hi>=c*.999&&hi/lo<=1.20?[lo,hi]:null;
  };
  const fmt=x=>positive(x)===null?'--':Number(x).toLocaleString('zh-TW',{maximumFractionDigits:2});
  function decision(input={}){
    const price=positive(input.price),play=input.play||{},recent=input.recent||{},risk=input.risk||{},expected=input.expected||{},
      holding=!!input.holding,key=String(play.key||''),profile=play.operationProfile||{},market=input.market||{};
    if(price===null)return {valid:false,reason:'股價不足，無法提供買賣決策'};
    const verified=market.verified===true,isOff=verified&&market.regime==='off',warning=verified&&market.warning===true,
      shortCycle=['short','mixed'].includes(key),longCycle=['long','long-swing'].includes(key),
      riskExit=!!risk.exitTriggered,riskTrim=!!risk.trimTriggered,
      riskBad=risk.valid!==true||riskExit||riskTrim||(val(risk.score)!==null&&val(risk.score)>=72),
      technicalReady=recent.valid===true;
    const support=positive(recent.support?.value),resistance=positive(recent.resistance?.value),
      brokenResistance=positive(recent.brokenResistance?.value),
      downLevels=(expected.downside?.levels||[]).map(x=>positive(x?.value)).filter(x=>x!==null&&x<price*.998).sort((a,b)=>b-a),
      primary=positive(expected.plan?.levels?.[0]?.value),secondary=positive(expected.plan?.levels?.[1]?.value);
    const vol=positive(recent.data?.vol20),resonance=expected.plan?.resonance||{},bandwidth=positive(resonance.bandwidthPct),
      // 試單觀察帶：依近20日每日報酬標準差展開，不是對整個價格區間預先授權買進。
      trialRange=vol!==null?around(price,clamp(vol*.35,.25,1.3),clamp(vol*.12,.10,.45)):around(price,.5,.2),
      priceBand=(center,source)=>sourceBand(source,center)??(vol!==null?around(center,clamp(vol*.3,.2,1.2)):around(center,.5)),
      targetBand=(center,cluster)=>clusterBand(cluster,center)??(bandwidth!==null?around(center,clamp(bandwidth*.28,.6,2.1)):
        vol!==null?around(center,clamp(vol*.4,.5,1.7)):around(center,1)),
      // 防守價的觸發中心保持不變；顯示帶代表觀察緩衝，不得以帶寬改寫出場規則。
      stopBand=center=>center===null?null:(vol!==null?around(center,clamp(vol*.15,.15,.55)):around(center,.3)),
      full=downLevels[0]??null,
      // 最大容許結構停損距離為政策保護線，不是回測最適值；不能把沒有防守價的股票稱為可控風險。
      stopDistance=full===null?null:(price-full)/price*100,
      stopValid=stopDistance!==null&&stopDistance>0&&stopDistance<=20,
      blockReason=!technicalReady?'近期技術資料不足，暫停買進與補倉':
        risk.valid!==true?'風控資料不足，暫停買進與補倉':
        isOff?'W3空頭環境，暫停新試單與加碼':
        riskBad?'風控已提示走弱，暫停買進與補倉':
        !stopValid?'缺少合理結構停損（或距離超過20%），暫停買進與補倉':
        !['strong','cautious'].includes(recent.signalStrength)||!(recent.trialPct>0)?'近期明確風險或訊號資料不足，暫停買進與補倉':'';
    const allowed=!blockReason;
    const tactical=val(profile.tacticalPct);
    let trialPct=0,trialEligible=false;
    if(!holding&&allowed){
      trialPct=recent.trialPct>=10?10:5;
      if(warning||!verified)trialPct=Math.min(trialPct,5);
      if(tactical!==null&&tactical>0)trialPct=Math.min(trialPct,tactical);
      trialEligible=trialPct>0;
    }
    // 補倉訊號必須：已持股、通過當前風控、近期獨立訊號確立。
    const pullbackReady=holding&&allowed&&recent.entrySignals?.pullback===true,
      chaseReady=holding&&allowed&&recent.entrySignals?.chase===true,
      entryReady=pullbackReady||chaseReady,
      addType=pullbackReady?'pullback':chaseReady?'chase':null;
    // 未取得「尚未使用的預定總部位」時，不假造可補倉比例；只顯示可觀察訊號。
    const addPct=null;
    const target1=primary!==null&&primary>price*1.002?primary:null,
      target2=secondary!==null&&secondary>price*1.002&&(!target1||secondary>target1*1.002)?secondary:null;
    const trim=support!==null&&support<price*.999&&(full===null||support>full*1.004)?support:null;
    const trial=trialEligible?trialRange:null,
      trialCandidate=support!==null&&support<=price*1.005?priceBand(support,recent.support):null,
      pullbackCandidate=support!==null&&support<=price*1.005?priceBand(support,recent.support):null,
      chaseCandidate=resistance!==null&&resistance>price*1.002?priceBand(resistance,recent.resistance):
        brokenResistance!==null?priceBand(brokenResistance,recent.brokenResistance):null,
      entry=entryReady?trialRange:null,
      entryCandidate=entry??chaseCandidate??pullbackCandidate,
      trimZone=targetBand(target1,resonance.main),exitZone=targetBand(target2,resonance.secondary),
      trimStopZone=stopBand(trim),fullStopZone=stopBand(full);
    const offExit=holding&&shortCycle&&isOff,offTactical=holding&&longCycle&&isOff,
      defenseMode=offExit?'exit':offTactical?'tactical':riskExit?'exit':riskTrim?'trim':'normal',
      mode=play.period||profile.label||key||'待確認';
    const pullbackText=recent.entrySignals?.pullNote||'回測支撐訊號尚未確認',
      chaseText=recent.entrySignals?.chaseNote||'突破追價訊號尚未確認';
    const addPermission=entryReady?'已符合近期訊號；執行前仍須確認預定部位剩餘額度，不是自動下單':
      !holding?'尚未持股：不可直接執行補倉，需依首次試單判斷':
      blockReason||'仍待回測或突破確認，不可僅因到價直接補倉';
    let action;
    if(offExit)action='空頭環境：短線／短波持股依原玩法出清';
    else if(offTactical)action='空頭環境：優先減少機動倉，核心依長波／長期計畫管理';
    else if(riskExit)action=longCycle&&holding?'結構走弱：先減機動倉，核心另評估':'結構走弱：優先依防守條件出場';
    else if(riskTrim)action='風控轉弱：暫停加碼，先評估減碼';
    else if(holding&&entryReady)action=`持股符合${addType==='pullback'?'回測':'追價'}補倉觀察條件（部位餘額另確認）`;
    else if(holding)action=blockReason||'已有持股：等待回測／追價補倉確認，不再顯示首次試單';
    else if(trialEligible)action=`現價可${trialPct>=10?'小量':'謹慎'}試單 ${trialPct}%（政策試算，非最佳化比例）`;
    else action=blockReason||recent.status||'暫不建議試單';
    const trialNote=holding?`已有持股，本欄不再當成首次試單；${blockReason||'請使用下方回測／追價補倉判斷'}`:
      trialEligible?`現價 ${fmt(price)} 可試單 ${trialPct}%（佔預計單筆部位）；結構防守 ${fmt(full)}，距離 ${stopDistance.toFixed(1)}%；${!verified?'W3未驗證，限5%；':warning?'風險升溫，限5%；':''}不必等待完美支撐價；觀察帶隨即時價重新計算，並非區間內任意價均可直接買；比例未經績效驗證`:
      `${blockReason||recent.status||'不符合試單條件'}；${trialCandidate?`支撐參考價 ${fmt(support)} 僅供觀察`:'暫無支撐參考價'}；目前不建議買進`;
    return {valid:true,mode,action,playKey:key,trialPct,trial,trialCandidate,trialEligible,
      entry,entryCandidate,entryReady,addType,addPct,
      pullbackCandidate,chaseCandidate,pullbackReady,chaseReady,
      trim:trimZone,exit:exitZone,trimStop:trimStopZone,fullStop:fullStopZone,
      // 單點中心價保留給停損判斷、風險百分比與交易快照；區間只顯示，不改中心。
      trialCenter:trialEligible?price:null,entryCenter:entryReady?price:null,trimCenter:target1,exitCenter:target2,
      trimStopCenter:trim,fullStopCenter:full,
      zoneBasis:{trial:vol!==null?'20D-volatility':'default-observation-width',
        entry:entryReady?'20D-volatility':resistance!==null&&sourceBand(recent.resistance,resistance)?'SR8-confirmed-range':'technical-price-band',
        trim:clusterBand(resonance.main,target1)?'resonance-contributors':'resonance-bandwidth-or-volatility',
        exit:clusterBand(resonance.secondary,target2)?'resonance-contributors':'resonance-bandwidth-or-volatility',
        defense:'20D-volatility-observation-only'},
      trialNote,
      entryNote:`回測補倉：${pullbackText}｜追價補倉：${chaseText}｜${addPermission}｜候選價帶僅供觀察，到價仍需重新核對訊號`,
      pullbackNote:`${pullbackText}｜${holding?'已持股':'空倉不能補倉'}｜${pullbackReady?'訊號成立，請核對剩餘部位':'尚未允許補倉'}`,
      chaseNote:`${chaseText}｜${holding?'已持股':'空倉不能補倉'}｜${chaseReady?'訊號成立，請核對剩餘部位':'尚未允許補倉'}`,
      trimNote:target1!==null?`主要共振中心 ${fmt(target1)}｜顯示為共振來源／模型平滑觀察帶，非每個價位皆視為達標｜依機動／核心倉規則分批`:'目前無可靠主要共振目標，不提供獲利減碼價',
      exitNote:target2!==null?`次要共振中心 ${fmt(target2)}｜觀察帶不代表整帶達標，亦非保證觸及`:'目前沒有更高的次要共振，不編造獲利出場價',
      trimStopNote:trim!==null?`減碼中心 ${fmt(trim)}｜觀察帶不改原支撐失守判斷｜${recent.stop||'收盤確認失守時評估減碼'}`:`近期減碼支撐待確認｜${recent.stop||'不編造減碼價'}`,
      fullStopNote:full!==null?`結構防守中心 ${fmt(full)}｜觀察帶不改原出場觸發價｜${risk.summary||'當前風險待確認'}${offExit?'｜W3空頭環境已觸發出清':''}`:`結構防守不足，不提供全部止損價｜${risk.summary||'風險待確認'}`,
      defenseMode,offExit,offTactical,blocked:!trialEligible&&!entryReady,marketVerified:verified,
      source:'V4固定玩法＋近期風險試單／回測補倉／追價補倉＋共振目標＋結構防守＋W3',
      stopSource:full!==null?'current-downside-plan':'insufficient',supportSource:trim!==null?'recent-play-support':'insufficient',
      recentValid:technicalReady,holding,risk,stopDistance,stopValid,blockedReason:blockReason};
  }
  return Object.freeze({decision});
});
