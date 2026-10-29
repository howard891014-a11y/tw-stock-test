'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.join(__dirname,'..');
const lab=fs.readFileSync(path.join(root,'lib/resonance-lab-v1.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const pkg=require(path.join(root,'package.json'));
assert.equal(pkg.version,'2.7.0.7');
for (const v of ['stockzone-version" content="2.7.0.7','v2.7.0.7</span></button>','resonance-lab-v1.js?v=2.7.0.7','app.js?v=2.7.0.7']) assert(html.includes(v),v);
const start=lab.indexOf('    function render(){\n      const card='),end=lab.indexOf('    function ensurePanel(card){',start);
assert(start>0&&end>start);
const render=lab.slice(start,end);
// Both peer columns use <small> for labels and <strong> for values.
assert(render.includes('<small>建議玩法</small><strong>${esc(play)}</strong>'));
assert(render.includes('<small>持倉建議</small>${pos}'));
assert(render.includes('<strong class="szs-allocation">'));
assert(!render.includes('<small>原始配置</small>'),'third line must not shift the second value down');
assert(!render.includes('等待進場條件'));
const css=lab.slice(lab.indexOf('    const css=`',end),lab.indexOf('    function addDeveloperTools(){',end));
for(const rule of [
  '.szs-pair>div>strong{display:block;margin:0;font-size:21px;line-height:1.35;font-weight:800;color:#1673e4}',
  '.szs-pair .szs-allocation{display:flex;align-items:baseline;flex-wrap:nowrap;',
  '.szs-allocation b{font-size:inherit;line-height:inherit;font-weight:inherit;color:inherit}',
  '.szs-target{min-width:0;padding:0 7px;text-align:center}',
  '.szs-target small{display:block;text-align:center',
  '.szs-target strong{display:block;text-align:center',
  'grid-template-columns:minmax(90px,24%) minmax(0,1fr)',
  'grid-template-columns:minmax(82px,27%) minmax(0,1fr)'
]) assert(css.includes(rule),`missing CSS uniformity: ${rule}`);
assert(!css.includes('.szs-pair .szs-allocation{padding:2px'),'old offset no longer applies');
require('./validate-v2706-playstyle-auto');
console.log('v2.7.0.7 PASS: paired typography and baseline, centered target cells, wider table description column');
