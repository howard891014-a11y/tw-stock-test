/* StockZone v2.6.8.33 | research-only W3 + V4.3.1 play + independent resonance & original six prices.
 * Never writes holding, sim trades or overrides original decision/price/stop formulas.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.StockZoneTradeV4=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const n=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
 const money=v=>n(v)===null?'--':`NT$ ${Math.round(Number(v)).toLocaleString('zh-TW')}`;
 const styleLabels={short:'短期',mixed:'短波',swing:'波段','long-swing':'長波',long:'長期'};
 const keys=Object.keys(styleLabels);
 const pct=v=>`${Math.round(v)}%`;
 const priceZone=x=>Array.isArray(x)&&x.length===2&&x.every(k=>n(k)>0)?{lo:Number(x[0]),hi:Number(x[1])}:null;
 function splitPosition(candidate,holding,price,capital=10000){
   if(!candidate?.available||!keys.includes(candidate.key))return {valid:false,reason:'V4候選玩法尚未成立，不能配置部位'};
   const base=n(candidate.basePct),tactical=n(candidate.tacticalPct);
   if(base===null||base<0||base>100||tactical===null||Math.abs(base+tactical-100)>.1)return {valid:false,reason:'核心與機動比例無效'};
   const shareN=n(holding?.shares),hasHold=shareN!==null&&shareN>0,referenceCapital=hasHold&&n(price)>0?shareN*price:capital;
   const fixedKey=String(holding?.lockedPlayKey||holding?.entryPlayKey||'');
   const band={short:[10,20],mixed:[25,40],swing:[45,60],'long-swing':[65,75],long:[80,90]};
   const lockKnown=hasHold&&keys.includes(fixedKey);
   // An explicitly recorded style wins for the EXISTING trade. Research candidate may change for new trades only.
   const currentKey=lockKnown?fixedKey:candidate.key;
   const actualCore=lockKnown?Math.max(band[fixedKey][0],Math.min(band[fixedKey][1],base)):base;
   const actualTactical=100-actualCore;
   const coreShares=hasHold?Math.floor(shareN*actualCore/100):null;
   const result={valid:true,basePct:actualCore,tacticalPct:actualTactical,referenceCapital,referenceLabel:hasHold?'目前持股市值（研究拆分）':'每檔 NT$10,000 假設配置',hasHold,coreValue:referenceCapital*actualCore/100,tacticalValue:referenceCapital*actualTactical/100,coreShares,tacticalShares:hasHold?Math.floor(shareN)-coreShares:null,styleKey:currentKey,styleLabel:styleLabels[currentKey],provisional:!!candidate.provisional};
   // Existing holdings do not necessarily record their original style; NEVER silently lock a new style retroactively.
   result.holdingLock=hasHold?(lockKnown?{verified:true,key:fixedKey,compatible:fixedKey===candidate.key,reason:fixedKey!==candidate.key?'已建倉玩法固定；研究候選已變動但不改寫原交易':'依既有進場鎖定玩法控制核心區間'}:{verified:false,reason:'既有持股未記錄進場玩法；本比例僅研究，不能假設已鎖定玩法'}):{verified:false,reason:'未建倉；新交易需於成交時鎖定玩法'};
   return result;
 }
 function decide({w3,candidate,play,profile,holding,price,capital=10000,originalDecision,risk,resonance,tactical}={}){
   // .27-compatible caller can inspect a response, but a production profile is NOT a research V4 style.
   const inferred=candidate||null,split=splitPosition(inferred,holding,price,capital);
   const region=String(w3?.regime||'').toLowerCase().replace(/[\s_-]/g,'');
   const known=w3?.valid===true&&['riskon','riskoff'].includes(region);
   const off=known&&region==='riskoff',warning=known&&region==='riskon'&&w3?.warning===true;
   const verifiedNormal=known&&region==='riskon'&&w3?.warning===false;
   const strength=n(resonance?.adjustedStrength??resonance?.strength),quality=n(resonance?.researchConfidence??strength),resonanceOK=!!resonance?.valid&&quality!==null&&quality>=60;
   const ready=originalDecision?.entryReady===true,exitRisk=risk?.exitTriggered===true,trimRisk=risk?.trimTriggered===true;
   const stage=(tactical?.tiers||[]).filter(t=>n(t?.value)!==null&&n(t.value)>0),p=n(price);
   const reached=stage.filter(t=>p!==null&&p>=Number(t.value));
   const upcoming=stage.find(t=>p!==null&&Number(t.value)>p)||null;
   const closeTo=upcoming&&p!==null&&p>=Number(upcoming.value)*.985;
   const sellZones={trim:priceZone(originalDecision?.trim),exit:priceZone(originalDecision?.exit),trimStop:priceZone(originalDecision?.trimStop),fullStop:priceZone(originalDecision?.fullStop)};
   const trial=priceZone(originalDecision?.trial),entry=priceZone(originalDecision?.entryCandidate??originalDecision?.entry);
   const original={trial,entry,trim:sellZones.trim,exit:sellZones.exit,trimStop:sellZones.trimStop,fullStop:sellZones.fullStop};
   const reference=`${inferred?.available?`${styleLabels[inferred.key]||inferred.label}｜核心 ${pct(split.basePct)}／機動 ${pct(split.tacticalPct)}`:'V4候選玩法待確認'}；原版六價位不覆寫`;
   let state,action,reason,policy='observe_only',riskScope='unconfirmed',entryPermitted=false;
   if(!known){state='w3_unknown';action=exitRisk?'W3待確認；原版出場風險優先':trimRisk?'W3待確認；原版減碼風險優先':'等待W3當日確認';reason='W3無效或過期，不能推導新進場或新止盈動作；既有正式止損訊號仍應獨立檢查';}
   else if(off){state='w3_off';riskScope='systemic';
     if(!split.valid){action='W3空頭：暫停新增部位';reason='V4玩法資料不足；先遵守正式大盤風控，不猜測部位類型';}
     else if(['short','mixed'].includes(split.styleKey)){policy='exit_all';action='短期／短波：OFF全清';reason='W3系統性風控優先，不等待倍率或共振買點；只反映研究規則，不送單';}
     else if(['long-swing','long'].includes(split.styleKey)){policy='reduce_tactical_first';action='長波／長期：機動先降';reason='依原定OFF規則優先降低機動；若原版風險觸發再檢查核心；進場玩法不可被W3改寫';}
     else{policy='swing_policy_pending';action='波段：依原版風控檢查';reason='波段玩法OFF處理尚未定案，不替使用者創造全砍條件';}
   }
   else if(warning){state='w3_warning';riskScope='systemic';action=exitRisk?'風險升溫：優先檢查原版出場':'風險升溫：控制部位';reason='W3預警優先；原版止損仍有效，避免積極加碼；原玩法不變';policy='de_risk';}
   else if(!verifiedNormal){state='warning_unknown';action='等待W3預警旗標';reason='RiskOn不代表已確認沒有預警，不推進進場建議';}
   else if(!split.valid){state='play_insufficient';action='等待V4.3玩法資料';reason=split.reason;}
   else if(exitRisk){state='normal_risk';riskScope='stock_specific';action='原版全部止損條件已觸發';reason='個股結構風控優先，正常市場也不能因高核心比例忽略失效訊號';policy='original_exit_risk';}
   else if(trimRisk){state='normal_risk';riskScope='stock_specific';action='原版減碼止損條件已觸發';reason='先降低機動倉；減碼執行須依原版止損價與持股情境確認';policy='original_trim_risk';}
   else if(closeTo||reached.length){state='on_tactical';riskScope='normal';action='檢查機動倉倍率止盈';reason=`${reached.length?`已達 ${reached.map(x=>x.label).join('、')}；`:''}${closeTo?`接近 ${upcoming.label}；`:''}到價僅是觀察條件，仍須原版技術／法人、共振與減碼價位確認，不自動賣出`;policy='review_tactical_only';}
   else if(!ready){state='on_wait';riskScope='normal';action='等待原版進場確認';reason='目前不是既有買入條件；玩法不代表現在適合買進';}
   else if(!resonanceOK){state='on_wait_resonance';riskScope='normal';action='等待共振可信度確認';reason=`原版進場條件已有訊號，但共振${quality===null?'資料不足':`研究校正 ${quality}/100 未達候選60分`}；資料缺失不可算成高可信度`;}
   else{state='on_entry_candidate';riskScope='normal';action='原版買點＋共振：進場研究候選';reason='W3確認多頭無預警、原版進場條件及共振可信度成立；仍須正式風控核准與T+1，研究版不送單';policy='original_approval_required';}
   const stageNote=stage.length?stage.map(x=>`${x.label} ${Number(x.value).toLocaleString('zh-TW',{maximumFractionDigits:2})}`).join('／'):'尚無有效1.5X／2X／2.5X';
   return {state,action,reason,policy,riskScope,entryPermitted,canTrade:false,advisoryOnly:true,w3Valid:known,w3Regime:known?(off?'RiskOff':'RiskOn'):'',warning:known?w3.warning:null,price:p,position:split,quality:quality===null?null:Math.round(quality),resonanceOK,entryReady:ready,original,stageNote,tierReached:reached.map(x=>x.label),upcomingTier:upcoming?.label??null,reference,verifiableInputs:{w3:known,play:split.valid,resonance:!!resonance?.valid,originalSixPrice:!!(original.trim||original.exit||original.trimStop||original.fullStop),tiers:stage.length===3},budgetExplanation:split.valid?`${split.referenceLabel}：核心 ${money(split.coreValue)}，機動 ${money(split.tacticalValue)}${split.hasHold?`｜約 ${split.coreShares}／${split.tacticalShares} 股`:''}`:'無法拆分研究部位'};
 }
 return Object.freeze({VERSION:'SZ-TRADE-V33-RESEARCH',splitPosition,decide});
});
