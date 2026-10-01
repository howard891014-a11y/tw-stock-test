// StockZone v2.6.5.59 — bounded Neon storage policy.
// Goal: keep normal database usage below ~400 MB on the 512 MB free budget while
// preserving every live feature and retaining compact research history to 250 trading days.

const STORAGE_POLICY = Object.freeze({
  version: 'storage-1.0.1-400mb-250d-legacy-drop',
  referenceBudgetMb: 512,
  softTargetMb: 400,
  warningMb: 390,
  hardGuardMb: 440,
  raw: Object.freeze({
    price: 120,
    institutional: 120,
    credit: 90,
    activity: 80,
  }),
  compact: Object.freeze({
    stock: 45,
    topicResearch: 250,
  }),
  liveMinDays: 20,
  xyOperationalDays: 60,
  browserPriceHistoryYears: 5,
});


const VERIFIED_LEGACY_TABLES = Object.freeze([
  'market_business_xy_member',
  'market_business_xy_daily',
  'market_business_xy_snapshot',
]);

const SAFE_RETENTION_TABLES = Object.freeze({
  market_daily_history: STORAGE_POLICY.raw.price,
  institutional_trading_daily: STORAGE_POLICY.raw.institutional,
  credit_trading_daily: STORAGE_POLICY.raw.credit,
  market_activity_daily: STORAGE_POLICY.raw.activity,
  market_business_xy2_stock_daily: STORAGE_POLICY.compact.stock,
});

function cleanInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function tableExists(sql, table) {
  const rows = await sql.query(`SELECT to_regclass('public.' || $1)::text AS rel`, [table]);
  return Boolean(rows?.[0]?.rel);
}

async function pruneMarketTable(sql, table, keepDays) {
  if (!Object.prototype.hasOwnProperty.call(SAFE_RETENTION_TABLES, table)) throw new Error(`未允許的 retention table: ${table}`);
  if (!await tableExists(sql, table)) return { table, keepDays, skipped: true, reason: 'table-missing', deletedRows: 0 };
  const keep = cleanInt(keepDays, SAFE_RETENTION_TABLES[table]);
  const rows = await sql.query(`
    WITH dates AS (
      SELECT market,trade_date,
             ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) AS rn
      FROM (
        SELECT DISTINCT market,trade_date
        FROM ${table}
        WHERE market IN ('上市','上櫃')
      ) d
    ), cutoff AS (
      SELECT market,MIN(trade_date) AS cutoff_date,COUNT(*)::int AS kept_dates
      FROM dates WHERE rn <= $1 GROUP BY market
    ), deleted AS (
      DELETE FROM ${table} t
      USING cutoff c
      WHERE t.market=c.market AND t.trade_date<c.cutoff_date
      RETURNING t.market
    )
    SELECT
      COALESCE((SELECT COUNT(*) FROM deleted),0)::int AS deleted_rows,
      COALESCE((SELECT COUNT(*) FROM deleted WHERE market='上市'),0)::int AS deleted_twse,
      COALESCE((SELECT COUNT(*) FROM deleted WHERE market='上櫃'),0)::int AS deleted_tpex,
      COALESCE((SELECT jsonb_object_agg(market,cutoff_date::text) FROM cutoff),'{}'::jsonb) AS cutoff_by_market
  `, [keep]);
  const r = rows?.[0] || {};
  return {
    table, keepDays: keep, deletedRows: Number(r.deleted_rows || 0),
    deletedByMarket: { '上市': Number(r.deleted_twse || 0), '上櫃': Number(r.deleted_tpex || 0) },
    cutoffByMarket: r.cutoff_by_market || {},
  };
}

async function pruneTopicResearch(sql, keepDays = STORAGE_POLICY.compact.topicResearch) {
  const table = 'market_business_xy2_topic_daily';
  if (!await tableExists(sql, table)) return { table, keepDays, skipped: true, reason: 'table-missing', deletedRows: 0 };
  const keep = cleanInt(keepDays, STORAGE_POLICY.compact.topicResearch);
  const rows = await sql.query(`
    WITH cutoff AS (
      SELECT MIN(trade_date) AS cutoff_date
      FROM (
        SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily
        ORDER BY trade_date DESC LIMIT $1
      ) q
    ), deleted AS (
      DELETE FROM market_business_xy2_topic_daily
      WHERE trade_date < (SELECT cutoff_date FROM cutoff)
      RETURNING 1
    )
    SELECT COALESCE((SELECT COUNT(*) FROM deleted),0)::int AS deleted_rows,
           (SELECT cutoff_date::text FROM cutoff) AS cutoff_date
  `, [keep]);
  const r = rows?.[0] || {};
  return { table, keepDays: keep, deletedRows: Number(r.deleted_rows || 0), cutoffDate: r.cutoff_date || null };
}

