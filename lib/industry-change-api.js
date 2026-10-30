'use strict';
// Industry-change candidates only. No authentication prompt until the whole
// developer-mode surface (and its server endpoints) is guarded consistently.
// This API has NO approved-taxonomy write capability; official Neon taxonomy
// release remains an independent, explicitly audited operation.
const crypto=require('node:crypto');
const monitor=require('./industry-change-monitor');
const companyActions=require('./company-action-monitor');
function secureEquals(a,b){const x=crypto.createHash('sha256').update(String(a||'')).digest(),y=crypto.createHash('sha256').update(String(b||'')).digest();return crypto.timingSafeEqual(x,y)}
function authorized(req,secret){return Boolean(secret)&&secureEquals(req.headers?.authorization||'',`Bearer ${secret}`)}
function respond(res,status,body){res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(status).json(body)}
// Cross-site request protection, NOT authentication. Without a developer-mode
// lock, same-origin users may use candidate tools (never Neon classification).
function sameOriginBrowserPost(req){
  const h=req.headers||{};
  const host=String(h['x-forwarded-host']||h.host||'').toLowerCase();
  if(!host)return false;
  if(h['sec-fetch-site']&&!['same-origin','none'].includes(String(h['sec-fetch-site']).toLowerCase()))return false;
  const referer=h.origin||h.referer;
  if(!referer)return false;
  try{const url=new URL(referer);return url.host.toLowerCase()===host && (url.protocol==='https:' || (host.startsWith('localhost')&&url.protocol==='http:'));}catch{return false;}
}
async function scanAll(){
  // One bad external exchange API must not discard the other valid source's
  // candidates; partial progress and exact failed subsystem are reported.
  const [industry,actions]=await Promise.allSettled([monitor.scan(),companyActions.scanRecent()]);
  if(industry.status==='rejected'&&actions.status==='rejected')throw new Error(`產業：${industry.reason?.message||industry.reason}；公司行動：${actions.reason?.message||actions.reason}`);
  return {ok:true,partial:industry.status==='rejected'||actions.status==='rejected'||(actions.status==='fulfilled'&&!actions.value.complete),
    industry:industry.status==='fulfilled'?industry.value:null,
    actions:actions.status==='fulfilled'?actions.value:null,
    errors:[...(industry.status==='rejected'?[`產業：${industry.reason?.message||industry.reason}`]:[]),
      ...(actions.status==='rejected'?[`公司行動：${actions.reason?.message||actions.reason}`]:[]),
      ...(actions.status==='fulfilled'?(actions.value.errors||[]):[])]};
}
async function handler(req,res){
  try{
    const act=String(req.query?.action||'list'),method=String(req.method||'GET').toUpperCase();
    if(!process.env.BLOB_READ_WRITE_TOKEN)return respond(res,503,{ok:false,error:'尚未連結 Private Blob（BLOB_READ_WRITE_TOKEN）'});
    if(act==='list'&&method==='GET'){
      const [industry,actions]=await Promise.all([monitor.listChanges(),companyActions.list()]);
      return respond(res,200,{ok:true,rows:[...industry,...actions].sort((a,b)=>b.date.localeCompare(a.date)||a.code.localeCompare(b.code)||String(a.behavior).localeCompare(String(b.behavior)))});
    }
    if(act==='scan'&&method==='GET'){
      if(!authorized(req,process.env.CRON_SECRET))return respond(res,401,{ok:false,error:'定時偵測僅允許授權 Cron'});
      return respond(res,200,await scanAll());
    }
    if(['scan','scan-actions','delete','delete-action','delete-imported'].includes(act)&&method==='POST'){
      if(!sameOriginBrowserPost(req))return respond(res,403,{ok:false,error:'僅允許從同一網站的開發者模式操作'});
      if(act==='scan')return respond(res,200,await scanAll());
      if(act==='scan-actions')return respond(res,200,await companyActions.scanRecent());
      if(String(req.headers?.['content-type']||'').split(';')[0].toLowerCase()!=='application/json')return respond(res,415,{ok:false,error:'需要 JSON 請求'});
      if(act==='delete-imported'){
        if(req.body?.confirmed!==true)return respond(res,400,{ok:false,error:'必須明確確認僅刪除已導入暫存紀錄'});
        const results=await Promise.allSettled([monitor.removeAllConfirmed(),companyActions.removeAllApproved()]);
        const deleted={industry:results[0].status==='fulfilled'?results[0].value.removed:0,actions:results[1].status==='fulfilled'?results[1].value.removed:0};
        const errors=results.flatMap((r,i)=>r.status==='rejected'?[`${i===0?'產業':'公司行動'}：${r.reason?.message||r.reason}`]:[]);
        return respond(res,200,{ok:true,removed:deleted.industry+deleted.actions,deleted,partial:errors.length>0,errors,formalReleasePreserved:true});
      }
      const id=String(req.body?.id||'');
      if(!/^[a-f0-9]{24}$/.test(id))return respond(res,400,{ok:false,error:'紀錄代碼格式錯誤'});
      // Candidates can be deleted only after an independently audited release.
      // No endpoint here writes approved taxonomy or corporate-action releases.
      if(act==='delete-action')return respond(res,200,await companyActions.removeApproved(id));
      return respond(res,200,await monitor.removeConfirmed(id));
    }
    return respond(res,405,{ok:false,error:'不支援的操作'});
  }catch(e){return respond(res,503,{ok:false,error:String(e?.message||e)});}
}
module.exports=handler;
module.exports._test={sameOriginBrowserPost};
