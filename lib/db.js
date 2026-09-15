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

module.exports = { getSql, getDatabaseUrl };
