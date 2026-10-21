'use strict';
/**
 * StockZone v2.6.8.2. READ ONLY Neon adapter for archived V4 5+5 policy.
 * No Supabase SDK, URL, client, snapshots or backtest tables.
 * Neon candidate feature lineage is EXPLICIT and is NOT presented as
 * byte-for-byte identical to historical Supabase backtest features.
 * Frozen selection formula modules are never edited here.
 */
const {getSql,getDatabaseUrl}=require('./db');
const {fetchW3D112Inputs}=require('./w3-d112-inputs');
const {selectFivePlusFiveWithW3D112}=require('./stockzone-five-plus-five-w3d112');

const FEATURE_QUERY=`
WITH sessions AS MATERIALIZED (
 SELECT trade_date,ROW_NUMBER() OVER(ORDER BY trade_date) AS k FROM (
  SELECT DISTINCT trade_date FROM market_daily_history
  WHERE trade_date <= $1::date ORDER BY trade_date DESC LIMIT 31
 ) d
), active AS (SELECT k,trade_date FROM sessions WHERE trade_date=$1::date),
prices AS MATERIALIZED (
 SELECT p.trade_date,p.stock_code,p.stock_name,p.market,p.close_price::float8 AS close_price,
 p.trade_value::float8 AS trade_value,s.k,
 LAG(p.close_price::float8,3) OVER w AS close3,
 LAG(p.close_price::float8,5) OVER w AS close5,
 LAG(p.close_price::float8,20) OVER w AS close20,
 LAG(s.k,20) OVER w AS k20,
 AVG(p.trade_value::float8) OVER w20 AS avg_value20,
 AVG(p.close_price::float8) OVER w20 AS ma20,
 STDDEV_SAMP(p.close_price::float8) OVER w20 AS sd20,
 COUNT(*) OVER w20 AS days20
 FROM market_daily_history p JOIN sessions s USING(trade_date)
 WHERE p.close_price>0 AND p.trade_value>0
 WINDOW w AS (PARTITION BY p.market,p.stock_code ORDER BY s.k),
 w20 AS (PARTITION BY p.market,p.stock_code ORDER BY s.k ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)
), market_prices AS MATERIALIZED (
 SELECT m.trade_date,m.taiex_close::float8 AS taiex,
 LAG(m.taiex_close::float8,5) OVER(ORDER BY s.k) AS taiex5,
 AVG(m.taiex_close::float8) OVER(ORDER BY s.k ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS index_ma20,
 COUNT(*) OVER(ORDER BY s.k ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS index_days
 FROM market_dynamic_daily m JOIN sessions s USING(trade_date)
 WHERE m.taiex_close>0
),
stockflows AS MATERIALIZED (
 SELECT sf.trade_date,sf.stock_code,sf.market,sf.raw_flow_5_pct::float8 AS flow5,
 LAG(sf.raw_flow_5_pct::float8,3) OVER(PARTITION BY sf.market,sf.stock_code ORDER BY s.k) AS flow5_prev3,
 LAG(s.k,3) OVER(PARTITION BY sf.market,sf.stock_code ORDER BY s.k) AS flow_kprev3
 FROM market_business_xy2_stock_daily sf JOIN sessions s USING(trade_date)
),
sectorflows AS MATERIALIZED (
 SELECT t.trade_date,t.tag_id,t.raw_y_5_pct::float8 AS sector_ret5,
 t.flow_5_pct::float8 AS sector_flow5,
 LAG(t.flow_5_pct::float8,3) OVER(PARTITION BY t.tag_id ORDER BY s.k) AS sector_flow_prev3,
 LAG(s.k,3) OVER(PARTITION BY t.tag_id ORDER BY s.k) AS sector_kprev3
 FROM market_business_xy2_topic_daily t JOIN sessions s USING(trade_date)
),
latest AS(
 SELECT p.*, f.flow5,f.flow5_prev3,f.flow_kprev3,
 (p.close_price/p.close5-1)*100 AS ret5,
 (p.close_price/p.close3-1)*100 AS ret3,
 (p.close_price/p.close20-1)*100 AS ret20,
 (m.taiex/m.taiex5-1)*100 AS taiex_ret5,
 ((p.close_price/p.ma20-1)-(m.taiex/m.index_ma20-1))*100 AS relative_gap20,
 m.taiex,m.index_days
 FROM prices p JOIN active a ON a.k=p.k
 JOIN market_prices m ON m.trade_date=p.trade_date
 JOIN stockflows f ON f.trade_date=p.trade_date AND f.market=p.market AND f.stock_code=p.stock_code
 WHERE p.k20=p.k-20 AND p.days20=20 AND m.index_days=20
 AND p.close3>0 AND p.close5>0 AND p.close20>0 AND m.taiex5>0 AND m.index_ma20>0
 AND p.ma20>0 AND p.sd20 IS NOT NULL AND p.avg_value20>=100000000
 AND p.trade_value>=50000000 AND f.flow_kprev3=p.k-3
)
SELECT l.trade_date::text AS trade_date,l.stock_code,l.stock_name,l.market,m.tag_id,
 l.close_price,l.trade_value,l.avg_value20,l.ret3,l.ret5,l.ret20,l.taiex_ret5,
 l.flow5,l.flow5-l.flow5_prev3 AS dflow5_3,
 t.sector_flow5,t.sector_flow5-t.sector_flow_prev3 AS delta_sector_flow,
 t.sector_ret5-l.taiex_ret5 AS relative_industry_ret5,
 l.relative_gap20,l.sd20,l.ma20
FROM latest l JOIN market_business_xy2_member m USING(market,stock_code)
JOIN sectorflows t ON t.trade_date=l.trade_date AND t.tag_id=m.tag_id
WHERE t.sector_kprev3=l.k-3 AND t.sector_ret5 IS NOT NULL
 AND t.sector_flow5 IS NOT NULL AND t.sector_flow_prev3 IS NOT NULL
 AND l.flow5 IS NOT NULL AND l.flow5_prev3 IS NOT NULL
ORDER BY l.market,l.stock_code,m.tag_id`;

