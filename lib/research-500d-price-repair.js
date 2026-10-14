'use strict';
// One-time recovery for 500D records produced before stock-price session-gap
// protection. Only Y and 1D return labels are corrected. X, institutional
// flow, industry membership, live snapshots and the 500D counter are untouched.
// Keep a rollback copy of ORIGINAL labels for every repaired day/tag.
const {getSql}=require('./db');
const {fetchTwseHistoricalRows,fetchTpexHistoricalRows}=require('./sync-service');
const {earlierWeekdays}=require('./research-500d-official');
const iso=x=>x instanceof Date?x.toISOString().slice(0,10):String(x||'').slice(0,10);
const datePlus=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)};
const weekday=d=>![0,6].includes(new Date(d+'T00:00:00Z').getUTCDay());
// Repair only dates already stored when this defect was discovered (through
// 2026-10-13). Subsequent official backfills use the new session-calendar guard
// and must not be silently rewritten by this one-time recovery.
const LAST_AFFECTED_DAY='2026-10-13';
async function ensureRepairTables(sql){
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_price_repair_cache (
 trade_date date NOT NULL,stock_code text NOT NULL,market text NOT NULL,close_price numeric NOT NULL,
 PRIMARY KEY(trade_date,stock_code,market))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_price_repair_calendar (
 trade_date date PRIMARY KEY,status text NOT NULL CHECK(status IN ('trading','closed')))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_price_repair_backup (
 trade_date date NOT NULL,tag_id text NOT NULL,old_y_score numeric,old_return_1_pct numeric,backed_up_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(trade_date,tag_id))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_price_repair_done (
 trade_date date PRIMARY KEY,updated_rows int NOT NULL DEFAULT 0,checked_at timestamptz NOT NULL DEFAULT NOW())`);
}
async function repairStatus(sql=getSql()){
 const [r,price]=await Promise.all([
  sql.query(`SELECT MIN(trade_date)::text first,COUNT(DISTINCT trade_date)::int n FROM market_business_xy2_research_daily WHERE trade_date<=$1::date`,[LAST_AFFECTED_DAY]),
  sql.query(`SELECT MIN(trade_date)::text first FROM market_daily_history`)
 ]);
 const first=iso(r[0]?.first),raw=iso(price[0]?.first),last=LAST_AFFECTED_DAY;
 const dates=await sql.query(`SELECT DISTINCT r.trade_date::text d FROM market_business_xy2_research_daily r WHERE r.trade_date<=$1::date ORDER BY d`,[last]);
 const done=await sql.query(`SELECT trade_date::text d,updated_rows FROM market_research500_price_repair_done`).catch(()=>[]);
 const marked=new Set(done.map(x=>iso(x.d))),pending=dates.map(x=>iso(x.d)).filter(d=>!marked.has(d));
 return {firstDate:first,rawFirstDate:raw,lastAffectedDate:last,totalDays:dates.length,completedDays:dates.length-pending.length,
   remainingDays:pending.length,nextDate:pending[0]||null,complete:pending.length===0};
}
async function seedCache(sql,first,rawFirst){
 const warm=earlierWeekdays(first,12)[0];
 // Older official stage may still contain the price warmup. Copy it before the
 // 500D official rolling buffer advances and prunes these stock rows.
 await sql.query(`INSERT INTO market_research500_price_repair_cache(trade_date,stock_code,market,close_price)
 SELECT trade_date,stock_code,market,close_price FROM market_research500_official_stage
 WHERE trade_date BETWEEN $1::date AND ($2::date-1) AND close_price>0
 ON CONFLICT DO NOTHING`,[warm,rawFirst]);
 await sql.query(`INSERT INTO market_research500_price_repair_calendar(trade_date,status)
 SELECT trade_date,status FROM market_research500_official_calendar
 WHERE trade_date BETWEEN $1::date AND ($2::date-1) ON CONFLICT DO NOTHING`,[warm,rawFirst]);
 const listed=await sql.query(`SELECT trade_date::text d FROM market_research500_price_repair_calendar
 WHERE trade_date BETWEEN $1::date AND ($2::date-1)`,[warm,rawFirst]);
 const known=new Set(listed.map(x=>iso(x.d))),missing=[];
 for(let d=warm;d<rawFirst;d=datePlus(d,1))if(weekday(d)&&!known.has(d))missing.push(d);
 return {warm,missing};
}
async function fetchMissingPriceDay(sql,d,fetchPrices=[fetchTwseHistoricalRows,fetchTpexHistoricalRows]){
 const [a,b]=await Promise.all(fetchPrices.map(f=>f(d)));
 if(a?.nonTrading&&b?.nonTrading){await sql.query(`INSERT INTO market_research500_price_repair_calendar VALUES($1,'closed') ON CONFLICT(trade_date) DO UPDATE SET status='closed'`,[d]);return 0;}
 if((a?.rows||[]).length<300||(b?.rows||[]).length<200)throw Error(`historical-price-insufficient-coverage:${d}`);
 const m=await sql.query('SELECT DISTINCT stock_code,market FROM market_business_xy2_member');
 const allowed=new Set(m.map(x=>`${x.market}|${x.stock_code}`));
 const rows=[...a.rows,...b.rows].filter(x=>iso(x.trade_date)===d&&allowed.has(`${x.market}|${x.stock_code}`)&&Number(x.close_price)>0)
  .map(x=>({trade_date:d,stock_code:String(x.stock_code),market:x.market,close_price:Number(x.close_price)}));
 if(rows.length<1100)throw Error(`historical-price-insufficient-covered-members:${d}:${rows.length}`);
 const wrote=await sql.query(`WITH data AS(SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(trade_date date,stock_code text,market text,close_price numeric))
 INSERT INTO market_research500_price_repair_cache(trade_date,stock_code,market,close_price)
 SELECT trade_date,stock_code,market,close_price FROM data ON CONFLICT DO NOTHING RETURNING 1`,[JSON.stringify(rows)]);
 await sql.query(`INSERT INTO market_research500_price_repair_calendar VALUES($1,'trading') ON CONFLICT(trade_date) DO UPDATE SET status='trading'`,[d]);
 return wrote.length;
}
// Price source: bounded official PRICE-only cache up to raw retention boundary;
// operational raw price table thereafter. Institutional observations are never
// used to determine price-day availability. Session LAG is over whole-market
// dates, not per-stock records.
const RECONSTRUCT_PRICE_SQL=`WITH source_prices AS MATERIALIZED(
 SELECT trade_date,stock_code,market,close_price::double precision p FROM market_research500_price_repair_cache
 WHERE trade_date>=$1::date AND trade_date<$2::date
 UNION ALL
 SELECT trade_date,stock_code,market,close_price::double precision p FROM market_daily_history
 WHERE trade_date>=$2::date AND trade_date<=$3::date AND close_price>0
 ),
 calendar AS(SELECT d,LAG(d,1) OVER(ORDER BY d) prev1,LAG(d,5) OVER(ORDER BY d) prev5 FROM
 (SELECT DISTINCT trade_date AS d FROM source_prices)x),
 cohort AS (SELECT r.trade_date,r.tag_id FROM market_business_xy2_research_daily r
 WHERE r.trade_date=ANY($4::date[])),
 parts AS(SELECT t.trade_date,t.tag_id,m.weight,
 CASE WHEN a.p>0 AND b.p>0 THEN 100*(a.p/b.p-1) END r1,
 CASE WHEN a.p>0 AND c.p>0 THEN 100*(a.p/c.p-1) END r5
 FROM cohort t JOIN calendar x ON x.d=t.trade_date JOIN market_business_xy2_member m USING(tag_id)
 LEFT JOIN source_prices a ON a.trade_date=t.trade_date AND a.stock_code=m.stock_code AND a.market=m.market
 LEFT JOIN source_prices b ON b.trade_date=x.prev1 AND b.stock_code=m.stock_code AND b.market=m.market
 LEFT JOIN source_prices c ON c.trade_date=x.prev5 AND c.stock_code=m.stock_code AND c.market=m.market),
 summaries AS(SELECT trade_date,tag_id,
 SUM(weight*r1)/NULLIF(SUM(weight) FILTER(WHERE r1 IS NOT NULL),0) ret1,
 SUM(weight*r5)/NULLIF(SUM(weight) FILTER(WHERE r5 IS NOT NULL),0) y5,
 COUNT(r1)::int valid1,COUNT(r5)::int valid5,COUNT(*)::int members
 FROM parts GROUP BY trade_date,tag_id)
 SELECT trade_date::text trade_date,tag_id,ret1,y5,valid1,valid5,members FROM summaries ORDER BY trade_date,tag_id`;
async function repairNext({sql=getSql(),fetchPrices}={}){
 await ensureRepairTables(sql);
 const state=await repairStatus(sql);
 if(state.complete)return {ok:true,complete:true,updatedRows:0,after:state};
 if(!state.firstDate||!state.rawFirstDate)return {ok:false,reason:'research-or-raw-data-missing'};
 const cache=await seedCache(sql,state.firstDate,state.rawFirstDate);
 if(cache.missing.length){
  let written=0;const fetched=[];
  for(const d of cache.missing.slice(0,3)){written+=await fetchMissingPriceDay(sql,d,fetchPrices);fetched.push(d);}
  return {ok:true,phase:'fetch-official-price',dates:fetched,stagedRows:written,remainingOfficialWeekdays:cache.missing.length-fetched.length,after:state};
 }
 const pending=await sql.query(`SELECT DISTINCT r.trade_date::text d FROM market_business_xy2_research_daily r
 LEFT JOIN market_research500_price_repair_done z ON z.trade_date=r.trade_date
 WHERE r.trade_date<=$1::date AND z.trade_date IS NULL ORDER BY d LIMIT 6`,[LAST_AFFECTED_DAY]);
 const days=pending.map(x=>iso(x.d));if(!days.length)return {ok:true,complete:true,after:await repairStatus(sql)};
 const rows=await sql.query(RECONSTRUCT_PRICE_SQL,[cache.warm,state.rawFirstDate,days.at(-1),days]);
 const byDay=new Map();for(const r of rows){let a=byDay.get(iso(r.trade_date));if(!a){a=[];byDay.set(iso(r.trade_date),a);}a.push(r);}
 for(const d of days){const a=byDay.get(d)||[];if(a.length<190)throw Error(`repair-label-coverage:${d}:${a.length}`);
  const n1=a.filter(x=>Number(x.valid1)>=Math.max(1,Math.ceil(Number(x.members)*.65))).length;
  const n5=a.filter(x=>Number(x.valid5)>=Math.max(1,Math.ceil(Number(x.members)*.65))).length;
  if(n1<180||n5<180)throw Error(`repair-price-coverage:${d}:${n1}:${n5}`);
 }
 // Strictly preserve the original values before a single bounded UPDATE.
 await sql.query(`INSERT INTO market_research500_price_repair_backup(trade_date,tag_id,old_y_score,old_return_1_pct)
 SELECT trade_date,tag_id,y_score,return_1_pct FROM market_business_xy2_research_daily
 WHERE trade_date=ANY($1::date[]) ON CONFLICT DO NOTHING`,[days]);
 const valid=rows.filter(r=>Number(r.valid1)>=Math.max(1,Math.ceil(Number(r.members)*.65))&&
  Number(r.valid5)>=Math.max(1,Math.ceil(Number(r.members)*.65))&&r.ret1!==null&&r.y5!==null)
  .map(r=>({trade_date:iso(r.trade_date),tag_id:r.tag_id,ret1:Number(r.ret1),y5:Number(r.y5)}));
 const wrote=await sql.query(`WITH data AS(SELECT * FROM jsonb_to_recordset($1::jsonb) AS t(trade_date date,tag_id text,ret1 numeric,y5 numeric))
 UPDATE market_business_xy2_research_daily r SET return_1_pct=ROUND(d.ret1,10),y_score=ROUND(d.y5,4),updated_at=NOW()
 FROM data d WHERE r.trade_date=d.trade_date AND r.tag_id=d.tag_id
 AND (ABS(COALESCE(r.return_1_pct,0)-d.ret1)>0.001 OR ABS(COALESCE(r.y_score,0)-d.y5)>0.001)
 RETURNING r.tag_id`,[JSON.stringify(valid)]);
 await sql.query(`INSERT INTO market_research500_price_repair_done(trade_date,updated_rows)
 SELECT v.d::date,$2::int FROM unnest($1::date[]) v(d)
 ON CONFLICT (trade_date) DO NOTHING`,[days,wrote.length]);
 const after=await repairStatus(sql);
 if(after.complete){
  await sql.query(`DELETE FROM market_research500_price_repair_cache`);
  await sql.query(`DELETE FROM market_research500_price_repair_calendar`);
 }
 return {ok:true,phase:'recalculate-price-labels',dates:days,updatedRows:wrote.length,after,complete:after.complete,
  preserved:['x_score','flow_1_pct','flow_5_pct','price_breadth','activation_rate','research-date-count'],
  backupTable:'market_research500_price_repair_backup'};
}
module.exports={LAST_AFFECTED_DAY,RECONSTRUCT_PRICE_SQL,repairStatus,repairNext,ensureRepairTables,seedCache,fetchMissingPriceDay};
