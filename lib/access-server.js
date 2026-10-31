// Defense-in-depth: all API routes use the same Neon-backed authorization contract.
'use strict';
const access=require('./access-core');
function protectApi(handler){
 const wrapped=async function(req,res){
   if(!access.enforced())return handler(req,res);
   res.setHeader('Vary','Cookie');
   try{
     if(access.verifiedCron(req))return handler(req,res);
     const session=await access.sessionFromCookie(req.headers?.cookie);
     if(!session){res.setHeader('Cache-Control','private, no-store');return res.status(401).json({ok:false,error:'DEVICE_NOT_AUTHORIZED'})}
     const method=String(req.method||'GET').toUpperCase();
     const url=new URL(req.url,'https://stockzone.invalid');
     // Existing manual writes are administrator-only. Cron GETs have a separate identity.
     if(!['GET','HEAD'].includes(method)&&session.role!=='admin')return res.status(403).json({ok:false,error:'ADMIN_ONLY'});
     if(url.pathname==='/api/market-dynamic-refresh')return res.status(403).json({ok:false,error:'CRON_ONLY'});
     if(url.pathname==='/api/fundflow'&&url.searchParams.get('view')==='industry-changes'&&url.searchParams.get('action')==='scan')return res.status(403).json({ok:false,error:'CRON_ONLY'});
     if(method==='GET'&&url.pathname==='/api/sync-status'&&url.searchParams.has('action')&&session.role!=='admin')return res.status(403).json({ok:false,error:'ADMIN_ONLY'});
     return handler(req,res);
   }catch(e){
     console.error('StockZone access control rejected API request:',String(e?.code||e?.message||'unknown'));
     res.setHeader('Cache-Control','private, no-store');return res.status(503).json({ok:false,error:'ACCESS_UNAVAILABLE'});
   }
 };
 Object.assign(wrapped,handler);
 return wrapped;
}
module.exports={protectApi};
