'use strict';
/** D candidate research adapter. READ ONLY, no cron, API route or database writes.
 * Every source is Neon and dated to the SAME completed T session.
 * W3 and V4 executed by original (unmodified) JS modules.
 */
const {getSql,getDatabaseUrl}=require('./db');
const {fetchW3D112Inputs}=require('./w3-d112-inputs');
const {computeW3D112}=require('./w3-d112');
const {FEATURE_QUERY,DATES_QUERY,W3_CHECK_QUERY}=require('./featured-neon-daily');
const {VERSION:CAPITAL_METHOD}=require('./capital-flow-money');
const {selectFrozenD}=require('./stockzone-d-policy');
const {selectFivePlusFiveDaily}=require('./stockzone-five-plus-five');
const STAGE='D-FORWARD-RESEARCH-ONLY';
const MONEY_QUERY=`SELECT tag_id,flow_5_e8,core_valid_5
 FROM market_capital_flow_money_daily
 WHERE trade_date=$1::date AND method_version=$2::text`;
const FINANCE_QUERY=`SELECT market,stock_code
 FROM market_business_xy2_member WHERE tag_id='finance' AND importance='core'`;
const PRICE_BREADTH_QUERY=`SELECT tag_id,price_breadth FROM market_business_xy2_topic_daily
 WHERE trade_date=$1::date`;
const FLOW1_QUERY=`SELECT market,stock_code,raw_flow_1_pct FROM market_business_xy2_stock_daily
 WHERE trade_date=$1::date AND stock_code=ANY($2::text[])`;
// T-day close vs PREVIOUS actual exchange session close, listed & OTC only.
// No stale previous_close proxies; scope validation prevents partial-market buys.
const MARKET_BREADTH_QUERY=`WITH prev AS (
 SELECT MAX(trade_date) AS d FROM market_daily_history WHERE trade_date<$1::date
), pairs AS (
 SELECT t.market,t.stock_code,t.close_price today,p.close_price yesterday
 FROM market_daily_history t JOIN market_daily_history p
 ON p.trade_date=(SELECT d FROM prev) AND p.market=t.market AND p.stock_code=t.stock_code
 WHERE t.trade_date=$1::date AND t.market IN ('上市','上櫃')
 AND t.stock_code ~ '^[1-9][0-9]{3}$' AND t.close_price>0 AND p.close_price>0
)
SELECT COUNT(*)::int priced,
 COUNT(*) FILTER(WHERE today>yesterday)::int advancing,
 COUNT(*) FILTER(WHERE today<yesterday)::int declining,
 100.0*COUNT(*) FILTER(WHERE today>yesterday)/NULLIF(COUNT(*),0) AS breadth_up_pct
 FROM pairs`;
