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
  const tableNames=['market_daily_history','institutional_trading_daily','credit_trading_daily','market_activity_daily','market_dynamic_daily','price_snapshot','market_company_profile','market_business_xy2_stock_daily','market_business_xy2_topic_daily','market_business_xy2_research_daily','market_business_xy2_snapshot','market_business_xy2_member','market_business_xy_daily','market_business_xy_snapshot','market_business_xy_member'];
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
      market_dynamic_daily:`compact-market-dynamics-${STORAGE_POLICY.compact.marketDynamics}d`,
      market_business_xy2_stock_daily:`clean-x20-stock-context-${STORAGE_POLICY.compact.stock}d`,
      market_business_xy2_topic_daily:`compact-operational-${STORAGE_POLICY.compact.topicOperational}d`,
      market_business_xy2_research_daily:`compact-numeric-research-${STORAGE_POLICY.compact.topicResearch}d`,
      market_business_xy2_snapshot:'latest-prepared-snapshots',
      market_business_xy2_member:'current-topic-membership',
      market_business_xy_daily:'legacy-derived-drop-after-verified-clean-cutover',
      market_business_xy_snapshot:'legacy-derived-drop-after-verified-clean-cutover',
      market_business_xy_member:'legacy-derived-drop-after-verified-clean-cutover'
    }
  };
  return {databaseName:String(dbRows?.[0]?.database_name||''),totalBytes,totalMb:Number((totalBytes/1024/1024).toFixed(2)),referenceBudgetMb:STORAGE_POLICY.referenceBudgetMb,referenceUsagePct:Number((totalBytes/referenceBudgetBytes*100).toFixed(1)),softTargetMb:STORAGE_POLICY.softTargetMb,softTargetUsagePct:Number((totalBytes/(STORAGE_POLICY.softTargetMb*1024*1024)*100).toFixed(1)),tables:(rows||[]).map(r=>sizeItem(r.name,r)),retentionPlan};
}


function mb(v){return Number((Math.max(0,Number(v)||0)/1024/1024).toFixed(2));}
function isoOrNull(v){if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toISOString();}

