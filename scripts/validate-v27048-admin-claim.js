'use strict';
const assert=require('node:assert/strict');
const dbId=require.resolve('../lib/db');
let claimed=0;
require.cache[dbId]={id:dbId,filename:dbId,loaded:true,exports:{getSql:()=>({query:async(sql,args)=>{
 assert.match(sql,/WITH claim AS/);
 assert.match(sql,/RETURNING id,label,role/);
 assert.match(sql,/SELECT \$2,id,label,role,\$3::timestamptz,TRUE FROM claim/);
 assert.match(String(args[0]),/^[0-9a-f]{64}$/);
 if(claimed++)return [];
 return [{label:'owner device',role:'admin'}];
}})}};
const a=require('../lib/access-core');
(async()=>{
 const raw='A'.repeat(43);
 const result=await a.redeem(raw);
 assert.equal(result.role,'admin','Only the DB-selected role is assigned');
 assert.equal(result.label,'owner device');
 assert.match(result.token,/^[a-zA-Z0-9_-]{40,100}$/);
 assert.equal(await a.redeem(raw),null,'Admin invitation cannot be reused');
 console.log('PASS v2.7.0.48 one-time owner admin claim, DB role verification, replay rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
