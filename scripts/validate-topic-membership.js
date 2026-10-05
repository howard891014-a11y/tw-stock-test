'use strict';
const assert=require('node:assert/strict');
const tax=require('../lib/market-topic-taxonomy');
const freeze=tax.finalTaxonomyFreeze;

function links(code){return freeze.companyTopicLinks(code)||[];}
function has(code,id,role=null){const x=links(code).find(t=>t.id===id);return Boolean(x&&(!role||x.importance===role));}
function members(id){return Object.entries(freeze.COMPANY_TOPICS).filter(([,pairs])=>pairs.some(([tag])=>tag===id)).map(([code])=>code);}

assert.equal(members('glass_substrate').length,15,'final glass substrate supply chain count');
assert(has('3037','glass_substrate','related'));
assert(has('4958','glass_substrate','related'));
assert(!has('8046','glass_substrate'),'南電 is not in final glass-substrate line');
assert.equal(members('foplp').length,17,'final FOPLP count');
assert.equal(members('copos').length,19,'final CoPoS count');
assert(has('6187','copos','related'));
assert(has('2467','copos','related'));
assert(has('2330','copos','related'));
assert(has('6415','pmic','core'));
assert(has('6415','led_driver_ic','related'));
assert(has('7769','cpo_silicon_photonics'));
assert(has('3017','thermal'));
for(const code of ['1516','3054','4564','6538','8932','9950'])assert.equal(links(code).length,0,`${code} strict no-tag`);
console.log('Priority final Company_Map membership validation PASS');
