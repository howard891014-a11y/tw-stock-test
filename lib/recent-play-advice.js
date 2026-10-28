/* StockZone v2.6.9.23 — 近期試單與雙補倉訊號。
 * 以小額試錯而非完美支撐為目標；不更改 V4、共振、W3、核心／機動倉。
 * 5%/10% 僅為保守初始政策，並非回測找到的最佳比例；不自動成交。
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZoneRecentPlay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
  const fmt=x=>num(x)===null?'--':num(x).toLocaleString('zh-TW',{maximumFractionDigits:2});
  const pct=(a,b)=>a>0&&b>0?(a/b-1)*100:null;
  function returnN(history,n,price){
    const arr=(Array.isArray(history)?history:[]).filter(x=>num(x?.close)>0);
    const last=num(price),base=arr.length>n?num(arr[arr.length-1-n]?.close):null;
    return last&&base?pct(last,base):null;
  }
  // 支撐接觸現價時不可被偷偷拋棄；上方壓力與「剛突破的舊壓力」分開追蹤。
  function closest(levels,price,kind){
    const a=(Array.isArray(levels)?levels:[]).map(x=>({label:String(x?.label||'結構'),value:num(x?.value),lower:num(x?.lower),upper:num(x?.upper)}))
      .filter(x=>x.value!==null&&x.value>=price*.55&&x.value<=price*1.6&&(
        kind==='support'?x.value<=price*1.005:kind==='breakout'?x.value<price*.997&&x.value>=price/1.045:x.value>price*1.002));
    a.sort((x,y)=>kind==='resistance'?x.value-y.value:y.value-x.value);
    return a[0]||null;
  }
  function realizedVol20(history){
    const a=(Array.isArray(history)?history:[]).map(x=>num(x?.close)).filter(x=>x>0);
    if(a.length<21)return null;
    const vals=[];for(let i=a.length-20;i<a.length;i++)vals.push(100*(a[i]/a[i-1]-1));
    const mean=vals.reduce((s,x)=>s+x,0)/vals.length;
    return Math.sqrt(vals.reduce((s,x)=>s+(x-mean)**2,0)/vals.length);
  }
  function evaluate(input={}){
    const price=num(input.price),t=input.technical||{},ma=t.ma||{},mom=t.momentum||{},boll=t.bollinger||{},volume=t.volume||{};
    const insufficient={valid:false,mode:'資料不足',status:'資料不足，暫停試單／補倉',trialPct:0,trial:'不依缺值推定可買進',add:'等待資料補齊',
      stop:'沒有可驗證的停損條件',support:null,resistance:null,entrySignals:{pullback:false,chase:false}};
    if(!(price>0))return {...insufficient,reason:'缺少有效現價'};
    const m5=num(ma.ma5),m10=num(ma.ma10),m20=num(ma.ma20),m60=num(ma.ma60),
      r5=returnN(t.history,5,price),r20=returnN(t.history,20,price),vol20=realizedVol20(t.history),
      rsi=num(mom.rsi14),hist=num(mom.histogram),ratio=num(volume.ratio20),
      kd=input.kd||{},k=num(kd.k),d=num(kd.d),
      institutionLabel=String(input.institution?.label||''),financingLabel=String(input.financing?.label||'');
    const support=closest(input.supports,price,'support'),resistance=closest(input.resistances,price,'resistance'),
      brokenResistance=closest(input.resistances,price,'breakout');
    const missing=[['MA5',m5],['MA10',m10],['MA20',m20],['近5日',r5],['近20日',r20],
      ['近20日波動',vol20],['RSI',rsi],['MACD',hist],['量比',ratio],['布林下軌',num(boll.lower)]]
      .filter(([,v])=>v===null).map(([name])=>name);
    if(missing.length)return {...insufficient,reason:`核心技術資料缺少：${missing.join('、')}`,support,resistance};
    const bearish=(price<m20*.97&&m5<m10&&r5<0&&hist<0)||
      (m60!==null&&price<m60*.95&&r20< -12&&hist<0);
    const overheated=rsi>=80||(price>m20*1.20&&r5>12)||(rsi>=75&&ratio>=2&&r5>12);
    const creditRisk=/偏熱|偏弱|風險升溫/.test(financingLabel),instWeak=/偏空|明顯賣超/.test(institutionLabel);
    const breakRisk=num(boll.lower)!==null&&price<num(boll.lower)*.99&&hist<0;
    const noDemand=ratio<.5&&m5<m10&&r5<0;
    const severe=bearish||overheated||creditRisk||instWeak||breakRisk||noDemand;
    const strong=!severe&&price>=m20&&m5>=m10&&r5>=0&&r20>=0&&hist>=0&&rsi>=45&&rsi<=72&&ratio>=.9&&
      (k===null||d===null||k>=d)&&price<=m20*1.13;
    // 不是以「距支撐6.5%」或「距壓力2.5%」作一票否決。
    const trialPct=severe?0:strong?10:5;
    const nearSupport=support!==null&&price>=support.value*.99&&price<=support.value*1.03;
    const pullbackReady=!severe&&nearSupport&&price>=m20*.97&&
      (m5>=m10||hist>=0)&&(ratio>=.7)&&(r5>=-5)&&(k===null||d===null||k>=d);
    const chaseReady=!severe&&brokenResistance!==null&&price>=brokenResistance.value*1.003&&
      price<=brokenResistance.value*1.045&&m5>=m10&&hist>=0&&ratio>=1.1&&rsi<=75&&r5>=0;
    const status=severe?'明確風險升溫，暫停試單':strong?'近期趨勢支持，可小量試單':'沒有明確重大風險，可謹慎小量試單';
    const mode=bearish?'等待轉強':strong?'波段優先':'短線輔助／波段觀察';
    const entry=trialPct>0?`現價 ${fmt(price)}：${strong?'訊號較完整':'先用小部位觀察'}，不必等待支撐到價`:
      '近期有明確風險，暫不試單';
    const pullNote=pullbackReady?`回測 ${fmt(support.value)} 附近，已見守穩訊號（須持股且風控通過）`:
      support?`待回測 ${fmt(support.value)} 並確認止跌`:'缺少有效支撐，回測補倉暫停';
    const chaseNote=chaseReady?`站上原壓力 ${fmt(brokenResistance.value)} 並有量價確認（須持股且風控通過）`:
      resistance?`待突破 ${fmt(resistance.value)} 並以量價確認`:
      brokenResistance?`已越過 ${fmt(brokenResistance.value)}，需再次確認動能／追價距離`:'缺少可核對的突破壓力，追價補倉暫停';
    const stop=support?`最近支撐 ${fmt(support.value)}；最終停損依單一決策的結構防守價`:
      '近期支撐不足；最終停損須由原結構防守確認';
    const reason=[`5日 ${r5.toFixed(1)}%`,`20日 ${r20.toFixed(1)}%`,`20MA ${fmt(m20)}`,
      `近20日波動 ${vol20.toFixed(1)}%`,`布林下軌 ${fmt(boll.lower)}`,
      `MACD ${hist>=0?'正柱':'負柱'}`,`RSI ${rsi.toFixed(0)}`,
      `KD ${k===null||d===null?'不足':`${k.toFixed(0)}/${d.toFixed(0)}`}`,
      `量比 ${ratio.toFixed(2)}`,`法人 ${institutionLabel||'未確認'}`,`融資 ${financingLabel||'未確認'}`].join('｜');
    return {valid:true,mode,status,trialPct,trial:entry,add:`回測：${pullNote}｜追價：${chaseNote}`,stop,reason,
      support,resistance,brokenResistance,entrySignals:{pullback:pullbackReady,chase:chaseReady,pullNote,chaseNote},
      signalStrength:strong?'strong':severe?'blocked':'cautious',riskFlags:{bearish,overheated,creditRisk,instWeak,breakRisk,noDemand},
      data:{r5,r20,vol20,ma5:m5,ma10:m10,ma20:m20,ma60:m60,rsi,macdHistogram:hist,kdK:k,kdD:d,volumeRatio:ratio,institutionLabel,financingLabel},
      provisional:true};
  }
  return {evaluate};
});
