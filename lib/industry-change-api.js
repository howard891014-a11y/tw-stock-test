'use strict';
// Industry-change candidates only. No authentication prompt until the whole
// developer-mode surface (and its server endpoints) is guarded consistently.
// This API has NO approved-taxonomy write capability; official Neon taxonomy
// release remains an independent, explicitly audited operation.
const crypto=require('node:crypto');
const monitor=require('./industry-change-monitor');
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
async function handler(req,res){
  try{
    const act=String(req.query?.action||'list'),method=String(req.method||'GET').toUpperCase();
    if(!process.env.BLOB_READ_WRITE_TOKEN)return respond(res,503,{ok:false,error:'尚未連結 Private Blob（BLOB_READ_WRITE_TOKEN）'});
    if(act==='list'&&method==='GET')return respond(res,200,{ok:true,rows:await monitor.listChanges()});
    if(act==='scan'&&method==='GET'){
      if(!authorized(req,process.env.CRON_SECRET))return respond(res,401,{ok:false,error:'定時偵測僅允許授權 Cron'});
      return respond(res,200,await monitor.scan());
    }
    if((act==='scan'||act==='delete')&&method==='POST'){
      if(!sameOriginBrowserPost(req))return respond(res,403,{ok:false,error:'僅允許從同一網站的開發者模式操作'});
      if(act==='scan')return respond(res,200,await monitor.scan());
      if(String(req.headers?.['content-type']||'').split(';')[0].toLowerCase()!=='application/json')return respond(res,415,{ok:false,error:'需要 JSON 請求'});
      const id=String(req.body?.id||'');
      if(!/^[a-f0-9]{24}$/.test(id))return respond(res,400,{ok:false,error:'紀錄代碼格式錯誤'});
      // monitor.removeConfirmed re-reads the audited Neon release and refuses
      // deletion of any non-imported or unverifiable candidate.
      return respond(res,200,await monitor.removeConfirmed(id));
    }
    // No unguarded confirm endpoint. Imported state is computed from reviewed
    // market_taxonomy_release + the actual approved Neon membership only.
    return respond(res,405,{ok:false,error:'不支援的操作'});
  }catch(e){return respond(res,503,{ok:false,error:String(e?.message||e)});}
}
module.exports=handler;
module.exports._test={sameOriginBrowserPost};
