'use strict';
// StockZone v2.7.0.52: reproducible proxy of stock-margin maintenance,
// NOT actual brokerage account collateral maintenance. Uses TWSE/TPEx public
// daily credit balances and the same-day traded VWAP / official close.
const getSql=()=>require('./db').getSql();
const RATE=0.60;
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const round=(v,d=2)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const iso=v=>String(v||'').slice(0,10);
const valid=x=>Number.isFinite(x)&&x>=0;
function marginStep(prior,row){
  const q=num(row.margin_balance),prev=num(row.margin_prev_balance),buy=num(row.margin_buy),sell=num(row.margin_sell),repay=num(row.margin_cash_repay);
  const close=num(row.close_price),volume=num(row.trade_volume),value=num(row.trade_value);
  const vwap=volume>0&&value>0?value/volume:close;
  if(![q,prev,buy,sell,repay].every(valid)||Math.abs(prev+buy-sell-repay-q)>0.1) return {valid:false,reason:'信用餘額不平衡'};
  if(q===0)return {valid:true,quantity:0,cost:null,unknown:0,asOfDate:iso(row.trade_date),lastClose:close};
  if(!(close>0)||!(vwap>0))return {valid:false,reason:'缺少同日有效股價'};
  // An old holding's actual loan cost is unknowable from exchange net flows.
  // Seed it with the earliest observed VWAP, retaining an explicit unknown share.
  const continuity=prior?.valid&&prior.asOfDate<iso(row.trade_date)&&Math.abs(prior.quantity-prev)<0.1;
  const baseCost=continuity?prior.cost:vwap;
  const baseUnknown=continuity?prior.unknown:prev;
  const oldRemaining=Math.max(0,prev-sell-repay);
  const oldWeighted=oldRemaining*baseCost;
  const total=oldRemaining+buy;
  if(Math.abs(total-q)>0.1||!(baseCost>0))return {valid:false,reason:'倉位無法延續'};
  const unknown=prev>0?Math.min(oldRemaining,baseUnknown*oldRemaining/prev):0;
  return {valid:true,quantity:q,cost:(oldWeighted+buy*vwap)/q,unknown,
    asOfDate:iso(row.trade_date),lastClose:close,modelRate:RATE};
}
function estimate(state){
 if(!state?.valid||!(state.quantity>0)||!(state.cost>0)||!(state.lastClose>0))return null;
 const unknownShare=state.unknown/state.quantity;
 return {pct:round(100*state.lastClose/(state.cost*RATE)),cost:round(state.cost,3),
  unknownSharePct:round(100*unknownShare,1),confidence:unknownShare<=0.2?'較高':'初始成本影響大',
  date:state.asOfDate,rate:RATE,estimated:true};
}
async function stockEstimate(code,market,sql=getSql()){
 if(!/^\d{4,6}$/.test(String(code)))return null;
 const rows=await sql.query(`SELECT c.trade_date::text AS trade_date,c.margin_prev_balance,c.margin_buy,c.margin_sell,c.margin_cash_repay,c.margin_balance,
   h.close_price,h.trade_volume,h.trade_value
 FROM credit_trading_daily c LEFT JOIN market_daily_history h ON h.trade_date=c.trade_date AND h.stock_code=c.stock_code
 WHERE c.stock_code=$1 AND ($2='' OR c.market=$2)
 ORDER BY c.trade_date DESC LIMIT 130`,[String(code),String(market||'')]);
 let state=null,count=0,invalid=0;
 for(const row of rows.reverse()){
  const next=marginStep(state,row);
  if(next.valid){state=next;count++} else {state=null;invalid++}
 }
 const e=estimate(state);
 return e?{...e,sampleDays:count,invalidDays:invalid,confidence:count>=60?e.confidence:'歷史樣本不足',source:'TWSE／TPEx 融資交易及每日股價'}:
  {pct:null,date:rows.at(-1)?.trade_date||null,estimated:true,reason:'融資或同日收盤資料不足'};
}
let ready=false;
async function ensureSchema(sql){
 if(ready)return;
 await sql.query(`CREATE TABLE IF NOT EXISTS sz_margin_cost_state (
  market text NOT NULL,stock_code text NOT NULL,trade_date date NOT NULL,
  quantity numeric NOT NULL,cost numeric,unknown numeric NOT NULL,last_close numeric,
  valid boolean NOT NULL DEFAULT true,PRIMARY KEY(market,stock_code))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS sz_margin_market_daily (
  trade_date date PRIMARY KEY,estimate_pct numeric,coverage_pct numeric,
  symbol_coverage_pct numeric,stock_count integer,used_count integer,unknown_share_pct numeric,
  model_version text NOT NULL DEFAULT 'v2.7.0.52',updated_at timestamptz NOT NULL DEFAULT now())`);
 ready=true;
}
function marketAggregate(items,date){
 const rows=items.filter(x=>x.marketDate===date&&x.row.margin_balance>0);
 const totalQty=rows.reduce((s,x)=>s+Number(x.row.margin_balance||0),0);
 let value=0,loan=0,usedQty=0,unknown=0,used=0;
 for(const {state,row} of rows){
  if(!state?.valid||!(state.quantity>0)||!(state.lastClose>0)||!(state.cost>0))continue;
  value+=state.quantity*state.lastClose;loan+=state.quantity*state.cost*RATE;
  usedQty+=state.quantity;unknown+=state.unknown;used++;
 }
 const qtyCoverage=totalQty>0?100*usedQty/totalQty:0;
 const symbolCoverage=rows.length?100*used/rows.length:0;
 // A market-wide percentage must represent the same underlying collateral and loans.
 // Unknown seed costs remain explicitly marked, never presented as broker truth.
 return {date,pct:qtyCoverage>=99&&symbolCoverage>=98&&loan>0?round(100*value/loan):null,
   coverage:round(qtyCoverage,3),symbolCoverage:round(symbolCoverage,3),stockCount:rows.length,usedCount:used,
   unknownSharePct:usedQty>0?round(100*unknown/usedQty,2):null};
}
let inFlight=null;
async function refreshMarket(sql=getSql()){
 await ensureSchema(sql);
 const latestRows=await sql.query('SELECT MAX(trade_date)::text AS day FROM credit_trading_daily');
 const date=latestRows[0]?.day;
 if(!date)return null;
 const saved=await sql.query('SELECT trade_date::text AS date,estimate_pct,coverage_pct,symbol_coverage_pct,stock_count,used_count,unknown_share_pct FROM sz_margin_market_daily WHERE trade_date=$1::date',[date]);
 if(saved.length)return present(saved[0]);
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  const stateRows=await sql.query('SELECT market,stock_code,trade_date::text AS trade_date,quantity,cost,unknown,last_close,valid FROM sz_margin_cost_state');
  const known=new Map(stateRows.map(s=>[s.market+'|'+s.stock_code,{valid:s.valid,quantity:num(s.quantity),cost:num(s.cost),unknown:num(s.unknown),lastClose:num(s.last_close),asOfDate:s.trade_date}]));
  const firstBuild=!stateRows.length;
  const rows=await sql.query(`SELECT c.trade_date::text AS trade_date,c.market,c.stock_code,
     c.margin_prev_balance,c.margin_buy,c.margin_sell,c.margin_cash_repay,c.margin_balance,
     h.close_price,h.trade_volume,h.trade_value
   FROM credit_trading_daily c
   JOIN market_company_profile p ON p.stock_code=c.stock_code AND p.market=c.market
   LEFT JOIN market_daily_history h ON h.trade_date=c.trade_date AND h.stock_code=c.stock_code
   WHERE c.trade_date ${firstBuild?'IN (SELECT trade_date FROM (SELECT DISTINCT trade_date FROM credit_trading_daily ORDER BY trade_date DESC LIMIT 130) d)':'>(SELECT COALESCE(MAX(trade_date),(SELECT MIN(trade_date) FROM sz_margin_cost_state)) FROM sz_margin_market_daily)'}
   AND c.trade_date<=$1::date
   ORDER BY c.trade_date,c.market,c.stock_code`,[date]);
  if(!rows.length)return null;
  let prevDay=null,dayItems=[],summaries=[];
  function endDay(){if(prevDay&&dayItems.length)summaries.push(marketAggregate(dayItems,prevDay));dayItems=[];}
  for(const row of rows){
   const dateRow=iso(row.trade_date);
   if(prevDay&&dateRow!==prevDay)endDay();prevDay=dateRow;
   const key=row.market+'|'+row.stock_code,old=known.get(key);
   if(old&&old.asOfDate>=dateRow)continue;
   const next=marginStep(old,row);
   if(next.valid)known.set(key,next);
   else known.set(key,{valid:false,quantity:0,cost:null,unknown:0,lastClose:null,asOfDate:dateRow});
   dayItems.push({marketDate:dateRow,row,state:next});
  }
  endDay();
  if(!summaries.length)return null;
  // One set-based write per table, not one SQL request per company.
  const states=[...known.entries()].map(([key,s])=>{const [market,stock_code]=key.split('|');return {market,stock_code,trade_date:s.asOfDate,quantity:s.quantity||0,cost:s.cost,unknown:s.unknown||0,last_close:s.lastClose,valid:!!s.valid};});
  await sql.query(`INSERT INTO sz_margin_cost_state(market,stock_code,trade_date,quantity,cost,unknown,last_close,valid)
   SELECT market,stock_code,trade_date::date,quantity,cost,unknown,last_close,valid
   FROM jsonb_to_recordset($1::jsonb) AS r(market text,stock_code text,trade_date text,quantity numeric,cost numeric,unknown numeric,last_close numeric,valid boolean)
   ON CONFLICT(market,stock_code) DO UPDATE SET trade_date=EXCLUDED.trade_date,quantity=EXCLUDED.quantity,cost=EXCLUDED.cost,unknown=EXCLUDED.unknown,last_close=EXCLUDED.last_close,valid=EXCLUDED.valid
   WHERE sz_margin_cost_state.trade_date<=EXCLUDED.trade_date`,[JSON.stringify(states)]);
  await sql.query(`INSERT INTO sz_margin_market_daily(trade_date,estimate_pct,coverage_pct,symbol_coverage_pct,stock_count,used_count,unknown_share_pct)
   SELECT date::date,pct,coverage,symbol_coverage,stock_count,used_count,unknown_share FROM jsonb_to_recordset($1::jsonb) AS r(date text,pct numeric,coverage numeric,symbol_coverage numeric,stock_count int,used_count int,unknown_share numeric)
   ON CONFLICT(trade_date) DO UPDATE SET estimate_pct=EXCLUDED.estimate_pct,coverage_pct=EXCLUDED.coverage_pct,symbol_coverage_pct=EXCLUDED.symbol_coverage_pct,
   stock_count=EXCLUDED.stock_count,used_count=EXCLUDED.used_count,unknown_share_pct=EXCLUDED.unknown_share_pct,updated_at=now()`,
   [JSON.stringify(summaries.map(s=>({date:s.date,pct:s.pct,coverage:s.coverage,symbol_coverage:s.symbolCoverage,stock_count:s.stockCount,used_count:s.usedCount,unknown_share:s.unknownSharePct}))) ]);
  return summaries.at(-1);
 })();
 try{return await inFlight}finally{inFlight=null}
}
function present(r){return {date:r.date,pct:num(r.estimate_pct),coverage:num(r.coverage_pct),symbolCoverage:num(r.symbol_coverage_pct),stockCount:Number(r.stock_count),usedCount:Number(r.used_count),unknownSharePct:num(r.unknown_share_pct)};}
async function marketEstimate(sql=getSql()){
 try{return await refreshMarket(sql)}catch(e){console.warn('[stockzone margin estimate]',String(e?.message||e));
  try{const rows=await sql.query('SELECT trade_date::text AS date,estimate_pct,coverage_pct,symbol_coverage_pct,stock_count,used_count,unknown_share_pct FROM sz_margin_market_daily ORDER BY trade_date DESC LIMIT 1');return rows.length?{...present(rows[0]),stale:true}:null}catch{return null}}
}
module.exports={marginStep,estimate,stockEstimate,marketAggregate,marketEstimate};
