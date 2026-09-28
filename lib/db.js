const { neon } = require('@neondatabase/serverless');

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
  const totalBytes=Math.max(0,Number(dbRows?.[0]?.total_bytes)||0),referenceBudgetBytes=512*1024*1024;
  const retentionPlan={
    pruneEnabled:false,
    mode:'audit-only',
    dailyEgressTarget:{idealMb:50,maxMb:100},
    tables:{
      price_snapshot:'latest-per-stock',
      market_daily_history:'full-ohlcv-60-120d; compact-research-to-500d',
      institutional_trading_daily:'raw-90-250d',
      credit_trading_daily:'raw-60-120d',
      market_activity_daily:'short-retention-or-rolling',
      market_business_xy2_stock_daily:'clean-x20-stock-context-45d',
      market_business_xy2_topic_daily:'clean-topic-history-to-500d',
      market_business_xy2_snapshot:'latest-prepared-snapshots',
      market_business_xy2_member:'current-topic-membership',
      market_business_xy_daily:'legacy-derived-delete-after-verified-clean-cutover',
      market_business_xy_snapshot:'legacy-derived-delete-after-verified-clean-cutover',
      market_business_xy_member:'legacy-derived-delete-after-verified-clean-cutover'
    }
  };
  return {databaseName:String(dbRows?.[0]?.database_name||''),totalBytes,totalMb:Number((totalBytes/1024/1024).toFixed(2)),referenceBudgetMb:512,referenceUsagePct:Number((totalBytes/referenceBudgetBytes*100).toFixed(1)),tables:(rows||[]).map(r=>sizeItem(r.name,r)),retentionPlan};
}

module.exports = { getSql, getDatabaseUrl, readDatabaseSizeAudit };
