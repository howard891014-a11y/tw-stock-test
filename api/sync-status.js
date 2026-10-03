const { getSql, readDatabaseSizeAudit, readDatabaseDeepAudit } = require('../lib/db');
const { isCronAuthorized, ensureMarketHistorySchema, ensureCompanyProfileSchema } = require('../lib/sync-common');
const { runPriceSync, runCompanyProfileSync, ensureCompanyProfileSync, runTwseDisposalSync, runTpexDisposalSync, runMarketHistoryBackfill, runLatestMarketGapRepair } = require('../lib/sync-service');
const { runCreditTradingSync, runCreditTradingBackfill, readCreditTradingHealth } = require('../lib/credit-trading');
const { runInstitutionalSync, runInstitutionalBackfill, readInstitutionalHistoryHealth, institutionalCoverageByDate } = require('../lib/institutional-history');
const { summarizeProfiles } = require('../lib/company-business-tags');
const { getFundflowSnapshot, getFundflowBusinessBrowser, warmCurrentEngineFromStoredDb, backfillCompactFeatureHistory, readCompactFeatureHistoryStatus, readFundflowValidationAudit } = require('../lib/fundflow-xy');
const { runBusinessEnrichment, readBlindCoverageAudit, readBlindCoverageExport, readPendingBusinessEnrichment, readUnclassifiedProfiles, BLIND_COVERAGE_VERSION } = require('../lib/business-enrichment');
const { STORAGE_POLICY, runStorageMaintenance, runVerifiedLegacyCleanup } = require('../lib/storage-policy');


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

function taipeiDateKey(now=new Date()){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}catch{return now.toISOString().slice(0,10)}
}
async function yahooTradingDayProbe(){
  const today=taipeiDateKey();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
  try{
    const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?range=5d&interval=1d&events=history',{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:controller.signal});
    if(!r.ok)throw new Error(`Yahoo market probe HTTP ${r.status}`);
    const j=await r.json(),ts=j?.chart?.result?.[0]?.timestamp||[];
    const days=ts.map(x=>taipeiDateKey(new Date(Number(x)*1000))).filter(Boolean);
    return{ok:true,today,isTradingDay:days.includes(today),latest:days.at(-1)||''};
  }catch(e){return{ok:false,today,isTradingDay:true,failOpen:true,error:String(e?.message||e)}}finally{clearTimeout(timer)}
}

let manualFundflowWarmPromise=null;
let manualFundflowHistoryPromise=null;
let manualInstitutionalBackfillPromise=null;

function requestedAction(req) {
  const schedule = String(req.headers?.['x-vercel-cron-schedule'] || '').trim();
  if (schedule) return CRON_ACTIONS[schedule] || '';
  return String(req.query.action || '').trim().toLowerCase();
}


async function readCompanyTagCoverage(sql){
  const profiles=await sql.query(`
    SELECT stock_code AS symbol,stock_name AS name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at
    FROM market_company_profile
    ORDER BY stock_code
  `).catch(()=>[]);
  if(!profiles.length)return{
    profileRows:0,allMarketCompanies:0,nativeTechIndustryCompanies:0,technologyBusinessCompanies:0,crossIndustryTechCompanies:0,
    fineTechCompanies:0,coarseIndustry:0,unmappedAll:0,techCompanies:0,curated:0,officialChain:0,industryFallback:0,
    unmappedTech:0,fineMapped:0,fineMappedPct:0,fineTechPct:0,coveredPct:0,relations:0,representedTagCount:0,officialChainSeedNames:0,
    masterIndustryCodeRows:0,masterIndustryCodeCoveragePct:0,masterMissingIndustryCodeRows:0,masterTwseRows:0,masterTpexRows:0,
    masterNonStandardCodeRows:0,masterInvalidCodeRows:0,masterDuplicateCodeRows:0
  };
  const summary=summarizeProfiles(profiles);
  const industryCodeRows=profiles.filter(p=>String(p.industry_code||'').trim()).length;
  const twseRows=profiles.filter(p=>p.market==='上市').length;
  const tpexRows=profiles.filter(p=>p.market==='上櫃').length;
  const nonStandardCodeRows=profiles.filter(p=>!/^\d{4}$/.test(String(p.symbol||''))).length;
  const invalidCodeRows=profiles.filter(p=>!/^\d{4,6}$/.test(String(p.symbol||''))).length;
  const uniqueCodes=new Set(profiles.map(p=>String(p.symbol||'')));
  const mainBusinessRows=profiles.filter(p=>String(p.main_business||'').trim()).length;
  const blindVersionRows=profiles.filter(p=>String(p.business_enrich_version||'')===BLIND_COVERAGE_VERSION).length;
  return{
    profileRows:profiles.length,...summary,
    blindCoverageVersion:BLIND_COVERAGE_VERSION,mainBusinessRows,blindVersionRows,
    blindScanCoveragePct:profiles.length?Number((blindVersionRows/profiles.length*100).toFixed(1)):0,
    mainBusinessCoveragePct:profiles.length?Number((mainBusinessRows/profiles.length*100).toFixed(1)):0,
    masterIndustryCodeRows:industryCodeRows,
    masterIndustryCodeCoveragePct:profiles.length?Number((industryCodeRows/profiles.length*100).toFixed(1)):0,
    masterMissingIndustryCodeRows:Math.max(0,profiles.length-industryCodeRows),
    masterTwseRows:twseRows,masterTpexRows:tpexRows,
    masterNonStandardCodeRows:nonStandardCodeRows,masterInvalidCodeRows:invalidCodeRows,
    masterDuplicateCodeRows:profiles.length-uniqueCodes.size
  };
}


const MARKET_HEALTH_WINDOW_DAYS = 20;
const MARKET_HEALTH_COVERAGE_PCT = 90;
const MARKET_HEALTH_FIELD_PCT = 95;
const MARKET_HEALTH_READY_PCT = 80;
const XY_MIN_READY_TRAJECTORY_DAYS = 5;
const MARKET_HEALTH_MARKETS = ['上市','上櫃'];

function pct(n,d){
  const nn=Number(n||0),dd=Number(d||0);
  return dd>0?Number((nn/dd*100).toFixed(1)):0;
}
function isoDate(v){return v?String(v).slice(0,10):null}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}

function marketDateAlignment(byMarket){
  const tw=(byMarket['上市']?.daily||[]).map(x=>x.tradeDate).filter(Boolean);
  const tp=(byMarket['上櫃']?.daily||[]).map(x=>x.tradeDate).filter(Boolean);
  if(!tw.length||!tp.length)return{
    overlapStart:null,overlapEnd:null,commonDates:0,twseMissingDates:[],tpexMissingDates:[],aligned:false
  };
  const overlapStart=[tw.at(-1),tp.at(-1)].sort().at(-1);
  const overlapEnd=[tw[0],tp[0]].sort()[0];
  if(!overlapStart||!overlapEnd||overlapStart>overlapEnd)return{
    overlapStart,overlapEnd,commonDates:0,twseMissingDates:[],tpexMissingDates:[],aligned:false
  };
  const twSet=new Set(tw),tpSet=new Set(tp);
  const union=[...new Set([...tw,...tp])].filter(d=>d>=overlapStart&&d<=overlapEnd).sort().reverse();
  const twseMissingDates=union.filter(d=>tpSet.has(d)&&!twSet.has(d));
  const tpexMissingDates=union.filter(d=>twSet.has(d)&&!tpSet.has(d));
  return{
    overlapStart,overlapEnd,
    commonDates:union.filter(d=>twSet.has(d)&&tpSet.has(d)).length,
    twseMissingDates,tpexMissingDates,
    aligned:twseMissingDates.length===0&&tpexMissingDates.length===0
  };
}

