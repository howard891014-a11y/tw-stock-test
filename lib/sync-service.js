const {
  clean, numberOrNull, rocToIso, parsePeriod, fetchJson, normalizeTableJson, rowObject, first,
  taipeiDateParts, markAttempt, markSuccess, markError, ensureMarketHistorySchema, ensureCompanyProfileSchema,
  upsertPriceAndHistoryRows, upsertMarketHistoryRows, refreshMarketActivityFactors, upsertCompanyProfileRows, replaceDisposalMarket
} = require('./sync-common');
const { getSql } = require('./db');
const { resolveIndustry, normalizeIndustryCode, allIndustryCodes } = require('./industry-classification');

const PRICE_SOURCE = 'price_daily';
const MARKET_BACKFILL_SOURCE = 'market_history_backfill';
const TWSE_DISPOSAL_SOURCE = 'twse_disposal';
const TPEX_DISPOSAL_SOURCE = 'tpex_disposal';
const COMPANY_PROFILE_SOURCE = 'company_profile_daily';
const COMPANY_PROFILE_MIN_INDUSTRY_COVERAGE_PCT = 90;

const TWSE_OPENAPI_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TWSE_COMPANY_PROFILE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const TPEX_COMPANY_PROFILE_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
const TPEX_PRICE_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const TPEX_HISTORY_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes';
const TPEX_HISTORY_LEGACY_URL = 'https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php';
const TWSE_DISPOSAL_URL = 'https://www.twse.com.tw/rwd/zh/announcement/punish?response=json';
const TPEX_DISPOSAL_PRIMARY = 'https://www.tpex.org.tw/openapi/v1/tpex_disposal_information';
const TPEX_DISPOSAL_BACKUP = 'https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information_result.php?l=zh-tw&o=json';

function validCode(v) { return /^\d{4,6}$/.test(clean(v)); }

function pctChange(close, previousClose) {
  if (!Number.isFinite(close) || !Number.isFinite(previousClose) || previousClose <= 0) return null;
  return ((close - previousClose) / previousClose) * 100;
}

function withMarketStats(row, { tradeVolume = null, tradeValue = null, transactionCount = null, changeAmount = null } = {}) {
  const previousClose = row.previous_close;
  return {
    ...row,
    trade_volume: tradeVolume,
    trade_value: tradeValue,
    transaction_count: transactionCount,
    change_amount: changeAmount,
    change_pct: pctChange(row.close_price, previousClose)
  };
}

function twseOpenApiRows(data) {
  if (!Array.isArray(data)) throw new Error('TWSE OpenAPI 股價格式不是陣列');
  return data.map(x => {
    const close = numberOrNull(x?.ClosingPrice);
    const date = rocToIso(x?.Date);
    const code = clean(x?.Code);
    if (!validCode(code) || !date || close === null || close <= 0) return null;
    const change = numberOrNull(x?.Change);
    return withMarketStats({
      stock_code: code, stock_name: clean(x?.Name), market: '上市', trade_date: date,
      close_price: close, previous_close: change === null ? null : close - change,
      open_price: numberOrNull(x?.OpeningPrice), high_price: numberOrNull(x?.HighestPrice),
      low_price: numberOrNull(x?.LowestPrice), quote_time: null, source: 'TWSE STOCK_DAY_ALL fallback'
    }, {
      tradeVolume: numberOrNull(x?.TradeVolume),
      tradeValue: numberOrNull(x?.TradeValue),
      transactionCount: numberOrNull(x?.Transaction),
      changeAmount: change
    });
  }).filter(Boolean);
}