async function pruneStockCompact(sql, keepDays = STORAGE_POLICY.compact.stock) {
  const table = 'market_business_xy2_stock_daily';
  if (!await tableExists(sql, table)) return { table, keepDays, skipped: true, reason: 'table-missing', deletedRows: 0 };
  const keep = cleanInt(keepDays, STORAGE_POLICY.compact.stock);
  const rows = await sql.query(`
    WITH cutoff AS (
      SELECT MIN(trade_date) AS cutoff_date
      FROM (
        SELECT DISTINCT trade_date FROM market_business_xy2_stock_daily
        ORDER BY trade_date DESC LIMIT $1
      ) q
    ), deleted AS (
      DELETE FROM market_business_xy2_stock_daily
      WHERE trade_date < (SELECT cutoff_date FROM cutoff)
      RETURNING 1
    )
    SELECT COALESCE((SELECT COUNT(*) FROM deleted),0)::int AS deleted_rows,
           (SELECT cutoff_date::text FROM cutoff) AS cutoff_date
  `, [keep]);
  const r = rows?.[0] || {};
  return { table, keepDays: keep, deletedRows: Number(r.deleted_rows || 0), cutoffDate: r.cutoff_date || null };
}


async function inspectLegacyTable(sql, table) {
  if (!VERIFIED_LEGACY_TABLES.includes(table)) throw new Error(`未允許的 legacy table: ${table}`);
  const exists = await tableExists(sql, table);
  if (!exists) return { table, exists: false, rows: 0, totalBytes: 0, totalMb: 0 };
  const rows = await sql.query(`SELECT COUNT(*)::bigint AS rows, pg_total_relation_size('public.${table}'::regclass)::bigint AS total_bytes FROM public.${table}`);
  const r = rows?.[0] || {};
  const totalBytes = Math.max(0, Number(r.total_bytes) || 0);
  return { table, exists: true, rows: Math.max(0, Number(r.rows) || 0), totalBytes, totalMb: Number((totalBytes / 1024 / 1024).toFixed(2)) };
}

async function dropVerifiedEmptyLegacyTable(sql, table) {
  const before = await inspectLegacyTable(sql, table);
  if (!before.exists) return { ...before, dropped: false, skipped: true, reason: 'table-missing' };
  if (before.rows !== 0) return { ...before, dropped: false, skipped: true, reason: 'table-not-empty' };
  // No CASCADE on purpose: any unexpected dependency makes PostgreSQL reject the DROP.
  await sql.query(`DROP TABLE IF EXISTS public.${table}`);
  const afterExists = await tableExists(sql, table);
  if (afterExists) throw new Error(`${table} DROP 後仍存在`);
  return { ...before, dropped: true, skipped: false, reason: 'verified-empty-legacy' };
}

async function vacuumAnalyzeCredit(sql) {
  const table = 'credit_trading_daily';
  if (!await tableExists(sql, table)) return { table, ok: true, skipped: true, reason: 'table-missing' };
  const beforeRows = await sql.query(`SELECT n_live_tup::bigint AS live_rows,n_dead_tup::bigint AS dead_rows,last_vacuum,last_autovacuum,last_analyze,last_autoanalyze FROM pg_stat_user_tables WHERE relname=$1`, [table]).catch(() => []);
  const before = beforeRows?.[0] || {};
  try {
    // Plain VACUUM only. Never VACUUM FULL: we want reusable pages/statistics without rewrite/ACCESS EXCLUSIVE risk.
    await sql.query(`VACUUM (ANALYZE) public.credit_trading_daily`);
    const afterRows = await sql.query(`SELECT n_live_tup::bigint AS live_rows,n_dead_tup::bigint AS dead_rows,last_vacuum,last_autovacuum,last_analyze,last_autoanalyze FROM pg_stat_user_tables WHERE relname=$1`, [table]).catch(() => []);
    return { table, ok: true, skipped: false, before, after: afterRows?.[0] || {}, mode: 'VACUUM (ANALYZE)' };
  } catch (err) {
    // A VACUUM failure never rolls back or invalidates the already-safe legacy-table cleanup.
    return { table, ok: false, skipped: false, before, error: String(err?.message || err), mode: 'VACUUM (ANALYZE)' };
  }
}

