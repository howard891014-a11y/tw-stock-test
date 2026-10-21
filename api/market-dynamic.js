const { getMarketDynamicCached } = require('../lib/market-dynamic');
module.exports=async function handler(req,res){
  try{
    if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
    // Regular page views never trigger repeat raw data synchronization/W3 audits.
    const data=await getMarketDynamicCached({days:req.query?.days});
    res.setHeader('Cache-Control','no-store'); // Do not retain yesterday's model behind CDN TTL.
    return res.status(200).json(data);
  }catch(e){
    console.error('market-dynamic snapshot read failed',e);
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};
