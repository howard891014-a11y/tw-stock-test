const assert=require('assert');
const fs=require('fs');
const {STORAGE_POLICY}=require('../lib/storage-policy');

const sync=fs.readFileSync('api/sync-status.js','utf8');
const market=fs.readFileSync('lib/sync-service.js','utf8');
const inst=fs.readFileSync('lib/institutional-history.js','utf8');
const credit=fs.readFileSync('lib/credit-trading.js','utf8');

assert.equal(STORAGE_POLICY.raw.price,120);
assert.equal(STORAGE_POLICY.raw.institutional,120);
assert.equal(STORAGE_POLICY.raw.credit,90);
assert.equal(STORAGE_POLICY.raw.activity,80);
assert.equal(STORAGE_POLICY.compact.topicResearch,250);
for(const token of ['liveReady','coreRawReady','researchReady250','researchCompactHistory','STORAGE_POLICY.raw.price','STORAGE_POLICY.raw.institutional','STORAGE_POLICY.raw.credit']){
  assert(sync.includes(token),`history/storage token missing: ${token}`);
}
assert(sync.includes('warmCurrentEngineFromStoredDb({sql:getSql(),force:false})'),'22:00 cron must persist daily compact research history');
assert(sync.includes('runStorageMaintenance({sql:getSql()})'),'15:00 cron must enforce bounded retention');
assert(!sync.includes('targetTradingDays:500'),'scheduled raw backfill must not target 500D');
assert(market.includes('targetTradingDays=STORAGE_POLICY.raw.price'),'market history default must follow 120D storage policy');
assert(market.includes("INTERVAL '320 days'"),'market history lookback must be bounded but comfortably cover 120 trading days');
assert(inst.includes('targetTradingDays = STORAGE_POLICY.raw.institutional'),'institutional default must follow storage policy');
assert(credit.includes('targetTradingDays = STORAGE_POLICY.raw.credit'),'credit default must follow storage policy');
for(const [name,src] of [['institutional',inst],['credit',credit]]){
  assert(src.includes('market_daily_history'),`${name} backfill must reuse persisted market trading calendar`);
  assert(src.includes('waitingForMarketHistory'),`${name} must report dependency on price-history calendar`);
  assert(src.includes('progressPct'),`${name} must report resumable progress`);
}
assert(credit.includes('partial credit day: margin='),'credit history must not mark margin/SBL partial days complete');
assert(sync.includes('concurrency:3'),'institutional backfill concurrency missing');
assert(sync.includes('concurrency:2'),'credit backfill concurrency missing');
console.log('History foundation validation PASS — 20D live + bounded 120/120/90D raw + 250D compact research');
