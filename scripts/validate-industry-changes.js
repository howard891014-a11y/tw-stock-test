'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
// Stub the DB and sync-service *only in this pure unit test* so the test never contacts Neon.
const root=path.resolve(__dirname,'..');
const mock=(name,exports)=>{const p=require.resolve(name);require.cache[p]={id:p,filename:p,loaded:true,exports};};
mock('../lib/db',{getSql(){throw new Error('unit tests must NEVER connect Neon');}});
mock('../lib/sync-service',{_test:{companyProfileRows(){throw new Error('not used');}}});
const moduleUnderTest=require('../lib/industry-change-monitor');
const actionMonitor=require('../lib/company-action-monitor');
const mon=moduleUnderTest._test;
const date='2026-10-23';
const c=(code,name,market,industry='電機機械',business='原有產品')=>({stock_code:code,stock_name:name,market,industry,industry_code:'01',main_business:business});
const a=mon.normalize([c('1234','測試A','上市'),c('5678','測試B','上櫃')],new Map([['1234',{main_business:'原有產品'}],['5678',{main_business:'產品B'}]]));
const first=mon.detect(null,a,date);
assert.equal(first.initial,true);assert.equal(first.events.length,0,'first scan baseline cannot show all companies as new');
const b=mon.normalize([c('1234','測試A公司','上櫃','半導體業','新增產品'),c('5678','測試B','上櫃'),c('9012','測試C','上市')],new Map([['1234',{main_business:'新增產品'}],['5678',{main_business:'產品B'}]]));
const diff=mon.detect({stocks:a},b,date);
assert.deepEqual(diff.events.map(x=>x.event).sort(),['business','industry','listing','market','name'].sort());
assert(diff.events.every(x=>x.role==='待驗證'));
assert(diff.events.every(x=>/^[a-f0-9]{24}$/.test(x.id)));
const unchanged=mon.detect({stocks:b},b,date);assert.equal(unchanged.events.length,0,'same input must have no duplicate changes');
const missing=mon.normalize([c('1234','測試A公司','上櫃'),c('9012','測試C','上市')]);
const miss1=mon.detect({stocks:b},missing,date);assert.equal(miss1.events.filter(x=>x.event==='missing').length,0,'one missing feed cannot be delisting');
const miss2=mon.detect({stocks:miss1.stocks},missing,date);assert.equal(miss2.events.filter(x=>x.event==='missing').length,1,'two successful checks yield only suspected delisting');
const miss3=mon.detect({stocks:miss2.stocks},missing,date);assert.equal(miss3.events.filter(x=>x.event==='missing').length,0,'do not repeat missing event');
assert.throws(()=>mon.normalize([c('1234','A','上市'),c('1234','B','上櫃')]),/重複/);
const js=fs.readFileSync(path.join(root,'app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const monitorSrc=fs.readFileSync(path.join(root,'lib/industry-change-monitor.js'),'utf8');
const xy=fs.readFileSync(path.join(root,'lib/fundflow-xy.js'),'utf8');
assert(html.includes('已／未導入')&&html.includes('industryChangeRows'),'developer UI must include 7 columns');
assert(!html.includes('id="industryChangeLogin"'),'no special management-key button inside industry changes');
assert(!js.includes('szIndustryChangeSecret')&&!js.includes('szIndustryToken('),'no stand-alone industry management password prompt');
const candidateApi=require('../lib/industry-change-api');
assert(candidateApi._test.sameOriginBrowserPost({headers:{host:'example.vercel.app',origin:'https://example.vercel.app','sec-fetch-site':'same-origin'}}),'same-origin browser POST accepted');
assert(!candidateApi._test.sameOriginBrowserPost({headers:{host:'example.vercel.app',origin:'https://evil.example','sec-fetch-site':'cross-site'}}),'cross-site POST rejected');
assert(!candidateApi._test.sameOriginBrowserPost({headers:{host:'example.vercel.app'}}),'non-browser mutation without origin refused');
assert(js.includes('if(row.imported){const button=document.createElement(\'button\')'),'only imported candidates get delete X');
assert(monitorSrc.includes("if(!e.imported)throw new Error('未導入紀錄禁止刪除')"),'server must enforce no-delete');
assert(monitorSrc.includes('FROM market_taxonomy_release'),'cannot auto-confirm without verified release');
assert(monitorSrc.includes('NEVER writes to Neon'),'monitor cannot write Neon');
assert(xy.includes('Security boundary: automated XY/cron/restore paths may NEVER write approved taxonomy'));
assert(!xy.includes('DELETE FROM market_business_xy2_member'),'no engine step can wipe approved members');
assert(!xy.includes('ON CONFLICT (tag_id,stock_code,market) DO UPDATE'),'no engine taxonomy write');
async function scanSmoke(){
  let current=null;const logs=[];
  const storage={baseline:async()=>({value:current,etag:null}),writeNew:async(path,value)=>{logs.push({path,value});return true;},overwriteCurrent:async(value)=>{current=value;}};
  const fetchRosters=[{all:[c('1234','A','上市'),c('5678','B','上櫃')],listed:1,otc:1},{all:[c('1234','A','上市'),c('5678','B','上櫃'),c('9012','C','上市')],listed:2,otc:1}];
  const req={storage,date:'2026-10-23',fetchMops:async()=>({mainBusiness:'測試主營業務'}),readProfiles:async()=>[]};
  const first=await moduleUnderTest.scan({...req,fetchRoster:async()=>fetchRosters[0]});
  assert.equal(first.mode,'initialized-baseline');assert.equal(logs.length,0);
  const second=await moduleUnderTest.scan({...req,date:'2026-10-24',fetchRoster:async()=>fetchRosters[1]});
  assert.equal(second.mode,'detected');assert.equal(second.neonWrites,0);assert(logs.some(x=>x.value.code==='9012'&&x.value.event==='listing'));
}
async function apiAccessSmoke(){
  const api=require('../lib/industry-change-api'),oldToken=process.env.BLOB_READ_WRITE_TOKEN,oldCron=process.env.CRON_SECRET;
  const originals={listChanges:moduleUnderTest.listChanges,scan:moduleUnderTest.scan,removeConfirmed:moduleUnderTest.removeConfirmed};
  const originalActions={list:actionMonitor.list,scanRecent:actionMonitor.scanRecent,removeApproved:actionMonitor.removeApproved};
  actionMonitor.list=async()=>[];actionMonitor.scanRecent=async()=>({ok:true,complete:true,inserted:0});actionMonitor.removeApproved=async id=>({ok:true,removed:id});
  moduleUnderTest.listChanges=async()=>[];moduleUnderTest.scan=async()=>({ok:true,neonWrites:0});moduleUnderTest.removeConfirmed=async id=>({ok:true,removed:id});
  process.env.BLOB_READ_WRITE_TOKEN='fake-unit-test-token';process.env.CRON_SECRET='fake-cron';
  async function request(act='list',method='GET',headers={},body={}){
    const res={code:0,body:null,setHeader(){return this;},status(n){this.code=n;return this;},json(obj){this.body=obj;return this;}};
    await api({method,query:{action:act},headers,body},res);return res;
  }
  try{
    assert.equal((await request('list')).code,200,'ordinary viewers may read candidate list without typing a key');
    assert.equal((await request('scan','GET')).code,401,'scheduled scan GET still requires CRON_SECRET');
    assert.equal((await request('scan','GET',{authorization:'Bearer fake-cron'})).code,200,'Cron may scan');
    const origin={host:'stockzone.example',origin:'https://stockzone.example','sec-fetch-site':'same-origin','content-type':'application/json'};
    assert.equal((await request('scan','POST',origin)).code,200,'browser manual scan remains available');
    assert.equal((await request('delete','POST',origin,{id:'f'.repeat(24)})).code,200,'verified-row delete endpoint remains available');
    assert.equal((await request('delete-action','POST',origin,{id:'f'.repeat(24)})).code,200,'verified company-action candidate delete');
    assert.equal((await request('scan-actions','POST',origin)).code,200,'manual corporate action scan');
    assert.equal((await request('delete','POST',{host:'stockzone.example',origin:'https://stranger.example','sec-fetch-site':'cross-site'},{id:'f'.repeat(24)})).code,403,'cross-origin mutation denied');
    assert.equal((await request('delete','POST',{host:'stockzone.example'},{id:'f'.repeat(24)})).code,403,'originless mutation denied');
    assert.equal((await request('confirm','POST',origin,{ids:['f'.repeat(24)]})).code,405,'cannot mark candidates imported using a public endpoint');
    delete process.env.BLOB_READ_WRITE_TOKEN;
    assert.equal((await request('list')).code,503,'missing Private Blob prevents fake-success');
  }finally{
    Object.assign(moduleUnderTest,originals);Object.assign(actionMonitor,originalActions);
    if(oldToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=oldToken;
    if(oldCron===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldCron;
  }
}
scanSmoke().then(apiAccessSmoke).then(()=>console.log('PASS industry-change-monitor + keyless candidate API — smoke, Cron guard, same-origin mutation, confirm forbidden, official Neon immutable')).catch(e=>{console.error(e);process.exitCode=1});
