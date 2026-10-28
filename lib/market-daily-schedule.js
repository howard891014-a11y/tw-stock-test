'use strict';
// StockZone 2.6.9.17: one timeline for the whole market, with no holiday data rewrites.
// Only status/attempt metadata in existing sync_status. No new tables, no historical backfill.
const {taipeiDateParts}=require('./sync-common');
const {readMarketDateGate}=require('./market-dynamic-date-gate');
const PRICE_SLOTS=Object.freeze({
  '0 7 * * 1-5':'15','0 8 * * 1-5':'16','0 9 * * 1-5':'17'
});
const SLOT_SOURCE=slot=>`market_schedule_price_${slot}`;
const parse=(row)=>{try{return JSON.parse(row?.error_message||'{}')}catch{return {}}};
async function savePriceAttempt(sql,slot,date,state,detail={}){
  if(!['15','16','17'].includes(slot))throw new Error('unknown price slot');
  if(!['ready','no-update','partial','error','closed'].includes(state))throw new Error('unknown price state');
  const note=JSON.stringify({date,state,...detail}).slice(0,760);
  await sql.query(`INSERT INTO sync_status(source,last_attempt_at,status,row_count,error_message,updated_at)
     VALUES($1,NOW(),$2,0,$3,NOW()) ON CONFLICT(source) DO UPDATE SET
     last_attempt_at=NOW(),status=EXCLUDED.status,error_message=EXCLUDED.error_message,updated_at=NOW()`,
     [SLOT_SOURCE(slot),state==='ready'?'success':state==='error'?'error':'pending',note]);
}
async function priceAttempts(sql,date){
  const rows=await sql.query(`SELECT source,error_message FROM sync_status
   WHERE source IN ($1,$2,$3)`,['market_schedule_price_15','market_schedule_price_16','market_schedule_price_17']);
  const m=new Map(rows.map(x=>[String(x.source),parse(x)]));
  return Object.fromEntries(['15','16','17'].map(slot=>{const r=m.get(SLOT_SOURCE(slot));return [slot,r?.date===date?r:null]}));
}
function deriveDayState(attempts,gate,date){
  if(gate.ok&&gate.sourceDate===date)return 'ready';
  const vals=['15','16','17'].map(s=>attempts?.[s]?.state);
  // All THREE probes must have actually completed without an upstream error,
  // and neither exchange can show today's trades. A partial market is NOT a holiday.
  if(vals.every(s=>s==='no-update')&&
     Object.values(gate.latestByMarket||{}).every(d=>!d||d<date))return 'closed';
  return 'pending';
}
async function marketScheduleGate(sql,date=taipeiDateParts().date){
  const [gate,attempts]=await Promise.all([readMarketDateGate(sql),priceAttempts(sql,date)]);
  return {date,gate,attempts,state:deriveDayState(attempts,gate,date)};
}
function scheduleDescription(){return [
 {time:'15:00',title:'價格類第一次更新',detail:'上市／上櫃行情、成交額、漲跌分布、廣度、近期軌跡；僅兩市資料齊全才發布'},
 {time:'16:00',title:'價格類第二次檢查',detail:'15:00未齊全才補查，已完成直接跳過'},
 {time:'17:00',title:'價格類最後檢查',detail:'連續三次兩市都無當日報價才推定休市；單邊延遲或連線失敗不當成休市'},
 {time:'21:00 起',title:'籌碼類同步',detail:'21:00法人、21:15信用；21:30及21:45更新上市／上櫃處置資訊'},
 {time:'22:00',title:'W3-D.1.2 正式計算',detail:'檢查同日完整價格及必要輸入；不足時不發布新結果'},
 {time:'23:35',title:'缺資料補算',detail:'只有當日W3未完成才補齊必要籌碼資料及計算；已完成或推定休市則跳過'}
]}
module.exports={PRICE_SLOTS,savePriceAttempt,priceAttempts,deriveDayState,marketScheduleGate,scheduleDescription};
