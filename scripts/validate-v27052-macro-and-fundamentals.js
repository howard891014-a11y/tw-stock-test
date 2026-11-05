'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {marginStep,estimate,marketAggregate}=require('../lib/margin-maintenance');
const {normalize}=require('../lib/cbc-usdtwd');
const data=normalize([{'日期':'115/11/02','NTD/USD':'32.600'},{'日期':'115/11/03','NTD/USD':'32.700'},{'日期':'115/11/04','NTD/USD':'32.800'}]);
assert.equal(data.date,'2026-11-04');assert.equal(data.rate,32.8);assert.equal(data.previous,32.7);
const r1=marginStep(null,{trade_date:'2026-10-31',margin_prev_balance:60,margin_buy:40,margin_sell:0,margin_cash_repay:0,margin_balance:100,close_price:100,trade_volume:1000,trade_value:100000});
assert.equal(r1.valid,true);assert.equal(r1.cost,100);assert.equal(r1.unknown,60);
const r2=marginStep(r1,{trade_date:'2026-11-01',margin_prev_balance:100,margin_buy:20,margin_sell:20,margin_cash_repay:0,margin_balance:100,close_price:80,trade_volume:1000,trade_value:80000});
assert.equal(r2.cost,96);assert.equal(r2.unknown,48);assert.equal(estimate(r2).pct,138.89);
assert.equal(marginStep(r2,{trade_date:'2026-11-02',margin_prev_balance:100,margin_buy:10,margin_sell:10,margin_cash_repay:4,margin_balance:100,close_price:80,trade_volume:100,trade_value:8000}).valid,false);
const market=marketAggregate([{marketDate:'2026-11-01',row:{margin_balance:100},state:r2}], '2026-11-01');
assert.equal(market.pct,138.89);assert.equal(market.coverage,100);assert.equal(market.unknownSharePct,48);
const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),quote=fs.readFileSync(path.join(root,'lib/api-routes/fundamentals.js'),'utf8');
for(const id of ['marketUsdTwd','marketMarginEstimate','creditMarginEstimate'])assert.match(index,new RegExp(`id="${id}"`));
assert.match(app,/loadStockzoneMacro/);assert.match(quote,/Never gate access to income statements/);
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'2.7.0.53');
(async()=>{
 const oldFetch=global.fetch;
 global.fetch=async(url,options={})=>{
  if(options.method==='POST')return {ok:true,text:async()=>''};
  let rows=[];
  if(String(url).includes('/t187ap06_L_ci'))rows=[{'公司代號':'2330','公司名稱':'台積電','年度':'115','季別':'3','營業收入':'1000','營業毛利':'500','營業利益':'300','基本每股盈餘(元)':'14'}];
  if(String(url).includes('/t187ap17_L'))rows=[{'公司代號':'2330','年度':'115','季別':'2','毛利率(%)':'45','營業利益率(%)':'25'}];
  return {ok:true,headers:{get:()=> 'application/json'},json:async()=>rows,text:async()=>''};
 };
 try{
  const handler=require('../lib/api-routes/fundamentals');
  let status=0,payload=null;
  const req={query:{q:'2330',market:'上市'}};
  const res={setHeader(){},status(n){status=n;return this},json(p){payload=p;return this}};
  await handler(req,res);
  assert.equal(status,200);assert.equal(payload.officialStatement.eps,14);
  assert.equal(payload.officialStatement.period,'2026 Q3');
  assert.equal(payload.officialStatement.grossMargin,50,'Q3 ratio must use Q3 revenue and Q3 gross profit');
  assert.equal(payload.officialStatement.operatingMargin,30,'Q3 ratio must use Q3 revenue and Q3 operating income');
  assert.equal(payload.marginStatement.period,'2026 Q2');
  assert.equal(payload.marginStatement.grossMargin,45);
  console.log('v2.7.0.53 macro+fundamental validation PASS');
 }finally{global.fetch=oldFetch}
})().catch(e=>{console.error(e);process.exitCode=1});
