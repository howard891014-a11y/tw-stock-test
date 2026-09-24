const { getSql } = require('../lib/db');
const { isCronAuthorized, ensureMarketHistorySchema, ensureCompanyProfileSchema } = require('../lib/sync-common');
const { runPriceSync, runCompanyProfileSync, ensureCompanyProfileSync, runTwseDisposalSync, runTpexDisposalSync, runMarketHistoryBackfill } = require('../lib/sync-service');
const { summarizeProfiles } = require('../lib/company-business-tags');
const { getFundflowSnapshot, getFundflowDetail, getFundflowBusinessBrowser } = require('../lib/fundflow-xy');
const { runBusinessEnrichment, readPendingBusinessEnrichment } = require('../lib/business-enrichment');


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


async function readCompanyTagCoverage(sql){
  const profiles=await sql.query(`
    SELECT stock_code AS symbol,stock_name AS name,market,industry_code,industry,auto_business_tags,main_business,business_enrich_status,business_enrich_checked_at
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
  return{
    profileRows:profiles.length,...summary,
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

  if(view==='fundflow-detail'){
    res.setHeader('Cache-Control','public, s-maxage=90, stale-while-revalidate=180');
    const days=Math.max(5,Math.min(15,Number(req.query?.days)||10));
    const tagId=String(req.query?.tag||req.query?.tagId||'').trim();
    if(!tagId||!/^[a-z0-9_-]{2,80}$/i.test(tagId))return res.status(400).json({ok:false,error:'業務 tag 格式錯誤'});
    const data=await getFundflowDetail({tagId,days});
    return res.status(200).json(data);
  }

  if(view==='tech-pending'){
    res.setHeader('Cache-Control','no-store');
    const limit=Math.max(1,Math.min(500,Number(req.query?.limit)||200));
    const data=await readPendingBusinessEnrichment({limit});
    return res.status(200).json({...data,view:'tech-pending'});
  }

  if(view==='market-health'){
    const marketHealth=await readMarketDataHealth(sql);
    return res.status(200).json({ok:true,view:'market-health',marketHealth});
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

  const [status,price,disposal,marketHistory,marketActivity,companyProfiles,companyTagCoverage]=await Promise.all([
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
    readCompanyTagCoverage(sql)
  ]);
  return res.status(200).json({ok:true,status,price,marketHistory,marketActivity,companyProfiles,companyTagCoverage,disposal});
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
      if(action==='price'){
        result=await runPriceSync({cronSchedule:schedule});
      }
      else if(action==='company-profiles'){
        const profile=await runCompanyProfileSync();
        return res.status(profile.ok?200:502).json(profile);
      }
      else if(action==='business-enrich'){
        const limit=Math.max(1,Math.min(50,Number(req.query?.limit)||30));
        const retry=['1','true','yes'].includes(String(req.query?.retry||'').toLowerCase());
        const enriched=await runBusinessEnrichment({limit,retry});
        return res.status(200).json(enriched);
      }
      else if(action==='twse')result=await runTwseDisposalSync();
      else if(action==='tpex')result=await runTpexDisposalSync();
      else if(action==='market-backfill'||action==='market-rebuild'){
        const rebuild=action==='market-rebuild';
        const backfill=await runMarketHistoryBackfill({
          targetTradingDays:80,
          maxNewDays:rebuild?35:12,
          delayMs:rebuild?150:350,
          maxRunMs:rebuild?47000:42000,
          scanCalendarDays:180
        });
        const marketHealth=await readMarketDataHealth(getSql());
        return res.status(200).json({ok:true,source:'market_history_backfill',mode:rebuild?'rebuild':'incremental',backfill,marketHealth});
      }
      else return res.status(400).json({ok:false,error:'action 僅支援 price / company-profiles / business-enrich / twse / tpex / market-backfill / market-rebuild'});

      if(schedule && ['price','twse','tpex'].includes(action)){
        // v2.6.2.15：三個既有 Cron 都只「檢查」公司基本資料。
        // 空表、前次失敗或超過 20 小時才同步；當天已成功時 19:00 / 22:00 直接跳過。
        try{result.body.companyProfiles=await ensureCompanyProfileSync({maxAgeHours:20})}
        catch(e){result.body.companyProfiles={ok:false,error:String(e?.message||e)}}
        try{result.body.marketBootstrap=await runMarketHistoryBackfill({targetTradingDays:80,maxNewDays:10,delayMs:350,maxRunMs:40000,scanCalendarDays:180})}
        catch(e){result.body.marketBootstrap={ok:false,error:String(e?.message||e)}}
      }
      return res.status(result.httpStatus).json(result.body);
    }

    return await statusResponse(req,res);
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
};

module.exports._test={requestedAction,CRON_ACTIONS,misNumber,misTradeDate,marketDateAlignment};
