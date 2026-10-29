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
   const lockKnown=hasHold&&keys.includes(fixedKey);
   // An explicitly recorded style wins for the EXISTING trade. Research candidate may change for new trades only.
   const currentKey=lockKnown?fixedKey:candidate.key;
   // Existing play locks are retained, but never clamp an independent allocation.
   const actualCore=base;
   const actualTactical=100-actualCore;
   const coreShares=hasHold?Math.floor(shareN*actualCore/100):null;
   const result={valid:true,basePct:actualCore,tacticalPct:actualTactical,referenceCapital,referenceLabel:hasHold?'目前持股市值（研究拆分）':'每檔 NT$10,000 假設配置',hasHold,coreValue:referenceCapital*actualCore/100,tacticalValue:referenceCapital*actualTactical/100,coreShares,tacticalShares:hasHold?Math.floor(shareN)-coreShares:null,styleKey:currentKey,styleLabel:styleLabels[currentKey],provisional:!!candidate.provisional};
   // Existing holdings do not necessarily record their original style; NEVER silently lock a new style retroactively.
   result.holdingLock=hasHold?(lockKnown?{verified:true,key:fixedKey,compatible:fixedKey===candidate.key,reason:fixedKey!==candidate.key?'已建倉玩法固定；研究候選已變動但不改寫原交易':'既有進場玩法保持鎖定；配置比例獨立計算'}:{verified:false,reason:'既有持股未記錄進場玩法；本比例僅研究，不能假設已鎖定玩法'}):{verified:false,reason:'未建倉；新交易需於成交時鎖定玩法'};
   return result;
 }
 return Object.freeze({VERSION:'SZ-TRADE-V43-RESEARCH',splitPosition});
});
