'use strict';
const assert=require('node:assert/strict');
const {parseTwse,parseTpex,combine,enrichOfficialInstitutional}=require('../lib/market-institutional-official');
const tw={stat:'OK',date:'20261027',data:[
 ['自營商(自行買賣)','9,007,716,092','8,239,495,006','768,221,086'],
 ['自營商(避險)','35,473,740,121','48,640,735,317','-13,166,995,196'],
 ['投信','38,392,407,004','14,787,900,746','23,604,506,258'],
 ['外資及陸資(不含外資自營商)','514,123,007,104','522,161,880,243','-8,038,873,139'],
 ['外資自營商','0','0','0'],
 ['合計','596,996,870,321','593,830,011,312','3,166,859,009']
]};
const otc=[
 {Date:'1151027',Investor:'外資及陸資合計',PurchaseAmount:'72533938852',SaleAmount:'70187491470',Net:'2346447382'},
 {Date:'1151027',Investor:'投信',PurchaseAmount:'6171809852',SaleAmount:'3499542234',Net:'2672267618'},
 {Date:'1151027',Investor:'自營商合計',PurchaseAmount:'4792600150',SaleAmount:'4631563840',Net:'161036310'},
 {Date:'1151027',Investor:'三大法人合計*',PurchaseAmount:'83498348854',SaleAmount:'78318597544',Net:'5179751310'}
];
const tpexHistory={tables:[{date:'115/10/27',data:otc.map(r=>[r.Investor,r.PurchaseAmount,r.SaleAmount,r.Net])}]};
const date='2026-10-27';
const listed=parseTwse(tw,date),otcParsed=parseTpex(otc,date);
assert.equal(listed.foreign,-8038873139);
assert.equal(listed.trust,23604506258);
assert.equal(listed.dealer,-12398774110);
assert.equal(listed.total,3166859009);
assert.equal(otcParsed.foreign,2346447382);
assert.equal(otcParsed.trust,2672267618);
assert.equal(otcParsed.dealer,161036310);
assert.deepEqual(parseTpex(tpexHistory,date),otcParsed);
assert.equal(parseTpex(otc,'2026-10-22'),null);
assert.equal(parseTwse(tw,'2026-10-22'),null);
const all=combine(date,listed,otcParsed);
assert.equal(all.total,8346610319);
assert.equal(all.foreign,-5692425757);
assert.equal(all.trust,26276773876);
assert.equal(all.dealer,-12237737800);
const previous={history:[{date,officialInstitutional:all}]};
const failedFetch=async()=>{throw Error('network unavailable')};
const fresh={ok:true,history:[{date,foreignValue:99999999,institutionalComplete:true}],latest:{date},w3:{modelVersion:'W3-D.1.2',regime:'RiskOff'}};
(async()=>{
 await enrichOfficialInstitutional(fresh,previous,{fetchFn:failedFetch,backfillMaxDays:1});
 assert.equal(fresh.latest.officialInstitutional.total,8346610319,'network outage must retain dated last verified official amount');
 assert.equal(fresh.latest.foreignValue,99999999,'existing W3/internal estimated field must not mutate');
 assert.equal(fresh.w3.modelVersion,'W3-D.1.2');
 const raw={ok:true,history:[{date,foreignValue:88888888,institutionalComplete:true}],latest:{date}};
 const mockFetch=async url=>({ok:true,json:async()=>url.includes('BFI82U')?tw:tpexHistory});
 await enrichOfficialInstitutional(raw,null,{fetchFn:mockFetch});
 assert.equal(raw.latest.officialInstitutional.foreign,-5692425757);
 assert.equal(raw.latest.officialInstitutional.total,8346610319);
 assert.equal(raw.latest.foreignValue,88888888);
 const noValue={ok:true,history:[{date:'2026-10-22',foreignValue:99999999,institutionalComplete:true}],latest:{date:'2026-10-22'}};
 await enrichOfficialInstitutional(noValue,null,{fetchFn:mockFetch});
 assert.equal(noValue.latest.officialInstitutional,null,'wrong report dates must not be passed off as newer official date');
 assert.equal(noValue.institutionalOfficial.complete,false);
 console.log('PASS v2.6.9.8 official institutional values, date/total guards, outages, W3 isolation');
})().catch(e=>{console.error(e);process.exit(1)});
