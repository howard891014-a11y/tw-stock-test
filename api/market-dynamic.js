const { getMarketDynamicCached } = require('../lib/market-dynamic');
const { getMarketIndexQuote } = require('../lib/market-index-eod');
module.exports=async function handler(req,res){
  // Explicit shadow selection; each original immutable model stays independent.
  if(String(req.query?.sz_shadow||'')==='d111')return require('../lib/api-routes/w3-shadow').d111(req,res);
  if(String(req.query?.sz_shadow||'')==='d112')return require('../lib/api-routes/w3-shadow').d112(req,res);
  try{
    if(req.method&&req.method!=='GET')return res.status(405).json({ok:false,error:'GET only'});
    // Fast index endpoint is independent of heavy W3 snapshot refresh.
    if(String(req.query?.view||'')==='index'){
      const quote=await getMarketIndexQuote();
      res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=30');
      return res.status(200).json(quote);
    }
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
