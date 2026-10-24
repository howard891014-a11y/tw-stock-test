'use strict';
const {VERSION,STARTING_CASH,verifySeal}=require('./stockzone-d-paper');
const fail=m=>{throw Error('PAPER_LOCKED: '+m);};
/** Requires a COMPLETE chronological journal (never infer unrecorded days). */
function summarize(executions){
 if(!Array.isArray(executions))fail('execution records required');
 const sorted=executions.slice().sort((a,b)=>a.executionDate.localeCompare(b.executionDate));
 const summary={version:VERSION,observedSessions:sorted.length,firstOpen:sorted[0]?.executionDate||null,
  lastOpen:sorted.at(-1)?.executionDate||null,startingCapitalTwd:STARTING_CASH,
  D:null,V4:null,comparison:null,doubleSuccessDefinition:'NET_GAIN > 0 AND NET_GAIN > SAME_INTERVAL_TAIEX_OPEN_TO_OPEN',
  incompleteBenchmarkCount:0,fullyVerified:false};
 const acc={D:{equities:[STARTING_CASH],trades:[],problems:[]},V4:{equities:[STARTING_CASH],trades:[],problems:[]}};
 let previous=null;
 for(const e of sorted){
  verifySeal(e);
  if(e.schema!==VERSION||e.type!=='EXECUTION')fail('different paper book version');
  if(previous){
   if(e.executionDate<=previous.executionDate||e.signalDate!==previous.executionDate)fail('nonsequential saved events');
   if(e.previousExecutionSha256!==previous.sha256)fail('broken prior-execution hash chain');
  }else if(e.previousExecutionSha256!==null)fail('ledger begins in the middle of a trading chain');
  for(const name of ['D','V4']){
   acc[name].equities.push(e.state.accounts[name].equityAtClose);
   acc[name].trades.push(...e.events.filter(x=>x.strategy===name&&x.side==='SELL'));
   acc[name].problems.push(...e.problems.filter(x=>x.strategy===name));
  }
  previous=e;
 }
 for(const name of ['D','V4']){
  const a=acc[name],end=a.equities.at(-1),wins=a.trades.filter(x=>x.pnlPct>0),dualKnown=a.trades.filter(x=>x.dualSuccess!==null),dualWins=dualKnown.filter(x=>x.dualSuccess);
  let peak=a.equities[0],maxDrawdown=0;
  for(const x of a.equities){if(!Number.isFinite(x))fail('invalid saved portfolio equity');peak=Math.max(peak,x);maxDrawdown=Math.min(maxDrawdown,(x/peak-1)*100)}
  summary[name]={capitalTwd:end,netReturnPct:(end/STARTING_CASH-1)*100,maxDrawdownPct:maxDrawdown,
   closedTrades:a.trades.length,winningTrades:wins.length,
   winRatePct:a.trades.length?100*wins.length/a.trades.length:null,
   meanClosedReturnPct:a.trades.length?a.trades.reduce((s,t)=>s+t.pnlPct,0)/a.trades.length:null,
   dualSuccessCount:dualWins.length,dualSample:dualKnown.length,
   dualSuccessRatePct:dualKnown.length?100*dualWins.length/dualKnown.length:null,
   missingBenchmarkExits:a.trades.length-dualKnown.length,
   openPositions:previous?.state.accounts[name].positions.length||0,
   flaggedExecutions:a.problems.length};
 }
 summary.comparison={DMinusV4NetReturnPp:summary.D.netReturnPct-summary.V4.netReturnPct,
  DMinusV4MaxDrawdownPp:summary.D.maxDrawdownPct-summary.V4.maxDrawdownPct};
 summary.incompleteBenchmarkCount=summary.D.missingBenchmarkExits+summary.V4.missingBenchmarkExits;
 summary.fullyVerified=sorted.length>0&&summary.incompleteBenchmarkCount===0&&acc.D.problems.length===0&&acc.V4.problems.length===0;
 summary.studyOnly=true;summary.realMoneyTrades=0;
 return summary;
}
module.exports={summarize};
