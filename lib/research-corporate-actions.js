'use strict';
/**
 * StockZone 400D corporate action repair (2025-02-25 onward).
 * Official event source scan -> selective original close-price snapshots ->
 * strict independent reproduction of pre-adjustment industry labels ->
 * audited, resumable Y/return1 correction with original-value backup.
 * Price-continuity adjusted return, NOT shareholder total return. Cash rights
 * offering must be independently reviewed before changing any live label.
 */
const {getSql}=require('./db');
const {fetchTwseHistoricalRows,fetchTpexHistoricalRows}=require('./sync-service');
const START='2025-02-25',END='2026-10-14',EVENT_START='2025-02-01';
const iso=x=>x instanceof Date?x.toISOString().slice(0,10):String(x??'').slice(0,10);
const clean=x=>String(x??'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/,/g,'').trim();
const number=x=>{const s=clean(x);if(!s||['--','-','X','除權息'].includes(s))return null;const n=Number(s);return Number.isFinite(n)?n:null};
function calendarDate(x){const s=clean(x);let m=s.match(/^(\d{2,4})[年/\-](\d{1,2})[月/\-](\d{1,2})/);if(!m){m=s.match(/^(\d{3})(\d{2})(\d{2})$/);if(!m){m=s.match(/^(\d{4})(\d{2})(\d{2})$/)}}if(!m)return '';const y=Number(m[1]);return `${y<1911?y+1911:y}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;}
function field(row,fields,...names){const idx=fields.findIndex(f=>names.some(n=>clean(f).replace(/\s/g,'').includes(n)));return idx<0?null:row[idx]}
function normalizeOfficialAction(row,fields,market,kind,source){
 const d=calendarDate(field(row,fields,'資料日期','除權息日期','恢復買賣日期','恢復交易日期','變更股票面額日期')??row[0]);
 const code=clean(field(row,fields,'股票代號','代號','證券代號')??row[1]).replace(/[^\d]/g,'');
 const old=number(field(row,fields,'除權息前收盤價','前一日收盤價','停止買賣前收盤價格','停止買賣前收盤價')??row[3]);
 const ref=number(field(row,fields,'除權息參考價','恢復買賣參考價','恢復交易參考價')??row[4]);
 if(!d||!/^[0-9]{4}$/.test(code)||!(old>0)||!(ref>0))return null;
 const officialType=field(row,fields,'權/息','權或息','減資原因','種類','分割類型');
 const type=clean(officialType??(kind==='ex'?'權/息':kind));
 const isOffering=/現金增資|現增|認購/.test(type)||number(field(row,fields,'現金增資認購價'))>0||number(field(row,fields,'現金增資配股率'))>0;
 // TWT49U reports 權 but may omit the cash-subscription split; only pure
 // cash dividend can be automatically classified with this result table.
 const ambiguousRights=kind==='ex'&&/權/.test(type)&&!(/^[\s]*息[\s]*$/.test(type));
 const isReduction=kind==='reduction'||/減資/.test(type),isSplit=kind==='split';
 return {trade_date:d,stock_code:code,market,kind:isReduction?'reduction':isSplit?'split':isOffering?'rights_offering':'ex_rights',source,
  old_close:old,reference_close:ref,note:type,type_confirmed:officialType!==null&&clean(officialType)!=='',requires_review:isReduction||isSplit||isOffering||ambiguousRights,
  // A reference price can normalize a chart discontinuity, but corporate
  // actions entailing external cash/share exchange must never auto-apply.
  trusted_basic:!isReduction&&!isSplit&&!isOffering&&!ambiguousRights};
}
function normalizeTpexExRow(row){if(!Array.isArray(row)||row.length<5)return null;return normalizeOfficialAction(row,['除權息日期','代號','名稱','除權息前收盤價','除權息參考價','權值','息值','權值+息值','權/息','漲停價','跌停價','開始交易基準價','減除股利參考價','現金股利','每仟股無償配股','現金增資股數','現金增資認購價'], '上櫃','ex','TPEx exDailyQ');}
async function jsonFetch(url,{fetcher=globalThis.fetch}={}){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),17000);
 try{const res=await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; StockZone research/1)','Accept':'application/json,*/*'},signal:c.signal});if(!res.ok)throw Error(`HTTP ${res.status}`);const raw=await res.json();if(!raw||typeof raw!=='object')throw Error('invalid JSON body');return raw;}
 finally{clearTimeout(timer)}
}
function rocDate(d){const [y,m,dd]=d.split('-');return `${+y-1911}/${m}/${dd}`;}
function stripYYYY(d){return d.replace(/-/g,'');}
function parseListed(raw,market,kind,source){
 const f=raw?.fields;
 if(!Array.isArray(f)||!Array.isArray(raw?.data)){
  if(raw?.stat&&/查無|沒有|not found|none|無資料/i.test(String(raw.stat)))return [];
  throw Error(`official-schema-invalid:${source}:${String(raw?.stat||'no fields').slice(0,100)}`);
 }
 const entries=raw.data.map(row=>normalizeOfficialAction(row,f,market,kind,source)).filter(Boolean);
 if(raw.data.length&&entries.length===0)throw Error(`official-all-rows-rejected:${source}`);
 return entries;
}
function parseTpex(raw,kind,source){
 const arr=raw?.aaData??raw?.data;
 if(!Array.isArray(arr))throw Error(`official-schema-invalid:${source}`);
 if(!arr.length)return [];
 const names=kind==='ex'?null:(raw.fields??[]);
 const records=arr.map(row=>kind==='ex'?normalizeTpexExRow(row):normalizeOfficialAction(row,names.length?names:['恢復買賣日期','股票代號','名稱','停止買賣前收盤價','恢復買賣參考價'], '上櫃',kind,source)).filter(Boolean);
 if(!records.length)throw Error(`official-all-rows-rejected:${source}`);
 return records;
}
// Five separate official coverages are required. Never infer that an upstream
// HTTP error, schema change or blocked request means "no corporate action".
const OFFICIAL_SOURCE_NAMES=Object.freeze(['TWSE TWT49U','TWSE TWTAUU','TWSE TWTB8U','TPEx exDailyQ','TPEx revivt']);
async function fetchOfficialMonth(month,{fetcher=globalThis.fetch,onlySources=OFFICIAL_SOURCE_NAMES,eventStart=EVENT_START,eventEnd=END}={}){
 const first=`${month}-01`,end=new Date(`${month}-01T00:00:00Z`);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);const last=end.toISOString().slice(0,10);
 // A still-open month must not ask TWSE/TPEx for dates beyond the scan day.
 // This only changes the request boundary, not normalization or event rules.
 const queryEnd=eventEnd<last?eventEnd:last;
 const st=stripYYYY(first),en=stripYYYY(queryEnd),roc1=rocDate(first),roc2=rocDate(queryEnd);
 const sources=[
  ['TWSE TWT49U',`https://www.twse.com.tw/rwd/zh/exRight/TWT49U?startDate=${st}&endDate=${en}&response=json`,r=>parseListed(r,'上市','ex','TWSE TWT49U')],
  ['TWSE TWTAUU',`https://www.twse.com.tw/exchangeReport/TWTAUU?response=json&strDate=${st}&endDate=${en}`,r=>parseListed(r,'上市','reduction','TWSE TWTAUU')],
  ['TWSE TWTB8U',`https://www.twse.com.tw/exchangeReport/TWTB8U?response=json&strDate=${st}&endDate=${en}`,r=>parseListed(r,'上市','split','TWSE TWTB8U')],
  ['TPEx exDailyQ',`https://www.tpex.org.tw/web/stock/exright/dailyquo/exDailyQ_result.php?l=zh-tw&d=${encodeURIComponent(roc1)}&ed=${encodeURIComponent(roc2)}`,r=>parseTpex(r,'ex','TPEx exDailyQ')],
  ['TPEx revivt',`https://www.tpex.org.tw/web/stock/exright/revivt/revivt_result.php?l=zh-tw&d=${encodeURIComponent(roc1)}&ed=${encodeURIComponent(roc2)}&s=0,asc,0`,r=>parseTpex(r,'reduction','TPEx revivt')]
 ];
 const requested=new Set(onlySources);
 if(requested.size!==onlySources.length || [...requested].some(x=>!OFFICIAL_SOURCE_NAMES.includes(x)))throw Error('unknown-official-source');
 const selected=sources.filter(([name])=>requested.has(name));
 // Keep successful source results even when another official source fails.
 // They are persisted separately; the entire month is NOT certified until all
 // five independent sources are present and individually schema-validated.
 const results=await Promise.allSettled(selected.map(async([name,url,parse])=>{
  const records=parse(await jsonFetch(url,{fetcher}));
  if(records.some(r=>r.trade_date<first||r.trade_date>last))throw Error(`official-month-range-mismatch:${name}:${month}`);
  return{name,records};
 }));
 const errors=results.map((r,i)=>r.status==='rejected'?`${selected[i][0]}: ${String(r.reason?.message||r.reason)}`:null).filter(Boolean);
 const sourceReports=results.filter(r=>r.status==='fulfilled').map(r=>({name:r.value.name,rows:r.value.records.length,actions:r.value.records.filter(a=>a.trade_date>=eventStart&&a.trade_date<=eventEnd)}));
 const actions=sourceReports.flatMap(r=>r.actions);
 return{ok:errors.length===0,month,errors,actions,sources:sourceReports.map(r=>({name:r.name,rows:r.rows})),sourceReports};
}
async function ensureTables(sql){
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_month(month text PRIMARY KEY,scanned_at timestamptz NOT NULL DEFAULT NOW(),sources jsonb NOT NULL DEFAULT '[]')`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_source_month(month text NOT NULL,source text NOT NULL,rows integer NOT NULL,actions jsonb NOT NULL,checked_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(month,source))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_event(trade_date date NOT NULL,stock_code text NOT NULL,market text NOT NULL,kind text NOT NULL,source text NOT NULL,old_close numeric NOT NULL,reference_close numeric NOT NULL,requires_review boolean NOT NULL DEFAULT false,trusted_basic boolean NOT NULL DEFAULT false,note text,created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(trade_date,stock_code,market,kind))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_price_cache(trade_date date NOT NULL,stock_code text NOT NULL,market text NOT NULL,close_price numeric NOT NULL,PRIMARY KEY(trade_date,stock_code,market))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_price_done(trade_date date PRIMARY KEY,row_count integer NOT NULL,checked_at timestamptz NOT NULL DEFAULT NOW())`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_backup(trade_date date NOT NULL,tag_id text NOT NULL,old_return_1_pct numeric,old_y_score numeric,backed_up_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(trade_date,tag_id))`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_checked(trade_date date PRIMARY KEY,changed_rows integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT NOW())`);
 await sql.query(`CREATE TABLE IF NOT EXISTS market_research500_action_blocked(trade_date date PRIMARY KEY,reason text NOT NULL,details jsonb NOT NULL DEFAULT '[]',updated_at timestamptz NOT NULL DEFAULT NOW())`);
}
function monthsBetween(start=START,end=END){const a=[];for(let m=start.slice(0,7);m<=end.slice(0,7);){a.push(m);const d=new Date(`${m}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7);}return a;}
async function actionStatus(sql=getSql()){
 const months=monthsBetween(),found=await sql.query(`SELECT month FROM market_research500_action_month`).catch(()=>[]),done=new Set(found.map(x=>x.month));
 const [summaries,checked]=await Promise.all([
  sql.query(`SELECT kind,COUNT(*)::int n,COUNT(DISTINCT stock_code)::int stocks FROM market_research500_action_event GROUP BY kind ORDER BY kind`).catch(()=>[]),
  sql.query(`SELECT COUNT(*)::int n,COALESCE(SUM(changed_rows),0)::int rows FROM market_research500_action_checked`).catch(()=>[])
 ]);
 return {scopeStart:START,scopeEnd:END,months:months.length,completedMonths:months.filter(m=>done.has(m)).length,nextMonth:months.find(m=>!done.has(m))||null,scanComplete:months.every(m=>done.has(m)),events:summaries,checkedDays:Number(checked[0]?.n||0),updatedRows:Number(checked[0]?.rows||0), excluded:['car_rental'],label:'price-continuity-not-total-return'};
}
async function scanNextMonth({sql=getSql(),fetchMonth=fetchOfficialMonth}={}){
 await ensureTables(sql);const state=await actionStatus(sql);if(state.scanComplete)return {ok:true,phase:'scan',complete:true,status:state};
 const month=state.nextMonth;
 const cached=await sql.query(`SELECT source,rows,actions FROM market_research500_action_source_month WHERE month=$1`,[month]);
 const have=new Set(cached.map(r=>r.source));
 const missing=OFFICIAL_SOURCE_NAMES.filter(name=>!have.has(name));
 if(missing.length){
  const report=await fetchMonth(month,{onlySources:missing});
  // A valid source is checkpointed even if another source failed. These rows
  // are not market research labels and do not certify the full month.
  for(const src of report.sourceReports||[]){
   if(!missing.includes(src.name))continue;
   await sql.query(`INSERT INTO market_research500_action_source_month(month,source,rows,actions) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT (month,source) DO NOTHING`,[month,src.name,src.rows,JSON.stringify(src.actions)]);
  }
  if(!report.ok){
   const successful=await sql.query(`SELECT source FROM market_research500_action_source_month WHERE month=$1`,[month]);
   return{ok:false,phase:'scan',noResearchWrites:true,month,errors:report.errors||[],validatedSources:successful.map(r=>r.source),pendingSources:OFFICIAL_SOURCE_NAMES.filter(n=>!successful.some(r=>r.source===n)),completedSources:successful.length,requiredSources:OFFICIAL_SOURCE_NAMES.length};
  }
 }
 const accepted=await sql.query(`SELECT source,rows,actions FROM market_research500_action_source_month WHERE month=$1`,[month]);
 const acceptedNames=new Set(accepted.map(r=>r.source));
 if(OFFICIAL_SOURCE_NAMES.some(n=>!acceptedNames.has(n))){
  return{ok:false,phase:'scan',noResearchWrites:true,month,errors:['official-month-sources-incomplete'],completedSources:accepted.length,requiredSources:OFFICIAL_SOURCE_NAMES.length};
 }
 const actionsRaw=accepted.flatMap(r=>Array.isArray(r.actions)?r.actions:JSON.parse(r.actions));
 const member=await sql.query(`SELECT DISTINCT stock_code,market FROM market_business_xy2_member WHERE tag_id<>'car_rental'`);
 const allowed=new Set(member.map(x=>`${x.market}|${x.stock_code}`));
 const actions=actionsRaw.filter(x=>allowed.has(`${x.market}|${x.stock_code}`));
 // No definitive type is assumed when two official event types overlap.
 const pairs=new Map();for(const a of actions){const k=`${a.trade_date}/${a.market}/${a.stock_code}`;pairs.set(k,(pairs.get(k)||0)+1)}
 for(const a of actions)if(pairs.get(`${a.trade_date}/${a.market}/${a.stock_code}`)>1){a.requires_review=true;a.trusted_basic=false;a.note+='; overlapped company actions';}
 if(actions.length){await sql.query(`WITH x AS(SELECT * FROM jsonb_to_recordset($1::jsonb) AS d(trade_date date,stock_code text,market text,kind text,source text,old_close numeric,reference_close numeric,requires_review boolean,trusted_basic boolean,note text)) INSERT INTO market_research500_action_event(trade_date,stock_code,market,kind,source,old_close,reference_close,requires_review,trusted_basic,note) SELECT trade_date,stock_code,market,kind,source,old_close,reference_close,requires_review,trusted_basic,note FROM x ON CONFLICT (trade_date,stock_code,market,kind) DO UPDATE SET source=EXCLUDED.source,old_close=EXCLUDED.old_close,reference_close=EXCLUDED.reference_close,requires_review=EXCLUDED.requires_review,trusted_basic=EXCLUDED.trusted_basic,note=EXCLUDED.note`,[JSON.stringify(actions)]);}
 const sources=accepted.map(r=>({name:r.source,rows:Number(r.rows)}));
 await sql.query(`INSERT INTO market_research500_action_month(month,sources) VALUES($1,$2::jsonb) ON CONFLICT (month) DO NOTHING`,[month,JSON.stringify(sources)]);
 return{ok:true,phase:'scan',month,rawSources:sources,scopeActions:actions.length,reviewNeeded:actions.filter(a=>a.requires_review).length,status:await actionStatus(sql)};
}
function planAffectedDates(allDates,events){
 const index=new Map(allDates.map((d,i)=>[d,i])),impacted=new Map();
 for(const e of events){const at=index.get(iso(e.trade_date));if(at===undefined)continue;for(let i=0;i<5;i++){const d=allDates[at+i];if(!d||d<START||d>END)continue;const k=`${e.market}|${e.stock_code}`;if(!impacted.has(d))impacted.set(d,new Set());impacted.get(d).add(k)}}
 return impacted;
}
async function statusWithDates(sql=getSql()){
 const state=await actionStatus(sql);
 if(!state.scanComplete)return {...state,remainingDates:null};
 const [r,events,completed,blocked]=await Promise.all([
  sql.query(`SELECT DISTINCT trade_date::text d FROM market_business_xy2_research_daily ORDER BY d`),
  sql.query(`SELECT trade_date::text trade_date,stock_code,market,kind,requires_review,old_close,reference_close FROM market_research500_action_event`),
  sql.query(`SELECT trade_date::text d FROM market_research500_action_checked`),
  sql.query(`SELECT trade_date::text d FROM market_research500_action_blocked`)
 ]);
 const plan=planAffectedDates(r.map(x=>iso(x.d)),events),checked=new Set(completed.map(x=>iso(x.d))),suspended=new Set(blocked.map(x=>iso(x.d))),pending=[...plan.keys()].sort().filter(d=>!checked.has(d)),actionable=pending.filter(d=>!suspended.has(d));
 return {...state,affectedDays:plan.size,remainingDates:pending.length,actionableDays:actionable.length,blockedDays:pending.length-actionable.length,nextDate:actionable[0]||null,eventsReview:events.filter(e=>e.requires_review).length};
}
async function readPriceDay(sql,day,{fetchPrices=[fetchTwseHistoricalRows,fetchTpexHistoricalRows]}={}){
 const done=await sql.query(`SELECT row_count FROM market_research500_action_price_done WHERE trade_date=$1::date`,[day]);
 if(done.length)return{day,cache:true,rows:Number(done[0].row_count)};
 // Existing operating RAW may be reused without network or duplication.
 const raw=await sql.query(`SELECT stock_code,market,close_price FROM market_daily_history WHERE trade_date=$1::date AND close_price>0`,[day]);
 let rows=raw,source='neon-120d';
 const m=new Set(raw.map(r=>r.market));
 if(m.size!==2||rows.length<1200){
  const [twse,tpex]=await Promise.all(fetchPrices.map(f=>f(day)));
  if(twse?.nonTrading||tpex?.nonTrading)throw Error(`official-price-date-not-trading:${day}`);
  if((twse?.rows||[]).length<300||(tpex?.rows||[]).length<200)throw Error(`official-price-insufficient:${day}`);
  rows=[...twse.rows,...tpex.rows];source='official-prices';
 }
 const allowed=await sql.query(`SELECT DISTINCT stock_code,market FROM market_business_xy2_member WHERE tag_id<>'car_rental'`);
 const valid=new Set(allowed.map(x=>`${x.market}|${x.stock_code}`));
 const data=rows.filter(r=>valid.has(`${r.market}|${r.stock_code}`)&&Number(r.close_price)>0).map(r=>({trade_date:day,stock_code:String(r.stock_code),market:r.market,close_price:Number(r.close_price)}));
 if(data.length<950)throw Error(`action-price-member-coverage-low:${day}:${data.length}`);
 await sql.query(`WITH x AS(SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(trade_date date,stock_code text,market text,close_price numeric)) INSERT INTO market_research500_action_price_cache SELECT * FROM x ON CONFLICT DO NOTHING`,[JSON.stringify(data)]);
 await sql.query(`INSERT INTO market_research500_action_price_done(trade_date,row_count) VALUES($1,$2) ON CONFLICT DO NOTHING`,[day,data.length]);
 return{day,rows:data.length,source};
}
function priceReturn(close,prior,events){if(!(close>0&&prior>0))return null;let ratio=close/prior;for(const e of events){if(!(e.old_close>0&&e.reference_close>0))return null;ratio*=e.old_close/e.reference_close}return 100*(ratio-1)}
function weighted(items,key){let numerator=0,denominator=0;for(const x of items){const n=x[key],w=Number(x.weight);if(n===null||!Number.isFinite(n)||!(w>0))continue;numerator+=w*n;denominator+=w}return denominator?numerator/denominator:null;}
/** Independent pure logic, injected with mock prices in tests. */
function reconstructTagDay({day,previousDay,dayMinus5,events,prices,memberRows}){
 const find=(d,stock)=>prices.get(`${d}/${stock.market}/${stock.stock_code}`);
 const items=memberRows.map(m=>{
  const cur=find(day,m),prev1=find(previousDay,m),prev5=find(dayMinus5,m);
  const e1=events.filter(e=>e.market===m.market&&e.stock_code===m.stock_code&&e.trade_date===day);
  const e5=events.filter(e=>e.market===m.market&&e.stock_code===m.stock_code&&e.trade_date>dayMinus5&&e.trade_date<=day);
  return {...m,r1:cur>0&&prev1>0?100*(cur/prev1-1):null,r5:cur>0&&prev5>0?100*(cur/prev5-1):null,
    fixed1:cur>0&&prev1>0?priceReturn(cur,prev1,e1):null,
    fixed5:cur>0&&prev5>0?priceReturn(cur,prev5,e5):null};
 });
 return{old1:weighted(items,'r1'),old5:weighted(items,'r5'),new1:weighted(items,'fixed1'),new5:weighted(items,'fixed5'),valid1:items.filter(x=>x.r1!==null).length,valid5:items.filter(x=>x.r5!==null).length,total:items.length};
}
async function processNextDate({sql=getSql(),fetchPrices,apply=false}={}){
 await ensureTables(sql);
 const status=await statusWithDates(sql);
 if(!status.scanComplete)return{ok:false,reason:'official-event-months-incomplete',status};
 if(!status.remainingDates)return{ok:true,complete:true,status,phase:'done'};
 if(!status.nextDate)return{ok:true,complete:false,phase:'waiting-review',status};
 const d=status.nextDate;
 const allDates=(await sql.query('SELECT DISTINCT trade_date::text d FROM market_business_xy2_research_daily ORDER BY d')).map(x=>iso(x.d)),at=allDates.indexOf(d);
 if(at<5)throw Error(`research-warmup-calendar-missing:${d}`);
 const prev1=allDates[at-1],prev5=allDates[at-5];
 const allEvents=(await sql.query(`SELECT trade_date::text trade_date,stock_code,market,kind,requires_review,old_close::float8 old_close,reference_close::float8 reference_close FROM market_research500_action_event WHERE trade_date>$1::date AND trade_date<=$2::date`,[prev5,d])).map(r=>({...r,trade_date:iso(r.trade_date)}));
 // A cash offering/reduction/split requires independent share-ratio review,
 // and these events invalidate any affected stock labels for a 5D window.
 if(allEvents.some(e=>e.requires_review)){
  const flagged=allEvents.filter(e=>e.requires_review).map(e=>({date:e.trade_date,stock:e.stock_code,kind:e.kind}));
  if(apply)await sql.query(`INSERT INTO market_research500_action_blocked(trade_date,reason,details) VALUES($1,'nontrivial-corporate-action-awaits-official-ratio-review',$2::jsonb) ON CONFLICT(trade_date) DO UPDATE SET details=EXCLUDED.details,updated_at=NOW()`,[d,JSON.stringify(flagged)]);
  return{ok:!(!apply),phase:'waiting-review',reason:'nontrivial-corporate-action-requires-manual-review',date:d,blockedEvents:flagged,noResearchWrites:true,status:apply?await statusWithDates(sql):status};
 }
 const membership=await sql.query(`SELECT tag_id,market,stock_code,weight::float8 weight FROM market_business_xy2_member WHERE tag_id<>'car_rental'`);
 const affectedStocks=new Set(allEvents.map(e=>`${e.market}|${e.stock_code}`)),affectedTags=new Set(membership.filter(m=>affectedStocks.has(`${m.market}|${m.stock_code}`)).map(m=>m.tag_id));
 if(!affectedTags.size){await sql.query(`INSERT INTO market_research500_action_checked(trade_date,changed_rows) VALUES($1,0) ON CONFLICT DO NOTHING`,[d]);return{ok:true,date:d,phase:'skip-no-active-tags',status:await statusWithDates(sql)};}
 const eventPriorDays=allEvents.map(e=>{const pos=allDates.indexOf(iso(e.trade_date));return pos>0?allDates[pos-1]:null}).filter(Boolean);
 const requiredDates=[...new Set([d,prev1,prev5,...eventPriorDays])];
 const sourceDays=[];for(const date of requiredDates)sourceDays.push(await readPriceDay(sql,date,{fetchPrices}));
 const pricesRows=await sql.query(`SELECT trade_date::text trade_date,market,stock_code,close_price::float8 close_price FROM market_research500_action_price_cache WHERE trade_date=ANY($1::date[])`,[requiredDates]);
 const prices=new Map(pricesRows.map(r=>[`${iso(r.trade_date)}/${r.market}/${r.stock_code}`,Number(r.close_price)]));
 const badReferences=[];for(const e of allEvents){
  const pos=allDates.indexOf(iso(e.trade_date)),prev=pos>0?allDates[pos-1]:null;
  const px=prev?prices.get(`${prev}/${e.market}/${e.stock_code}`):null;
  // Exchange reference is not the immediately previous day's unadjusted price
  // if a security was halted. Never normalize using such a pair.
  if(!(px>0)||Math.abs(px-Number(e.old_close))>Math.max(0.3,Math.abs(Number(e.old_close))*.005))
   badReferences.push({stock:e.stock_code,eventDate:e.trade_date,reportedPrevious:e.old_close,priorTradingPrice:px??null});
 }
 if(badReferences.length){
  if(apply)await sql.query(`INSERT INTO market_research500_action_blocked(trade_date,reason,details) VALUES($1,'official-prior-close-mismatch',$2::jsonb) ON CONFLICT(trade_date) DO UPDATE SET details=EXCLUDED.details,updated_at=NOW()`,[d,JSON.stringify(badReferences)]);
  return{ok:!(!apply),date:d,phase:'waiting-review',reason:'official-prior-close-mismatch',blocked:badReferences,noResearchWrites:true,status:apply?await statusWithDates(sql):status};
 }
 const stored=await sql.query(`SELECT r.tag_id,r.return_1_pct::float8 r1,r.y_score::float8 y5, b.old_return_1_pct::float8 backup_r1,b.old_y_score::float8 backup_y5 FROM market_business_xy2_research_daily r LEFT JOIN market_research500_action_backup b ON b.trade_date=r.trade_date AND b.tag_id=r.tag_id WHERE r.trade_date=$1::date AND r.tag_id=ANY($2::text[])`,[d,[...affectedTags]]);
 const baseline=new Map(stored.map(r=>[r.tag_id,r]));
 const candidates=[];const blocked=[];
 for(const tag of affectedTags){const old=baseline.get(tag);if(!old){blocked.push({tag,reason:'stored-label-missing'});continue;}
  const calc=reconstructTagDay({day:d,previousDay:prev1,dayMinus5:prev5,events:allEvents,prices,memberRows:membership.filter(m=>m.tag_id===tag)});
  if(calc.new1===null||calc.new5===null||calc.valid1<Math.ceil(calc.total*.9)||calc.valid5<Math.ceil(calc.total*.9)){
   blocked.push({tag,reason:'stock-price-coverage-insufficient',valid1:calc.valid1,valid5:calc.valid5,total:calc.total});continue;
  }
  const delta1=calc.new1-calc.old1,delta5=calc.new5-calc.old5;
  // STRICT: on history that pre-existed corporate-action correction, old labels
  // must reproduce BEFORE adding a computed delta. We compare the raw
  // reconstruction to the stored baseline, not the adjusted value.
  const originalR=old.backup_r1??old.r1,originalY=old.backup_y5??old.y5;
  if(Math.abs(calc.old1-originalR)>.35||Math.abs(calc.old5-originalY)>.35){blocked.push({tag,reason:'historical-raw-label-mismatch',raw1:calc.old1,stored1:originalR,raw5:calc.old5,stored5:originalY});continue}
  const newR=originalR+delta1,newY=originalY+delta5;
  const alreadyApplied=Math.abs(old.r1-newR)<.0001&&Math.abs(old.y5-newY)<.0001;
  if(!alreadyApplied&&(Math.abs(old.r1-originalR)>.0001||Math.abs(old.y5-originalY)>.0001)){blocked.push({tag,reason:'current-value-unexpected-concurrent-write'});continue;}
  candidates.push({trade_date:d,tag_id:tag,old_r:originalR,old_y:originalY,new_r:newR,new_y:newY,delta1,delta5,alreadyApplied});
 }
 if(blocked.length){
  if(apply)await sql.query(`INSERT INTO market_research500_action_blocked(trade_date,reason,details) VALUES($1,'reproduction-or-coverage-blocked',$2::jsonb) ON CONFLICT(trade_date) DO UPDATE SET details=EXCLUDED.details,updated_at=NOW()`,[d,JSON.stringify(blocked.slice(0,30))]);
  return{ok:!(!apply),phase:'waiting-review',reason:'reproduction-or-coverage-blocked',date:d,blocked:blocked.slice(0,12),candidateCount:candidates.length,sourceDays,noResearchWrites:true,status:apply?await statusWithDates(sql):status};
 }
 if(!apply)return{ok:true,phase:'preview',date:d,readyCount:candidates.length,changed1:candidates.filter(x=>Math.abs(x.delta1)>.01).length,changed5:candidates.filter(x=>Math.abs(x.delta5)>.01).length,maxAbsYCorrection:Math.max(0,...candidates.map(x=>Math.abs(x.delta5))),sourceDays,preview:candidates.filter(x=>Math.abs(x.delta1)>.01||Math.abs(x.delta5)>.01).slice(0,7),noResearchWrites:true};
 // Idempotent check prevents applying original correction delta twice if client
 // retries after a network disconnect; the backup is written BEFORE mutation.
 const data=candidates.filter(x=>!x.alreadyApplied&&(Math.abs(x.delta1)>.001||Math.abs(x.delta5)>.001));
 await sql.query(`INSERT INTO market_research500_action_backup(trade_date,tag_id,old_return_1_pct,old_y_score)
 SELECT trade_date,tag_id,return_1_pct,y_score FROM market_business_xy2_research_daily WHERE trade_date=$1::date AND tag_id=ANY($2::text[]) ON CONFLICT DO NOTHING`,[d,[...affectedTags]]);
 const wrote=data.length?await sql.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(trade_date date,tag_id text,old_r numeric,old_y numeric,new_r numeric,new_y numeric)) UPDATE market_business_xy2_research_daily y SET return_1_pct=ROUND(x.new_r,10),y_score=ROUND(x.new_y,4),updated_at=NOW() FROM x WHERE y.trade_date=x.trade_date AND y.tag_id=x.tag_id AND ABS(y.return_1_pct-x.old_r)<0.0000001 AND ABS(y.y_score-x.old_y)<0.0000001 RETURNING y.tag_id`,[JSON.stringify(data.map(({trade_date,tag_id,old_r,old_y,new_r,new_y})=>({trade_date,tag_id,old_r,old_y,new_r,new_y}))) ]):[];
 if(wrote.length!==data.length)throw Error(`concurrent-research-label-change:${d}:${wrote.length}/${data.length}`);
 await sql.query(`INSERT INTO market_research500_action_checked(trade_date,changed_rows) VALUES($1,$2) ON CONFLICT DO NOTHING`,[d,wrote.length]);
 return{ok:true,phase:'corrected',date:d,updatedRows:wrote.length,status:await statusWithDates(sql),preserved:['x_score','flow_1_pct','flow_5_pct','industry_membership','research_day_count']};
}
module.exports={START,END,OFFICIAL_SOURCE_NAMES,calendarDate,normalizeOfficialAction,normalizeTpexExRow,parseListed,parseTpex,fetchOfficialMonth,monthsBetween,
 ensureTables,scanNextMonth,actionStatus,statusWithDates,planAffectedDates,priceReturn,weighted,reconstructTagDay,readPriceDay,processNextDate};
