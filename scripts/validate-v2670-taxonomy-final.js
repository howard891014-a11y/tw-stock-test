'use strict';
const assert=require('assert');
const tax=require('../lib/market-topic-taxonomy');
const {marketTopicLinks}=tax;
function ids(name,code,raw=[]){return new Set(marketTopicLinks(raw,name,code,{}).map(x=>x.id));}
function has(name,code,id,raw=[]){return ids(name,code,raw).has(id)}
// Final known-company Company_Map is authoritative.
assert(has('威盛','2388','cpu',[{id:'cpu',importance:'core'}]));
assert(has('金麗科','3228','cpu',[{id:'cpu',importance:'core'}]));
assert(!has('創意','3443','gpu',[{id:'gpu',importance:'related'}]));
assert(!has('世芯-KY','3661','gpu',[{id:'gpu',importance:'related'}]));
for(const id of ['gpu','chipset','wafer_manufacturing','consumer_ic','panel_market','thin_client','electronic_components_manufacturing'])assert(!has('未來測試','999999',id,[{id,importance:'core'}]),`${id} is retired from market XY`);
console.log('v2.6.6.13 taxonomy semantic invariants PASS');

// Unknown/future listing aliases follow final merge semantics.
for(const [raw,expected] of [
  ['biomedical_health','medical_device'],['ceramic_substrate','ceramic_substrate'],['nand','memory_ic'],['ssd','ssd'],['pi_film','functional_electronic_material'],['special_metal','steel'],['motor_driver_ic','motor_driver_ic']
])assert(has('語意測試','999999',expected,[{id:raw,importance:'core'}]),`${raw} should resolve as ${expected}`);
console.log('v2.6.6.13 full-market boundary invariants PASS');
