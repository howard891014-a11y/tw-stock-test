'use strict';
/**
 * Official corporate-action candidate inbox for 產業異動.
 * Pending events are stored ONLY in Neon market_company_action_candidate.
 * Neither the scanner nor the delete endpoint ever changes approved taxonomy,
 * OHLCV, research labels, or verified corporate-action releases.
 * "Imported" requires an independent SZ-鐵證, manually published release.
 */
const crypto=require('node:crypto');
const {getSql}=require('./db');
const {fetchOfficialMonth,OFFICIAL_SOURCE_NAMES}=require('./research-corporate-actions');
const TODAY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0,24);
const priorMonth=m=>{const d=new Date(`${m}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const clean=v=>String(v??'').trim();
// Backfill the known September 2026 source gaps, then advance automatically.
const SCAN_START_MONTH='2026-09';
const MAX_BACKLOG_MONTHS_PER_SCAN=2;
function classify(row){
  if(!row||!/^(reduction|split|rights_offering|ex_rights)$/.test(row.kind))return null;
  if(!/^\d{4}$/.test(clean(row.stock_code))||!/^(上市|上櫃)$/.test(row.market))return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(clean(row.trade_date)))return null;
  const note=clean(row.note);
  // Parser fallback '權/息' is NOT evidence of an actual ex-rights event.
  if(row.kind==='ex_rights'&&row.type_confirmed===false)return null;
  let action;
  if(row.kind==='reduction')action='減資';
  else if(row.kind==='split')action='分割';
  else if(row.kind==='rights_offering')action='增資';
  else if(/現金增資|現增|認購/.test(note))action='增資';
  else if(/^(?:息|除息|現金股利|配息|現金股利除息)$/.test(note)||(/息/.test(note)&&!/權|股/.test(note)))return null;
  else if(/權|股票股利|配股/.test(note))action='除權';
  // Unknown ex-right/dividend type is not evidence that a rights event occurred.
  else return null;
  const raw={date:row.trade_date,code:row.stock_code,market:row.market,action,source:row.source,
    old:row.old_close,reference:row.reference_close,note};
  return {id:hash(raw),date:raw.date,code:raw.code,market:raw.market,action,source:raw.source,
    oldClose:Number(raw.old),referenceClose:Number(raw.reference),note,
    // Explicit warning when the original official text does not distinguish ex-rights from ex-dividend.
    ambiguous:row.kind==='ex_rights'&&/權\s*[\/+與]\s*息|權息/.test(note)};
}
async function ensureCandidateTable(sql=getSql()){
  await sql.query(`CREATE TABLE IF NOT EXISTS market_company_action_candidate(
    candidate_id text PRIMARY KEY,
    event_date date NOT NULL,
    stock_code text NOT NULL,
    stock_name text NOT NULL DEFAULT '',
    market text NOT NULL CHECK (market IN ('上市','上櫃')),
    industry text NOT NULL DEFAULT '',
    action text NOT NULL CHECK (action IN ('增資','減資','分割','除權')),
    source text NOT NULL,
    old_close numeric,
    reference_close numeric,
    note text NOT NULL DEFAULT '',
    ambiguous boolean NOT NULL DEFAULT false,
    detected_at timestamptz NOT NULL DEFAULT now()
  )`);
  // Approval table is an audit surface for human SZ-鐵證 publication; scanner
  // never inserts into this table and a candidate deletion never touches it.
  await sql.query(`CREATE TABLE IF NOT EXISTS market_company_action_release(
    candidate_id text PRIMARY KEY,
    event_date date NOT NULL,
    stock_code text NOT NULL,
    stock_name text NOT NULL DEFAULT '',
    market text NOT NULL,
    industry text NOT NULL DEFAULT '',
    action text NOT NULL,
    source text NOT NULL DEFAULT '',
    old_close numeric,
    reference_close numeric,
    note text NOT NULL DEFAULT '',
    evidence text NOT NULL CHECK (length(trim(evidence))>=10),
    verified_by text NOT NULL DEFAULT 'SZ-鐵證模式',
    reviewed_at timestamptz NOT NULL DEFAULT now()
  )`);
  // This is a candidate-scanner checkpoint, NOT an approved release.  A month
  // is final only if each independent official feed was validated AFTER month end.
  // Saving the validated rows also makes the candidate write crash-recoverable.
  await sql.query(`CREATE TABLE IF NOT EXISTS market_company_action_scan_source(
    month text NOT NULL,
    source text NOT NULL,
    finalized boolean NOT NULL DEFAULT false,
    rows integer NOT NULL DEFAULT 0,
    actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    checked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(month,source)
  )`);
}
const approvalMatch=`r.candidate_id=c.candidate_id AND r.stock_code=c.stock_code AND r.market=c.market
  AND r.event_date=c.event_date AND r.action=c.action AND length(trim(r.evidence))>=10`;
async function tableReady(sql){const r=await sql.query(`SELECT to_regclass('public.market_company_action_candidate') IS NOT NULL AS candidate,
    to_regclass('public.market_company_action_release') IS NOT NULL AS release`);return {candidate:Boolean(r[0]?.candidate),release:Boolean(r[0]?.release)};}
async function list({sql=getSql()}={}){
  const ready=await tableReady(sql);if(!ready.candidate)return [];
  if(!ready.release)throw new Error('公司行動審核表尚未建立，不能判斷已導入狀態');
  const rows=await sql.query(`SELECT c.candidate_id AS id,to_char(c.event_date,'YYYY-MM-DD') AS date,
    c.stock_code AS code,c.stock_name AS name,c.market,c.industry,c.action AS behavior,
    c.source,c.old_close::float8 AS "oldClose",c.reference_close::float8 AS "referenceClose",
    c.note,c.ambiguous,
    EXISTS(SELECT 1 FROM market_company_action_release r WHERE ${approvalMatch}) AS imported
    FROM market_company_action_candidate c ORDER BY c.event_date DESC,c.stock_code,c.action,c.source`);
  return rows.map(x=>({...x,event:`corporate_${x.behavior}`,recordType:'company-action',role:x.imported?'已驗證':'待驗證',
    note:x.ambiguous?`權息複合事件待查：${x.note}`:x.note}));
}
async function removeApproved(id,{sql=getSql()}={}){
  if(!/^[a-f0-9]{24}$/.test(String(id||'')))throw new Error('候選事件 ID 格式錯誤');
  // Single DELETE statement with required reviewed-release match prevents
  // deletion races and prevents bypassing the UI's imported-only rule.
  const removed=await sql.query(`DELETE FROM market_company_action_candidate c WHERE c.candidate_id=$1
    AND EXISTS(SELECT 1 FROM market_company_action_release r WHERE ${approvalMatch})
    RETURNING c.candidate_id`,[id]);
  if(!removed.length)throw new Error('未經 SZ-鐵證導入 Neon 的公司行動紀錄禁止刪除');
  return {ok:true,removed:id,deletedFrom:'market_company_action_candidate',verifiedReleasePreserved:true};
}
async function removeAllApproved({sql=getSql()}={}){
  const ready=await tableReady(sql);
  if(!ready.candidate)return {ok:true,removed:0};
  if(!ready.release)throw new Error('公司行動審核表尚未建立，禁止批次刪除');
  const rows=await sql.query(`DELETE FROM market_company_action_candidate c
    WHERE EXISTS(SELECT 1 FROM market_company_action_release r WHERE ${approvalMatch})
    RETURNING c.candidate_id`);
  return {ok:true,removed:rows.length,verifiedReleasePreserved:true};
}
function monthRange(first,last){
  const result=[];
  for(let m=first;m<=last;){
    result.push(m);
    const d=new Date(`${m}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);
    m=d.toISOString().slice(0,7);
  }
  return result;
}
function cachedActions(value){
  if(Array.isArray(value))return value;
  if(typeof value==='string'){try{const a=JSON.parse(value);if(Array.isArray(a))return a;}catch{}}
  throw Error('官方來源續查快取格式無效，停止本次偵測');
}
async function readScanCheckpoints(sql,month){
  const entries=await sql.query(`SELECT month,source,finalized,rows,actions FROM market_company_action_scan_source
    WHERE month >= $1 AND month <= $2`,[SCAN_START_MONTH,month]);
  const byMonth=new Map();
  for(const row of entries){
    if(!OFFICIAL_SOURCE_NAMES.includes(row.source)||!/^\d{4}-\d{2}$/.test(row.month))continue;
    const existing=byMonth.get(row.month)||new Map();
    existing.set(row.source,{...row,actions:cachedActions(row.actions)});
    byMonth.set(row.month,existing);
  }
  return byMonth;
}
async function scanRecent({sql=getSql(),fetchMonth=fetchOfficialMonth,date=TODAY()}={}){
  await ensureCandidateTable(sql);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('公司行動掃描日期格式錯誤');
  const current=date.slice(0,7);
  if(current<SCAN_START_MONTH)throw Error('公司行動續查日期早於起始月份');
  const previous=priorMonth(current),months=monthRange(SCAN_START_MONTH,current);
  const cache=await readScanCheckpoints(sql,current);
  // Current month is always refreshed; the preceding month is refreshed after
  // its close unless the last recorded result is already final.
  // Older uncovered months are NEVER discarded by the rolling 2-month window.
  const incomplete=months.filter(m=>m<previous && OFFICIAL_SOURCE_NAMES.some(source=>!cache.get(m)?.get(source)?.finalized));
  const selectedMonths=[...new Set([
    ...incomplete.slice(0,MAX_BACKLOG_MONTHS_PER_SCAN),
    ...(previous>=SCAN_START_MONTH?[previous]:[]),current
  ])].sort();
  const settled=await Promise.all(selectedMonths.map(async month=>{
    const stored=cache.get(month)||new Map();
    const required=OFFICIAL_SOURCE_NAMES.filter(name=>month===current||!stored.get(name)?.finalized);
    if(!required.length)return {month,errors:[],attempted:[],validated:[]};
    let data;
    try{data=await fetchMonth(month,{eventStart:'2025-02-01',eventEnd:date,onlySources:required});}
    catch(e){data={errors:[String(e?.message||e)],sourceReports:[]};}
    const reports=(data.sourceReports||[]).filter(r=>required.includes(r.name));
    const errors=[...(data.errors||[]).map(x=>`${month}: ${x}`)];
    const valid=new Set();
    for(const report of reports){
      if(valid.has(report.name)||!Number.isInteger(report.rows)||report.rows<0||!Array.isArray(report.actions)){
        errors.push(`${month}: ${report.name}: official-source-report-invalid`);continue;
      }
      valid.add(report.name);
      // An incomplete month is recorded as a provisional success only; it is
      // NOT promoted to a finalized month until scanned AFTER its month end.
      await sql.query(`INSERT INTO market_company_action_scan_source
          (month,source,finalized,rows,actions,checked_at)
        VALUES($1,$2,$3,$4,$5::jsonb,now())
        ON CONFLICT(month,source) DO UPDATE SET
          finalized=EXCLUDED.finalized,rows=EXCLUDED.rows,
          actions=EXCLUDED.actions,checked_at=now()`,
        [month,report.name,month<current,Number(report.rows??0),JSON.stringify(report.actions)]);
      stored.set(report.name,{month,source:report.name,finalized:month<current,rows:Number(report.rows??0),actions:report.actions});
    }
    for(const name of required)if(!valid.has(name)&&!errors.some(e=>e.includes(name)))errors.push(`${month}: ${name}: source-not-validated`);
    cache.set(month,stored);
    return {month,errors,attempted:required,validated:[...valid]};
  }));
  // Always rebuild from persisted validated source snapshots; a failed
  // candidate INSERT after a successful checkpoint therefore cannot lose data.
  const candidates=new Map();
  for(const month of selectedMonths){
    for(const item of (cache.get(month)||new Map()).values()){
      for(const raw of item.actions){const normalized=classify(raw);if(normalized)candidates.set(normalized.id,normalized);}
    }
  }
  const codes=[...new Set([...candidates.values()].map(x=>x.code))];
  const profiles=codes.length?await sql.query(`SELECT stock_code,stock_name,industry,market FROM market_company_profile WHERE stock_code = ANY($1::text[])`,[codes]):[];
  const lookup=new Map(profiles.map(x=>[`${x.stock_code}:${x.market}`,x]));
  const events=[...candidates.values()].map(x=>({...x,name:lookup.get(`${x.code}:${x.market}`)?.stock_name||x.code,
    industry:lookup.get(`${x.code}:${x.market}`)?.industry||''}));
  let inserted=0;
  for(let i=0;i<events.length;i+=200){
    const added=await sql.query(`INSERT INTO market_company_action_candidate
      (candidate_id,event_date,stock_code,stock_name,market,industry,action,source,old_close,reference_close,note,ambiguous)
      SELECT j.id,j.date::date,j.code,j.name,j.market,j.industry,j.action,j.source,j."oldClose",j."referenceClose",j.note,j.ambiguous
      FROM jsonb_to_recordset($1::jsonb) AS j(id text,date text,code text,name text,market text,industry text,action text,source text,"oldClose" numeric,"referenceClose" numeric,note text,ambiguous boolean)
      WHERE NOT EXISTS(SELECT 1 FROM market_company_action_release r WHERE r.candidate_id=j.id AND r.stock_code=j.code AND r.market=j.market AND r.event_date=j.date::date AND length(trim(r.evidence))>=10)
      ON CONFLICT(candidate_id) DO NOTHING RETURNING candidate_id`,[JSON.stringify(events.slice(i,i+200))]);
    inserted+=added.length;
  }
  const errors=settled.flatMap(x=>x.errors);
  const pending=months.flatMap(month=>{
    const entries=cache.get(month)||new Map();
    const missing=OFFICIAL_SOURCE_NAMES.filter(source=>!entries.has(source)||(month<current&&!entries.get(source).finalized));
    return missing.length?[{month,sources:missing}]:[];
  });
  const isCurrentValidated=OFFICIAL_SOURCE_NAMES.every(source=>cache.get(current)?.has(source));
  const completedMonths=months.filter(month=>month<current&&OFFICIAL_SOURCE_NAMES.every(source=>cache.get(month)?.get(source)?.finalized)).length;
  return {ok:errors.length===0&&pending.length===0,source:'official-company-actions',
    scannedMonths:selectedMonths,checkedSources:settled.map(x=>({month:x.month,sources:x.validated,attempted:x.attempted,complete:x.errors.length===0})),
    completedMonths,pendingMonths:pending,pendingSourceCount:pending.reduce((n,x)=>n+x.sources.length,0),
    currentMonthProvisional:isCurrentValidated,candidates:events.length,inserted,errors,
    readonlyApprovedData:true,complete:errors.length===0&&pending.length===0};
}
module.exports={classify,scanRecent,list,removeApproved,removeAllApproved,ensureCandidateTable,_test:{priorMonth,hash,monthRange,readScanCheckpoints,SCAN_START_MONTH}};
