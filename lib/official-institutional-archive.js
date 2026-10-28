'use strict';
/**
 * StockZone v2.6.9.9 - private, bounded official three-institution CASH archive.
 * NO joins, writes or reads to W3 / stock-level institutional / market dynamics.
 * Source values come exclusively from market-institutional-official's validated
 * TWSE BFI82U and TPEx official summary parsers.
 */
const {getSql}=require('./db');
const RETENTION_TRADING_DAYS=250;
const SOURCE={ '上市':'TWSE BFI82U','上櫃':'TPEx government open data 11743' };
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const validAmount=v=>typeof v==='number'&&Number.isSafeInteger(v);

function validated(row,date,market){
  return !!row&&row.date===date&&row.market===market&&
    ['foreign','trust','dealer','total'].every(k=>validAmount(row[k]))&&
    row.foreign+row.trust+row.dealer===row.total;
}
async function ensureArchive(sql){
  await sql.query(`CREATE TABLE IF NOT EXISTS official_institutional_cash_daily (
    trade_date date NOT NULL,
    market text NOT NULL CHECK(market IN ('上市','上櫃')),
    foreign_net numeric(22,0),
    trust_net numeric(22,0),
    dealer_net numeric(22,0),
    total_net numeric(22,0),
    source text NOT NULL,
    source_date date,
    is_complete boolean NOT NULL DEFAULT false,
    last_error text,
    checked_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    PRIMARY KEY(trade_date,market),
    CONSTRAINT official_cash_complete_values CHECK(
      NOT is_complete OR (foreign_net IS NOT NULL AND trust_net IS NOT NULL
       AND dealer_net IS NOT NULL AND total_net=foreign_net+trust_net+dealer_net
       AND source_date=trade_date))
  )`);
}
/** Reuse verified, already-fetched daily reports. No additional TWSE/TPEx calls. */
function collectRows(history,attempts=[]){
  const rows=new Map();
  const add=(date,market,result,error=null)=>{
    if(!ISO.test(date)||!(market in SOURCE))return;
    const good=validated(result,date,market);
    const key=date+'|'+market;
    if(rows.get(key)?.complete&&!good)return; // Never replace verified data with a failed poll.
    rows.set(key,{date,market,complete:good,source:SOURCE[market],
      foreign:good?result.foreign:null,trust:good?result.trust:null,
      dealer:good?result.dealer:null,total:good?result.total:null,
      error:good?null:String(error||'OFFICIAL_NOT_READY').slice(0,160)});
  };
  for(const h of history||[]){
    const date=String(h?.date||''),combined=h?.officialInstitutional;
    if(!ISO.test(date)||!combined?.complete||combined.date!==date)continue;
    for(const [market,section] of [['上市',combined.listed],['上櫃',combined.otc]]){
      if(validated(section,date,market))add(date,market,section);
    }
  }
  for(const a of attempts){
    if(!a||!ISO.test(a.date))continue;
    add(a.date,a.market,a.result,a.error);
  }
  return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.market.localeCompare(b.market,'zh-TW'));
}
async function saveOfficialArchive({history,attempts=[]},sql=getSql()){
  const candidateRows=collectRows(history,attempts);
  if(!candidateRows.length)return {ok:false,code:'NO_REPORTS',stored:0};
  await ensureArchive(sql);
  // Most 20D cards came from a verified prior snapshot, not fresh HTTP requests.
  // Do not overwrite their checked_at / verified_at every refresh and do not
  // churn 40 rows on each cron retry. Store new/improved rows and live successes.
  const candidatesDates=[...new Set(candidateRows.map(r=>r.date))];
  const existing=await sql.query(`SELECT trade_date::text AS date,market,is_complete
    FROM official_institutional_cash_daily WHERE trade_date=ANY($1::date[])`,[candidatesDates]);
  const known=new Map(existing.map(r=>[r.date+'|'+r.market,r.is_complete]));
  const liveSucceeded=new Set(attempts.filter(a=>validated(a?.result,a.date,a.market))
    .map(a=>a.date+'|'+a.market));
  const rows=candidateRows.filter(r=>{
    const k=r.date+'|'+r.market;
    return !known.has(k) || (r.complete&&!known.get(k)) || liveSucceeded.has(k);
  });
  if(!rows.length)return {ok:true,recorded:0,completeAttempted:0,
    unchanged:candidateRows.length,retentionTradingDays:RETENTION_TRADING_DAYS};
  const date=rows.map(r=>r.date),market=rows.map(r=>r.market),source=rows.map(r=>r.source);
  const foreign=rows.map(r=>r.foreign),trust=rows.map(r=>r.trust),dealer=rows.map(r=>r.dealer),total=rows.map(r=>r.total);
  const complete=rows.map(r=>r.complete),errors=rows.map(r=>r.error);
  await sql.query(`INSERT INTO official_institutional_cash_daily AS old
    (trade_date,market,foreign_net,trust_net,dealer_net,total_net,source,source_date,is_complete,last_error,checked_at,verified_at)
    SELECT t.trade_date,t.market,t.foreign_net,t.trust_net,t.dealer_net,t.total_net,
      t.source,CASE WHEN t.is_complete THEN t.trade_date ELSE NULL END,t.is_complete,t.last_error,
      now(),CASE WHEN t.is_complete THEN now() ELSE NULL END
    FROM unnest($1::date[],$2::text[],$3::numeric[],$4::numeric[],$5::numeric[],
      $6::numeric[],$7::text[],$8::boolean[],$9::text[])
      AS t(trade_date,market,foreign_net,trust_net,dealer_net,total_net,source,is_complete,last_error)
    ON CONFLICT(trade_date,market) DO UPDATE SET
      foreign_net=CASE WHEN EXCLUDED.is_complete THEN EXCLUDED.foreign_net ELSE old.foreign_net END,
      trust_net=CASE WHEN EXCLUDED.is_complete THEN EXCLUDED.trust_net ELSE old.trust_net END,
      dealer_net=CASE WHEN EXCLUDED.is_complete THEN EXCLUDED.dealer_net ELSE old.dealer_net END,
      total_net=CASE WHEN EXCLUDED.is_complete THEN EXCLUDED.total_net ELSE old.total_net END,
      source=CASE WHEN EXCLUDED.is_complete THEN EXCLUDED.source ELSE old.source END,
      source_date=CASE WHEN EXCLUDED.is_complete THEN EXCLUDED.source_date ELSE old.source_date END,
      is_complete=old.is_complete OR EXCLUDED.is_complete,
      last_error=CASE WHEN old.is_complete OR EXCLUDED.is_complete THEN NULL ELSE EXCLUDED.last_error END,
      checked_at=now(),
      verified_at=CASE WHEN EXCLUDED.is_complete THEN now() ELSE old.verified_at END`,
    [date,market,foreign,trust,dealer,total,source,complete,errors]);
  // Keep the latest 250 observed trading dates (not calendar days).
  // This removes rows ONLY in this dedicated archive table, never W3 or market histories.
  await sql.query(`DELETE FROM official_institutional_cash_daily
    WHERE trade_date NOT IN (
      SELECT trade_date FROM official_institutional_cash_daily
      GROUP BY trade_date ORDER BY trade_date DESC LIMIT ${RETENTION_TRADING_DAYS})`);
  const check=await sql.query(`SELECT count(DISTINCT trade_date)::int AS days,
    count(*)::int AS rows,count(*) FILTER(WHERE is_complete)::int AS verified_rows,
    min(trade_date)::text AS oldest,max(trade_date)::text AS newest,
    (SELECT COUNT(*)::int FROM (
      SELECT trade_date FROM official_institutional_cash_daily
      GROUP BY trade_date HAVING COUNT(*)=2 AND BOOL_AND(is_complete)
    ) d) AS paired_complete_days,
    pg_total_relation_size('official_institutional_cash_daily')::bigint AS bytes
    FROM official_institutional_cash_daily`);
  return {ok:true,recorded:rows.length,completeAttempted:rows.filter(r=>r.complete).length,
    ...(check[0]||{}),retentionTradingDays:RETENTION_TRADING_DAYS};
}
/**
 * Standalone fallback for days when StockZone stock-data/W3 date gate is late.
 * Avoids coupling official cash accumulation to W3 readiness.
 * No extra requests on the ordinary, successful market-refresh path.
 */
async function saveOnGateFailure(date,{fetchFn,sql=getSql()}={}){
  if(!ISO.test(date))return {ok:false,code:'INVALID_DATE'};
  const {fetchMarket}=require('./market-institutional-official');
  const attempts=await Promise.all(['上市','上櫃'].map(async market=>{
    try{
      const result=await fetchMarket(date,market,{fetchFn});
      return {date,market,result,error:result?null:'OFFICIAL_NOT_READY'};
    }catch(e){return {date,market,result:null,error:String(e?.message||e)};}
  }));
  // Do not invent a holiday trading day if both markets have no official report.
  if(!attempts.some(x=>validated(x.result,date,x.market)))return {ok:false,code:'BOTH_MARKETS_UNAVAILABLE'};
  return saveOfficialArchive({history:[],attempts},sql);
}
function todayTaipei(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
module.exports={saveOfficialArchive,saveOnGateFailure,todayTaipei,ensureArchive,collectRows,validated,RETENTION_TRADING_DAYS};
