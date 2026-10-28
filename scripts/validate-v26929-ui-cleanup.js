'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert').strict;
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const lib=fs.readFileSync(path.join(root,'lib/resonance-lab-v1.js'),'utf8');
const pkg=require(path.join(root,'package.json'));
assert.equal(pkg.version,'2.6.9.29');
assert.match(html,/v2\.6\.9\.29<\/span>/);
assert.match(html,/app\.js\?v=2\.6\.9\.29/);
assert.match(html,/resonance-lab-v1\.js\?v=2\.6\.9\.29/);
// 1. simulation title ONLY.
const sim=html.match(/<article class="card detail-panel simple-detail" data-view-panel="simulation" id="szSimulationLedgerPage">([\s\S]*?)<\/article>/);
assert.ok(sim,'sim page retained');assert.match(sim[1],/>模擬交易<\/span>/);
for(const s of ['交易績效','szSimulationSummary','szSimManageHoldings','szSimCsvExport','szSimJsonExport','szSimBackupStatus','szSimulationRows','本機人工成交紀錄']) assert.ok(!sim[1].includes(s),s);
// 2. headings.
assert.ok(!html.includes('預計上漲空間'));assert.ok(!html.includes('正常下跌空間'));
assert.match(html,/<em>上漲空間<\/em>/);assert.match(html,/<em>下跌空間<\/em>/);
// 3. read the real current projection function and verify negative ranges are displayed near -> far.
const begin=app.indexOf('function sz918ExpectedSpaces('),end=app.indexOf('\nfunction renderExpectedUpside(',begin);
assert.ok(begin>0 && end>begin);
const func=app.slice(begin,end);
const context={positionNumber:n=>Number.isFinite(Number(n))?Number(n):null,
  positionReturn:(target,p)=>((target/p)-1)*100,
  signedPercent:n=>`${n>=0?'+':''}${n.toFixed(1)}%`};
vm.createContext(context);vm.runInContext(func,context);
const r=context.sz918ExpectedSpaces(100,{levels:[{value:110},{value:130}]},{levels:[{value:95},{value:60}]});
assert.equal(r.downRange,'-5.0% ～ -40.0%');assert.equal(r.upRange,'+10.0% ～ +30.0%');
// 4,5,6. price dot without bubble, shifted "now" line and taller canvas.
assert.match(html,/overviewResonanceSvg" viewBox="0 0 760 486"/);
assert.match(html,/aspect-ratio:760\/486!important/);
assert.match(app,/historyRight=565,divider=571,rightGrid=703,top=47,bottom=431,futureX=671/);
assert.match(app,/point\(historyRight,price,'#8798ad',6\)/);
assert.doesNotMatch(app,/add\(\{title:'現價'/);
// 7. remove R8.2 source foot, preserve S/R legend.
assert.ok(!app.includes('R8.2 日K估算｜資料'));
assert.match(app,/for\(const key of \['S1','S2','R1','R2'\]\)/);
// 8. remove requested narration from UI source, preserve historical-rate display.
for(const [name,data] of [['index',html],['app',app],['lab',lib]]) {
 for(const s of ['加入持股不等於建立交易計畫','研究假設，尚未完成樣本外驗證；不自動下單。','依目前可取得資料分析；加入持股','上漲空間＝現行主要','上／下空間只取目前共振','長期相似樣本只有歷史價格結構'])assert.ok(!data.includes(s),name+': '+s);
}
assert.ok(!html.includes('id="expectedBasisNote"'));
assert.ok(!html.includes('id="expectedFoot"'));
assert.ok(html.includes('id="expectedWinRate"') && html.includes('id="expectedProfitRate"'));
// 9. no add-holding button in play analysis, independent holdings list not modified.
assert.ok(!lib.includes('id="szSimpleAdd"'));
assert.ok(!lib.includes("$('szSimpleAdd')"));
assert.ok(html.includes('id="addHoldingBtn"'));
console.log('PASS v2.6.9.29: 9 user UI requests, downside order, chart geometry, title-only simulation, intact win-rate metrics');
