// W3 Market Regime: port of 2026-10-08 frozen reference replay.
// CSV must be refreshed with the SAME source/feature semantics before new dates are evaluated.

const finite=Number.isFinite;
function mean(a){return a.reduce((s,v)=>s+v,0)/a.length}
function computeW3(rows){if(!Array.isArray(rows))throw new Error('W3 requires explicit Neon daily input rows');
 const x=rows.map((r,i)=>({...r}));
 for(let i=0;i<x.length;i++){const r=x[i];for(const n of [5,10,20,60]){r['ma'+n]=i>=n-1?mean(x.slice(i-n+1,i+1).map(t=>t.taiex)):NaN;r['ma'+n+'_slope3']=i>=3?r['ma'+n]-(x[i-3]['ma'+n]??NaN):NaN;}
 r.short_spread_pct=(Math.max(r.ma5,r.ma10,r.ma20)-Math.min(r.ma5,r.ma10,r.ma20))/r.taiex*100;
 r.gap20_60_pct=Math.abs(r.ma20-r.ma60)/r.ma60*100;
 r.flow_ratio=r.total_trade_value>0?r.inst_net/r.total_trade_value*100:NaN;
 const hist=x.slice(Math.max(0,i-20),i).map(t=>t.flow_ratio).filter(finite);
 if(hist.length<10||!finite(r.flow_ratio))r.flow_z20=NaN;else{const m=mean(hist),sd=Math.sqrt(mean(hist.map(v=>(v-m)**2)));r.flow_z20=(r.flow_ratio-m)/(sd>1e-9?sd:1);}
 }
 let state='RiskOn',days=0,below=0,bulls=0,bears=0,neutrals=0,warningAge=0;const records=[],switches=[],warnings=[];
 for(let i=0;i<x.length;i++){
 const r=x[i];if(r.date<'2026-05-26')continue;days++;
 const bull=finite(r.ma20)&&r.ma5>r.ma10&&r.ma10>r.ma20&&r.ma5_slope3>0&&r.ma10_slope3>0;
 const bear=finite(r.ma20)&&r.ma5<r.ma10&&r.ma10<r.ma20&&r.ma5_slope3<0&&r.ma10_slope3<0;
 const tangled=finite(r.short_spread_pct)&&r.short_spread_pct<=1.20;
 const near60=finite(r.gap20_60_pct)&&r.gap20_60_pct<=3;
 const prev=i>0?x[i-1]:null;
 const thrust=!!prev&&r.advance_ratio>=80&&r.breadth_mom>=30&&prev.advance_ratio<=35;
 const buy=finite(r.flow_z20)&&r.flow_z20>=2,sell=finite(r.flow_z20)&&r.flow_z20<=-2;
 const neutral=tangled&&r.drawdown20>-3.5&&r.breadth5>=40&&r.breadth5<=60&&Math.abs(r.breadth_mom)<15;
 neutrals=neutral?neutrals+1:0;const old=state;let reason='';
 if(state==='RiskOn'){
 const key=near60?r.ma60:r.ma20,belowKey=finite(key)&&r.taiex<key;below=belowKey?below+1:0;
 if(warningAge===0&&sell&&belowKey&&r.breadth5<48&&r.breadth_mom< -10&&r.drawdown20< -2){warningAge=1;warnings.push([r.date,'warning_start']);}
 else if(warningAge>0){const belowNow=finite(key)&&r.taiex<key;
 if(belowNow&&(bear||r.breadth5<45)){state='RiskOff';reason='warning_confirmed_persistent_weakness';warnings.push([r.date,'warning_confirm']);warningAge=0;}
 else if(!belowNow&&r.breadth5>50){warnings.push([r.date,'warning_cancel']);warningAge=0;}
 else{warningAge++;if(warningAge>4){warnings.push([r.date,'warning_expire']);warningAge=0;}}}
 if(state===old){if(below>=3){state='RiskOff';reason=near60?'3d_below_MA60':'3d_below_MA20';warningAge=0;}
 else if(neutrals>=3){state='Normal';reason='3d_stable_neutral';warningAge=0;}}
 if(state!==old){days=0;below=0;neutrals=0;bulls=0;bears=0;}
 }else if(state==='RiskOff'){
 bulls=bull&&!tangled?bulls+1:0;
 if(buy&&thrust){state='RiskOn';reason='extreme_buy+breadth_thrust';}
 else if(bulls>=2){state='RiskOn';reason='2d_bullish_expansion_from_RiskOff';}
 else if(neutrals>=3){state='Normal';reason='3d_stable_neutral';}
 if(state!==old){days=0;neutrals=0;bulls=0;bears=0;}
 }else{
 bulls=bull&&!tangled?bulls+1:0;bears=bear&&!tangled?bears+1:0;
 const forceOff=sell&&r.ma20_gap<0&&r.breadth5<48&&r.drawdown20< -3;
 if(forceOff){state='RiskOff';reason='extreme_sell+weak_structure';}
 else if(buy&&thrust){state='RiskOn';reason='extreme_buy+breadth_thrust';}
 else if(days>=5&&bears>=2){state='RiskOff';reason='2d_bearish_expansion_after_normal_hold';}
 else if(days>=5&&bulls>=2){state='RiskOn';reason='2d_bullish_expansion_after_normal_hold';}
 if(state!==old){days=0;neutrals=0;bulls=0;bears=0;}
 }
 if(state!==old)switches.push([r.date,old,state,reason]);records.push({date:r.date,regime:state,warning:warningAge>0,warningAge,source:'w3-neon-replay'});
 }
 return {records,switches,warnings,lastInputDate:x.at(-1)?.date||null};
}
module.exports={computeW3};
