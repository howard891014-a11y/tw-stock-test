'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const mops=require('../lib/mops-quarterly-eps');

const report=(x)=>{
  const v=Array.isArray(x)?x:[x,0,x,0];
  return `<html><table><tr><th>會計項目</th><th>本季</th><th>上年同季</th><th>本期累計</th><th>去年同期累計</th></tr><tr><td>9750</td><td>基本每股盈餘合計</td>${v.map(z=>`<td>${z}</td>`).join('')}</tr></table></html>`;
};
assert.equal(mops.extractCumulativeEps(report('25.25')),25.25);
assert.equal(mops.extractReportEps(report([1.54,0.55,2.37,1.35]),2).quarter,1.54);
assert.equal(mops.extractReportEps(report([1.54,0.55,2.37,1.35]),2).ytd,2.37);
assert.equal(mops.extractReportEps(report([10.1,9.9]),4).ytd,10.1);
assert.equal(mops.extractReportEps(report([1.54,0.55]),2),null,'ambiguous Q2 column layout cannot be interpreted');
assert.equal(mops.extractCumulativeEps('<html>查無資料 EPS 99</html>'),null);
assert.equal(mops.extractCumulativeEps('<tr><td>基本每股盈餘</td><td>--</td><td>30</td></tr>'),null);
assert.equal(mops.reportPeriod('2026 Q2').quarter,2);
assert.equal(mops.epsPairReady([{period:'2026 Q2',eps:15},{period:'2025 Q2',eps:8}],{year:2026,quarter:2}),true);
assert.equal(mops.epsPairReady([{period:'2026 Q2',eps:15},{period:'2025 Q1',eps:8}],{year:2026,quarter:2}),false);

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'..','api','technical.js'),'utf8');
const cacheCode=app.slice(app.indexOf('function fundamentalQuarterInfo('),app.indexOf('function mergeFundamentalPayload('));
const context={Date,Number,Set,Map,Array,Math,String,valuationNum:(v)=>v===null||v===undefined?null:(Number.isFinite(Number(v))?Number(v):null),fundamentalMarginValue:()=>52,fundamentalScalar:(v)=>v===null||v===undefined?null:(Number.isFinite(Number(v))?Number(v):null)};
vm.createContext(context);
vm.runInContext(cacheCode,context);
const good={officialStatement:{period:'2026 Q2',marginApplicable:false},quarters:[
  {period:'2026 Q2',eps:15}, {period:'2026 Q1',eps:5},
  {period:'2025 Q4',eps:6}, {period:'2025 Q3',eps:7}, {period:'2025 Q2',eps:8}],monthlyRevenue:{yoyPct:2}};
assert.equal(context.fundamentalEpsPeriodCoverage(good).yoy,true);
assert.equal(context.fundamentalEpsPeriodCoverage(good).qoq,true);
assert.equal(context.fundamentalPayloadNeedsSupplement(good),false);
const missing={...good,quarters:[{period:'2026 Q2',eps:15},{period:'2025 Q1',eps:8}]};
assert.equal(context.fundamentalEpsPeriodCoverage(missing).yoy,false);
assert.equal(context.fundamentalPayloadNeedsSupplement(missing),true);
assert.match(app,/fundamentals:v27029:/);
assert.match(app,/FUNDAMENTALS_RETRY_MS=2\*60\*1000/);
assert.match(app,/const yoyEps=fundamentalPair\(epsNow,epsPrev,"eps"\)/);
assert.match(app,/epsTtmSeq\.every\(Number\.isFinite\)/);
assert.match(api,/epsYoyReady/);
// v2.7.0.29: shared historical margin year comparison must not infer YTD from one quarter.
const appSource=app.slice(app.indexOf('function fundamentalScalar(v){'),app.indexOf('function fundamentalComment(assessment){'));
const marginContext={Number,Date,Map,Set,console,valuationNum:v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null};
vm.createContext(marginContext);
vm.runInContext(app.slice(app.indexOf('function fundamentalQuarterInfo('),app.indexOf('async function fundamentals('))+appSource,marginContext);
const off=(y,q,g,o)=>({period:`${y} Q${q}`,year:y,quarterNo:q,grossMargin:g,operatingMargin:o,marginSource:'official'});
const yearPair={officialStatement:off(2026,2,53.6,29.5),previousYearStatement:off(2025,2,48.3,24.1),quarters:[]};
assert.equal(Number(marginContext.fundamentalMarginYearComparison(yearPair,'gross').delta.toFixed(1)),5.3);
assert.equal(Number(marginContext.fundamentalMarginYearComparison(yearPair,'operating').delta.toFixed(1)),5.4);
assert.equal(marginContext.fundamentalMarginYearComparison({officialStatement:off(2026,2,53.6,29.5),quarters:[{period:'2025 Q2',revenue:100,grossProfit:10}]},'gross').delta,null);
assert.equal(marginContext.fundamentalMarginYearComparison({officialStatement:off(2026,1,.8,.5),previousYearStatement:off(2025,1,.7,.3)},'gross').delta.toFixed(1),'0.1');