function dateFromTwseRwd(json, table) {
  const direct = rocToIso(json?.date || json?.Date || '');
  if (direct) return direct;
  const title = clean(table?.title || '');
  const m = title.match(/(\d{3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return '';
  return `${Number(m[1]) + 1911}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function twseRwdRows(json) {
  if (!json || typeof json !== 'object') throw new Error('TWSE MI_INDEX 格式不是物件');
  if (json.stat && json.stat !== 'OK') throw new Error(`TWSE MI_INDEX：${clean(json.stat)}`);
  const tables = Array.isArray(json.tables) ? json.tables : [];
  const table = tables.find(t => {
    const f = Array.isArray(t?.fields) ? t.fields.map(clean) : [];
    return f.includes('證券代號') && f.includes('證券名稱') && f.includes('收盤價');
  });
  if (!table || !Array.isArray(table.data)) throw new Error('TWSE MI_INDEX 找不到個股收盤表');
  const fields = table.fields.map(clean);
  const idx = Object.fromEntries(fields.map((f, i) => [f, i]));
  const tradeDate = dateFromTwseRwd(json, table);
  if (!tradeDate) throw new Error('TWSE MI_INDEX 無法判斷交易日');

  return table.data.map(row => {
    const code = clean(row?.[idx['證券代號']]);
    const close = numberOrNull(row?.[idx['收盤價']]);
    if (!validCode(code) || close === null || close <= 0) return null;
    const diffAbs = numberOrNull(row?.[idx['漲跌價差']]);
    const signText = clean(row?.[idx['漲跌(+/-)']]);
    let signedChange = null;
    if (diffAbs !== null) {
      if (signText.includes('-')) signedChange = -Math.abs(diffAbs);
      else if (signText.includes('+')) signedChange = Math.abs(diffAbs);
      else if (diffAbs === 0) signedChange = 0;
    }
    return withMarketStats({
      stock_code: code,
      stock_name: clean(row?.[idx['證券名稱']]),
      market: '上市',
      trade_date: tradeDate,
      close_price: close,
      previous_close: signedChange === null ? null : close - signedChange,
      open_price: numberOrNull(row?.[idx['開盤價']]),
      high_price: numberOrNull(row?.[idx['最高價']]),
      low_price: numberOrNull(row?.[idx['最低價']]),
      quote_time: null,
      source: 'TWSE MI_INDEX'
    }, {
      tradeVolume: numberOrNull(row?.[idx['成交股數']]),
      tradeValue: numberOrNull(row?.[idx['成交金額']]),
      transactionCount: numberOrNull(row?.[idx['成交筆數']]),
      changeAmount: signedChange
    });
  }).filter(Boolean);
}

function tpexPriceRows(data) {
  if (!Array.isArray(data)) throw new Error('TPEx 股價格式不是陣列');
  return data.map(x => {
    const code = clean(first(x, ['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號']));
    const close = numberOrNull(first(x, ['Close','ClosingPrice','收盤價']));
    const date = rocToIso(first(x, ['Date','TradeDate','資料日期']));
    if (!validCode(code) || !date || close === null || close <= 0) return null;
    const change = numberOrNull(first(x, ['Change','ChangeAmount','PriceChange','漲跌']));
    return withMarketStats({
      stock_code: code,
      stock_name: clean(first(x, ['CompanyName','SecuritiesCompanyName','SecuritiesName','Name','證券名稱'])),
      market: '上櫃', trade_date: date, close_price: close, previous_close: change === null ? null : close - change,
      open_price: numberOrNull(first(x, ['Open','OpeningPrice','開盤價'])),
      high_price: numberOrNull(first(x, ['High','HighestPrice','最高價'])),
      low_price: numberOrNull(first(x, ['Low','LowestPrice','最低價'])),
      quote_time: null, source: 'TPEx mainboard daily close'
    }, {
      tradeVolume: numberOrNull(first(x, ['TradingShares','TradeVolume','TradingVolume','成交股數','成交量'])),
      tradeValue: numberOrNull(first(x, ['TransactionAmount','TradeValue','TradingValue','成交金額','成交值'])),
      transactionCount: numberOrNull(first(x, ['TransactionNumber','Transaction','成交筆數'])),
      changeAmount: change
    });
  }).filter(Boolean);
}

function isoAddDays(iso, delta) {
  const [y,m,d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  dt.setUTCDate(dt.getUTCDate()+delta);
  return dt.toISOString().slice(0,10);
}

function isWeekendIso(iso) {
  const [y,m,d] = String(iso).split('-').map(Number);
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  return day === 0 || day === 6;
}

function isoToRocSlash(iso) {
  const [y,m,d] = String(iso).split('-');
  return `${Number(y)-1911}/${m}/${d}`;
}

function tpexHistoricalRows(json, tradeDate) {
  if (!json || typeof json !== 'object') throw new Error('TPEx 歷史行情格式不是物件');
  const legacy = Array.isArray(json.aaData) ? json.aaData : null;
  if (legacy) {
    if (!legacy.length) return [];
    return legacy.map(row => {
      const code=clean(row?.[0]), close=numberOrNull(row?.[2]);
      if(!validCode(code)||close===null||close<=0)return null;
      const change=numberOrNull(row?.[3]);
      return withMarketStats({
        stock_code:code,stock_name:clean(row?.[1]),market:'上櫃',trade_date:tradeDate,
        close_price:close,previous_close:change===null?null:close-change,
        open_price:numberOrNull(row?.[4]),high_price:numberOrNull(row?.[5]),low_price:numberOrNull(row?.[6]),
        quote_time:null,source:'TPEx dailyQuotes history'
      },{
        tradeVolume:numberOrNull(row?.[8]),tradeValue:numberOrNull(row?.[9]),
        transactionCount:numberOrNull(row?.[10]),changeAmount:change
      });
    }).filter(Boolean);
  }

  const table=normalizeTableJson(json);
  if(!table.data.length)return[];
  const fields=(table.fields||[]).map(clean);
  return table.data.map(raw=>{
    const x=rowObject(fields,raw);
    const code=clean(first(x,['代號','證券代號','SecuritiesCompanyCode','SecuritiesCode','Code']));
    const close=numberOrNull(first(x,['收盤','收盤價','Close','ClosingPrice']));
    if(!validCode(code)||close===null||close<=0)return null;
    const change=numberOrNull(first(x,['漲跌','漲跌價差','Change','ChangeAmount','PriceChange']));
    return withMarketStats({
      stock_code:code,stock_name:clean(first(x,['名稱','證券名稱','CompanyName','SecuritiesName','Name'])),
      market:'上櫃',trade_date:tradeDate,close_price:close,previous_close:change===null?null:close-change,
      open_price:numberOrNull(first(x,['開盤','開盤價','Open','OpeningPrice'])),
      high_price:numberOrNull(first(x,['最高','最高價','High','HighestPrice'])),
      low_price:numberOrNull(first(x,['最低','最低價','Low','LowestPrice'])),
      quote_time:null,source:'TPEx dailyQuotes history'
    },{
      tradeVolume:numberOrNull(first(x,['成交股數','成交量','TradingShares','TradeVolume','TradingVolume'])),
      tradeValue:numberOrNull(first(x,['成交金額','成交值','TransactionAmount','TradeValue','TradingValue'])),
      transactionCount:numberOrNull(first(x,['成交筆數','TransactionNumber','Transaction'])),
      changeAmount:change
    });
  }).filter(Boolean);
}

async function fetchTwseHistoricalRows(tradeDate) {
  const ymd=tradeDate.replace(/-/g,'');
  const url=`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  const raw=await fetchJson(url,{retries:1,timeoutMs:8000});
  const stat=clean(raw?.stat||'');
  if(stat && stat!=='OK')return{rows:[],nonTrading:true,upstream:'TWSE MI_INDEX'};
  const rows=twseRwdRows(raw);
  if(!rows.length)return{rows:[],nonTrading:true,upstream:'TWSE MI_INDEX'};
  if(!rows.every(x=>x.trade_date===tradeDate))throw new Error(`TWSE 歷史交易日錯位：要求 ${tradeDate}，實得 ${[...new Set(rows.map(x=>x.trade_date))].join(',')}`);
  if(rows.length<300)throw new Error(`TWSE ${tradeDate} 歷史行情有效筆數異常：${rows.length}`);
  return{rows,nonTrading:false,upstream:'TWSE MI_INDEX'};
}

async function fetchTpexHistoricalRows(tradeDate) {
  const dateSlash=tradeDate.replace(/-/g,'/');
  let primaryError=null;
  try{
    const url=`${TPEX_HISTORY_URL}?response=json&date=${encodeURIComponent(dateSlash)}`;
    const raw=await fetchJson(url,{retries:1,timeoutMs:8000});
    const rows=tpexHistoricalRows(raw,tradeDate);
    if(rows.length){
      if(rows.length<200)throw new Error(`TPEx ${tradeDate} 歷史行情有效筆數異常：${rows.length}`);
      return{rows,nonTrading:false,upstream:'TPEx dailyQuotes'};
    }
    if(raw?.stat && clean(raw.stat)!=='OK')return{rows:[],nonTrading:true,upstream:'TPEx dailyQuotes'};
    const total=Number(raw?.iTotalRecords??raw?.total??0);
    if(total===0)return{rows:[],nonTrading:true,upstream:'TPEx dailyQuotes'};
    primaryError=new Error('TPEx dailyQuotes 回傳無可解析資料');
  }catch(e){primaryError=e}
  try{
    const roc=isoToRocSlash(tradeDate);
    const url=`${TPEX_HISTORY_LEGACY_URL}?l=zh-tw&o=json&d=${encodeURIComponent(roc)}&s=0,asc,0`;
    const raw=await fetchJson(url,{retries:0,timeoutMs:8000});
    const rows=tpexHistoricalRows(raw,tradeDate);
    if(rows.length){
      if(rows.length<200)throw new Error(`TPEx legacy ${tradeDate} 歷史行情有效筆數異常：${rows.length}`);
      return{rows,nonTrading:false,upstream:'TPEx legacy daily close'};
    }
    const total=Number(raw?.iTotalRecords??0);
    if(total===0)return{rows:[],nonTrading:true,upstream:'TPEx legacy daily close'};
    throw new Error('TPEx legacy 回傳無可解析資料');
  }catch(e){
    throw new Error(`TPEx ${tradeDate} 歷史來源失敗：primary=${String(primaryError?.message||primaryError)}；legacy=${String(e?.message||e)}`);
  }
}

async function runMarketHistoryBackfill({targetTradingDays=21,maxNewDays=7,delayMs=1000}={}) {
  const sql=getSql();
  try{
    // v2.6.2.17: schema bootstrap must be independent from price_daily success.
    await ensureMarketHistorySchema();
    await markAttempt(MARKET_BACKFILL_SOURCE);

    // First refresh each market's latest official snapshot independently. This also lets the
    // 19:00 / 22:00 Cron catch a market that was still one day behind at 15:00.
    const bootstrap={};
    const currentResults=await Promise.allSettled([
      fetchTwsePriceRows(),
      fetchJson(TPEX_PRICE_URL,{retries:1,timeoutMs:15000}).then(raw=>({rows:tpexPriceRows(raw),upstream:'TPEx mainboard daily close'}))
    ]);
    const currentMarkets=[
      {market:'上市',result:currentResults[0]},
      {market:'上櫃',result:currentResults[1]}
    ];
    for(const item of currentMarkets){
      if(item.result.status!=='fulfilled'){
        bootstrap[item.market]={ok:false,error:String(item.result.reason?.message||item.result.reason||'current snapshot failed')};
        continue;
      }
      const rows=item.result.value?.rows||[];
      try{
        if(item.market==='上市' && rows.length<300)throw new Error(`TWSE 最新行情有效筆數異常：${rows.length}`);
        if(item.market==='上櫃' && rows.length<200)throw new Error(`TPEx 最新行情有效筆數異常：${rows.length}`);
        assertMarketHistoryCoverage(rows,item.market);
        await upsertPriceAndHistoryRows(rows);
        bootstrap[item.market]={ok:true,rows:rows.length,tradeDate:[...new Set(rows.map(x=>x.trade_date))][0]||null,upstream:item.result.value?.upstream||null};
      }catch(e){
        bootstrap[item.market]={ok:false,error:String(e?.message||e)};
      }
    }

    const existing=await sql.query(`
      SELECT market,trade_date::text AS trade_date
      FROM market_daily_history
      WHERE trade_date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY trade_date DESC
    `);
    const dateSets={'上市':new Set(),'上櫃':new Set()};
    for(const row of existing){
      const market=String(row.market||'');
      const date=String(row.trade_date||'').slice(0,10);
      if(dateSets[market]&&date)dateSets[market].add(date);
    }
    const latest={
      '上市':[...dateSets['上市']].sort().at(-1)||'',
      '上櫃':[...dateSets['上櫃']].sort().at(-1)||''
    };
    if(!latest['上市']&&!latest['上櫃'])throw new Error('market_daily_history 無法取得任何市場最新快照');

    const counts=()=>({
      '上市':Math.min(targetTradingDays,dateSets['上市'].size),
      '上櫃':Math.min(targetTradingDays,dateSets['上櫃'].size)
    });
    const done=()=>dateSets['上市'].size>=targetTradingDays&&dateSets['上櫃'].size>=targetTradingDays;

    // Start from the newer market's latest date so a one-day lag does not create a permanent hole.
    const latestCandidates=[latest['上市'],latest['上櫃']].filter(Boolean).sort();
    let cursor=isoAddDays(latestCandidates.at(-1),-1), newDays=0, scanned=0;
    const added=[];
    while(!done() && newDays<maxNewDays && scanned<60){
      scanned++;
      if(isWeekendIso(cursor)){cursor=isoAddDays(cursor,-1);continue}
      const needsTwse=dateSets['上市'].size<targetTradingDays&&!dateSets['上市'].has(cursor);
      const needsTpex=dateSets['上櫃'].size<targetTradingDays&&!dateSets['上櫃'].has(cursor);
      if(!needsTwse&&!needsTpex){cursor=isoAddDays(cursor,-1);continue}

      const tasks=[];
      if(needsTwse)tasks.push(['上市',fetchTwseHistoricalRows(cursor)]);
      if(needsTpex)tasks.push(['上櫃',fetchTpexHistoricalRows(cursor)]);
      const results=await Promise.allSettled(tasks.map(x=>x[1]));
      const dayAdded={date:cursor};
      let anyAdded=false;
      for(let i=0;i<tasks.length;i++){
        const market=tasks[i][0],result=results[i];
        if(result.status!=='fulfilled'){
          dayAdded[market]={ok:false,error:String(result.reason?.message||result.reason)};
          continue;
        }
        const data=result.value;
        if(data.nonTrading){dayAdded[market]={ok:true,nonTrading:true};continue}
        try{
          assertMarketHistoryCoverage(data.rows,`${market} ${cursor}`);
          await upsertMarketHistoryRows(data.rows);
          dateSets[market].add(cursor);
          anyAdded=true;
          dayAdded[market]={ok:true,rows:data.rows.length,upstream:data.upstream};
        }catch(e){
          dayAdded[market]={ok:false,error:String(e?.message||e)};
        }
      }
      if(anyAdded){newDays++;added.push(dayAdded)}
      cursor=isoAddDays(cursor,-1);
      if(delayMs>0&&!done()&&newDays<maxNewDays)await new Promise(r=>setTimeout(r,delayMs));
    }

    await refreshMarketActivityFactors();
    const completeDaysByMarket=counts();
    const successCount=Math.min(completeDaysByMarket['上市'],completeDaysByMarket['上櫃']);
    await markSuccess(MARKET_BACKFILL_SOURCE,successCount);
    return{
      ok:true,done:done(),targetTradingDays,completeDaysByMarket,newDays,added,bootstrap,
      latestByMarket:{
        '上市':[...dateSets['上市']].sort().at(-1)||null,
        '上櫃':[...dateSets['上櫃']].sort().at(-1)||null
      }
    };
  }catch(e){
    try{await markError(MARKET_BACKFILL_SOURCE,e)}catch{}
    throw e;
  }
}

function assertMarketHistoryCoverage(rows, market) {
  if (!rows.length) throw new Error(`${market} 行情解析為 0 筆`);
  const volumeOk = rows.filter(x => x.trade_volume !== null).length;
  const valueOk = rows.filter(x => x.trade_value !== null).length;
  const minRequired = Math.floor(rows.length * 0.95);
  if (volumeOk < minRequired || valueOk < minRequired) {
    throw new Error(`${market} 成交量值欄位不完整：volume=${volumeOk}/${rows.length}, value=${valueOk}/${rows.length}`);
  }
}

async function fetchTwsePriceRows() {
  const tw = taipeiDateParts();
  const ymd = tw.date.replace(/-/g, '');
  const rwdUrl = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  let rwdError = null;
  try {
    const raw = await fetchJson(rwdUrl, { retries:1, timeoutMs:15000 });
    const rows = twseRwdRows(raw);
    if (rows.length >= 300) return { rows, upstream:'TWSE MI_INDEX' };
    rwdError = new Error(`TWSE MI_INDEX 股價有效筆數異常：${rows.length}`);
  } catch (e) {
    rwdError = e;
  }
  try {
    const raw = await fetchJson(TWSE_OPENAPI_URL, { retries:1, timeoutMs:15000 });
    const rows = twseOpenApiRows(raw);
    if (rows.length < 300) throw new Error(`TWSE OpenAPI 股價有效筆數異常：${rows.length}`);
    return { rows, upstream:'TWSE STOCK_DAY_ALL fallback' };
  } catch (fallbackError) {
    throw new Error(`TWSE 主來源失敗：${String(rwdError?.message||rwdError)}；備援失敗：${String(fallbackError?.message||fallbackError)}`);
  }
}


function companyProfileRows(data, market, source) {
  if (!Array.isArray(data)) throw new Error(`${market} 公司基本資料格式不是陣列`);
  return data.map(x => {
    const code = clean(first(x, ['公司代號','SecuritiesCompanyCode','SecuritiesCode','Code','stock_code']));
    if (!validCode(code)) return null;
    // OpenAPI fields differ by market. Prefer abbreviation so name-based business seeds can match.
    const name = clean(first(x, ['公司簡稱','CompanyAbbreviation','SecuritiesCompanyName','公司名稱','CompanyName','Name']));
    if (!name) return null;
    // TWSE t187ap03_L uses `產業別` as the *industry code* field; TPEx uses SecuritiesIndustryCode.
    // v2.6.2.17 treated TWSE `產業別` as a name, which left TWSE industry_code blank.
    const rawIndustryCode = first(x, ['產業別','產業別代碼','SecuritiesIndustryCode','IndustryCode','IndustryCategoryCode']);
    const rawIndustryName = first(x, ['產業類別','產業名稱','Industry','IndustryCategory','IndustryName']);
    const industryInfo = resolveIndustry({code:rawIndustryCode,name:rawIndustryName});
    return {
      stock_code: code,
      stock_name: name,
      market,
      industry_code: industryInfo.code || normalizeIndustryCode(rawIndustryCode) || null,
      industry: industryInfo.name || clean(rawIndustryName) || null,
      report_date: rocToIso(first(x, ['出表日期','資料日期','Date','ReportDate'])) || null,
      source,
    };
  }).filter(Boolean);
}

function companyProfileSourceAudit(rawData, rows, market) {
  const raw = Array.isArray(rawData) ? rawData : [];
  const parsed = Array.isArray(rows) ? rows : [];
  const knownIndustryCodes = new Set(allIndustryCodes());
  const seen = new Set(), duplicates = [];
  for (const row of parsed) {
    if (seen.has(row.stock_code) && duplicates.length < 20) duplicates.push(row.stock_code);
    seen.add(row.stock_code);
  }
  const nonStandard = parsed.filter(row => !/^\d{4}$/.test(row.stock_code));
  const missingIndustry = parsed.filter(row => !normalizeIndustryCode(row.industry_code));
  const unknownIndustry = parsed.filter(row => {
    const code = normalizeIndustryCode(row.industry_code);
    return code && !knownIndustryCodes.has(code);
  });
  const industryCodeRows = parsed.length - missingIndustry.length;
  return {
    market,
    rawRows: raw.length,
    parsedRows: parsed.length,
    rejectedRows: Math.max(0, raw.length - parsed.length),
    uniqueCodes: seen.size,
    duplicateCodes: duplicates.length,
    duplicateExamples: duplicates,
    standardFourDigitRows: parsed.length - nonStandard.length,
    nonStandardCodeRows: nonStandard.length,
    nonStandardCodeExamples: nonStandard.slice(0,20).map(row => row.stock_code),
    industryCodeRows,
    missingIndustryCodeRows: missingIndustry.length,
    industryCodeCoveragePct: parsed.length ? Number((industryCodeRows / parsed.length * 100).toFixed(1)) : 0,
    unknownIndustryCodeRows: unknownIndustry.length,
    unknownIndustryCodeExamples: unknownIndustry.slice(0,20).map(row => `${row.stock_code}:${row.industry_code}`),
  };
}

function combinedCompanyProfileAudit(twseRaw, tpexRaw, twse, tpex) {
  const twseAudit = companyProfileSourceAudit(twseRaw, twse, '上市');
  const tpexAudit = companyProfileSourceAudit(tpexRaw, tpex, '上櫃');
  const all = [...twse, ...tpex];
  const marketByCode = new Map(), crossMarketDuplicates = [];
  for (const row of all) {
    const prior = marketByCode.get(row.stock_code);
    if (prior && prior !== row.market && crossMarketDuplicates.length < 20) crossMarketDuplicates.push(`${row.stock_code}:${prior}/${row.market}`);
    else if (!prior) marketByCode.set(row.stock_code, row.market);
  }
  const industryCodeRows = all.filter(row => normalizeIndustryCode(row.industry_code)).length;
  return {
    totalRows: all.length,
    uniqueCodes: new Set(all.map(row => row.stock_code)).size,
    duplicateCodes: all.length - new Set(all.map(row => row.stock_code)).size,
    crossMarketDuplicateCodes: crossMarketDuplicates.length,
    crossMarketDuplicateExamples: crossMarketDuplicates,
    standardFourDigitRows: all.filter(row => /^\d{4}$/.test(row.stock_code)).length,
    nonStandardCodeRows: all.filter(row => !/^\d{4}$/.test(row.stock_code)).length,
    industryCodeRows,
    missingIndustryCodeRows: all.length - industryCodeRows,
    industryCodeCoveragePct: all.length ? Number((industryCodeRows / all.length * 100).toFixed(1)) : 0,
    byMarket: { twse: twseAudit, tpex: tpexAudit }
  };
}

async function runCompanyProfileSync() {
  try {
    await markAttempt(COMPANY_PROFILE_SOURCE);
    const [twseRaw,tpexRaw]=await Promise.all([
      fetchJson(TWSE_COMPANY_PROFILE_URL,{retries:1,timeoutMs:15000}),
      fetchJson(TPEX_COMPANY_PROFILE_URL,{retries:1,timeoutMs:15000})
    ]);
    const twse=companyProfileRows(twseRaw,'上市','TWSE t187ap03_L');
    const tpex=companyProfileRows(tpexRaw,'上櫃','TPEx mopsfin_t187ap03_O');
    if(twse.length<500)throw new Error(`TWSE 公司基本資料有效筆數異常：${twse.length}`);
    if(tpex.length<300)throw new Error(`TPEx 公司基本資料有效筆數異常：${tpex.length}`);
    const rows=[...twse,...tpex];
    const audit=combinedCompanyProfileAudit(twseRaw,tpexRaw,twse,tpex);
    if(audit.duplicateCodes>0)throw new Error(`公司基本資料代碼重複：${audit.duplicateCodes}`);
    if(audit.industryCodeCoveragePct<COMPANY_PROFILE_MIN_INDUSTRY_COVERAGE_PCT){
      throw new Error(`公司產業代碼覆蓋率異常：${audit.industryCodeCoveragePct}% < ${COMPANY_PROFILE_MIN_INDUSTRY_COVERAGE_PCT}%`);
    }
    await upsertCompanyProfileRows(rows);
    await markSuccess(COMPANY_PROFILE_SOURCE,rows.length);
    return {ok:true,source:COMPANY_PROFILE_SOURCE,rows:rows.length,twse:twse.length,tpex:tpex.length,audit};
  }catch(e){
    try{await markError(COMPANY_PROFILE_SOURCE,e)}catch{}
    return {ok:false,source:COMPANY_PROFILE_SOURCE,preservedLastGood:true,error:String(e?.message||e)};
  }
}


async function companyProfileSyncState({ maxAgeHours = 20 } = {}) {
  await ensureCompanyProfileSchema();
  const sql = getSql();
  let profileRows = 0, lastWrite = null, industryCodeRows = 0, industryNameRows = 0;
  let twseRows = 0, tpexRows = 0, nonStandardCodeRows = 0, invalidStoredCodeRows = 0;
  try {
    const rows = await sql.query(`
      SELECT COUNT(*)::int AS rows,
             COUNT(*) FILTER (WHERE NULLIF(BTRIM(industry_code),'') IS NOT NULL)::int AS industry_code_rows,
             COUNT(*) FILTER (WHERE NULLIF(BTRIM(industry),'') IS NOT NULL)::int AS industry_name_rows,
             COUNT(*) FILTER (WHERE market='上市')::int AS twse_rows,
             COUNT(*) FILTER (WHERE market='上櫃')::int AS tpex_rows,
             COUNT(*) FILTER (WHERE stock_code !~ '^[0-9]{4}$')::int AS non_standard_code_rows,
             COUNT(*) FILTER (WHERE stock_code !~ '^[0-9]{4,6}$')::int AS invalid_stored_code_rows,
             MAX(updated_at) AS last_write
      FROM market_company_profile
    `);
    profileRows = Number(rows?.[0]?.rows || 0);
    industryCodeRows = Number(rows?.[0]?.industry_code_rows || 0);
    industryNameRows = Number(rows?.[0]?.industry_name_rows || 0);
    twseRows = Number(rows?.[0]?.twse_rows || 0);
    tpexRows = Number(rows?.[0]?.tpex_rows || 0);
    nonStandardCodeRows = Number(rows?.[0]?.non_standard_code_rows || 0);
    invalidStoredCodeRows = Number(rows?.[0]?.invalid_stored_code_rows || 0);
    lastWrite = rows?.[0]?.last_write || null;
  } catch {}

  let sync = null;
  try {
    const rows = await sql.query(`
      SELECT source,last_success_at,status,row_count,error_message,updated_at
      FROM sync_status
      WHERE source=$1
      LIMIT 1
    `, [COMPANY_PROFILE_SOURCE]);
    sync = rows?.[0] || null;
  } catch {}

  const lastSuccessMs = sync?.last_success_at ? new Date(sync.last_success_at).getTime() : NaN;
  const ageHours = Number.isFinite(lastSuccessMs) ? Math.max(0, (Date.now() - lastSuccessMs) / 36e5) : null;
  const enoughRows = profileRows >= 800;
  const industryCodeCoveragePct = profileRows ? Number((industryCodeRows / profileRows * 100).toFixed(1)) : 0;
  const industryNameCoveragePct = profileRows ? Number((industryNameRows / profileRows * 100).toFixed(1)) : 0;
  const industryCoverageReady = industryCodeCoveragePct >= COMPANY_PROFILE_MIN_INDUSTRY_COVERAGE_PCT;
  const fresh = enoughRows && industryCoverageReady && sync?.status === 'success' && ageHours !== null && ageHours <= maxAgeHours;
  return {
    source: COMPANY_PROFILE_SOURCE,
    fresh,
    profileRows,
    marketRows:{twse:twseRows,tpex:tpexRows},
    industryCodeRows,
    missingIndustryCodeRows:Math.max(0,profileRows-industryCodeRows),
    industryCodeCoveragePct,
    industryNameRows,
    industryNameCoveragePct,
    minIndustryCodeCoveragePct:COMPANY_PROFILE_MIN_INDUSTRY_COVERAGE_PCT,
    industryCoverageReady,
    nonStandardCodeRows,
    invalidStoredCodeRows,
    duplicateStoredCodes:0,
    lastWrite,
    lastSuccessAt: sync?.last_success_at || null,
    ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    maxAgeHours,
    status: sync?.status || 'missing',
    rowCount: Number(sync?.row_count || 0),
    error: sync?.error_message || null
  };
}

async function ensureCompanyProfileSync({ maxAgeHours = 20 } = {}) {
  const before = await companyProfileSyncState({ maxAgeHours });
  if (before.fresh) {
    return {
      ok: true,
      source: COMPANY_PROFILE_SOURCE,
      skipped: true,
      reason: 'company profiles still fresh and industry coverage ready',
      ...before
    };
  }
  const result = await runCompanyProfileSync();
  if (!result.ok) return { ...result, skipped: false, previous: before };
  const after = await companyProfileSyncState({ maxAgeHours });
  return { ...result, skipped: false, refreshed: true, state: after };
}

async function runPriceSync({ cronSchedule = '' } = {}) {
  const tw = taipeiDateParts();
  if (cronSchedule && (tw.hour < 13 || (tw.hour === 13 && tw.minute < 30))) {
    return { httpStatus:202, body:{ok:true,skipped:true,reason:'before 13:30 Asia/Taipei',taipeiTime:`${tw.date} ${String(tw.hour).padStart(2,'0')}:${String(tw.minute).padStart(2,'0')}`} };
  }
  try {
    await ensureMarketHistorySchema();
    await markAttempt(PRICE_SOURCE);
    const [twseResult, tpexRaw] = await Promise.all([
      fetchTwsePriceRows(),
      fetchJson(TPEX_PRICE_URL, { retries:1, timeoutMs:15000 })
    ]);
    const twse = twseResult.rows, tpex = tpexPriceRows(tpexRaw);
    if (tpex.length < 200) throw new Error(`TPEx 股價有效筆數異常：${tpex.length}`);
    assertMarketHistoryCoverage(twse, 'TWSE');
    assertMarketHistoryCoverage(tpex, 'TPEx');
    const twseDates=[...new Set(twse.map(x=>x.trade_date))], tpexDates=[...new Set(tpex.map(x=>x.trade_date))];
    if(twseDates.length!==1)throw new Error(`TWSE 交易日不唯一：${twseDates.join(',')}`);
    if(tpexDates.length!==1)throw new Error(`TPEx 交易日不唯一：${tpexDates.join(',')}`);
    // v2.6.2.17: the two official markets may publish at different times. Save each
    // market under its real trade date instead of rejecting both or relabelling stale data.
    const marketDateMismatch=twseDates[0]!==tpexDates[0];
    const rows = [...twse, ...tpex];
    await upsertPriceAndHistoryRows(rows);
    await refreshMarketActivityFactors();
    await markSuccess(PRICE_SOURCE, rows.length);
    const valueRows = rows.filter(x => x.trade_value !== null).length;
    const volumeRows = rows.filter(x => x.trade_volume !== null).length;
    return { httpStatus:200, body:{ok:true,source:PRICE_SOURCE,rows:rows.length,twse:twse.length,tpex:tpex.length,
      twseUpstream:twseResult.upstream,tradeDates:[...new Set(rows.map(x=>x.trade_date))].sort(),
      marketDates:{'上市':twseDates[0],'上櫃':tpexDates[0]},marketDateMismatch,
      historySaved:true,valueRows,volumeRows} };
  } catch (e) {
    try { await markError(PRICE_SOURCE, e); } catch {}
    return { httpStatus:502, body:{ok:false,source:PRICE_SOURCE,preservedLastGood:true,error:String(e?.message||e)} };
  }
}

function parseTwseDisposalRows(json) {
  const table = normalizeTableJson(json);
  if (!table.data.length && !Array.isArray(json?.data) && !Array.isArray(json?.tables)) {
    throw new Error('TWSE 處置資料格式無法辨識');
  }
  const out = [];
  for (const rawRow of table.data) {
    const x = rowObject(table.fields, rawRow);
    const code = clean(first(x, ['證券代號','Code','SecuritiesCode']));
    if (!validCode(code)) continue;
    const periodRaw = first(x, ['處置起迄時間','處置起訖時間','DispositionPeriod']);
    const reason = clean(first(x, ['處置條件','處置原因','處置內容','DisposalCondition']));
    const p = parsePeriod(periodRaw, reason);
    if (!p.start || !p.end) continue;
    out.push({
      stock_code: code,
      stock_name: clean(first(x, ['證券名稱','Name','SecuritiesName'])),
      announcement_date: rocToIso(first(x, ['公布日期','公告日期','Date','AnnouncementDate'])) || null,
      start_date: p.start, end_date: p.end, reason, raw_data: x
    });
  }
  return out;
}

async function runTwseDisposalSync() {
  try {
    await markAttempt(TWSE_DISPOSAL_SOURCE);
    const raw = await fetchJson(TWSE_DISPOSAL_URL, { retries:1, timeoutMs:15000 });
    const rows = parseTwseDisposalRows(raw);
    if(!rows.length) throw new Error('TWSE 處置解析為 0 筆，保留上一份成功快照');
    await replaceDisposalMarket('上市', rows);
    await markSuccess(TWSE_DISPOSAL_SOURCE, rows.length);
    return { httpStatus:200, body:{ok:true,source:TWSE_DISPOSAL_SOURCE,market:'上市',rows:rows.length} };
  } catch (e) {
    try { await markError(TWSE_DISPOSAL_SOURCE,e); } catch {}
    return { httpStatus:502, body:{ok:false,source:TWSE_DISPOSAL_SOURCE,preservedLastGood:true,error:String(e?.message||e)} };
  }
}

function parseTpexDisposalRows(json) {
  const table = normalizeTableJson(json);
  const sourceRows = table.data;
  if (!Array.isArray(sourceRows)) throw new Error('TPEx 處置資料格式不是陣列');
  const out=[];
  for (const rawRow of sourceRows) {
    const x = rowObject(table.fields, rawRow);
    const code = clean(first(x,['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號','股票代號']));
    if (!validCode(code)) continue;
    const periodRaw = first(x,['DispositionPeriod','處置起訖時間','處置起迄時間']);
    const reason = clean(first(x,['DisposalCondition','DispositionReasons','DispositionReason','DisposalInformation','處置原因','處置內容']));
    const p = parsePeriod(periodRaw, `${reason} ${periodRaw}`);
    if (!p.start || !p.end) continue;
    out.push({
      stock_code:code,
      stock_name:clean(first(x,['CompanyName','SecuritiesCompanyName','SecuritiesName','Name','證券名稱'])),
      announcement_date:rocToIso(first(x,['Date','AnnouncementDate','公布日期','公告日期','處置日期']))||null,
      start_date:p.start,end_date:p.end,reason,raw_data:x
    });
  }
  return out;
}

function normalizeTpexLegacy(json) {
  const table = normalizeTableJson(json);
  if (!Array.isArray(table.data) || !table.data.length || !Array.isArray(table.fields) || !table.fields.length) return [];
  const fields = table.fields.map(clean);
  const idx = names => { for (const n of names) { const i=fields.indexOf(n); if(i>=0)return i; } return -1; };
  const ci=idx(['證券代號','股票代號']), ni=idx(['證券名稱','股票名稱']), di=idx(['公布日期','公告日期','日期']);
  const pi=idx(['處置起訖時間','處置起迄時間']), ri=idx(['處置原因','處置條件']), ti=idx(['處置內容','處置措施']);
  if (ci<0 || pi<0) return [];
  return table.data.map(r=>({
    Date:di>=0?clean(r[di]):'', SecuritiesCompanyCode:clean(r[ci]), CompanyName:ni>=0?clean(r[ni]):'',
    DispositionPeriod:clean(r[pi]), DispositionReasons:ri>=0?clean(r[ri]):'',
    DisposalCondition:ti>=0?clean(r[ti]):(ri>=0?clean(r[ri]):'')
  })).filter(x=>x.SecuritiesCompanyCode);
}

async function fetchTpexDisposalWithOfficialBackup() {
  let primaryError='';
  try {
    const j=await fetchJson(TPEX_DISPOSAL_PRIMARY,{retries:1,timeoutMs:15000});
    if (!Array.isArray(j)) throw new Error('TPEx OpenAPI 回傳格式不是陣列');
    if (!j.length) throw new Error('TPEx OpenAPI 回傳空陣列');
    return {json:j,source:TPEX_DISPOSAL_PRIMARY};
  } catch(e) { primaryError=String(e?.message||e); }
  try {
    const j=await fetchJson(TPEX_DISPOSAL_BACKUP,{retries:1,timeoutMs:18000});
    const normalized=normalizeTpexLegacy(j);
    if (!normalized.length) throw new Error('TPEx 官方 JSON 備援無可解析處置資料');
    return {json:normalized,source:TPEX_DISPOSAL_BACKUP};
  } catch(e) {
    throw new Error(`TPEx primary=${primaryError}; backup=${String(e?.message||e)}`);
  }
}

async function runTpexDisposalSync() {
  try {
    await markAttempt(TPEX_DISPOSAL_SOURCE);
    const fetched=await fetchTpexDisposalWithOfficialBackup();
    const rows=parseTpexDisposalRows(fetched.json);
    if(!rows.length)throw new Error('TPEx 處置解析為 0 筆，保留上一份成功快照');
    await replaceDisposalMarket('上櫃',rows);
    await markSuccess(TPEX_DISPOSAL_SOURCE,rows.length);
    return { httpStatus:200, body:{ok:true,source:TPEX_DISPOSAL_SOURCE,market:'上櫃',rows:rows.length,upstream:fetched.source} };
  }catch(e){
    try{await markError(TPEX_DISPOSAL_SOURCE,e)}catch{}
    return { httpStatus:502, body:{ok:false,source:TPEX_DISPOSAL_SOURCE,preservedLastGood:true,error:String(e?.message||e)} };
  }
}

module.exports = {
  runPriceSync, runCompanyProfileSync, ensureCompanyProfileSync, companyProfileSyncState, runTwseDisposalSync, runTpexDisposalSync, runMarketHistoryBackfill,
  _test: {
    twseOpenApiRows, twseRwdRows, tpexPriceRows, tpexHistoricalRows, companyProfileRows, companyProfileSourceAudit, combinedCompanyProfileAudit, dateFromTwseRwd, pctChange, assertMarketHistoryCoverage,
    isoAddDays, isWeekendIso, isoToRocSlash,
    parseTwseDisposalRows, parseTpexDisposalRows, normalizeTpexLegacy
  }
};
