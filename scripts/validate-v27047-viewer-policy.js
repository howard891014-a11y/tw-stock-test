'use strict';
const assert=require('node:assert/strict');
const dbId=require.resolve('../lib/db');
require.cache[dbId]={id:dbId,filename:dbId,loaded:true,exports:{getSql:()=>({query:async()=>[]})}};
const policy=require('../lib/access-server');
const allowed=[
'/api/stock?action=valuation','/api/quote?code=2603','/api/technical?symbol=2603',
'/api/market-dynamic','/api/market-dynamic?view=index',
'/api/capital-flow?view=featured','/api/capital-flow?view=detail&tagId=x',
'/api/fundflow?view=overview','/api/fundflow?view=detail&tagId=x',
'/api/fundflow?view=industry-changes',
'/api/sync-status?view=history-raw-progress',
'/api/sync-status?view=research-500d-progress',
'/api/sync-status?mode=official-close&q=2603'
];
const rejected=[
'/api/sync-status?view=blind-catchup&confirm=1',
'/api/sync-status?action=market-rebuild',
'/api/sync-status?action=price',
'/api/sync-status?view=unknown',
'/api/market-dynamic-refresh',
'/api/market-dynamic?refresh=1',
'/api/fundflow?view=industry-changes&action=scan',
'/api/fundflow?view=browser&refresh=1',
'/api/capital-flow?view=featured&action=archive',
'/api/capital-flow?view=unknown'
];
for(const url of allowed)assert.equal(policy.viewerCanRead({method:'GET',url,headers:{}}),true,url);
for(const url of rejected)assert.equal(policy.viewerCanRead({method:'GET',url,headers:{}}),false,url);
assert.equal(policy.viewerCanRead({method:'POST',url:'/api/quote',headers:{}}),false,'viewer POST denied');
assert.equal(policy.viewerCanRead({method:'GET',url:'/api/quote',headers:{'x-vercel-cron-schedule':'0 14 * * 1-5'}}),false,'cron header cannot grant viewer access');
console.log('v2.7.0.48 viewer read-only allowlist PASS');
