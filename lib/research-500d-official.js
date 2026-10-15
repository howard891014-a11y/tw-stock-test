'use strict';
// Manually triggered 500D official backfill. Official-only for pre-retention
// dates; a bounded, research-only scratch buffer bridges the 45D causal warmup.
// NEVER writes operational raw 120D/90D tables, snapshots, tags or forecasts.
const {getSql}=require('./db');
const {STORAGE_POLICY}=require('./storage-policy');
const {fetchTwseHistoricalRows,fetchTpexHistoricalRows}=require('./sync-service');
const {fetchTwseInstitutionalDay,fetchTpexInstitutionalDay,fetchTpexInstitutionalLegacyDay}=require('./institutional-history');
const {readResearch500DProgress,WARMUP,qualityCheck}=require('./research-500d-backfill');
const {enrichFlowFeatures,scoreStocksForDate,aggregateTagDate,buildProfileTagMap,
  continuousStockFlowScore,STOCK_FLOW_LOOKBACK_DAYS,STOCK_FLOW_POSITION_DAYS,
  FEATURE_VERSION,DAILY_BUILD_VERSION}=require('./fundflow-xy');

const MAX_FETCH_DAYS=3,MAX_STAGE_DAYS=54;
const iso=x=>x instanceof Date?x.toISOString().slice(0,10):String(x||'').slice(0,10);
const num=v=>v===null||v===undefined||v===''?null:Number(v);
const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
const weekday=d=>{const x=new Date(d+'T00:00:00Z').getUTCDay();return x!==0&&x!==6;};
function addDays(d,n){const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
function earlierWeekdays(d,n){const r=[];let x=d;while(r.length<n){x=addDays(x,-1);if(weekday(x))r.push(x);}return r.reverse();}

async function ensureOfficialStage(sql){
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_official_stage (
  trade_date date NOT NULL,stock_code text NOT NULL,market text NOT NULL,
  stock_name text,close_price numeric,trade_value numeric,trade_volume numeric,
  foreign_net bigint,trust_net bigint,dealer_net bigint,total_net bigint,
  PRIMARY KEY(trade_date,stock_code,market))`);
 await sql.query(`CREATE INDEX IF NOT EXISTS market_research500_official_stage_code_date
  ON market_research500_official_stage(market,stock_code,trade_date)`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_official_calendar (
  trade_date date PRIMARY KEY,status text NOT NULL CHECK(status IN ('trading','closed')))`);
}

async function bootstrapWarmup(sql,anchor){
 // Copy only the existing 45D+anchor raw interval into bounded scratch. This
 // protects a manual backfill from tomorrow's normal 120D raw retention prune.
 const n=await sql.query(`SELECT COUNT(DISTINCT trade_date)::int n FROM market_research500_official_stage`);
 if(Number(n[0]?.n||0))return 0;
 const dates=await sql.query(`WITH market_coverage AS (
  SELECT p.trade_date,p.market,COUNT(*)::int n FROM market_daily_history p
  JOIN institutional_trading_daily i USING(trade_date,stock_code,market)
  WHERE p.trade_date<=$1::date AND p.trade_value>0 AND i.total_net IS NOT NULL
  GROUP BY p.trade_date,p.market), complete_dates AS (
  SELECT trade_date FROM market_coverage
  WHERE (market='上市' AND n>=300) OR (market='上櫃' AND n>=180)
  GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
  ORDER BY trade_date DESC LIMIT $2)
  SELECT trade_date::text d FROM complete_dates ORDER BY trade_date`,[anchor,WARMUP+1]);
 if(dates.length<WARMUP+1)return 0;
 const start=iso(dates[0].d);
 const r=await sql.query(`WITH days AS (SELECT DISTINCT trade_date FROM market_daily_history
  WHERE trade_date BETWEEN $1::date AND $2::date),incoming AS (
  INSERT INTO market_research500_official_stage
   (trade_date,stock_code,market,stock_name,close_price,trade_value,trade_volume,foreign_net,trust_net,dealer_net,total_net)
  SELECT p.trade_date,p.stock_code,p.market,COALESCE(p.stock_name,''),p.close_price,p.trade_value,p.trade_volume,
   i.foreign_net,i.trust_net,i.dealer_net,i.total_net
  FROM market_daily_history p LEFT JOIN institutional_trading_daily i USING(trade_date,stock_code,market)
  JOIN (SELECT DISTINCT stock_code,market FROM market_business_xy2_member) m USING(stock_code,market)
  WHERE p.trade_date BETWEEN $1::date AND $2::date AND p.trade_value>0 AND p.close_price>0
  ON CONFLICT (trade_date,stock_code,market) DO NOTHING RETURNING 1)
  SELECT COUNT(*)::int n FROM incoming`,[start,anchor]);
 await sql.query(`INSERT INTO market_research500_official_calendar (trade_date,status)
  SELECT DISTINCT trade_date,'trading' FROM market_research500_official_stage
  ON CONFLICT(trade_date) DO NOTHING`);
 return Number(r[0]?.n||0);
}

