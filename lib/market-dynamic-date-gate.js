'use strict';
// A market-wide card cannot be labelled as today's full-market statistics
// unless BOTH TWSE and TPEx contain the same complete trading date.
// This guard only reads Neon. It does not infer/recreate missing daily rows.
const MIN_ROWS = Object.freeze({'上市':500,'上櫃':300});
function marketDateGate(rows){
  const dates={},counts={};
  for(const market of ['上市','上櫃']){
    const row=(rows||[]).find(x=>String(x.market)===market)||{};
    dates[market]=String(row.trade_date||row.latest_date||'').slice(0,10)||null;
    counts[market]=Number(row.rows||0);
  }
  if(!dates['上市']||!dates['上櫃'])return {ok:false,reason:'market-history-missing',latestByMarket:dates,countsByMarket:counts};
  if(dates['上市']!==dates['上櫃'])return {ok:false,reason:'market-dates-misaligned',latestByMarket:dates,countsByMarket:counts};
  if(Object.keys(MIN_ROWS).some(m=>counts[m]<MIN_ROWS[m]))
    return {ok:false,reason:'market-stock-coverage-low',latestByMarket:dates,countsByMarket:counts};
  return {ok:true,sourceDate:dates['上市'],latestByMarket:dates,countsByMarket:counts};
}
async function readMarketDateGate(sql){
  const rows=await sql.query(`WITH d AS (
    SELECT market,MAX(trade_date) AS latest_date
    FROM market_daily_history WHERE market IN ('上市','上櫃') GROUP BY market
  ) SELECT d.market,d.latest_date::text AS trade_date,
    COUNT(h.stock_code)::int AS rows
  FROM d LEFT JOIN market_daily_history h
   ON h.market=d.market AND h.trade_date=d.latest_date
  GROUP BY d.market,d.latest_date`);
  return marketDateGate(rows);
}
module.exports={marketDateGate,readMarketDateGate,MIN_ROWS};
