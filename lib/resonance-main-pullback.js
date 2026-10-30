'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.StockZoneMainPullback=api;
})(typeof window!=='undefined'?window:null,function(){
 function positive(v){return v===null||v===undefined||v===''?null:Number.isFinite(Number(v))&&Number(v)>0?Number(v):null}
 function select({price,deepReference,zones,bars,lab}={}){
  const current=positive(price),deep=positive(deepReference);
  if(!current||!zones?.valid||typeof lab?.reachabilityProfile!=='function')
    return {valid:false,price:null,deepReference:deep,reason:'支撐或歷史觸及資料不足'};
  const candidates=[];
  for(const name of ['S1','S2']){
    const z=zones.levels?.[name],value=positive(z?.center);
    if(!value||value>=current*.998||(deep&&value<=deep*1.005))continue;
    const result=lab.reachabilityProfile(bars,current,value);
    if(!result?.valid)continue;
    const h20=result.horizons?.find(x=>x.days===20),h40=result.horizons?.find(x=>x.days===40);
    const sample=Number(result.sample)||0,hit40=Number(h40?.hit)||0;
    // Minimum independent evidence: two 40-day touches from the existing 60-day spaced samples.
    if(sample<6||hit40<2)continue;
    candidates.push({valid:true,label:name,price:value,deepReference:deep,
      sample,hit20:Number(h20?.hit)||0,hit40,pct20:Number(h20?.hitPct)||0,
      pct40:Number(h40?.hitPct)||0,confidence:z.confidence||'observed',
      source:'SR8.2 support center + unchanged historical same-amplitude touch rate'});
  }
  // Select the nearest supported, validated structure, not an arbitrary optimistic level.
  candidates.sort((a,b)=>b.price-a.price);
  return candidates[0]||{valid:false,price:null,deepReference:deep,reason:'沒有通過歷史觸及驗證的主要回測價'};
 }
 function displayRange({price,deepReference,mainPullback}={}){
  const p=positive(price),deep=positive(deepReference),main=positive(mainPullback?.price);
  if(!p||!deep||!mainPullback?.valid||!main||!(deep<main&&main<p))return '--%';
  const fmt=v=>(v>=0?'+':'')+Number(v.toFixed(1))+'%';
  return fmt((main/p-1)*100)+' ～ '+fmt((deep/p-1)*100);
 }
 return {select,displayRange};
});