function normalizeOfficialDay(d,prices,inst,allowed,{allowCrashDayLowCoverage=false}={}){
 const markets=['上市','上櫃'];const out=[];const coverage={};
 for(let i=0;i<2;i++){
  const market=markets[i],ps=prices[i]?.rows||[],ins=inst[i]||[];
  if(ps.length<(i===0?300:200))return {ok:false,reason:`${market}-price-coverage`,date:d,rows:ps.length};
  if(ins.length<(i===0?200:150))return {ok:false,reason:`${market}-institutional-coverage`,date:d,rows:ins.length};
  if(!ps.every(p=>iso(p.trade_date)===d)||!ins.every(x=>iso(x.date)===d))return {ok:false,reason:`${market}-date-mismatch`,date:d};
  const lookup=new Map(ins.map(x=>[String(x.code),x])),allowedCodes=allowed?.get(market)||new Set();
  const scoped=ps.filter(p=>allowedCodes.has(String(p.stock_code))&&num(p.trade_value)>0&&num(p.close_price)>0);
  let got=0;
  for(const p of scoped){const x=lookup.get(String(p.stock_code)),hasFlow=Boolean(x&&finite(x.total));
    if(hasFlow)got++;
    // Keep PRICE-only days. Institutional data can be absent for an individual
    // stock; dropping the price row made LAG silently turn multi-day returns
    // into alleged 1D returns. A missing flow must stay NULL, not zero.
    out.push({trade_date:d,market,stock_code:String(p.stock_code),stock_name:p.stock_name||x?.name||'',
      close_price:num(p.close_price),trade_value:num(p.trade_value),trade_volume:num(p.trade_volume),
      foreign_net:hasFlow?num(x.foreign):null,trust_net:hasFlow?num(x.trust):null,
      dealer_net:hasFlow?num(x.dealer):null,total_net:hasFlow?num(x.total):null});
  }
  // The official institutional list is not always a census of traded stocks:
  // it can omit stocks with NO institutional trades. Most days the old 70% guard
  // is desirable. On a VERIFIED market-wide limit-down shock it blocks genuine
  // data, however. Never invent zero flow: unmatched rows retain NULL.
  const pct=got/Math.max(scoped.length,1),minEligible=Math.min(180,allowedCodes.size*.2);
  const checked=scoped.map(p=>num(p.change_pct)).filter(v=>v!==null&&Number.isFinite(v));
  const extremeDown=checked.filter(v=>v<=-8).length;
  const crashLike=market==='上櫃'&&checked.length>=Math.max(120,Math.ceil(scoped.length*.70))
     &&extremeDown/checked.length>=.60;
  const safeSparse=allowCrashDayLowCoverage&&crashLike
     &&got>=Math.max(80,Math.ceil(scoped.length*.20))
     &&ins.length>=150;
  coverage[market]={eligible:scoped.length,matched:got,sourceRows:ins.length,
    matchedPct:Number((pct*100).toFixed(1)),
    crashQuoteCount:checked.length,crashDrop8Count:extremeDown,
    mode:safeSparse&&pct<.70?'verified-crash-day-sparse-flows':'standard'};
  if(scoped.length<minEligible||(got<Math.max(40,Math.ceil(scoped.length*.70))&&!safeSparse))
    return {ok:false,reason:`${market}-scoped-institutional-coverage`,date:d,coverage};
 }
 return {ok:true,rows:out,coverage};
}
async function fetchOfficialDay(d,allowed,{
 priceFetch=[fetchTwseHistoricalRows,fetchTpexHistoricalRows],
 institutionalFetch=[fetchTwseInstitutionalDay,fetchTpexInstitutionalDay],
 tpexLegacyFetch=fetchTpexInstitutionalLegacyDay
}={}){
 const [a,b,c,e]=await Promise.all([priceFetch[0](d),priceFetch[1](d),institutionalFetch[0](d),institutionalFetch[1](d)]);
 if(a?.nonTrading&&b?.nonTrading&&!(c?.length)&&!(e?.length))return {ok:true,closed:true,rows:[]};
 const prices=[a,b];let inst=[c,e];
 let report=normalizeOfficialDay(d,prices,inst,allowed);
 if(report.ok||report.reason!=='上櫃-scoped-institutional-coverage')return report;
 // Modern TPEx can return a syntactically valid yet partial response.
 // Try the other official endpoint BEFORE relaxing the guard. Never merge
 // contradictory same-day records: choose one coherent source by intersection.
 let fallbackError=null;
 if(typeof tpexLegacyFetch==='function'){
  try{
   const alternative=await tpexLegacyFetch(d);
   if(Array.isArray(alternative)&&alternative.length){
    const alt=normalizeOfficialDay(d,prices,[c,alternative],allowed);
    if(alt.ok)return {...alt,officialRecovery:'TPEx-legacy-source'};
    if(alt.reason==='上櫃-scoped-institutional-coverage'
      &&Number(alt.coverage?.['上櫃']?.matched||0)>Number(report.coverage?.['上櫃']?.matched||0)){
      inst=[c,alternative];report=alt;
    }
   }
  }catch(err){fallbackError=String(err?.message||err);}
 }
 // Extreme market-wide down days can legitimately have no institutional
 // trades on many priced stocks. Distinguish verified crash quotations from
 // a broken provider response. Null stays null; downstream X/Y quality gates
 // and anchor reproduction continue to run unchanged.
 const exceptional=normalizeOfficialDay(d,prices,inst,allowed,{allowCrashDayLowCoverage:true});
 if(exceptional.ok)return {...exceptional,officialRecovery:'verified-market-crash-null-flows'};
 return {...report,alternativeAttempted:true,alternativeError:fallbackError,
   coverage:exceptional.coverage||report.coverage};
}
async function storeOfficialDay(sql,d,result){
 if(result.closed){await sql.query(`INSERT INTO market_research500_official_calendar (trade_date,status) VALUES($1,'closed') ON CONFLICT(trade_date) DO UPDATE SET status='closed'`,[d]);return 0;}
 const rows=result.rows||[];
 const r=await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS t(
  trade_date date,stock_code text,market text,stock_name text,
  close_price numeric,trade_value numeric,trade_volume numeric,
  foreign_net bigint,trust_net bigint,dealer_net bigint,total_net bigint))
  INSERT INTO market_research500_official_stage AS t
  (trade_date,stock_code,market,stock_name,close_price,trade_value,trade_volume,foreign_net,trust_net,dealer_net,total_net)
  SELECT trade_date,stock_code,market,stock_name,close_price,trade_value,trade_volume,foreign_net,trust_net,dealer_net,total_net
  FROM incoming ON CONFLICT (trade_date,stock_code,market) DO NOTHING RETURNING 1`,[JSON.stringify(rows)]);
 await sql.query(`INSERT INTO market_research500_official_calendar(trade_date,status) VALUES($1,'trading') ON CONFLICT(trade_date) DO UPDATE SET status='trading'`,[d]);
 return r.length;
}
function selectCausalBatch(dates,anchor,max=MAX_FETCH_DAYS){
 const source=[...new Set((dates||[]).map(iso))].sort(),idx=source.indexOf(anchor);
 if(idx<WARMUP)return {dates:[],reason:'awaiting-45d-verified-warmup',cached:source.length};
 const earlier=source.slice(0,idx).filter((d,i)=>i>=WARMUP);
 const chosen=earlier.slice(-max);
 if(!chosen.length)return {dates:[],reason:'awaiting-earlier-official-days',cached:source.length};
 const start=source.indexOf(chosen[0]);return {dates:chosen,anchor,warmupStart:source[start-WARMUP],cached:source.length};
}
function deriveStockFeatures(sourceRows){
 // A stock can be missing from a trading session even when the market was open.
 // No N-day price return is valid unless the observation N MARKET sessions ago
 // exists for that stock (do not treat its Nth previous available row as N days).
 const calendar=[...new Set((sourceRows||[]).map(x=>iso(x.trade_date)))].sort();
 const byCode=new Map();for(const x of sourceRows||[]){const key=`${x.market}|${x.stock_code}`;if(!byCode.has(key))byCode.set(key,[]);byCode.get(key).push({...x});}
 const rows=[];
 for(const list of byCode.values()){
  list.sort((a,b)=>iso(a.trade_date).localeCompare(iso(b.trade_date)));
  const at=new Map(list.map(r=>[iso(r.trade_date),r]));
  for(const r of list){
   const i=calendar.indexOf(iso(r.trade_date));
   const close=num(r.close_price),prev=n=>i>=n?num(at.get(calendar[i-n])?.close_price):null;
   const rtn=n=>prev(n)>0?100*(close/prev(n)-1):null;
   r.change_pct=rtn(1);r.return_3_pct=rtn(3);r.return_5_pct=rtn(5);r.return_20_pct=rtn(20);
   r.positive_days_5=calendar.slice(Math.max(0,i-4),i+1).reduce((sum,d,j,a)=>{
    const idx=calendar.indexOf(d),today=num(at.get(d)?.close_price),prior=idx>0?num(at.get(calendar[idx-1])?.close_price):null;
    return sum+(today!==null&&prior!==null&&today>prior?1:0);
   },0);
   r.institutional_foreign_net=num(r.foreign_net);r.institutional_trust_net=num(r.trust_net);
   r.institutional_dealer_net=num(r.dealer_net);r.institutional_total_net=num(r.total_net);
   rows.push(r);
  }
 }
 return rows;
}
// Keep the full causal warmup in Neon, but return only three scoring days plus
// the existing anchor. This avoids sending ~90k scratch rows to Vercel on EVERY
// manual click. PostgreSQL computes close returns and rolling institutional
// ratios and robust median/MAD; the original JavaScript X20 tanh scoring
// function remains the single source of truth.
// The prior 20 raw-X observations exclude the target row (no self-inclusion).
const OFFICIAL_CAUSAL_FEATURE_SQL=`
 WITH history AS MATERIALIZED (
  SELECT trade_date,stock_code,market,stock_name,close_price::double precision AS close_price,
    trade_value::double precision AS trade_value,trade_volume::double precision AS trade_volume,
    foreign_net,trust_net,dealer_net,total_net,
    CASE WHEN total_net IS NOT NULL AND close_price IS NOT NULL THEN
      total_net::double precision*close_price::double precision
      WHEN total_net IS NOT NULL AND trade_volume>0 THEN
      total_net::double precision*(trade_value::double precision/trade_volume::double precision)
      ELSE NULL END AS net_value
  FROM market_research500_official_stage
  WHERE trade_date BETWEEN $1::date AND $2::date
 ),
 -- Stock rows are not guaranteed on every trading day. Align every price
 -- horizon against the global official market session calendar, NOT against
 -- each stock's Nth previous available row.
 calendar AS (
  SELECT trade_date,
   LAG(trade_date,1) OVER w AS prior_date_1,
   LAG(trade_date,3) OVER w AS prior_date_3,
   LAG(trade_date,5) OVER w AS prior_date_5,
   LAG(trade_date,20) OVER w AS prior_date_20
  FROM market_research500_official_calendar
  WHERE status='trading' AND trade_date BETWEEN $1::date AND $2::date
  WINDOW w AS (ORDER BY trade_date)
 ),
 lagged AS (
  SELECT h.*,
   p1.close_price AS prior_close_1,p3.close_price AS prior_close_3,
   p5.close_price AS prior_close_5,p20.close_price AS prior_close_20
  FROM history h JOIN calendar c USING(trade_date)
  LEFT JOIN history p1 ON p1.trade_date=c.prior_date_1 AND p1.stock_code=h.stock_code AND p1.market=h.market
  LEFT JOIN history p3 ON p3.trade_date=c.prior_date_3 AND p3.stock_code=h.stock_code AND p3.market=h.market
  LEFT JOIN history p5 ON p5.trade_date=c.prior_date_5 AND p5.stock_code=h.stock_code AND p5.market=h.market
  LEFT JOIN history p20 ON p20.trade_date=c.prior_date_20 AND p20.stock_code=h.stock_code AND p20.market=h.market
 ),
 rolling AS (
  SELECT l.*,
    SUM(CASE WHEN prior_close_1>0 AND close_price>prior_close_1 THEN 1 ELSE 0 END)
      OVER w5 AS positive_days_5,
    COUNT(net_value) OVER w20 AS days20,
    SUM(net_value) OVER w1 AS flow1,
    SUM(net_value) OVER w5 AS flow5,
    SUM(net_value) OVER w10 AS flow10,
    SUM(net_value) OVER w20 AS flow20,
    SUM(CASE WHEN net_value IS NOT NULL AND trade_value>0 THEN trade_value ELSE 0 END)
      OVER w1 AS turnover1,
    SUM(CASE WHEN net_value IS NOT NULL AND trade_value>0 THEN trade_value ELSE 0 END)
      OVER w5 AS turnover5,
    SUM(CASE WHEN net_value IS NOT NULL AND trade_value>0 THEN trade_value ELSE 0 END)
      OVER w10 AS turnover10,
    SUM(CASE WHEN net_value IS NOT NULL AND trade_value>0 THEN trade_value ELSE 0 END)
      OVER w20 AS turnover20
  FROM lagged l
  WINDOW w1 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN CURRENT ROW AND CURRENT ROW),
   w5 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW),
   w10 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW),
   w20 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)
 ),
 raw_flow AS (
  SELECT r.*,
   CASE WHEN days20>=20 AND turnover20>0 THEN 100*flow20/turnover20 ELSE NULL END AS raw20
  FROM rolling r
 ),
 with_prior AS (
  SELECT r.*,
   ARRAY_AGG(raw20) FILTER (WHERE raw20 IS NOT NULL) OVER
     (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_raw20
  FROM raw_flow r
 ),
 targets AS (
  SELECT *,
   CASE WHEN COALESCE(ARRAY_LENGTH(prior_raw20,1),0)>$4::int
    THEN prior_raw20[(ARRAY_LENGTH(prior_raw20,1)-$4::int+1):ARRAY_LENGTH(prior_raw20,1)]
    ELSE COALESCE(prior_raw20,ARRAY[]::double precision[]) END AS previous20
  FROM with_prior WHERE trade_date=ANY($3::date[])
 ),
 medians AS (
  SELECT t.*,s.median_abs
  FROM targets t
  LEFT JOIN LATERAL (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(v)) AS median_abs
    FROM UNNEST(t.previous20) AS v
  ) s ON TRUE
 ),
 scaled AS (
  SELECT m.*,
   GREATEST(0.08,COALESCE(m.median_abs,0)+1.4826*COALESCE(a.mad,0)) AS stock_flow_scale,
   CARDINALITY(m.previous20)::int AS stock_flow_history_days
  FROM medians m
  LEFT JOIN LATERAL (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(ABS(v)-m.median_abs)) AS mad
    FROM UNNEST(m.previous20) AS v
  ) a ON TRUE
 )
 SELECT trade_date::text AS trade_date,stock_code,market,stock_name,
  CASE WHEN prior_close_1>0 THEN 100*(close_price/prior_close_1-1) ELSE NULL END AS change_pct,
  CASE WHEN prior_close_3>0 THEN 100*(close_price/prior_close_3-1) ELSE NULL END AS return_3_pct,
  CASE WHEN prior_close_5>0 THEN 100*(close_price/prior_close_5-1) ELSE NULL END AS return_5_pct,
  CASE WHEN prior_close_20>0 THEN 100*(close_price/prior_close_20-1) ELSE NULL END AS return_20_pct,
  positive_days_5,
  CASE WHEN turnover1>0 THEN 100*flow1/turnover1 ELSE NULL END AS inst_flow_ratio_1,
  CASE WHEN turnover5>0 THEN 100*flow5/turnover5 ELSE NULL END AS inst_flow_ratio_5,
  CASE WHEN turnover10>0 THEN 100*flow10/turnover10 ELSE NULL END AS inst_flow_ratio_10,
  CASE WHEN turnover20>0 THEN 100*flow20/turnover20 ELSE NULL END AS inst_flow_ratio_20,
  turnover20 AS inst_turnover_value_20,days20 AS inst_flow_days_20,
  stock_flow_scale,stock_flow_history_days
 FROM scaled
 ORDER BY trade_date,market,stock_code`;

function normalizeCausalScoringRows(rows){
 return (rows||[]).map(r=>{
  const historyDays=Math.max(0,Math.min(STOCK_FLOW_LOOKBACK_DAYS,num(r.stock_flow_history_days)??0)),
    scale=num(r.stock_flow_scale),days=num(r.inst_flow_days_20)??0;
  if(scale===null||scale<0.08||!Number.isInteger(historyDays)||days<0||days>STOCK_FLOW_POSITION_DAYS)
    throw Error('official-causal-feature-invalid-scale');
  return {...r,stock_flow_scale:scale,stock_flow_history_days:historyDays,
    stock_flow_maturity_pct:historyDays/STOCK_FLOW_LOOKBACK_DAYS*100,
    stock_flow_reliability:historyDays/STOCK_FLOW_LOOKBACK_DAYS*Math.min(1,days/STOCK_FLOW_POSITION_DAYS),
    stock_flow_score:continuousStockFlowScore(days>=STOCK_FLOW_POSITION_DAYS?r.inst_flow_ratio_20:null,historyDays,scale),
    credit_correction:0};
 });
}

async function loadOfficialCausalScoringRows(sql,batch){
 const days=[...new Set([...batch.dates,batch.anchor])].sort();
 const compactRows=await sql.query(OFFICIAL_CAUSAL_FEATURE_SQL,
   [batch.warmupStart,batch.anchor,days,STOCK_FLOW_LOOKBACK_DAYS]);
 // Strict fail-closed: a wrong SQL window must never silently lead to an empty
 // research INSERT, even if the official source itself was complete.
 const found=new Set(compactRows.map(r=>iso(r.trade_date)));
 if(days.some(d=>!found.has(d)))throw Error('official-causal-feature-dates-missing');
 return normalizeCausalScoringRows(compactRows);
}

function compact(day,t){const x=t.xAvailable===false?null:num(t.x),y=num(t.y);
 return {trade_date:day,tag_id:t.tagId,x_score:finite(x)?x:null,y_score:finite(y)?y:null,
  flow_1_pct:num(t.themeFlow1Pct),flow_5_pct:num(t.themeFlow5Pct),return_1_pct:num(t.themeReturn1Pct),
  price_breadth:num(t.priceBreadth),activation_rate:num(t.activationRate),
  feature_version:FEATURE_VERSION,build_version:DAILY_BUILD_VERSION};
}
async function calculateBatch(sql,progress,sourceDates){
 const batch=selectCausalBatch(sourceDates,progress.minDate);
 if(!batch.dates.length)return {ok:true,skipped:true,noWrites:true,reason:batch.reason,readyCacheDays:batch.cached};
 // Read the exact causal window, not entire official archives. The retained
 // warmup rows do not leak their first-day technical artifacts into scored days.
 const enriched=await loadOfficialCausalScoringRows(sql,batch);
 const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at
  FROM market_company_profile ORDER BY stock_code`);
 const mapped=buildProfileTagMap(profiles),wanted=new Set([...batch.dates,batch.anchor]);
 const byDate=new Map([...wanted].map(d=>[d,[]]));for(const row of enriched){const d=iso(row.trade_date);if(byDate.has(d))byDate.get(d).push(row);}
 const created=new Map();for(const d of wanted){const scored=scoreStocksForDate(byDate.get(d)||[]);created.set(d,aggregateTagDate(scored,mapped,d).map(t=>compact(d,t)));}
 const reference=await sql.query(`SELECT tag_id,y_score FROM market_business_xy2_research_daily
  WHERE trade_date=$1::date AND feature_version=$2 AND build_version=$3`,[batch.anchor,FEATURE_VERSION,DAILY_BUILD_VERSION]);
 const ref=new Map(reference.map(r=>[r.tag_id,num(r.y_score)]));
 const diff=(created.get(batch.anchor)||[]).filter(r=>ref.has(r.tag_id)&&finite(r.y_score)&&finite(ref.get(r.tag_id)))
 .map(r=>Math.abs(r.y_score-ref.get(r.tag_id))).sort((a,b)=>a-b);
 const median=diff[Math.floor(diff.length/2)]??Infinity;
 const p95=diff[Math.min(diff.length-1,Math.floor(diff.length*.95))]??Infinity;
 if(diff.length<Math.min(36,Math.floor(progress.categoryCount*.2))||median>.35||p95>1)
  return {ok:false,noWrites:true,reason:'official-overlap-Y-reproduction-failed',medianYDifference:median,p95YDifference:p95,overlap:diff.length,batch};
 const records=[];for(const d of batch.dates){const items=created.get(d)||[],quality=qualityCheck(items,progress.categoryCount);
  if(!quality.ok)return {ok:false,noWrites:true,reason:'official-historical-quality-failed',day:d,quality,batch};records.push(...items);}
 const storage=await sql.query(`SELECT pg_database_size(current_database())::bigint bytes`);
 if(Number(storage[0]?.bytes||0)>=STORAGE_POLICY.softTargetMb*1024*1024)
  return {ok:false,noWrites:true,reason:'storage-soft-limit',batch};
 const wrote=await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
  trade_date date,tag_id text,x_score numeric,y_score numeric,flow_1_pct numeric,
  flow_5_pct numeric,return_1_pct numeric,price_breadth numeric,activation_rate numeric,
  feature_version text,build_version text))
  INSERT INTO market_business_xy2_research_daily AS r
  (trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,return_1_pct,price_breadth,activation_rate,feature_version,build_version,updated_at)
  SELECT trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,return_1_pct,price_breadth,activation_rate,feature_version,build_version,NOW() FROM incoming
  ON CONFLICT (trade_date,tag_id) DO UPDATE SET
   x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,flow_1_pct=EXCLUDED.flow_1_pct,
   flow_5_pct=EXCLUDED.flow_5_pct,return_1_pct=EXCLUDED.return_1_pct,
   price_breadth=EXCLUDED.price_breadth,activation_rate=EXCLUDED.activation_rate,
   feature_version=EXCLUDED.feature_version,build_version=EXCLUDED.build_version,updated_at=NOW()
  WHERE r.feature_version IS DISTINCT FROM EXCLUDED.feature_version OR r.build_version IS DISTINCT FROM EXCLUDED.build_version
  RETURNING 1`,[JSON.stringify(records)]);
 const after=await readResearch500DProgress(sql);
 // The next invocation needs only the older side of the moving causal window.
 if(after.complete){
  await sql.query(`DELETE FROM market_research500_official_stage`);
  await sql.query(`DELETE FROM market_research500_official_calendar`);
 }else{
  await sql.query(`DELETE FROM market_research500_official_stage WHERE trade_date>$1::date`,[after.minDate]);
  await sql.query(`DELETE FROM market_research500_official_calendar WHERE trade_date>$1::date`,[after.minDate]);
 }
 return {ok:true,processedDates:batch.dates.length,dates:batch.dates,insertedOrReplacedRows:wrote.length,
   overlapMedianYDifference:median,before:progress,after,source:'official-twse-tpex-with-bounded-scratch',
   note:'只寫精簡研究表，今天203分類回推非當時已知分類。'};
}
async function backfillResearch500DOfficial({sql=getSql(),batchDays=3,fetchDay=fetchOfficialDay}={}){
 const progress=await readResearch500DProgress(sql);
 // Do not fetch or calculate from an empty 203-subindustry membership map.
 if(progress.taxonomyReady===false)return {ok:false,noResearchWrites:true,reason:'frozen-203-membership-missing-use-safe-restore',before:progress};
 if(progress.complete)return {ok:true,skipped:true,noWrites:true,reason:'research-target-complete',before:progress};
 if(!progress.minDate)return {ok:false,noWrites:true,reason:'research-anchor-missing'};
 if(STORAGE_POLICY.raw.price!==120||STORAGE_POLICY.raw.institutional!==120||STORAGE_POLICY.raw.credit!==90)
  return {ok:false,noWrites:true,reason:'raw-retention-policy-changed'};
 const limit=Math.max(1,Math.min(MAX_FETCH_DAYS,Math.floor(Number(batchDays)||3)));
 const size=await sql.query(`SELECT pg_database_size(current_database())::bigint bytes`);
 if(Number(size[0]?.bytes||0)>=STORAGE_POLICY.softTargetMb*1024*1024)
  return {ok:false,noWrites:true,reason:'storage-soft-limit'};
 await ensureOfficialStage(sql);
 const bootstrapped=await bootstrapWarmup(sql,progress.minDate);
 const cached=await sql.query(`SELECT trade_date::text d FROM market_research500_official_stage GROUP BY trade_date HAVING COUNT(*)>=300 ORDER BY trade_date`);
 if(cached.length>=MAX_STAGE_DAYS){const held=await calculateBatch(sql,progress,cached.map(r=>iso(r.d)));return {...held,manual:true,officialFetchedDays:0,officialStagedRows:0,stageSourceDays:cached.length,reason:held.reason||'stage-limit-try-calculation'};}
 if(cached.length<WARMUP+1)return {ok:false,noResearchWrites:true,reason:'raw-bootstrap-warmup-not-available',bootstrapped,stageSourceDays:cached.length};
 const head=await sql.query(`SELECT MIN(trade_date)::text d FROM market_research500_official_calendar`);
 const earliest=iso(head[0]?.d||progress.minDate),planned=earlierWeekdays(earliest,Math.min(limit,MAX_STAGE_DAYS-cached.length));
 const m=await sql.query(`SELECT DISTINCT stock_code,market FROM market_business_xy2_member`);
 const allowed=new Map([['上市',new Set()],['上櫃',new Set()]]);
 for(const r of m)allowed.get(r.market)?.add(String(r.stock_code));
 let fetched=0,closed=0,stored=0,coverage=[];
 // Always one official calendar day at a time. Provider failures never mark a
 // day complete; retrying the button can resume without duplicating rows.
 for(const d of [...planned].reverse()){
  let report;try{report=await fetchDay(d,allowed);}catch(e){return {ok:false,noResearchWrites:true,reason:'official-source-fetch-failed',failedDate:d,error:String(e?.message||e),fetched,stored,bootstrapped};}
  if(!report.ok)return {ok:false,noResearchWrites:true,reason:report.reason,date:d,coverage:report.coverage,fetched,stored,bootstrapped};
  stored+=await storeOfficialDay(sql,d,report);fetched++;if(report.closed)closed++;else coverage.push(report.coverage);
 }
 const staged=await sql.query(`SELECT trade_date::text d FROM market_research500_official_stage GROUP BY trade_date
   HAVING COUNT(*)>=300 ORDER BY trade_date`);
 const result=await calculateBatch(sql,progress,staged.map(r=>iso(r.d)));
 // A failed overlap or quality check is not a reason to keep pulling earlier
 // dates. The caller must inspect the error and retry after a correction.
 return {...result,manual:true,officialFetchedDays:fetched,officialClosedDays:closed,officialStagedRows:stored,
  bootstrapRows:bootstrapped,officialCoverage:coverage,stageSourceDays:staged.length,
  note:result.note||'逐次手動補取官方日期，等45D暖機條件成立才寫入研究表；不操作日常120D/90D。'};
}
module.exports={WARMUP,MAX_FETCH_DAYS,MAX_STAGE_DAYS,earlierWeekdays,normalizeOfficialDay,fetchOfficialDay,
  selectCausalBatch,deriveStockFeatures,normalizeCausalScoringRows,loadOfficialCausalScoringRows,
  OFFICIAL_CAUSAL_FEATURE_SQL,backfillResearch500DOfficial};
