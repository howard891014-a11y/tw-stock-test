const { getSql } = require('../lib/db');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const sql=getSql();
    const [status,price,disposal]=await Promise.all([
      sql.query(`SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at FROM sync_status ORDER BY source`),
      sql.query(`SELECT market,COUNT(*)::int AS rows,MAX(trade_date) AS latest_trade_date,MAX(updated_at) AS last_write FROM price_snapshot GROUP BY market ORDER BY market`),
      sql.query(`SELECT market,COUNT(*)::int AS rows,MIN(start_date) AS min_start,MAX(end_date) AS max_end,MAX(updated_at) AS last_write FROM disposal_snapshot GROUP BY market ORDER BY market`)
    ]);
    return res.status(200).json({ok:true,status,price,disposal});
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
};
