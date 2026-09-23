const { getSql } = require('../lib/db');
const { isCronAuthorized } = require('../lib/sync-common');
const { runPriceSync, runTwseDisposalSync, runTpexDisposalSync, runMarketHistoryBackfill } = require('../lib/sync-service');


// v2.5.7.0 — 原 api/official-close.js 合併到這支 API，避免多占一個 Vercel Function。
const MIS_HEADERS = {
  'User-Agent':'Mozilla/5.0',
  'Accept':'application/json,text/plain,*/*',
  'Referer':'https://mis.twse.com.tw/stock/index.jsp'
};
function misNumber(v){
  if(v===null||v===undefined)return null;
  const s=String(v).replace(/,/g,'').trim();
  if(!s||s==='-'||s==='--')return null;
  const n=Number(s);return Number.isFinite(n)?n:null;
}
function misTradeDate(v){
  const s=String(v||'').replace(/\D/g,'');
  return s.length>=8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:'';
}
function misQuoteTime(row){
  const t=misNumber(row?.tlong);
  if(t!==null&&t>1e12)return new Date(t).toISOString();
  const d=String(row?.d||'').replace(/\D/g,''),tm=String(row?.t||'').trim();
  if(d.length>=8&&/^\d{1,2}:\d{2}:\d{2}$/.test(tm)){
    const [hh,mm,ss]=tm.split(':').map(Number);
    return new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(4,6))-1,Number(d.slice(6,8)),hh-8,mm,ss)).toISOString();
  }
  return new Date().toISOString();
}
async function fetchMisChannel(code,channel){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
  try{
    const exCh=`${channel}_${code}.tw`;
    const url=`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    const r=await fetch(url,{headers:MIS_HEADERS,signal:controller.signal});
    if(!r.ok)throw new Error(`MIS HTTP ${r.status}`);
    const j=await r.json();
    const row=(Array.isArray(j?.msgArray)?j.msgArray:[]).find(x=>String(x?.c||'').trim()===code)||j?.msgArray?.[0];
    const last=misNumber(row?.z);if(!row||last===null)return null;
    const previousClose=misNumber(row?.y),change=previousClose!==null?last-previousClose:null;
    return{
      source:'官方 MIS',code,name:String(row?.nf||row?.n||'').trim(),
      market:channel==='otc'?'上櫃':'上市',symbol:`${code}.${channel==='otc'?'TWO':'TW'}`,
      last,previousClose,change,changePct:previousClose&&change!==null?(change/previousClose)*100:null,
      open:misNumber(row?.o),high:misNumber(row?.h),low:misNumber(row?.l),
      quoteTime:misQuoteTime(row),tradeDate:misTradeDate(row?.d),officialClose:true
    };
  }finally{clearTimeout(timer)}
}
async function officialCloseResponse(req,res){
  const raw=String(req.query.q||req.query.code||'').trim().toUpperCase(),code=raw.replace(/\.(?:TW|TWO)$/i,'');
  if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:'股票代碼格式錯誤'});
  const market=String(req.query.market||'');
  const channels=/上櫃|OTC/i.test(market)?['otc']:/上市|TSE/i.test(market)?['tse']:['tse','otc'];
  let lastError=null;
  for(const channel of channels){
    try{const result=await fetchMisChannel(code,channel);if(result)return res.status(200).json({ok:true,result,fetchedAt:new Date().toISOString()})}
    catch(e){lastError=e}
  }
  return res.status(404).json({ok:false,error:'MIS 暫無可用收盤價',detail:lastError?.message||'no valid last price'});
}

const CRON_ACTIONS = {
  '0 7 * * 1-5': 'price',
  '0 11 * * 1-5': 'twse',
  '0 14 * * 1-5': 'tpex'
};

function requestedAction(req) {
  const schedule = String(req.headers?.['x-vercel-cron-schedule'] || '').trim();
  if (schedule) return CRON_ACTIONS[schedule] || '';
  return String(req.query.action || '').trim().toLowerCase();
}

async function statusResponse(req, res) {
  const sql=getSql();
  const code=String(req.query.code||'').trim();

  if(code){
    if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:'股票代碼格式錯誤'});

    const [priceRows,disposalRows,historyRows,activityRows]=await Promise.all([
      sql.query(`
        SELECT stock_code,stock_name,market,trade_date,close_price,previous_close,
               open_price,high_price,low_price,quote_time,source,updated_at
        FROM price_snapshot
        WHERE stock_code=$1
        LIMIT 1
      `,[code]),
      sql.query(`
        SELECT market,stock_code,stock_name,announcement_date,start_date,end_date,
               reason,updated_at
        FROM disposal_snapshot
        WHERE stock_code=$1
        ORDER BY end_date DESC,start_date DESC
      `,[code]),
      sql.query(`
        SELECT trade_date,stock_code,stock_name,market,open_price,high_price,low_price,close_price,
               previous_close,change_amount,change_pct,trade_volume,trade_value,transaction_count,source,updated_at
        FROM market_daily_history
        WHERE stock_code=$1
        ORDER BY trade_date DESC
        LIMIT 25
      `,[code]).catch(()=>[]),
      sql.query(`
        SELECT trade_date,stock_code,stock_name,market,trade_value,change_pct,avg_value_prev20,value_ratio_20,
               recent_value_avg_5,prior_value_avg_15,value_trend_5_15,up_value_share_5,positive_days_5,
               return_5_pct,return_20_pct,baseline_days_20,recent_days_5,activity_ready,updated_at
        FROM market_activity_daily
        WHERE stock_code=$1
        ORDER BY trade_date DESC
        LIMIT 25
      `,[code]).catch(()=>[])
    ]);

    const price=priceRows[0]||null;
    const syncSources=['price_daily'];
    if(price?.market==='上市')syncSources.push('twse_disposal');
    else if(price?.market==='上櫃')syncSources.push('tpex_disposal');
    else syncSources.push('twse_disposal','tpex_disposal');

    const sync=await sql.query(`
      SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at
      FROM sync_status
      WHERE source = ANY($1::text[])
      ORDER BY source
    `,[syncSources]);

    return res.status(200).json({ok:true,code,found:Boolean(price||disposalRows.length||historyRows.length||activityRows.length),price,history:historyRows,activity:activityRows,disposal:disposalRows,sync});
  }

  const [status,price,disposal,marketHistory,marketActivity]=await Promise.all([
    sql.query(`SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at FROM sync_status ORDER BY source`),
    sql.query(`SELECT market,COUNT(*)::int AS rows,MAX(trade_date) AS latest_trade_date,MAX(updated_at) AS last_write FROM price_snapshot GROUP BY market ORDER BY market`),
    sql.query(`SELECT market,COUNT(*)::int AS rows,MIN(start_date) AS min_start,MAX(end_date) AS max_end,MAX(updated_at) AS last_write FROM disposal_snapshot GROUP BY market ORDER BY market`),
    sql.query(`
      SELECT market,COUNT(*)::int AS rows,COUNT(DISTINCT trade_date)::int AS trading_days,
             MIN(trade_date) AS first_trade_date,MAX(trade_date) AS latest_trade_date,
             COUNT(*) FILTER (WHERE trade_value IS NOT NULL)::int AS value_rows,
             COUNT(*) FILTER (WHERE trade_volume IS NOT NULL)::int AS volume_rows,
             MAX(updated_at) AS last_write
      FROM market_daily_history
      GROUP BY market
      ORDER BY market
    `).catch(()=>[]),
    sql.query(`
      SELECT market,COUNT(*)::int AS rows,COUNT(DISTINCT trade_date)::int AS trading_days,
             MAX(trade_date) AS latest_trade_date,
             COUNT(*) FILTER (WHERE activity_ready)::int AS ready_rows,
             MAX(updated_at) AS last_write
      FROM market_activity_daily
      GROUP BY market
      ORDER BY market
    `).catch(()=>[])
  ]);
  return res.status(200).json({ok:true,status,price,marketHistory,marketActivity,disposal});
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const mode=String(req.query.mode||'').trim().toLowerCase();
    if(mode==='official-close'){
      res.setHeader('Access-Control-Allow-Origin','*');
      return await officialCloseResponse(req,res);
    }
    const schedule=String(req.headers?.['x-vercel-cron-schedule']||'').trim();
    const action=requestedAction(req);

    if(schedule && !action)return res.status(400).json({ok:false,error:`未知 Cron schedule：${schedule}`});
    if(action){
      if(!isCronAuthorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});
      let result;
      if(action==='price')result=await runPriceSync({cronSchedule:schedule});
      else if(action==='twse')result=await runTwseDisposalSync();
      else if(action==='tpex')result=await runTpexDisposalSync();
      else if(action==='market-backfill'){
        const backfill=await runMarketHistoryBackfill({targetTradingDays:21,maxNewDays:7,delayMs:1000});
        return res.status(200).json({ok:true,source:'market_history_backfill',...backfill});
      }
      else return res.status(400).json({ok:false,error:'action 僅支援 price / twse / tpex / market-backfill'});

      if(schedule && ['price','twse','tpex'].includes(action)){
        try{result.body.marketBootstrap=await runMarketHistoryBackfill({targetTradingDays:21,maxNewDays:7,delayMs:1000})}
        catch(e){result.body.marketBootstrap={ok:false,error:String(e?.message||e)}}
      }
      return res.status(result.httpStatus).json(result.body);
    }

    return await statusResponse(req,res);
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
};

module.exports._test={requestedAction,CRON_ACTIONS,misNumber,misTradeDate};
