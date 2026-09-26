const fs=require('fs');
const assert=require('assert');
const app=fs.readFileSync('app.js','utf8');
const api=fs.readFileSync('api/quote.js','utf8');

assert(app.includes('options?.live?"&mode=live":""'),'client intraday quote must request mode=live');
assert(app.includes('const intraday=isTaiwanIntraday();'),'quote must preserve Taiwan intraday gate');
assert(api.includes('https://mis.twse.com.tw/stock/api/getStockInfo.jsp'),'quote API must use official MIS endpoint');
assert(api.includes('function liveStockHint(query,marketHint="")'),'live quote code fast path missing');
assert(api.includes('mode==="live"?(liveStockHint(query,marketHint)||await resolveStock(query,marketHint))'),'numeric live polling must bypass repeated Neon identity resolution');
assert(api.includes('if(mode==="live")result=await fetchMisQuote(stock);'),'live mode must prefer MIS');
assert(api.includes('if(!result){'),'live mode must retain fallback when MIS has no trade/temporarily fails');
assert(api.includes('source:"TWSE/TPEx MIS 即時"'),'MIS result source marker missing');
assert(api.includes('const last=misNumber(row?.z);'),'MIS must use latest matched price z');
assert(api.includes('const previousClose=misNumber(row?.y)'),'MIS must use official previous close y');
assert(app.includes('if(!isTaiwanIntraday()){\n    const fast=await dbCloseQuote(query,market);'),'after-close DB-first path must remain intact');
console.log('PASS validate-intraday-quote');
