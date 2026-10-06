const { getMarketDynamic } = require('../lib/market-dynamic');
function flag(v){return ['1','true','yes'].includes(String(v||'').toLowerCase())}
module.exports=async function handler(req,res){
  try{
    const force=flag(req.query?.refresh);
    const data=await getMarketDynamic({days:req.query?.days,force});
    res.setHeader('Cache-Control',force?'no-store':'public, s-maxage=300, stale-while-revalidate=1800');
    return res.status(200).json(data);
  }catch(e){
    console.error('market-dynamic api failed',e);
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};