async function readMarketDataHealth(sql,{windowDays=MARKET_HEALTH_WINDOW_DAYS}={}){
  const [masterRows,priceRows,historyDailyRows,activityDailyRows,historyDuplicateRows,activityDuplicateRows,missingLatestRows]=await Promise.all([
    sql.query(`
      SELECT market,COUNT(*)::int AS rows
      FROM market_company_profile
      WHERE market IN ('上市','上櫃')
      GROUP BY market
    `),
    sql.query(`
      SELECT s.market,COUNT(*)::int AS rows,MAX(s.trade_date)::text AS latest_trade_date,MAX(s.updated_at) AS last_write,
             COUNT(*) FILTER (WHERE p.stock_code IS NULL)::int AS extra_codes
      FROM price_snapshot s
      LEFT JOIN market_company_profile p ON p.stock_code=s.stock_code AND p.market=s.market
      WHERE s.market IN ('上市','上櫃')
      GROUP BY s.market
    `),
    sql.query(`
      WITH ranked_dates AS (
        SELECT market,trade_date,
               ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) AS rn
        FROM (SELECT DISTINCT market,trade_date FROM market_daily_history WHERE market IN ('上市','上櫃')) d
      ), recent_dates AS (
        SELECT market,trade_date FROM ranked_dates WHERE rn <= $1
      )
      SELECT h.market,h.trade_date::text AS trade_date,
             COUNT(*)::int AS rows,
             COUNT(DISTINCT h.stock_code)::int AS distinct_codes,
             COUNT(*) FILTER (WHERE h.trade_value IS NOT NULL)::int AS value_rows,
             COUNT(*) FILTER (WHERE h.trade_volume IS NOT NULL)::int AS volume_rows,
             COUNT(DISTINCT h.stock_code) FILTER (WHERE p.stock_code IS NOT NULL)::int AS profile_matched_codes,
             COUNT(DISTINCT h.stock_code) FILTER (WHERE p.stock_code IS NULL)::int AS extra_codes,
             MAX(h.updated_at) AS last_write
      FROM market_daily_history h
      JOIN recent_dates d ON d.market=h.market AND d.trade_date=h.trade_date
      LEFT JOIN market_company_profile p ON p.stock_code=h.stock_code AND p.market=h.market
      GROUP BY h.market,h.trade_date
      ORDER BY h.market,h.trade_date DESC
    `,[windowDays]),
    sql.query(`
      WITH ranked_dates AS (
        SELECT market,trade_date,
               ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) AS rn
        FROM (SELECT DISTINCT market,trade_date FROM market_daily_history WHERE market IN ('上市','上櫃')) d
      ), recent_dates AS (
        SELECT market,trade_date FROM ranked_dates WHERE rn <= $1
      )
      SELECT d.market,d.trade_date::text AS trade_date,
             COUNT(a.stock_code)::int AS rows,
             COUNT(DISTINCT a.stock_code)::int AS distinct_codes,
             COUNT(DISTINCT a.stock_code) FILTER (WHERE h.stock_code IS NOT NULL)::int AS history_matched_codes,
             COUNT(DISTINCT a.stock_code) FILTER (WHERE p.stock_code IS NULL AND a.stock_code IS NOT NULL)::int AS extra_codes,
             COUNT(*) FILTER (WHERE a.activity_ready)::int AS ready_rows,
             COUNT(*) FILTER (WHERE a.baseline_days_20=20)::int AS baseline20_rows,
             COUNT(*) FILTER (WHERE a.value_ratio_20 IS NOT NULL)::int AS value_ratio_rows,
             MAX(a.updated_at) AS last_write
      FROM recent_dates d
      LEFT JOIN market_activity_daily a ON a.market=d.market AND a.trade_date=d.trade_date
      LEFT JOIN market_daily_history h ON h.market=a.market AND h.trade_date=a.trade_date AND h.stock_code=a.stock_code
      LEFT JOIN market_company_profile p ON p.stock_code=a.stock_code AND p.market=a.market
      GROUP BY d.market,d.trade_date
      ORDER BY d.market,d.trade_date DESC
    `,[windowDays]),
    sql.query(`
      WITH ranked_dates AS (
        SELECT market,trade_date,
               ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) AS rn
        FROM (SELECT DISTINCT market,trade_date FROM market_daily_history WHERE market IN ('上市','上櫃')) d
      ), recent_dates AS (
        SELECT market,trade_date FROM ranked_dates WHERE rn <= $1
      ), dup AS (
        SELECT h.market,h.trade_date,h.stock_code,COUNT(*)::int AS c
        FROM market_daily_history h
        JOIN recent_dates d ON d.market=h.market AND d.trade_date=h.trade_date
        GROUP BY h.market,h.trade_date,h.stock_code
        HAVING COUNT(*)>1
      )
      SELECT market,COUNT(*)::int AS duplicate_groups,COALESCE(SUM(c-1),0)::int AS duplicate_extra_rows
      FROM dup GROUP BY market
    `,[windowDays]),
    sql.query(`
      WITH ranked_dates AS (
        SELECT market,trade_date,
               ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) AS rn
        FROM (SELECT DISTINCT market,trade_date FROM market_activity_daily WHERE market IN ('上市','上櫃')) d
      ), recent_dates AS (
        SELECT market,trade_date FROM ranked_dates WHERE rn <= $1
      ), dup AS (
        SELECT a.market,a.trade_date,a.stock_code,COUNT(*)::int AS c
        FROM market_activity_daily a
        JOIN recent_dates d ON d.market=a.market AND d.trade_date=a.trade_date
        GROUP BY a.market,a.trade_date,a.stock_code
        HAVING COUNT(*)>1
      )
      SELECT market,COUNT(*)::int AS duplicate_groups,COALESCE(SUM(c-1),0)::int AS duplicate_extra_rows
      FROM dup GROUP BY market
    `,[windowDays]),
    sql.query(`
      WITH latest AS (
        SELECT market,MAX(trade_date) AS trade_date
        FROM market_daily_history
        WHERE market IN ('上市','上櫃')
        GROUP BY market
      ), missing AS (
        SELECT p.market,p.stock_code,p.stock_name,
               ROW_NUMBER() OVER (PARTITION BY p.market ORDER BY p.stock_code) AS rn
        FROM market_company_profile p
        JOIN latest l ON l.market=p.market
        LEFT JOIN market_daily_history h
          ON h.market=p.market AND h.trade_date=l.trade_date AND h.stock_code=p.stock_code
        WHERE p.market IN ('上市','上櫃') AND h.stock_code IS NULL
      )
      SELECT market,stock_code,stock_name FROM missing WHERE rn<=12 ORDER BY market,stock_code
    `)
  ]);

  const master=Object.fromEntries(masterRows.map(r=>[r.market,num(r.rows)]));
  const prices=Object.fromEntries(priceRows.map(r=>[r.market,r]));
  const historyDup=Object.fromEntries(historyDuplicateRows.map(r=>[r.market,r]));
  const activityDup=Object.fromEntries(activityDuplicateRows.map(r=>[r.market,r]));
  const missingLatest={上市:[],上櫃:[]};
  for(const r of missingLatestRows)if(missingLatest[r.market])missingLatest[r.market].push({code:r.stock_code,name:r.stock_name});

  const activityByKey=new Map(activityDailyRows.map(r=>[`${r.market}|${isoDate(r.trade_date)}`,r]));
  const byMarket={};
  const coreIssues=[],xyIssues=[];

  for(const market of MARKET_HEALTH_MARKETS){
    const masterCount=master[market]||0;
    const rows=historyDailyRows.filter(r=>r.market===market);
    const daily=rows.map(r=>{
      const date=isoDate(r.trade_date),a=activityByKey.get(`${market}|${date}`)||{};
      const historyCodes=num(r.distinct_codes),matchedCodes=num(r.profile_matched_codes),activityCodes=num(a.distinct_codes);
      return{
        tradeDate:date,
        historyRows:num(r.rows),historyDistinctCodes:historyCodes,
        masterMatchedCodes:matchedCodes,missingMasterCodes:Math.max(0,masterCount-matchedCodes),extraHistoryCodes:num(r.extra_codes),
        historyCoveragePct:pct(matchedCodes,masterCount),
        tradeValueCoveragePct:pct(r.value_rows,r.rows),tradeVolumeCoveragePct:pct(r.volume_rows,r.rows),
        activityRows:num(a.rows),activityDistinctCodes:activityCodes,extraActivityCodes:num(a.extra_codes),
        activityCoveragePct:pct(a.history_matched_codes,historyCodes),
        activityReadyRows:num(a.ready_rows),activityReadyPct:pct(a.ready_rows,activityCodes),
        baseline20Rows:num(a.baseline20_rows),valueRatioRows:num(a.value_ratio_rows),
        historyLastWrite:r.last_write||null,activityLastWrite:a.last_write||null
      };
    });
    const checkedDays=daily.length;
    const latest=daily[0]||null;
    const lowCoverageDates=daily.filter(x=>x.historyCoveragePct<MARKET_HEALTH_COVERAGE_PCT).map(x=>x.tradeDate);
    const lowFieldDates=daily.filter(x=>x.tradeValueCoveragePct<MARKET_HEALTH_FIELD_PCT||x.tradeVolumeCoveragePct<MARKET_HEALTH_FIELD_PCT).map(x=>x.tradeDate);
    const lowActivityCoverageDates=daily.filter(x=>x.activityCoveragePct<MARKET_HEALTH_COVERAGE_PCT).map(x=>x.tradeDate);
    const readyTrajectoryDates=daily.filter(x=>x.activityCoveragePct>=MARKET_HEALTH_COVERAGE_PCT&&x.activityReadyPct>=MARKET_HEALTH_READY_PCT).map(x=>x.tradeDate);
    const extraHistoryDates=daily.filter(x=>x.extraHistoryCodes>0).map(x=>x.tradeDate);
    const extraActivityDates=daily.filter(x=>x.extraActivityCodes>0).map(x=>x.tradeDate);
    const hdup=historyDup[market]||{},adup=activityDup[market]||{};
    const priceLatest=isoDate(prices[market]?.latest_trade_date);
    const historyLatest=latest?.tradeDate||null;
    const historyLatestMatchesPrice=Boolean(priceLatest&&historyLatest&&priceLatest===historyLatest);
    const summary={
      market,masterRows:masterCount,windowTradingDays:windowDays,checkedTradingDays:checkedDays,
      oldestCheckedTradeDate:daily.at(-1)?.tradeDate||null,latestTradeDate:historyLatest,
      priceSnapshotLatestTradeDate:priceLatest,historyLatestMatchesPrice,priceSnapshotRows:num(prices[market]?.rows),priceSnapshotExtraCodes:num(prices[market]?.extra_codes),
      minHistoryCoveragePct:daily.length?Math.min(...daily.map(x=>x.historyCoveragePct)):0,
      avgHistoryCoveragePct:daily.length?Number((daily.reduce((s,x)=>s+x.historyCoveragePct,0)/daily.length).toFixed(1)):0,
      latestHistoryCoveragePct:latest?.historyCoveragePct||0,
      lowCoverageDates,
      minTradeValueCoveragePct:daily.length?Math.min(...daily.map(x=>x.tradeValueCoveragePct)):0,
      minTradeVolumeCoveragePct:daily.length?Math.min(...daily.map(x=>x.tradeVolumeCoveragePct)):0,
      lowFieldCoverageDates:lowFieldDates,
      minActivityCoveragePct:daily.length?Math.min(...daily.map(x=>x.activityCoveragePct)):0,
      latestActivityCoveragePct:latest?.activityCoveragePct||0,
      lowActivityCoverageDates,
      maxExtraHistoryCodes:daily.length?Math.max(...daily.map(x=>x.extraHistoryCodes)):0,extraHistoryDates,
      maxExtraActivityCodes:daily.length?Math.max(...daily.map(x=>x.extraActivityCodes)):0,extraActivityDates,
      latestActivityReadyPct:latest?.activityReadyPct||0,
      readyTrajectoryDays:readyTrajectoryDates.length,readyTrajectoryDates,
      historyDuplicateGroups:num(hdup.duplicate_groups),historyDuplicateExtraRows:num(hdup.duplicate_extra_rows),
      activityDuplicateGroups:num(adup.duplicate_groups),activityDuplicateExtraRows:num(adup.duplicate_extra_rows),
      latestMissingMasterCodeExamples:missingLatest[market],
      daily
    };
    byMarket[market]=summary;

    if(masterCount===0)coreIssues.push(`${market} 公司母表為 0`);
    if(checkedDays<windowDays)coreIssues.push(`${market} history 僅 ${checkedDays}/${windowDays} 個交易日`);
    if(priceLatest&&historyLatest&&!historyLatestMatchesPrice)coreIssues.push(`${market} history 最新日 ${historyLatest} 未對齊 price_snapshot ${priceLatest}`);
    if(summary.minHistoryCoveragePct<MARKET_HEALTH_COVERAGE_PCT)coreIssues.push(`${market} history 股票覆蓋最低 ${summary.minHistoryCoveragePct}%`);
    if(summary.minTradeValueCoveragePct<MARKET_HEALTH_FIELD_PCT||summary.minTradeVolumeCoveragePct<MARKET_HEALTH_FIELD_PCT)coreIssues.push(`${market} history 成交量值欄位覆蓋不足`);
    if(summary.minActivityCoveragePct<MARKET_HEALTH_COVERAGE_PCT)coreIssues.push(`${market} activity 對 history 覆蓋最低 ${summary.minActivityCoveragePct}%`);
    if(summary.maxExtraHistoryCodes>0)coreIssues.push(`${market} history 仍含非母表代碼，單日最高 ${summary.maxExtraHistoryCodes} 筆`);
    if(summary.maxExtraActivityCodes>0)coreIssues.push(`${market} activity 仍含非母表代碼，單日最高 ${summary.maxExtraActivityCodes} 筆`);
    if(summary.priceSnapshotExtraCodes>0)coreIssues.push(`${market} price_snapshot 仍含非母表代碼 ${summary.priceSnapshotExtraCodes} 筆`);
    if(summary.historyDuplicateGroups>0||summary.activityDuplicateGroups>0)coreIssues.push(`${market} 發現重複資料列`);
    if(summary.readyTrajectoryDays<XY_MIN_READY_TRAJECTORY_DAYS)xyIssues.push(`${market} activity_ready 軌跡僅 ${summary.readyTrajectoryDays}/${XY_MIN_READY_TRAJECTORY_DAYS} 天`);
  }

  const dateAlignment=marketDateAlignment(byMarket);
  if(dateAlignment.twseMissingDates.length)coreIssues.push(`上市在共同日期區間缺 ${dateAlignment.twseMissingDates.length} 個交易日`);
  if(dateAlignment.tpexMissingDates.length)coreIssues.push(`上櫃在共同日期區間缺 ${dateAlignment.tpexMissingDates.length} 個交易日`);
  const coreHealthy=coreIssues.length===0;
  return{
    checkedAt:new Date().toISOString(),windowTradingDays:windowDays,
    thresholds:{stockCoveragePct:MARKET_HEALTH_COVERAGE_PCT,tradeFieldCoveragePct:MARKET_HEALTH_FIELD_PCT,activityCoveragePct:MARKET_HEALTH_COVERAGE_PCT,activityReadyPct:MARKET_HEALTH_READY_PCT,xyMinReadyTrajectoryDays:XY_MIN_READY_TRAJECTORY_DAYS},
    coreHealthy,readyForXY:coreHealthy&&xyIssues.length===0,
    coreIssues,xyIssues,dateAlignment,byMarket
  };
}


