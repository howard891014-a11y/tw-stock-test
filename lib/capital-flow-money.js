'use strict';
// StockZone money-valued institutional capital flows. Independent of existing X20/
// XY, market regimes, recommendation, and relative flow intensity.
const getSql=()=>require('./db').getSql();
const VERSION='capital-money-corebreadth50-samecore100-v1';
const day = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value||'').slice(0,10);
const finite = value => value===null||value===undefined ? null : (Number.isFinite(Number(value)) ? Number(value):null);

const CREATE_SQL=`CREATE TABLE IF NOT EXISTS market_capital_flow_money_daily (
 trade_date date NOT NULL,
 tag_id text NOT NULL,
 flow_1_e8 numeric(20,5),
 flow_5_e8 numeric(20,5),
 core_1_e8 numeric(20,5),
 core_5_e8 numeric(20,5),
 related_1_e8 numeric(20,5),
 related_5_e8 numeric(20,5),
 core_valid_1 integer NOT NULL DEFAULT 0,
 core_valid_5 integer NOT NULL DEFAULT 0,
 core_buy_1 integer NOT NULL DEFAULT 0,
 core_buy_5 integer NOT NULL DEFAULT 0,
 core_sell_1 integer NOT NULL DEFAULT 0,
 core_sell_5 integer NOT NULL DEFAULT 0,
 method_version text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY (trade_date, tag_id)
)`;

