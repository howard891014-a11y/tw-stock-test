// v2.7.0.40: protects static HTML, scripts, images AND APIs before CDN cache.
import { next, rewrite } from '@vercel/functions';
import access from './lib/access-core.js';
export const config={runtime:'nodejs'};
const open=new Set(['/access.html','/access-admin.html','/api/access','/favicon.ico']);
export default async function proxy(request){
 if(!access.enforced())return next();
 const url=new URL(request.url);
 if(open.has(url.pathname))return next();
 try{
   // A Vercel cron must match an explicitly configured schedule and URL.
   const headers=Object.fromEntries(request.headers);
   if(url.pathname.startsWith('/api/')&&access.verifiedCron({headers,method:request.method,url:url.pathname+url.search}))return next();
   const session=await access.sessionFromCookie(request.headers.get('cookie'));
   if(session)return next();
   if(url.pathname.startsWith('/api/'))return new Response(JSON.stringify({ok:false,error:'DEVICE_NOT_AUTHORIZED'}),{
      status:401,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
   if(url.pathname==='/'){
     const page=new URL('/access.html',request.url);
     return Response.redirect(page,302);
   }
   // Rewrite rather than redirect protected assets, so unapproved users never see JS / index source.
   const page=new URL('/access.html',request.url);
   return rewrite(page);
 }catch(e){
   console.error('StockZone access middleware denied request:',String(e?.code||e?.message||'unknown'));
   return new Response('存取驗證暫時無法使用',{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
