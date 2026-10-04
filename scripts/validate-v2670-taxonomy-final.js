'use strict';
const assert=require('assert');
const {marketTopicLinks}=require('../lib/market-topic-taxonomy');
function ids(name,code,raw=[]){return new Set(marketTopicLinks(raw,name,code,{}).map(x=>x.id));}
function has(name,code,id,raw=[]){return ids(name,code,raw).has(id)}
// CPU: two direct x86/processor designers, not a singleton.
assert(has('威盛','2388','cpu',[{id:'cpu',importance:'core'}]));
assert(has('金麗科','3228','cpu',[{id:'cpu',importance:'core'}]));
// GPU must not misuse ASIC/NRE houses as direct GPU vendors.
assert(!has('創意','3443','gpu',[{id:'gpu',importance:'related'}]));
assert(!has('世芯-KY','3661','gpu',[{id:'gpu',importance:'related'}]));
// Chipset stale distributor/holding/network-controller memberships removed.
for(const [n,c] of [['聯傑','3094'],['鑫聯大投控','3709'],['豐藝','6189']]) assert(!has(n,c,'chipset',[{id:'chipset',importance:'related'}]));
// HDD product line was stale: these are adjacent roles, not HDD makers.
for(const [n,c] of [['光洋科','1785'],['金寶','2312'],['華碩','2357'],['鑫聯大投控','3709']]) assert(!has(n,c,'hard_disk_drive',[{id:'hard_disk_drive',importance:'related'}]));
// Battery module exact false positives.
for(const [n,c] of [['致茂','2360'],['全漢','3015'],['禾伸堂','3026'],['台表科','6278'],['安集','6477'],['聚和','6509'],['鑫聯大投控','3709']]) assert(!has(n,c,'battery_module',[{id:'battery_module',importance:'related'}]));
// Silicon wafer / epitaxy / reclaim roles must not pollute wafer-fab line.
for(const [n,c] of [['台勝科','3532'],['中美晶','5483'],['環球晶','6488'],['嘉晶','3016'],['昇陽半導體','8028']]) assert(!has(n,c,'wafer_manufacturing',[{id:'wafer_manufacturing',importance:'related'}]));
console.log('v2.6.6.10 taxonomy semantic invariants PASS');

for(const [n,c] of [['聲寶','1604'],['錸德','2349'],['鈺德','3050'],['燦星網','4930']]) assert(ids(n,c,[]).size>0,`${c} ${n} must not be zero-tag`);
assert(!has('晶心科','6533','cpu',[{id:'semiconductor_ip',importance:'core'}]));
console.log('v2.6.6.10 full-market boundary invariants PASS');
