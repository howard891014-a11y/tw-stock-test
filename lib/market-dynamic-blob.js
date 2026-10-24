'use strict';
// Public W3/market data, stored as a private Blob and delivered by our API.
// Ordinary page reads use this Blob; only nightly refresh runs the original W3 model.
const PATH='stockzone/market-dynamic/w3-d112/current-snapshot.json';
function configured(){return Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
function client(){return require('@vercel/blob')}
function missing(e){return e?.name==='BlobNotFoundError'||e?.name==='BlobNotFound'||/404|not.found/i.test(String(e?.message||''))}
async function read({fresh=false}={}){
  if(!configured())return null;
  let r;
  try{r=await client().get(PATH,{access:'private',...(fresh?{useCache:false}:{})});}catch(e){if(missing(e))return null;throw e}
  if(!r)return null;
  if(r.statusCode===404)return null;
  if(r.statusCode!==200||!r.stream)throw new Error('W3 private Blob HTTP '+r.statusCode);
  const p=JSON.parse(await new Response(r.stream).text());
  if(!p||p.ok!==true||!p.w3||!Array.isArray(p.w3.records)||!Array.isArray(p.history))throw new Error('Invalid W3 Blob snapshot');
  return p;
}
async function write(payload){
  if(!configured())throw new Error('BLOB_READ_WRITE_TOKEN is required for W3 snapshot offloading');
  if(payload?.ok!==true||!Array.isArray(payload?.w3?.records))throw new Error('Invalid W3 snapshot payload');
  await client().put(PATH,JSON.stringify(payload),{
    access:'private',contentType:'application/json',addRandomSuffix:false,
    allowOverwrite:true,cacheControlMaxAge:60
  });
  return true;
}
function page(payload,days=60,backend='blob'){
  const lim=Math.max(20,Math.min(120,Number(days)||60));
  return {...payload,history:Array.isArray(payload.history)?payload.history.slice(0,lim):[],meta:{...(payload.meta||{}),returnedDays:Math.min(lim,(payload.history||[]).length),cached:true,snapshotBackend:backend}};
}
module.exports={read,write,page,PATH,configured};