function ensureNeon(){
 const url=getDatabaseUrl();
 let host='';try{host=new URL(url).hostname;}catch{}
 if(!host.endsWith('.neon.tech'))throw Error('D_LOCKED: official Neon URL required; no Supabase/fallback');
}
function date(s){return s instanceof Date?s.toISOString().slice(0,10):String(s||'').slice(0,10);}
async function getDPreview({sql,inputsFetcher=fetchW3D112Inputs,skipConnectionCheck=false,withBaseline=false}={}){
 if(!skipConnectionCheck)ensureNeon();
 const db=sql||getSql();
 const meta=(await db.query(DATES_QUERY))?.[0];
 if(!meta)throw Error('D_LOCKED: Neon source dates missing');
 const required=['latest_sector','latest_stockflow','latest_w3','latest_price','latest_market'];
 const days=required.map(k=>date(meta[k]));
 if(days.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)||x!==days[0]))throw Error('D_LOCKED: mixed source dates, no recommendations');
 const asOfDate=days[0];
 const saved=(await db.query(W3_CHECK_QUERY,[asOfDate]))?.[0];
 if(date(saved?.trade_date)!==asOfDate||saved?.model_version!=='W3-D.1.2')throw Error('D_LOCKED: missing official W3-D.1.2 stored result');
 const inputs=(await inputsFetcher(db)).filter(x=>date(x.date)<=asOfDate);
 if(inputs.at(-1)?.date!==asOfDate)throw Error('D_LOCKED: missing as-of-T frozen W3 input');
 const records=computeW3D112(inputs).records;
 const last=records.at(-1);
 if(!last||!last.valid||last.inputQuality!=='complete')throw Error('D_LOCKED: W3 input unverified; no buys');
 if(last.regime!==saved.regime)throw Error('D_LOCKED: Neon stored W3 and original JS differ');
 if(last.regime==='RiskOff'){
  const data=selectFrozenD({rawRows:[],marketRecords:records,asOfDate});
  return {...data,adapter:STAGE,neonMoneyVersion:CAPITAL_METHOD,dataComplete:true,
   ...(withBaseline?{baseline:{asOfDate,scene:'OFF',core:[],extended:[],model:'StockZone-V4-5plus5-original_all'}}:{})};
 }
 const [rawRows,moneyRows,financeRows]=(await Promise.all([
  db.query(FEATURE_QUERY,[asOfDate]),db.query(MONEY_QUERY,[asOfDate,CAPITAL_METHOD]),db.query(FINANCE_QUERY)
 ]));
 if(!Array.isArray(rawRows)||rawRows.length===0)throw Error('D_LOCKED: insufficient V4 candidate universe');
 const financeCoreKeys=new Set(financeRows.map(x=>`${x.market}|${x.stock_code}`));
 let marketBreadth=null,stockFlow1=new Map();
 if(last.warning){
  const [industryBreadth,flows,mkt]=(await Promise.all([
   db.query(PRICE_BREADTH_QUERY,[asOfDate]),
   db.query(FLOW1_QUERY,[asOfDate,[...new Set(rawRows.map(x=>x.stock_code))]]),
   db.query(MARKET_BREADTH_QUERY,[asOfDate]),
  ]));
  const industrial=new Map(industryBreadth.map(x=>[x.tag_id,x.price_breadth]));
  rawRows.forEach(x=>{x.price_breadth=industrial.get(x.tag_id);});
  stockFlow1=new Map(flows.map(x=>[`${x.market}|${x.stock_code}`,x.raw_flow_1_pct]));
  if(Number(mkt?.[0]?.priced)<1500)throw Error('D_LOCKED: market breadth priced stock coverage too low');
  marketBreadth=mkt?.[0]?.breadth_up_pct;
 }
 const selection=selectFrozenD({rawRows,marketRecords:records,moneyRows,financeCoreKeys,stockFlow1,marketBreadth,asOfDate});
 const original=withBaseline?selectFivePlusFiveDaily(rawRows,selection.w3Visible,Number(last.advanceRatio),{asOfDate,scenario:'original_all'}):null;
 return {...selection,...(withBaseline?{baseline:{asOfDate,scene:original.scene,model:'StockZone-V4-5plus5-original_all',
   core:original.core.map(r=>({stock_code:r.stock_code,stock_name:r.stock_name||'',market:r.market,tag_id:r.tag_id,
    v4Score:Number(r.s2r3Score),originalV4Rank:r.rank,allocationPct:20,slot:r.rank,track:'ORIGINAL_V4'})),
   extended:original.extended.map(r=>({stock_code:r.stock_code,market:r.market,tag_id:r.tag_id,rank:r.rank}))}}:{}),
  adapter:STAGE,neonMoneyVersion:CAPITAL_METHOD,
  dataComplete:true,readOnly:true,
  independentSqlResearchParity:false,
  warning:'Neon original JS forward preview ONLY: historical Supabase SQL selections and actual trade execution not reproduced.'};
}
module.exports={STAGE,MONEY_QUERY,FINANCE_QUERY,PRICE_BREADTH_QUERY,FLOW1_QUERY,MARKET_BREADTH_QUERY,getDPreview};
