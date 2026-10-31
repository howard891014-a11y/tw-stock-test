'use strict';
// StockZone deployment gate: run before packaging and before each Vercel upload.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const settings=require('../vercel.json');
const pkg=require('../package.json');
const entry=settings.proxy?.entrypoint;
// https://openapi.vercel.sh/vercel.json — proxy.entrypoint pattern (2026-10-31)
const schemaPattern=/^(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*:[A-Za-z_]\w*|(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[\\?#\u0000-\u001F])(?!.*\.d\.ts$).+\.(?:js|ts|py))$/;
assert.equal(schemaPattern.test('proxy.mjs'),false,'regression: Vercel rejects .mjs entrypoint');
assert.equal(schemaPattern.test(entry),true,'proxy.entrypoint does not pass official schema');
assert.equal(entry,'proxy.js','single supported root proxy file');
assert(fs.existsSync(path.join(root,entry)),'Routing Middleware entrypoint missing');
assert(!fs.existsSync(path.join(root,'proxy.mjs')),'obsolete proxy.mjs must be removed');
assert(!fs.existsSync(path.join(root,'proxy.ts')),'old proxy.ts must be removed');
const proxy=fs.readFileSync(path.join(root,entry),'utf8');
assert.match(proxy,/export default async function proxy/);
assert.match(proxy,/sessionFromCookie/);
assert.match(proxy,/verifiedCron/);
assert.match(proxy,/rewrite\(page\)/);
assert(pkg.dependencies?.['@vercel/functions'],'@vercel/functions must be declared');
assert.equal(settings.crons.length,23,'all original 23 crons kept');
assert.equal(settings.rewrites.length,3,'all original rewrites kept');
assert.equal(pkg.version,'2.7.0.43');
console.log('v2.7.0.43 Vercel proxy entrypoint/schema/legacy cleanup + 23 cron/3 rewrites PASS');
