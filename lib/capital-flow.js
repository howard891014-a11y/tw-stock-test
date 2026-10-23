'use strict';
// StockZone capital-flow read model. Intentionally SELECT-only: no schema, source,
// X20 or legacy XY/Phase/Path engine changes. All metrics originate from saved Neon data.
const getSql=()=>require('./db').getSql();
const {loadMoney}=require('./capital-flow-money');
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=1)=>{const n=num(v);return n===null?null:Number(n.toFixed(d));};
const date=v=>{
  if(!v)return null;
  if(v instanceof Date)return Number.isNaN(v.getTime())?null:v.toISOString().slice(0,10);
  const s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
  const d=new Date(s);
  return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
};
// X20 describes intermediate relative strength; cached institutional money is a
// separate 5-day estimate. Crossing their signs is descriptive, NOT a buy signal.
function observeState(s){
  const x=num(s.x),cash=num(s.money5E8);
  if(x===null||cash===null||Number(s.moneyCoreValid5)<=0)return {key:'unknown',label:'待補資料'};
  if(!cash)return {key:'neutral',label:'近期中性'};
  if(x>0&&cash>0)return {key:'aligned',label:'強勢延續'};
  if(x<=0&&cash>0)return {key:'returning',label:'資金回流'};
  if(x>0&&cash<0)return {key:'warning',label:'流出留意'};
  return {key:'weak',label:'弱勢延續'};
}
function momentum(t){
  const d=num(t.dx3);
  if(d===null)return {key:'unknown',label:'中期強度變化待補'};
  return d>=3?{key:'improving',label:'近3日強度改善'}:d<=-3?{key:'cooling',label:'近3日強度走弱'}:{key:'steady',label:'中期強度變化平穩'};
}
function interpretSector(s,market){
  const z=observeState(s),cash=num(s.money5E8),x=num(s.x),d=num(s.dx3),v=Number(s.moneyCoreValid5)||0;
  if(z.key==='unknown')return '中期資金強度或近5日法人估算金額尚未齊全，暫不判讀交叉狀態。';
  const message={aligned:'中期資金強度為正，近5日法人淨流入；屬中期與近期同向。',
   returning:'中期資金強度仍未轉正，但近5日法人資金已回流；只是觀察訊號，尚非趨勢反轉確認。',
   warning:'中期資金強度仍為正，但近5日法人淨流出；應觀察是否持續。',
   weak:'中期資金強度未轉正，近5日法人仍淨流出。',neutral:'近5日法人淨額接近零，資金方向暫不明確。'};
  const pieces=[message[z.key]];
  if(d!==null)pieces.push(d>=3?'中期強度近3日上升':d<=-3?'中期強度近3日下降':'中期強度近3日變化有限');
  if(v){const aligned=cash>=0?Number(s.moneyCoreBuy5)||0:Number(s.moneyCoreSell5)||0;
    pieces.push(`核心同方向 ${aligned}/${v} 家`);
    if(v<3)pieces.push('核心公司樣本太少，屬個股主導型訊號');
  }
  if(market?.aligned&&market.regime==='RiskOff'&&cash>0)pieces.push('大盤風險防禦期仍有法人買盤，僅供追蹤');
  return `${pieces.join('；')}。這是已發生資料的分析，不是進場建議。`;
}
function sectorRow(t){
  const r={tagId:String(t.tag_id),name:String(t.tag_name||t.tag_id),parentName:String(t.parent_name||''),scope:String(t.scope||''),members:Number(t.member_count)||0,valid:Number(t.valid_count)||0,
    x:round(t.x_score,2),flow1Pct:round(t.flow_1_pct,2),flow5Pct:round(t.flow_5_pct,2),flow20Pct:round(t.flow_20_pct,2),price5Pct:round(t.raw_y_5_pct,2),
    dx3:round(t.dx3,2),flowChange3:round(t.flow_change_3,2),breadthPct:round(t.breadth_pct,1),inflowCount:Number(t.inflow_count)||0,breadthValid:Number(t.breadth_valid)||0,
    coreBreadthPct:round(t.core_breadth_pct,1),coreInflowCount:Number(t.core_inflow_count)||0,coreBreadthValid:Number(t.core_breadth_valid)||0,
    coveragePct:round(t.coverage_pct,1),reliabilityPct:round(t.reliability_pct,1)};
  r.momentum=momentum(r);
  return r;
}
const SUMMARY_SQL=`
WITH active AS (SELECT max(trade_date) AS day FROM market_business_xy2_topic_daily),
series AS (
 SELECT d.tag_id,d.trade_date,d.x_score,d.flow_5_pct,
 ROW_NUMBER() OVER (PARTITION BY d.tag_id ORDER BY d.trade_date DESC) AS rn
 FROM market_business_xy2_topic_daily d
 WHERE d.trade_date IN (SELECT trade_date FROM (SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily ORDER BY trade_date DESC LIMIT 5) z)
),
prev AS (SELECT tag_id,MAX(x_score) FILTER(WHERE rn=4) AS x3,MAX(flow_5_pct) FILTER(WHERE rn=4) AS f3 FROM series GROUP BY tag_id),
breadth AS (
 SELECT m.tag_id,COUNT(s.raw_flow_5_pct) AS breadth_valid,
 COUNT(*) FILTER(WHERE s.raw_flow_5_pct>0) AS inflow_count,
 COUNT(s.raw_flow_5_pct) FILTER(WHERE m.importance='core') AS core_breadth_valid,
 COUNT(*) FILTER(WHERE m.importance='core' AND s.raw_flow_5_pct>0) AS core_inflow_count
 FROM market_business_xy2_member m
 CROSS JOIN active d
 LEFT JOIN market_business_xy2_stock_daily s ON s.trade_date=d.day AND s.stock_code=m.stock_code AND s.market=m.market
 GROUP BY m.tag_id
)
SELECT t.*,t.x_score-p.x3 AS dx3,t.flow_5_pct-p.f3 AS flow_change_3,
 b.breadth_valid,b.inflow_count,b.core_breadth_valid,b.core_inflow_count,
 (100.0*b.inflow_count/NULLIF(b.breadth_valid,0)) AS breadth_pct,
 (100.0*b.core_inflow_count/NULLIF(b.core_breadth_valid,0)) AS core_breadth_pct
FROM market_business_xy2_topic_daily t
JOIN active act ON act.day=t.trade_date
LEFT JOIN prev p ON p.tag_id=t.tag_id
LEFT JOIN breadth b ON b.tag_id=t.tag_id
ORDER BY t.tag_name`;

