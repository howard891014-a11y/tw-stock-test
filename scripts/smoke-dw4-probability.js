'use strict';
const {predictDw4}=require('../lib/dw4');
const dates=Array.from({length:68},(_,i)=>new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10));
const rows=[];const w3=[];for(let i=0;i<dates.length;i++)w3.push({trade_date:dates[i],regime:i>40?'RiskOn':i>20?'Normal':'RiskOff'});
for(let tag=0;tag<30;tag++){
 let baseX=tag%4-2;
 for(let i=0;i<dates.length;i++){
  const z=(Math.sin(i*.27+tag*.5)+Math.cos(i*.15-tag*.3));
  const ret=(.35*z+(tag%4-1.5)*.08);
  baseX+=z*.35;
  rows.push({trade_date:dates[i],tag_id:`tag_${tag}`,x_score:baseX,y_score:2*z,flow_1_pct: z*.4,flow_5_pct:z*.9,return_1_pct:ret});
 }
}
const sql={query:async function(q,args){if(q.includes('MAX(trade_date)'))return [{d:dates.at(-1)}];if(q.includes('FROM market_w3_run_daily'))return w3;if(q.includes('FROM market_business_xy2_research_daily WHERE'))return rows;throw new Error('Unexpected '+q.slice(0,50))}};
(async()=>{console.time('predict');const out=await predictDw4({sql});console.timeEnd('predict');for(const h of out.horizons){const r=out.horizonResults[h];console.log({h,ok:r.ok,model:r.yFeatureMode,preds:r.predictions?.length,p: r.predictions?.[0]?.upProbability,status:r.probabilityCalibration?.status,dates:r.probabilityCalibration?.distinctDates,train:r.training});if(!r.ok||r.predictions.length!==30)throw new Error(`h${h} failed`);} })().catch(e=>{console.error(e);process.exit(1)});
