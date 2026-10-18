'use strict';
// StockZone capital-flow read model. Intentionally SELECT-only: no schema, source,
// X20 or legacy XY/Phase/Path engine changes. All metrics originate from saved Neon data.
const getSql=()=>require('./db').getSql();
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=1)=>{const n=num(v);return n===null?null:Number(n.toFixed(d));};
const date=v=>v?String(v).slice(0,10):null;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
function isCandidate(s){
  const f=num(s.flow5Pct),raw=num(s.flow20Pct),x=num(s.x),r5=num(s.return5Pct),r20=num(s.return20Pct);
  // An observable capital/price mismatch, NOT predicted upside or a buy signal.
  return f!==null&&f>=1&&raw!==null&&raw>0&&x!==null&&x>0&&r5!==null&&r5>=-6&&r5<=10&&(r20===null||r20<=25);
}
function momentum(t){
  const d=num(t.dx3),f=num(t.flow5Pct);
  if(d===null||f===null)return {key:'unknown',label:'動能資料待補'};
  if(d>=3&&f>0)return {key:'accelerating',label:'買盤增強'};
  if(d<=-3&&f<0)return {key:'retreating',label:'撤退加快'};
  if(d>=3)return {key:'improving',label:'資金改善'};
  if(d<=-3)return {key:'cooling',label:'資金降溫'};
  return {key:'steady',label:'變化平穩'};
}
function interpretSector(s,market){
  const x=num(s.x),d=num(s.dx3),f=num(s.flow5Pct),b=num(s.breadthPct),y=num(s.price5Pct);
  if(x===null||f===null)return '目前法人資金資料不足，暫不判定產業強弱。';
  const sentences=[];
  if(x>0&&f>0)sentences.push('中期法人資金偏多，近5日也持續淨流入');
  else if(x>0)sentences.push('中期資金仍在正側，但近5日法人已轉向賣超');
  else if(f>0)sentences.push('中期資金仍偏弱，近5日買盤開始回流');
  else sentences.push('中期與近期資金均偏向流出');
  if(d!==null)sentences.push(d>=3?'資金強度近3日改善':d<=-3?'資金強度近3日走弱':'資金強度近3日變化有限');
  if(b!==null)sentences.push(b>=65?'多數成分股獲法人買超，買盤分布廣':b<35?'僅少數成分股獲法人買超，買盤集中':'法人買盤擴散程度普通');
  if(y!==null&&f>0&&y<=2)sentences.push('近期資金流入，但產業5日漲幅尚低');
  else if(y!==null&&y>=12)sentences.push('產業短期已累積明顯漲幅，需留意追價風險');
  if(market?.aligned&&market.regime==='RiskOff'&&x>0&&f>0&&b>=50)sentences.push('大盤處於風險防禦期，該產業仍逆勢吸金，值得優先觀察');
  if(market?.aligned&&market.regime==='RiskOn'&&x>0&&f>0)sentences.push('大盤偏多，產業資金與環境方向一致');
  return `${sentences.join('；')}。這是已發生資料的判讀，不代表未來必然上漲。`;
}
function sectorRow(t){
  const r={tagId:String(t.tag_id),name:String(t.tag_name||t.tag_id),parentName:String(t.parent_name||''),scope:String(t.scope||''),members:Number(t.member_count)||0,valid:Number(t.valid_count)||0,
    x:round(t.x_score,2),flow1Pct:round(t.flow_1_pct,2),flow5Pct:round(t.flow_5_pct,2),flow20Pct:round(t.flow_20_pct,2),price5Pct:round(t.raw_y_5_pct,2),
    dx3:round(t.dx3,2),flowChange3:round(t.flow_change_3,2),breadthPct:round(t.breadth_pct,1),inflowCount:Number(t.inflow_count)||0,breadthValid:Number(t.breadth_valid)||0,
    coreBreadthPct:round(t.core_breadth_pct,1),coreInflowCount:Number(t.core_inflow_count)||0,coreBreadthValid:Number(t.core_breadth_valid)||0,
    opportunityCount:Number(t.opportunity_count)||0,coveragePct:round(t.coverage_pct,1),reliabilityPct:round(t.reliability_pct,1)};
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
 COUNT(*) FILTER(WHERE m.importance='core' AND s.raw_flow_5_pct>0) AS core_inflow_count,
 COUNT(*) FILTER(WHERE s.raw_flow_5_pct>=1 AND s.raw_flow_20_pct>0 AND s.x_score>0 AND a.return_5_pct BETWEEN -6 AND 10 AND (a.return_20_pct<=25 OR a.return_20_pct IS NULL)) AS opportunity_count
 FROM market_business_xy2_member m
 CROSS JOIN active d
 LEFT JOIN market_business_xy2_stock_daily s ON s.trade_date=d.day AND s.stock_code=m.stock_code AND s.market=m.market
 LEFT JOIN market_activity_daily a ON a.trade_date=d.day AND a.stock_code=m.stock_code AND a.market=m.market
 GROUP BY m.tag_id
)
SELECT t.*,t.x_score-p.x3 AS dx3,t.flow_5_pct-p.f3 AS flow_change_3,
 b.breadth_valid,b.inflow_count,b.core_breadth_valid,b.core_inflow_count,b.opportunity_count,
 (100.0*b.inflow_count/NULLIF(b.breadth_valid,0)) AS breadth_pct,
 (100.0*b.core_inflow_count/NULLIF(b.core_breadth_valid,0)) AS core_breadth_pct
