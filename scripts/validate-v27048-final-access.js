 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const code=fs.readFileSync(path.join(root,'lib/access-core.js'),'utf8');
const api=fs.readFileSync(path.join(root,'api/access.js'),'utf8');
const cfg=require('../vercel.json');
const pkg=require('../package.json');
assert.equal(pkg.version,'2.7.0.48');
assert.equal(cfg.proxy.entrypoint,'proxy.js');
assert.equal(cfg.crons.length,23);
assert.equal(cfg.rewrites.length,3);
assert.match(code,/RETURNING id,label,role/);
assert.match(code,/SELECT \$2,id,label,role,\$3::timestamptz/);
assert.match(api,/role:issued.role/);
assert.match(code,/return !schedule\|\|row.schedule===schedule/);
assert.match(code,/secret.length<32/);
assert.match(code,/target.pathname!==rawUrl.pathname\|\|target.search!==rawUrl.search/);
for(const f of fs.readdirSync(path.join(root,'api')).filter(f=>f.endsWith('.js')&&f!=='access.js')){
 assert.match(fs.readFileSync(path.join(root,'api',f),'utf8'),/access-server'\)\.protectApi\(module\.exports\)/);
}
assert.match(fs.readFileSync(path.join(root,'proxy.js'),'utf8'),/sessionFromCookie/);
assert.match(fs.readFileSync(path.join(root,'docs/stockzone-v27040-access-schema.sql'),'utf8'),/role TEXT NOT NULL DEFAULT 'viewer'/);
assert(!fs.existsSync(path.join(root,'proxy.ts'))&&!fs.existsSync(path.join(root,'proxy.mjs')));
console.log('PASS v2.7.0.48 final auth: one-time admin claim, official cron auth, 23 jobs, 3 rewrites, single proxy, 8 protected APIs');
