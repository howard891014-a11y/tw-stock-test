'use strict';
const {getSql}=require('./db');
const {STORAGE_POLICY}=require('./storage-policy');
async function backfillResearch500D({sql=getSql(),batchDays=8}={}){
  const limit=Math.max(1,Math.min(15,Number(batchDays)||8));
  const before=await sql.query(`SELECT COUNT(DISTINCT trade_date)::int AS days,MIN(trade_date)::text AS oldest,MAX(trade_date)::text AS newest FROM market_business_xy2_research_daily`);
  const source=await sql.query(`SELECT COUNT(DISTINCT trade_date)::int AS days,MIN(trade_date)::text AS oldest FROM market_business_xy2_topic_daily`);
  const pending=await sql.query(`SELECT t.trade_date::text AS d FROM market_business_xy2_topic_daily t
    LEFT JOIN market_business_xy2_research_daily r ON r.trade_date=t.trade_date AND r.tag_id=t.tag_id
    WHERE r.tag_id IS NULL GROUP BY t.trade_date ORDER BY t.trade_date ASC LIMIT $1`,[limit]);
  let inserted=0;
  for(const row of pending){
    const result=await sql.query(`INSERT INTO market_business_xy2_research_daily
      (trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,return_1_pct,price_breadth,activation_rate,feature_version,build_version,updated_at)
      SELECT trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,NULL,price_breadth,activation_rate,feature_version,build_version,NOW()
      FROM market_business_xy2_topic_daily WHERE trade_date=$1::date
      ON CONFLICT (trade_date,tag_id) DO NOTHING RETURNING tag_id`,[row.d]);
    inserted+=result.length;
  }
  // Retain the newest 500 trading sessions, never 500 calendar days.
  await sql.query(`DELETE FROM market_business_xy2_research_daily
    WHERE trade_date < (SELECT MIN(trade_date) FROM
      (SELECT DISTINCT trade_date FROM market_business_xy2_research_daily ORDER BY trade_date DESC LIMIT $1) q)`,
      [STORAGE_POLICY.compact.topicResearch]);
  const after=await sql.query(`SELECT COUNT(DISTINCT trade_date)::int AS days,MIN(trade_date)::text AS oldest,MAX(trade_date)::text AS newest FROM market_business_xy2_research_daily`);
  return {ok:true,mode:'recover-existing-computed-topic-days',targetDays:500,insertedRows:inserted,
    processedDates:pending.length,before:before[0],after:after[0],availableSource:source[0],
    historicalSourceMissing:Number(after[0]?.days||0)<500,
    note:'只補回既有 topic_daily 已計算的歷史資料；更早 500D 需要官方歷史來源與完整逐日計算管線，不能憑空推算。'};
}
module.exports={backfillResearch500D};