async function readFlowDataHealth(sql){
  const targets={
    live:STORAGE_POLICY.liveMinDays,
    priceRaw:STORAGE_POLICY.raw.price,
    institutionalRaw:STORAGE_POLICY.raw.institutional,
    creditRaw:STORAGE_POLICY.raw.credit,
    activityRaw:STORAGE_POLICY.raw.activity,
    research:STORAGE_POLICY.compact.topicResearch
  };
  const [institutional,credit,priceHistoryRows,profileRows,syncRows,instCoverageTwse60,instCoverageTpex60,storage,researchCompactHistory]=await Promise.all([
    readInstitutionalHistoryHealth().catch(e=>({totalRows:0,markets:{},error:String(e?.message||e)})),
    readCreditTradingHealth().catch(e=>({totalRows:0,markets:{},error:String(e?.message||e)})),
    sql.query(`
      WITH latest AS (
        SELECT market,MAX(trade_date) AS max_date
        FROM market_daily_history
        WHERE market IN ('上市','上櫃')
        GROUP BY market
      )
      SELECT h.market,COUNT(*)::int AS rows,COUNT(DISTINCT h.trade_date)::int AS trading_days,
             MIN(h.trade_date)::text AS min_date,MAX(h.trade_date)::text AS max_date,
             COUNT(*) FILTER (WHERE h.trade_date=l.max_date)::int AS latest_rows,
             MAX(h.updated_at)::text AS updated_at
      FROM market_daily_history h
      JOIN latest l ON l.market=h.market
      WHERE h.market IN ('上市','上櫃')
      GROUP BY h.market
      ORDER BY h.market
    `).catch(()=>[]),
    sql.query(`
      SELECT market,COUNT(*)::int AS profile_rows
      FROM market_company_profile
      WHERE market IN ('上市','上櫃')
      GROUP BY market
    `).catch(()=>[]),
    sql.query(`
      SELECT source,last_attempt_at,last_success_at,status,row_count,error_message,updated_at
      FROM sync_status
      WHERE source = ANY($1::text[])
      ORDER BY source
    `,[['price_daily','market_history_backfill','institutional_flow_twse','institutional_flow_tpex','credit_trading_twse','credit_trading_tpex']]).catch(()=>[]),
    institutionalCoverageByDate('上市',60).catch(()=>[]),
    institutionalCoverageByDate('上櫃',60).catch(()=>[]),
    readDatabaseSizeAudit(sql).catch(e=>({error:String(e?.message||e),tables:[]})),
    readCompactFeatureHistoryStatus(sql,{targetDays:STORAGE_POLICY.compact.topicResearch,horizon:5}).catch(e=>({targetDays:STORAGE_POLICY.compact.topicResearch,horizon:5,compactDays:0,xUsableDays:0,horizonAnchorDays:0,compactRows:0,historyReady:false,error:String(e?.message||e)}))
  ]);
  const compactHistory={...researchCompactHistory,targetDays:STORAGE_POLICY.xyOperationalDays,historyReady:Number(researchCompactHistory?.compactDays||0)>=STORAGE_POLICY.xyOperationalDays&&Number(researchCompactHistory?.horizonAnchorDays||0)>0};
  const priceHistory={markets:{}};
  for(const row of priceHistoryRows){
    priceHistory.markets[row.market]={
      rows:Number(row.rows)||0,tradingDays:Number(row.trading_days)||0,
      minDate:isoDate(row.min_date),maxDate:isoDate(row.max_date),latestRows:Number(row.latest_rows)||0,updatedAt:row.updated_at||null
    };
  }
  const profiles=Object.fromEntries(profileRows.map(r=>[r.market,Number(r.profile_rows)||0]));
  const syncBySource=Object.fromEntries(syncRows.map(r=>[r.source,r]));
  const sourceMap={
    '上市':{institutional:'institutional_flow_twse',credit:'credit_trading_twse'},
    '上櫃':{institutional:'institutional_flow_tpex',credit:'credit_trading_tpex'}
  };
  const markets={};
  const institutionalCoverage60={'上市':instCoverageTwse60||[],'上櫃':instCoverageTpex60||[]};
  const warnings=[];
  const layerState=(days,target)=>({
    targetDays:target,
    targetReady:days>=target,
    progressPct:Number((Math.min(days,target)/target*100).toFixed(1))
  });
  for(const market of ['上市','上櫃']){
    const profileCount=profiles[market]||0;
    const price=priceHistory.markets?.[market]||{};
    const inst=institutional.markets?.[market]||{};
    const cred=credit.markets?.[market]||{};
    const priceDate=isoDate(price.maxDate),instDate=isoDate(inst.maxDate),creditDate=isoDate(cred.maxDate);
    const instFresh=!priceDate||Boolean(instDate&&instDate>=priceDate);
    const creditFresh=!priceDate||Boolean(creditDate&&creditDate>=priceDate);
    const dateAligned=Boolean(priceDate&&instDate&&creditDate&&priceDate===instDate&&priceDate===creditDate);
    const priceDays=Number(price.tradingDays||0),instDays=Number(inst.tradingDays||0),creditDays=Number(cred.tradingDays||0);
    const liveReady=dateAligned&&instFresh&&creditFresh&&priceDays>=targets.live&&instDays>=targets.live&&creditDays>=targets.live;
    const coreRawReady=liveReady&&priceDays>=targets.priceRaw&&instDays>=targets.institutionalRaw&&creditDays>=targets.creditRaw;
    const institutionalCoveragePct=profileCount?pct(inst.latestRows||0,profileCount):0;
    const instCoverage60=institutionalCoverage60[market]||[],completeDays60=instCoverage60.filter(x=>x.complete).length;
    const creditParticipationPct=profileCount?pct(cred.latestRows||0,profileCount):0;
    if(!dateAligned)warnings.push(`${market}日期未對齊：股價 ${priceDate||'無'}／法人 ${instDate||'無'}／信用 ${creditDate||'無'}`);
    if(priceDays<targets.live)warnings.push(`${market}股價歷史僅 ${priceDays} 日`);
    if(instDays<targets.live)warnings.push(`${market}法人歷史僅 ${instDays} 日`);
    if(creditDays<targets.live)warnings.push(`${market}信用歷史僅 ${creditDays} 日`);
    markets[market]={
      ready:liveReady,liveReady,coreRawReady,
      backtestReady250:false,researchReady500:false,
      expectedTradeDate:priceDate,profileRows:profileCount,dateAligned,
      price:{...price,...layerState(priceDays,targets.priceRaw),sync:syncBySource.price_daily||null,backfillSync:syncBySource.market_history_backfill||null},
      institutional:{...inst,fresh:instFresh,...layerState(instDays,targets.institutionalRaw),coveragePct:institutionalCoveragePct,completeDays60,targetDays60:60,complete60:completeDays60>=60,completeDays25:Math.min(25,completeDays60),targetDays25:25,complete25:completeDays60>=25,sync:syncBySource[sourceMap[market].institutional]||null},
      credit:{...cred,fresh:creditFresh,...layerState(creditDays,targets.creditRaw),participationPct:creditParticipationPct,sync:syncBySource[sourceMap[market].credit]||null}
    };
  }
  const allMarkets=Object.values(markets);
  const liveReady=allMarkets.length===2&&allMarkets.every(x=>x.liveReady);
  const coreRawReady=allMarkets.length===2&&allMarkets.every(x=>x.coreRawReady);
  const researchReady250=liveReady&&Boolean(researchCompactHistory?.historyReady);
  const backtestReady250=researchReady250; // compatibility alias for older UI/clients
  const researchReady500=false; // compatibility only; 500D raw research was retired in .59
  if(Number(storage?.totalMb||0)>=STORAGE_POLICY.softTargetMb)warnings.unshift(`Neon DB ${storage.totalMb} MB 已達 ${STORAGE_POLICY.softTargetMb} MB 軟上限；Retention 會優先阻止 raw 繼續膨脹`);
  return{
    liveReady,coreRawReady,researchReady250,backtestReady250,researchReady500,
    readyForAX:liveReady,
    targetHistoryDays:targets.live,institutionalCoverageTargetDays:60,
    targets,markets,storage,fundflowCompactHistory:compactHistory,researchCompactHistory,warnings:warnings.slice(0,12),
    generatedAt:new Date().toISOString()
  };
}

