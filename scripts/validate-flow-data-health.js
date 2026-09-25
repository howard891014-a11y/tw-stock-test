const assert=require('assert');
const fs=require('fs');
const institutional=require('../lib/institutional-history');
const credit=require('../lib/credit-trading');

assert.equal(typeof institutional.readInstitutionalHistoryHealth,'function','institutional health reader missing');
assert.equal(typeof credit.readCreditTradingHealth,'function','credit health reader missing');

const sync=fs.readFileSync('api/sync-status.js','utf8');
for(const token of [
  'readFlowDataHealth',
  "view==='flow-data-health'",
  'readyForAX',
  'expectedTradeDate',
  'institutionalBackfill=await runInstitutionalBackfill',
  'creditBackfill=await runCreditTradingBackfill',
  'flowDataHealth'
]) assert(sync.includes(token),`missing flow-data-health token: ${token}`);

const institutionalLib=fs.readFileSync('lib/institutional-history.js','utf8');
const creditLib=fs.readFileSync('lib/credit-trading.js','utf8');
for(const [name,src] of [['institutional',institutionalLib],['credit',creditLib]]){
  assert(src.includes('latest_rows'),`${name} health must expose latest_rows`);
  assert(src.includes('tradingDays'),`${name} health must expose tradingDays`);
  assert(src.includes('maxDate'),`${name} health must expose maxDate`);
}

console.log('Flow data health validation PASS — symmetric cron backfill + freshness/history diagnostics + A-X readiness gate present');
