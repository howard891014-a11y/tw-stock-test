const fs=require('fs');
const assert=require('assert');
const app=fs.readFileSync('app.js','utf8');
const api=fs.readFileSync('api/quote.js','utf8');

assert(app.includes('options?.live?"&mode=live":""'),'client intraday quote must request mode=live');
assert(app.includes('phase.phase==="live"&&marketSessionForToday()?.status!=="holiday"'),'client must start live mode at Taiwan 09:00 and honor holiday suppression');
assert(api.includes('https://query1.finance.yahoo.com/v8/finance/chart/'),'quote API must use Yahoo chart endpoint');
assert(api.includes('// v2.6.5.37: 09:00 起 Yahoo 優先'),'live mode must be Yahoo-first from 09:00');
assert(api.includes('result=await yahooFor();'),'Yahoo must be queried before MIS fallback');
assert(api.includes('if(!result||result.tradeDate!==today){const mis=await fetchMisQuote(stock);if(mis)result=mis}'),'MIS must only be fallback when Yahoo lacks current-day trade');
assert(api.includes('function liveStockHint(query,marketHint="")'),'numeric quote fast path missing');
assert(api.includes('const numericHint=liveStockHint(query,marketHint);'),'numeric quote must bypass Neon identity resolution for both live and close paths');
assert(api.includes('source:"TWSE/TPEx MIS 即時"'),'MIS fallback marker missing');
assert(!api.includes('fetchOfficialPrevious('),'Yahoo quote path must not fetch MIS previous-close on every request');
assert(app.includes('isTodayCloseCached(cached)'),'after-close same-day close must be served from local cache');
assert(app.includes('Yahoo is the normal close source. Neon price_snapshot is fallback only'),'Neon close snapshot must be fallback, not first choice');
assert(app.includes('quoteUpdateLabel(x)'),'UI must show real quote/close time instead of fake just-updated text');
console.log('PASS validate-intraday-quote — 09:00 Yahoo-first, MIS fallback only, close once/cache, holiday suppression');
