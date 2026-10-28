/* StockZone v2.6.9.10 — 持股清單明確建單生命週期。
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
  const SOURCE='holding-list-explicit-v2.6.9.10';
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
    const before=clone(p.position),now=iso();
    if(before.avgCost===position.avgCost&&before.shares===position.shares)return {plan:clone(p),changed:false};
    const revision={id:newId(),type:'position-revision',at:now,before:{avgCost:before.avgCost,shares:before.shares},after:clone(position)};
    p.position={...position,updatedAt:now};p.revisions=Array.isArray(p.revisions)?p.revisions:[];
    p.revisions.push(revision);p.events=Array.isArray(p.events)?p.events:[];p.events.push(revision);
    write(storage,data);return {plan:clone(p),changed:true};
  }
  // 新分析僅作用於 current/last，絕不修改 initial。僅當來源真的出現不同建議才記錄。
  function live(storage,code,capture){
    const data=read(storage),p=activeFrom(data,code),key=codeOf(code);
    if(!p||!capture||capture.code!==key)return {changed:false};
    const old=p.last||{},next=clone(capture);
    // 玩法已被初始交易鎖定：不同玩法的新分析只留警訊，不將另一玩法的目標當成微調後執行價。
    if(p.initial?.playKey && next.playKey!==p.initial.playKey){
      const observedPlay=next.play;
      next.play=p.initial.play;next.playKey=p.initial.playKey;
      next.targets=clone(old.targets||p.initial.targets||{});
      next.decision=clone(old.decision||p.initial.decision||{});
      next.allocation=clone(old.allocation||p.initial.allocation||{});
      next.signal=`系統目前判讀 ${observedPlay||'不同玩法'}；原始 ${p.initial.play} 不變，暫停跨玩法目標微調。${next.signal||''}`;
      next.modeChangeObserved=observedPlay;
    }
    const comparable=x=>JSON.stringify({play:x.play,targets:x.targets,decision:x.decision,signal:x.signal,risk:x.risk,allocation:x.allocation});
    if(comparable(old)===comparable(next))return {changed:false};
    const now=iso(),diffs=[];
    for(const field of ['targets','decision','signal','risk','allocation']){
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
  return {KEY,SOURCE,read,active,create,revise,live,cancel,normalizePosition};
});
