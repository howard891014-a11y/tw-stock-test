const assert=require('assert');
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('app.js','utf8');
for(const id of ['historyProgressUpdated','historyPriceBar','historyPriceValue','historyInstitutionalBar','historyInstitutionalValue','historyCreditBar','historyCreditValue','historyLiveReady','historyBacktestReady','historyResearchReady','historyProgressNote']){
  assert(html.includes(`id="${id}"`),`settings history progress missing ${id}`);
}
assert(html.includes('settings-history'),'history progress must live inside Settings');
assert(!html.includes('overview-history-progress'),'history progress must not be added to main layout');
assert(app.includes("getJsonWithin('history-raw-progress')"),'raw history must use lightweight independent endpoint');
assert(app.includes("getJsonWithin('research-500d-progress')"),'500D progress must use independent endpoint');
assert(app.includes('Promise.allSettled([rawPromise,researchPromise])'),'one progress failure must not cancel the other');
assert(app.includes('loadHistoryProgress(false)'),'opening Settings must load progress');
assert(app.includes('targetMap={price:Number(targets.priceRaw||120),institutional:Number(targets.institutionalRaw||120),credit:Number(targets.creditRaw||90)}'),'progress bars must use per-layer bounded raw targets');
assert(html.includes('500D Research'),'settings must show 500D compact research target');
assert(!html.includes('250D Research'),'old 250D research label must be retired');
console.log('Settings history progress validation PASS — progress reflects bounded raw targets + 500D compact research');
