'use strict';
// v2.6.7.12 — Repair historically missing X/flow features, NOT price, taxonomy,
// live XY, operational snapshots, or already valid X. Uses the SAME stock-first
// X20 algorithm and current frozen member map as the existing 500D backfill.
// Existing stock histories before IPO are intentionally never fabricated.
const {getSql}=require('./db');
const {availableRawDates,WARMUP}=require('./research-500d-backfill');
const {buildProfileTagMap,scoreStocksForDate,aggregateTagDate,
  stockFlowScale,continuousStockFlowScore,
  FEATURE_VERSION,DAILY_BUILD_VERSION}=require('./fundflow-xy');
const MAX_BATCH=3;
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
function median(list){const a=list.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null;}

async function readResearchXGapStatus(sql=getSql()){
  // Count only current taxonomy members and current feature/build versions.
  // A gap is a whole-date failure (>40% X missing), NOT a post-IPO stock with
  // insufficient 40D maturity, e.g. the one-member car_rental topic.
  const rows=await sql.query(`WITH current_tags AS (
    SELECT DISTINCT tag_id FROM market_business_xy2_member
  ), coverage AS (
    SELECT r.trade_date,COUNT(*) FILTER(WHERE r.y_score IS NOT NULL)::int AS price_tags,
      COUNT(*) FILTER(WHERE r.x_score IS NOT NULL)::int AS x_tags,
      COUNT(*) FILTER(WHERE r.x_score IS NULL AND r.y_score IS NOT NULL)::int AS missing_x
    FROM market_business_xy2_research_daily r JOIN current_tags m ON m.tag_id=r.tag_id
    WHERE r.feature_version=$1 AND r.build_version=$2
    GROUP BY r.trade_date
  ) SELECT trade_date::text AS d,price_tags,x_tags,missing_x FROM coverage
    WHERE price_tags>=160 AND missing_x>=GREATEST(40,CEIL(price_tags*0.40))
    ORDER BY trade_date`,[FEATURE_VERSION,DAILY_BUILD_VERSION]);
  return {gapDays:rows.length,dates:rows.map(r=>iso(r.d)),
    firstGap:rows.length?iso(rows[0].d):null,lastGap:rows.length?iso(rows.at(-1).d):null,
    missingXRows:rows.reduce((a,r)=>a+Number(r.missing_x||0),0),
    perDay:rows.map(r=>({date:iso(r.d),price:Number(r.price_tags),x:Number(r.x_tags),missing:Number(r.missing_x)}))};
}

// Query-side rolling aggregates, JS-side AUTHORITATIVE stock scoring.
// Avoid returning ~49 trading days x 1,981 stocks for EACH 3D batch.
// Query returns only the anchor + selected dates (~8k rows) and last 20 valid
// raw20 observations needed for the exact stockFlowScale() implementation.
// No persistent cache, additional tables, schema changes, or cross-request state.
async function loadHistoricXCompactRows(sql,start,end,wantedDates){
  const dates=[...new Set((wantedDates||[]).map(iso).filter(Boolean))].sort();
  if(!dates.length)return [];
  return sql.query(`WITH codes AS (
    SELECT DISTINCT stock_code,market FROM market_business_xy2_member
  ), base AS MATERIALIZED (
    SELECT p.trade_date,p.stock_code,p.market,
      p.trade_value::double precision AS turnover,
      i.total_net::double precision AS institutional_total_net,
      (i.total_net::double precision *
        COALESCE(p.close_price::double precision,
          p.trade_value::double precision/NULLIF(p.trade_volume::double precision,0))) AS net_value
    FROM market_daily_history p JOIN codes c USING(stock_code,market)
    JOIN institutional_trading_daily i USING(trade_date,stock_code,market)
    WHERE p.trade_date BETWEEN $1::date AND $2::date
      AND p.trade_value>0 AND i.total_net IS NOT NULL
  ), rolling AS (
    SELECT b.*,
      COUNT(net_value) OVER w20 AS days20,
      SUM(net_value) OVER w20 AS net20,
      SUM(CASE WHEN net_value IS NOT NULL THEN turnover ELSE 0 END) OVER w20 AS turnover20,
      SUM(net_value) OVER w10 AS net10,
      SUM(CASE WHEN net_value IS NOT NULL THEN turnover ELSE 0 END) OVER w10 AS turnover10,
      SUM(net_value) OVER w5 AS net5,
      SUM(CASE WHEN net_value IS NOT NULL THEN turnover ELSE 0 END) OVER w5 AS turnover5
    FROM base b
    WINDOW w20 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW),
           w10 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 9 PRECEDING AND CURRENT ROW),
           w5 AS (PARTITION BY market,stock_code ORDER BY trade_date ROWS BETWEEN 4 PRECEDING AND CURRENT ROW)
  ), raw_history AS (
    SELECT r.*,CASE WHEN r.days20>=20 AND r.turnover20>0 THEN
      100*r.net20/r.turnover20 ELSE NULL END AS raw20
    FROM rolling r
  ), histories AS (
    SELECT r.*,
      ARRAY_AGG(r.raw20) FILTER (WHERE r.raw20 IS NOT NULL) OVER
      (PARTITION BY market,stock_code ORDER BY trade_date
       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS earlier20
    FROM raw_history r
  )
  SELECT trade_date,stock_code,market,
    CASE WHEN net_value IS NOT NULL AND turnover>0 THEN 100*net_value/turnover END AS inst_flow_ratio_1,
    CASE WHEN turnover5>0 THEN 100*net5/turnover5 END AS inst_flow_ratio_5,
    CASE WHEN turnover10>0 THEN 100*net10/turnover10 END AS inst_flow_ratio_10,
    raw20 AS inst_flow_ratio_20,
    turnover20 AS inst_turnover_value_20,
    days20 AS inst_flow_days_20,
    to_json(COALESCE(earlier20[GREATEST(1,COALESCE(array_length(earlier20,1),0)-19):],
      ARRAY[]::double precision[])) AS prior_raw20
  FROM histories WHERE trade_date=ANY($3::date[])
  ORDER BY market,stock_code,trade_date`,[start,end,dates]);
}