// Query is scoped to a single ready trade date, and only five exchange trading
// dates are scanned.  Only members with a confirmed core tag are eligible;
// four temporarily core-less tags are intentionally excluded.
// The stock's allocation across ALL eligible core/related memberships sums to 1.
const UPSERT_SQL=`WITH days AS MATERIALIZED (
 SELECT trade_date FROM (SELECT DISTINCT trade_date FROM market_daily_history WHERE trade_date<=$1::date ORDER BY trade_date DESC LIMIT 5) x
), oldest AS (SELECT COUNT(*) n FROM days),
prices AS MATERIALIZED (
 SELECT d.trade_date,i.stock_code,i.market,
        (i.total_net::numeric*h.close_price)/100000000.0 AS net_e8
 FROM days d
 JOIN institutional_trading_daily i USING(trade_date)
 JOIN market_daily_history h ON h.trade_date=i.trade_date AND h.stock_code=i.stock_code AND h.market=i.market
 WHERE i.total_net IS NOT NULL AND h.close_price>0 AND h.trade_value>0
), stock_money AS MATERIALIZED (
 SELECT stock_code,market,
   MAX(net_e8) FILTER(WHERE trade_date=$1::date) net1,
   SUM(net_e8) AS net5,
   COUNT(*) AS observed_days,
   COUNT(*) FILTER(WHERE trade_date=$1::date) AS latest_rows
 FROM prices GROUP BY 1,2
), flows AS MATERIALIZED (
 SELECT 1 AS p,stock_code,market,net1 AS cash FROM stock_money WHERE latest_rows=1
 UNION ALL
 SELECT 5 AS p,stock_code,market,net5 FROM stock_money WHERE observed_days=(SELECT n FROM oldest) AND (SELECT n FROM oldest)=5 AND latest_rows=1
), valid_tags AS MATERIALIZED (
 SELECT tag_id FROM market_business_xy2_member GROUP BY tag_id HAVING COUNT(*) FILTER(WHERE importance='core')>0
), members AS MATERIALIZED (
 SELECT m.tag_id,m.stock_code,m.market,m.importance,
 COUNT(*) FILTER(WHERE m.importance='core') OVER(PARTITION BY m.stock_code,m.market) nc,
 COUNT(*) FILTER(WHERE m.importance='related') OVER(PARTITION BY m.stock_code,m.market) nr
 FROM market_business_xy2_member m JOIN valid_tags USING(tag_id)
), core_stats AS MATERIALIZED (
 SELECT f.p,m.tag_id,
 COUNT(*) FILTER(WHERE m.importance='core') AS core_valid,
 COUNT(*) FILTER(WHERE m.importance='core' AND f.cash>0) AS core_buy,
 COUNT(*) FILTER(WHERE m.importance='core' AND f.cash<0) AS core_sell,
 SUM(CASE WHEN m.importance='core' AND f.cash>0 THEN f.cash/m.nc ELSE 0 END) AS core_pos_gross,
 SUM(CASE WHEN m.importance='core' AND f.cash<0 THEN -f.cash/m.nc ELSE 0 END) AS core_neg_gross
 FROM flows f JOIN members m USING(stock_code,market) GROUP BY 1,2
), related_weights AS MATERIALIZED (
 SELECT f.p,f.stock_code,f.market,m.tag_id,f.cash,
 CASE WHEN m.nc>0 AND m.nr>0 AND s.core_valid>0 AND f.cash<>0
 AND ((f.cash>0 AND s.core_buy::numeric/NULLIF(s.core_valid,0)>0.50) OR
      (f.cash<0 AND s.core_sell::numeric/NULLIF(s.core_valid,0)>0.50))
 THEN LEAST(
   0.2::numeric/(m.nc+0.2*m.nr),
   (CASE WHEN f.cash>0 THEN s.core_pos_gross ELSE s.core_neg_gross END)/NULLIF(ABS(f.cash),0))
 ELSE 0::numeric END AS contribution_weight
 FROM flows f JOIN members m USING(stock_code,market)
 JOIN core_stats s ON s.p=f.p AND s.tag_id=m.tag_id
 WHERE m.importance='related' AND m.nc>0
), related_used AS MATERIALIZED (
 SELECT p,stock_code,market,SUM(contribution_weight) AS allocated_related
 FROM related_weights GROUP BY 1,2,3
), allocations AS MATERIALIZED (
 SELECT f.p,m.tag_id,'core' AS source_type,
 f.cash*(1-COALESCE(u.allocated_related,0))/m.nc AS amount
 FROM flows f JOIN members m USING(stock_code,market)
 LEFT JOIN related_used u ON u.p=f.p AND u.stock_code=f.stock_code AND u.market=f.market
 WHERE m.importance='core'
 UNION ALL
 SELECT p,tag_id,'related',cash*contribution_weight FROM related_weights
), totals AS MATERIALIZED (
 SELECT p,tag_id,SUM(amount) total,
 SUM(amount) FILTER (WHERE source_type='core') core_amount,
 SUM(amount) FILTER (WHERE source_type='related') related_amount
 FROM allocations GROUP BY 1,2
), paired AS (
 SELECT s.tag_id,
 MAX(t.total) FILTER (WHERE t.p=1) flow1,
 MAX(t.total) FILTER (WHERE t.p=5) flow5,
 MAX(t.core_amount) FILTER (WHERE t.p=1) core1,
 MAX(t.core_amount) FILTER (WHERE t.p=5) core5,
 MAX(t.related_amount) FILTER (WHERE t.p=1) related1,
 MAX(t.related_amount) FILTER (WHERE t.p=5) related5,
 MAX(s.core_valid) FILTER (WHERE s.p=1) valid1,
 MAX(s.core_valid) FILTER (WHERE s.p=5) valid5,
 MAX(s.core_buy) FILTER (WHERE s.p=1) buy1,
 MAX(s.core_buy) FILTER (WHERE s.p=5) buy5,
 MAX(s.core_sell) FILTER (WHERE s.p=1) sell1,
 MAX(s.core_sell) FILTER (WHERE s.p=5) sell5
 FROM core_stats s LEFT JOIN totals t ON t.p=s.p AND t.tag_id=s.tag_id
 GROUP BY s.tag_id
)
INSERT INTO market_capital_flow_money_daily
(trade_date,tag_id,flow_1_e8,flow_5_e8,core_1_e8,core_5_e8,related_1_e8,related_5_e8,
 core_valid_1,core_valid_5,core_buy_1,core_buy_5,core_sell_1,core_sell_5,method_version)
SELECT $1::date,tag_id,flow1,flow5,core1,core5,COALESCE(related1,0),COALESCE(related5,0),
 COALESCE(valid1,0),COALESCE(valid5,0),COALESCE(buy1,0),COALESCE(buy5,0),
 COALESCE(sell1,0),COALESCE(sell5,0),$2::text
FROM paired WHERE valid1>0 OR valid5>0
ON CONFLICT (trade_date,tag_id) DO UPDATE SET
 flow_1_e8=EXCLUDED.flow_1_e8,flow_5_e8=EXCLUDED.flow_5_e8,
 core_1_e8=EXCLUDED.core_1_e8,core_5_e8=EXCLUDED.core_5_e8,
 related_1_e8=EXCLUDED.related_1_e8,related_5_e8=EXCLUDED.related_5_e8,
 core_valid_1=EXCLUDED.core_valid_1,core_valid_5=EXCLUDED.core_valid_5,
 core_buy_1=EXCLUDED.core_buy_1,core_buy_5=EXCLUDED.core_buy_5,
 core_sell_1=EXCLUDED.core_sell_1,core_sell_5=EXCLUDED.core_sell_5,
 method_version=EXCLUDED.method_version,updated_at=NOW()
WHERE market_capital_flow_money_daily.method_version IS DISTINCT FROM EXCLUDED.method_version
 OR market_capital_flow_money_daily.flow_1_e8 IS DISTINCT FROM EXCLUDED.flow_1_e8
 OR market_capital_flow_money_daily.flow_5_e8 IS DISTINCT FROM EXCLUDED.flow_5_e8
RETURNING tag_id`;

