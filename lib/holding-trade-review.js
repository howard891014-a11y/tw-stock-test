/* StockZone 2.6.9.15 — historical evidence for manually locked plans.
 * This is NOT an ex-post reproduction of the historical V4 / broker / valuation inputs.
 * Outcomes start on the next trading session after each originally recorded snapshot.
 * No database writes, no price targets generated here, no automatic orders.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZoneTradeReview=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const HORIZONS=Object.freeze([3,5,10,15,20]);
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  const iso=t=>{const s=String(t||'');if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    const d=new Date(t);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
  function clean(raw){
    const rows=[],seen=new Set(),errors=[];
    for(const r of Array.isArray(raw)?raw:[]){
      const d=iso(r?.date??r?.tradeDate??r?.trade_date),open=Number(r?.open),high=Number(r?.high),low=Number(r?.low),close=Number(r?.close);
      if(!d||![open,high,low,close].every(positive)||low>high||open>high*1.0001||open<low*.9999||close>high*1.0001||close<low*.9999){errors.push('異常OHLC '+d);continue}
      if(seen.has(d)){errors.push('重複日期 '+d);continue}
      seen.add(d);rows.push({date:d,open,high,low,close});
    }
    rows.sort((a,b)=>a.date.localeCompare(b.date));
    const jumps=[];for(let i=1;i<rows.length;i++){
      const change=100*(rows[i].close/rows[i-1].close-1);
      if(Math.abs(change)>35)jumps.push({date:rows[i].date,changePct:Math.round(change*100)/100});
    }
    return {valid:rows.length>0&&errors.length===0&&jumps.length===0,bars:rows,errors,jumps,
      source:'historical-OHLC; no as-of broker/valuation replay'};
  }
  function targetOutcome(target,side,bars){
    if(!positive(target))return {status:'no-target',target:null,horizons:[]};
    const idx=bars.findIndex(b=>side==='down'?b.low<=target:b.high>=target);
    return {status:idx>=0?'hit':bars.length?'pending':'no-future',target,side,firstDay:idx<0?null:idx+1,
      firstDate:idx<0?null:bars[idx].date,horizons:HORIZONS.map(n=>({days:n,status:idx>=0&&idx<n?'hit':bars.length>=n?'miss':'pending'}))};
  }
  function evaluate(plan,raw){
    if(!plan?.initial?.targets||!plan?.createdAt)return {valid:false,reason:'原始計畫缺少建立時的共振快照'};
    const parsed=clean(raw);
    if(!parsed.valid)return {valid:false,reason:parsed.jumps.length?'偵測到大於35%的未確認跳變（可能分割／減資），停止績效與達標評估':parsed.errors.slice(0,2).join('；')||'無有效日K',problems:{errors:parsed.errors,jumps:parsed.jumps}};
    const all=[{kind:'initial',capturedAt:plan.initial.capturedAt||plan.createdAt,targets:plan.initial.targets,source:'original-locked'}];
    for(const u of plan.updates||[]){
      const a=u.analysis;
      if(a?.targets&&a.capturedAt&&a.playKey===plan.initial.playKey&&a.targetsStatus!=='retained-previous-no-confirmed-peak'){
        all.push({kind:'update',capturedAt:a.capturedAt,targets:a.targets,source:a.source||'locked-play-update'});
      }
    }
    const evaluations=all.map(x=>{
      const asOf=iso(x.capturedAt),forward=parsed.bars.filter(b=>b.date>asOf);
      const main=targetOutcome(x.targets?.main,'up',forward),secondary=targetOutcome(x.targets?.secondary,'up',forward),defense=targetOutcome(x.targets?.defense,'down',forward);
      // If both take-profit and stop hit during the first observed session,
      // OHLC cannot establish intraday order; refuse to call the trade a win.
      const sameBarAmbiguous=main.firstDay===1&&defense.firstDay===1;
      return {kind:x.kind,asOf,source:x.source,observedSessions:forward.length,main,secondary,defense,
        sameBarAmbiguous,modelReplay:false};
    });
    const initial=evaluations[0],latest=evaluations.at(-1);
    // Post-hoc same-window comparison of original and updated *saved* targets.
    // Only matured windows are compared; this is descriptive error, never causal lift.
    const revisions=evaluations.filter(e=>e.kind==='update').map(e=>{
      const forward=parsed.bars.filter(b=>b.date>e.asOf);
      const byH=[5,10,20].map(days=>{
        if(forward.length<days||!positive(initial.main.target)||!positive(e.main.target))return {days,status:'pending'};
        const futureMax=Math.max(...forward.slice(0,days).map(b=>b.high));
        const baseError=Math.round(Math.abs(initial.main.target-futureMax)/futureMax*10000)/100;
        const updatedError=Math.round(Math.abs(e.main.target-futureMax)/futureMax*10000)/100;
        return {days,status:'mature',originalErrorPct:baseError,updatedErrorPct:updatedError,
          differencePctPoints:Math.round((baseError-updatedError)*100)/100};
      });
      return {asOf:e.asOf,byH};
    });
    return {valid:true,stock:plan.initial.code,tradeId:plan.id,from:parsed.bars[0].date,to:parsed.bars.at(-1).date,
      initial,latest,evaluatedSnapshots:evaluations.length,updatesWithConfirmedNewTarget:evaluations.length-1,
      all:evaluations,revisions,
      caveat:'只檢驗當時保存的共振價位在後續OHLC是否觸及，並不代表當時一定成交；同日高低點不能判定先後。更新後的目標以更新翌日為起點。差異僅是同一未來區間最高價的事後誤差比較，不是正式回測或動態策略改善的因果證明。'};
  }
  function auditTransactions(plan,raw){
    const parsed=clean(raw);
    if(!parsed.valid)return {valid:false,reason:'歷史日K異常，停止成交價對照',problems:{errors:parsed.errors,jumps:parsed.jumps}};
    const map=new Map(parsed.bars.map(b=>[b.date,b]));
    const lines=(plan?.ledger?.trades||[]).map(t=>{
      const bar=map.get(t.tradeDate);
      if(!bar)return {id:t.id,tradeDate:t.tradeDate,status:'no-bar',note:'缺少該日K線；不可判斷成交合理性'};
      const matches=t.price>=bar.low*.999&&t.price<=bar.high*1.001;
      return {id:t.id,tradeDate:t.tradeDate,status:matches?'within-daily-range':'outside-daily-range',
        price:t.price,low:bar.low,high:bar.high};
    });
    return {valid:true,lines,plausible:lines.filter(x=>x.status==='within-daily-range').length,
      uncertain:lines.filter(x=>x.status!=='within-daily-range').length,
      caveat:'成交價僅與當日最高／最低價比對；不能證明真實成交，也不自動更改使用者紀錄。'};
  }
  return {HORIZONS,clean,evaluate,auditTransactions};
});
