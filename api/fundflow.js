const { getFundflowSnapshot, getFundflowBusinessBrowser, SNAPSHOT_SCHEMA_VERSION } = require('../lib/fundflow-xy');

function boundedDays(v){return Math.max(5,Math.min(15,Number(v)||10))}
function forceRefresh(v){const s=String(v||'').toLowerCase();return s==='true'||s==='1'}
function cacheHeader(data,{force=false,browser=false}={}){
  // Never let a fallback/legacy snapshot enter the CDN cache. During manual-development
  // mode that is what could make a fresh v6 view appear to "revert" after reopening.
  const pending=Boolean(data?.enginePending||data?.snapshotSchemaPending||data?.snapshotPending);
  const wrongSchema=data?.snapshotSchemaVersion&&String(data.snapshotSchemaVersion)!==SNAPSHOT_SCHEMA_VERSION;
  if(force||pending||wrongSchema)return 'no-store';
  if(browser)return 'public, s-maxage=600, stale-while-revalidate=3600';
  return 'public, s-maxage=300, stale-while-revalidate=3600';
}

module.exports=async function handler(req,res){
  try{
    const view=String(req.query?.view||'overview').trim().toLowerCase();
    const days=boundedDays(req.query?.days);
    if(view==='browser'||view==='fundflow-browser'){
      const force=forceRefresh(req.query?.refresh),data=await getFundflowBusinessBrowser({days,force});
      res.setHeader('Cache-Control',cacheHeader(data,{force,browser:true}));
      return res.status(200).json(data);
    }
    if(!['overview','fundflow',''].includes(view))return res.status(400).json({ok:false,error:'未知 fundflow view'});
    const force=forceRefresh(req.query?.refresh),data=await getFundflowSnapshot({days,force});
    res.setHeader('Cache-Control',cacheHeader(data,{force}));
    return res.status(200).json(data);
  }catch(e){
    res.setHeader('Cache-Control','no-store');
    return res.status(500).json({ok:false,error:String(e?.message||e)});
  }
};

module.exports._test={boundedDays,forceRefresh,cacheHeader};