// Keep JS normalization bit-for-bit aligned with the production X20 engine.
// Missing/no-trade days were already excluded by the original raw-row query.
function finishCompactXRow(row){
  let history=Array.isArray(row.prior_raw20)?row.prior_raw20:[];
  history=history.map(finite).filter(v=>v!==null).slice(-20);
  const n=history.length,days=Math.max(0,Number(row.inst_flow_days_20)||0),
    raw=days>=20?finite(row.inst_flow_ratio_20):null,
    scale=stockFlowScale(history);
  return {...row,stock_flow_scale:scale,stock_flow_history_days:n,
    stock_flow_maturity_pct:Math.min(1,n/20)*100,
    stock_flow_reliability:Math.min(1,n/20)*Math.min(1,days/20),
    stock_flow_score:continuousStockFlowScore(raw,n,scale)};
}

function auditReproduction(recomputed,reference,{minPairs=80,maxMedianDelta=10,minSignAgreement=.80}={}){
  const pairs=[];
  for(const r of reference){const test=recomputed.get(`${iso(r.trade_date)}|${r.tag_id}`),before=finite(r.x_score);
    if(test&&before!==null&&finite(test.x_score)!==null)pairs.push([before,Number(test.x_score)]);
  }
  if(pairs.length<minPairs)return {ok:false,reason:'insufficient-overlap-X',pairs:pairs.length};
  const diffs=pairs.map(([a,b])=>Math.abs(a-b)),med=median(diffs),agreement=pairs.filter(([a,b])=>Math.sign(a)===Math.sign(b)||Math.abs(a)<.2&&Math.abs(b)<.2).length/pairs.length;
  return {ok:med<=maxMedianDelta&&agreement>=minSignAgreement,reason:'overlap-X-reproduction-failed',pairs:pairs.length,medianAbsXDelta:med,signAgreement:agreement};
}