async function runVerifiedLegacyCleanup({ sql = null, vacuumCredit = true } = {}) {
  const db = require('./db');
  const q = sql || db.getSql();
  const before = await db.readDatabaseSizeAudit(q);
  const legacy = [];
  for (const table of VERIFIED_LEGACY_TABLES) legacy.push(await dropVerifiedEmptyLegacyTable(q, table));
  const vacuum = vacuumCredit ? await vacuumAnalyzeCredit(q) : { table: 'credit_trading_daily', ok: true, skipped: true, reason: 'disabled' };
  const after = await db.readDatabaseSizeAudit(q);
  const expectedReclaimMb = Number(legacy.filter(x => x.dropped).reduce((sum, x) => sum + Number(x.totalMb || 0), 0).toFixed(2));
  const reclaimedAuditMb = Number(Math.max(0, Number(before.totalMb || 0) - Number(after.totalMb || 0)).toFixed(2));
  return {
    ok: true,
    mode: 'verified-legacy-drop-plus-safe-vacuum',
    legacyTables: VERIFIED_LEGACY_TABLES,
    droppedTables: legacy.filter(x => x.dropped).map(x => x.table),
    expectedReclaimMb,
    reclaimedAuditMb,
    legacy,
    vacuum,
    before,
    after,
    preserved: ['market_daily_history','institutional_trading_daily','credit_trading_daily','market_activity_daily','market_business_xy2_stock_daily','market_business_xy2_topic_daily','market_business_xy2_snapshot','market_business_xy2_member'],
    note: '只 DROP 已驗證為空的三張 legacy XY 表且不使用 CASCADE；信用表只做普通 VACUUM (ANALYZE)，不做 VACUUM FULL。Neon 6h History 可能讓 Console 儲存量延遲下降。',
  };
}

async function runStorageMaintenance({ sql = null } = {}) {
  const db = require('./db');
  const q = sql || db.getSql();
  const before = await db.readDatabaseSizeAudit(q).catch(e => ({ error: String(e?.message || e), totalMb: null, tables: [] }));
  const actions = [];
  // Order matters: derived activity is the cheapest/safest first reclaim, then other raw layers.
  actions.push(await pruneMarketTable(q, 'market_activity_daily', STORAGE_POLICY.raw.activity));
  actions.push(await pruneMarketTable(q, 'credit_trading_daily', STORAGE_POLICY.raw.credit));
  actions.push(await pruneMarketTable(q, 'institutional_trading_daily', STORAGE_POLICY.raw.institutional));
  actions.push(await pruneMarketTable(q, 'market_daily_history', STORAGE_POLICY.raw.price));
  actions.push(await pruneStockCompact(q, STORAGE_POLICY.compact.stock));
  actions.push(await pruneTopicResearch(q, STORAGE_POLICY.compact.topicResearch));
  const after = await db.readDatabaseSizeAudit(q).catch(e => ({ error: String(e?.message || e), totalMb: null, tables: [] }));
  const deletedRows = actions.reduce((sum, x) => sum + Number(x?.deletedRows || 0), 0);
  return {
    ok: true,
    policyVersion: STORAGE_POLICY.version,
    targetMb: STORAGE_POLICY.softTargetMb,
    deletedRows,
    actions,
    before,
    after,
    note: 'DELETE 後 PostgreSQL relation size 可能不會立即下降；已釋出的頁面可由後續寫入重用，Neon 儲存統計也可能延遲更新。',
  };
}

module.exports = { STORAGE_POLICY, SAFE_RETENTION_TABLES, VERIFIED_LEGACY_TABLES, pruneMarketTable, pruneTopicResearch, pruneStockCompact, runVerifiedLegacyCleanup, runStorageMaintenance };
