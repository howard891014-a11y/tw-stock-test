/* StockZone v2.6.9.15 — 持股計畫鎖定原玩法的動態追蹤。
 * 僅管理本機計畫快照；不計算、不覆寫共振／V4／W3 公式，也不送出交易。
 * 延用既有 stockzone_auto_trade_plans_v2692 紀錄，保留舊 archived/active。
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.StockZoneHoldingPlans=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const KEY='stockzone_auto_trade_plans_v2692';
  const SOURCE='holding-list-explicit-v2.6.9.10'; // historical plan source unchanged
  const iso=()=>new Date().toISOString();
  const clone=x=>JSON.parse(JSON.stringify(x));
  const day=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
  const newId=()=>typeof globalThis.crypto?.randomUUID==='function'?globalThis.crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
  const codeOf=code=>String(code||'').trim();
  function read(storage){
    const raw=storage.getItem(KEY);if(!raw)return {};
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('交易計畫資料格式不正確，已中止操作以避免覆蓋');
    return value;
  }
  function write(storage,data){storage.setItem(KEY,JSON.stringify(data));}
  const activeFrom=(data,code)=>{const p=data[codeOf(code)]?.active;return p?.explicitPlan===true&&p.status==='open'?p:null;};
  function active(storage,code){return clone(activeFrom(read(storage),code));}
  function normalizePosition(avgCost,shares){
    const avg=Number(avgCost),qty=Number(shares);
    if(!Number.isFinite(avg)||avg<=0)throw Error('持股均價必須大於 0');
    if(!Number.isSafeInteger(qty)||qty<=0)throw Error('持股股數必須是大於 0 的整數');
    return {avgCost:avg,shares:qty};
  }
  function create(storage,code,avgCost,shares,capture){
    const key=codeOf(code),position=normalizePosition(avgCost,shares);
    if(!key)throw Error('找不到股票代號');
    if(!capture||capture.code!==key||!capture.play||capture.play==='待分析')throw Error('請先開啟該股票，等待玩法分析完成後再建立計畫');
    const data=read(storage),rec=data[key]||{archived:[]};
    if(activeFrom(data,key))throw Error('已有交易計畫，請使用修改計畫');
    const now=iso();
    // 以前「加入持股即自動建單」的紀錄保留為歷史，不冒充人工確認的計畫。
    rec.archived=Array.isArray(rec.archived)?rec.archived:[];
    if(rec.active)rec.archived.push({...rec.active,closedAt:now,status:'superseded-legacy-auto',archiveReason:'以明確建立計畫取代舊自動追蹤'});
    const original=clone({...capture,code:key,holdingCost:position.avgCost,holdingShares:position.shares});
    const plan={id:newId(),explicitPlan:true,origin:SOURCE,status:'open',startDate:day(now),createdAt:now,
      initial:original,last:clone(capture),position:{...position,updatedAt:now},updates:[],revisions:[],
      events:[{id:newId(),type:'plan-created',at:now,position:clone(position),source:SOURCE}]};
    rec.active=plan;data[key]=rec;write(storage,data);return clone(plan);
  }
  function revise(storage,code,avgCost,shares){
    const position=normalizePosition(avgCost,shares),data=read(storage),p=activeFrom(data,code);
    if(!p)throw Error('尚未建立交易計畫');
    if(Array.isArray(p.ledger?.trades)&&p.ledger.trades.length)throw Error('已有交易紀錄，不能再直接覆寫均價與股數；請使用試單／加碼／減碼／出清記錄，避免績效失真');
    const before=clone(p.position),now=iso();
    if(before.avgCost===position.avgCost&&before.shares===position.shares)return {plan:clone(p),changed:false};
    const revision={id:newId(),type:'position-revision',at:now,before:{avgCost:before.avgCost,shares:before.shares},after:clone(position)};
    p.position={...position,updatedAt:now};p.revisions=Array.isArray(p.revisions)?p.revisions:[];
    p.revisions.push(revision);p.events=Array.isArray(p.events)?p.events:[];p.events.push(revision);
    write(storage,data);return {plan:clone(p),changed:true};
  }
  const STYLE_BOUNDS=Object.freeze({short:[10,20],mixed:[25,40],swing:[45,60],'long-swing':[65,75],long:[80,90]});
  const limit=(x,min,max)=>Math.max(min,Math.min(max,x));
  // Only an advisory allocation. No automatic sale or actual-position change.
  // The original core/tactical and style remain immutable in initial.
  function recommendAllocation(initial,current,{w3=null}={}){
    const key=initial?.playKey,range=STYLE_BOUNDS[key];
    if(!range)return {valid:false,reason:'歷史計畫玩法未識別，不能自動調倉'};
    const base=Number(initial?.allocation?.core);
    if(!Number.isFinite(base)||base<=0)return {valid:false,reason:'原始核心比例不足，維持原建議'};
    const start=limit(base,...range),score=Number(current?.risk?.score),risk=Number.isFinite(score)?score:null;
    const off=w3?.verified===true&&w3.regime==='off',warning=w3?.verified===true&&w3.warning===true;
    let delta=risk===null?0:risk>=72?-10:risk>=50?-5:risk<=24?5:0;
    if(warning)delta=Math.min(delta,-5);
    if(off)delta=Math.min(delta,-10);
    const core=limit(Math.round((start+delta)/5)*5,...range),tactical=100-core;
    let action='目前依原始玩法，觀察支撐／壓力與減碼條件';
    if(off&&['short','mixed'].includes(key))action='空頭環境：短線／短波建議全部出清（僅提醒，不自動下單）';
    else if(off)action='空頭環境：優先處理機動倉；核心倉是否減碼仍需檢查長期條件';
    else if(risk!==null&&risk>=72)action='結構風險極高：優先減碼機動倉，核心倉按原玩法確認';
    else if(warning||risk!==null&&risk>=50)action='風險升溫：降低機動曝險，暫緩補倉';
    else if(risk!==null&&risk<=24)action='風險偏低：可依原玩法觀察補倉條件，不自動加碼';
    return {valid:true,core,tactical,originalCore:base,bounds:range,action,
      w3Verified:w3?.verified===true,riskScore:risk,provisional:true};
  }
  // 新分析僅作用於 current/last，絕不修改 initial。僅當來源真的出現不同建議才記錄。
  function live(storage,code,capture){
    const data=read(storage),p=activeFrom(data,code),key=codeOf(code);
    if(!p||!capture||capture.code!==key)return {changed:false};
    const old=p.last||{},next=clone(capture);
    // Cross-mode values are forbidden. The caller must recalculate the original
    // transaction mode against today's signals; relabelling a short-term target
    // as a swing target is not a valid recalculation.
    if(p.initial?.playKey&&next.playKey!==p.initial.playKey)return {changed:false,blocked:true,reason:'未依原始玩法重新計算，拒絕跨玩法覆蓋'};
    if(next.analysisPlayKey&&next.analysisPlayKey!==p.initial.playKey)return {changed:false,blocked:true,reason:'重新計算玩法與原始玩法不符'};
    if(!Number.isFinite(Number(next?.targets?.main))||Number(next.targets.main)<=0)return {changed:false,blocked:true,reason:'新分析主共振不足，不覆寫舊目標'};
    const comparable=x=>JSON.stringify({play:x.play,targets:x.targets,decision:x.decision,signal:x.signal,risk:x.risk,allocation:x.allocation,holdingAction:x.holdingAction,modeChangeObserved:x.modeChangeObserved,recent:x.recent});
    if(comparable(old)===comparable(next))return {changed:false};
    const now=iso(),diffs=[];
    for(const field of ['targets','decision','signal','risk','allocation','holdingAction','modeChangeObserved','recent']){
      if(JSON.stringify(old[field])!==JSON.stringify(next[field]))diffs.push(field);
    }
    const event={id:newId(),type:'resonance-advice-updated',at:now,signalAsOf:next.capturedAt,
      source:next.source||'既有共振及買賣決策輸出',fields:diffs,
      previous:clone({targets:old.targets??null,decision:old.decision??null,signal:old.signal??null,risk:old.risk??null}),
      current:clone({targets:next.targets??null,decision:next.decision??null,signal:next.signal??null,risk:next.risk??null})};
    p.last=next;p.updates=Array.isArray(p.updates)?p.updates:[];p.updates.push({at:now,analysis:next,changed:diffs});
    p.events=Array.isArray(p.events)?p.events:[];p.events.push(event);
    write(storage,data);return {changed:true,fields:diffs};
  }
  // 第三批：所有成交只記錄在原本計畫的同一個 localStorage JSON 中。
  // 建立計畫時的持倉是人工輸入的期初庫存，不冒充已驗證成交。
  const TRADE_TYPES=Object.freeze({trial:'試單',add:'加碼',reduce:'減碼',exit:'出清'});
  const money=n=>Math.round((n+Number.EPSILON)*100)/100;
  const real=n=>typeof n==='number'&&Number.isFinite(n);
  const tDate=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
  function validTradeDate(d){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(d)))return false;
    const dt=new Date(d+'T00:00:00Z');return !Number.isNaN(dt.getTime())&&dt.toISOString().slice(0,10)===d;
  }
  function ledgerOf(p){
    return p.ledger||{version:1,opening:{shares:p.position.shares,avgCost:p.position.avgCost,asOf:p.startDate,kind:'manual-inventory-baseline',notATrade:true},trades:[]};
  }
  function replay(ledger){
    const op=ledger?.opening;
    if(!op||!Number.isSafeInteger(op.shares)||op.shares<1||!real(op.avgCost)||op.avgCost<=0||!Array.isArray(ledger.trades))throw Error('交易紀錄不完整，禁止自動重算或覆寫');
    let shares=op.shares,cost=money(op.avgCost*shares),realizedGross=0,realizedNet=0,realizedBasis=0,realizedProceeds=0;
    let buyTotal=0,sellTotal=0,expenses=0;
    const lines=[];
    for(const tx of ledger.trades){
      if(!TRADE_TYPES[tx.type]||!validTradeDate(tx.tradeDate)||!Number.isSafeInteger(tx.shares)||tx.shares<=0||!real(tx.price)||tx.price<=0||!real(tx.fee)||tx.fee<0||!real(tx.tax)||tx.tax<0)throw Error('交易流水有非法資料，拒絕計算');
      if(!real(tx.shares*tx.price)||tx.shares*tx.price>Number.MAX_SAFE_INTEGER)throw Error('成交金額不在安全範圍');
      const before=shares,fee=tx.fee,tax=tx.tax,gross=money(tx.shares*tx.price),priorAvg=shares>0?cost/shares:0;
      if(tx.type==='trial'||tx.type==='add'){
        if(shares<=0)throw Error('已結清計畫不可再次加碼，請新建下一筆交易');
        if(!Number.isSafeInteger(shares+tx.shares)||!real(cost+gross+fee+tax)||cost+gross+fee+tax>Number.MAX_SAFE_INTEGER)throw Error('持倉超過安全計算範圍');
        shares+=tx.shares;cost=money(cost+gross+fee+tax);buyTotal=money(buyTotal+gross);expenses=money(expenses+fee+tax);
        lines.push({...tx,kind:'buy',beforeShares:before,afterShares:shares,realizedGross:0,realizedNet:0,avgCost:money(cost/shares)});
      }else{
        if(tx.shares>shares)throw Error('賣出股數超過已登記的持股');
        if(tx.type==='reduce'&&tx.shares===shares)throw Error('全部售出必須選出清');
        if(tx.type==='exit'&&tx.shares!==shares)throw Error('出清必須等於全部剩餘股數');
        const basis=money(priorAvg*tx.shares),grossPnl=money(gross-basis),netPnl=money(grossPnl-fee-tax);
        shares-=tx.shares;cost=shares?money(cost-basis):0;
        realizedGross=money(realizedGross+grossPnl);realizedNet=money(realizedNet+netPnl);
        realizedBasis=money(realizedBasis+basis);realizedProceeds=money(realizedProceeds+gross-fee-tax);
        sellTotal=money(sellTotal+gross);expenses=money(expenses+fee+tax);
        lines.push({...tx,kind:'sell',beforeShares:before,afterShares:shares,realizedGross:grossPnl,realizedNet:netPnl,avgCost:shares?money(cost/shares):0});
      }
    }
    return {shares,avgCost:shares?money(cost/shares):0,remainingCost:cost,realizedGross,realizedNet,
      realizedBasis,realizedProceeds,realizedReturnPct:realizedBasis>0?money(100*realizedNet/realizedBasis):null,
      bought:buyTotal,sold:sellTotal,expenses,lines,tradeCount:lines.length,closed:shares===0,
      opening:clone(op),expenseNote:'僅扣除使用者輸入的實際費用／稅額；未輸入不估算'};
  }
  function metrics(p,markPrice=null){
    if(!p)return null;
    const ledger=ledgerOf(p),r=replay(ledger),mark=markPrice===null||markPrice===undefined||markPrice===''?null:Number(markPrice);
    if(mark!==null&&(!real(mark)||mark<=0))throw Error('參考價格必須大於0');
    return {...r,markPrice:mark,unrealizedGross:mark===null||r.shares===0?null:money(mark*r.shares-r.remainingCost),
      totalPnlWithMark:mark===null?null:money(r.realizedNet+mark*r.shares-r.remainingCost),
      ledgerVersion:ledger.version||1};
  }
  function record(storage,code,trade){
    const data=read(storage),p=activeFrom(data,code),key=codeOf(code);
    if(!p)throw Error('沒有活動中的交易計畫，請先建立計畫');
    const type=String(trade?.type||'').trim(),d=String(trade?.tradeDate||'').trim();
    const shares=Number(trade?.shares),price=Number(trade?.price);
    const fee=trade?.fee===''||trade?.fee==null?0:Number(trade.fee),tax=trade?.tax===''||trade?.tax==null?0:Number(trade.tax);
    const note=String(trade?.note||'').trim(),bucket=String(trade?.bucket||'unspecified');
    if(!['unspecified','core','tactical'].includes(bucket))throw Error('倉別必須是核心／機動／未區分');
    if(!TRADE_TYPES[type])throw Error('請選擇試單／加碼／減碼／出清');
    if(!validTradeDate(d)||d>tDate(new Date()))throw Error('成交日期無效或在未來');
    if(d<p.startDate)throw Error('不能將建檔以前的交易冒充本計畫的成交；期初持倉已作成本基準');
    if(!Number.isSafeInteger(shares)||shares<=0)throw Error('成交股數必須是正整數');
    if(!real(price)||price<=0)throw Error('成交價格必須大於0');
    if(!real(shares*price)||shares*price>Number.MAX_SAFE_INTEGER)throw Error('成交金額超過安全計算範圍');
    if(!real(fee)||fee<0||!real(tax)||tax<0)throw Error('費用及稅額不得為負數');
    if(note.length>250)throw Error('交易說明不得超過250字');
    const ledger=clone(ledgerOf(p)),last=ledger.trades.at(-1);
    if(last&&d<last.tradeDate)throw Error('成交日期必須依時間順序紀錄；不可事後插入較早交易');
    // Do not infer actual fills from a market price or a model recommendation.
    const tx={id:newId(),type,bucket,tradeDate:d,shares,price,fee:money(fee),tax:money(tax),note,recordedAt:iso(),
      manualFill:true,planId:p.id,playKey:p.initial?.playKey||null,
      signalAtRecord:clone({capturedAt:p.last?.capturedAt??null,targets:p.last?.targets??null,signal:p.last?.signal??null,
        risk:p.last?.risk??null,allocation:p.last?.allocation??null})};
    ledger.trades.push(tx);
    const result=replay(ledger); // any oversell/invariant failure must happen before any write
    p.ledger=ledger;p.events=Array.isArray(p.events)?p.events:[];
    p.events.push({id:newId(),type:'manual-trade-recorded',at:tx.recordedAt,tradeId:tx.id,action:type,tradeDate:d,
      positionAfter:{shares:result.shares,avgCost:result.avgCost},source:'user-confirmed-manual-fill'});
    p.position={shares:result.shares,avgCost:result.avgCost,updatedAt:tx.recordedAt};
    if(result.closed){
      p.status='closed';p.closedAt=tx.recordedAt;p.closeReason='fully-exited-by-manual-ledger';
      const rec=data[key];rec.archived=Array.isArray(rec.archived)?rec.archived:[];rec.archived.push(p);rec.active=null;
    }
    write(storage,data);return {planId:p.id,closed:result.closed,trade:clone(tx),metrics:result};
  }
  function history(storage,code=null){
    const all=read(storage),keys=code==null?Object.keys(all):[codeOf(code)];
    return keys.flatMap(k=>Array.isArray(all[k]?.archived)?all[k].archived.map(p=>({code:k,...clone(p)})):[]);
  }
  function cancel(storage,code){
    const data=read(storage),key=codeOf(code),p=activeFrom(data,key);
    if(!p)return false;
    const rec=data[key],now=iso();
    p.events=Array.isArray(p.events)?p.events:[];
    p.events.push({id:newId(),type:'plan-cancelled',at:now,reason:'使用者取消計畫（不代表真實成交或全部出清）'});
    rec.archived=Array.isArray(rec.archived)?rec.archived:[];
    rec.archived.push({...p,status:'cancelled',closedAt:now,closeReason:'使用者取消計畫；非交易結算'});
    rec.active=null;write(storage,data);return true;
  }
  return {KEY,SOURCE,STYLE_BOUNDS,TRADE_TYPES,read,active,create,revise,live,cancel,record,metrics,history,replay,normalizePosition,recommendAllocation};
});
