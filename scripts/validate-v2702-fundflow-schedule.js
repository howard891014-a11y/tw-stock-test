'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {CRON_STAGES,runScheduledFundflow}=require('../lib/market-fundflow-schedule');
async function main(){
 const vc=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
 const actual=vc.crons.filter(c=>c.path==='/api/capital-flow').map(x=>x.schedule).sort();
 assert.deepEqual(actual,Object.keys(CRON_STAGES).sort());
 assert.equal(vc.crons.some(c=>c.schedule==='8 8 * * 1-5'&&c.path==='/api/capital-flow'),false,'old 16:08 must be removed');
 assert.ok(vc.crons.length<=100);
 for(const c of vc.crons)assert.match(c.schedule,/^\d{1,2} \d{1,2} \* \* 1-5$/,'Hobby: cron must run at most daily');
 const fundSrc=fs.readFileSync(path.join(root,'lib/fundflow-xy.js'),'utf8');
 assert.ok(fundSrc.includes('MIN(tags)::int AS min_daily_tags'));
 assert.ok(fundSrc.includes('latestTags===203'));
 assert.ok(fundSrc.includes('invalidDates===0'));
 assert.ok(!fundSrc.includes('ready:dates>=target&&currentDates===dates'),'as-recorded 202-tag days must not block current date');
 const header=fs.readFileSync(path.join(root,'api/capital-flow.js'),'utf8');
 assert.ok(header.includes('isCronAuthorized(req)'));
 assert.ok(header.includes('runScheduledFundflow'));
 const calls=[];
 const sql={query:async (q,args)=>{calls.push({q,args});if(q.includes('MAX(trade_date)::text AS date'))return[{date:'2026-10-28'}];if(q.includes('COUNT(*)::int AS rows FROM market_business_xy2_snapshot'))return[{rows:6}];if(q.includes('COUNT(*)::int AS rows FROM market_capital_flow_money_daily'))return[{rows:200}];return[];}};
 const today=new Date('2026-10-28T14:00:00.000Z'); // 22:00 Taipei
 const marketGate=async()=>({state:'ready',gate:{sourceDate:'2026-10-28'}});
 const healthy=await runScheduledFundflow({schedule:'15 13 * * 1-5',sql,now:today,marketGate,buildXY:async()=>({ok:true,after:{asOf:'2026-10-28'},skipped:false})});
 assert.equal(healthy.ok,true);
 const noWrite=await runScheduledFundflow({schedule:'55 13 * * 1-5',sql,now:today,marketGate});
 assert.equal(noWrite.ok,true);assert.equal(noWrite.reason,'money-already-current');
 assert.equal(calls.filter(x=>x.q.includes('INSERT INTO sync_status')).length,2);
 const fallback=await runScheduledFundflow({schedule:'15 13 * * 1-5',sql,now:today,marketGate,buildXY:async()=>({ok:false,reason:'not-ready',before:{asOf:'2026-10-27'}})});
 assert.equal(fallback.ok,false);assert.equal(fallback.asOf,'2026-10-27');
 const holiday=await runScheduledFundflow({schedule:'35 13 * * 1-5',sql,now:today,marketGate:async()=>({state:'closed',gate:{sourceDate:'2026-10-27'}})});
 assert.equal(holiday.ok,true);assert.equal(holiday.reason,'closed-market');
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.ok(html.includes('21:15／21:30／21:50'));assert.ok(html.includes('21:35／21:55'));assert.ok(html.includes('Hobby 排程'));
 assert.ok(html.includes('v2.7.0.2'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'2.7.0.2');
 console.log('PASS v2.7.0.2: scheduled slots, no 16:08, protected crons, XY historical gate, idempotent money, holiday, settings, version');
}
main().catch(e=>{console.error(e);process.exitCode=1});