async function readDatabaseDeepAudit(sql=getSql()){
  const tableNames=['market_daily_history','institutional_trading_daily','credit_trading_daily','market_activity_daily','market_dynamic_daily','price_snapshot','market_company_profile','market_business_xy2_stock_daily','market_business_xy2_topic_daily','market_business_xy2_research_daily','market_business_xy2_snapshot','market_business_xy2_member','market_business_xy_daily','market_business_xy_snapshot','market_business_xy_member'];
  const [base,tableStats,indexStats]=await Promise.all([
    readDatabaseSizeAudit(sql),
    sql.query(`
      SELECT relname AS table_name,
             n_live_tup::bigint AS live_rows,n_dead_tup::bigint AS dead_rows,
             seq_scan::bigint AS seq_scan,idx_scan::bigint AS idx_scan,
             n_tup_ins::bigint AS inserted_rows,n_tup_upd::bigint AS updated_rows,n_tup_del::bigint AS deleted_rows,
             n_mod_since_analyze::bigint AS mods_since_analyze,
             last_vacuum,last_autovacuum,last_analyze,last_autoanalyze
      FROM pg_stat_user_tables
      WHERE relname = ANY($1::text[])
      ORDER BY relname
    `,[tableNames]).catch(()=>[]),
    sql.query(`
      SELECT s.relname AS table_name,s.indexrelname AS index_name,s.idx_scan::bigint AS idx_scan,
             pg_relation_size(s.indexrelid)::bigint AS index_bytes,
             i.indisprimary AS is_primary,i.indisunique AS is_unique,
             i.indnkeyatts::int AS key_att_count,i.indnatts::int AS total_att_count,
             i.indkey::text AS key_vector,i.indclass::text AS class_vector,
             i.indcollation::text AS collation_vector,i.indoption::text AS option_vector,
             COALESCE(pg_get_expr(i.indpred,i.indrelid),'') AS predicate,
             COALESCE(pg_get_expr(i.indexprs,i.indrelid),'') AS expressions,
             pg_get_indexdef(s.indexrelid) AS index_def
      FROM pg_stat_user_indexes s
      JOIN pg_index i ON i.indexrelid=s.indexrelid
      WHERE s.relname = ANY($1::text[])
      ORDER BY s.relname,pg_relation_size(s.indexrelid) DESC,s.indexrelname
    `,[tableNames]).catch(()=>[])
  ]);
  const statsByTable=new Map((tableStats||[]).map(r=>[String(r.table_name),r]));
  const sizeByTable=new Map((base.tables||[]).map(r=>[String(r.name),r]));
  const indexes=(indexStats||[]).map(r=>({
    table:String(r.table_name||''),name:String(r.index_name||''),idxScan:Number(r.idx_scan||0),sizeBytes:Number(r.index_bytes||0),sizeMb:mb(r.index_bytes),
    primary:Boolean(r.is_primary),unique:Boolean(r.is_unique),keyAttCount:Number(r.key_att_count||0),totalAttCount:Number(r.total_att_count||0),
    keyVector:String(r.key_vector||''),classVector:String(r.class_vector||''),collationVector:String(r.collation_vector||''),optionVector:String(r.option_vector||''),
    predicate:String(r.predicate||''),expressions:String(r.expressions||''),definition:String(r.index_def||'')
  }));
  const sig=x=>[x.table,x.keyAttCount,x.totalAttCount,x.keyVector,x.classVector,x.collationVector,x.optionVector,x.predicate,x.expressions].join('|');
  const groups=new Map();for(const x of indexes){const k=sig(x);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
  const duplicateGroups=[...groups.values()].filter(g=>g.length>1).map(g=>({table:g[0].table,indexes:g.map(x=>x.name),totalMb:Number(g.reduce((a,b)=>a+b.sizeMb,0).toFixed(2))}));
  const duplicateNames=new Set(duplicateGroups.flatMap(g=>g.indexes));
  const legacyTables=new Set(['market_business_xy_daily','market_business_xy_snapshot','market_business_xy_member']);
  const tables=tableNames.map(name=>{
    const st=statsByTable.get(name)||{},sz=sizeByTable.get(name)||{dataMb:0,indexMb:0,totalMb:0};
    const live=Number(st.live_rows||0),dead=Number(st.dead_rows||0),den=live+dead,deadPct=den?Number((dead/den*100).toFixed(1)):0;
    return {name,liveRows:live,deadRows:dead,deadPct,seqScan:Number(st.seq_scan||0),idxScan:Number(st.idx_scan||0),insertedRows:Number(st.inserted_rows||0),updatedRows:Number(st.updated_rows||0),deletedRows:Number(st.deleted_rows||0),modsSinceAnalyze:Number(st.mods_since_analyze||0),lastVacuum:isoOrNull(st.last_vacuum),lastAutovacuum:isoOrNull(st.last_autovacuum),lastAnalyze:isoOrNull(st.last_analyze),lastAutoanalyze:isoOrNull(st.last_autoanalyze),dataMb:Number(sz.dataMb||0),indexMb:Number(sz.indexMb||0),totalMb:Number(sz.totalMb||0),legacy:legacyTables.has(name)};
  });
  const recommendations=[];
  for(const t of tables){
    if(t.legacy&&t.liveRows===0&&t.totalMb>0)recommendations.push({type:'legacy-empty-table',risk:'low',table:t.name,reclaimMb:t.totalMb,note:'Clean XY v2 已不讀此 legacy 衍生表；若再次確認 cutover 狀態，可 DROP 空表/索引。'});
    if(t.deadRows>=5000||t.deadPct>=10)recommendations.push({type:'vacuum-analyze',risk:'low',table:t.name,reclaimMb:0,note:`dead rows 約 ${t.deadRows.toLocaleString()} (${t.deadPct}%)；普通 VACUUM (ANALYZE) 可整理可重用頁面與統計，但不保證 relation MB 立即下降。`});
    if(t.dataMb>0&&t.indexMb/t.dataMb>=0.75&&t.indexMb>=5)recommendations.push({type:'high-index-ratio',risk:'review',table:t.name,reclaimMb:0,note:`index ${t.indexMb.toFixed(2)} MB / data ${t.dataMb.toFixed(2)} MB，先看各 index scan 次數再決定。`});
  }
  for(const g of duplicateGroups)recommendations.push({type:'duplicate-index',risk:'review',table:g.table,reclaimMb:g.totalMb,note:`完全相同 index signature：${g.indexes.join(', ')}；需保留其中一個後才可移除其餘。`});
  for(const x of indexes){if(!x.primary&&!x.unique&&!duplicateNames.has(x.name)&&x.idxScan===0&&x.sizeMb>=0.25)recommendations.push({type:'zero-scan-index',risk:'review',table:x.table,index:x.name,reclaimMb:x.sizeMb,note:'目前 pg_stat 顯示 idx_scan=0；統計可能曾重置，只列候選，不自動刪除。'});}
  recommendations.sort((a,b)=>(Number(b.reclaimMb||0)-Number(a.reclaimMb||0))||String(a.type).localeCompare(String(b.type)));
  return {ok:true,generatedAt:new Date().toISOString(),readOnly:true,totalMb:base.totalMb,tableCount:tables.filter(t=>t.totalMb>0).length,indexCount:indexes.length,tables,indexes,duplicateGroups,recommendations,notes:['此稽核只讀 pg_stat / catalog，不刪資料、不 VACUUM。','idx_scan 是 PostgreSQL 統計值，可能因 compute restart / stats reset 而歸零；zero-scan 僅能作候選，不可單獨作刪除依據。','dead row 為估算；普通 VACUUM 主要讓空間可重用，不等於 Neon Storage 立即下降。']};
}

module.exports = { getSql, getDatabaseUrl, readDatabaseSizeAudit, readDatabaseDeepAudit };