async function statusResponse(req, res) {
  // v2.6.2.17: status reads are also safe schema-migration entry points.
  // This prevents a fresh cached sync from skipping new columns/tables after deployment.
  await Promise.all([ensureMarketHistorySchema(),ensureCompanyProfileSchema()]);
  const sql=getSql();
  const code=String(req.query.code||'').trim();
  const view=String(req.query.view||'').trim().toLowerCase();

  if(view==='fundflow'){
    res.setHeader('Cache-Control','public, s-maxage=120, stale-while-revalidate=300');
    const days=Math.max(5,Math.min(15,Number(req.query?.days)||10));
    const force=String(req.query?.refresh||'').toLowerCase()==='true'||String(req.query?.refresh||'')==='1';
    const data=await getFundflowSnapshot({days,force});
    return res.status(200).json(data);
  }

  if(view==='fundflow-browser'){
    res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=600');
    const days=Math.max(5,Math.min(15,Number(req.query?.days)||10));
    const data=await getFundflowBusinessBrowser({days});
    return res.status(200).json(data);
  }

  if(view==='fundflow-audit'){
    res.setHeader('Cache-Control','no-store');
    const targetDays=Math.max(25,Math.min(60,Number(req.query?.target)||60));
    const data=await readFundflowValidationAudit({sql,targetDays,maxDates:120});
    const appVersion=String(require('../package.json').version||''),clientRevision=String(req.query?.client||'').trim(),clientRevisionMatch=Boolean(clientRevision&&clientRevision===appVersion);
    data.appVersion=appVersion;data.clientRevision=clientRevision;data.clientRevisionMatch=clientRevisionMatch;
    data.releaseGate={...(data.releaseGate||{}),frontendRevision:clientRevisionMatch};
    data.releaseGate.readyToFinalize=Object.entries(data.releaseGate).filter(([k])=>k!=='readyToFinalize').every(([,v])=>Boolean(v));
    return res.status(200).json(data);
  }

  if(view==='blind-coverage'){
    res.setHeader('Cache-Control','no-store');
    const limit=Math.max(1,Math.min(1000,Number(req.query?.limit)||300));
    const minScore=Math.max(0,Math.min(100,Number(req.query?.minScore)||60));
    const data=await readBlindCoverageAudit({limit,minScore});
    return res.status(200).json(data);
  }

  if(view==='blind-export'){
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename=stockzone-blind-audit.json');
    const data=await readBlindCoverageExport();
    return res.status(200).send(JSON.stringify(data));
  }

  if(view==='blind-catchup'){
    // v2.6.5.1 temporary migration runner. It is bounded, additive-only, and becomes
    // a no-op after the current blind-coverage version has caught up. ui=1 provides
    // a one-tab auto runner so the user never has to manually refresh ten batches.
    res.setHeader('Cache-Control','no-store');
    const ui=['1','true','yes'].includes(String(req.query?.ui||'').toLowerCase());
    if(ui){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.status(200).send(`<!doctype html><html lang="zh-Hant"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StockZone Blind Catch-up</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#eef3fb;margin:0;padding:24px}main{max-width:760px;margin:auto}h1{font-size:22px}.card{background:#171b22;border:1px solid #2a3442;border-radius:16px;padding:18px}#bar{height:14px;background:#252d38;border-radius:99px;overflow:hidden}#fill{height:100%;width:0;background:#76a9ff;transition:width .25s}.big{font-size:32px;font-weight:700;margin:12px 0}.muted{color:#aeb9c8}pre{white-space:pre-wrap;word-break:break-word;background:#0b0d11;border-radius:12px;padding:12px;max-height:46vh;overflow:auto}button{font:inherit;padding:10px 14px;border-radius:10px;border:0} </style><main><h1>StockZone 全市場 Blind Coverage 補掃</h1><div class="card"><div class="muted">保持此頁開啟即可，會自動一批一批跑到完成，不用手動重新整理。</div><div class="big" id="status">準備中…</div><div id="bar"><div id="fill"></div></div><p id="meta" class="muted"></p><pre id="log"></pre><button id="retry" hidden>繼續</button></div><script>const S=document.getElementById('status'),M=document.getElementById('meta'),F=document.getElementById('fill'),L=document.getElementById('log'),R=document.getElementById('retry');let stopped=false;async function one(){R.hidden=true;S.textContent='掃描中…';try{const u='/api/sync-status?view=blind-catchup&confirm=1&batch=25&_='+Date.now();const r=await fetch(u,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));F.style.width=(j.progressPct||0)+'%';L.textContent=JSON.stringify(j,null,2);if(j.done){stopped=true;S.textContent='全市場 Blind Coverage 補掃完成';M.textContent='已完成 '+j.total+' / '+j.total+' 家';return}const allFailed=(j.processed||0)>0&&(j.errors||0)>=(j.processed||0);let wait=allFailed?Math.max(90000,j.retryAfterMs||0):Math.max(1800,j.retryAfterMs||0);if(allFailed){S.textContent='MOPS 暫時拒絕本批，冷卻後自動續跑';M.textContent='目前 '+((j.total||0)-(j.pending||0))+' / '+(j.total||0)+' 家｜本批 '+j.processed+' 家全失敗｜約 '+Math.ceil(wait/1000)+' 秒後重試';}else if((j.processed||0)===0&&(j.coolingErrors||0)>0){S.textContent='等待 MOPS 冷卻…';M.textContent='已完成 '+((j.total||0)-(j.pending||0))+' / '+(j.total||0)+' 家｜剩餘 '+(j.pending||0)+' 家｜'+Math.ceil(wait/1000)+' 秒後續跑';}else{S.textContent='完成 '+(j.progressPct||0)+'%';M.textContent='已完成 '+((j.total||0)-(j.pending||0))+' / '+(j.total||0)+' 家｜本批成功 '+((j.processed||0)-(j.errors||0))+' / '+(j.processed||0)+'｜剩餘 '+(j.pending||0)+' 家';}setTimeout(one,wait)}catch(e){S.textContent='暫停：'+e.message;M.textContent='按「繼續」即可從目前進度續跑，不會重來。';R.hidden=false}}R.onclick=()=>{if(!stopped)one()};one();</script></main></html>`);
    }
    const confirm=['1','true','yes'].includes(String(req.query?.confirm||'').toLowerCase());
    const batch=Math.max(1,Math.min(50,Number(req.query?.batch)||25));
    if(!confirm){
      const pending=await readPendingBusinessEnrichment({limit:20});
      return res.status(200).json({
        ok:true,view:'blind-catchup',version:BLIND_COVERAGE_VERSION,armed:false,
        message:'Use ui=1 for the automatic catch-up runner, or confirm=1 for one JSON batch.',
        pending:pending.pending,total:pending.total,withMainBusiness:pending.withMainBusiness
      });
    }
    const run=await runBusinessEnrichment({limit:batch,delayMs:250,maxRunMs:47000,concurrency:2});
    const pending=await readPendingBusinessEnrichment({limit:20});
    const completed=Math.max(0,Number(pending.total||0)-Number(pending.pending||0));
    const progressPct=Number(pending.total||0)>0?Number((completed/Number(pending.total)*100).toFixed(1)):100;
    return res.status(200).json({
      ok:true,view:'blind-catchup',version:BLIND_COVERAGE_VERSION,armed:true,
      batchRequested:batch,processed:run.processed||0,cachedReclassified:run.cachedReclassified||0,
      classified:run.classified||0,scanned:run.scanned||0,errors:run.errors||0,
      pending:pending.pending,total:pending.total,withMainBusiness:pending.withMainBusiness,
      coolingErrors:pending.coolingErrors||0,retryAfterMs:pending.retryAfterMs||0,
      errorSamples:(run.results||[]).filter(x=>x.status==='error').slice(0,5).map(x=>({code:x.code,name:x.name,error:x.error||''})),
      progressPct,done:Number(pending.pending||0)===0,
      next:Number(pending.pending||0)>0?'Repeat the same request for another bounded batch.':'Open view=blind-coverage for the final audit.',
      sample:pending.items||[]
    });
  }

  if(view==='tech-pending'){
    res.setHeader('Cache-Control','no-store');
    const limit=Math.max(1,Math.min(500,Number(req.query?.limit)||200));
    const data=await readPendingBusinessEnrichment({limit});
    return res.status(200).json({...data,view:'tech-pending'});
  }

  if(view==='unclassified'){
    res.setHeader('Cache-Control','no-store');
    const limit=Math.max(1,Math.min(500,Number(req.query?.limit)||200));
    const data=await readUnclassifiedProfiles({limit});
    return res.status(200).json({...data,view:'unclassified'});
  }

  if(view==='market-health'){
    const marketHealth=await readMarketDataHealth(sql);
    return res.status(200).json({ok:true,view:'market-health',marketHealth});
  }

  if(view==='flow-data-health'){
    const flowDataHealth=await readFlowDataHealth(sql);
    return res.status(200).json({ok:true,view:'flow-data-health',flowDataHealth});
  }

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
               return_3_pct,return_5_pct,return_20_pct,baseline_days_20,recent_days_5,activity_ready,updated_at
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

  const [status,price,disposal,marketHistory,marketActivity,companyProfiles,companyTagCoverage,creditTrading]=await Promise.all([
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
    `).catch(()=>[]),
    sql.query(`
      SELECT market,COUNT(*)::int AS rows,COUNT(DISTINCT industry_code)::int AS industries,
             COUNT(*) FILTER (WHERE NULLIF(BTRIM(industry_code),'') IS NOT NULL)::int AS industry_code_rows,
             COUNT(*) FILTER (WHERE stock_code !~ '^[0-9]{4}$')::int AS non_standard_code_rows,
             MAX(updated_at) AS last_write
      FROM market_company_profile
      GROUP BY market
      ORDER BY market
    `).catch(()=>[]),
    readCompanyTagCoverage(sql),
    readCreditTradingHealth().catch(e=>({totalRows:0,markets:{},error:String(e?.message||e)}))
  ]);
  const flowDataHealth=await readFlowDataHealth(sql).catch(e=>({readyForAX:false,markets:{},warnings:[String(e?.message||e)],error:String(e?.message||e)}));
  return res.status(200).json({ok:true,status,price,marketHistory,marketActivity,companyProfiles,companyTagCoverage,disposal,creditTrading,flowDataHealth});
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
    if(schedule&&['price','twse','tpex'].includes(action)){
      const marketDay=await yahooTradingDayProbe();
      if(marketDay.ok&&!marketDay.isTradingDay)return res.status(200).json({ok:true,skipped:true,reason:'holiday-no-market-update',marketDay});
    }
    if(action==='fundflow-warm-manual'){
      // Manual warm: explicit Settings POST only and idempotent. First repair only a newest cross-market date gap if present;
      // once both markets and snapshots are aligned, repeated clicks become a cheap DB-only no-op.
      if(String(req.method||'GET').toUpperCase()!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'請從設定頁使用手動更新按鈕'});}
      if(String(req.headers?.['x-stockzone-manual-warm']||'')!=='1')return res.status(403).json({ok:false,error:'缺少手動更新確認標記'});
      const fetchSite=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
      if(fetchSite&&!['same-origin','same-site','none'].includes(fetchSite))return res.status(403).json({ok:false,error:'僅允許同站設定頁觸發'});
      if(!manualFundflowWarmPromise){
        manualFundflowWarmPromise=(async()=>{
          const latestMarketGapRepair=await runLatestMarketGapRepair({sql:getSql()});
          if(!latestMarketGapRepair.ok)return {ok:false,skipped:true,reason:'latest-market-gap-repair-failed',preservedLastGood:true,error:latestMarketGapRepair.error||'最新交易日缺口修補失敗',latestMarketGapRepair};
          const warm=await warmCurrentEngineFromStoredDb({sql:getSql(),force:false});
          return {...warm,noUpstreamFetch:Boolean(warm?.noUpstreamFetch&&!latestMarketGapRepair?.upstreamFetch),latestMarketGapRepair};
        })().finally(()=>{manualFundflowWarmPromise=null});
      }
      const warm=await manualFundflowWarmPromise;
      return res.status(warm.ok?200:503).json({...warm,manual:true});
    }

    if(action==='fundflow-clean-rebuild-manual'){
      // One-time clean XY v2 rebuild from existing raw/reference history. It writes isolated XY2 tables first,
      // verifies clean snapshots/history, then deletes only legacy XY/Path derived rows. Raw histories are never touched.
      if(String(req.method||'GET').toUpperCase()!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'請從設定頁使用重建乾淨 XY 按鈕'});}
      if(String(req.headers?.['x-stockzone-manual-history']||'')!=='1')return res.status(403).json({ok:false,error:'缺少 Clean XY 重建確認標記'});
      const fetchSite=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
      if(fetchSite&&!['same-origin','same-site','none'].includes(fetchSite))return res.status(403).json({ok:false,error:'僅允許同站設定頁觸發'});
      const target=Math.max(25,Math.min(60,Number(req.query?.target)||60));
      if(!manualFundflowHistoryPromise){
        manualFundflowHistoryPromise=backfillCompactFeatureHistory({targetDays:target,sql:getSql()}).finally(()=>{manualFundflowHistoryPromise=null});
      }
      const history=await manualFundflowHistoryPromise;
      return res.status(history.ok?200:503).json({...history,manual:true,targetDays:target});
    }

    if(action==='institutional-backfill-manual'){
      // Development-stage repair button. It fetches only official institutional reports for
      // missing/partial dates inside the most recent target window; it does not rebuild XY.
      if(String(req.method||'GET').toUpperCase()!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'請從設定頁使用法人補齊按鈕'});}
      if(String(req.headers?.['x-stockzone-manual-institutional']||'')!=='1')return res.status(403).json({ok:false,error:'缺少法人補齊確認標記'});
      const fetchSite=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
      if(fetchSite&&!['same-origin','same-site','none'].includes(fetchSite))return res.status(403).json({ok:false,error:'僅允許同站設定頁觸發'});
      const target=Math.max(20,Math.min(60,Number(req.query?.target)||60)),batch=Math.max(1,Math.min(12,Number(req.query?.days)||12));
      if(!manualInstitutionalBackfillPromise){
        manualInstitutionalBackfillPromise=runInstitutionalBackfill({targetTradingDays:target,maxNewDays:batch,maxRunMs:47000,concurrency:3}).finally(()=>{manualInstitutionalBackfillPromise=null});
      }
      const backfill=await manualInstitutionalBackfillPromise;
      return res.status(200).json({...backfill,manual:true,targetTradingDays:target,batchDays:batch});
    }
    if(action==='storage-deep-audit-manual'){
      if(String(req.method||'GET').toUpperCase()!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'請從設定頁使用深度檢查按鈕'});}
      if(String(req.headers?.['x-stockzone-storage-audit']||'')!=='1')return res.status(403).json({ok:false,error:'缺少 Storage 深度稽核確認標記'});
      const fetchSite=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
      if(fetchSite&&!['same-origin','same-site','none'].includes(fetchSite))return res.status(403).json({ok:false,error:'僅允許同站設定頁觸發'});
      const audit=await readDatabaseDeepAudit(getSql());
      return res.status(200).json({...audit,manual:true});
    }
    if(action==='storage-legacy-cleanup-manual'){
      if(String(req.method||'GET').toUpperCase()!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'請從設定頁使用低風險清理按鈕'});}
      if(String(req.headers?.['x-stockzone-storage-legacy-cleanup']||'')!=='1')return res.status(403).json({ok:false,error:'缺少 legacy 清理確認標記'});
      const fetchSite=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
      if(fetchSite&&!['same-origin','same-site','none'].includes(fetchSite))return res.status(403).json({ok:false,error:'僅允許同站設定頁觸發'});
      const cleanup=await runVerifiedLegacyCleanup({sql:getSql(),vacuumCredit:true});
      return res.status(200).json({...cleanup,manual:true});
    }
    if(action==='storage-maintenance-manual'){
      if(String(req.method||'GET').toUpperCase()!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'請從設定頁使用安全整理按鈕'});}
      if(String(req.headers?.['x-stockzone-storage-maintenance']||'')!=='1')return res.status(403).json({ok:false,error:'缺少 Storage 整理確認標記'});
      const fetchSite=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
      if(fetchSite&&!['same-origin','same-site','none'].includes(fetchSite))return res.status(403).json({ok:false,error:'僅允許同站設定頁觸發'});
      const maintenance=await runStorageMaintenance({sql:getSql()});
      return res.status(200).json({...maintenance,manual:true});
    }
    if(action){
      if(!isCronAuthorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});
      let result;
      if(action==='price'){
        result=await runPriceSync({cronSchedule:schedule});
      }
      else if(action==='company-profiles'){
        const profile=await runCompanyProfileSync();
        return res.status(profile.ok?200:502).json(profile);
      }
      else if(action==='business-enrich'){
        const limit=Math.max(1,Math.min(200,Number(req.query?.limit)||(schedule?70:120)));
        const retry=['1','true','yes'].includes(String(req.query?.retry||'').toLowerCase());
        const enriched=await runBusinessEnrichment({limit,retry,maxRunMs:schedule?18000:47000,concurrency:schedule?8:8});
        return res.status(200).json(enriched);
      }
      else if(action==='twse')result=await runTwseDisposalSync();
      else if(action==='tpex')result=await runTpexDisposalSync();
      else if(action==='credit')result=await runCreditTradingSync();
      else if(action==='institutional')result=await runInstitutionalSync();
      else if(action==='institutional-backfill'){
        const target=Math.max(20,Math.min(STORAGE_POLICY.raw.institutional,Number(req.query?.target)||STORAGE_POLICY.raw.institutional));
        const backfill=await runInstitutionalBackfill({targetTradingDays:target,maxNewDays:Math.max(1,Math.min(20,Number(req.query?.days)||12)),maxRunMs:45000,concurrency:3});
        return res.status(200).json(backfill);
      }
      else if(action==='credit-backfill'){
        const target=Math.max(20,Math.min(STORAGE_POLICY.raw.credit,Number(req.query?.target)||STORAGE_POLICY.raw.credit));
        const backfill=await runCreditTradingBackfill({targetTradingDays:target,maxNewDays:Math.max(1,Math.min(20,Number(req.query?.days)||12)),maxRunMs:45000,concurrency:2});
        return res.status(200).json(backfill);
      }
      else if(action==='market-backfill'||action==='market-rebuild'){
        const rebuild=action==='market-rebuild';
        const target=Math.max(20,Math.min(STORAGE_POLICY.raw.price,Number(req.query?.target)||STORAGE_POLICY.raw.price));
        const backfill=await runMarketHistoryBackfill({
          targetTradingDays:target,
          maxNewDays:rebuild?35:12,
          delayMs:rebuild?150:250,
          maxRunMs:rebuild?47000:42000,
          scanCalendarDays:320
        });
        const marketHealth=await readMarketDataHealth(getSql());
        const flowDataHealth=await readFlowDataHealth(getSql());
        return res.status(200).json({ok:true,source:'market_history_backfill',mode:rebuild?'rebuild':'incremental',targetTradingDays:target,backfill,marketHealth,flowDataHealth});
      }
      else return res.status(400).json({ok:false,error:'action 僅支援 fundflow-warm-manual / fundflow-clean-rebuild-manual / institutional-backfill-manual / storage-deep-audit-manual / storage-maintenance-manual / price / company-profiles / business-enrich / twse / tpex / institutional / institutional-backfill / credit / credit-backfill / market-backfill / market-rebuild'});

      if(schedule && ['price','twse','tpex'].includes(action)){
        // v2.6.5.59: keep three cron slots, but bound raw history to the storage policy.
        // Long research is retained as compact topic history rather than 500D raw stock×day tables.
        if(['twse','tpex'].includes(action)){
          if(action==='twse'){
            try{result.body.institutionalTrading=await runInstitutionalSync().then(x=>x.body)}
            catch(e){result.body.institutionalTrading={ok:false,preservedLastGood:true,error:String(e?.message||e)}}
            result.body.creditTrading={ok:true,skipped:true,reason:'latest credit sync assigned to 22:00 cron'};
            try{result.body.institutionalBackfill=await runInstitutionalBackfill({targetTradingDays:STORAGE_POLICY.raw.institutional,maxNewDays:12,maxRunMs:40000,concurrency:3})}
            catch(e){result.body.institutionalBackfill={ok:false,preservedLastGood:true,error:String(e?.message||e)}}
            result.body.creditBackfill={ok:true,skipped:true,reason:`${STORAGE_POLICY.raw.credit}D credit raw target assigned to 22:00 cron`};
          }else{
            try{result.body.creditTrading=await runCreditTradingSync().then(x=>x.body)}
            catch(e){result.body.creditTrading={ok:false,preservedLastGood:true,error:String(e?.message||e)}}
            result.body.institutionalTrading={ok:true,skipped:true,reason:'latest institutional sync assigned to 19:00 cron'};
            try{result.body.creditBackfill=await runCreditTradingBackfill({targetTradingDays:STORAGE_POLICY.raw.credit,maxNewDays:12,maxRunMs:40000,concurrency:2})}
            catch(e){result.body.creditBackfill={ok:false,preservedLastGood:true,error:String(e?.message||e)}}
            result.body.institutionalBackfill={ok:true,skipped:true,reason:`${STORAGE_POLICY.raw.institutional}D institutional raw target assigned to 19:00 cron`};
          }
        }

        // Company master remains cheap/idempotent and is shared by all three slots.
        try{result.body.companyProfiles=await ensureCompanyProfileSync({maxAgeHours:20})}
        catch(e){result.body.companyProfiles={ok:false,error:String(e?.message||e)}}

        if(action==='price'){
          try{result.body.storageMaintenance=await runStorageMaintenance({sql:getSql()})}
          catch(e){result.body.storageMaintenance={ok:false,preservedData:true,error:String(e?.message||e)}}
          try{result.body.marketBootstrap=await runMarketHistoryBackfill({targetTradingDays:STORAGE_POLICY.raw.price,maxNewDays:12,delayMs:100,maxRunMs:35000,scanCalendarDays:320})}
          catch(e){result.body.marketBootstrap={ok:false,error:String(e?.message||e)}}
        }else{
          result.body.marketBootstrap={ok:true,skipped:true,reason:`${STORAGE_POLICY.raw.price}D price raw target assigned to 15:00 cron`};
        }

        // Blind Coverage is a separate paused/legacy concern. Preserve the old
        // auto-run only when the 15:00 price job has no deep-history work left,
        // so research backfill cannot be starved by an unrelated scanner.
        if(action==='price'&&result.body.marketBootstrap?.ok&&Number(result.body.marketBootstrap.newDays||0)===0&&Number(result.body.marketBootstrap.recentCommonTradingDays||0)>=80){
          try{result.body.blindCoverage=await runBusinessEnrichment({limit:70,maxRunMs:12000,concurrency:8})}
          catch(e){result.body.blindCoverage={ok:false,error:String(e?.message||e)}}
        }else result.body.blindCoverage={ok:true,skipped:true,reason:'raw history catch-up has priority'};

        if(action==='tpex'){
          try{result.body.latestMarketGapRepair=await runLatestMarketGapRepair({sql:getSql()})}
          catch(e){result.body.latestMarketGapRepair={ok:false,preservedLastGood:true,error:String(e?.message||e)}}
          if(result.body.latestMarketGapRepair?.ok){
            try{result.body.compactResearch=await warmCurrentEngineFromStoredDb({sql:getSql(),force:false})}
            catch(e){result.body.compactResearch={ok:false,preservedLastGood:true,error:String(e?.message||e)}}
          }else{
            result.body.compactResearch={ok:false,skipped:true,preservedLastGood:true,reason:'latest-market-gap-repair-failed'};
          }
        }
        try{result.body.flowDataHealth=await readFlowDataHealth(getSql())}
        catch(e){result.body.flowDataHealth={liveReady:false,coreRawReady:false,researchReady250:false,backtestReady250:false,researchReady500:false,error:String(e?.message||e)}}
      }
      return res.status(result.httpStatus).json(result.body);
    }

    return await statusResponse(req,res);
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
};

module.exports._test={requestedAction,CRON_ACTIONS,misNumber,misTradeDate,marketDateAlignment};
