const {refreshMarketSnapshot} = require('../lib/market-dynamic');
const {isCronAuthorized} = require('../lib/sync-common');
const CRON_TIMES=new Set(['50 14 * * 1-5','35 15 * * 1-5']);
module.exports=async function handler(req,res){
  const schedule=String(req.headers?.['x-vercel-cron-schedule']||'');
  if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
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