(async()=>{
  const originalFetch=global.fetch;
  const years={'2026Q2':[15,9,23,12],'2026Q1':[8,4],
    '2025Q4':[22,19],'2025Q3':[5,4,17,13],'2025Q2':[8,6,12,9],'2025Q1':[4,3],
    '2024Q4':[19,17],'2024Q3':[6,5,15,12],'2024Q2':[9,4,9,4]};
  const requested=[];
  global.fetch=async (url,opts)=>{
    const p=new URLSearchParams(opts.body),year=Number(p.get('year'))+1911,quarter=Number(p.get('season'));
    const key=`${year}Q${quarter}`; requested.push(key);
    const v=years[key];
    return {ok:true,status:200,text:async()=>v===undefined?'查無資料':report(v)};
  };
  try {
    const r=await mops.supplementMissingEps({code:'7769',period:'2026Q2',rows:[{period:'2026 Q2',eps:null}]});
    const epsByKey=new Map(r.rows.map(x=>[x.period,x.eps]));
    assert.equal(epsByKey.get('2026 Q2'),15,'Q2 must use standalone first column (15), not YTD minus Q1 (23-8)');
    assert.equal(epsByKey.get('2025 Q2'),8,'2025 Q2 must use standalone first column (8)');
    assert.equal(epsByKey.get('2025 Q4'),5,'Q4=FY 22 minus Q3 YTD 17');
    assert.equal((15/8-1)*100,87.5);
    assert.equal(r.filled,8);
    assert.ok(requested.includes('2025Q3')); // Q4 calculation needs Q3 YTD
    // Missing Q3 YTD must never yield an invented Q4 EPS.
    delete years['2025Q3'];
    const r2=await mops.supplementMissingEps({code:'7769',period:'2026Q2',rows:[{period:'2026 Q2',eps:null}]});
    assert.ok(!r2.rows.some(x=>x.period==='2025 Q4'));
    // MOPS endpoint down: stop probing, report missing instead of crashing unrelated fundamentals.
    global.fetch=async()=>{throw new Error('blocked')};
    const r3=await mops.supplementMissingEps({code:'7769',period:'2026Q2',rows:[]});
    assert.equal(r3.filled,undefined);
    assert.equal(r3.rows.length,0);
  } finally {global.fetch=originalFetch;}
  console.log('PASS: MOPS HTML parse, Q2 direct EPS, Q4 annual-minus-Q3 YTD, same-quarter YoY, cache correctness');
  await integrationSmoke();
})().catch(e=>{console.error(e);process.exitCode=1;});
// Integration smoke: API technical?mode=fundamentals must combine Yahoo and MOPS,
// and return a complete same-quarter EPS pair with correct fiscal-quarter labels.
async function integrationSmoke(){
  const originalFetch=global.fetch;
  const years={'2026Q2':[15,9,23,12],'2026Q1':[8,4],
    '2025Q4':[22,19],'2025Q3':[5,4,17,13],'2025Q2':[8,6,12,9],'2025Q1':[4,3],
    '2024Q4':[19,17],'2024Q3':[6,5,15,12],'2024Q2':[9,4,9,4]};
  global.fetch=async (url,opts)=>{
    if(String(url).includes('fundamentals-timeseries')){
      return {ok:true,status:200,json:async()=>({timeseries:{result:[{
        quarterlyTotalRevenue:[{asOfDate:'2026-06-30',reportedValue:{raw:1000000}}],
        quarterlyDilutedEPS:[]
      }]}})};
    }
    const p=new URLSearchParams(opts.body),year=Number(p.get('year'))+1911,quarter=Number(p.get('season'));
    const key=`${year}Q${quarter}`;
    return {ok:true,status:200,text:async()=>years[key]===undefined?'查無資料':report(years[key])};
  };
  try {
    const {default:handler}=await import('../api/technical.js');
    const res={headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(x){this.payload=x;return this}};
    await handler({query:{mode:'fundamentals',q:'7769',market:'上市',period:'2026Q2'}},res);
    assert.equal(res.code,200);
    assert.equal(res.payload.coverage.epsYoyReady,true);
    assert.equal(res.payload.quarters.find(x=>x.period==='2026 Q2').eps,15);
    assert.equal(res.payload.quarters.find(x=>x.period==='2025 Q2').eps,8);
    assert.equal(res.headers['Cache-Control'],'public, s-maxage=21600, stale-while-revalidate=21600');
    console.log('PASS: API integration Yahoo missing EPS -> official MOPS standalone quarter EPS -> EPS YoY ready');
  }finally{global.fetch=originalFetch;}
}
