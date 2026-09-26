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
assert(app.includes('min/500*100'),'progress bars must use the slower of listed/OTC histories against 500D');
console.log('Settings history progress validation PASS — progress is settings-only and reads unified 20/250/500D health');
