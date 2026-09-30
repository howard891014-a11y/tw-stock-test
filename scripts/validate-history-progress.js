const assert=require('assert');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('app.js','utf8');
for(const id of ['historyProgressUpdated','historyPriceBar','historyPriceValue','historyInstitutionalBar','historyInstitutionalValue','historyCreditBar','historyCreditValue','historyLiveReady','historyBacktestReady','historyResearchReady','historyProgressNote']){
  assert(html.includes(`id="${id}"`),`settings history progress missing ${id}`);
}
assert(html.includes('settings-history'),'history progress must live inside Settings');
assert(!html.includes('overview-history-progress'),'history progress must not be added to main layout');
assert(app.includes('/api/sync-status?view=flow-data-health'),'settings progress must read unified health endpoint');
assert(app.includes('loadHistoryProgress(false)'),'opening Settings must load progress');
assert(app.includes('targetMap={price:Number(targets.priceRaw||120),institutional:Number(targets.institutionalRaw||120),credit:Number(targets.creditRaw||90)}'),'progress bars must use per-layer bounded raw targets');
assert(html.includes('250D Research'),'settings must show 250D research target');
assert(!html.includes('500D Research'),'500D raw research label must be retired');
console.log('Settings history progress validation PASS — progress reflects bounded raw targets + 250D compact research');
