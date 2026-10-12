'use strict';
// v2.6.7.8: backwards-only, causal research backfill. No raw stock-day, operational
// topic, snapshot or membership writes. The 203-company-map is a *current* taxonomy
// backcast, not a historically investable out-of-sample universe.
const {getSql}=require('./db');
const {STORAGE_POLICY}=require('./storage-policy');
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
  // Count each date only when enough of the CURRENT 203-category definition set
  // is present with the CURRENT daily build version. Legacy rows aren't progress.
  const rows=await sql.query(`WITH member_tags AS (
    SELECT DISTINCT tag_id FROM market_business_xy2_member
  ), counts AS (
    SELECT r.trade_date,COUNT(*)::int AS rows,
       COUNT(*) FILTER (WHERE r.x_score IS NOT NULL)::int AS x_rows
    FROM market_business_xy2_research_daily r
    JOIN member_tags m ON m.tag_id=r.tag_id
    WHERE r.feature_version=$1 AND r.build_version=$2
    GROUP BY r.trade_date
  ), target AS (SELECT COUNT(*)::int n FROM member_tags)
  SELECT (SELECT n FROM target) AS tag_count,
    (SELECT COUNT(*)::int FROM counts WHERE rows >= GREATEST(1, (SELECT n FROM target)-13)) AS current_days,
    (SELECT COUNT(*)::int FROM counts WHERE rows >= GREATEST(1, (SELECT n FROM target)-13) AND x_rows>0) AS x_usable_days,
    (SELECT COUNT(DISTINCT trade_date)::int FROM market_business_xy2_research_daily) AS all_version_days,
    (SELECT MIN(trade_date)::text FROM counts WHERE rows>=GREATEST(1,(SELECT n FROM target)-13)) AS oldest,
    (SELECT MAX(trade_date)::text FROM counts WHERE rows>=GREATEST(1,(SELECT n FROM target)-13)) AS newest,
    (SELECT COUNT(*)::int FROM counts WHERE rows>=GREATEST(1,(SELECT n FROM target)-13)) AS qualified_days`,
    [FEATURE_VERSION,DAILY_BUILD_VERSION]);
  const r=rows[0]||{},done=Number(r.current_days||0),target=TARGET;
  return {targetDays:target,currentDays:done,allVersionDays:Number(r.all_version_days||0),
    xUsableDays:Number(r.x_usable_days||0),categoryCount:Number(r.tag_count||0),
    minDate:iso(r.oldest)||null,maxDate:iso(r.newest)||null,
    pct:Math.round(Math.min(1,done/target)*1000)/10,complete:done>=target,
    basis:'current-203-category-build-only',backcastWarning:'舊日期按今日203分類回推，非當時已知分類'};
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

