const { getFundflowSnapshot, getFundflowDetail, getFundflowBusinessBrowser } = require('../lib/fundflow-xy');

function boundedDays(v){return Math.max(5,Math.min(15,Number(v)||10))}
function forceRefresh(v){const s=String(v||'').toLowerCase();return s==='true'||s==='1'}

module.exports=async function handler(req,res){
  try{
    const view=String(req.query?.view||'overview').trim().toLowerCase();
    const days=boundedDays(req.query?.days);
    if(view==='browser'||view==='fundflow-browser'){
      res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).json(await getFundflowBusinessBrowser({days}));
    }
    if(view==='detail'||view==='fundflow-detail'){
      const tagId=String(req.query?.tag||req.query?.tagId||'').trim();
      if(!tagId||!/^[a-z0-9_-]{2,80}$/i.test(tagId))return res.status(400).json({ok:false,error:'業務 tag 格式錯誤'});
      res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=3600');
      return res.status(200).json(await getFundflowDetail({tagId,days}));
    }
    if(!['overview','fundflow',''].includes(view))return res.status(400).json({ok:false,error:'未知 fundflow view'});
    const force=forceRefresh(req.query?.refresh);
    res.setHeader('Cache-Control',force?'no-store':'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json(await getFundflowSnapshot({days,force}));
  }catch(e){
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};

module.exports._test={boundedDays,forceRefresh};
