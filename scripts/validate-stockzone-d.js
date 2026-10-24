'use strict';
// Tests real archived W3 and V4 JS: no duplicated scoring or invented inputs.
const assert=require('node:assert/strict');
const Module=require('node:module');
const realLoad=Module._load;
Module._load=function(req,parent,isMain){
 if(req==='@neondatabase/serverless')return{neon:()=>({query:()=>{throw Error('UNEXPECTED database call')}})};
 return realLoad.call(this,req,parent,isMain);
};
const {computeW3D112}=require('../lib/w3-d112');
const {selectDailyStage3First}=require('../lib/v4-stage3-first');
const {selectFivePlusFiveDaily}=require('../lib/stockzone-five-plus-five');
const {VERSION,pickV4Qualified,qualifyMoneySectors,rankDualTrack,selectFrozenD,planNextOpen}=require('../lib/stockzone-d-policy');
const {getDPreview,MONEY_QUERY,MARKET_BREADTH_QUERY}=require('../lib/stockzone-d-neon-readonly');
const date='2026-10-22';
const rows=Array.from({length:210},(_,i)=>({
 trade_date:date,market:'上市',stock_code:String(2000+i),stock_name:'測試股'+i,
 tag_id:i%10===0?'hot':i%10===1?'hot2':`industry${i%12}`,
 avg_value20:100000001,trade_value:50000001,
 ret5:2+i*.14,taiex_ret5:0,relative_industry_ret5:1+i*.05,
 flow5:3,sector_flow5:2,dflow5_3:2+i*.05,delta_sector_flow:3+i*.1,
 relative_gap20:1,ret20:3+i*.22,ret3:2+i*.1,ma20:80,sd20:3+i*.02,
 price_breadth:80,
}));
const money=Array.from({length:198},(_,i)=>({tag_id:i===0?'hot':i===1?'hot2':`moneytag${i}`,flow_5_e8:200-i,core_valid_5:4}));
const rec={date,modelVersion:'W3-D.1.2',valid:true,inputQuality:'complete',regime:'RiskOn',warning:false,advanceRatio:62};
const previous={...rec,date:'2026-10-21'};
function frozen(overrides={}){return selectFrozenD({rawRows:rows,marketRecords:[previous,rec],moneyRows:money,stockFlow1:new Map(),financeCoreKeys:new Set(),asOfDate:date,...overrides});}
const v4=selectDailyStage3First(rows,'RiskOn');
const reference=selectFivePlusFiveDaily(rows,'RiskOn',62,{asOfDate:date,scenario:'original_all'});
assert.deepEqual(v4.recommendations.map(x=>x.stock_code),reference.core.map(x=>x.stock_code),'archived V4 independent reference');
assert.ok(reference.core.length===5,'fixture must have all V4 core slots');
const moneyRank=qualifyMoneySectors(money);assert.ok(moneyRank.strong.has('hot'));assert.ok(moneyRank.strong.has('hot2'));
const ranked=pickV4Qualified(rows,'RiskOn');assert.ok(ranked.eligible.length>=10);
const four=rankDualTrack(ranked.eligible,moneyRank.strong,4);
assert.equal(four.length,5);assert.ok(four.slice(0,4).every((r,i)=>r.stock_code===ranked.eligible[i].stock_code));
assert.equal(four[4].track,'STRONG_SECTOR','must prefer capital-strong eligible over 5th old V4 rank');
const on=frozen();assert.equal(on.mode,'ON');assert.equal(on.tradeSlots,5);assert.equal(on.cashFraction,0);
assert.deepEqual(on.recommendations.map(r=>r.stock_code),four.map(r=>r.stock_code));
assert.equal(on.recommendations.reduce((x,r)=>x+r.allocationPct,0),100);
const protectedStock=ranked.eligible[0];const excl=new Set([`${protectedStock.market}|${protectedStock.stock_code}`]);
const finance=frozen({financeCoreKeys:excl});assert.ok(!finance.recommendations.some(x=>x.stock_code===protectedStock.stock_code));
const alert={...rec,warning:true},wFirst=frozen({marketRecords:[previous,alert],marketBreadth:61});
assert.equal(wFirst.mode,'WARNING');assert.equal(wFirst.tradeSlots,0);assert.equal(wFirst.reason,'FIRST_WARNING_NO_BUY');
assert.equal(wFirst.cashFraction,1);
const prevWarning={...previous,warning:true};
const under30=frozen({marketRecords:[prevWarning,alert],marketBreadth:29.999});
assert.equal(under30.tradeSlots,0);assert.equal(under30.reason,'MARKET_ADVANCE_UNDER_30');
const twos=rankDualTrack(pickV4Qualified(rows,'Warning').eligible,moneyRank.strong,2);
const filters=new Map(twos.map((r,i)=>[`${r.market}|${r.stock_code}`,i%2===0?2:-1]));
const valid=frozen({marketRecords:[prevWarning,alert],marketBreadth:30,stockFlow1:filters});
assert.equal(valid.mode,'WARNING');assert.equal(valid.tradeSlots,3);assert.equal(valid.cashFraction,.4);
assert.deepEqual(valid.recommendations.map(r=>r.stock_code),twos.filter((r,i)=>i%2===0).map(r=>r.stock_code));
assert.ok(valid.recommendations.every(r=>r.allocationPct===20));
const noQual=frozen({marketRecords:[prevWarning,alert],marketBreadth:30,stockFlow1:new Map(twos.map(r=>[`${r.market}|${r.stock_code}`,-1]))});
assert.equal(noQual.tradeSlots,0);assert.equal(noQual.cashFraction,1);
assert.throws(()=>frozen({marketRecords:[prevWarning,alert],marketBreadth:30}),/flow1 missing/);
assert.throws(()=>frozen({marketRecords:[prevWarning,alert],marketBreadth:null}),/breadth missing/);
assert.throws(()=>frozen({marketRecords:[prevWarning,alert],moneyRows:[]}),/not ready/);
assert.throws(()=>frozen({rawRows:[{...rows[0],trade_date:'2026-10-23'}]}),/future or mixed-date/);
assert.throws(()=>frozen({marketRecords:[previous,{...rec,valid:false}]}),/not complete and verified/);
const off=frozen({marketRecords:[previous,{...rec,regime:'RiskOff'}],rawRows:[],moneyRows:[]});
assert.equal(off.tradeSlots,0);assert.equal(off.reason,'RISK_OFF');assert.equal(off.mode,'OFF');
assert.equal(planNextOpen(off,{mode:'ON',heldSessions:7}).closeCurrentPosition,true);
assert.equal(planNextOpen(valid,null).buySlots,3);
assert.equal(planNextOpen(on,{mode:'ON',heldSessions:19}).keepCurrentPosition,true);
assert.equal(planNextOpen(on,{mode:'ON',heldSessions:20}).closeCurrentPosition,true);
assert.equal(planNextOpen(valid,{mode:'ON',heldSessions:7}).closeCurrentPosition,true);
assert.equal(planNextOpen(wFirst,{mode:'ON',heldSessions:7}).buySlots,0);
assert.equal(planNextOpen(under30,{mode:'WARNING',heldSessions:1}).closeCurrentPosition,true);
assert.equal(planNextOpen(valid,{mode:'WARNING',heldSessions:1}).buySlots,3);
assert.equal(planNextOpen(on,null).execute,'NEXT_TRADING_SESSION_OPEN');

