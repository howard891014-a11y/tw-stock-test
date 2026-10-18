'use strict';
// READ ONLY. Pull the same native per-stock source underlying StockZone's 120D market cards.
// Never use summed share counts as if they were money, nor aggregate exchange-level net values.
// Seed is only for the pre-credit-history 2026-04..06 warm-up window, verified against
// official TWSE MI_MARGN shares*close. This is not a Neon 120D historical snapshot.
const {getSql}=require('./db');
const officialFinanceSeed=require('./w3-d111-2026-finance-seed.json');
const fnum=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const dstr=x=>x instanceof Date?x.toISOString().slice(0,10):String(x).slice(0,10);
const VALUE_SQL=`WITH priced AS (
 SELECT p.trade_date,p.market,
 COUNT(*)::int AS universe,
 COUNT(i.total_net)::int AS matched,
 SUM((i.foreign_net::numeric+i.trust_net::numeric+i.dealer_net::numeric)*p.close_price::numeric) AS value_twd
 FROM market_daily_history p
 LEFT JOIN institutional_trading_daily i USING(trade_date,stock_code,market)
 WHERE p.market IN ('上市','上櫃')
   AND p.stock_code ~ '^[1-9][0-9]{3}$'
   AND p.close_price > 0 AND p.trade_value > 0
 GROUP BY p.trade_date,p.market
) SELECT trade_date::text AS date,COUNT(*)::int AS markets,
 BOOL_AND(universe >= 150 AND matched >= GREATEST(120,CEIL(universe*0.8))) AS complete,
 SUM(universe)::int AS universe,
 SUM(matched)::int AS matched,
 SUM(value_twd)::text AS value_twd
 FROM priced GROUP BY trade_date ORDER BY trade_date`;
const FINANCE_SQL=`SELECT c.trade_date::text AS date,
 COUNT(*)::int AS stock_count,
 SUM(c.margin_balance::numeric*p.close_price::numeric)::text AS value_twd
 FROM credit_trading_daily c
 JOIN market_daily_history p USING(trade_date,stock_code,market)
 WHERE c.market='上市' AND c.stock_code ~ '^[1-9][0-9]{3}$'
 AND c.margin_balance>=0 AND p.close_price>0 AND p.trade_value>0
 GROUP BY c.trade_date ORDER BY c.trade_date`;
const MARKET_SQL=`SELECT trade_date::text AS date,taiex_close::text AS taiex,
 advance_ratio::text AS advance_ratio,breadth_5::text AS breadth5,
 up_count::int AS up_count,down_count::int AS down_count
 FROM market_dynamic_daily ORDER BY trade_date`;
async function fetchW3D111Inputs(sql=getSql()){
 const [market,institutional,finance]=await Promise.all([
  sql.query(MARKET_SQL),sql.query(VALUE_SQL),sql.query(FINANCE_SQL)
 ]);
 const im=new Map(institutional.map(z=>[dstr(z.date),z]));
 const fm=new Map(finance.map(z=>[dstr(z.date),z]));
 return market.map(m=>{
  const date=dstr(m.date),institution=im.get(date),margin=fm.get(date);
  const coverage=Number(institution?.matched||0)/Math.max(1,Number(institution?.universe||0));
  const complete=Boolean(institution?.complete)&&Number(institution?.markets)===2&&coverage>=.8;
  // The user's 2026-10-16 latest day was only 978 directional stocks. Missing data is NOT a strong bullish signal.
  const breadthReliable=Number(m.up_count||0)+Number(m.down_count||0)>=1200;
  const liveFin=Number(margin?.stock_count)>=750?fnum(margin.value_twd):null;
  const legacyFin=Object.hasOwn(officialFinanceSeed,date)?officialFinanceSeed[date]:null;
  const useSeed=liveFin===null&&legacyFin!==null;
  return {
   date,taiex:fnum(m.taiex),advance_ratio:breadthReliable?fnum(m.advance_ratio):null,
   breadth5:breadthReliable?fnum(m.breadth5):null,
   institutional_value_twd:complete?fnum(institution.value_twd):null,
   financing_value_twd:liveFin??legacyFin,
   sourceQuality:{institutionalComplete:complete,coveragePct:+(coverage*100).toFixed(2),
    pricesMatched:Number(institution?.matched||0),breadthReliable,
    financeSource:liveFin!==null?'neon-share-price':useSeed?'official-2026-warmup':'missing',
    financeStocks:Number(margin?.stock_count||0)}
  };
 });
}
module.exports={fetchW3D111Inputs,VALUE_SQL,FINANCE_SQL,MARKET_SQL};
