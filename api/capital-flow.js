'use strict';
const {getSummary,getDetail,searchStockSectors}=require('../lib/capital-flow');
module.exports=async (req,res)=>{
  if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'僅支援查詢'});
  try{
    const view=String(req.query?.view||'summary');
    if(!['summary','detail','featured','search'].includes(view))return res.status(400).json({ok:false,error:'未知查詢'});
    const data=view==='featured'?await require('../lib/featured-neon-daily').getFeaturedDaily():
      view==='search'?await searchStockSectors(String(req.query?.q||'')):
      view==='detail'?await getDetail(String(req.query?.tagId||'')):await getSummary();
    res.setHeader('Cache-Control',view==='featured'?'no-store':'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json(data);
  }catch(e){res.setHeader('Cache-Control','no-store');return res.status(e.statusCode||500).json({ok:false,error:String(e.message||e)});}
};
