const assert=require('assert');
const fs=require('fs');
const mod=require('../lib/institutional-history');
const t=mod._test;

const twseFields=[
  '證券代號','證券名稱','外陸資買進股數(不含外資自營商)','外陸資賣出股數(不含外資自營商)',
  '外陸資買賣超股數(不含外資自營商)','外資自營商買進股數','外資自營商賣出股數','外資自營商買賣超股數',
  '投信買進股數','投信賣出股數','投信買賣超股數','自營商買賣超股數',
  '自營商買進股數(自行買賣)','自營商賣出股數(自行買賣)','自營商買賣超股數(自行買賣)',
  '自營商買進股數(避險)','自營商賣出股數(避險)','自營商買賣超股數(避險)','三大法人買賣超股數'
];
const twse=t.parseTwseAll({stat:'OK',date:'20260924',fields:twseFields,data:[
  ['6187','萬潤','0','0','12,000','0','0','1,000','0','0','3,000','-2,000','0','0','-500','0','0','-1,500','13,000']
]},'2026-09-24');
assert.equal(twse.length,1);
assert.equal(twse[0].code,'6187');
assert.equal(twse[0].foreign,12000);
assert.equal(twse[0].trust,3000);
assert.equal(twse[0].dealer,-2000);
assert.equal(twse[0].total,13000);
assert.equal(twse[0].market,'上市');

const tpexRow=Array(24).fill('0');
tpexRow[0]='3105'; tpexRow[1]='穩懋'; tpexRow[4]='2,000'; tpexRow[7]='100'; tpexRow[13]='-500';
tpexRow[16]='300'; tpexRow[19]='-200'; tpexRow[22]='100'; tpexRow[23]='1,600';
const tpex=t.parseTpexModernAll({tables:[{date:'115/09/24',data:[tpexRow]}]},'2026-09-24');
assert.equal(tpex.length,1);
assert.equal(tpex[0].code,'3105');
assert.equal(tpex[0].foreign,2000);
assert.equal(tpex[0].trust,-500);
assert.equal(tpex[0].dealer,100);
assert.equal(tpex[0].total,1600);
assert.equal(tpex[0].market,'上櫃');

assert.equal(t.ymdToIso('20260924'),'2026-09-24');
assert.equal(t.rocToIso('115/09/24'),'2026-09-24');
assert.equal(t.cleanCode('6187.TW'),'6187');

const api=fs.readFileSync('api/institutional.js','utf8');
const sync=fs.readFileSync('api/sync-status.js','utf8');
for(const token of ['readInstitutionalForStock','institutionalHistoryIsFresh','upsertInstitutionalRows','storage: freshness.persisted']){
  assert(api.includes(token),`missing API DB-first token: ${token}`);
}
for(const token of ['runInstitutionalSync','runInstitutionalBackfill',"action==='institutional'","action==='institutional-backfill'"]){
  assert(sync.includes(token),`missing sync token: ${token}`);
}
console.log('Institutional history validation PASS — TWSE/TPEx parsers + DB-first route + sync actions present');