const LOAD_SQL=`SELECT trade_date,tag_id,flow_1_e8,flow_5_e8,core_1_e8,core_5_e8,
 related_1_e8,related_5_e8,core_valid_1,core_valid_5,core_buy_1,core_buy_5,core_sell_1,core_sell_5
 FROM market_capital_flow_money_daily WHERE trade_date=$1::date AND method_version=$2::text`;
const COVERAGE_SQL=`WITH recent AS (
 SELECT trade_date FROM (SELECT DISTINCT trade_date FROM market_daily_history WHERE trade_date<=$1::date ORDER BY trade_date DESC LIMIT 2) d
), counts AS (
 SELECT h.trade_date,COUNT(DISTINCT h.stock_code||':'||h.market)::int AS covered
 FROM recent d JOIN market_daily_history h USING(trade_date)
 JOIN institutional_trading_daily i ON i.trade_date=h.trade_date AND i.stock_code=h.stock_code AND i.market=h.market
 WHERE h.close_price>0 AND h.trade_value>0 AND i.total_net IS NOT NULL GROUP BY h.trade_date
)
SELECT COALESCE(MAX(covered) FILTER (WHERE trade_date=$1::date),0) AS price_stocks,
 COALESCE(MAX(covered) FILTER (WHERE trade_date<$1::date),0) AS prior_stocks FROM counts`;
let schemaReady=false, pending=null;
async function ensureSchema(sql){if(schemaReady)return;await sql.query(CREATE_SQL);schemaReady=true;}
async function refreshMoney(asOf,sql=getSql()){
 const target=day(asOf);if(!/^20\d{2}-\d{2}-\d{2}$/.test(target))throw Error('資金日期格式不正確');
 const [rows]=await Promise.all([sql.query(COVERAGE_SQL,[target])]);
 const count=Number(rows?.[0]?.price_stocks)||0, prior=Number(rows?.[0]?.prior_stocks)||0;
 // Do not persist a partial close while one source is still importing.
 if(count<1500 || (prior>=1500 && count<prior*0.97))
   return {ok:false,reason:'法人或收盤價尚未完整同步',date:target,coveredStocks:count,previousCoveredStocks:prior};
 await ensureSchema(sql);
 const written=await sql.query(UPSERT_SQL,[target,VERSION]);
 return {ok:true,date:target,coveredStocks:count,changedRows:written?.length||0};
}
function asData(row){return {
 money1E8:finite(row.flow_1_e8),money5E8:finite(row.flow_5_e8),
 moneyCore1E8:finite(row.core_1_e8),moneyCore5E8:finite(row.core_5_e8),
 moneyRelated1E8:finite(row.related_1_e8),moneyRelated5E8:finite(row.related_5_e8),
 moneyCoreValid1:Number(row.core_valid_1)||0,moneyCoreValid5:Number(row.core_valid_5)||0,
 moneyCoreBuy1:Number(row.core_buy_1)||0,moneyCoreBuy5:Number(row.core_buy_5)||0,
 moneyCoreSell1:Number(row.core_sell_1)||0,moneyCoreSell5:Number(row.core_sell_5)||0
};}
async function loadMoney(target,sql=getSql(),tryRefresh=true){
 const dateKey=day(target);if(!dateKey)return {ready:false,asOf:null,rows:new Map()};
 // Fresh installations don't have this optional cache table yet.
 let rows=[];
 try{rows=await sql.query(LOAD_SQL,[dateKey,VERSION]);}
 catch(err){if(err.code!=='42P01' && !/does not exist/i.test(String(err.message||'')))throw err;}
 if(tryRefresh && rows.length<180){
   if(!pending)pending=refreshMoney(dateKey,sql).finally(()=>{pending=null;});
   const result=await pending;
   if(result.ok)rows=await sql.query(LOAD_SQL,[dateKey,VERSION]);
 }
 return {ready:rows.length>=180,asOf:dateKey,rows:new Map(rows.map(x=>[String(x.tag_id),asData(x)])),version:VERSION};
}
module.exports={VERSION,CREATE_SQL,UPSERT_SQL,LOAD_SQL,COVERAGE_SQL,refreshMoney,loadMoney,asData};
