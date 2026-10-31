// Access management endpoint. Does not accept email, passwords or arbitrary role grants.
'use strict';
const a=require('../lib/access-core');
const {getSql}=require('../lib/db');
function send(res,status,value){res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(status).json(value)}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 const method=String(req.method||'GET').toUpperCase();
 try{
  const session=await a.sessionFromCookie(req.headers?.cookie);
  if(method==='GET'){
   if(req.query?.action==='status')return send(res,200,{ok:true,authorized:!!session,role:session?.role||null,label:session?.label||null,sessionId:session?.id||null,enforced:a.enforced()});
   if(req.query?.action==='list'){
    if(session?.role!=='admin')return send(res,403,{ok:false,error:'ADMIN_ONLY'});
    const [invites,sessions]=await Promise.all([
      getSql().query(`SELECT id,label,created_at,expires_at,used_at,revoked_at FROM public.sz_access_invites ORDER BY created_at DESC LIMIT 150`),
      getSql().query(`SELECT id,invite_id,label,role,created_at,expires_at,revoked_at FROM public.sz_access_sessions ORDER BY created_at DESC LIMIT 200`)]);
    return send(res,200,{ok:true,invites,sessions:sessions.map(s=>({...s,sessionId:s.id}))});
   }
   return send(res,400,{ok:false,error:'INVALID_ACTION'});
  }
  if(method!=='POST')return send(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  if(!a.sameOrigin(req))return send(res,403,{ok:false,error:'SAME_ORIGIN_REQUIRED'});
  const body=req.body&&typeof req.body==='object'?req.body:{};
  const action=String(body.action||'');
  if(action==='admin-login'){
   const configured=String(process.env.SZ_ACCESS_ADMIN_SECRET||'');
   if(configured.length<32||!a.safeCompare(body.secret,configured))return send(res,401,{ok:false,error:'INVALID_ADMIN_SECRET'});
   const created=await a.createSession({label:'StockZone owner',role:'admin',days:365});
   res.setHeader('Set-Cookie',a.cookie(created.token,created.ageSeconds));
   return send(res,200,{ok:true,role:'admin'});
  }
  if(action==='redeem'){
   const issued=await a.redeem(String(body.code||''));
   if(!issued)return send(res,410,{ok:false,error:'LINK_INVALID_OR_USED'});
   res.setHeader('Set-Cookie',a.cookie(issued.token,issued.ageSeconds));
   return send(res,200,{ok:true,role:'viewer',label:issued.label});
  }
  if(action==='signout'){
   const value=a.parseCookie(req.headers?.cookie);
   if(value)await getSql().query(`UPDATE public.sz_access_sessions SET revoked_at=now() WHERE token_hash=$1`,[a.digest(value)]);
   res.setHeader('Set-Cookie',a.cookie('',0));
   return send(res,200,{ok:true});
  }
  if(session?.role!=='admin')return send(res,403,{ok:false,error:'ADMIN_ONLY'});
  if(action==='invite'){
   const label=String(body.label||'').trim();
   if(label.length<1||label.length>80)return send(res,400,{ok:false,error:'INVALID_LABEL'});
   const result=await a.invite(label,body.hours);
   return send(res,200,{ok:true,path:'/access.html#invite='+result.code,expiresAt:result.expiresAt,id:result.id});
  }
  if(action==='revoke-invite'){
   if(!/^[0-9a-f-]{36}$/i.test(String(body.id||'')))return send(res,400,{ok:false,error:'INVALID_ID'});
   // Revoke invite and every redeemed device atomically.
   await getSql().query(`WITH revoked AS (
     UPDATE public.sz_access_invites SET revoked_at=now() WHERE id=$1::uuid RETURNING id
   ) UPDATE public.sz_access_sessions SET revoked_at=now()
     WHERE invite_id IN (SELECT id FROM revoked)`,[body.id]);
   return send(res,200,{ok:true});
  }
  if(action==='revoke-device'){
   const id=String(body.sessionId||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return send(res,400,{ok:false,error:'INVALID_SESSION_ID'});
   // Never revoke the currently active administrator's own session by this action.
   if(id===String(session.id))return send(res,403,{ok:false,error:'USE_SIGNOUT_FOR_CURRENT_DEVICE'});
   await getSql().query(`UPDATE public.sz_access_sessions SET revoked_at=now() WHERE id=$1::uuid`,[id]);
   return send(res,200,{ok:true});
  }
  return send(res,400,{ok:false,error:'INVALID_ACTION'});
 }catch(e){console.error('StockZone access error:',String(e?.code||e?.message||'unknown'));return send(res,503,{ok:false,error:'ACCESS_UNAVAILABLE'})}
};
