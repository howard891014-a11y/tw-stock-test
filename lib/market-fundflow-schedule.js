'use strict';
// v2.7.0.2 — Independent, idempotent XY and money jobs.
// Vercel Hobby can invoke each job at any point WITHIN its UTC hour; the labels
// below are requested START times, NOT a wall-clock completion guarantee.
// Keep these on an existing API route, within the 12-function Hobby layout.
const CRON_STAGES=Object.freeze({
  '15 13 * * 1-5':'xy',     // 21:15 TW
  '30 13 * * 1-5':'xy',     // 21:30 TW XY retry
  '35 13 * * 1-5':'money',  // 21:35 TW
  '50 13 * * 1-5':'xy',     // 21:50 TW XY retry after 21:45 gap
  '55 13 * * 1-5':'money',  // 21:55 TW money retry
  '20 14 * * 1-5':'xy',     // 22:20 TW late-source fallback
  '45 14 * * 1-5':'money'   // 22:45 TW late-source fallback
});
const SOURCE=Object.freeze({xy:'market_schedule_fundflow_xy',money:'market_schedule_capital_money'});
const VERSION='v2.7.0.2-fundflow-scheduler';
const dateKey=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const asDay=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
async function persistResult(sql,stage,date,result){
 const note=JSON.stringify({date,stage,scheduleVersion:VERSION,ok:!!result.ok,skipped:!!result.skipped,
    reason:result.reason||null,asOf:result.asOf||null,changedRows:result.changedRows??null,
    error:result.error||null}).slice(0,750);
 await sql.query(`INSERT INTO sync_status(source,last_attempt_at,status,row_count,error_message,updated_at)
   VALUES($1,NOW(),$2,$3,$4,NOW()) ON CONFLICT(source) DO UPDATE SET
   last_attempt_at=NOW(),status=EXCLUDED.status,row_count=EXCLUDED.row_count,
   error_message=EXCLUDED.error_message,updated_at=NOW()`,
   [SOURCE[stage],result.ok?'success':result.skipped?'pending':'error',Number(result.changedRows||0),note]);
}
async function runScheduledFundflow({schedule,sql,now=new Date(),marketGate,buildXY,refreshMoney}={}){
 const stage=CRON_STAGES[schedule];if(!stage)throw new Error('unregistered cron schedule');
 if(!sql)throw new Error('missing Neon SQL connection');
 const today=dateKey(now);
 let result;
 try{
   const gate=marketGate?await marketGate(sql,today):await require('./market-daily-schedule').marketScheduleGate(sql,today);
   if(gate?.state==='closed'||gate?.gate?.sourceDate!==today){
      result={ok:gate?.state==='closed',skipped:true,reason:gate?.state==='closed'?'closed-market':'latest-price-not-ready',asOf:gate?.gate?.sourceDate||null};
   }else if(stage==='xy'){
      const warm=buildXY||require('./fundflow-xy').warmCurrentEngineFromStoredDb;
      const value=await warm({sql,force:false});
      const date=asDay(value?.after?.asOf||value?.before?.asOf);
      result={ok:Boolean(value?.ok&&date===today),asOf:date||null,skipped:Boolean(value?.skipped),
        reason:value?.reason||(date!==today?'xy-not-current':null),error:value?.error||null,
        mode:value?.mode||null,topicRows:value?.result?.topicRows||null};
   }else{
      // Never publish money against a missing/stale operational XY day.
      const [topic]=await sql.query(`SELECT MAX(trade_date)::text AS date FROM market_business_xy2_topic_daily`);
      const [prepared]=await sql.query(`SELECT COUNT(*)::int AS rows FROM market_business_xy2_snapshot WHERE snapshot_kind IN ('overview','browser') AND as_of=$1::date`,[today]);
      if(asDay(topic?.date)!==today || Number(prepared?.rows||0)<6){
        result={ok:false,reason:'xy-2026-daily-snapshot-not-ready',asOf:asDay(topic?.date)};
      }else{
        const {VERSION:methodVersion,refreshMoney:refresh}=require('./capital-flow-money');
        const [saved]=await sql.query(`SELECT COUNT(*)::int AS rows FROM market_capital_flow_money_daily WHERE trade_date=$1::date AND method_version=$2`,[today,methodVersion]).catch(e=>{
          if(e.code==='42P01'||/does not exist/i.test(String(e.message||'')))return [{rows:0}];
          throw e;
        });
        if(Number(saved?.rows||0)>=180)result={ok:true,skipped:true,reason:'money-already-current',asOf:today};
        else{
          const money=await (refreshMoney||refresh)(today,sql);
          result={...money,asOf:today};
        }
      }
   }
 }catch(e){result={ok:false,error:String(e?.message||e).slice(0,250),reason:'job-exception'};}
 try{await persistResult(sql,stage,today,result)}catch(e){result.statusLogError=String(e?.message||e).slice(0,120)}
 return {job:`fundflow-${stage}`,schedule,today,...result};
}
module.exports={CRON_STAGES,SOURCE,VERSION,dateKey,runScheduledFundflow};
