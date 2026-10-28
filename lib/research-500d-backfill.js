'use strict';
// v2.6.7.8: backwards-only, causal research backfill. No raw stock-day, operational
// topic, snapshot or membership writes. The 203-company-map is a *current* taxonomy
// backcast, not a historically investable out-of-sample universe.
const {getSql}=require('./db');
const {STORAGE_POLICY}=require('./storage-policy');
const frozenTaxonomy=require('./final-taxonomy-freeze');
const {enrichFlowFeatures,scoreStocksForDate,aggregateTagDate,buildProfileTagMap,
  FEATURE_VERSION,DAILY_BUILD_VERSION}=require('./fundflow-xy');
const TARGET=STORAGE_POLICY.compact.topicResearch;
const WARMUP=45; // 20D flow + 20 prior raw20 observations + safety margin
const MAX_BATCH=3;
const MIN_MEMBERS=3;
const iso=x=>x instanceof Date?x.toISOString().slice(0,10):String(x||'').slice(0,10);
const num=x=>x===null||x===undefined||x===''?null:Number(x);
function isValidNumber(x){return x!==null&&Number.isFinite(Number(x));}

async function readResearch500DProgress(sql=getSql()){
  // SZ-914: read-only DATE coverage, not an equality assertion on all historical members.
  // Saved historic sets may contain 190-203 currently recognized tags because listings
  // and core/related relationships evolve naturally. Do not require today's 203
  // members on all prior dates. Keep a safety floor of 203-13, never count empty rows.
  // Version fingerprints are as-of provenance, not errors or separate 500D streams.
  const frozenIds=frozenTaxonomy.listDefinitions().map(d=>d.id);
  const rows=await sql.query(`WITH member_tags AS (
      SELECT unnest($2::text[]) AS tag_id
    ), by_date AS (
      SELECT r.trade_date,COUNT(DISTINCT r.tag_id)::int AS tags,
        COUNT(*) FILTER(WHERE r.x_score IS NOT NULL)::int AS x_rows,
        COUNT(DISTINCT r.build_version)::int AS recorded_builds
      FROM market_business_xy2_research_daily r JOIN member_tags m USING(tag_id)
      WHERE r.feature_version=$1 GROUP BY r.trade_date
    ), qualified AS (
      SELECT * FROM by_date WHERE tags>=GREATEST(1,(SELECT COUNT(*) FROM member_tags)-13)
    ) SELECT (SELECT COUNT(*)::int FROM member_tags) AS tag_count,
      (SELECT COUNT(*)::int FROM qualified) AS current_days,
      (SELECT COUNT(*)::int FROM qualified WHERE x_rows>0) AS x_usable_days,
      (SELECT COUNT(DISTINCT trade_date)::int FROM market_business_xy2_research_daily) AS all_version_days,
      (SELECT MIN(trade_date)::text FROM qualified) AS oldest,
      (SELECT MAX(trade_date)::text FROM qualified) AS newest,
      (SELECT COUNT(*)::int FROM market_business_xy2_member) AS member_rows,
      (SELECT COUNT(*)::int FROM by_date WHERE tags<GREATEST(1,(SELECT COUNT(*) FROM member_tags)-13)) AS incomplete_dates,
      (SELECT SUM(recorded_builds)::int FROM by_date) AS build_versions`,
    [FEATURE_VERSION,frozenIds]);
  const r=rows?.[0]||{},done=Number(r.current_days||0),target=TARGET,
    available=Number(r.x_usable_days||0),ready=done>=target&&available>=target;
  return {targetDays:target,currentDays:done,allVersionDays:Number(r.all_version_days||0),
    xUsableDays:available,categoryCount:Number(r.tag_count||0),
    taxonomyMemberRows:Number(r.member_rows||0),
    taxonomyReady:Number(r.member_rows||0)>=frozenTaxonomy.STATS.membershipEdges,
    minDate:iso(r.oldest)||null,maxDate:iso(r.newest)||null,
    pct:Math.round(Math.min(1,done/target)*1000)/10,
    coverageComplete:done>=target,complete:ready,uniformVersionReady:null,
    buildVersions:Number(r.build_versions||0),incompleteDates:Number(r.incomplete_dates||0),
    versionWarning:null,memberChangesAreExpected:true,
    basis:'203-tag-daily-coverage-as-recorded',
    backcastWarning:'資料為各日保存的歷史值；上市櫃與產業成員自然變動不構成資料錯誤，研究應採取 as-of 定義。',
    readOnly:true};
}

