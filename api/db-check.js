const { getSql } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.query.code || '').trim();
  if (!/^\d{4,6}$/.test(code)) {
    return res.status(400).json({ ok:false, error:'股票代碼格式錯誤' });
  }

  try {
    const sql = getSql();
    const [priceRows, disposalRows] = await Promise.all([
      sql.query(`
        SELECT stock_code,stock_name,market,trade_date,close_price,previous_close,
               open_price,high_price,low_price,quote_time,source,updated_at
        FROM price_snapshot
        WHERE stock_code=$1
        LIMIT 1
      `, [code]),
      sql.query(`
        SELECT market,stock_code,stock_name,announcement_date,start_date,end_date,
               reason,updated_at
        FROM disposal_snapshot
        WHERE stock_code=$1
        ORDER BY end_date DESC,start_date DESC
      `, [code])
    ]);

    const price = priceRows[0] || null;
    const syncSources = ['price_daily'];
    if (price?.market === '上市') syncSources.push('twse_disposal');
    else if (price?.market === '上櫃') syncSources.push('tpex_disposal');
    else syncSources.push('twse_disposal', 'tpex_disposal');

    const sync = await sql.query(`
      SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at
      FROM sync_status
      WHERE source = ANY($1::text[])
      ORDER BY source
    `, [syncSources]);

    return res.status(200).json({
      ok:true,
      code,
      found:Boolean(price || disposalRows.length),
      price,
      disposal:disposalRows,
      sync
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
};
