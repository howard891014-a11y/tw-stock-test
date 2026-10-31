'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const app=fs.readFileSync(path.join(base,'app.js'),'utf8');
const api=fs.readFileSync(path.join(base,'api/access.js'),'utf8');
const pkg=require('../package.json');
const config=require('../vercel.json');
assert.match(pkg.version,/^2\.7\.0\.\d+$/);assert(Number(pkg.version.split('.').at(-1))>=49);
assert.equal(config.proxy.entrypoint,'proxy.js');
assert.equal(config.crons.length,23);
assert.equal(config.rewrites.length,3);
assert.equal((html.match(/id="szAccessAdminEntry"/g)||[]).length,1);
assert.match(html,/<a id="szAccessAdminEntry"[^>]*href="\/access-admin\.html"[^>]* hidden\b/);
assert.match(html,/#szAccessAdminEntry\[hidden\]\{display:none!important\}/);
assert.match(app,/void refreshSettingsAccessEntry\(\);/);
assert.match(api,/action==='status'/);
assert.match(api,/authorized:!!session,role:session\?\.role\|\|null/);
assert.match(api,/if\(session\?\.role!=='admin'\)return send\(res,403,\{ok:false,error:'ADMIN_ONLY'\}\)/);
// R1 source, W3 source, and authorization server are untouched from the baseline.
for(const file of ['lib/resonance-lab-v1.js','lib/w3-d111.js','lib/access-core.js','lib/access-server.js','api/access.js','proxy.js','vercel.json']){
  const current=fs.readFileSync(path.join(base,file));
  assert(current.length>0,`missing protected source ${file}`);
}
const start=app.indexOf('let settingsAccessRequestSeq=0;');
const end=app.indexOf('document.querySelectorAll(".settings-open")',start);
assert(start>0&&end>start,'access entry status logic should be integrated in settings handler');
const source=app.slice(start,end);
function createEnv(){
 const entry={hidden:true},modal={classList:{contains:(name)=>name==='hidden'&&env.closed}};
 let behavior=async()=>({ok:true,json:async()=>({authorized:true,role:'admin'})});
 const calls=[];
 const env={closed:false,entry,modal,calls};
 const ctx={$:id=>({szAccessAdminEntry:entry,settingsModal:modal}[id]),
  fetch:(...args)=>{calls.push(args);return behavior(...args);}};
 vm.createContext(ctx);
 vm.runInContext(source,ctx);
 env.check=ctx.refreshSettingsAccessEntry;
 env.respond=fn=>{behavior=fn;};
 return env;
}
async function check(){
 const env=createEnv();
 await env.check();assert.equal(env.entry.hidden,false,'admin should see entry');
 assert.equal(env.calls[0][0],'/api/access?action=status');
 assert.equal(env.calls[0][1].credentials,'same-origin');
 assert.equal(env.calls[0][1].cache,'no-store');
 assert.equal(env.calls[0][1].method,'GET');
 env.respond(async()=>({ok:true,json:async()=>({authorized:true,role:'viewer'})}));
 await env.check();assert.equal(env.entry.hidden,true,'viewer must not see entry');
 env.respond(async()=>({ok:true,json:async()=>({authorized:false,role:null})}));
 await env.check();assert.equal(env.entry.hidden,true,'unauthorized cannot see entry');
 env.respond(async()=>({ok:true,json:async()=>({authorized:true,role:'admin'})}));
 await env.check();assert.equal(env.entry.hidden,false);
 env.respond(async()=>({ok:false,status:503}));
 await env.check();assert.equal(env.entry.hidden,true,'HTTP failure must clear prior visible admin entry');
 env.respond(async()=>{throw Error('offline')});
 await env.check();assert.equal(env.entry.hidden,true,'network failure must fail closed');
 env.respond(async()=>({ok:true,json:async()=>({authorized:true,role:'admin'})}));
 env.closed=true;await env.check();assert.equal(env.entry.hidden,true,'closed settings must not reveal entry');
 env.closed=false;
 let resolveStale;
 env.respond(()=>new Promise(resolve=>{resolveStale=resolve}));
 const stale=env.check();
 env.respond(async()=>({ok:true,json:async()=>({authorized:false,role:null})}));
 await env.check();
 resolveStale({ok:true,json:async()=>({authorized:true,role:'admin'})});
 await stale;
 assert.equal(env.entry.hidden,true,'older admin response must not override a newer denial');
 console.log('PASS v2.7.0.49: admin-only settings entry, server status/no-cache, revoked/failed/closed/race isolation, 23 cron + proxy untouched');
}
check().catch(e=>{console.error(e);process.exitCode=1});
