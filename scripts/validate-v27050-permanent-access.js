'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const config=require('../vercel.json');
const pkg=require('../package.json');
assert.match(pkg.version,/^2\.7\.0\.\d+$/);
assert(Number(pkg.version.split('.').at(-1))>=50,'permanent authorization must remain valid in future releases');
assert.equal(config.proxy.entrypoint,'proxy.js');
assert.equal(config.crons.length,23);
assert.equal(config.rewrites.length,3);

const rows=new Map(),invites=new Map();
let count=0;
const newId=()=>`00000000-0000-4000-8000-${String(++count).padStart(12,'0')}`;
const yearFromNow=()=>new Date(Date.now()+365*86400000).toISOString();
const stub={async query(sql,args=[]){
  const s=sql.replace(/\s+/g,' ');
  if(s.includes('SELECT id,invite_id,label,role,expires_at,permanent FROM public.sz_access_sessions')){
    assert.match(s,/permanent=TRUE OR expires_at>now\(\)/);
    const x=rows.get(args[0]);
    return x && !x.revoked && (x.permanent || Date.parse(x.expires_at)>Date.now()) ? [x] : [];
  }
  if(s.includes('INSERT INTO public.sz_access_sessions')&&!s.includes('WITH claim')){
    assert.match(s,/permanent\) VALUES\(\$1,\$2,\$3,\$4,\$5,TRUE\)/);
    rows.set(args[0],{id:newId(),invite_id:args[1],label:args[2],role:args[3],expires_at:args[4],permanent:true,revoked:false});
    return [];
  }
  if(s.includes('INSERT INTO public.sz_access_invites')){
    invites.set(args[1],{id:newId(),label:args[0],role:'viewer',expires_at:new Date(Date.now()+args[2]*3600000).toISOString(),used:false,revoked:false});
    const x=invites.get(args[1]);return [{id:x.id,expires_at:x.expires_at}];
  }
  if(s.includes('WITH claim AS')){
    assert.match(s,/SELECT \$2,id,label,role,\$3::timestamptz,TRUE FROM claim/);
    const x=invites.get(args[0]);if(!x||x.used||x.revoked||Date.parse(x.expires_at)<=Date.now())return [];
    x.used=true;rows.set(args[1],{id:newId(),invite_id:x.id,label:x.label,role:x.role,expires_at:args[2],permanent:true,revoked:false});
    return [{label:x.label,role:x.role}];
  }
  if(s.includes('SELECT id,label,created_at,expires_at,used_at,revoked_at FROM public.sz_access_invites'))return [];
  if(s.includes('SELECT id,invite_id,label,role,created_at,expires_at,permanent,revoked_at FROM public.sz_access_sessions'))return [...rows.values()].map(x=>({...x,revoked_at:x.revoked?'2026-01-01':null}));
  throw Error('Unexpected SQL '+s.slice(0,180));
}};
const dbId=require.resolve('../lib/db');
require.cache[dbId]={id:dbId,filename:dbId,loaded:true,exports:{getSql:()=>stub}};
const a=require('../lib/access-core');
const accessApi=require('../api/access');
const response=()=>({code:0,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(obj){this.body=obj;return this}});
async function run(){
  assert.equal(a.COOKIE_AGE_SECONDS,365*86400,'browser cookie is renewed with finite browser-supported max age');
  const owner=await a.createSession({label:'StockZone owner',role:'admin'});
  let s=await a.sessionFromCookie(`${a.COOKIE}=${owner.token}`);
  assert.equal(s.role,'admin');assert.equal(s.permanent,true);
  const invited=await a.invite('Family device',48),family=await a.redeem(invited.code);
  assert.equal(await a.redeem(invited.code),null,'invite never becomes reusable');
  const record=await a.sessionFromCookie(`${a.COOKIE}=${family.token}`);
  assert.equal(record.permanent,true);
  // The legacy DB date can be in the past; the permanent flag overrides that date.
  rows.get(a.digest(family.token)).expires_at='2020-01-01T00:00:00.000Z';
  assert((await a.sessionFromCookie(`${a.COOKIE}=${family.token}`)),'permanent session must survive original 365-day date');
  const legacyToken=a.randomToken();rows.set(a.digest(legacyToken),{id:newId(),invite_id:null,label:'old timed session',role:'viewer',expires_at:'2020-01-01T00:00:00.000Z',permanent:false,revoked:false});
  assert.equal(await a.sessionFromCookie(`${a.COOKIE}=${legacyToken}`),null,'non-permanent expired sessions remain denied');
  rows.get(a.digest(family.token)).revoked=true;
  assert.equal(await a.sessionFromCookie(`${a.COOKIE}=${family.token}`),null,'revoked family device must remain blocked');
  const res=response();await accessApi({method:'GET',query:{action:'status'},headers:{cookie:`${a.COOKIE}=${owner.token}`}},res);
  assert.equal(res.code,200);assert.equal(res.body.role,'admin');
  assert.match(res.headers['Set-Cookie'],new RegExp('Max-Age='+a.COOKIE_AGE_SECONDS));
  assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);
  const list=response();await accessApi({method:'GET',query:{action:'list'},headers:{cookie:`${a.COOKIE}=${owner.token}`}},list);
  assert.equal(list.code,200);assert(list.body.sessions.some(x=>x.permanent),'admin list exposes accurate permanent status');
  const html=fs.readFileSync(path.join(root,'access-admin.html'),'utf8');
  assert.match(html,/長期有效（可隨時撤銷）/);
  assert.match(html,/s\.permanent/);
  const proxy=fs.readFileSync(path.join(root,'proxy.js'),'utf8');
  assert.match(proxy,/response\.headers\.append\('Set-Cookie',access\.cookie\(raw,access\.COOKIE_AGE_SECONDS\)\)/);
  assert.match(proxy,/url\.pathname==='\/'/);
  const migration=fs.readFileSync(path.join(root,'docs/stockzone-v27050-permanent-access.sql'),'utf8');
  assert.match(migration,/ADD COLUMN IF NOT EXISTS permanent BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration,/revoked_at IS NULL AND expires_at>now\(\)/);
  for(const rel of ['lib/resonance-lab-v1.js','lib/w3-d111.js','lib/access-server.js'])assert(fs.existsSync(path.join(root,rel)));
  console.log('PASS v2.7.0.50: family/owner never-expiring Neon authorization, legacy session migration, finite renewing browser cookie, revoked denial, no extra login, 23 cron intact');
}
run().catch(e=>{console.error(e);process.exitCode=1});
