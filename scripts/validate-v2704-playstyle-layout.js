'use strict';
// v2.7.0.4: data-independent UI regression for the single play-style information card.
const fs=require('fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const lab=fs.readFileSync('lib/resonance-lab-v1.js','utf8');
const pkg=require('../package.json');
const initial='<span class="badge szs-status-badge szs-notheld" id="szPlayHoldingBadge" aria-label="持股狀態：尚未持有">尚未持有</span>';
assert.equal(pkg.version,'2.7.0.4');
assert.equal((html.match(/id="szPlayHoldingBadge"/g)||[]).length,1,'exactly one play status badge');
assert(html.includes(initial),'status badge starts at old V4.3.1 position');
assert(!html.includes('<span class="badge">V4.3.1</span>'),'old version badge gone');
assert(html.includes('<span>玩法分析</span></span>'),'card heading preserved');
assert(html.includes('v2.7.0.4</span></button>'),'sidebar version updated');
assert(html.includes('app.js?v=2.7.0.4')&&html.includes('resonance-lab-v1.js?v=2.7.0.4'));
const renderStart=lab.indexOf('    function render(){\n      const card=$(\'playStyleCard\'),code=getCode();if(!card)return;');
const renderEnd=lab.indexOf('    function ensurePanel(card){',renderStart);
assert(renderStart>0&&renderEnd>renderStart,'locate real shipped render function');
const renderSource=lab.slice(renderStart,renderEnd);
assert(!renderSource.includes("preview('試單比例'"),'trial percentage row removed from template');
assert(!renderSource.includes('class="szs-heading"'),'redundant operation heading removed');
const style=lab.slice(lab.indexOf('    const css=`',renderEnd),lab.indexOf('    function addDeveloperTools(){',renderEnd));
for(const rule of ['#szSimpleTrade .szs-pair','#szSimpleTrade .szs-allocation','#szSimpleTrade .szs-targets','#szSimpleTrade .szs-recent-row','#playStyleCard .szs-status-badge','@media(max-width:720px)']){
  assert(style.includes(rule),`required responsive styling: ${rule}`);
}
const badge={textContent:'尚未持有',classMap:{},attrs:{},classList:{toggle(k,value){badge.classMap[k]=value}},setAttribute(k,v){badge.attrs[k]=v}};
const panel={dataset:{},innerHTML:''};
const card={};let code='6187',holding=null,active=null,ready=true;
let data={play:'長波',allocation:{core:65,tactical:35},signal:'等待分析結果',risk:'風險資料尚未完整',
    targets:{main:1488.53,secondary:1801.77,defense:1286.82},recent:'短期',
    timing:{valid:true,mode:'短期',trial:{action:'觀望',probePct:0,entryTiming:'等待收盤重新站上 MA10',replenishTiming:'站回 MA10 並確認量價',stopTiming:'跌破研究防守位'}}};
const context={
 $:id=>id==='playStyleCard'?card:id==='szPlayHoldingBadge'?badge:id==='szSimpleManage'?{addEventListener(){}}:null,
 getCode:()=>code, ensurePanel:()=>panel, analysis:()=>data,
 holdingFor:()=>holding,records:()=>active?{[code]:{active}}:{},dataReady:()=>ready,
 esc:x=>String(x),numberLabel:x=>Number(x).toLocaleString('en-US',{maximumFractionDigits:2}),doc:{querySelector:()=>null},
};
vm.createContext(context);
vm.runInContext(renderSource+'\nthis.testRender=render;',context);
context.testRender();
assert.equal(badge.textContent,'尚未持有');
assert.equal(badge.attrs['aria-label'],'持股狀態：尚未持有');
assert.match(panel.innerHTML,/建議玩法/);
assert.match(panel.innerHTML,/長波/);
assert.match(panel.innerHTML,/核心 <b>65%<\/b>/);
assert.match(panel.innerHTML,/機動 <b>35%<\/b>/);
assert.match(panel.innerHTML,/1,488.53/);
assert.match(panel.innerHTML,/1,801.77/);
assert.match(panel.innerHTML,/1,286.82/);
assert.match(panel.innerHTML,/近期條件：/);
assert.match(panel.innerHTML,/近期玩法研究/);
assert.match(panel.innerHTML,/近期適合模式/);
assert.match(panel.innerHTML,/是否試單/);
assert.match(panel.innerHTML,/試單時機/);
assert.match(panel.innerHTML,/補倉時機/);
assert.match(panel.innerHTML,/停損時機/);
assert(!panel.innerHTML.includes('試單比例'),'trial percentage row must never appear');
assert(!panel.innerHTML.includes('研究值'),'trial pct research value hidden');
assert(!panel.innerHTML.includes('szs-heading'),'no duplicate operation heading');
assert(!panel.innerHTML.includes('V4.3.1'),'no version in operation card');
// Merely adding to a list (without an explicit trade plan) updates both badge and action buttons.
holding={avgCost:1220,shares:250};context.testRender();
assert.equal(badge.textContent,'清單中・未建計畫');
assert.match(panel.innerHTML,/查看持股清單/);
assert.equal(badge.classMap['szs-listed'],true);
active={explicitPlan:true,status:'open',initial:{play:'長期',allocation:{core:80,tactical:20}}};
context.testRender();
assert.equal(badge.textContent,'交易計畫中');
assert.equal(badge.classMap['szs-held'],true);
assert.match(panel.innerHTML,/核心 <b>80%<\/b>/);
assert.match(panel.innerHTML,/長期/);
assert.match(panel.innerHTML,/持有期間建議/);
assert(!panel.innerHTML.includes('試單比例'));
// Removing the plan and holding reverts the badge, without leaking the previous stock state.
active=null;holding=null;context.testRender();
assert.equal(badge.textContent,'尚未持有');
code='';context.testRender();
assert.equal(badge.textContent,'尚未持有');
assert.match(panel.innerHTML,/搜尋股票後/);
console.log('v2.7.0.4 play-style UI PASS: layout, holding badge transitions, trial row removed, main calculations untouched');
