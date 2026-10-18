'use strict';
// Manual opt-in shadow endpoint: no schema changes, Neon writes, or effect on official W3 UI.
const {fetchW3D111Inputs}=require('../lib/w3-d111-inputs');
const {computeW3D111}=require('../lib/w3-d111');
let cache=null,expires=0;
async function readShadow(){
 if(cache&&Date.now()<expires)return cache;
 const inputs=await fetchW3D111Inputs();
 const run=computeW3D111(inputs);
 const last=run.records.at(-1)||null;
 const validTo=run.records.findLast(r=>r.valid)||null;
 const result={ok:true,mode:'read-only-shadow',modelVersion:'W3-D.1.1',
  latest:last,latestValid:validTo,
  stale:!last?.valid||!inputs.at(-1)?.sourceQuality?.breadthReliable,
  sources:{dailyRows:inputs.length,validDays:run.validDays,
   missingInstitutionalDays:inputs.filter(r=>r.institutional_value_twd===null).length,
   missingMarginDays:inputs.filter(r=>r.financing_value_twd===null).length,
   incompleteBreadthDays:inputs.filter(r=>!r.sourceQuality?.breadthReliable).length},
  transitions:run.switches,warnings:run.warnings,
  records:run.records.map((r,i)=>({...r,financeSource:inputs[i].sourceQuality?.financeSource||'unknown'}))
 };
 cache=result;expires=Date.now()+5*60*1000;
 return result;
}
module.exports=async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
 try{
  const result=await readShadow();
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-StockZone-W3-Mode','READ-ONLY-SHADOW');
  return res.status(200).json(result);
 }catch(err){
  console.error('W3-D.1.1 shadow failed',err);
  res.setHeader('Cache-Control','no-store');
  return res.status(500).json({ok:false,error:String(err?.message||err)});
 }
};
