'use strict';
const {getSummary,getDetail,searchStockSectors}=require('../lib/capital-flow');
const {isCronAuthorized}=require('../lib/sync-common');
const CAPITAL_CRON_SCHEDULE='8 8 * * 1-5';
module.exports=async (req,res)=>{
  if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'僅支援查詢'});
  try{
    // Reuse this existing API function for the daily refresh. We cannot add a
    // thirteenth api/*.js function on Vercel Hobby.
    const schedule=String(req.headers?.['x-vercel-cron-schedule']||'');
    if(schedule){
      if(schedule!==CAPITAL_CRON_SCHEDULE || !isCronAuthorized(req) ||
         !String(req.headers?.['user-agent']||'').includes('vercel-cron/1.0'))
        return res.status(401).json({ok:false,error:'Cron only'});
      const sql=require('../lib/db').getSql();
      const [latest]=await sql.query('SELECT MAX(trade_date) AS latest FROM market_business_xy2_topic_daily');
      const value=latest?.latest;
      const asOf=value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
      const result=await require('../lib/capital-flow-money').refreshMoney(asOf,sql);
      res.setHeader('Cache-Control','no-store');
      return res.status(result.ok?200:503).json(result);
    }
    const view=String(req.query?.view||'summary');
    if(!['summary','detail','featured','search'].includes(view))return res.status(400).json({ok:false,error:'未知查詢'});
    const data=view==='featured'?await require('../lib/featured-neon-daily').getFeaturedDaily():
      view==='search'?await searchStockSectors(String(req.query?.q||'')):
      view==='detail'?await getDetail(String(req.query?.tagId||'')):await getSummary();
    res.setHeader('Cache-Control',view==='featured'?'no-store':'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(data);
  }catch(e){res.setHeader('Cache-Control','no-store');return res.status(e.statusCode||500).json({ok:false,error:String(e.message||e)});}
};