const DATES_QUERY=`
SELECT (SELECT MAX(trade_date)::text FROM market_business_xy2_topic_daily) AS latest_sector,
 (SELECT MAX(trade_date)::text FROM market_business_xy2_stock_daily) AS latest_stockflow,
 (SELECT MAX(trade_date)::text FROM market_business_xy2_research_daily) AS latest_research,
 (SELECT MAX(trade_date)::text FROM market_daily_history) AS latest_price,
 (SELECT MAX(trade_date)::text FROM market_dynamic_daily) AS latest_market,
 (SELECT MAX(trade_date)::text FROM market_w3_run_daily WHERE model_version='W3-D.1.2') AS latest_w3`;
const W3_CHECK_QUERY=`SELECT trade_date::text AS trade_date,regime,model_version
 FROM market_w3_run_daily WHERE trade_date=$1::date ORDER BY computed_at DESC LIMIT 1`;

const MODEL='v2.6.8.2';
function neonOnly(){
 const raw=getDatabaseUrl();
 if(!raw)throw Object.assign(new Error('Vercel 尚未配置資料庫連線'),{statusCode:503});
 let u;try{u=new URL(raw);}catch{throw Object.assign(new Error('資料庫連線格式無效'),{statusCode:503});}
 if(!u.hostname.endsWith('.neon.tech'))throw Object.assign(new Error('拒絕使用非 Neon 的資料庫來源'),{statusCode:503});
}
function iso(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';}
function n(v){return v===null||v===undefined||v===''?null:Number(v);}
function publicStock(r){return {stock_code:r.stock_code,stock_name:r.stock_name||r.stock_code,market:r.market,
 rank:r.rank,stockzoneTier:r.stockzoneTier,s2r3Score:n(r.s2r3Score),originalScore:n(r.originalScore),upScore:n(r.upScore),
 tag_id:r.tag_id||null};}
async function getFeaturedDaily({sql,inputsFetcher=fetchW3D112Inputs,scenario='original_all',skipConnectionCheck=false}={}){
 if(!skipConnectionCheck)neonOnly();
 const db=sql||getSql();
 const meta=await db.query(DATES_QUERY);
 const dates=meta?.[0];
 if(!dates)throw Object.assign(new Error('Neon 尚無日期狀態'),{statusCode:503});
 // Never fabricate a current-day stock list from yesterday's mixed data.
 const sourceDates=[dates.latest_sector,dates.latest_stockflow,dates.latest_research,dates.latest_w3].map(iso);
 if(sourceDates.some(x=>!x))throw Object.assign(new Error('Neon 尚缺完整產業／W3 資料'),{statusCode:503});
 const day=sourceDates.slice().sort()[0];
 if(sourceDates.some(x=>x!==day))throw Object.assign(new Error(`產業／W3 截止日期不同：${sourceDates.join(' / ')}；拒絕混日選股`),{statusCode:503});
 const saved=await db.query(W3_CHECK_QUERY,[day]);
 if(saved?.[0]?.model_version!=='W3-D.1.2'||saved?.[0]?.trade_date!==day)
   throw Object.assign(new Error('未找到與當日對應的 Neon W3-D.1.2 已保存狀態'),{statusCode:503});
 const inputs=(await inputsFetcher(db)).filter(r=>String(r.date).slice(0,10)<=day);
 if(!inputs.length||inputs.at(-1)?.date!==day)throw Object.assign(new Error('Neon W3 原始資料與選股日期不符'),{statusCode:503});
 // W3-D.1.2 is executed from its frozen original program, never from manually supplied dates.
 const {computeW3D112}=require('./w3-d112');
 const calculated=computeW3D112(inputs).records.at(-1);
 if(!calculated||!calculated.valid||calculated.inputQuality!=='complete')
   throw Object.assign(new Error('當日 W3-D.1.2 原始輸入未通過完整性檢查，禁止提供推薦'),{statusCode:503});
 if(calculated.regime!==saved[0].regime)
   throw Object.assign(new Error('Neon 保存W3狀態與原始公式即時計算不一致，停止推薦'),{statusCode:503});
 // RiskOff must be 0+0. The frozen bridge still calculates and authenticates the market state.
 const rows=calculated.regime==='RiskOff'?[]:await db.query(FEATURE_QUERY,[day]);
 if(calculated.regime!=='RiskOff'&&rows.length===0)
   throw Object.assign(new Error('Neon 沒有足以形成完整排名母體的當日資料'),{statusCode:503});
 const pick=selectFivePlusFiveWithW3D112(rows,inputs,{asOfDate:day,scenario});
 const sourceQuality={origin:'Neon PostgreSQL',asOfDate:day,latestPriceDate:iso(dates.latest_price),latestMarketDate:iso(dates.latest_market),
 taggedInputRows:rows.length,originQuery:'market_daily_history + market_dynamic_daily + market_business_xy2_{member,stock_daily,topic_daily,research_daily}',
 caveat:'Neon 產業5日報酬與歷史研究產業5日報酬已確認數值不一致（2026-10-16 building_material：Neon 1.6861% / 研究資料 4.0416%）。這是新資料來源的研究預覽，絕不可宣稱重現原版回測。',
 status:calculated.regime==='RiskOff'?'OFF_VERIFIED':'NEON_RECONSTRUCTION_PARITY_MISMATCH_CONFIRMED'};
 return {ok:true,version:MODEL,asOfDate:day,scene:pick.scene,w3ModelVersion:pick.w3ModelVersion,
 scenario:pick.scenario,core:pick.core.map(publicStock),extended:pick.extended.map(publicStock),
 coreCount:pick.coreCount,extendedCount:pick.extendedCount,sourceQuality,
 paperTradingReady:false,backtestParityVerified:false,noAutoTrades:true};
}
module.exports={FEATURE_QUERY,DATES_QUERY,W3_CHECK_QUERY,neonOnly,getFeaturedDaily};
