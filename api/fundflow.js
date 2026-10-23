const { getFundflowSnapshot, getFundflowBusinessBrowser, getFundflowDetail, SNAPSHOT_SCHEMA_VERSION } = require('../lib/fundflow-xy');

async function szDw4Handler(req,res){
  const {predictDw4,DW4_VERSION}=require('../lib/dw4');
  const {summarizeDw4Audit}=require('../lib/dw4-audit');
  res.setHeader('Cache-Control','no-store');
  try{
    const view=String(req.query?.view||'').trim();
    if(view==='audit'){
      // Never persist predicted rows for diagnostics; the 203 taxonomy remains the source of truth.
      const sql=require('../lib/db').getSql();
      const [members,asOf]=await Promise.all([
        sql.query('SELECT tag_id,COUNT(*)::integer AS members FROM market_business_xy2_member GROUP BY tag_id'),
        sql.query('SELECT MAX(trade_date)::text AS date FROM market_business_xy2_topic_daily')
      ]);
      const dw4=await predictDw4({sql,persist:false,horizons:[5,10,15,20]});
      const result=summarizeDw4Audit(dw4,members,asOf?.[0]?.date||null);
      return res.status(200).json(result);
    }
    const date=String(req.query?.date||'').trim()||null;
    const persist=['1','true','yes'].includes(String(req.query?.persist||'').toLowerCase());
    const one=Number(req.query?.horizon??req.query?.h);
    const hs=Number.isFinite(one)?[one]:String(req.query?.horizons||'5,10,15,20').split(',').map(Number);
    const data=await predictDw4({date,persist,horizons:hs});
    return res.status(200).json(data);
  }catch(e){return res.status(500).json({ok:false,modelVersion:DW4_VERSION,error:String(e?.message||e)});}
};

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
  // Backward-compatible Vercel rewrite: /api/dw4 -> /api/fundflow?sz_route=dw4
  if(String(req.query?.sz_route||'')==='dw4')return szDw4Handler(req,res);
  try{
    if(String(req.query?.view||'')==='industry-changes')return await require('../lib/industry-change-api')(req,res);
    const view=String(req.query?.view||'overview').trim().toLowerCase();
    const days=boundedDays(req.query?.days);
    if(view==='browser'||view==='fundflow-browser'){
      const force=forceRefresh(req.query?.refresh),data=await getFundflowBusinessBrowser({days,force});
      res.setHeader('Cache-Control',cacheHeader(data,{force,browser:true}));
      return res.status(200).json(data);
    }
    if(view==='detail'||view==='fundflow-detail'){
      const tagId=String(req.query?.tagId||req.query?.tag||'').trim();
      if(!tagId)return res.status(400).json({ok:false,error:'缺少業務 tag'});
      const data=await getFundflowDetail({tagId,days});
      res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=3600');
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
