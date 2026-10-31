// Central access contract: opaque, DB-revocable sessions; no client-supplied role.
'use strict';
const crypto=require('node:crypto');
const {getSql}=require('./db');
const vercel=require('../vercel.json');
const COOKIE='__Host-sz_access';
const DAY=86400;
const ENFORCE_VALUE='1';
function enforced(){return process.env.SZ_ACCESS_ENFORCED===ENFORCE_VALUE}
function digest(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex')}
function randomToken(){return crypto.randomBytes(32).toString('base64url')}
function parseCookie(header){
 const part=String(header||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));
 if(!part)return '';
 const token=part.slice(COOKIE.length+1);
 return /^[A-Za-z0-9_-]{40,100}$/.test(token)?token:'';
}
function cookie(token,ageSeconds){
 return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0,Math.floor(ageSeconds))}`;
}
function sameOrigin(req){
 const h=req.headers||{};
 const origin=h.origin;
 const host=String(h['x-forwarded-host']||h.host||'').trim().toLowerCase();
 if(!origin||!host||h['x-stockzone-access']!=='1')return false;
 if(h['sec-fetch-site']&&!['same-origin','none'].includes(String(h['sec-fetch-site']).toLowerCase()))return false;
 try{const u=new URL(origin);return u.host.toLowerCase()===host&&(u.protocol==='https:'||(/^localhost(:\d+)?$/.test(host)&&u.protocol==='http:'))}
 catch{return false}
}
function safeCompare(input,expected){
 const a=Buffer.from(digest(input),'hex'),b=Buffer.from(digest(expected),'hex');
 return crypto.timingSafeEqual(a,b);
}
// The schedule+path pair must exist in vercel.json. User-agent alone is never authorization.
function verifiedCron(req){
 const secret=String(process.env.CRON_SECRET||'');
 if(!enforced()||secret.length<16||String(req.method||'GET').toUpperCase()!=='GET')return false;
 if(!safeCompare(String(req.headers?.authorization||''),`Bearer ${secret}`))return false;
 if(!String(req.headers?.['user-agent']||'').includes('vercel-cron/1.0'))return false;
 const schedule=String(req.headers?.['x-vercel-cron-schedule']||'');
 if(!schedule)return false;
 const rawUrl=new URL(req.url,'https://stockzone.invalid');
 return (vercel.crons||[]).some(row=>{
   if(row.schedule!==schedule)return false;
   const target=new URL(row.path,'https://stockzone.invalid');
   return target.pathname===rawUrl.pathname&&target.search===rawUrl.search;
 });
}
async function sessionFromCookie(cookieHeader){
 const raw=parseCookie(cookieHeader);
 if(!raw)return null;
 const rows=await getSql().query(`SELECT id,invite_id,label,role,expires_at
   FROM public.sz_access_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() LIMIT 1`,[digest(raw)]);
 return rows?.[0]||null;
}
async function createSession({inviteId=null,label,role,days=365}){
 const token=randomToken();const expiry=new Date(Date.now()+days*DAY*1000);
 await getSql().query(`INSERT INTO public.sz_access_sessions(token_hash,invite_id,label,role,expires_at)
 VALUES($1,$2,$3,$4,$5)`,[digest(token),inviteId,label,role,expiry.toISOString()]);
 return {token,expiresAt:expiry.toISOString(),ageSeconds:days*DAY};
}
async function redeem(code){
 if(!/^[A-Za-z0-9_-]{40,100}$/.test(String(code||'')))return null;
 const token=randomToken();const expiry=new Date(Date.now()+365*DAY*1000);
 // Atomic claim and session creation. Concurrent claims allow exactly one successful redemption.
 const rows=await getSql().query(`WITH claim AS (
   UPDATE public.sz_access_invites SET used_at=now()
   WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()
   RETURNING id,label
 ), admitted AS (
   INSERT INTO public.sz_access_sessions(token_hash,invite_id,label,role,expires_at)
   SELECT $2,id,label,'viewer',$3::timestamptz FROM claim RETURNING label
 ) SELECT label FROM admitted`,[digest(code),digest(token),expiry.toISOString()]);
 return rows.length?{token,label:rows[0].label,ageSeconds:365*DAY}:null;
}
async function invite(label,validHours){
 const code=randomToken(),hours=Math.max(1,Math.min(168,Number(validHours)||48));
 const rows=await getSql().query(`INSERT INTO public.sz_access_invites(label,token_hash,expires_at)
 VALUES($1,$2,now()+($3::int * interval '1 hour')) RETURNING id,expires_at`,[label,digest(code),hours]);
 return {code,id:rows[0].id,expiresAt:rows[0].expires_at};
}
module.exports={COOKIE,enforced,digest,randomToken,parseCookie,cookie,sameOrigin,safeCompare,verifiedCron,sessionFromCookie,createSession,redeem,invite};
