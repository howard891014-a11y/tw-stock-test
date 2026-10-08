const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8');
const a=app.indexOf('function fundflowFutureConePath('),b=app.indexOf('function fundflowFutureCenterPath(',a);
assert(a>0&&b>a,'envelope functions present');
const nodes=[];function el(tag,attrs){return {tag,attrs,children:[],append(x){this.children.push(x)}}}
const context={fundflowSvg:el};vm.createContext(context);vm.runInContext(app.slice(a,b),context);
const sx=x=>x*10+300,sy=y=>250-y*10;
const points=[{horizon:5,x:10,y:4,lowX:8,highX:12,lowY:2,highY:6},{horizon:10,x:-9,y:2,lowX:-11,highX:-7,lowY:0,highY:4},{horizon:15,x:11,y:-3,lowX:9,highX:13,lowY:-5,highY:-1},{horizon:20,x:-8,y:5,lowX:-10,highX:-6,lowY:3,highY:7}];
const samples=context.fundflowFutureConePath({x:0,y:0},points,sx,sy,1);
assert(samples.length>30);assert(samples.every(p=>[p.x,p.y,p.rx,p.ry].every(Number.isFinite)&&p.rx>0&&p.ry>0));
const svg=el('svg',{});context.fundflowAppendUnionEnvelope(svg,{x:0,y:0},points,sx,sy,1,'#008866');
assert.equal(svg.children.length,2);assert.equal(svg.children[0].tag,'defs');assert.equal(svg.children[0].children[0].tag,'clipPath');
assert.equal(svg.children[0].children[0].children.length,samples.length);
assert(svg.children[0].children[0].children.every(c=>c.tag==='ellipse'));
assert.equal(svg.children[1].tag,'rect');assert(svg.children[1].attrs['clip-path'].startsWith('url(#fundflow-envelope-'));
const empty=el('svg',{});context.fundflowAppendUnionEnvelope(empty,{x:0,y:0},points,sx,sy,0,'green');assert.equal(empty.children.length,0);
console.log('XY envelope union PASS: sharp turns, reversals, ellipse union and zero-progress');
