const assert=require('node:assert/strict');
const fs=require('fs');
const src=f=>fs.readFileSync(f,'utf8');
const app=src('app.js'),quote=src('api/quote.js'),market=src('lib/market-dynamic.js');
const cron=src('api/market-dynamic-refresh.js'),cfg=JSON.parse(src('vercel.json'));
assert(app.includes('allowHolidayMark&&c.minutes>=10*60')); // 09:05 -> 10:00 only
assert(app.includes('phase.minutes<9*60+5')); // watchlists stay at 09:05
assert(app.includes('window.addEventListener("pageshow"'));
assert(app.includes('window.addEventListener("focus"'));
assert(app.includes('報價延遲 ${Math.floor(age/60000)} 分鐘'));
assert(quote.includes('const rawChange=!chartIsNewer?toNumber(meta.regularMarketChange):null'));
assert(quote.includes('const changeSource=rawChange!==null&&rawPct!==null?'));
assert(!quote.includes('if(m?.previousClose)result=rebaseQuotePreviousClose'));
assert(market.includes('const w3Replay=computeW3D112(inputs)')); // original unchanged formula
assert(market.includes('getMarketDynamicCached'));
assert(market.includes('readMarketSnapshot(sql)'));
assert(market.includes('writeMarketSnapshot(getSql(),data)'));
assert(cron.includes('refreshMarketSnapshot()'));
assert.strictEqual(fs.readdirSync('api').filter(x=>x.endsWith('.js')).length,12,'Hobby plan API Functions limit');
assert(!fs.existsSync('api/market-dynamic-refresh-retry.js'));
assert(!cfg.functions['api/market-dynamic-refresh-retry.js']);
assert.deepStrictEqual(cfg.crons.filter(x=>x.path==='/api/market-dynamic-refresh').map(x=>x.schedule),['50 14 * * 1-5','35 15 * * 1-5']);
assert(cfg.crons.some(x=>x.schedule==='50 14 * * 1-5'));
assert(cfg.crons.some(x=>x.schedule==='35 15 * * 1-5'));
assert(!cfg.crons.some(x=>x.schedule==='5 9 * * 1-5'));
assert(app.includes('disposalSummaryDetails'));
assert(app.includes('資料待補｜前次有效日'));
console.log('PASS v2.6.8.4 structural checks including <=12 Vercel API functions');
