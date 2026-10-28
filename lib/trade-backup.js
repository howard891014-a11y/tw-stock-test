/* StockZone v2.6.9.16 — portable, verified, browser-only trade/analysis backup.
 * Never sends holdings or financial information to Neon/Vercel/Supabase.
 * Downloads are USER INITIATED. Local/browser storage is NOT an off-device backup.
 */
(function(root,factory){
  const out=factory();
  if(typeof module==='object'&&module.exports)module.exports=out;
  if(root)root.StockZoneTradeBackup=out;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const KIND='StockZone-trade-recovery';
  const VERSION=1;
  const KEYS=Object.freeze([
    'stockzone_auto_trade_plans_v2692',
    'stockzone_holdings_v2',
    'stockzone_watchlist_v2',
    'sz_resonance_lab_r1_plans'
  ]);
  const BACKUP_STATE_KEY='stockzone_trade_backup_verified_v26916';
  const MAX_JSON_CHARS=22_000_000;
  const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const readJson=(raw,label)=>{try{return JSON.parse(raw)}catch{throw Error(`${label} 無法解析，已拒絕匯入`);}};
  function readSnapshot(storage){
    const obj={};for(const key of KEYS)obj[key]=storage.getItem(key)||null;
    return obj;
  }
  async function sha256(source){
    const bytes=new TextEncoder().encode(source);
    if(globalThis.crypto?.subtle){
      const buffer=await globalThis.crypto.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
    }
    // Only Node/CommonJS test fallback; browsers MUST use Web Crypto.
    if(typeof require==='function')return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    throw Error('此瀏覽器不支援 SHA-256，無法安全驗證備份');
  }
  function auditSnapshot(snapshot){
    if(!isObj(snapshot)||Object.keys(snapshot).length!==KEYS.length||KEYS.some(k=>!Object.prototype.hasOwnProperty.call(snapshot,k)))
      throw Error('備份資料欄位與StockZone格式不符');
    for(const [key,raw] of Object.entries(snapshot)){
      if(raw!==null&&(typeof raw!=='string'||raw.length>MAX_JSON_CHARS))throw Error(`${key} 儲存長度或格式錯誤`);
    }
    const plans=snapshot[KEYS[0]]===null?{}:readJson(snapshot[KEYS[0]],'交易計畫');
    if(!isObj(plans))throw Error('交易計畫不是有效物件');
    const holdings=snapshot[KEYS[1]]===null?[]:readJson(snapshot[KEYS[1]],'持股清單');
    const watchlist=snapshot[KEYS[2]]===null?[]:readJson(snapshot[KEYS[2]],'觀察清單');
    const lab=snapshot[KEYS[3]]===null?{}:readJson(snapshot[KEYS[3]],'共振研究');
    if(!Array.isArray(holdings)||!Array.isArray(watchlist)||!isObj(lab))throw Error('清單或共振研究格式錯誤');
    for(const [label,arr] of [['持股',holdings],['觀察',watchlist]]){
      if(arr.length>10000||arr.some(x=>!isObj(x)||typeof (x.code??x.symbol)!=='string'||String(x.code??x.symbol).length>35))
        throw Error(`${label}清單含不合法股票代號或資料`);
    }
    if(Object.keys(plans).length>5000||Object.keys(lab).length>5000)throw Error('備份包含異常大量的交易計畫');
    const ids=new Set();let archived=0,active=0,trades=0,snapshots=0;
    // Use exact ledger replay from the installed trading engine; do not guess or silently repair history.
    const core=globalThis.StockZoneHoldingPlans||(typeof require==='function'?require('./holding-trade-plans'):null);
    if(!core?.metrics)throw Error('交易驗證引擎未載入，禁止匯入');
    for(const [code,rec] of Object.entries(plans)){
      if(!isObj(rec)||!Array.isArray(rec.archived||[]))throw Error(`${code} 歷史計畫格式不正確`);
      for(const p of [rec.active,...(rec.archived||[])]){
        if(!p)continue;
        if(!isObj(p))throw Error(`${code} 計畫格式不正確`);
        if(p.explicitPlan!==true)continue; // Keep pre-916 legacy records exactly, never upgrade them implicitly.
        if(typeof p.id!=='string'||!p.id||ids.has(p.id)||!isObj(p.initial)||p.initial.code!==code||!p.initial.playKey)
          throw Error(`${code} 原始玩法或計畫ID異常，禁止覆蓋`);
        ids.add(p.id);snapshots++;
        if(p.ledger?.trades){
          const transactions=p.ledger.trades;
          if(!Array.isArray(transactions)||transactions.length>25000)throw Error(`${code} 交易流水不合法`);
          const tradeIds=new Set();let previousDate='';
          for(const tx of transactions){
            if(!tx?.id||tradeIds.has(tx.id)||tx.planId!==p.id||tx.playKey&&tx.playKey!==p.initial.playKey||
              tx.tradeDate<previousDate)throw Error(`${code} 交易順序、玩法或流水ID異常`);
            tradeIds.add(tx.id);previousDate=tx.tradeDate;
          }
        }
        const result=core.metrics(p);
        if(p.status==='closed'&&result.shares!==0)throw Error(`${code} 已出清紀錄與流水不一致`);
        if(p.status==='open'&&result.shares<=0)throw Error(`${code} 活動計畫股數不一致`);
        if(p.status==='open')active++;else archived++;
        trades+=result.tradeCount;
      }
    }
    return {active,archived,trades,originalPlans:snapshots,holdings:holdings.length,watchlist:watchlist.length,
      labStocks:Object.keys(lab).length};
  }
  async function build(storage){
    const snapshot=readSnapshot(storage),summary=auditSnapshot(snapshot);
    const core={kind:KIND,schemaVersion:VERSION,createdAt:new Date().toISOString(),snapshot};
    const digest=await sha256(JSON.stringify(core));
    return {...core,sha256:digest,summary};
  }
  async function verify(input){
    const raw=typeof input==='string'?input:JSON.stringify(input);
    if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)throw Error('備份檔案超過22MB上限');
    const envelope=readJson(raw,'備份檔');
    if(!isObj(envelope)||envelope.kind!==KIND||envelope.schemaVersion!==VERSION||
       !/^\d{4}-\d{2}-\d{2}T/.test(String(envelope.createdAt||''))||!(/^[0-9a-f]{64}$/.test(String(envelope.sha256||''))))
      throw Error('不是完整的StockZone可還原備份檔，拒絕匯入');
    const core={kind:envelope.kind,schemaVersion:envelope.schemaVersion,createdAt:envelope.createdAt,snapshot:envelope.snapshot};
    const checksum=await sha256(JSON.stringify(core));
    if(checksum!==envelope.sha256)throw Error('SHA-256校驗失敗：備份檔案內容已改變或損毀，未修改現有資料');
    const summary=auditSnapshot(envelope.snapshot);
    return {snapshot:envelope.snapshot,summary,sha256:checksum,createdAt:envelope.createdAt};
  }
  function auditCurrent(storage){return auditSnapshot(readSnapshot(storage));}
  function restore(storage,verified){
    if(!verified?.snapshot||!verified?.sha256||!verified?.summary)throw Error('尚未通過完整檔案校驗');
    auditSnapshot(verified.snapshot);
    const before=readSnapshot(storage);
    // Reject a missing snapshot instead of turning it into an empty database silently.
    try{
      for(const k of KEYS){if(verified.snapshot[k]===null)storage.removeItem(k);else storage.setItem(k,verified.snapshot[k]);}
      auditCurrent(storage);
    }catch(err){
      try{for(const k of KEYS){if(before[k]===null)storage.removeItem(k);else storage.setItem(k,before[k]);}}
      catch{throw Error('復原失敗且回復原資料失敗，請保留原備份檔並停止繼續操作');}
      throw err;
    }
    return verified.summary;
  }
  // Fast local change marker for reminder UI only; SHA-256 inside JSON remains the integrity check.
  function quickSignature(storage){
    const snapshot=readSnapshot(storage);let h=2166136261;
    for(const k of KEYS){
      const value=snapshot[k]||'';
      for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}
      h^=65535;h=Math.imul(h,16777619);
    }
    return (h>>>0).toString(16).padStart(8,'0');
  }
  function markExport(storage,digest,summary){
    try{storage.setItem(BACKUP_STATE_KEY,JSON.stringify({downloadStartedAt:new Date().toISOString(),sha256:digest,
      trades:summary.trades,plans:summary.originalPlans,signature:quickSignature(storage)}));}catch{}
  }
  function status(storage){
    let last=null;try{last=JSON.parse(storage.getItem(BACKUP_STATE_KEY)||'null')}catch{}
    const current=auditCurrent(storage),when=last?.downloadStartedAt?Date.parse(last.downloadStartedAt):NaN;
    const days=Number.isFinite(when)?Math.floor((Date.now()-when)/86400000):null;
    const newTrades=Math.max(0,current.trades-Number(last?.trades||0));
    const unbacked=current.originalPlans>0&&(!last||last.signature!==quickSignature(storage));
    const remind=current.originalPlans>0&&(!last||newTrades>=5||days===null||days>=7);
    return {lastDate:last?.downloadStartedAt||null,days,newTrades,unbacked,remind,...current};
  }
  return {KIND,VERSION,KEYS,BACKUP_STATE_KEY,readSnapshot,auditSnapshot,auditCurrent,build,verify,restore,markExport,status};
});
