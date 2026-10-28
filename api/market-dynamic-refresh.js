const {refreshMarketSnapshot} = require('../lib/market-dynamic');
const {isCronAuthorized} = require('../lib/sync-common');
// All schedules are UTC; Taiwan close-day refreshes start at 19:20 and 20:40.
// The original 22:50/23:35 cron slots remain late-feed retries.
const CRON_TIMES=new Set(['20 11 * * 1-5','40 12 * * 1-5','50 14 * * 1-5','35 15 * * 1-5']);
const {getSql}=require('../lib/db');
const {readMarketDateGate}=require('../lib/market-dynamic-date-gate');
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
    // Never publish a partly updated day: TWSE and TPEx must match on the
    // last trading day, and each must contain a meaningful stock universe.
    const gate=await readMarketDateGate(getSql());
    if(!gate.ok){
      // Official CASH data is a separate 250D archive: collect it even when
      // daily stock prices/W3 source coverage are temporarily misaligned.
      let independentArchive=null;
      try{
        const archive=require('../lib/official-institutional-archive');
        independentArchive=await archive.saveOnGateFailure(archive.todayTaipei());
      }catch(e){console.warn('Independent official 250D archive failed',String(e?.message||e))}
      res.setHeader('Cache-Control','no-store');
      return res.status(503).json({ok:false,code:'MARKET_SOURCE_NOT_ALIGNED',reason:gate.reason,
        latestByMarket:gate.latestByMarket,countsByMarket:gate.countsByMarket,
        officialArchive:independentArchive?.ok?{ok:true,stored:independentArchive.recorded}:null,
        preservedLastGood:true,refreshedAt:new Date().toISOString()});
    }
    const data=await refreshMarketSnapshot();
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({ok:true,latestDate:data?.latest?.date,w3SourceDate:data?.w3?.sourceDate,
      w3Valid:!!data?.w3?.isLiveModel,w3Error:data?.w3?.error||null,sourceAligned:true,latestByMarket:gate.latestByMarket,refreshedAt:new Date().toISOString()});
  }catch(e){
    console.error('scheduled W3-D.1.2 market snapshot update failed',e);
    // Keep the official cash collector independent even if W3 snapshot throws.
    try{const a=require('../lib/official-institutional-archive');await a.saveOnGateFailure(a.todayTaipei())}
    catch(x){console.warn('Independent official archive failure retry failed',String(x?.message||x))}
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};
