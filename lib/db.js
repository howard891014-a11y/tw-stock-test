const { neon } = require('@neondatabase/serverless');
const { STORAGE_POLICY } = require('./storage-policy');

let cachedSql = null;
let cachedUrl = '';

function getDatabaseUrl() {
  return process.env.DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_URL || '';
}

function getSql() {
  const url = getDatabaseUrl();
  if (!url) throw new Error('缺少 Neon 連線環境變數（DB_URL / DATABASE_URL）');
  if (!cachedSql || cachedUrl !== url) {
    cachedUrl = url;
    cachedSql = neon(url);
  }
  return cachedSql;
}

function sizeItem(name,row={}){
  const n=v=>Math.max(0,Number(v)||0),mb=v=>Number((n(v)/1024/1024).toFixed(2));
  return {name,dataBytes:n(row.data_bytes),indexBytes:n(row.index_bytes),totalBytes:n(row.total_bytes),dataMb:mb(row.data_bytes),indexMb:mb(row.index_bytes),totalMb:mb(row.total_bytes)};
}

async function readDatabaseSizeAudit(sql=getSql()){
  const tableNames=['market_daily_history','institutional_trading_daily','credit_trading_daily','market_activity_daily','price_snapshot','market_company_profile','market_business_xy2_stock_daily','market_business_xy2_topic_daily','market_business_xy2_snapshot','market_business_xy2_member','market_business_xy_daily','market_business_xy_snapshot','market_business_xy_member'];
  const dbRows=await sql.query(`SELECT current_database() AS database_name,pg_database_size(current_database())::bigint AS total_bytes`);
  const rows=await sql.query(`
    WITH names(name) AS (SELECT UNNEST($1::text[])), rels AS (
      SELECT name,to_regclass('public.'||name) AS rel FROM names
    )
    SELECT name,
      CASE WHEN rel IS NULL THEN 0 ELSE pg_relation_size(rel) END::bigint AS data_bytes,
      CASE WHEN rel IS NULL THEN 0 ELSE pg_indexes_size(rel) END::bigint AS index_bytes,
      CASE WHEN rel IS NULL THEN 0 ELSE pg_total_relation_size(rel) END::bigint AS total_bytes
    FROM rels ORDER BY total_bytes DESC,name
  `,[tableNames]);
  const totalBytes=Math.max(0,Number(dbRows?.[0]?.total_bytes)||0),referenceBudgetBytes=STORAGE_POLICY.referenceBudgetMb*1024*1024;
  const retentionPlan={
    policyVersion:STORAGE_POLICY.version,
    pruneEnabled:true,
    mode:'bounded-retention',
    softTargetMb:STORAGE_POLICY.softTargetMb,
    warningMb:STORAGE_POLICY.warningMb,
    hardGuardMb:STORAGE_POLICY.hardGuardMb,
    dailyEgressTarget:{idealMb:50,maxMb:100},
    researchTargetDays:STORAGE_POLICY.compact.topicResearch,
    browserPriceHistoryYears:STORAGE_POLICY.browserPriceHistoryYears,
    tables:{
      price_snapshot:'latest-per-stock',
      market_daily_history:`raw-ohlcv-${STORAGE_POLICY.raw.price}d; long individual-stock price history stays Yahoo/browser IndexedDB`,
      institutional_trading_daily:`raw-${STORAGE_POLICY.raw.institutional}d`,
      credit_trading_daily:`raw-${STORAGE_POLICY.raw.credit}d`,
      market_activity_daily:`derived-rolling-${STORAGE_POLICY.raw.activity}d`,
      market_business_xy2_stock_daily:`clean-x20-stock-context-${STORAGE_POLICY.compact.stock}d`,
      market_business_xy2_topic_daily:`compact-research-${STORAGE_POLICY.compact.topicResearch}d`,
      market_business_xy2_snapshot:'latest-prepared-snapshots',
      market_business_xy2_member:'current-topic-membership',
      market_business_xy_daily:'legacy-derived-delete-after-verified-clean-cutover',
      market_business_xy_snapshot:'legacy-derived-delete-after-verified-clean-cutover',
      market_business_xy_member:'legacy-derived-delete-after-verified-clean-cutover'
    }
  };
  return {databaseName:String(dbRows?.[0]?.database_name||''),totalBytes,totalMb:Number((totalBytes/1024/1024).toFixed(2)),referenceBudgetMb:STORAGE_POLICY.referenceBudgetMb,referenceUsagePct:Number((totalBytes/referenceBudgetBytes*100).toFixed(1)),softTargetMb:STORAGE_POLICY.softTargetMb,softTargetUsagePct:Number((totalBytes/(STORAGE_POLICY.softTargetMb*1024*1024)*100).toFixed(1)),tables:(rows||[]).map(r=>sizeItem(r.name,r)),retentionPlan};
}

module.exports = { getSql, getDatabaseUrl, readDatabaseSizeAudit };
