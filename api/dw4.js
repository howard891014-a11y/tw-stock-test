const {predictDw4,DW4_VERSION}=require('../lib/dw4');
const {summarizeDw4Audit}=require('../lib/dw4-audit');
module.exports=async function handler(req,res){
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