FROM market_business_xy2_topic_daily t
JOIN active act ON act.day=t.trade_date
LEFT JOIN prev p ON p.tag_id=t.tag_id
LEFT JOIN breadth b ON b.tag_id=t.tag_id
ORDER BY t.tag_name`;

async function getSummary(sql=getSql()){
  const [rows,w3]=await Promise.all([
    sql.query(SUMMARY_SQL),
    sql.query('SELECT trade_date,regime,model_version FROM market_w3_run_daily ORDER BY trade_date DESC LIMIT 1').catch(()=>[])
  ]);
  const asOf=date(rows?.[0]?.trade_date),m=w3?.[0]||null;
  const market={date:date(m?.trade_date),regime:String(m?.regime||''),modelVersion:String(m?.model_version||''),aligned:date(m?.trade_date)===asOf&&Boolean(m?.regime)};
  const sectors=(rows||[]).map(x=>{const s=sectorRow(x);s.reading=interpretSector(s,market);return s;});
  return {ok:true,asOf,market,sectors,methodology:{x:'既有股票X20穩健標準化＋核心／相關等既定聚合（原計算值，不改公式）',momentum:'近3交易日 X 變化，交叉參照5日法人比例',breadth:'同產業近5日法人淨買超股票數／有效股票數（一家公司一票）',coreBreadth:'只計核心公司；一家公司一票',candidates:'個股近5日法人流量比≥1%、20日法人流量比>0、X>0、5日報酬在-6%～10%、20日報酬≤25%或缺值。是篩選條件，非上漲預測。',noWrites:true}};
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
  const stocks=rows.map(z=>{
    const v={code:String(z.code||''),name:String(z.name||z.code||''),market:String(z.market||''),importance:String(z.importance||''),x:round(z.x,2),flow1Pct:round(z.flow1,2),flow5Pct:round(z.flow5,2),flow20Pct:round(z.flow20,2),return3Pct:round(z.ret3,2),return5Pct:round(z.ret5,2),return20Pct:round(z.ret20,2),todayChangePct:round(z.today_change,2),reliabilityPct:round(z.reliability,1)};
    v.candidate=isCandidate(v);
    v.signal=v.candidate?'資金先行・價格尚低':v.flow5Pct===null||v.return5Pct===null?'資料待補':v.flow5Pct<=0?'近期法人賣超':v.return5Pct>10?'短期已有漲幅':'追蹤資金延續';
    return v;
  });
  const breadthValid=stocks.filter(z=>z.flow5Pct!==null),inflow=breadthValid.filter(z=>z.flow5Pct>0),coreValid=breadthValid.filter(z=>z.importance==='core'),coreInflow=coreValid.filter(z=>z.flow5Pct>0);
  const s=sectorRow({...t,dx3:history.length>=4?num(history[0].x_score)-num(history[3].x_score):null,flow_change_3:history.length>=4?num(history[0].flow_5_pct)-num(history[3].flow_5_pct):null,breadth_valid:breadthValid.length,inflow_count:inflow.length,core_breadth_valid:coreValid.length,core_inflow_count:coreInflow.length,breadth_pct:breadthValid.length?100*inflow.length/breadthValid.length:null,core_breadth_pct:coreValid.length?100*coreInflow.length/coreValid.length:null,opportunity_count:stocks.filter(z=>z.candidate).length});
  s.reading=interpretSector(s,market);
  return {ok:true,asOf:day,sector:s,stocks,history:history.reverse().map(h=>({date:date(h.trade_date),x:round(h.x_score,2),flow5Pct:round(h.flow_5_pct,2),price5Pct:round(h.raw_y_5_pct,2)})),market};
}
module.exports={getSummary,getDetail,isCandidate,sectorRow,momentum,interpretSector,SUMMARY_SQL,DETAIL_SQL};
