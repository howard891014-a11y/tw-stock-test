'use strict';
// Candidate journal only. This module NEVER imports a taxonomy writer or performs Neon writes.
// Live TWSE/TPEx master feeds + read-only MOPS-enriched company profiles -> private Blob.
const crypto=require('node:crypto');
const { fetchJson }=require('./sync-common');
const { _test:{companyProfileRows} }=require('./sync-service');
const { getSql }=require('./db');
const { fetchMopsProfile }=require('./business-enrichment');
const TWSE='https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const TPEX='https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
const PREFIX='stockzone/industry-change/v1/';
const CURRENT=PREFIX+'snapshot/current.json';
const MAX_EVENTS=30000;
const todayTaipei=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const normBusiness=t=>String(t||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const fingerprint=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
const idFor=e=>fingerprint([e.date,e.code,e.event,e.oldValue,e.newValue,e.industry]);
function store(){
  if(!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('缺少 BLOB_READ_WRITE_TOKEN，偵測紀錄不會寫入任何位置');
  return require('@vercel/blob');
}
async function getJson(path){
  const {get}=store();const r=await get(path,{access:'private'});
  if(!r)return null;
  if(r.statusCode!==200)throw new Error(`Private Blob 讀取失敗：${r.statusCode}`);
  return JSON.parse(await new Response(r.stream).text());
}
async function writeNew(path,data){
  const {put}=store();try{await put(path,JSON.stringify(data),{access:'private',contentType:'application/json',addRandomSuffix:false});return true}
  catch(e){if(/already.?exist|conflict|409/i.test(String(e?.message||'')))return false;throw e;}
}
async function overwriteCurrent(data,etag){
  const {put}=store();await put(CURRENT,JSON.stringify(data),{access:'private',contentType:'application/json',allowOverwrite:true,...(etag?{ifMatch:etag}:{})});
}
// First scan has no snapshot/current.json yet. Per @vercel/blob SDK, head()
// throws BlobNotFoundError (rather than returning null) for missing objects.
// Only that specific exception means a fresh baseline; auth/network/5xx
// errors MUST propagate, never silently reset an existing snapshot.
async function getBaseline(blob=store()){
  let meta;
  try { meta=await blob.head(CURRENT); }
  catch(error){
    if(typeof blob.BlobNotFoundError==='function' && error instanceof blob.BlobNotFoundError){
      return {value:null,etag:null};
    }
    throw error;
  }
  if(!meta)return {value:null,etag:null};
  return {value:await getJson(CURRENT),etag:meta.etag};
}
async function listPaths(prefix){
  const {list}=store();let cursor,paths=[];
  do{const page=await list({prefix,limit:1000,...(cursor?{cursor}:{})});paths.push(...(page.blobs||[]).map(b=>b.pathname));cursor=page.hasMore?page.cursor:null;if(paths.length>MAX_EVENTS)throw new Error('候選紀錄過多，暫停而不截斷');}while(cursor);
  return paths;
}
async function listChanges(){
  const paths=await listPaths(PREFIX+'events/');
  const entries=await Promise.all(paths.map(p=>getJson(p)));
  const valid=entries.filter(Boolean),released=new Map();
  // IMPORTED must be derived directly from a human-verified Neon release and its
  // actual approved membership; merely clicking a frontend button is NEVER sufficient.
  // Once SZ-iron publishes to Neon, the next refresh auto-displays 已導入, no extra deployment/confirmation.
  const ids=valid.map(e=>e.id);
  for(let i=0;i<ids.length;i+=500){
    const rows=await getSql().query(`SELECT r.change_id,r.stock_code,r.tag_id,r.approved_importance,r.evidence,
      CASE WHEN r.approved_importance='unchanged' THEN TRUE
        WHEN r.approved_importance='removed' THEN NOT EXISTS (
          SELECT 1 FROM market_business_xy2_member m WHERE m.stock_code=r.stock_code AND m.market=r.market AND m.tag_id=r.tag_id)
        ELSE EXISTS (
          SELECT 1 FROM market_business_xy2_member m WHERE m.stock_code=r.stock_code AND m.market=r.market
            AND m.tag_id=r.tag_id AND m.importance=r.approved_importance)
      END AS database_applied
      FROM market_taxonomy_release r WHERE r.change_id = ANY($1::text[])`,[ids.slice(i,i+500)]);
    for(const row of rows)released.set(row.change_id,row);
  }
  const tags=require('./market-topic-taxonomy').listMarketDefinitions({finalOnly:true});
  const tagNames=new Map(tags.map(t=>[t.id,t.name]));
  return valid.map(e=>{
    const release=released.get(e.id);
    const imported=Boolean(release&&release.stock_code===e.code&&release.database_applied
      &&String(release.evidence||'').trim().length>=10);
    return {...e,imported,role:imported?({core:'核心',related:'相關',removed:'已移除',unchanged:'維持原分類'}[release.approved_importance]||'已驗證'):e.role,
      industry:imported&&release.tag_id?tagNames.get(release.tag_id)||e.industry:e.industry};
  }).sort((a,b)=>b.date.localeCompare(a.date)||a.code.localeCompare(b.code)||a.event.localeCompare(b.event));
}
function normalize(rows,profileMap=new Map()){
  const out={};for(const p of rows){const code=String(p.stock_code||'').trim();if(!/^\d{4,6}$/.test(code)||out[code])throw new Error(`官方名單公司代號不合法或重複：${code}`);
    const db=profileMap.get(code)||{};
    out[code]={code,name:p.stock_name,market:p.market,industry:p.industry||p.industry_code||'未提供',industryCode:p.industry_code||'',mainBusiness:normBusiness(db.main_business),enrichCheckedAt:db.business_enrich_checked_at||'',missingCount:0};
  }return out;
}
function eventRow(date,p,type,oldValue,newValue,note=''){
  const e={date,code:p.code,name:p.name,industry:p.industry,market:type==='missing'?'疑似下市（待官方確認）':p.market,event:type,oldValue:oldValue||'',newValue:newValue||'',role:'待驗證',note,source:'TWSE/TPEx公司基本資料；MOPS營業項目（Neon唯讀鏡像）'};
  e.id=idFor(e);return e;
}
function detect(previous,next,date=todayTaipei()){
  if(!previous)return {initial:true,events:[],stocks:next};
  const events=[],stocks={...next};for(const [code,old] of Object.entries(previous.stocks||{})){
    const cur=stocks[code];if(!cur){const missingCount=(old.missingCount||0)+1;stocks[code]={...old,missingCount};
      // Two complete consecutive feed checks before raising possible delisting. NEVER assert final delisting.
      if(missingCount===2)events.push(eventRow(date,old,'missing',old.market,'疑似下市（待官方確認）','連續兩次完整官方名單未出現；必須查證正式公告'));continue;}
    if(old.market!==cur.market)events.push(eventRow(date,cur,'market',old.market,cur.market,'上市/上櫃轉換，不自動改正式分類'));
    if(old.name!==cur.name)events.push(eventRow(date,cur,'name',old.name,cur.name,'公司更名，不自動改正式分類'));
    if(old.industryCode!==cur.industryCode||old.industry!==cur.industry)events.push(eventRow(date,cur,'industry',old.industry,cur.industry,'官方產業異動，待查203產業分類'));
    // MOPS-derived text is read-only; use nonempty values only, avoiding false positives on data gaps.
    if(old.mainBusiness&&cur.mainBusiness&&old.mainBusiness!==cur.mainBusiness)events.push(eventRow(date,cur,'business',old.mainBusiness,cur.mainBusiness,'MOPS主要業務文本變動，待官方鐵證核實'));
  }
  for(const [code,cur] of Object.entries(next))if(!previous.stocks?.[code])events.push(eventRow(date,cur,'listing','',cur.market,'新進官方上市櫃公司名單，待人工審核產業'));
  return {initial:false,events,stocks};
}
async function fetchCompleteRoster(){
  const [rawL,rawO]=await Promise.all([fetchJson(TWSE,{retries:1,timeoutMs:15000}),fetchJson(TPEX,{retries:1,timeoutMs:15000})]);
  const l=companyProfileRows(rawL,'上市','TWSE t187ap03_L'),o=companyProfileRows(rawO,'上櫃','TPEx mopsfin_t187ap03_O');
  if(l.length<900||o.length<700)throw new Error(`官方名單不完整：上市${l.length}/上櫃${o.length}，保留前次快照`);
  const all=[...l,...o],codes=new Set(all.map(x=>x.stock_code));if(codes.size!==all.length)throw new Error('跨市場公司代號重複，保留前次快照');
  return {all,listed:l.length,otc:o.length};
}
async function scan({fetchRoster=fetchCompleteRoster,readProfiles=null,fetchMops=fetchMopsProfile,storage=null,date=todayTaipei()}={}){
  const adapter=storage||{baseline:getBaseline,writeNew,overwriteCurrent};
  const [official,base]=await Promise.all([fetchRoster(),adapter.baseline()]);
  // Read-only: this monitor NEVER writes to Neon, not even metadata or pending records.
  const profiles=readProfiles?await readProfiles():await getSql().query('SELECT stock_code,main_business,business_enrich_checked_at FROM market_company_profile');
  const map=new Map(profiles.map(x=>[String(x.stock_code),x]));
  const next=normalize(official.all,map);
  // Read-only scheduled MOPS sample (rotating universe): notices business transformation
  // even when the existing Neon enrichment pipeline hasn't re-polled this company.
  const previous=base.value?.stocks||{};
  for(const [code,stock] of Object.entries(next))if(previous[code]?.mainBusiness && (!stock.mainBusiness || stock.enrichCheckedAt===previous[code].enrichCheckedAt)){
    // Prefer previously fetched MOPS values over unchanged cached Neon text, but
    // detect newly refreshed official MOPS enrichment when its checked-at changes.
    stock.mainBusiness=previous[code].mainBusiness;
  }
  const codes=Object.keys(next).sort(),epoch=Math.floor(Date.parse(date+'T00:00:00Z')/86400000);
  const baseOffset=(epoch*24)%Math.max(1,codes.length);
  const chosen=new Set(codes.slice(baseOffset,baseOffset+24));
  if(chosen.size<24)for(const code of codes.slice(0,24-chosen.size))chosen.add(code);
  for(const code of codes)if(!previous[code]||previous[code].market!==next[code].market)chosen.add(code);
  const pending=[...chosen].slice(0,36),limit=4;
  let checkedMops=0,failedMops=0;
  for(let pos=0;pos<pending.length;pos+=limit){
    const results=await Promise.allSettled(pending.slice(pos,pos+limit).map(code=>fetchMops(code,{timeoutMs:4000})));
    results.forEach((result,i)=>{
      if(result.status==='fulfilled'&&normBusiness(result.value?.mainBusiness)){
        const code=pending[pos+i];next[code].mainBusiness=normBusiness(result.value.mainBusiness);checkedMops++;
      }else failedMops++;
    });
  }
  const delta=detect(base.value,next,date);
  // Fail closed on abrupt universe contraction even when official API passes minimum-size checks.
  const oldSize=Object.values(base.value?.stocks||{}).filter(x=>!x.missingCount).length;
  if(oldSize&&Object.keys(next).length<oldSize*0.97)throw new Error('官方名單較前次縮減超過3%，停止記錄以防假下市');
  // Write candidate rows BEFORE advancing baseline; retry is idempotent for each deterministic event pathname.
  for(const event of delta.events)await adapter.writeNew(`${PREFIX}events/${date}/${event.id}.json`,event);
  // ETag protected: concurrent scheduled runs cannot silently destroy a newer baseline.
  await adapter.overwriteCurrent({version:1,date,checkedAt:new Date().toISOString(),stocks:delta.stocks},base.etag);
  return {ok:true,mode:delta.initial?'initialized-baseline':'detected',date,listed:official.listed,otc:official.otc,events:delta.events.length,mopsChecked:checkedMops,mopsFailed:failedMops,candidates:delta.events.map(e=>({date:e.date,code:e.code,name:e.name,event:e.event,industry:e.industry})),neonWrites:0};
}
async function confirm(ids,{verifiedBy='SZ-鐵證模式'}={}){
  const rows=await listChanges(),byId=new Map(rows.map(r=>[r.id,r]));
  if(!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!byId.has(id)))throw new Error('選取的異動紀錄不存在或過多');
  // Only an explicit *human-audited, published* Neon release allows the status to change.
  // Monitoring itself has no INSERT/UPDATE/DELETE privileges against the taxonomy tables.
  const sql=getSql();
  const releases=await sql.query('SELECT change_id,stock_code,market,tag_id,approved_importance,reviewed_at,evidence FROM market_taxonomy_release WHERE change_id = ANY($1::text[])',[ids]);
  const byRelease=new Map(releases.map(x=>[x.change_id,x]));
  for(const id of ids){
    const candidate=byId.get(id),release=byRelease.get(id);
    if(!release||release.stock_code!==candidate.code||!release.evidence||String(release.evidence).trim().length<10)throw new Error(`${candidate.code} 缺少 SZ-鐵證正式發布證據，禁止標為已導入`);
    if(release.approved_importance==='core'||release.approved_importance==='related'){
      const current=await sql.query('SELECT importance FROM market_business_xy2_member WHERE stock_code=$1 AND tag_id=$2 AND market=$3',[release.stock_code,release.tag_id,release.market]);
      if(current[0]?.importance!==release.approved_importance)throw new Error(`${candidate.code} Neon 成員分類未符合已審核發布內容`);
    }else if(release.approved_importance==='removed'){
      const current=await sql.query('SELECT 1 FROM market_business_xy2_member WHERE stock_code=$1 AND tag_id=$2 AND market=$3',[release.stock_code,release.tag_id,release.market]);
      if(current.length)throw new Error('移除尚未正式寫入 Neon');
    }else if(release.approved_importance!=='unchanged')throw new Error('未知的已驗證分類結果');
  }
  for(const id of ids)await writeNew(`${PREFIX}confirmed/${id}.json`,{id,confirmedAt:new Date().toISOString(),verifiedBy,release:'market_taxonomy_release',neonWrites:0});
  return {ok:true,confirmed:ids.length,neonWrites:0};
}

async function removeConfirmed(id){
  const rows=await listChanges(),e=rows.find(r=>r.id===id);
  if(!e)throw new Error('找不到異動紀錄');if(!e.imported)throw new Error('未導入紀錄禁止刪除');
  const {del}=store();await del(`${PREFIX}events/${e.date}/${e.id}.json`);
  return {ok:true,removed:id};
}
module.exports={scan,listChanges,confirm,removeConfirmed,_test:{normalize,detect,eventRow,idFor,todayTaipei,PREFIX,getBaseline}};
