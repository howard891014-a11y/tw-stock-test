'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const sync=fs.readFileSync(path.join(root,'lib','sync-common.js'),'utf8');
function need(re,msg){ assert(re.test(sync),msg); }
need(/market_daily_history\.stock_name[\s\S]*IS DISTINCT FROM ROW\([\s\S]*EXCLUDED\.stock_name/,
  'market_daily_history upserts must skip identical conflicts');
need(/EXCLUDED\.trade_date > price_snapshot\.trade_date[\s\S]*EXCLUDED\.trade_date = price_snapshot\.trade_date[\s\S]*IS DISTINCT FROM ROW/,
  'price_snapshot must update same-date rows only when payload changed');
need(/market_activity_daily\.stock_name[\s\S]*market_activity_daily\.activity_ready[\s\S]*IS DISTINCT FROM ROW/,
  'market_activity_daily refresh must skip identical retained rows');
need(/report_date alone changes[\s\S]*market_company_profile\.stock_name[\s\S]*IS DISTINCT FROM ROW/,
  'company profile sync must ignore report_date-only churn');
const historyGuards=(sync.match(/market_daily_history\.stock_name/g)||[]).length;
assert(historyGuards>=2,'both direct history and price+history paths need no-op guards');
console.log('write amplification validation: PASS');
