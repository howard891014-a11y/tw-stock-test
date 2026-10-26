/* StockZone V4 | Advisory-only merger: W3 + fixed play + original resonance/decisions. */
(function(root, make){const obj=make();if(typeof module==='object'&&module.exports)module.exports=obj;if(root)root.StockZoneTradeV4=obj})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function decide({w3,play,profile,originalDecision,resonance,tactical}={}){
    const regime=String(w3?.regime||'').toLowerCase().replace(/[\s_-]/g,'');
    const styleKey=String(play?.lockedKey||play?.key||profile?.key||'');
    const isStyleValid=['short','mixed','swing','long-swing','long'].includes(styleKey);
    const tacticalPercent=Number(profile?.tacticalPct);
    if(!isStyleValid)return {state:'insufficient',action:'等待玩法',reason:'缺少已確認的五玩法，不能推導倉位操作',canTrade:false};
    if(w3?.valid!==true || !['riskon','riskoff'].includes(regime))
      return {state:'w3_unknown',action:'等待大盤確認',reason:'未取得正式、有效且未過期的W3狀態。不可假設是正常市場',canTrade:false};
    if(regime==='riskoff'){
      if(styleKey==='short'||styleKey==='mixed')return {state:'w3_off',action:'全部出清',reason:'原定短期／短波OFF全清；玩法名稱不改變',canTrade:false,policy:'exit_all'};
      if(styleKey==='long-swing'||styleKey==='long')return {state:'w3_off',action:'優先清理機動倉',reason:'W3 OFF先降機動；核心僅依原有獨立風控條件進一步處理，保留原玩法',canTrade:false,policy:'reduce_tactical_first'};
      return {state:'w3_off',action:'波段風控待定',reason:'波段玩法的OFF出場細節尚未定案，不自創強制清倉規則',canTrade:false,policy:'swing_policy_pending'};
    }
    if(w3?.warning===true)return {state:'w3_warning',action:'風險升溫，暫緩積極加碼',reason:'W3預警優先，既有減碼及持股規則仍由正式買賣決策執行',canTrade:false};
    if(w3?.warning!==false)return {state:'warning_unknown',action:'等待預警旗標',reason:'RiskOn不等於已證實無預警',canTrade:false};
    if(originalDecision?.entryReady!==true){
      if(tactical?.action==='consider_tactical_trim')return {state:'on',action:'檢查機動倉止盈條件',reason:'接近既有倍率區；不可只憑倍率執行，需要正式賣訊／風險確認',canTrade:false};
      return {state:'on',action:'等待買賣訊號',reason:'玩法不等於進場指令；原版交易確認尚未成立',canTrade:false};
    }
    if(!resonance?.valid||!(Number(resonance?.adjustedStrength)>=60))return {state:'on',action:'等待共振確認',reason:'原版進場條件成立，但共振尚未確認或資料不足',canTrade:false};
    return {state:'on',action:'進場候選，待原版交易風控核准',reason:`玩法 ${styleKey}／機動 ${Number.isFinite(tacticalPercent)?tacticalPercent:'--'}%；W3正常、原始買進條件成立、共振達候選門檻；研究模組不會實際送出買賣`,canTrade:false,policy:'original_decision_priority'};
  }
  return Object.freeze({decide});
});