// Search index only: returned alongside the summary to support company names and stock codes.
// No raw flow formula or recommendation logic is altered.
const SEARCH_INDEX_SQL=`WITH active AS (SELECT MAX(trade_date) AS day FROM market_business_xy2_topic_daily)
SELECT m.tag_id,STRING_AGG(m.stock_code||' '||COALESCE(a.stock_name,i.stock_name,m.stock_code),' ' ORDER BY m.stock_code) AS stock_search_text
FROM market_business_xy2_member m CROSS JOIN active
LEFT JOIN market_activity_daily a ON a.trade_date=active.day AND a.stock_code=m.stock_code AND a.market=m.market
LEFT JOIN institutional_trading_daily i ON i.trade_date=active.day AND i.stock_code=m.stock_code AND i.market=m.market
GROUP BY m.tag_id`;

async function getSummary(sql=getSql()){
  const [rows,w3,stockIndex]=await Promise.all([
    sql.query(SUMMARY_SQL),
    sql.query('SELECT trade_date,regime,model_version FROM market_w3_run_daily ORDER BY trade_date DESC LIMIT 1').catch(()=>[]),
    sql.query(SEARCH_INDEX_SQL).catch(e=>{console.error('capital-flow stock search index unavailable',e);return [];})
  ]);
  const asOf=date(rows?.[0]?.trade_date),m=w3?.[0]||null;
  const market={date:date(m?.trade_date),regime:String(m?.regime||''),modelVersion:String(m?.model_version||''),aligned:date(m?.trade_date)===asOf&&Boolean(m?.regime)};
  const money=await loadMoney(asOf,sql,true).catch(e=>{console.error('capital money cache not available',e);return {ready:false,rows:new Map()};});
  const searchMap=new Map((stockIndex||[]).map(z=>[String(z.tag_id),String(z.stock_search_text||'')]));
  const sectors=(rows||[]).map(x=>{const s=sectorRow(x);s.stockSearchText=searchMap.get(s.tagId)||'';
    // A partially populated or stale cache must never be interpreted as current money.
    if(money.ready&&money.asOf===asOf)Object.assign(s,money.rows.get(s.tagId)||{});
    s.observation=observeState(s);s.reading=interpretSector(s,market);return s;});
  return {ok:true,asOf,market,sectors,capitalMoney:{ready:!!money.ready,asOf:money.asOf||null,method:'stockzone-adjusted-v1',unit:'NTD 100-million',estimatedAtClose:true},methodology:{x:'既有中期資金強度分數（原計算值，不改公式）',momentum:'近3交易日 X 變化，交叉參照5日法人比例',breadth:'產業觀察使用近5日法人估算淨額之核心公司買賣家數；不等同中期強度指標的相對百分比',coreBreadth:'法人買超核心家數／近5日有效核心公司家數；一家公司一票',observation:'中期強度正負與近5日法人估算淨額交叉；只描述市場現況，不是選股訊號',noWrites:false,derivedMoneyCacheOnly:true}};
}
const DETAIL_SQL=`
WITH active AS (SELECT max(trade_date) AS day FROM market_business_xy2_topic_daily)
SELECT m.stock_code AS code,COALESCE(a.stock_name,i.stock_name,m.stock_code) AS name,m.market,m.importance,m.weight,
 s.x_score AS x,s.raw_flow_1_pct AS flow1,s.raw_flow_5_pct AS flow5,s.raw_flow_20_pct AS flow20,
 a.return_3_pct AS ret3,a.return_5_pct AS ret5,a.return_20_pct AS ret20,
 s.reliability_pct AS reliability,a.change_pct AS today_change
FROM market_business_xy2_member m
CROSS JOIN active d
LEFT JOIN market_business_xy2_stock_daily s ON s.trade_date=d.day AND s.stock_code=m.stock_code AND s.market=m.market
LEFT JOIN market_activity_daily a ON a.trade_date=d.day AND a.stock_code=m.stock_code AND a.market=m.market
LEFT JOIN institutional_trading_daily i ON i.trade_date=d.day AND i.stock_code=m.stock_code AND i.market=m.market
WHERE m.tag_id=$1 ORDER BY m.weight DESC,m.stock_code`;
// Detail-only original stock money, not sector-attributed amount. This query
// neither changes nor re-implements the settled money allocation used by TOP10.
const DETAIL_STOCK_MONEY_SQL=`WITH days AS (
 SELECT trade_date FROM (SELECT DISTINCT trade_date FROM market_daily_history WHERE trade_date<=$2::date ORDER BY trade_date DESC LIMIT 5) d
), raw AS (
 SELECT m.stock_code,m.market,d.trade_date,(i.total_net::numeric*h.close_price/100000000.0) AS cash
 FROM market_business_xy2_member m CROSS JOIN days d
 JOIN institutional_trading_daily i ON i.trade_date=d.trade_date AND i.stock_code=m.stock_code AND i.market=m.market
 JOIN market_daily_history h ON h.trade_date=d.trade_date AND h.stock_code=m.stock_code AND h.market=m.market
 WHERE m.tag_id=$1 AND i.total_net IS NOT NULL AND h.close_price>0 AND h.trade_value>0
)
SELECT stock_code,market,
 MAX(cash) FILTER(WHERE trade_date=$2::date) raw_money_1_e8,
 CASE WHEN COUNT(*)=5 AND COUNT(DISTINCT trade_date)=5 THEN SUM(cash) ELSE NULL END AS raw_money_5_e8
FROM raw GROUP BY stock_code,market`;
const HISTORY_SQL=`SELECT trade_date,x_score,flow_5_pct,raw_y_5_pct FROM market_business_xy2_topic_daily WHERE tag_id=$1 ORDER BY trade_date DESC LIMIT 15`;
async function getDetail(tagId,sql=getSql()){
  if(!/^[a-zA-Z0-9_\-]{1,100}$/.test(tagId))throw Object.assign(new Error('產業代碼格式不正確'),{statusCode:400});
  const [rows,history,topic,w3]=await Promise.all([
    sql.query(DETAIL_SQL,[tagId]),sql.query(HISTORY_SQL,[tagId]),
    sql.query('SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,x_score,flow_1_pct,flow_5_pct,flow_20_pct,raw_y_5_pct,coverage_pct,reliability_pct FROM market_business_xy2_topic_daily WHERE tag_id=$1 ORDER BY trade_date DESC LIMIT 1',[tagId]),
    sql.query('SELECT trade_date,regime,model_version FROM market_w3_run_daily ORDER BY trade_date DESC LIMIT 1').catch(()=>[])
  ]);
  if(!topic.length)throw Object.assign(new Error('找不到此產業'),{statusCode:404});
  const t=topic[0],day=date(t.trade_date),market={date:date(w3?.[0]?.trade_date),regime:String(w3?.[0]?.regime||''),aligned:day===date(w3?.[0]?.trade_date)&&!!w3?.[0]?.regime};
  const [cachedMoney,rawMoney]=await Promise.all([
    loadMoney(day,sql,false).catch(()=>({ready:false,rows:new Map()})),
    sql.query(DETAIL_STOCK_MONEY_SQL,[tagId,day]).catch(()=>[])
  ]);
  const moneyMap=new Map(rawMoney.map(r=>[`${r.stock_code}/${r.market}`,r]));
  const stocks=rows.map(z=>{
    const raw=moneyMap.get(`${z.code}/${z.market}`)||{};
    return {code:String(z.code||''),name:String(z.name||z.code||''),market:String(z.market||''),importance:String(z.importance||''),
      x:round(z.x,2),flow1Pct:round(z.flow1,2),flow5Pct:round(z.flow5,2),flow20Pct:round(z.flow20,2),
      money1RawE8:round(raw.raw_money_1_e8,4),money5RawE8:round(raw.raw_money_5_e8,4),
      return3Pct:round(z.ret3,2),return5Pct:round(z.ret5,2),return20Pct:round(z.ret20,2),
      todayChangePct:round(z.today_change,2),reliabilityPct:round(z.reliability,1)};
  });
  const breadthValid=stocks.filter(z=>z.flow5Pct!==null),inflow=breadthValid.filter(z=>z.flow5Pct>0),coreValid=breadthValid.filter(z=>z.importance==='core'),coreInflow=coreValid.filter(z=>z.flow5Pct>0);
  const s=sectorRow({...t,dx3:history.length>=4?num(history[0].x_score)-num(history[3].x_score):null,
    flow_change_3:history.length>=4?num(history[0].flow_5_pct)-num(history[3].flow_5_pct):null,
    breadth_valid:breadthValid.length,inflow_count:inflow.length,core_breadth_valid:coreValid.length,
    core_inflow_count:coreInflow.length,breadth_pct:breadthValid.length?100*inflow.length/breadthValid.length:null,
    core_breadth_pct:coreValid.length?100*coreInflow.length/coreValid.length:null});
  if(cachedMoney.ready&&cachedMoney.asOf===day)Object.assign(s,cachedMoney.rows.get(s.tagId)||{});
  s.observation=observeState(s);s.reading=interpretSector(s,market);
  return {ok:true,asOf:day,sector:s,stocks,history:history.reverse().map(h=>({date:date(h.trade_date),x:round(h.x_score,2),flow5Pct:round(h.flow_5_pct,2),price5Pct:round(h.raw_y_5_pct,2)})),market};
}
module.exports={getSummary,getDetail,observeState,sectorRow,momentum,interpretSector,SUMMARY_SQL,SEARCH_INDEX_SQL,DETAIL_SQL,DETAIL_STOCK_MONEY_SQL};
