/* StockZone v2.6.9.26 — 原交易防守鎖定與單一動作仲裁。
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
  // v2.6.9.26: 保留市場研究引擎原始候選，只有此處決定「同筆交易可執行的主動作」。
  // 已開交易只能讀取 initial；不得使用當日跌破後下移的下一道結構支撐代替鎖定防守。
  const bandCenter=x=>Array.isArray(x)&&x.length===2&&positive(x[0])!==null&&positive(x[1])!==null&&x[0]<=x[1]?(Number(x[0])+Number(x[1]))/2:null;
  const matchingBand=(band,center)=>center!==null&&Array.isArray(band)&&band.length===2&&
    positive(band[0])!==null&&positive(band[1])!==null&&band[0]<=center&&band[1]>=center?[Number(band[0]),Number(band[1])]:null;
  function finalize(raw,input){
    const price=positive(input.price),risk=input.risk||{},holding=raw.holding,
      plan=holding&&input.plan?.explicitPlan===true&&input.plan?.status==='open'?input.plan:null,
      original=plan?.initial||null,oldStop=raw.fullStopCenter,oldTrim=raw.trimStopCenter,
      oldStopBand=raw.fullStop,oldTrimBand=raw.trimStop,
      addSignal=holding&&(raw.pullbackReady||raw.chaseReady),
      market=input.market||{},verified=market.verified===true,off=verified&&market.regime==='off',
      isShort=['short','mixed'].includes(raw.playKey),isLong=['long','long-swing'].includes(raw.playKey),
      crossed=(v)=>positive(v)!==null&&price<=v;
    // 截取舊版 initial 的原始防守；last/targets.downside 不能取代 initial。
    // 舊版沒有可靠原始防守資料就明示「待建立」，不把候選價冒充鎖定價。
    const startPrice=positive(original?.referencePrice)||positive(original?.holdingCost);
    const originalStop=positive(original?.targets?.defense)||positive(original?.decision?.fullStopCenter);
    const lockedStop=originalStop!==null&&startPrice!==null&&originalStop<startPrice?originalStop:null;
    const tr=positive(original?.decision?.trimStopCenter)||bandCenter(original?.decision?.trimStop);
    const lockedTrim=tr!==null&&lockedStop!==null&&tr>lockedStop*1.001&&tr<startPrice?tr:null;
    const priceStopHit=holding&&plan&&crossed(lockedStop),priceTrimHit=holding&&plan&&crossed(lockedTrim);
    raw.researchDefense={full:oldStop,trim:oldTrim,fullBand:oldStopBand,trimBand:oldTrimBand};
    raw.planId=plan?.id||null;raw.planLocked=!!plan&&lockedStop!==null;raw.stopBreached=!!priceStopHit;
    raw.trimBreached=!!priceTrimHit;
    raw.entrySignalReady=!!addSignal;raw.entryReady=false;raw.entry=null;raw.entryCenter=null;raw.addPct=null;
    if(holding){
      raw.trial=null;raw.trialPct=0;raw.trialEligible=false;
      raw.fullStopCenter=lockedStop;raw.fullStop=lockedStop!==null?
        (matchingBand(original?.decision?.fullStop,lockedStop)||[lockedStop,lockedStop]):null;
      raw.stopSource=lockedStop!==null?'trade-initial-locked':'unconfirmed-original-trade-defense';
      raw.trimStopCenter=lockedTrim;raw.trimStop=lockedTrim!==null?
        (matchingBand(original?.decision?.trimStop,lockedTrim)||[lockedTrim,lockedTrim]):null;
      raw.trimStopAlert=null;
      raw.trimStopStatus=lockedTrim!==null?(priceTrimHit?'price-already-breached':'trade-initial-locked'):
        risk.exitTriggered?'exit-priority':risk.trimTriggered?'technical-risk-only':'not-formed';
      raw.trimStopNote=lockedTrim!==null?`原交易減碼防守 ${fmt(lockedTrim)}（建立交易時鎖定）｜${priceTrimHit?'現價已低於原防守，請檢查持股':'目前尚未失守'}；技術警戒另行判斷`:
        risk.trimTriggered?`近期技術減碼警戒：${risk.summary||'結構轉弱'}；沒有可追溯的原始減碼價，不能把現價當停損價`:
        '原交易未設定可靠的減碼觸發價；技術警戒不等於自動減碼';
      raw.fullStopNote=lockedStop!==null?`原交易出場防守 ${fmt(lockedStop)}（initial 鎖定，非今日重算）｜${priceStopHit?'現價已跌破原防守，不能向下改設':'未跌破'}｜${risk.summary||'風險持續監控'}`:
        `缺少可追溯的原交易出場價，暫停補倉；今日候選支撐 ${fmt(oldStop)} 僅供研究，不能當原停損`;
      raw.entryNote=`回測：${input.recent?.entrySignals?.pullNote||'訊號未確認'}｜追價：${input.recent?.entrySignals?.chaseNote||'訊號未確認'}｜${addSignal?'近期訊號成立，但尚未核實剩餘部位額度，不授權加碼':'訊號未成立'}；候選價格不是交易指令`;
      raw.pullbackNote=`${input.recent?.entrySignals?.pullNote||'回測訊號未確認'}｜${raw.pullbackReady?'技術確認／預定部位餘額未確認':'目前不能補倉'}`;
      raw.chaseNote=`${input.recent?.entrySignals?.chaseNote||'追價訊號未確認'}｜${raw.chaseReady?'技術確認／預定部位餘額未確認':'目前不能補倉'}`;
    }else{
      raw.trimStopAlert=null;
      raw.trimStopStatus='pre-entry-proposal';
      raw.trimStopNote=`尚未持股；${oldTrim!==null?'今日減碼參考價 '+fmt(oldTrim):'未形成減碼參考價'}，不是已建立交易防守`;
      raw.fullStopNote=`尚未持股；今日結構防守候選 ${fmt(oldStop)}，建立交易後才可鎖定原始計畫`;
      raw.stopSource=oldStop!==null?'pre-entry-structural-candidate':'insufficient';
    }
    // 全部出場 > 減碼警戒 > 補倉候選。空倉只能使用首次試單分支。
    let tradeState,action;
    if(holding&&off&&isShort){tradeState='exit-warning';action='W3空頭：短線／短波依原計畫檢查出清';}
    else if(holding&&priceStopHit){tradeState='exit-warning';action=`原交易出場防守 ${fmt(lockedStop)} 已失守：停止補倉，依原玩法處理${isLong?'機動倉及核心風險':'出場'}`;}
    else if(holding&&risk.exitTriggered){tradeState='exit-warning';action=`結構出場警戒：停止補倉，${isLong?'優先檢查機動倉、核心依原交易計畫':'依原交易計畫檢查出場'}`;}
    else if(holding&&off&&isLong){tradeState='trim-warning';action='W3空頭：停止補倉，優先檢查機動倉，核心按原長波／長期計畫';}
    else if(holding&&(risk.trimTriggered||priceTrimHit||(val(risk.score)!==null&&val(risk.score)>=72))){tradeState='trim-warning';action=`持股減碼警戒：停止補倉，${priceTrimHit?'原減碼防守已失守':risk.trimTriggered?'近期技術轉弱':'風險分數偏高'}；依鎖定玩法評估機動／核心倉`;}
    else if(holding&&!raw.planLocked){tradeState='plan-missing';action='持股計畫防守待確認：暫停補倉，先確認原始出場價';}
    else if(holding&&(risk.valid!==true||input.recent?.valid!==true||!verified)){tradeState='data-insufficient';action='持股風控／大盤資料未完整驗證：暫不補倉，也不給出續抱確定結論';}
    else if(holding&&raw.blockedReason){tradeState='hold';action=`持股觀望｜目前不補倉：${raw.blockedReason}`;}
    else if(holding&&addSignal){tradeState='add-pending';action=`持股${raw.pullbackReady?'回測':'追價'}訊號成立，剩餘部位額度未確認，暫不執行補倉`;}
    else if(holding){tradeState='hold';action='持股續抱觀察：未形成已確認補倉訊號';}
    else if(raw.trialEligible&&raw.trialPct>0){tradeState='trial';action=`系統未登記持股：現價符合首次試單 ${raw.trialPct}%（政策試算）`;}
    else {tradeState='wait';action=`系統未登記持股：暫不進場｜${raw.blockedReason||'近期買進條件未確認'}`;}
    raw.tradeState=tradeState;raw.action=action;
    raw.planSummary=holding?(raw.planLocked?`原交易防守：${fmt(lockedStop)}｜${priceStopHit?'已失守':`距現價 ${(((lockedStop/price)-1)*100).toFixed(1)}%`}`:
      '原交易防守：未鎖定（不能拿今日支撐替代）'):
      `無持股登記：${oldStop!==null?'今日試單風險參考 '+fmt(oldStop):'目前缺少結構防守候選'}`;
    raw.planDetail=holding?(plan?`原始玩法 ${original?.play||raw.mode||'未確認'}｜原計畫建立 ${plan.startDate||'日期不明'}｜鎖定的原始防守不隨現價下移`:
      '已登記持股但尚無明確的交易計畫；必須先建立／核對原始防守，系統不會捏造'):
      '系統沒有這檔股票的持股紀錄（不代表你實際空倉）；若已有持股，請先登記並建立交易計畫。以下價格只是研究候選';
    raw.defenseMode=tradeState==='exit-warning'?'exit':tradeState==='trim-warning'?'trim':raw.defenseMode;
    return raw;
  }
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
    // v2.6.9.24: 近期支撐若不存在、在現價之上，或不高於第⑥道防守，
    // 原本第⑤卡會顯示 --；但風控已提示「跌破 MA10／減碼」時，這是漏顯了正在發生的警戒。
    // 不杜撰新的減碼止損線：現價只作「風控已觸發」標記，與結構型止損價分開保存。
    const missingIndependentTrim=trim===null,
      trimStopAlert=missingIndependentTrim&&riskTrim&&!riskExit&&full!==null&&full<price*.998
        ?{kind:'current-risk-trigger',price,alreadyTriggered:true}
        :null,
      trimStopStatus=trim!==null?'structural-zone':riskExit?'exit-priority':trimStopAlert?'risk-already-triggered':'not-formed';
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
    else if(riskExit)action=!holding?'空倉：結構走弱，暫不首次進場':longCycle?'結構走弱：先減機動倉，核心另評估':'結構走弱：優先依防守條件出場';
    else if(riskTrim)action=holding?'風控轉弱：暫停加碼，先評估減碼':'空倉：風控轉弱，暫不首次試單';
    else if(holding&&entryReady)action=`持股符合${addType==='pullback'?'回測':'追價'}補倉觀察條件（部位餘額另確認）`;
    else if(holding)action=blockReason||'已有持股：等待回測／追價補倉確認，不再顯示首次試單';
    else if(trialEligible)action=`現價可${trialPct>=10?'小量':'謹慎'}試單 ${trialPct}%（政策試算，非最佳化比例）`;
    else action=blockReason||recent.status||'暫不建議試單';
    const trialNote=holding?`已有持股，本欄不再當成首次試單；${blockReason||'請使用下方回測／追價補倉判斷'}`:
      trialEligible?`現價 ${fmt(price)} 可試單 ${trialPct}%（佔預計單筆部位）；結構防守 ${fmt(full)}，距離 ${stopDistance.toFixed(1)}%；${!verified?'W3未驗證，限5%；':warning?'風險升溫，限5%；':''}不必等待完美支撐價；觀察帶隨即時價重新計算，並非區間內任意價均可直接買；比例未經績效驗證`:
      `${blockReason||recent.status||'不符合試單條件'}；${trialCandidate?`支撐參考價 ${fmt(support)} 僅供觀察`:'暫無支撐參考價'}；目前不建議買進`;
    return finalize({valid:true,mode,action,playKey:key,trialPct,trial,trialCandidate,trialEligible,
      entry,entryCandidate,entryReady,addType,addPct,
      pullbackCandidate,chaseCandidate,pullbackReady,chaseReady,
      trim:trimZone,exit:exitZone,trimStop:trimStopZone,fullStop:fullStopZone,
      trimStopAlert,trimStopStatus,
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
      trimStopNote:trim!==null?`減碼中心 ${fmt(trim)}｜觀察帶不改原支撐失守判斷｜${recent.stop||'收盤確認失守時評估減碼'}`:
        trimStopAlert?`風控已觸發減碼警戒（${risk.summary||'近期結構轉弱'}），現價 ${fmt(price)} 僅代表警戒已發生；尚無獨立於⑥的可靠減碼價，不可把現價當成新止損線。${holding?'持股者依原交易計畫評估減碼。':'目前空倉，禁止將此標記當成試單機會。'}`:
        riskExit?'全面出場警戒優先，應檢查⑥現價出場防守；不編造另一道減碼價':
        `沒有高於⑥防守、且位於現價下方的獨立減碼支撐；⑤未形成，僅保留⑥結構防守。${recent.stop||''}`,
      fullStopNote:full!==null?`結構防守中心 ${fmt(full)}｜觀察帶不改原出場觸發價｜${risk.summary||'當前風險待確認'}${offExit?'｜W3空頭環境已觸發出清':''}`:`結構防守不足，不提供全部止損價｜${risk.summary||'風險待確認'}`,
      defenseMode,offExit,offTactical,blocked:!trialEligible&&!entryReady,marketVerified:verified,
      source:'V4固定玩法＋近期風險試單／回測補倉／追價補倉＋共振目標＋結構防守＋W3',
      stopSource:full!==null?'current-downside-plan':'insufficient',supportSource:trim!==null?'recent-play-support':'insufficient',
      recentValid:technicalReady,holding,risk,stopDistance,stopValid,blockedReason:blockReason},input);
  }
  // v2.6.9.25：只呈現「既有單一決策結果」，不另發明新買點或改動准入規則。
  // 注意補倉價位即使觸及，也不能作為空倉首次進場的許可。
  function entryGuidance(d,price){
    if(!d?.valid)return {status:'wait',title:'資料不足｜暫不採取行動',detail:'缺少可靠資料，不依價位候選判斷買賣'};
    const state=d.tradeState||'wait';
    const status=state==='trial'?'trial':state==='exit-warning'||state==='trim-warning'?'block':state==='wait'?'block':'wait';
    return {status,title:d.action,detail:`${d.planSummary||''}｜${d.planDetail||''}${state==='add-pending'?'｜訊號不是買進許可，仍須確認可用額度':''}`};
  }
  return Object.freeze({decision,entryGuidance});
});
