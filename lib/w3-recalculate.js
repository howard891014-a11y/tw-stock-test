'use strict';
const crypto=require('node:crypto');
const {computeW3D112}=require('./w3-d112');
const {fetchW3D112Inputs}=require('./w3-d112-inputs');
const {getSql}=require('./db');
const {refreshMarketSnapshot}=require('./market-dynamic');
const {read}=require('./market-dynamic-blob');
function checkBearer(req){
  const secret=process.env.W3_RECALC_SECRET||process.env.CRON_SECRET;
  if(!secret||secret.length<16)return false;
  const supplied=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
  const a=Buffer.from(supplied),b=Buffer.from(secret);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function describeMissing(r,i){
  const missing=[];
  if(!r)missing.push('該日沒有市場日資料');
  else{
    if(r.taiex===null)missing.push('大盤指數');
    if(r.institutional_value_twd===null)missing.push('法人金額／完整度');
    if(r.financing_value_twd===null)missing.push('融資市值');
    if(r.advance_ratio===null||r.breadth5===null)missing.push('漲跌家數／廣度');
    if(i<20)missing.push('早期20交易日暖機資料');
  }
  if(!missing.length)missing.push('計算窗口中有連續資料缺口，或W3歷史狀態尚未達有效條件');
  return missing;
}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'POST only'});
  if(!process.env.W3_RECALC_SECRET&&!process.env.CRON_SECRET)return res.status(503).json({ok:false,error:'W3_RECALC_SECRET / CRON_SECRET 尚未設定'});
  if(!checkBearer(req))return res.status(401).json({ok:false,error:'管理密鑰不正確'});
  const day=String(req.body?.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day)))return res.status(400).json({ok:false,error:'Invalid trade date'});
  try{
    // Do not let an admin accidentally write a new trade-day or override a current valid result.
    const current=await read()||await require('./market-dynamic').readMarketSnapshot(getSql());
    const entry=current?.w3?.records?.find(r=>r.date===day);
    if(!entry)return res.status(409).json({ok:false,error:'目標日期不在已封存的W3紀錄內'});
    if(entry.valid||entry.status==='historical_saved')return res.status(409).json({ok:false,error:'此日期已有保存紀錄，無需重算'});
    const input=await fetchW3D112Inputs(getSql());
    const result=computeW3D112(input);
    const row=result.records.find(r=>r.date===day);
    if(!row?.valid){
      const i=input.findIndex(r=>r.date===day);
      return res.status(200).json({ok:true,date:day,status:'still_incomplete',computed:false,
        missing:describeMissing(input[i],i),note:'原始資料不足；單純重跑公式不會補出缺失數據。未修改Neon。'});
    }
    // Original model succeeded; run existing canonical refresh once, then save BOTH Neon and Blob.
    const updated=await refreshMarketSnapshot({force:false});
    const saved=updated?.w3?.records?.find(r=>r.date===day);
    return res.status(200).json({ok:true,date:day,status:saved?.status||'not_saved',
      computed:Boolean(saved?.valid),regime:saved?.valid?saved.regime:null,
      note:saved?.valid?'已按原始W3公式重算並同步快照。':'重算資料尚未成為正式有效紀錄。'});
  }catch(e){console.error('W3 authenticated recheck failed',String(e?.message||e));
    return res.status(503).json({ok:false,error:'重新運算暫時無法完成，請查伺服器紀錄'});}
};
