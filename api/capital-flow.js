'use strict';
const {getSummary,getDetail,searchStockSectors}=require('../lib/capital-flow');
const {isCronAuthorized}=require('../lib/sync-common');
const {CRON_STAGES,runScheduledFundflow}=require('../lib/market-fundflow-schedule');
module.exports=async (req,res)=>{
  if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'僅支援查詢'});
  try{
    // Reuse this existing API function for the daily refresh. We cannot add a
    // thirteenth api/*.js function on Vercel Hobby.
    const schedule=String(req.headers?.['x-vercel-cron-schedule']||'');
    if(schedule&&String(req.query?.view||'')==='featured'&&String(req.query?.action||'')==='archive'){
      if(schedule!=='50 15 * * 1-5'||!isCronAuthorized(req)||
         !String(req.headers?.['user-agent']||'').includes('vercel-cron/1.0'))
        return res.status(401).json({ok:false,error:'Cron only'});
      const result=await require('../lib/featured-research-history').runDailyArchive({sql:require('../lib/db').getSql()});
      res.setHeader('Cache-Control','no-store');
      return res.status(result.ok?200:503).json(result);
    }
    if(schedule){
      if(!CRON_STAGES[schedule] || !isCronAuthorized(req) ||
         !String(req.headers?.['user-agent']||'').includes('vercel-cron/1.0'))
        return res.status(401).json({ok:false,error:'Cron only'});
      const result=await runScheduledFundflow({schedule,sql:require('../lib/db').getSql()});
      res.setHeader('Cache-Control','no-store');
      return res.status(result.ok?200:503).json(result);
    }
    const view=String(req.query?.view||'summary');
    if(!['summary','detail','featured','featured-history','search'].includes(view))return res.status(400).json({ok:false,error:'未知查詢'});
    const data=view==='featured-history'?await require('../lib/featured-research-history').getHistory():
      view==='featured'?await require('../lib/featured-neon-daily').getFeaturedDaily():
      view==='search'?await searchStockSectors(String(req.query?.q||'')):
      view==='detail'?await getDetail(String(req.query?.tagId||'')):await getSummary();
    res.setHeader('Cache-Control',['featured','featured-history'].includes(view)?'no-store':'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(data);
  }catch(e){res.setHeader('Cache-Control','no-store');return res.status(e.statusCode||500).json({ok:false,error:String(e.message||e)});}
};

// v2.7.0.40: shared server-side access guard; pre-existing handler is unchanged.
module.exports=require('../lib/access-server').protectApi(module.exports);
