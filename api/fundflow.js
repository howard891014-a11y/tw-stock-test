const { getFundflowSnapshot } = require('../lib/fundflow-xy');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=300');
  try{
    const days=Math.max(5,Math.min(15,Number(req.query?.days)||10));
    const force=String(req.query?.refresh||'').toLowerCase()==='true'||String(req.query?.refresh||'')==='1';
    const data=await getFundflowSnapshot({days,force});
    return res.status(200).json(data);
  }catch(e){
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};