async function backfillResearch500D({sql=getSql(),batchDays=2,dryRun=false}={}){
  const before=await readResearch500DProgress(sql),source=await availableRawDates(sql),batch=selectOlderBatch(source,before,{batchDays});
  if(!batch.dates?.length)return {ok:true,skipped:true,noWrites:true,before,source:{days:source.length,oldest:source[0]||null,newest:source.at(-1)||null},reason:batch.reason,
    note:'原始資料可用範圍不足時停止，不補造過去資料；既有研究記錄保持不變。'};
  if(dryRun)return {ok:true,dryRun:true,noWrites:true,before,batch};
  // Do not infer taxonomy from the old research rows. The CURRENT frozen
  // taxonomy is applied explicitly; these historical records are backcasts.
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
  const historic=await loadHistoricRows(sql,batch.warmupStart,batch.readThrough);
  if(!historic.length)return {ok:false,skipped:true,noWrites:true,reason:'raw-query-empty',batch};
  const map=buildProfileTagMap(profiles);
  const enriched=enrichFlowFeatures(historic),wanted=new Set([...batch.dates,batch.anchor]);
  const byDate=new Map([...wanted].map(d=>[d,[]]));
  for(const row of enriched){const d=iso(row.trade_date);if(wanted.has(d))byDate.get(d).push(row);}
  const created=new Map();for(const d of wanted){const scored=scoreStocksForDate(byDate.get(d)||[]);const topic=aggregateTagDate(scored,map,d),records=topic.map(t=>compactFromTag(d,t));created.set(d,records);}
  // Compare the overlap date's Y values to the already persisted current-build
  // record, protecting against raw price/return mismatches. X may differ near
  // initial bootstrap because 20+20 days of prior history become available.
  const reference=await sql.query(`SELECT tag_id,y_score FROM market_business_xy2_research_daily WHERE trade_date=$1::date AND feature_version=$2 AND build_version=$3`,[batch.anchor,FEATURE_VERSION,DAILY_BUILD_VERSION]);
  const byTag=new Map(reference.map(r=>[r.tag_id,num(r.y_score)]));
  const overlap=(created.get(batch.anchor)||[]).filter(x=>byTag.has(x.tag_id)&&isValidNumber(x.y_score)&&isValidNumber(byTag.get(x.tag_id)));
  const errors=overlap.map(x=>Math.abs(x.y_score-byTag.get(x.tag_id))).sort((a,b)=>a-b);
  const errMedian=errors[Math.floor(errors.length/2)]||0;
  if(overlap.length<Math.min(MIN_MEMBERS*12,Math.floor(before.categoryCount*.2))||errMedian>.35)
    return {ok:false,noWrites:true,reason:'overlap-Y-reproduction-failed',overlap:overlap.length,medianDifference:errMedian,batch};
  let inserted=0,processed=0,rowsByDate=[];
  // One small atomic UPSERT per run; current research days never rewritten.
  for(const d of batch.dates){const records=created.get(d)||[],quality=qualityCheck(records,before.categoryCount);if(!quality.ok)
    return {ok:false,noWrites:true,reason:'historical-source-quality-insufficient',day:d,quality,batch};
    rowsByDate.push(...records);processed++;
  }
  // Don't grow even a narrow history table when the database is already at
  // its explicitly configured storage target.  No raw or derived tables are
  // created by this workflow.
  const usage=await sql.query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
  if(Number(usage?.[0]?.bytes||0)>=STORAGE_POLICY.softTargetMb*1024*1024)
    return {ok:false,noWrites:true,reason:'storage-soft-limit',batch,softTargetMb:STORAGE_POLICY.softTargetMb};
  const result=await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb)
    AS x(trade_date date,tag_id text,x_score numeric,y_score numeric,flow_1_pct numeric,
    flow_5_pct numeric,return_1_pct numeric,price_breadth numeric,activation_rate numeric,
    feature_version text,build_version text))
    INSERT INTO market_business_xy2_research_daily AS r
    (trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,return_1_pct,
      price_breadth,activation_rate,feature_version,build_version,updated_at)
    SELECT trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,return_1_pct,
      price_breadth,activation_rate,feature_version,build_version,NOW() FROM incoming
    ON CONFLICT (trade_date,tag_id) DO UPDATE SET
      x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,flow_1_pct=EXCLUDED.flow_1_pct,
      flow_5_pct=EXCLUDED.flow_5_pct,return_1_pct=EXCLUDED.return_1_pct,
      price_breadth=EXCLUDED.price_breadth,activation_rate=EXCLUDED.activation_rate,
      feature_version=EXCLUDED.feature_version,build_version=EXCLUDED.build_version,updated_at=NOW()
    WHERE r.feature_version IS DISTINCT FROM EXCLUDED.feature_version
       OR r.build_version IS DISTINCT FROM EXCLUDED.build_version
    RETURNING 1`,[JSON.stringify(rowsByDate)]);
  inserted=result.length;
  const after=await readResearch500DProgress(sql);
  return {ok:true,mode:'causal-raw-backcast-203',resumable:true,
    noOperationalTablesChanged:true,source:{days:source.length,oldest:source[0],newest:source.at(-1)},
    processedDates:processed,insertedOrReplacedRows:inserted,dates:batch.dates,
    overlapMedianYDifference:errMedian,before,after,
    note:'今日203分類回溯計算，不是當時可用的投資分類；原始資料最早日期前無法填補。'};
}
module.exports={TARGET,WARMUP,readResearch500DProgress,availableRawDates,selectOlderBatch,loadHistoricRows,qualityCheck,backfillResearch500D};
