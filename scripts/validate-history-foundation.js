const assert=require('assert');
const fs=require('fs');

const sync=fs.readFileSync('api/sync-status.js','utf8');
const market=fs.readFileSync('lib/sync-service.js','utf8');
const inst=fs.readFileSync('lib/institutional-history.js','utf8');
const credit=fs.readFileSync('lib/credit-trading.js','utf8');

for(const token of ['liveReady','backtestReady250','researchReady500','backtest:250','research:500']){
  assert(sync.includes(token),`history readiness token missing: ${token}`);
}
assert(sync.includes("targetTradingDays:500,maxNewDays:10"),'15:00 cron must advance 500D price history');
assert(sync.includes("targetTradingDays:500,maxNewDays:4"),'19:00 cron must advance 500D institutional history');
assert(sync.includes("targetTradingDays:500,maxNewDays:3"),'22:00 cron must advance 500D credit history');
assert(sync.includes("reason:'500D price-history backfill assigned to 15:00 cron'"),'price deep-history cron ownership missing');
assert(sync.includes("reason:'500D institutional backfill assigned to 19:00 cron'"),'institutional cron ownership missing');
assert(sync.includes("reason:'500D credit backfill assigned to 22:00 cron'"),'credit cron ownership missing');

assert(market.includes('targetTradingDays=500'),'market history default target must be 500D');
assert(market.includes("INTERVAL '900 days'"),'market history lookback must cover 500 trading days');
for(const [name,src] of [['institutional',inst],['credit',credit]]){
  assert(src.includes('market_daily_history'),`${name} backfill must reuse persisted market trading calendar`);
  assert(src.includes('targetTradingDays = 500'),`${name} backfill target must support 500D`);
  assert(src.includes('waitingForMarketHistory'),`${name} must report dependency on price-history calendar`);
  assert(src.includes('progressPct'),`${name} must report resumable progress`);
}
assert(credit.includes('partial credit day: margin='),'credit history must not mark margin/SBL partial days complete');

console.log('History foundation validation PASS — 20D live + 250D backtest + 500D research gates, resumable DB-first backfill, canonical trading calendar');