// Real frozen W3 engine, with deterministic as-of fixtures; adapters never
// accept a hand-authored W3 state when serving production-derived previews.
const first=new Date('2026-01-01T00:00:00Z');
const fixture=Array.from({length:65},(_,i)=>{const d=new Date(first);d.setUTCDate(d.getUTCDate()+i);return{date:d.toISOString().slice(0,10),taiex:20000+i*21+Math.sin(i)*60,advance_ratio:60,breadth5:62,institutional_value_twd:1e9*Math.sin(i*.2),financing_value_twd:1e11*(1+i*.0003)}});
const originalLast=computeW3D112(fixture).records.at(-1);
assert.equal(originalLast.regime,'RiskOn');assert.ok(originalLast.valid);
const now=originalLast.date;
const allDates={latest_sector:now,latest_stockflow:now,latest_research:now,latest_w3:now,latest_price:now,latest_market:now};
const mockDb={async query(q,args){
 if(q.includes('latest_sector')&&q.includes('latest_stockflow'))return[allDates];
 if(q.includes('FROM market_w3_run_daily WHERE trade_date='))return[{trade_date:now,model_version:'W3-D.1.2',regime:originalLast.regime}];
 if(q.includes('FROM market_business_xy2_member WHERE tag_id='))return[];
 if(q.includes('FROM market_capital_flow_money_daily'))return money;
 if(q.includes('WITH sessions AS MATERIALIZED'))return rows.map(x=>({...x,trade_date:now}));
 throw Error('unexpected DB query: '+q.slice(0,80));
}};
(async()=>{
 const out=await getDPreview({sql:mockDb,inputsFetcher:async()=>fixture,skipConnectionCheck:true,withBaseline:true});
 assert.equal(out.mode,'ON');assert.equal(out.adapter,'D-FORWARD-RESEARCH-ONLY');
 assert.equal(out.independentSqlResearchParity,false);assert.equal(out.noOrders,true);
 assert.equal(out.baseline.model,'StockZone-V4-5plus5-original_all');
 assert.equal(out.baseline.core.length,reference.core.length);
 assert.deepEqual(out.baseline.core.map(r=>r.stock_code),reference.core.map(r=>r.stock_code));
 const bad={...mockDb,async query(q,a){if(q.includes('latest_sector')&&q.includes('latest_stockflow'))return[{...allDates,latest_market:'2026-10-21'}];return mockDb.query(q,a);}};
 await assert.rejects(getDPreview({sql:bad,inputsFetcher:async()=>fixture,skipConnectionCheck:true}),/mixed source dates/);
 const badState={...mockDb,async query(q,a){if(q.includes('FROM market_w3_run_daily WHERE trade_date='))return[{trade_date:now,model_version:'W3-D.1.2',regime:'RiskOff'}];return mockDb.query(q,a);}};
 await assert.rejects(getDPreview({sql:badState,inputsFetcher:async()=>fixture,skipConnectionCheck:true}),/original JS differ/);
 const mismatchData=frozen({marketRecords:[prevWarning,alert],marketBreadth:31,stockFlow1:filters});assert.equal(mismatchData.marketBreadth,31);
 assert.equal(MONEY_QUERY.toLowerCase().includes('insert'),false);assert.equal(MARKET_BREADTH_QUERY.toLowerCase().includes('market_daily_history'),true);
 assert.equal(VERSION,'SZ-D-RESEARCH-FROZEN-20261024-v1');
 console.log('PASS D original V4 order, financefree, 4+1/2+3, capital ranking, W3 safety, warning first day, breadth 30, flow1 and industry gate, cash slots, T+1 plan, fail closed, read-only mock Neon adapter');
})().catch(e=>{console.error(e);process.exitCode=1});
