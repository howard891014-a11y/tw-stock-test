/* StockZone v2.6.9.20 — 唯一正式操作決策彙整層。
   V4 決定玩法，原共振決定上方價位，R1近期玩法決定新試單／補倉條件，
   現行風控與結構防守決定減碼／出場，W3只用已驗證的當日狀態。
   不修改任何底層公式，不自動下單，不自行假造價位或進場比例。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZoneUnifiedTrade=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const val=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
  const positive=x=>{const n=val(x);return n!==null&&n>0?n:null};
  const zone=x=>x===null?null:[x,x];
  const fmt=x=>positive(x)===null?'--':Number(x).toLocaleString('zh-TW',{maximumFractionDigits:2});
  function decision(input={}){
    const price=positive(input.price),play=input.play||{},recent=input.recent||{},risk=input.risk||{},expected=input.expected||{},holding=!!input.holding,
      key=String(play.key||''),profile=play.operationProfile||{},market=input.market||{};
    if(price===null)return {valid:false,reason:'股價不足，無法提供買賣決策'};
    const isOff=market.verified===true&&market.regime==='off',warning=market.verified===true&&market.warning===true,
      shortCycle=['short','mixed'].includes(key),longCycle=['long','long-swing'].includes(key),
      riskExit=!!risk.exitTriggered,riskTrim=!!risk.trimTriggered;
    // Never infer a firm entry from legacy breakout levels. Recent engine must authorize it.
    let trialPct=recent.valid===true?Math.max(0,Math.min(100,val(recent.trialPct)||0)):0;
    let trialGate=recent.valid===true&&trialPct>0;
    let blockReason='';
    if(!recent.valid){blockReason='近期技術資料不足，暫不建議新試單';trialPct=0;trialGate=false}
    if(riskExit||riskTrim||Number(risk.score)>=72){blockReason='風控已提示走弱，暫停買進與補倉';trialPct=0;trialGate=false}
    if(isOff){blockReason='W3空頭環境，暫停新試單與加碼';trialPct=0;trialGate=false}
    if(trialGate&&warning){trialPct=Math.min(trialPct,10)}
    if(trialGate&&market.verified!==true){trialPct=Math.min(trialPct,10)}
    const tactical=val(profile.tacticalPct);if(trialGate&&tactical!==null&&tactical>0)trialPct=Math.min(trialPct,tactical);
    trialGate=trialGate&&trialPct>0;
    const support=positive(recent?.support?.value),resistance=positive(recent?.resistance?.value),
      downLevels=(expected?.downside?.levels||[]).map(x=>positive(x?.value)).filter(x=>x!==null&&x<price*.998).sort((a,b)=>b-a),
      primary=positive(expected?.plan?.levels?.[0]?.value),secondary=positive(expected?.plan?.levels?.[1]?.value);
    // The full defensive threshold is the same current structural threshold used by historical success-rate evaluation.
    // A nearer recent support can be a partial-reduction guard; never manufacture a deeper price.
    const full=downLevels[0]??null;
    const trim=support!==null&&support<price*.999&&(full===null||support>full*1.004)?support:null;
    const target1=primary!==null&&primary>price*1.002?primary:null,
      target2=secondary!==null&&secondary>price*1.002&&(!target1||secondary>target1*1.002)?secondary:null;
    if(trialGate&&(support===null||support>=price)){
      blockReason='未有低於現價的有效支撐，暫不提供試單';trialPct=0;trialGate=false;
    }
    const trial=trialGate?zone(price):null;
    const addCandidate=resistance!==null&&resistance>price*1.002?zone(resistance):null;
    // The current R1 engine does not output a validated large-entry signal or add-size.
    const offExit=holding&&shortCycle&&isOff,offTactical=holding&&longCycle&&isOff,
      defenseMode=offExit?'exit':offTactical?'tactical':riskExit?'exit':riskTrim?'trim':'normal';
    const baseMode=play.period||profile.label||key||'待確認';
    let action;
    if(offExit)action='空頭環境：短線／短波持股依原玩法出清';
    else if(offTactical)action='空頭環境：優先減少機動倉，核心依長波／長期計畫管理';
    else if(riskExit)action=longCycle&&holding?'結構走弱：先減機動倉，核心另評估':'結構走弱：優先依防守條件出場';
    else if(riskTrim)action='風控轉弱：暫停加碼，先評估減碼';
    else if(!recent.valid)action='近期資料不足：等待訊號，不給進場建議';
    else if(trialGate)action=`近期可觀察小量試單 ${trialPct}%（未經績效校準）`;
    else action=blockReason||recent.status||'暫不建議試單';
    const pctNote=trialGate?`現價 ${fmt(price)} 通過近期試單條件，試算 ${trialPct}%（佔預計單筆部位）；${market.verified!==true?'W3當日未確認，已限制比例；':warning?'風險升溫，已限制比例；':''}${recent.trial||'等待支撐確認'}`:
      `${blockReason||recent.status||'等待近期技術訊號'}；${recent.trial||'暫無試單價'}`;
    return {valid:true,mode:baseMode,action,playKey:key,trialPct,trial,entry:null,entryCandidate:trialGate?addCandidate:null,entryReady:false,
      trim:zone(target1),exit:zone(target2),trimStop:zone(trim),fullStop:zone(full),
      trialNote:pctNote,
      entryNote:`僅供補倉／突破觀察，不代表已符合大量進場條件｜${recent.add||'近期玩法尚未確認加碼訊號'}${trialGate?'':'｜目前暫停新買入'}`,
      trimNote:target1!==null?`主要共振目標 ${fmt(target1)}｜持股依機動／核心倉規則分批`:'目前無可靠主要共振目標，不提供獲利減碼價',
      exitNote:target2!==null?`次要共振目標 ${fmt(target2)}｜非保證觸及`:'目前沒有更高的次要共振，不編造獲利出場價',
      trimStopNote:trim!==null?`近期支撐 ${fmt(trim)}｜${recent.stop||'收盤確認失守時評估減碼'}`:`近期減碼支撐待確認｜${recent.stop||'不編造減碼價'}`,
      fullStopNote:full!==null?`結構防守 ${fmt(full)}｜${risk.summary||'當前風險待確認'}${offExit?'｜W3空頭環境已優先觸發出清':''}`:`結構防守不足，不提供全部止損價｜${risk.summary||'風險待確認'}`,
      defenseMode,offExit,offTactical,blocked:!trialGate,marketVerified:market.verified===true,
      source:'V4固定玩法＋近期玩法R1＋共振目標＋當前結構防守＋已驗證W3',
      stopSource:full!==null?'current-downside-plan':'insufficient',supportSource:trim!==null?'recent-play-support':'insufficient',
      recentValid:recent.valid===true,holding,risk};
  }
  return Object.freeze({decision});
});
