'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
// Do not reach the live Neon instance: unit tests use a strict in-memory query stub.
const invites=new Map(),sessions=new Map();
let sequentialId=0;
const uuid=()=>`00000000-0000-4000-8000-${String(++sequentialId).padStart(12,'0')}`;
const fakeSql={async query(query,args=[]){
 const s=String(query).replace(/\s+/g,' ');
 if(s.includes('INSERT INTO public.sz_access_invites')){
   const id=uuid(),expiry=new Date(Date.now()+args[2]*3600000).toISOString();
   invites.set(args[1],{id,label:args[0],expiresAt:expiry,used:false,revoked:false});
   return [{id,expires_at:expiry}];
 }
 if(s.includes('WITH claim AS')){
   const i=invites.get(args[0]);if(!i||i.used||i.revoked||new Date(i.expiresAt)<new Date())return [];
   i.used=true;const id=uuid();sessions.set(args[1],{id,inviteId:i.id,label:i.label,role:'viewer',expiresAt:args[2],revoked:false});return [{label:i.label}];
 }
 if(s.includes('INSERT INTO public.sz_access_sessions')){
   const id=uuid();sessions.set(args[0],{id,inviteId:args[1],label:args[2],role:args[3],expiresAt:args[4],revoked:false});return [];
 }
 if(s.includes('FROM public.sz_access_sessions WHERE token_hash')){
   const x=sessions.get(args[0]);return x&&!x.revoked&&new Date(x.expiresAt)>new Date()? [{id:x.id,invite_id:x.inviteId,label:x.label,role:x.role,expires_at:x.expiresAt}]:[];
 }
 throw new Error('Unexpected test SQL: '+s.slice(0,100));
}};
const dbId=require.resolve('../lib/db');
require.cache[dbId]={id:dbId,filename:dbId,loaded:true,exports:{getSql:()=>fakeSql}};
const a=require('../lib/access-core');
(async()=>{
 delete process.env.SZ_ACCESS_ENFORCED;
 assert.equal(a.enforced(),false,'auth not enabled by default');
 process.env.SZ_ACCESS_ENFORCED='1';
 process.env.CRON_SECRET='test-cron-secret-long-enough';
 assert.equal(a.enforced(),true);
 const withCron={method:'GET',url:'/api/sync-status',headers:{authorization:'Bearer test-cron-secret-long-enough','user-agent':'vercel-cron/1.0','x-vercel-cron-schedule':'0 7 * * 1-5'}};
 assert.equal(a.verifiedCron(withCron),true,'allow only genuine configured cron pair');
 assert.equal(a.verifiedCron({...withCron,headers:{...withCron.headers,authorization:'Bearer wrong'}}),false);
 assert.equal(a.verifiedCron({...withCron,url:'/api/quote'}),false);
 assert.equal(a.verifiedCron({...withCron,method:'POST'}),false);
 assert.equal(a.verifiedCron({...withCron,headers:{...withCron.headers,'x-vercel-cron-schedule':'1 7 * * 1-5'}}),false);
 assert.equal(a.sameOrigin({headers:{host:'tw-stock-test.vercel.app',origin:'https://tw-stock-test.vercel.app','x-stockzone-access':'1','sec-fetch-site':'same-origin'}}),true);
 assert.equal(a.sameOrigin({headers:{host:'tw-stock-test.vercel.app',origin:'https://evil.example','x-stockzone-access':'1'}}),false);
 assert.match(a.cookie('abc',5000),/Secure; HttpOnly; SameSite=Lax/);
 const offer=await a.invite('test device',24);
 assert.equal((await a.redeem(offer.code)).label,'test device');
 assert.equal(await a.redeem(offer.code),null,'invitation is one-time only');
 const admin=await a.createSession({label:'owner',role:'admin',days:365});
 const session=await a.sessionFromCookie(`${a.COOKIE}=${admin.token}`);
 assert.equal(session.role,'admin');
 assert.equal(await a.sessionFromCookie(`${a.COOKIE}=invalid`),null);
 const {protectApi}=require('../lib/access-server');
 const handler=protectApi(async(req,res)=>res.status(200).json({ok:true,method:req.method}));
 const makeRes=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(j){this.body=j;return this}});
 let res=makeRes();await handler({method:'GET',url:'/api/quote',headers:{}},res);assert.equal(res.statusCode,401);
 const viewer=await a.invite('viewer',24),activated=await a.redeem(viewer.code);
 res=makeRes();await handler({method:'POST',url:'/api/quote',headers:{cookie:`${a.COOKIE}=${activated.token}`}},res);assert.equal(res.statusCode,403,'viewer cannot POST to business APIs');
 res=makeRes();await handler({method:'POST',url:'/api/quote',headers:{cookie:`${a.COOKIE}=${admin.token}`}},res);assert.equal(res.statusCode,200,'admin can perform existing operations');
 res=makeRes();await handler({method:'GET',url:'/api/quote',headers:{cookie:`${a.COOKIE}=${activated.token}`}},res);assert.equal(res.statusCode,200);
 res=makeRes();await handler({method:'GET',url:'/api/sync-status?action=manual',headers:{cookie:`${a.COOKIE}=${activated.token}`}},res);assert.equal(res.statusCode,403);
 res=makeRes();await handler({method:'GET',url:'/api/sync-status',headers:withCron.headers},res);assert.equal(res.statusCode,200,'authenticated cron without browser cookie');
 process.env.SZ_ACCESS_ENFORCED='0';
 res=makeRes();await handler({method:'GET',url:'/api/quote',headers:{}},res);assert.equal(res.statusCode,200,'bootstrap stage does not lock production');
 const pkg=require('../package.json');assert.equal(pkg.version,'2.7.0.43');
 const settings=require('../vercel.json');assert.equal(settings.crons.length,23);assert.equal(settings.rewrites.length,3);assert.equal(settings.proxy.entrypoint,'proxy.js');
 const allApis=fs.readdirSync(path.join(root,'api')).filter(x=>x.endsWith('.js')&&x!=='access.js');
 for(const file of allApis)assert.match(fs.readFileSync(path.join(root,'api',file),'utf8'),/access-server'\)\.protectApi\(module\.exports\)/,`${file}: no guard`);
 const proxy=fs.readFileSync(path.join(root,'proxy.js'),'utf8');
 assert.match(proxy,/sessionFromCookie/);assert.match(proxy,/verifiedCron/);assert.match(proxy,/rewrite\(page\)/);
 console.log(`StockZone v2.7.0.40 access validation PASS: 23 cron routes, ${allApis.length} guarded existing API routes, one-time invite, roles, no-lock bootstrap`);
})().catch(e=>{console.error(e);process.exitCode=1});