async function repairResearchXGaps({sql=getSql(),batchDays=3,dryRun=false}={}){
  const before=await readResearchXGapStatus(sql);
  if(!before.gapDays)return {ok:true,skipped:true,noWrites:true,before,after:before,reason:'no-large-X-gaps'};
  const source=await availableRawDates(sql),chosen=before.dates.slice(0,Math.max(1,Math.min(MAX_BATCH,Math.floor(Number(batchDays)||3))));
  const first=source.indexOf(chosen[0]);
  if(first<0||first<WARMUP+1||chosen.some(x=>!source.includes(x)))return {ok:false,noWrites:true,reason:'insufficient-verified-raw-warmup',batch:chosen,rawDays:source.length};
  const anchor=source[first-1],warmupStart=source[first-WARMUP-1],readThrough=chosen.at(-1);
  if(dryRun)return {ok:true,dryRun:true,noWrites:true,before,batch:chosen,anchor,warmupStart,readThrough};
  // No schema changes, no fetches from outside Neon, no writes to operational tables.
  const [profiles,raw]=await Promise.all([
    sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,
      auto_market_topics,main_business,business_enrich_status,business_enrich_version,
      business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`),
    loadHistoricXCompactRows(sql,warmupStart,readThrough,[anchor,...chosen])
  ]);
  if(!raw.length)return {ok:false,noWrites:true,reason:'historic-raw-empty',batch:chosen};
  const map=buildProfileTagMap(profiles),dates=new Set([anchor,...chosen]),scoredByDate=new Map([...dates].map(d=>[d,[]]));
  for(const compact of raw){const row=finishCompactXRow(compact),d=iso(row.trade_date);
    if(dates.has(d))scoredByDate.get(d).push(row);}
  const computed=new Map();let allRecomputed=[];
  for(const d of dates){
    const topic=aggregateTagDate(scoreStocksForDate(scoredByDate.get(d)||[]),map,d);
    const compact=topic.map(t=>({trade_date:d,tag_id:t.tagId,x_score:t.xAvailable===false?null:finite(t.x),
      flow_1_pct:finite(t.themeFlow1Pct),flow_5_pct:finite(t.themeFlow5Pct)}));
    computed.set(d,compact);
    for(const r of compact)allRecomputed.push([`${d}|${r.tag_id}`,r]);
  }
  const byKey=new Map(allRecomputed);
  const overlap=await sql.query(`SELECT trade_date,tag_id,x_score FROM market_business_xy2_research_daily
    WHERE trade_date=$1::date AND feature_version=$2 AND build_version=$3 AND x_score IS NOT NULL`,
    [anchor,FEATURE_VERSION,DAILY_BUILD_VERSION]);
  const reproducibility=auditReproduction(byKey,overlap);
  if(!reproducibility.ok)return {ok:false,noWrites:true,reason:reproducibility.reason,
    audit:reproducibility,batch:chosen,anchor};
  const current=await sql.query(`SELECT trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct
    FROM market_business_xy2_research_daily WHERE trade_date=ANY($1::date[])
    AND feature_version=$2 AND build_version=$3
    AND tag_id IN (SELECT DISTINCT tag_id FROM market_business_xy2_member)`,
    [chosen,FEATURE_VERSION,DAILY_BUILD_VERSION]);
  const original=new Map(current.map(r=>[`${iso(r.trade_date)}|${r.tag_id}`,r]));
  const incoming=[];let previouslyNonNull=0;
  for(const d of chosen){
    const recs=computed.get(d)||[];
    let valid=0,matched=0,eligible=0;
    for(const r of recs){const old=original.get(`${d}|${r.tag_id}`);if(!old||finite(old.y_score)===null)continue;
      matched++;if(finite(r.x_score)!==null)valid++;
      if(finite(old.x_score)!==null)previouslyNonNull++;
      if(finite(r.x_score)!==null&&(finite(old.x_score)===null||finite(old.flow_1_pct)===null||finite(old.flow_5_pct)===null)){
        incoming.push(r);eligible++;
      }
    }
    if(matched<160||valid<Math.ceil(matched*.70))return {ok:false,noWrites:true,
      reason:'insufficient-recomputed-X-coverage',day:d,matched,valid,batch:chosen};
  }
  if(!incoming.length)return {ok:false,noWrites:true,reason:'no-valid-fields-recomputed',batch:chosen};
  const usage=await sql.query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
  const {STORAGE_POLICY}=require('./storage-policy');
  if(Number(usage?.[0]?.bytes||0)>=STORAGE_POLICY.softTargetMb*1024*1024)return {ok:false,noWrites:true,reason:'storage-soft-limit'};
  // Atomic and narrowly scoped UPDATE: NO INSERT; never replace existing values,
  // historical Y, tag memberships, model versions, snapshots or other tables.
  const written=await sql.query(`WITH incoming AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
      trade_date date,tag_id text,x_score numeric,flow_1_pct numeric,flow_5_pct numeric)
  ) UPDATE market_business_xy2_research_daily r SET
      x_score=COALESCE(r.x_score,i.x_score),
      flow_1_pct=COALESCE(r.flow_1_pct,i.flow_1_pct),
      flow_5_pct=COALESCE(r.flow_5_pct,i.flow_5_pct),updated_at=NOW()
    FROM incoming i WHERE r.trade_date=i.trade_date AND r.tag_id=i.tag_id
      AND r.feature_version=$2 AND r.build_version=$3 AND r.y_score IS NOT NULL
      AND i.x_score IS NOT NULL
      AND (r.x_score IS NULL OR r.flow_1_pct IS NULL OR r.flow_5_pct IS NULL)
    RETURNING r.trade_date::text AS d,r.tag_id`,
    [JSON.stringify(incoming),FEATURE_VERSION,DAILY_BUILD_VERSION]);
  const after=await readResearchXGapStatus(sql);
  return {ok:true,repaired:true,mode:'missing-X-only-no-existing-overwrite',batch:chosen,
    anchor,warmupStart,readThrough,recomputedRows:incoming.length,updatedRows:written.length,
    previouslyValidXPreserved:previouslyNonNull,audit:reproducibility,
    before:{gapDays:before.gapDays,missingXRows:before.missingXRows},
    after:{gapDays:after.gapDays,missingXRows:after.missingXRows},
    didNotWrite:['raw tables','Y','existing X values','taxonomy','XY snapshot','stock/topic operational tables']};
}
module.exports={MAX_BATCH,readResearchXGapStatus,loadHistoricXCompactRows,finishCompactXRow,auditReproduction,repairResearchXGaps};
