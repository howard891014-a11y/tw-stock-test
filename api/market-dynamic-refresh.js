const {refreshMarketSnapshot} = require('../lib/market-dynamic');
const {isCronAuthorized} = require('../lib/sync-common');
// All schedules UTC: 22:00 formal W3, 23:35 conditional recovery (Taipei).
const CRON_TIMES=new Set(['0 14 * * 1-5','35 15 * * 1-5']);
const {getSql}=require('../lib/db');
const {readMarketDateGate}=require('../lib/market-dynamic-date-gate');
const schedulePlan=require('../lib/market-daily-schedule');
const {taipeiDateParts}=require('../lib/sync-common');
module.exports=async function handler(req,res){
  const schedule=String(req.headers?.['x-vercel-cron-schedule']||'');
  if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
  // Paper stage3 is an explicitly gated research-only branch. It never writes
  // Neon, places orders, or changes this endpoint's existing W3 cron behavior.
  if(String(req.query?.paper||'')==='stage3'){
    const stage=require('../lib/stockzone-d-paper-cron');
    res.setHeader('Cache-Control','no-store');
    if(!stage.enabled())return res.status(200).json({ok:true,status:'D_PAPER_DISABLED',neonWrites:0,realOrders:0});
    if(!stage.strictCronAccess(req))return res.status(401).json({ok:false,error:'Restricted cron only'});
    try{
      const out=await stage.runDailyCycle();
      return res.status(200).json(out);
    }catch(e){
      console.error('D paper cron failed (no simulated backfill)',e?.message||e);
      return res.status(503).json({ok:false,error:'PAPER_STAGE3_PAUSED',neonWrites:0,realOrders:0});
    }
  }
  if(!isCronAuthorized(req)||!CRON_TIMES.has(schedule)||!String(req.headers?.['user-agent']||'').includes('vercel-cron/1.0'))return res.status(401).json({ok:false,error:'Cron only'});
  try{
    const sql=getSql(),today=taipeiDateParts().date;
    const status=await schedulePlan.marketScheduleGate(sql,today);
    // The 17:00 holiday cutoff stops ALL 21:00/22:00/23:35 stages.
    if(status.state==='closed')return res.status(200).json({ok:true,skipped:true,
      reason:'three-price-probes-no-trading',today,noExternalRequests:true});
    if(!status.gate.ok||status.gate.sourceDate!==today){
      // An incomplete single-market feed is NOT a holiday. Only at 23:35
      // attempt the targeted missing-market repair; never rebuild full history.
      if(schedule==='35 15 * * 1-5' && Object.values(status.gate.latestByMarket||{}).includes(today)){
        try{await require('../lib/sync-service').runLatestMarketGapRepair({sql})}
        catch(e){console.warn('23:35 single-market repair unavailable',String(e?.message||e))}
      }
    }
    // 23:35 must not repeat W3 after the 22:00 verified same-day snapshot.
    if(schedule==='35 15 * * 1-5'){
      const saved=await sql.query(`SELECT payload->'w3'->>'sourceDate' AS d,
        payload->'w3'->>'isLiveModel' AS valid,
        payload->'latest'->>'date' AS price_date FROM market_dynamic_snapshot WHERE id=1`)
        .catch(()=>[]);
      if(saved?.[0]?.d===today&&saved[0].price_date===today&&saved[0].valid==='true')
        return res.status(200).json({ok:true,skipped:true,reason:'w3-already-verified-at-2200',today});
    }
    // Never publish a partly updated day: both exchanges must match TODAY,
    // not merely match each other on the previous valid trading date.
    const gate=await readMarketDateGate(sql);
    if(!gate.ok||gate.sourceDate!==today){
      if(!Object.values(gate.latestByMarket||{}).includes(today))
        return res.status(200).json({ok:true,skipped:true,reason:'today-close-unavailable',
          latestByMarket:gate.latestByMarket,noExternalRequests:true,today});
      // Official CASH data is a separate 250D archive: collect it even when
      // daily stock prices/W3 source coverage are temporarily misaligned.
      let independentArchive=null;
      try{
        const archive=require('../lib/official-institutional-archive');
        independentArchive=await archive.saveOnGateFailure(archive.todayTaipei());
      }catch(e){console.warn('Independent official 250D archive failed',String(e?.message||e))}
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({ok:true,skipped:true,code:'MARKET_SOURCE_NOT_ALIGNED',reason:gate.reason||(gate.sourceDate!==today?'no-today-prices':'unknown'),
        latestByMarket:gate.latestByMarket,countsByMarket:gate.countsByMarket,
        officialArchive:independentArchive?.ok?{ok:true,stored:independentArchive.recorded}:null,
        preservedLastGood:true,refreshedAt:new Date().toISOString()});
    }
    // 23:35: recover only still-missing official chip sources before recomputing.
    let chipRepair=null;
    if(schedule==='35 15 * * 1-5'){
      const r=await sql.query(`SELECT kind,market,MAX(trade_date)::text AS latest,COUNT(*) FILTER(WHERE trade_date=$1::date)::int AS today_rows
        FROM (
          SELECT 'institutional' AS kind,market,trade_date FROM institutional_trading_daily
          UNION ALL
          SELECT 'credit' AS kind,market,trade_date FROM credit_trading_daily
        ) x WHERE market IN ('上市','上櫃') GROUP BY kind,market`,[today]);
      const missing=type=>['上市','上櫃'].some(m=>{
        const row=r.find(x=>x.kind===type&&x.market===m);
        return !row||row.latest!==today||Number(row.today_rows)<(m==='上市'?500:300);
      });
      chipRepair={institutional:'already-present',credit:'already-present'};
      if(missing('institutional')){
        try{chipRepair.institutional=(await require('../lib/institutional-history').runInstitutionalSync()).body}
        catch(e){chipRepair.institutional={ok:false,error:String(e?.message||e)}}
      }
      if(missing('credit')){
        try{chipRepair.credit=(await require('../lib/credit-trading').runCreditTradingSync()).body}
        catch(e){chipRepair.credit={ok:false,error:String(e?.message||e)}}
      }
    }
    const data=await refreshMarketSnapshot();
    const verified=!!data?.w3?.isLiveModel && data?.w3?.sourceDate===today && data?.latest?.date===today;
    res.setHeader('Cache-Control','no-store');
    return res.status(verified?200:202).json({ok:true,latestDate:data?.latest?.date,w3SourceDate:data?.w3?.sourceDate,
      w3Valid:verified,w3Pending:!verified,w3Error:data?.w3?.error||null,chipRepair,
      sourceAligned:true,latestByMarket:gate.latestByMarket,refreshedAt:new Date().toISOString()});
  }catch(e){
    console.error('scheduled W3-D.1.2 market snapshot update failed',e);
    // Keep the official cash collector independent even if W3 snapshot throws.
    try{const a=require('../lib/official-institutional-archive');await a.saveOnGateFailure(a.todayTaipei())}
    catch(x){console.warn('Independent official archive failure retry failed',String(x?.message||x))}
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};

// v2.7.0.40: shared server-side access guard; pre-existing handler is unchanged.
module.exports=require('../lib/access-server').protectApi(module.exports);
