const {refreshMarketSnapshot} = require('../lib/market-dynamic');
const {isCronAuthorized} = require('../lib/sync-common');
const CRON_TIMES=new Set(['50 14 * * 1-5','35 15 * * 1-5']);
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
    const data=await refreshMarketSnapshot();
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({ok:true,latestDate:data?.latest?.date,w3SourceDate:data?.w3?.sourceDate,
      w3Valid:!!data?.w3?.isLiveModel,w3Error:data?.w3?.error||null,refreshedAt:new Date().toISOString()});
  }catch(e){
    console.error('scheduled W3-D.1.2 market snapshot update failed',e);
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};
