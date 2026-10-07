const assert=require('assert');const d=require('../lib/dw4');
assert.equal(d.DW4_VERSION,'dw4-final-2026-10-07');assert.equal(d.X_ALPHA,10);assert.equal(d.Y_ALPHA,3);assert.equal(d.X_UNIT,150);assert.equal(d.Y_UNIT,.9);
assert.equal(d.direction(150,0),'向右');assert.equal(d.direction(150,.9),'右上');assert.equal(d.direction(0,.9),'向上');assert.equal(d.direction(-150,0),'向左');assert.equal(d.regime('2026-06-26'),1);assert.equal(d.regime('2026-06-29'),-1);assert.equal(d.regime('2026-07-31'),1);
const rows=[];for(let i=0;i<40;i++)rows.push({x:i,target:2*i+3});const m=d.ridgeFit(rows,['x'],'target',0);assert(m);assert(Math.abs(d.predict(m,{x:10})-23)<1e-6);
console.log('dW4 Final validation passed');
