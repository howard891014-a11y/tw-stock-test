'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const P=require('../lib/holding-trade-plans');
const B=require('../lib/trade-backup');
function store(source={}){
  return {v:{...source},getItem(k){return this.v[k]??null},setItem(k,x){this.v[k]=String(x)},removeItem(k){delete this.v[k]}};
}
function capture(code,play='swing'){
  return {code,name:'測試股票',play:play==='swing'?'波段':'長期',playKey:play,capturedAt:new Date().toISOString(),
    targets:{main:121,secondary:147,defense:88},allocation:{core:55,tactical:45},risk:{score:22},signal:'僅測試'};
}
(async function run(){
  const s=store(),day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  s.setItem('stockzone_holdings_v2',JSON.stringify([{code:'6187',name:'測試股票',market:'上市',shares:1000,avgCost:100}]));
  s.setItem('stockzone_watchlist_v2',JSON.stringify([{code:'2330',name:'測試觀察'}]));
  const lab={6187:{activeId:'live-test',plans:[{id:'live-test',asOf:day,targets:{main:121}}]}};
  s.setItem('sz_resonance_lab_r1_plans',JSON.stringify(lab));
  const start=P.create(s,'6187',100,1000,capture('6187'));
  const original=JSON.stringify(P.active(s,'6187').initial);
  const tx=(type,shares,price,bucket='tactical')=>P.record(s,'6187',{type,shares,price,tradeDate:day,bucket,fee:12,tax:0});
  tx('trial',100,109);tx('add',200,120,'core');tx('reduce',300,126);
  const before=P.active(s,'6187');const beforeMetrics=P.metrics(before);
  const export1=await B.build(s),file=JSON.stringify(export1,null,2);
  assert.equal(export1.kind,B.KIND);assert.match(export1.sha256,/^[0-9a-f]{64}$/);
  assert.equal(export1.summary.trades,3);assert.equal(export1.summary.originalPlans,1);
  assert.equal(export1.summary.holdings,1);assert.equal(export1.summary.watchlist,1);
  assert.equal(export1.summary.labStocks,1);assert.equal((await B.verify(file)).sha256,export1.sha256);
  assert.equal((await B.verify(file)).summary.trades,3);
  B.markExport(s,export1.sha256,export1.summary);
  assert.equal(B.status(s).unbacked,false);
  assert.equal(B.status(s).newTrades,0);
  const untouched=JSON.stringify(s.v);
  await assert.rejects(()=>B.verify(file.replace('測試股票','污染股票')),/SHA-256校驗失敗/);
  assert.equal(JSON.stringify(s.v),untouched,'SHA mismatch must not write');
  const tampered=JSON.parse(file);tampered.snapshot[B.KEYS[0]]=null;
  await assert.rejects(()=>B.verify(JSON.stringify(tampered)),/SHA-256校驗失敗/);
  const partial=JSON.stringify({kind:'StockZone-manually-recorded-holding-trades',plans:{}});
  await assert.rejects(()=>B.verify(partial),/不是完整/);
  // Take one more trade AFTER the backup: restore must return the original ledger, not merge it.
  tx('add',10,123);
  assert.equal(B.status(s).newTrades,1);
  assert.equal(B.status(s).unbacked,true);
  const verified=await B.verify(file);
  const restored=B.restore(s,verified);
  assert.equal(restored.trades,3);
  assert.equal(P.metrics(P.active(s,'6187')).tradeCount,3);
  assert.deepEqual(P.metrics(P.active(s,'6187')).shares,beforeMetrics.shares);
  assert.equal(JSON.stringify(P.active(s,'6187').initial),original);
  assert.equal(s.getItem('sz_resonance_lab_r1_plans'),JSON.stringify(lab));
  assert.equal(JSON.parse(s.getItem('stockzone_holdings_v2'))[0].shares,1000);
  // Confirm same-date partial sells, fees and locked play through a full exit.
  const remaining=P.metrics(P.active(s,'6187')).shares;
  tx('exit',remaining,140);
  assert.equal(P.active(s,'6187'),null);
  const archived=P.history(s,'6187')[0];
  assert.equal(archived.status,'closed');
  assert.equal(archived.ledger.trades.length,4);
  assert.equal(JSON.stringify(archived.initial),original);
  const closedBackup=await B.build(s),clean=store();
  B.restore(clean,await B.verify(JSON.stringify(closedBackup)));
  assert.equal(P.history(clean,'6187')[0].ledger.trades.length,4);
  assert.equal(P.metrics(P.history(clean,'6187')[0]).shares,0);
  assert.equal(P.metrics(P.history(clean,'6187')[0]).realizedNet,P.metrics(archived).realizedNet);
  // Restore rollback: simulate storage quota failure on the second key; MUST recover all previous keys.
  const failing=store(s.v),raw={...failing.v};let blocked=false;
  const oldSet=failing.setItem.bind(failing);
  failing.setItem=(k,x)=>{if(k==='stockzone_holdings_v2'&&!blocked){blocked=true;throw Error('QuotaExceededError')}oldSet(k,x)};
  assert.throws(()=>B.restore(failing,verified),/QuotaExceededError/);
  assert.deepEqual(failing.v,raw,'failed restore cannot partially overwrite any key');
  const malformed=store(s.v),data=JSON.parse(malformed.getItem(P.KEY));
  data['6187'].archived[0].ledger.trades[0].shares=1e30;
  malformed.setItem(P.KEY,JSON.stringify(data));
  assert.throws(()=>B.auditCurrent(malformed),/非法資料|安全|交易流水/);
  // Empty account must still support new backup/restore (no invented holdings).
  const empty=store(),emptyFile=await B.build(empty),emptyBack=store();
  assert.equal(emptyFile.summary.trades,0);
  B.restore(emptyBack,await B.verify(JSON.stringify(emptyFile)));
  assert.equal(P.active(emptyBack,'6187'),null);
  // Integration checks
  const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8'),module=fs.readFileSync('lib/trade-backup.js','utf8');
  for(const token of ['szTradeRecoveryStatus','szTradeExportBackup','szTradeImportBackup','szSimJsonImportFile','szTradeDownloadJson',
    'StockZoneTradeBackup','window.location.reload()','api.restore(localStorage,verified)','szTradeRecoveryStatus();'])assert(app.includes(token),token);
  for(const token of ['lib/trade-backup.js?v=2.6.9.19','app.js?v=2.6.9.20','id="szSimJsonImport"','id="szSimJsonImportFile"',
    'id="szSimBackupStatus"','id="szHoldingBackupStatus"','id="szHoldingBackupBtn"','v2.6.9.20'])assert(html.includes(token),token);
  assert(html.indexOf('lib/trade-backup.js?v=2.6.9.19')<html.indexOf('app.js?v=2.6.9.20'));
  for(const forbidden of ['fetch(','getSql(','@neondatabase/serverless','supabase','@vercel/blob'])assert(!module.includes(forbidden),'client backup must not use network '+forbidden);
  const packageJson=require('../package.json');assert.equal(packageJson.version,'2.6.9.20');
  console.log('PASS v2.6.9.19 backup: sha256 export/import, after-backup change, overwrite prevention UI, tamper, incomplete JSON, rollback on quota error, old original play, closed history, holdings/watchlist/analysis snapshot roundtrip');
})().catch(e=>{console.error(e);process.exitCode=1});
