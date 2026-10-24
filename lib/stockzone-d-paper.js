'use strict';
/**
 * StockZone D / ORIGINAL V4 paper-trading ledger v1 (research only).
 * Deterministic, no DB writes, no orders, no historical reconstruction.
 * A frozen T-day signal can only be executed using the NEXT exchange session's
 * official opening print, and ONLY when captured before that session opened.
 */
const crypto=require('node:crypto');
const {VERSION:D_VERSION}=require('./stockzone-d-policy');
const VERSION='SZ-D-PAPER-20261024-v1';
const STARTING_CASH=1000000;
const PER_SLOT=.2;
const SIDE_FEE=.003; // 0.6% estimated round-trip, modeled as 0.3% per side
const HOLDING_DAYS={ON:20,WARNING:1};
const pair=r=>`${r.market}|${r.stock_code}`;
const dayCheck=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const goodNum=v=>typeof v==='number'&&Number.isFinite(v);
const fail=m=>{throw Error('PAPER_LOCKED: '+m);};
function stableJson(value){
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function digest(data){return crypto.createHash('sha256').update(stableJson(data)).digest('hex');}
function sealed(payload){const value=JSON.parse(JSON.stringify(payload));return {...value,sha256:digest(value)};}
function verifySeal(value){
 if(!value||typeof value.sha256!=='string'||value.sha256.length!==64)fail('unsealed object');
 const {sha256,...body}=value;
 if(digest(body)!==sha256)fail('journal SHA256 mismatch');
 return value;
}
function taipeiDay(when){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(when));}
function requireIso(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('invalid UTC timestamp');}
function simplifyPick(r,i){
 if(!r||!['上市','上櫃'].includes(r.market)||!/^[0-9]{4,6}$/.test(String(r.stock_code)))fail('malformed recommendation');
 if(r.allocationPct!==20)fail('paper slot must be 20%');
 if(!Number.isInteger(r.slot)||r.slot<1||r.slot>5)fail('paper slot 1..5 required');
 return {stock_code:String(r.stock_code),market:r.market,stock_name:String(r.stock_name||''),
  tag_id:String(r.tag_id||''),slot:r.slot,allocationPct:20,
  track:String(r.track||''),v4Score:goodNum(r.v4Score)?r.v4Score:null,
  originalV4Rank:Number.isInteger(r.originalV4Rank)?r.originalV4Rank:null};
}
function makeSignal(preview,capturedAt){
 requireIso(capturedAt);
 if(!preview||preview.model!==D_VERSION||preview.adapter!=='D-FORWARD-RESEARCH-ONLY'||!preview.dataComplete)fail('verified original D Neon preview required');
 const date=preview.asOfDate;
 if(!dayCheck(date)||!preview.baseline||preview.baseline.asOfDate!==date)fail('same-day V4 baseline required');
 if(preview.noOrders!==true||preview.studyOnly!==true||preview.independentSqlResearchParity!==false&&preview.mode!=='OFF')fail('research-only preview required');
 if(preview.mode==='OFF'&&preview.recommendations.length)fail('OFF may not buy');
 const dateTime=Date.parse(date+'T07:00:00Z'); // 15:00 Taipei, past cash session settlement
 if(Date.parse(capturedAt)<dateTime)fail('signal must be frozen after T 15:00 Taipei');
 if(taipeiDay(capturedAt)<date)fail('cannot capture before T');
 const frozen=(r)=>r.map(simplifyPick);
 const d=frozen(preview.recommendations||[]),v=frozen(preview.baseline.core||[]);
 if(d.length>5||v.length>5||new Set(d.map(pair)).size!==d.length||new Set(v.map(pair)).size!==v.length)fail('duplicate or >5 positions');
 if(new Set(d.map(x=>x.slot)).size!==d.length||new Set(v.map(x=>x.slot)).size!==v.length)fail('duplicate paper slot');
 const baseScene=preview.baseline.scene;
 if(preview.mode==='OFF'&&v.length)fail('baseline OFF may not buy');
 if(preview.mode==='ON'&&baseScene!=='ON_BROAD'&&baseScene!=='ON_NARROW'&&baseScene!=='ON')fail('V4 scene does not match ON');
 if(preview.mode==='WARNING'&&baseScene!=='WARNING')fail('V4 scene does not match warning');
 return sealed({schema:VERSION,type:'FROZEN_SIGNAL',signalDate:date,capturedAt,
  source:{dModel:preview.model,w3:preview.w3ModelVersion,baseline:preview.baseline.model,
   neonMoneyMethod:preview.neonMoneyVersion||null,neonDay:date,formulaSource:preview.source},
  mode:preview.mode,reason:preview.reason,marketBreadth:preview.marketBreadth??null,
  d:{positions:d,canBuy:preview.entryAllowed===true&&d.length>0},
  baseline:{positions:v,canBuy:preview.mode!=='OFF'&&v.length>0,
   extendedWatchOnly:(preview.baseline.extended||[]).map(x=>({stock_code:String(x.stock_code),market:x.market,rank:x.rank}))},
  simulatedOnly:true,noOrders:true,realized:false});
}
function emptyAccount(){return {cash:STARTING_CASH,positions:[],realizedPnl:0,closedTrades:0,equityAtClose:STARTING_CASH,markStale:[],blocked:[]};}
function beginState(){return {schema:VERSION,lastTradeDate:null,accounts:{D:emptyAccount(),V4:emptyAccount()}};}
function validatePrice(row){
 if(!row||!goodNum(row.open_price)||row.open_price<=0||!goodNum(row.close_price)||row.close_price<=0)return 'OPEN_OR_CLOSE_UNAVAILABLE';
 if(!goodNum(row.previous_close)||row.previous_close<=0)return 'PREVIOUS_CLOSE_UNAVAILABLE';
 if(Math.abs(row.open_price/row.previous_close-1)>.15)return 'PRICE_DISCONTINUITY_CORPORATE_ACTION_REVIEW';
 return null;
}
function toPriceMap(prices){
 const m=new Map();for(const r of prices){
  if(!r||!r.market||!r.stock_code)fail('invalid price row');
  const k=pair(r);if(m.has(k))fail('duplicated official price key');m.set(k,r);
 }return m;
}
function assertPrevState(state,signalDate){
 if(!state||state.schema!==VERSION||!state.accounts?.D||!state.accounts?.V4)fail('invalid ledger state');
 if(state.lastTradeDate!==null&&state.lastTradeDate!==signalDate)fail('nonconsecutive open-session ledger; refuse to bridge a missed signal');
}
function settleAccount(account,selection,mode,date,prices,strategicName,benchmarkOpen=null){
 const result=structuredClone(account),events=[],problems=[];
 result.blocked=[];result.markStale=[];
 const hasPos=result.positions.length>0;
 const currentMode=hasPos?result.positions[0].mode:null;
 if(result.positions.some(p=>p.mode!==currentMode))fail('mixed-mode held book');
 const holdingAge=hasPos?result.positions[0].heldSessions:0;
 const mustExit=hasPos&&(mode==='OFF'||currentMode!==mode||holdingAge>=HOLDING_DAYS[currentMode]);
 if(mustExit){
  const keeping=[];
  for(const pos of result.positions){
   const pr=prices.get(pair(pos)),reason=validatePrice(pr);
   if(reason){keeping.push(pos);problems.push({stock:pair(pos),side:'SELL',reason});continue;}
   const gross=pos.shares*pr.open_price,fee=gross*SIDE_FEE,proceeds=gross-fee;
   const benchmarkReturnPct=goodNum(benchmarkOpen)&&benchmarkOpen>0&&goodNum(pos.entryBenchmarkOpen)&&pos.entryBenchmarkOpen>0
    ?(benchmarkOpen/pos.entryBenchmarkOpen-1)*100:null;
   const pnlPct=(proceeds/pos.entryTotalCost-1)*100;
   result.cash+=proceeds;result.realizedPnl+=proceeds-pos.entryTotalCost;
   result.closedTrades++;
   events.push({side:'SELL',date,stock_code:pos.stock_code,market:pos.market,mode:pos.mode,
    price:pr.open_price,shares:pos.shares,gross,fee,net:proceeds,
    pnl:proceeds-pos.entryTotalCost,pnlPct,benchmarkReturnPct,
    dualSuccess:benchmarkReturnPct===null?null:pnlPct>0&&pnlPct>benchmarkReturnPct,
    holdingTradingSessions:pos.heldSessions,entryDate:pos.entryDate,strategy:strategicName});
  }
  result.positions=keeping;
 }
 // Strict liquidation barrier: if any old share is halted, do not create new exposure.
 if(result.positions.length){
  for(const pos of result.positions)pos.heldSessions++;
  if(mustExit)problems.push({side:'BUY',reason:'OLD_POSITION_EXIT_BLOCKED_NO_REENTRY'});
 }else if(selection.canBuy&&mode!=='OFF'){
  if(!Array.isArray(selection.positions)||selection.positions.length>5)fail('invalid frozen slots');
  const referenceEquity=result.cash;
  for(const pick of selection.positions){
   const pr=prices.get(pair(pick)),reason=validatePrice(pr);
   if(reason){problems.push({stock:pair(pick),side:'BUY',reason});continue;}
   const allocation=referenceEquity*PER_SLOT;
   // Whole round lot NOT assumed. Fractional shares isolate signal quality,
   // and must be explicitly labeled hypothetical (non-executable).
   const shares=allocation/(pr.open_price*(1+SIDE_FEE));
   result.cash-=allocation;
   result.positions.push({market:pick.market,stock_code:pick.stock_code,
    stock_name:pick.stock_name,mode,tag_id:pick.tag_id,slot:pick.slot,
    shares,entryDate:date,entryPrice:pr.open_price,entryTotalCost:allocation,
    heldSessions:1,lastClose:pr.close_price,
    entryBenchmarkOpen:goodNum(benchmarkOpen)&&benchmarkOpen>0?benchmarkOpen:null});
   events.push({side:'BUY',date,stock_code:pick.stock_code,market:pick.market,mode,
    price:pr.open_price,shares,gross:shares*pr.open_price,fee:allocation-shares*pr.open_price,
    cost:allocation,slot:pick.slot,strategy:strategicName});
  }
 }else if(result.positions.length){for(const pos of result.positions)pos.heldSessions++;}
 for(const pos of result.positions){
  const pr=prices.get(pair(pos));
  if(pr&&goodNum(pr.close_price)&&pr.close_price>0)pos.lastClose=pr.close_price;
  else result.markStale.push(pair(pos));
 }
 result.equityAtClose=result.cash+result.positions.reduce((sum,p)=>sum+p.shares*p.lastClose,0);
 result.blocked=problems;
 return {account:result,events,problems};
}
function executeNextOpen({signal,previous=null,sessionDate,observedAt,prices,marketPriceCount,benchmarkOpen=null}={}){
 verifySeal(signal);requireIso(observedAt);
 if(signal.schema!==VERSION||signal.type!=='FROZEN_SIGNAL'||signal.noOrders!==true)fail('invalid signal envelope');
 if(!dayCheck(sessionDate)||sessionDate<=signal.signalDate)fail('not a later trading session');
 // 09:00 local Taipei = 01:00Z, the following code works across weekends / holidays.
 if(Date.parse(signal.capturedAt)>=Date.parse(sessionDate+'T01:00:00Z'))fail('LOOKAHEAD: frozen recommendation postdates next opening');
 if(Date.parse(observedAt)<Date.parse(sessionDate+'T07:00:00Z'))fail('must settle after official close and complete stock EOD');
 if(!Number.isInteger(marketPriceCount)||marketPriceCount<1500)fail('incomplete opening price market sample');
 if(!Array.isArray(prices))fail('official as-of-next-open prices required');
 const prev=previous?verifySeal(previous):null;
 const state=prev?prev.state:beginState();
 if(prev&&(prev.type!=='EXECUTION'||prev.executionDate!==signal.signalDate))fail('missing preceding execution or wrong chain');
 assertPrevState(state,signal.signalDate);
 const map=toPriceMap(prices),accounts={},events=[],problems=[];
 for(const [key,picks] of [['D',signal.d],['V4',signal.baseline]]){
  const value=settleAccount(state.accounts[key],picks,signal.mode,sessionDate,map,key,benchmarkOpen);
  accounts[key]=value.account;events.push(...value.events);problems.push(...value.problems.map(p=>({...p,strategy:key})));
 }
 const nextState={schema:VERSION,lastTradeDate:sessionDate,accounts};
 return sealed({schema:VERSION,type:'EXECUTION',signalDate:signal.signalDate,
  signalSha256:signal.sha256,executionDate:sessionDate,observedAt,
  previousExecutionSha256:prev?.sha256||null,marketPriceCount,benchmarkOpen:goodNum(benchmarkOpen)&&benchmarkOpen>0?benchmarkOpen:null,
  state:nextState,events,problems,simulatedOnly:true,noOrders:true,
  assumptions:{initialCapitalTwd:STARTING_CASH,positionBudget:PER_SLOT,
   buyCostPct:.3,sellCostPct:.3,fractionalShares:true,slippageMode:'NONE_ASSUMED',
   corporateAction:'SUSPEND_AND_FLAG_OPEN_GAP_ABOVE_15_PERCENT',fill:'OFFICIAL_NEXT_SESSION_OPEN',
   doubleSuccess:'NET_STOCK_RETURN_GT_ZERO_AND_GT_TAIEX_OPEN_TO_OPEN; NULL_IF_BENCHMARK_NOT_VERIFIED'}});
}
module.exports={VERSION,STARTING_CASH,PER_SLOT,SIDE_FEE,digest,sealed,verifySeal,makeSignal,emptyAccount,beginState,validatePrice,executeNextOpen,taipeiDay};
