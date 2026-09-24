const assert=require('assert');
const {percentileRanks,computeBusinessFlow,quadrant}=require('../lib/fundflow-xy');

assert.deepStrictEqual(percentileRanks([1,2,3]).map(x=>Math.round(x)),[0,50,100]);
assert.deepStrictEqual(percentileRanks([5,5]).map(x=>Math.round(x)),[50,50]);
assert.equal(quadrant(65,40),'potential');
assert.equal(quadrant(65,65),'mainline');

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
const dates=['2026-09-16','2026-09-17','2026-09-18','2026-09-21','2026-09-22','2026-09-23'];
const activity=[];
for(let di=0;di<dates.length;di++){
  profiles.forEach((p,pi)=>{
    const packaging=['6187','2467','6640','6438'].includes(p.stock_code);
    const cpo=['3363','6442','3163'].includes(p.stock_code);
    const trend=packaging?di*0.20:cpo?di*0.12:di*0.03;
    activity.push({trade_date:dates[di],stock_code:p.stock_code,stock_name:p.stock_name,market:p.market,
      value_ratio_20:1+(packaging?0.7:cpo?0.5:0.1)+trend+pi*.01,
      value_trend_5_15:1+(packaging?0.35:cpo?0.2:0.05)+trend*.5,
      up_value_share_5:.45+(packaging?.18:cpo?.1:0)+di*.01,
      positive_days_5:packaging?4:cpo?3:2,
      change_pct:(packaging?0.4:cpo?0.7:0.1)+di*.08,
      return_5_pct:(packaging?1.5:cpo?2.5:0.2)+di*.25,
      return_20_pct:(packaging?3:cpo?4:0.5)+di*.3
    });
  });
}
const result=computeBusinessFlow(profiles,activity,{maxDates:6});
assert.equal(result.dates.length,6);
const adv=result.groups.find(x=>x.tagId==='advanced_packaging_equipment');
assert(adv,'advanced_packaging_equipment should exist');
assert(adv.trajectory.length===6,'trajectory should have six dates');
assert(Number.isFinite(adv.x)&&Number.isFinite(adv.y),'coordinates should be finite');
assert(adv.validCount>=4,'advanced packaging equipment should aggregate multiple companies');
const cpo=result.groups.find(x=>x.tagId==='cpo');
assert(cpo&&cpo.validCount>=3,'CPO should aggregate multiple companies');
console.log('Fundflow XY validation PASS', {dates:result.dates.length,groups:result.groups.length,advancedPackaging:{x:adv.x,y:adv.y,dx3:adv.dx3,status:adv.statusLabel},cpo:{x:cpo.x,y:cpo.y}});
