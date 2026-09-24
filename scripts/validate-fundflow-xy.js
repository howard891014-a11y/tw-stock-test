const assert=require('assert');
const {percentileRanks,scoreStocksForDate,computeBusinessFlow,computeTagDetail,quadrant,buildTransitionCalibration,projectGroup}=require('../lib/fundflow-xy');

assert.deepStrictEqual(percentileRanks([1,2,3]).map(x=>Math.round(x)),[0,50,100]);
assert.deepStrictEqual(percentileRanks([5,5]).map(x=>Math.round(x)),[50,50]);
assert.equal(quadrant(65,40),'potential');
assert.equal(quadrant(65,65),'mainline');

// B: X must not move when only price direction changes.
const stockBase=[
  {stock_code:'1',value_ratio_20:2,value_trend_5_15:1.5,change_pct:1,return_3_pct:2,return_5_pct:3,return_20_pct:5,positive_days_5:4},
  {stock_code:'2',value_ratio_20:1,value_trend_5_15:1.0,change_pct:-1,return_3_pct:-2,return_5_pct:-3,return_20_pct:-5,positive_days_5:1},
  {stock_code:'3',value_ratio_20:.5,value_trend_5_15:.7,change_pct:0,return_3_pct:0,return_5_pct:0,return_20_pct:0,positive_days_5:2},
];
const scored1=scoreStocksForDate(stockBase),scored2=scoreStocksForDate(stockBase.map(x=>({...x,change_pct:-x.change_pct,return_3_pct:-x.return_3_pct,return_5_pct:-x.return_5_pct,return_20_pct:-x.return_20_pct})));
for(let i=0;i<scored1.length;i++)assert.equal(Math.round(scored1[i].stockX*100),Math.round(scored2[i].stockX*100),'X must be price-free');

const profiles=[
  {stock_code:'6187',stock_name:'萬潤',market:'上櫃',industry_code:'31',industry:'其他電子業'},
  {stock_code:'2467',stock_name:'志聖',market:'上市',industry_code:'31',industry:'其他電子業'},
  {stock_code:'6640',stock_name:'均華',market:'上櫃',industry_code:'31',industry:'其他電子業'},
  {stock_code:'6438',stock_name:'迅得',market:'上櫃',industry_code:'31',industry:'其他電子業'},
  {stock_code:'3363',stock_name:'上詮',market:'上櫃',industry_code:'26',industry:'光電業'},
  {stock_code:'6442',stock_name:'光聖',market:'上櫃',industry_code:'27',industry:'通信網路業'},
  {stock_code:'3163',stock_name:'波若威',market:'上櫃',industry_code:'27',industry:'通信網路業'},
  {stock_code:'2330',stock_name:'台積電',market:'上市',industry_code:'24',industry:'半導體業'},
];
const dates=['2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-21','2026-09-22','2026-09-23'];
const activity=[];
for(let di=0;di<dates.length;di++){
  profiles.forEach((p,pi)=>{
    const packaging=['6187','2467','6640','6438'].includes(p.stock_code),cpo=['3363','6442','3163'].includes(p.stock_code);
    const trend=packaging?di*0.18:cpo?di*0.10:di*0.02;
    activity.push({trade_date:dates[di],stock_code:p.stock_code,stock_name:p.stock_name,market:p.market,
      value_ratio_20:1+(packaging?0.8:cpo?0.45:0.1)+trend+pi*.01,value_trend_5_15:1+(packaging?0.4:cpo?0.18:0.05)+trend*.5,
      up_value_share_5:.45+(packaging?.18:cpo?.1:0)+di*.01,positive_days_5:packaging?4:cpo?3:2,
      change_pct:(packaging?0.35:cpo?0.65:0.1)+di*.06,return_3_pct:(packaging?1.0:cpo?1.8:.1)+di*.18,
      return_5_pct:(packaging?1.5:cpo?2.5:0.2)+di*.25,return_20_pct:(packaging?3:cpo?4:0.5)+di*.3
    });
  });
}
const result=computeBusinessFlow(profiles,activity,{maxDates:12});
assert.equal(result.dates.length,12);
const adv=result.groups.find(x=>x.tagId==='advanced_packaging_equipment');
assert(adv,'advanced_packaging_equipment should exist');
assert(adv.trajectory.length===12,'trajectory should have twelve dates');
assert(Number.isFinite(adv.x)&&Number.isFinite(adv.y),'coordinates should be finite');
assert(Number.isFinite(adv.confirmation)&&Number.isFinite(adv.overheating),'C/E should be finite');
assert(adv.phaseState&&adv.phaseLabel,'phase state should exist');
assert(adv.projection?.points?.length===3,'projection should expose 3/5/10 horizons');
assert(Number.isFinite(adv.projection.confidence),'projection confidence should be finite');
const cpo=result.groups.find(x=>x.tagId==='cpo');
assert(cpo&&cpo.validCount>=3,'CPO should aggregate multiple companies');
const cal=buildTransitionCalibration(result.groups);
assert(cal.historyDays===12,'calibration should count history days');
assert(projectGroup(adv,cal).points.length===3,'projectGroup should return three horizons');
console.log('Fundflow XY v2 + Phase validation PASS', {dates:result.dates.length,groups:result.groups.length,advancedPackaging:{x:adv.x,y:adv.y,C:adv.confirmation,E:adv.overheating,phase:adv.phaseLabel,projection:adv.projection.tendency},cpo:{x:cpo.x,y:cpo.y}});

const detail=computeTagDetail(profiles,activity,'advanced_packaging_equipment',{maxDates:10});
assert.equal(detail.trajectory.length,10,'detail trajectory should honor requested days');
assert(detail.latest&&Number.isFinite(detail.latest.x)&&Number.isFinite(detail.latest.y),'detail latest coordinates should exist');
assert(detail.latest.factors?.x?.valueRatio20!==undefined,'detail should expose X factor signals');
assert(detail.latest.factors?.y?.return3Pct!==undefined,'detail should expose 3-day Y factor');
assert(Array.isArray(detail.companies)&&detail.companies.length>=4,'detail should expose company contributions');
assert(detail.companies.every(x=>Number.isFinite(x.impactX)&&Number.isFinite(x.impactY)),'company impacts should be finite');
assert(detail.projection?.points?.length===3,'detail should expose projection');
console.log('Fundflow detail v2 validation PASS',{tag:detail.name,days:detail.trajectoryDays,companies:detail.companies.length,phase:detail.latest.phaseLabel});
