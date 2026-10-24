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
const {fetchOfficialMonth}=require('./research-corporate-actions');
const TODAY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0,24);
const priorMonth=m=>{const d=new Date(`${m}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const clean=v=>String(v??'').trim();
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
async function scanRecent({sql=getSql(),fetchMonth=fetchOfficialMonth,date=TODAY()}={}){
  await ensureCandidateTable(sql);
  const current=date.slice(0,7),months=[priorMonth(current),current].filter(m=>m>='2025-02');
  const settled=await Promise.all(months.map(async month=>{
    try{
      // Research Y-repair retains its original 2026-10-14 cutoff; only this
      // candidate scanner explicitly asks for today's dynamic end date.
      const data=await fetchMonth(month,{eventStart:'2025-02-01',eventEnd:date});
      return {month,actions:(data.sourceReports||[]).flatMap(s=>s.actions||[]),errors:data.errors||[],ok:!!data.ok,
        checkedSources:(data.sourceReports||[]).map(s=>s.name)};
    }catch(e){return {month,actions:[],errors:[String(e?.message||e)],ok:false,checkedSources:[]};}
  }));
  const candidates=new Map();
  for(const item of settled)for(const raw of item.actions){const normalized=classify(raw);if(normalized)candidates.set(normalized.id,normalized);}
  const codes=[...new Set([...candidates.values()].map(x=>x.code))];
  const profiles=codes.length?await sql.query(`SELECT stock_code,stock_name,industry,market FROM market_company_profile WHERE stock_code = ANY($1::text[])`,[codes]):[];
  const lookup=new Map(profiles.map(x=>[`${x.stock_code}:${x.market}`,x]));
  // Only non-released candidates are inserted. After a reviewed candidate is
  // deleted, a future daily rescan cannot resurrect the same ID.
  const events=[...candidates.values()].map(x=>({...x,name:lookup.get(`${x.code}:${x.market}`)?.stock_name||x.code,
    industry:lookup.get(`${x.code}:${x.market}`)?.industry||''}));
  let inserted=0;
  for(let i=0;i<events.length;i+=200){
    const added=await sql.query(`INSERT INTO market_company_action_candidate
      (candidate_id,event_date,stock_code,stock_name,market,industry,action,source,old_close,reference_close,note,ambiguous)
      SELECT j.id,j.date::date,j.code,j.name,j.market,j.industry,j.action,j.source,j."oldClose",j."referenceClose",j.note,j.ambiguous
      FROM jsonb_to_recordset($1::jsonb) AS j(id text,date text,code text,name text,market text,industry text,action text,source text,"oldClose" numeric,"referenceClose" numeric,note text,ambiguous boolean)
      WHERE NOT EXISTS(SELECT 1 FROM market_company_action_release r WHERE r.candidate_id=j.id AND r.stock_code=j.code AND r.market=j.market AND r.event_date=j.date::date AND r.action=j.action AND length(trim(r.evidence))>=10)
      ON CONFLICT(candidate_id) DO NOTHING RETURNING candidate_id`,[JSON.stringify(events.slice(i,i+200))]);
    inserted+=added.length;
  }
  const errors=settled.flatMap(s=>s.errors.map(e=>`${s.month}: ${e}`));
  return {ok:errors.length===0,source:'official-company-actions',scannedMonths:months,checkedSources:settled.map(x=>({month:x.month,sources:x.checkedSources,complete:x.ok})),
    candidates:events.length,inserted,errors,readonlyApprovedData:true,
    // Under no circumstance is a source failure interpreted as zero actions.
    complete:errors.length===0};
}
module.exports={classify,scanRecent,list,removeApproved,ensureCandidateTable,_test:{priorMonth,hash}};
