/* StockZone V4 | Structural play-style research (pure, independent; no valuations/targets/W3 in style). */
(function(root, factory){
  const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZonePlayV4=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
  const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
  const gradeNames={strong:'長抱基礎強',good:'長抱基礎尚佳',ordinary:'長抱基礎一般',weak:'長抱理由偏弱',unknown:'基本面不足'};
  const rhythmNames={persistent:'趨勢續航',recovering:'深回有修復',tradeable:'反覆可交易波段',roundtrip:'漲後回原點',unresolved:'股性資料不足'};
  // 候選條件矩陣（非歷史回測最佳值），不按股票代碼判斷；不使用估值/近期法人/券商目標價。
  const grid={
    strong:   {persistent:85,recovering:75,tradeable:65,roundtrip:50,unresolved:70},
    good:     {persistent:75,recovering:65,tradeable:55,roundtrip:40,unresolved:60},
    ordinary: {persistent:60,recovering:50,tradeable:40,roundtrip:30,unresolved:45},
    weak:     {persistent:40,recovering:35,tradeable:25,roundtrip:20,unresolved:30},
    unknown:  {persistent:70,recovering:55,tradeable:40,roundtrip:30,unresolved:null}
  };
  function fundamentalBasis(a){
    const q=num(a?.companyQuality),continuation=num(a?.continuation),stability=num(a?.stability?.score),risk=num(a?.risk?.score),confidence=num(a?.operationalConfidence);
    if([q,continuation,stability,risk,confidence].some(x=>x===null)||confidence<55)
      return {tier:'unknown',label:gradeNames.unknown,complete:false,confidence:confidence??0,reason:'缺少足夠營運財報來源；不使用估值/券商目標價補缺'};
    let tier;
    if(risk>=55||q<40||continuation<35)tier='weak';
    else if(q>=77&&continuation>=68&&stability>=65&&risk<=25)tier='strong';
    else if(q>=62&&continuation>=55&&stability>=52&&risk<=40)tier='good';
    else tier='ordinary';
    return {tier,label:gradeNames[tier],complete:true,confidence,reason:`營運品質 ${q}｜成長延續 ${continuation}｜獲利穩定 ${stability}｜基本面風險 ${risk}｜營運資料 ${confidence}%`};
  }
  function rhythmBasis(p){
    if(!p?.valid)return {tier:'unresolved',label:rhythmNames.unresolved,complete:false,reason:'有效股性資料不足'};
    const reset=num(p.resetCycles),recover=num(p.recoveryDays),cross=num(p.cross20),above=num(p.above20),ret=num(p.ret120),cycles=num(p.completeCycles),deep=num(p.deepPullbacks),recoveredDeep=num(p.recoveredDeep);
    // 不能單看一次深回或重置。以漲後能否留住、回復與均線反覆穿越共同判斷。
    let tier='tradeable';
    const stable=above!==null&&above>=.72&&cross!==null&&cross<=4;
    if(stable&&(ret===null||ret>=8)&&(reset??0)<=1)tier='persistent';
    else if((recover!==null&&recover<=25&&(recoveredDeep??0)>=1&&(ret??0)>=6) ||
            (above!==null&&above>=.61&&(ret??0)>=12&&(reset??0)<=2))tier='recovering';
    else if((cycles??0)>=2&&((cross??0)>=8||(reset??0)>=2)&&((ret??0)<=12))tier='roundtrip';
    else if(p.kind==='range'&&(ret??0)<=10)tier='roundtrip';
    if((cycles??0)<2)tier=tier==='persistent'?tier:'tradeable';
    return {tier,label:rhythmNames[tier],complete:(cycles??0)>=2,reason:`循環 ${cycles??0}｜深回 ${(deep??0)}｜修復深回 ${(recoveredDeep??0)}｜重置 ${reset??0}｜MA20穿越 ${cross??'--'}｜均線保持 ${above===null?'--':Math.round(above*100)+'%'}｜120日報酬 ${ret===null?'--':ret.toFixed(1)+'%'}`};
  }
  function profile(core){
    const n=Math.round(clamp(core,10,90)/5)*5,key=n>=80?'long':n>=65?'long-swing':n>=45?'swing':n>=25?'mixed':'short';
    const name={long:'長期','long-swing':'長波',swing:'波段',mixed:'短波',short:'短期'}[key];
    return {key,label:name,period:name,basePct:n,tacticalPct:100-n};
  }
  function classify({personality,fundamental,holdingLock}={}){
    const f=fundamentalBasis(fundamental),p=rhythmBasis(personality),candidate=grid[f.tier][p.tier];
    if(candidate===null)return {available:false,reason:'基本面與股性證據都不足，不輸出虛構核心比例',fundamental:f,rhythm:p};
    // 只做條件決策，不以短期目標上漲空間變更結構性玩法；矩陣數值為候選而非經驗驗證結果。
    const out={...profile(candidate),available:true,provisional:!f.complete||!p.complete,confidence:(f.complete&&p.complete)?'條件齊備（仍未回測）':'資料部分不足（研究暫定）',fundamental:f,rhythm:p,modelVersion:'SZ-PLAY-V4-CANDIDATE',explanation:`${f.label} × ${p.label} → 研究核心 ${candidate}%`};
    if(holdingLock?.styleKey){
      const allowed={short:[10,20],mixed:[25,40],swing:[45,60],'long-swing':[65,75],long:[80,90]}[holdingLock.styleKey];
      if(allowed){const base=clamp(out.basePct,...allowed);out.locked={key:holdingLock.styleKey,basePct:base,tacticalPct:100-base,why:'交易成立後原玩法鎖定；只允許原區間的核心比例變動'};}
    }
    return out;
  }
  function tacticalLevels(wave,price){
    const p=num(price),pullback=num(wave?.pullbackLow),base=num(wave?.baseLow),top=num(wave?.firstWave);
    if(!wave?.valid||p===null||p<=0||base===null||top===null||top<=base)
      return {available:false,reason:'缺少有效第一波及目前股價，不能硬填機動倉目標'};
    // 嚴格使用正式 calculateSwingWave() 已產生的 ext15/ext20/ext25，絕不重新自創起漲點。
    const tiers=[['1.5X',wave?.ext15],['2X',wave?.ext20],['2.5X',wave?.ext25]]
      .map(([label,v])=>({label,value:num(v)}));
    if(tiers.some(x=>x.value===null)||tiers.some((x,i)=>i&&x.value<=tiers[i-1].value))
      return {available:false,reason:'倍率目標缺失或順序異常，不輸出交易建議'};
    const confirmed=!!wave?.completed&&pullback!==null;
    const points=tiers.map(x=>({...x,relativePct:(x.value/p-1)*100,status:p>=x.value?'已越過':p>=x.value*.985?'臨近':'尚未到達'}));
    const next=points.find(x=>x.value>p);
    return {available:true,confirmed,provisional:!confirmed,tiers:points,next:next||null,
      extensionMax:num(wave?.extensionMax),base:pullback??base,firstWaveX:top-base,
      reason:confirmed?'原版確認回測低點＋第一波價差X':'回測尚未確認；現有倍率僅供觀察，不視為已確定賣點'};
  }
  function resonanceDataConfidence(rawStrength,assessment){
    const raw=num(rawStrength);
    if(raw===null)return {available:false,confidence:null,raw:null,reason:'原版共振不存在，不能創造分數'};
    const operational=num(assessment?.operationalConfidence);
    // 財報缺漏只降低共振「可信度」，不改變已算出的原始共振強度或核心／機動公式。
    // 金融業不適用欄位由原版 fundamentals.coverage 處理，不在這裏以原始欄位數重算。
    const penalty=operational===null?12:Math.round(clamp((80-operational)*.15,0,12));
    return {available:true,raw:Math.round(raw),confidence:Math.round(clamp(raw-penalty,0,100)),penalty,
      note:penalty?`營運資料完整度 ${operational===null?'未知':operational+'%'}：可信度扣 ${penalty} 點（研究值，非統計校準）`:'營運資料達可信門檻，無完整度扣減'};
  }
  function manageTactical({wave,price,resonance,technicalConfirmed=false,w3}={}){
    const result=tacticalLevels(wave,price);
    if(!result.available)return {...result,action:'insufficient'};
    const w3Regime=String(w3?.regime||'').toLowerCase();
    if(w3Regime==='riskoff'||w3Regime==='off')return {...result,action:'market_risk_priority',reason:'W3 OFF風控優先於正常市場倍率'};
    if(w3?.warning===true)return {...result,action:'market_warning_priority',reason:'W3預警期間由買賣決策先執行風控'};
    if(w3Regime!==''&&w3Regime!=='riskon'&&w3Regime!=='on')return {...result,action:'w3_unknown',reason:'無法判明W3狀態'};
    if(!result.confirmed)return {...result,action:'observe_unconfirmed'};
    if(!result.next)return {...result,action:'extension_review',reason:'已越過2.5X，待技術法人與共振重新確認，不假定有更高倍率'};
    const quality=num(resonance?.confidence),near=result.next.relativePct<=3;
    const meets=quality!==null&&quality>=60&&technicalConfirmed===true;
    return {...result,action:near?(meets?'consider_tactical_trim':'observe_confirmation'):'wait_target',reason:near?'價格接近倍率：仍需原本技術／法人及共振確認，不自動交易':'未達下一個倍率觀察區'};
  }
  return Object.freeze({VERSION:'SZ-PLAY-V4-CANDIDATE',fundamentalBasis,rhythmBasis,profile,classify,tacticalLevels,manageTactical,resonanceDataConfidence});
});
