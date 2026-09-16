const { getSql } = require('../lib/db');
const { isCronAuthorized } = require('../lib/sync-common');
const { runPriceSync, runTwseDisposalSync, runTpexDisposalSync } = require('../lib/sync-service');

const CRON_ACTIONS = {
  '0 7 * * 1-5': 'price',
  '0 11 * * 1-5': 'twse',
  '0 14 * * 1-5': 'tpex'
};

function requestedAction(req) {
  const schedule = String(req.headers?.['x-vercel-cron-schedule'] || '').trim();
  if (schedule) return CRON_ACTIONS[schedule] || '';
  return String(req.query.action || '').trim().toLowerCase();
}

async function statusResponse(req, res) {
  const sql=getSql();
  const code=String(req.query.code||'').trim();

  if(code){
    if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:'股票代碼格式錯誤'});

    const [priceRows,disposalRows]=await Promise.all([
      sql.query(`
        SELECT stock_code,stock_name,market,trade_date,close_price,previous_close,
               open_price,high_price,low_price,quote_time,source,updated_at
        FROM price_snapshot
        WHERE stock_code=$1
        LIMIT 1
      `,[code]),
      sql.query(`
        SELECT market,stock_code,stock_name,announcement_date,start_date,end_date,
               reason,updated_at
        FROM disposal_snapshot
        WHERE stock_code=$1
        ORDER BY end_date DESC,start_date DESC
      `,[code])
    ]);

    const price=priceRows[0]||null;
    const syncSources=['price_daily'];
    if(price?.market==='上市')syncSources.push('twse_disposal');
    else if(price?.market==='上櫃')syncSources.push('tpex_disposal');
    else syncSources.push('twse_disposal','tpex_disposal');

    const sync=await sql.query(`
      SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at
      FROM sync_status
      WHERE source = ANY($1::text[])
      ORDER BY source
    `,[syncSources]);

    return res.status(200).json({ok:true,code,found:Boolean(price||disposalRows.length),price,disposal:disposalRows,sync});
  }

  const [status,price,disposal]=await Promise.all([
    sql.query(`SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at FROM sync_status ORDER BY source`),
    sql.query(`SELECT market,COUNT(*)::int AS rows,MAX(trade_date) AS latest_trade_date,MAX(updated_at) AS last_write FROM price_snapshot GROUP BY market ORDER BY market`),
    sql.query(`SELECT market,COUNT(*)::int AS rows,MIN(start_date) AS min_start,MAX(end_date) AS max_end,MAX(updated_at) AS last_write FROM disposal_snapshot GROUP BY market ORDER BY market`)
  ]);
  return res.status(200).json({ok:true,status,price,disposal});
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const schedule=String(req.headers?.['x-vercel-cron-schedule']||'').trim();
    const action=requestedAction(req);

    if(schedule && !action)return res.status(400).json({ok:false,error:`未知 Cron schedule：${schedule}`});
    if(action){
      if(!isCronAuthorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});
      let result;
      if(action==='price')result=await runPriceSync({cronSchedule:schedule});
      else if(action==='twse')result=await runTwseDisposalSync();
      else if(action==='tpex')result=await runTpexDisposalSync();
      else return res.status(400).json({ok:false,error:'action 僅支援 price / twse / tpex'});
      return res.status(result.httpStatus).json(result.body);
    }

    return await statusResponse(req,res);
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
};

module.exports._test={requestedAction,CRON_ACTIONS};
