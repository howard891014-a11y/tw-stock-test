// Defense-in-depth: unified authorization for all API routes.
// Viewer access is an explicit read-only contract, not a blanket permission for GET.
'use strict';
const access=require('./access-core');
const READ_ONLY_SYNC_VIEWS=new Set([
  'fundflow','fundflow-browser','fundflow-audit','blind-coverage','blind-export',
  'tech-pending','unclassified','market-health','flow-data-health',
  'history-raw-progress','research-x-gap-progress','research-company-action-progress','research-500d-progress'
]);
function viewerCanRead(req){
  const method=String(req.method||'GET').toUpperCase();
  if(!['GET','HEAD'].includes(method))return false;
  const url=new URL(req.url,'https://stockzone.invalid');
  const pathname=url.pathname;
  const params=url.searchParams;
  // Explicit cron endpoints and any client-supplied cron identity are never viewer APIs.
  if(pathname==='/api/market-dynamic-refresh'||req.headers?.['x-vercel-cron-schedule'])return false;
  if(pathname==='/api/sync-status'){
    if(params.has('action')||params.has('confirm'))return false;
    const view=params.get('view');
    if(view)return READ_ONLY_SYNC_VIEWS.has(view.toLowerCase());
    const mode=params.get('mode');
    return !mode||mode==='official-close';
  }
  if(pathname==='/api/fundflow'){
    const view=(params.get('view')||'overview').toLowerCase();
    if(params.has('refresh')&&['1','true'].includes((params.get('refresh')||'').toLowerCase()))return false;
    if(view==='industry-changes')return !params.has('action')||params.get('action')==='list';
    return ['overview','fundflow','browser','fundflow-browser','detail','fundflow-detail'].includes(view);
  }
  if(pathname==='/api/capital-flow'){
    return !params.has('action')&&['summary','detail','featured','featured-history','search'].includes(params.get('view')||'summary');
  }
  if(pathname==='/api/market-dynamic')return params.get('refresh')!=='1';
  return ['/api/news','/api/technical','/api/quote','/api/stock','/api/w3-d111-shadow','/api/w3-d112-shadow'].includes(pathname);
}
function protectApi(handler){
 const wrapped=async function(req,res){
   if(!access.enforced())return handler(req,res);
   res.setHeader('Vary','Cookie');
   res.setHeader('Cache-Control','private, no-store');
   try{
     if(access.verifiedCron(req))return handler(req,res);
     const session=await access.sessionFromCookie(req.headers?.cookie);
     if(!session)return res.status(401).json({ok:false,error:'DEVICE_NOT_AUTHORIZED'});
     if(session.role==='viewer'&&!viewerCanRead(req))return res.status(403).json({ok:false,error:'ADMIN_ONLY'});
     const url=new URL(req.url,'https://stockzone.invalid');
     if(url.pathname==='/api/market-dynamic-refresh')return res.status(403).json({ok:false,error:'CRON_ONLY'});
     if(url.pathname==='/api/fundflow'&&url.searchParams.get('view')==='industry-changes'&&url.searchParams.get('action')==='scan')return res.status(403).json({ok:false,error:'CRON_ONLY'});
     return handler(req,res);
   }catch(e){
     console.error('StockZone access control rejected API request:',String(e?.code||e?.message||'unknown'));
     return res.status(503).json({ok:false,error:'ACCESS_UNAVAILABLE'});
   }
 };
 Object.assign(wrapped,handler);
 return wrapped;
}
module.exports={protectApi,viewerCanRead};