async function availableRawDates(sql){
  // Require both markets' institutional rows to cover >=70% of the day's price
  // universe; 10/12 had only one institutional ticker per market.
  const r=await sql.query(`WITH p AS (
    SELECT trade_date,market,COUNT(*)::int n FROM market_daily_history
    WHERE market IN ('上市','上櫃') AND trade_value>0 GROUP BY 1,2
  ), i AS (
    SELECT trade_date,market,COUNT(*)::int n FROM institutional_trading_daily
    WHERE market IN ('上市','上櫃') AND total_net IS NOT NULL GROUP BY 1,2
  ), ok AS (
    SELECT p.trade_date,p.market FROM p JOIN i USING(trade_date,market)
    WHERE i.n>=GREATEST(100,p.n*.70)
  ) SELECT trade_date::text d FROM ok GROUP BY trade_date
    HAVING COUNT(DISTINCT market)=2 ORDER BY trade_date`);
  return r.map(x=>iso(x.d)).filter(Boolean);
}
function selectOlderBatch(sourceDates,progress,{batchDays=2}={}){
  const limit=Math.max(1,Math.min(MAX_BATCH,Math.floor(Number(batchDays)||2)));
  const anchor=progress?.minDate;
  if(!anchor)return {dates:[],reason:'current-203-research-history-not-ready'};
  const earlier=sourceDates.filter(d=>d<anchor),valid=earlier.filter((d,i)=>{
    const index=sourceDates.indexOf(d);return index>=WARMUP;
  });
  const dates=valid.slice(-limit);
  if(!dates.length)return {dates:[],reason:earlier.length?'not-enough-causal-warmup':'raw-source-history-exhausted'};
  const index=sourceDates.indexOf(dates[0]),warmupDates=sourceDates.slice(index-WARMUP,sourceDates.indexOf(anchor)+1);
  if(warmupDates.length<WARMUP+dates.length)return {dates:[],reason:'raw-source-history-insufficient'};
  return {dates,warmupStart:warmupDates[0],anchor,readThrough:anchor,sourceDays:sourceDates.length};
}

async function loadHistoricRows(sql,start,end){
  // All price LAG/SUM windows are computed before the requested time filter,
  // therefore return_5, 20 and positive_days_5 use only contemporaneous prices.
  // Restrict to current taxonomy stock codes to minimize Neon egress.
  return sql.query(`WITH codes AS (
    SELECT DISTINCT stock_code,market FROM market_business_xy2_member
  ), p1 AS (
    SELECT h.trade_date,h.stock_code,h.market,h.close_price,h.trade_value,h.trade_volume,
      LAG(h.close_price,1) OVER w prev1,
      LAG(h.close_price,3) OVER w prev3,
      LAG(h.close_price,5) OVER w prev5,
      LAG(h.close_price,20) OVER w prev20
    FROM market_daily_history h JOIN codes c USING(stock_code,market)
    WHERE h.trade_date<=$2::date
    WINDOW w AS (PARTITION BY h.market,h.stock_code ORDER BY h.trade_date)
  ), p2 AS (
    SELECT p1.*,
      SUM(CASE WHEN close_price>prev1 THEN 1 ELSE 0 END) OVER
      (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) up5
    FROM p1
  ) SELECT p.trade_date,p.stock_code,COALESCE(a.stock_name,c.stock_name,'') stock_name,p.market,
      p.trade_value,p.trade_volume,p.close_price,
      COALESCE(a.change_pct,100*(p.close_price/NULLIF(p.prev1,0)-1)) change_pct,
      COALESCE(a.positive_days_5,p.up5) positive_days_5,
      COALESCE(a.return_3_pct,100*(p.close_price/NULLIF(p.prev3,0)-1)) return_3_pct,
      COALESCE(a.return_5_pct,100*(p.close_price/NULLIF(p.prev5,0)-1)) return_5_pct,
      COALESCE(a.return_20_pct,100*(p.close_price/NULLIF(p.prev20,0)-1)) return_20_pct,
      i.foreign_net institutional_foreign_net,i.trust_net institutional_trust_net,
      i.dealer_net institutional_dealer_net,i.total_net institutional_total_net
    FROM p2 p JOIN market_company_profile c USING(stock_code,market)
    JOIN institutional_trading_daily i USING(trade_date,stock_code,market)
    LEFT JOIN market_activity_daily a USING(trade_date,stock_code,market)
    WHERE p.trade_date BETWEEN $1::date AND $2::date AND p.trade_value>0
    AND i.total_net IS NOT NULL ORDER BY p.market,p.stock_code,p.trade_date`,[start,end]);
}
function compactFromTag(day,t){
  const x=t.xAvailable===false?null:num(t.x),y=num(t.y);
  return {trade_date:day,tag_id:t.tagId,x_score:isValidNumber(x)?x:null,
    y_score:isValidNumber(y)?y:null,flow_1_pct:num(t.themeFlow1Pct),
    flow_5_pct:num(t.themeFlow5Pct),return_1_pct:num(t.themeReturn1Pct),
    price_breadth:num(t.priceBreadth),activation_rate:num(t.activationRate),
    feature_version:FEATURE_VERSION,build_version:DAILY_BUILD_VERSION};
}
function qualityCheck(rows,expectedTags){
  if(!Array.isArray(rows)||rows.length<Math.max(5,expectedTags-13))return {ok:false,reason:'too-few-category-rows'};
  const tags=new Set(rows.map(r=>r.tag_id));
  if(tags.size!==rows.length)return {ok:false,reason:'duplicate-tags'};
  const y=rows.filter(r=>isValidNumber(r.y_score)).length;
  const x=rows.filter(r=>isValidNumber(r.x_score)).length;
  if(y<Math.max(5,expectedTags-13)||x<Math.ceil(expectedTags*.45))return {ok:false,reason:'insufficient-causal-X-or-Y',x,y};
  return {ok:true,x,y};
}

async function backfillResearch500D(){
  // SZ-914: Manual historical replays are forbidden; daily as-of append is elsewhere.
  return {ok:false,skipped:true,reason:'historical-research-backfill-disabled',noDataWrites:true};
}
module.exports={TARGET,WARMUP,readResearch500DProgress,availableRawDates,selectOlderBatch,loadHistoricRows,qualityCheck,backfillResearch500D};
