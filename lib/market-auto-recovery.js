'use strict';
// StockZone v2.7.1.0 — close missing official sessions, without rewriting
// previously verified W3 decisions, revising stock corporate actions or
// treating a missing session as a holiday. Cron-only orchestration.
const {getSql}=require('./db');
const {refreshMarketActivityFactorsForDate}=require('./sync-common');
const PRICE_MIN=Object.freeze({'上市':500,'上櫃':300});
const INST_MIN=Object.freeze({'上市':500,'上櫃':350});
const CREDIT_MIN=Object.freeze({'上市':500,'上櫃':350});
const MARKETS=['上市','上櫃'];
const textDate=d=>String(d||'').slice(0,10);

function missingPerSession(dates,counts,thresholds){
  return dates.flatMap(date=>MARKETS.filter(market=>(counts[`${date}|${market}`]||0)<thresholds[market])
    .map(market=>({date,market}))); // oldest first; do not infer a missing source value
}
async function verifiedSessions(sql=getSql(),limit=7){
  const rows=await sql.query(`SELECT trade_date::text AS d FROM market_index_eod_daily
    WHERE poll_stage=1 AND trade_date<=CURRENT_DATE+INTERVAL '1 day'
    ORDER BY trade_date DESC LIMIT $1`,[Math.min(12,Math.max(2,limit))]);
  return rows.map(r=>textDate(r.d)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).reverse();
}
async function marketCounts(sql,table,dates,kind){
  if(!dates.length)return {};
  let extra='';
  if(kind==='credit')extra=`,COUNT(*) FILTER(WHERE margin_source IS NOT NULL)::int AS margin_rows,
    COUNT(*) FILTER(WHERE sbl_source IS NOT NULL)::int AS sbl_rows`;
  const rows=await sql.query(`SELECT trade_date::text AS d,market,COUNT(*)::int AS n ${extra}
      FROM ${table} WHERE trade_date=ANY($1::date[]) AND market IN ('上市','上櫃')
      GROUP BY trade_date,market`,[dates]);
  const out={};for(const r of rows)out[`${r.d}|${r.market}`]=kind==='credit'
    ?Math.min(Number(r.n)||0,Number(r.margin_rows)||0,Number(r.sbl_rows)||0)
    :Number(r.n)||0;
  return out;
}
async function record(sql,stage,date,result){
  const key=`market_recovery_${stage}_${date}`;
  const json=JSON.stringify({date,stage,...result}).slice(0,750);
  await sql.query(`INSERT INTO sync_status(source,last_attempt_at,status,row_count,error_message,updated_at)
    VALUES($1,NOW(),$2,0,$3,NOW()) ON CONFLICT(source) DO UPDATE SET
    last_attempt_at=NOW(),status=EXCLUDED.status,error_message=EXCLUDED.error_message,updated_at=NOW()`,
  [key,result.ok?'success':'error',json]);
}
async function inspectPriceGaps({sql=getSql(),limit=7}={}){
  const dates=await verifiedSessions(sql,limit);
  const counts=await marketCounts(sql,'market_daily_history',dates,'price');
  return {dates,missing:missingPerSession(dates,counts,PRICE_MIN)};
}
async function recoverPriceGaps({sql=getSql(),maxDates=1}={}){
  const dates=await verifiedSessions(sql);
  const counts=await marketCounts(sql,'market_daily_history',dates,'price');
  const missing=missingPerSession(dates,counts,PRICE_MIN);
  if(!missing.length)return {ok:true,skipped:true,reason:'verified-price-sessions-complete',checkedDates:dates};
  const targetDates=[...new Set(missing.map(x=>x.date))].slice(0,Math.max(1,maxDates));
  const restored=[];
  for(const date of targetDates){
    const markets=missing.filter(x=>x.date===date).map(x=>x.market);
    const detail=await require('./sync-service').repairHistoricalMarketDate({tradeDate:date,markets,sql});
    restored.push(detail);
    if(detail.ok){
      // Repair the missing session AND the latest already-published session:
      // otherwise 5/20-day market activity retains a silently skipped day.
      try{
        const tail=dates.filter(x=>x>=date).slice(0,3);
        for(const d of tail)await refreshMarketActivityFactorsForDate(d);
        detail.activityDates=tail;
      }catch(e){detail.ok=false;detail.activityError=String(e?.message||e)}
    }
    await record(sql,'price',date,detail);
  }
  const checked=await marketCounts(sql,'market_daily_history',dates,'price');
  const remaining=missingPerSession(dates,checked,PRICE_MIN);
  return {ok:remaining.length===0&&restored.every(x=>x.ok),repaired:restored,remaining,
    checkedDates:dates,preservedLastGood:true};
}
async function recoverChipGaps({sql=getSql(),maxDates=2}={}){
  const dates=(await verifiedSessions(sql)).slice(-4);
  const pCounts=await marketCounts(sql,'market_daily_history',dates,'price');
  // Do NOT trust chip reports for a session whose price source is missing.
  const eligible=dates.filter(date=>MARKETS.every(m=>(pCounts[`${date}|${m}`]||0)>=PRICE_MIN[m]));
  if(!eligible.length)return {ok:false,skipped:true,reason:'no-price-complete-session'};
  const iCounts=await marketCounts(sql,'institutional_trading_daily',eligible,'institutional');
  const cCounts=await marketCounts(sql,'credit_trading_daily',eligible,'credit');
  const iMissing=missingPerSession(eligible,iCounts,INST_MIN),cMissing=missingPerSession(eligible,cCounts,CREDIT_MIN);
  const datesToFix=[...new Set([...iMissing,...cMissing].map(x=>x.date))].sort().slice(0,Math.max(1,maxDates));
  if(!datesToFix.length)return {ok:true,skipped:true,reason:'verified-chip-sessions-complete',checkedDates:eligible};
  const inst=require('./institutional-history'),credit=require('./credit-trading');
  const repaired=[];
  for(const date of datesToFix){
    const tasks=[...iMissing.filter(x=>x.date===date).map(x=>({...x,kind:'institutional'})),
      ...cMissing.filter(x=>x.date===date).map(x=>({...x,kind:'credit'}))];
    const outcomes=await Promise.all(tasks.map(async t=>{
      try{
        const mod=t.kind==='institutional'?inst:credit;
        const fetchDay=t.kind==='institutional'
          ?(t.market==='上市'?inst.fetchTwseInstitutionalDay:inst.fetchTpexInstitutionalDay)
          :(t.market==='上市'?credit.fetchTwseCreditDay:credit.fetchTpexCreditDay);
        const rows=await fetchDay(date);
        const min=t.kind==='institutional'?INST_MIN[t.market]:CREDIT_MIN[t.market];
        if(!Array.isArray(rows)||rows.length<min||rows.some(r=>textDate(r.trade_date)!==date))
          throw new Error('Official report missing, sparse or trade date mismatch');
        if(t.kind==='credit'&&(!rows.some(r=>r.margin_source)||!rows.some(r=>r.sbl_source)))
          throw new Error('Official credit margin or SBL report missing');
        const inserted=await (t.kind==='institutional'?inst.upsertInstitutionalRows:credit.upsertCreditTradingRows)(rows);
        return {kind:t.kind,market:t.market,ok:true,rows:inserted};
      }catch(e){return {kind:t.kind,market:t.market,ok:false,error:String(e?.message||e)}}
    }));
    const detail={date,ok:outcomes.every(x=>x.ok),outcomes};
    await record(sql,'chips',date,detail);repaired.push(detail);
  }
  return {ok:repaired.every(x=>x.ok),repaired,preservedLastGood:true};
}
module.exports={verifiedSessions,missingPerSession,inspectPriceGaps,recoverPriceGaps,recoverChipGaps,
  _test:{marketCounts,PRICE_MIN,INST_MIN,CREDIT_MIN}};
