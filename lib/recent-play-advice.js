/* StockZone v2.6.9.11 — 近期技術操作提示，僅用用戶指定的技術／籌碼輸入。
   不更改長期入場玩法、共振價格或正式持股；比例為待驗證的保守試算。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZoneRecentPlay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=x=>x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
  const fmt=x=>num(x)===null?'--':num(x).toLocaleString('zh-TW',{maximumFractionDigits:2});
  const pct=(a,b)=>a>0&&b>0?(a/b-1)*100:null;
  const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
  function returnN(history,n,price){
    const arr=(Array.isArray(history)?history:[]).filter(x=>num(x?.close)>0);
    const last=num(price),base=arr.length>n?num(arr[arr.length-1-n]?.close):null;
    return last&&base?pct(last,base):null;
  }
  function closest(levels,price,above){
    const valid=(Array.isArray(levels)?levels:[]).map(x=>({label:String(x?.label||'結構'),value:num(x?.value)}))
      .filter(x=>x.value!==null&&(above?x.value>price*1.002:x.value<price*.999)&&x.value>=price*.55&&x.value<=price*1.6);
    valid.sort((a,b)=>above?a.value-b.value:b.value-a.value);
    return valid[0]||null;
  }
  function realizedVol20(history){
    const a=(Array.isArray(history)?history:[]).map(x=>num(x?.close)).filter(x=>x>0);
    if(a.length<21)return null;
    const vals=[];for(let i=a.length-20;i<a.length;i++)vals.push(100*(a[i]/a[i-1]-1));
    const mean=vals.reduce((s,x)=>s+x,0)/vals.length;
    return Math.sqrt(vals.reduce((s,x)=>s+(x-mean)**2,0)/vals.length);
  }
  function evaluate(input){
    const price=num(input?.price),t=input?.technical||{},ma=t.ma||{},mom=t.momentum||{},boll=t.bollinger||{},volume=t.volume||{};
    if(!(price>0)||!(num(ma.ma20)>0))return {valid:false,reason:'缺少現價或20MA，不提供試單比例',mode:'資料不足',status:'等待資料',trialPct:null};
    const m5=num(ma.ma5),m10=num(ma.ma10),m20=num(ma.ma20),m60=num(ma.ma60),
      r5=returnN(t.history,5,price),r20=returnN(t.history,20,price),vol20=realizedVol20(t.history),
      rsi=num(mom.rsi14),hist=num(mom.histogram),volumeRatio=num(volume.ratio20),kd=input?.kd||{},k=num(kd.k),d=num(kd.d),
      institutionLabel=String(input?.institution?.label||''),financingLabel=String(input?.financing?.label||'');
    const support=closest(input?.supports,price,false),resistance=closest(input?.resistances,price,true),
      bearish=price<m20&&r20!==null&&r20<0&&(hist===null||hist<0),
      bullish=price>=m20&&(m60===null||m20>=m60)&&(hist===null||hist>=0),
      overheated=(rsi!==null&&rsi>=78)||(price>m20*1.16&&r5!==null&&r5>10),
      weakVolume=volumeRatio!==null&&volumeRatio<.7,
      creditRisk=/偏熱|偏弱/.test(financingLabel),instWeak=/偏空/.test(institutionLabel),
      nearSupport=support!==null&&price/support.value<=1.065,
      nearResistance=resistance!==null&&resistance.value/price<=1.025,
      macdOk=hist===null||hist>=0,
      kdOk=k===null||d===null||k>=d,
      bollOk=num(boll.lower)===null||price>=num(boll.lower),
      ready=nearSupport&&!bearish&&!overheated&&!weakVolume&&macdOk&&kdOk&&bollOk&&!creditRisk&&!instWeak&&!nearResistance;
    // 此為展示用的試算比例；正式風控／回測定案前不自動發單。
    const trialPct=ready?(bullish&&r5!==null&&r5>=0&&volumeRatio!==null&&volumeRatio>=.95&&vol20!==null&&vol20<=5&&price/support.value<=1.03?20:10):0;
    const mode=bearish?'等待轉強':bullish&&r20!==null&&r20>=0?'波段優先':price>=m5&&m5>=m10?'短線輔助／波段觀察':'波段回測觀察';
    const status=ready?'符合小量試單觀察條件':bearish?'近期結構偏弱，暫不試單':overheated?'過熱／乖離偏高，避免追價':nearResistance?'接近壓力位，等待突破或回測':!nearSupport?'不在已確認支撐附近，等待回測':creditRisk||instWeak?'籌碼風險升溫，暫緩試單':weakVolume?'量能不足，等確認':!macdOk||!kdOk?'動能未確認，先等待':'條件尚未齊備';
    const entry=ready?`參考支撐 ${fmt(support.value)} 附近，分批確認`:
      support?`等待 ${fmt(support.value)} 支撐守穩，並確認量價／動能`:'缺少可靠支撐位，暫不給進場價';
    const add=resistance?`突破 ${fmt(resistance.value)} 後量能不弱，再觀察加碼；或回測守穩支撐`:
      '未形成有效上方壓力，先等支撐及量價共同確認';
    const stop=support?`收盤有效失守 ${fmt(support.value)}，且量價／MACD 未修復時重新評估停損`:
      '支撐資料不足，不提供可執行停損價';
    const reason=[`5日 ${r5===null?'不足':r5.toFixed(1)+'%'}`,`20日 ${r20===null?'不足':r20.toFixed(1)+'%'}`,
      `20MA ${fmt(m20)}`,`近20日波動 ${vol20===null?'不足':vol20.toFixed(1)+'%'}`,`布林 ${num(boll.lower)===null?'不足':'已納入'}`,
      `MACD ${hist===null?'不足':hist>=0?'正柱':'負柱'}`,`RSI ${rsi===null?'不足':rsi.toFixed(0)}`,
      `KD ${k===null?'不足':k.toFixed(0)}`,`量比 ${volumeRatio===null?'不足':volumeRatio.toFixed(2)}`,
      `法人 ${institutionLabel||'不足'}`,`融資 ${financingLabel||'不足'}`].join('｜');
    return {valid:true,mode,status,trialPct,trial:entry,add,stop,reason,support,resistance,
      data:{r5,r20,vol20,ma5:m5,ma10:m10,ma20:m20,ma60:m60,rsi,macdHistogram:hist,kdK:k,kdD:d,volumeRatio,institutionLabel,financingLabel},
      provisional:true};
  }
  return {evaluate};
});
