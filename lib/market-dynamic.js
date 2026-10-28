const { getSql } = require('./db');
const { STORAGE_POLICY } = require('./storage-policy');
const { computeW3D112 } = require('./w3-d112');
const { fetchW3D112Inputs } = require('./w3-d112-inputs');
const {createHash}=require('node:crypto');

const SOURCE = 'StockZone market-dynamic-v1';
const KEEP_DAYS = Number(STORAGE_POLICY?.compact?.marketDynamics || 500);
let schemaReady = false;

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g,'').replace(/<[^>]+>/g,''));
  return Number.isFinite(n) ? n : null;
};
const round = (v,d=4) => v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const iso = v => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return String(v).slice(0,10);
};
const rocToIso = v => {
  const s=String(v||'').trim(),m=s.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if(!m)return '';
  return `${Number(m[1])+1911}-${m[2]}-${m[3]}`;
};
function avg(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function stdev(a){const x=a.filter(Number.isFinite);if(x.length<2)return null;const m=avg(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/(x.length-1))}
function pct(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?(a/b-1)*100:null}

async function ensureMarketDynamicSchema(sql=getSql()){
  if(schemaReady)return;
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_dynamic_daily (
      trade_date date PRIMARY KEY,
      taiex_close numeric(14,2),
      taiex_change_pct numeric(10,4),
      taiex_return_5_pct numeric(10,4),
      taiex_return_20_pct numeric(10,4),
      ma20_gap_pct numeric(10,4),
      ma60_gap_pct numeric(10,4),
      volatility_20_pct numeric(10,4),
      drawdown_20_pct numeric(10,4),
      up_count smallint,
      down_count smallint,
      flat_count smallint,
      advance_ratio numeric(10,4),
      breadth_5 numeric(10,4),
      total_trade_value numeric(24,0),
      foreign_net numeric(24,0),
      foreign_value numeric(24,0),
      trust_value numeric(24,0),
      dealer_value numeric(24,0),
      institutional_complete boolean NOT NULL DEFAULT false,
      institutional_coverage_pct numeric(8,3),
      trust_net numeric(24,0),
      dealer_net numeric(24,0),
      total_institutional_net numeric(24,0),
      coverage_pct numeric(8,4),
      source text NOT NULL DEFAULT 'StockZone market-dynamic-v1',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Old deployments created the table before monetary amounts and coverage flags.
  await sql.query(`ALTER TABLE market_dynamic_daily ADD COLUMN IF NOT EXISTS foreign_value numeric(24,0)`);
  await sql.query(`ALTER TABLE market_dynamic_daily ADD COLUMN IF NOT EXISTS trust_value numeric(24,0)`);
  await sql.query(`ALTER TABLE market_dynamic_daily ADD COLUMN IF NOT EXISTS dealer_value numeric(24,0)`);
  await sql.query(`ALTER TABLE market_dynamic_daily ADD COLUMN IF NOT EXISTS institutional_complete boolean NOT NULL DEFAULT false`);
  await sql.query(`ALTER TABLE market_dynamic_daily ADD COLUMN IF NOT EXISTS institutional_coverage_pct numeric(8,3)`);
  schemaReady=true;
}

async function fetchJson(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{
    const r=await fetch(url,{headers:{'user-agent':'StockZone/2.6.6.15 market-dynamic'},signal:c.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(t)}
}
async function fetchTaiexMonths(months){
  const out=new Map();
  // Parallel bounded requests; historical months already stored in Neon are not refetched.
  await Promise.all(months.map(async month=>{
    try{
      const ymd=month.replace('-','')+'01';
      const j=await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${ymd}&response=json`);
      const fields=Array.isArray(j?.fields)?j.fields:[];
      const di=fields.findIndex(x=>String(x).includes('日期'));
      const ci=fields.findIndex(x=>String(x).includes('發行量加權股價指數'));
      if(di<0||ci<0)return;
      for(const row of j?.data||[]){
        const d=rocToIso(row?.[di]),close=num(row?.[ci]);
        if(d&&Number.isFinite(close))out.set(d,close);
      }
    }catch(e){console.warn('market-dynamic TAIEX fetch failed',month,e?.message||e)}
  }));
  return out;
}

async function rawMarketRows(sql){
  return sql.query(`
    SELECT trade_date::text AS trade_date,
      COUNT(*)::int AS total_count,
      COUNT(change_pct)::int AS usable_count,
      COUNT(*) FILTER (WHERE change_pct > 0)::int AS up_count,
      COUNT(*) FILTER (WHERE change_pct < 0)::int AS down_count,
      COUNT(*) FILTER (WHERE change_pct = 0)::int AS flat_count,
      COALESCE(SUM(trade_value),0)::numeric AS total_trade_value
    FROM market_daily_history
    WHERE market IN ('上市','上櫃')
    GROUP BY trade_date
    ORDER BY trade_date
  `);
}
// Institutional raw is *shares*, not TWD. Join same-day closes for TWD value.
// Require both TWSE and TPEx to have sufficient listed company coverage;
// missing/partial market data must never be formatted as a true net zero.
async function rawInstitutionalRows(sql){
  return sql.query(`WITH priced AS (
    SELECT p.trade_date,p.market,COUNT(*)::int AS price_count,
      COUNT(i.stock_code)::int AS matched_count,
      SUM(i.foreign_net::numeric * p.close_price::numeric)
        FILTER(WHERE i.foreign_net IS NOT NULL) AS foreign_value,
      SUM(i.trust_net::numeric * p.close_price::numeric)
        FILTER(WHERE i.trust_net IS NOT NULL) AS trust_value,
      SUM(i.dealer_net::numeric * p.close_price::numeric)
        FILTER(WHERE i.dealer_net IS NOT NULL) AS dealer_value
    FROM market_daily_history p
    LEFT JOIN institutional_trading_daily i USING(trade_date,stock_code,market)
    WHERE p.market IN ('上市','上櫃') AND p.close_price>0 AND p.trade_value>0
    GROUP BY p.trade_date,p.market
  ), full_flow AS (
    SELECT trade_date,market,COUNT(*)::int rows,
      SUM(foreign_net)::numeric AS foreign_net,
      SUM(trust_net)::numeric AS trust_net,
      SUM(dealer_net)::numeric AS dealer_net,
      SUM(total_net)::numeric AS total_institutional_net
    FROM institutional_trading_daily WHERE market IN ('上市','上櫃')
    GROUP BY trade_date,market
  ), checked AS (
    SELECT p.*,f.foreign_net,f.trust_net,f.dealer_net,f.total_institutional_net,
      p.price_count>=150 AND p.matched_count>=GREATEST(120,CEIL(p.price_count*0.8)) AS complete
    FROM priced p LEFT JOIN full_flow f USING(trade_date,market)
  ) SELECT trade_date::text AS trade_date,
    COUNT(*)::int AS market_count,
    BOOL_AND(complete) AS coverage_ok,
    ROUND(100*SUM(matched_count)::numeric/NULLIF(SUM(price_count),0),2) AS institutional_coverage_pct,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(foreign_value) END AS foreign_value,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(trust_value) END AS trust_value,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(dealer_value) END AS dealer_value,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(foreign_net) END AS foreign_net,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(trust_net) END AS trust_net,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(dealer_net) END AS dealer_net,
    CASE WHEN COUNT(*)=2 AND BOOL_AND(complete) THEN SUM(total_institutional_net) END AS total_institutional_net
    FROM checked GROUP BY trade_date ORDER BY trade_date`);
}

function deriveRows(raw,inst,taiex){
  const im=new Map(inst.map(r=>[iso(r.trade_date),r]));
  const rows=raw.map(r=>{
    const d=iso(r.trade_date),u=Number(r.up_count)||0,down=Number(r.down_count)||0,flat=Number(r.flat_count)||0;
    const directional=u+down;
    const i=im.get(d)||{};
    return {
      trade_date:d, taiex_close:taiex.get(d)??null,
      up_count:u,down_count:down,flat_count:flat,
      advance_ratio:directional?u/directional*100:null,
      total_trade_value:num(r.total_trade_value)||0,
      // Distinguish a real 0 from a partially loaded day (NULL).
      foreign_net:i.foreign_net===undefined?null:num(i.foreign_net),
      foreign_value:i.foreign_value===undefined?null:num(i.foreign_value),
      trust_value:i.trust_value===undefined?null:num(i.trust_value),
      dealer_value:i.dealer_value===undefined?null:num(i.dealer_value),
      institutional_complete:Boolean(i.coverage_ok),institutional_coverage_pct:num(i.institutional_coverage_pct),
      trust_net:i.trust_net===undefined?null:num(i.trust_net),dealer_net:i.dealer_net===undefined?null:num(i.dealer_net),
      total_institutional_net:i.total_institutional_net===undefined?null:num(i.total_institutional_net),
      coverage_pct:Number(r.total_count)?Number(r.usable_count||0)/Number(r.total_count)*100:null
    };
  });
  for(let x=0;x<rows.length;x++){
    const r=rows[x],closes=rows.slice(0,x+1).map(z=>z.taiex_close);
    const close=r.taiex_close;
    r.taiex_change_pct=x>0?pct(close,rows[x-1].taiex_close):null;
    r.taiex_return_5_pct=x>=5?pct(close,rows[x-5].taiex_close):null;
    r.taiex_return_20_pct=x>=20?pct(close,rows[x-20].taiex_close):null;
    const c20=closes.slice(-20).filter(Number.isFinite),c60=closes.slice(-60).filter(Number.isFinite);
    r.ma20_gap_pct=c20.length>=15?pct(close,avg(c20)):null;
    r.ma60_gap_pct=c60.length>=40?pct(close,avg(c60)):null;
    const rets=[];
    for(let j=Math.max(1,x-19);j<=x;j++){const q=pct(rows[j].taiex_close,rows[j-1]?.taiex_close);if(Number.isFinite(q))rets.push(q)}
    r.volatility_20_pct=rets.length>=10?stdev(rets):null;
    r.drawdown_20_pct=c20.length?pct(close,Math.max(...c20)):null;
    r.breadth_5=avg(rows.slice(Math.max(0,x-4),x+1).map(z=>z.advance_ratio));
  }
  return rows;
}
async function upsertRows(sql,rows){
  if(!rows.length)return 0;
  let count=0;
  for(const r of rows){
    await sql.query(`
      INSERT INTO market_dynamic_daily (
        trade_date,taiex_close,taiex_change_pct,taiex_return_5_pct,taiex_return_20_pct,
        ma20_gap_pct,ma60_gap_pct,volatility_20_pct,drawdown_20_pct,
        up_count,down_count,flat_count,advance_ratio,breadth_5,total_trade_value,
        foreign_net,trust_net,dealer_net,total_institutional_net,coverage_pct,
        foreign_value,trust_value,dealer_value,institutional_complete,institutional_coverage_pct,source,updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$22,$25,$26,$23,$24,$21,now()
      )
      ON CONFLICT (trade_date) DO UPDATE SET
        taiex_close=EXCLUDED.taiex_close,taiex_change_pct=EXCLUDED.taiex_change_pct,
        taiex_return_5_pct=EXCLUDED.taiex_return_5_pct,taiex_return_20_pct=EXCLUDED.taiex_return_20_pct,
        ma20_gap_pct=EXCLUDED.ma20_gap_pct,ma60_gap_pct=EXCLUDED.ma60_gap_pct,
        volatility_20_pct=EXCLUDED.volatility_20_pct,drawdown_20_pct=EXCLUDED.drawdown_20_pct,
        up_count=EXCLUDED.up_count,down_count=EXCLUDED.down_count,flat_count=EXCLUDED.flat_count,
        advance_ratio=EXCLUDED.advance_ratio,breadth_5=EXCLUDED.breadth_5,
        total_trade_value=EXCLUDED.total_trade_value,foreign_net=EXCLUDED.foreign_net,
        trust_net=EXCLUDED.trust_net,dealer_net=EXCLUDED.dealer_net,
        total_institutional_net=EXCLUDED.total_institutional_net,coverage_pct=EXCLUDED.coverage_pct,
        foreign_value=EXCLUDED.foreign_value,
        trust_value=EXCLUDED.trust_value,
        dealer_value=EXCLUDED.dealer_value,
        institutional_complete=EXCLUDED.institutional_complete,
        institutional_coverage_pct=EXCLUDED.institutional_coverage_pct,
        source=EXCLUDED.source,updated_at=now()
    `,[
      r.trade_date,r.taiex_close,round(r.taiex_change_pct),round(r.taiex_return_5_pct),round(r.taiex_return_20_pct),
      round(r.ma20_gap_pct),round(r.ma60_gap_pct),round(r.volatility_20_pct),round(r.drawdown_20_pct),
      r.up_count,r.down_count,r.flat_count,round(r.advance_ratio),round(r.breadth_5),r.total_trade_value,
      r.foreign_net,r.trust_net,r.dealer_net,r.total_institutional_net,round(r.coverage_pct),SOURCE,
      r.institutional_complete?r.foreign_value:null,Boolean(r.institutional_complete),round(r.institutional_coverage_pct,3),
      r.institutional_complete?r.trust_value:null,r.institutional_complete?r.dealer_value:null
    ]);
    count++;
  }
  return count;
}
async function prune(sql){
  await sql.query(`
    DELETE FROM market_dynamic_daily
    WHERE trade_date NOT IN (
      SELECT trade_date FROM market_dynamic_daily ORDER BY trade_date DESC LIMIT $1
    )
  `,[KEEP_DAYS]);
}
async function refreshMarketDynamic({force=false}={}){
  const sql=getSql(); await ensureMarketDynamicSchema(sql);
  const raw=await rawMarketRows(sql);
  if(!raw.length)return {ok:false,reason:'market-history-empty',written:0};
  const latest=iso(raw.at(-1).trade_date);
  const state=await sql.query(`SELECT MAX(trade_date)::text AS latest,COUNT(*)::int AS n FROM market_dynamic_daily`);
  const dbLatest=iso(state?.[0]?.latest);
  // Always revisit the latest days: institutional data may arrive after the price snapshot.
  // An unchanged latest trade date is NOT proof that all sources are complete.
  const inst=await rawInstitutionalRows(sql);
  // Reuse verified historical index closes; only fetch recent/missing months.
  // This avoids 20+ monthly TWSE calls every time the snapshot is refreshed.
  const saved=await sql.query('SELECT trade_date::text AS trade_date,taiex_close FROM market_dynamic_daily WHERE taiex_close IS NOT NULL');
  const taiex=new Map(saved.map(r=>[iso(r.trade_date),Number(r.taiex_close)]));
  const recent=raw.slice(-45).map(r=>iso(r.trade_date));
  const monthNeeds=new Set(raw.filter(r=>!taiex.has(iso(r.trade_date))).map(r=>iso(r.trade_date).slice(0,7)));
  // Current month can acquire today's index data after the previous snapshot.
  if(recent.length)monthNeeds.add(recent.at(-1).slice(0,7));
  const fresh=await fetchTaiexMonths([...monthNeeds]);
  for(const [date,value] of fresh)taiex.set(date,value);
  const derived=deriveRows(raw,inst,taiex);
  const existing=await sql.query(`SELECT trade_date::text AS trade_date FROM market_dynamic_daily`);
  const have=new Set(existing.map(r=>iso(r.trade_date)));
  const pending=derived.filter((r,i)=>force||!have.has(r.trade_date)||i>=derived.length-25);
  const written=await upsertRows(sql,pending);
  await prune(sql);
  return {ok:true,latest,written,sourceDays:raw.length,taiexDays:taiex.size,retentionDays:KEEP_DAYS};
}
async function getLatestDistribution(sql,tradeDate){
  const rows=await sql.query(
    "SELECT market, "+
    "COUNT(*) FILTER (WHERE change_pct <= -9.5)::int AS limit_down, "+
    "COUNT(*) FILTER (WHERE change_pct > -9.5 AND change_pct < -5)::int AS lt_m5, "+
    "COUNT(*) FILTER (WHERE change_pct >= -5 AND change_pct < -3)::int AS m5_m3, "+
    "COUNT(*) FILTER (WHERE change_pct >= -3 AND change_pct < -1)::int AS m3_m1, "+
    "COUNT(*) FILTER (WHERE change_pct >= -1 AND change_pct < 0)::int AS m1_0, "+
    "COUNT(*) FILTER (WHERE change_pct = 0)::int AS flat, "+
    "COUNT(*) FILTER (WHERE change_pct > 0 AND change_pct <= 1)::int AS p0_1, "+
    "COUNT(*) FILTER (WHERE change_pct > 1 AND change_pct <= 3)::int AS p1_3, "+
    "COUNT(*) FILTER (WHERE change_pct > 3 AND change_pct <= 5)::int AS p3_5, "+
    "COUNT(*) FILTER (WHERE change_pct > 5 AND change_pct < 9.5)::int AS gt_5, "+
    "COUNT(*) FILTER (WHERE change_pct >= 9.5)::int AS limit_up, "+
    "COUNT(change_pct)::int AS total "+
    "FROM market_daily_history WHERE trade_date=$1 AND market IN ('上市','上櫃') GROUP BY market",
    [tradeDate]
  );
  const pack=(market)=>{
    const r=rows.find(x=>x.market===market)||{};
    return {market,total:Number(r.total)||0,bins:[
      Number(r.limit_down)||0,Number(r.lt_m5)||0,Number(r.m5_m3)||0,Number(r.m3_m1)||0,Number(r.m1_0)||0,
      Number(r.flat)||0,Number(r.p0_1)||0,Number(r.p1_3)||0,Number(r.p3_5)||0,Number(r.gt_5)||0,Number(r.limit_up)||0
    ]};
  };
  return {labels:["跌停","<-5","-5~-3","-3~-1","-1~0","0","0~1","1~3","3~5",">5","漲停"],listed:pack("上市"),otc:pack("上櫃")};
}

function rowOut(r){
  const N=v=>v===null||v===undefined?null:Number(v);
  return {
    date:iso(r.trade_date),taiexClose:N(r.taiex_close),changePct:N(r.taiex_change_pct),
    ret5:N(r.taiex_return_5_pct),ret20:N(r.taiex_return_20_pct),
    ma20Gap:N(r.ma20_gap_pct),ma60Gap:N(r.ma60_gap_pct),vol20:N(r.volatility_20_pct),drawdown20:N(r.drawdown_20_pct),
    up:Number(r.up_count)||0,down:Number(r.down_count)||0,flat:Number(r.flat_count)||0,
    advanceRatio:N(r.advance_ratio),breadth5:N(r.breadth_5),tradeValue:N(r.total_trade_value),
    foreignNet:r.institutional_complete?N(r.foreign_net):null,
    foreignValue:r.institutional_complete?N(r.foreign_value):null,
    trustValue:r.institutional_complete?N(r.trust_value):null,
    dealerValue:r.institutional_complete?N(r.dealer_value):null,
    institutionalComplete:Boolean(r.institutional_complete),institutionalCoveragePct:N(r.institutional_coverage_pct),
    trustNet:r.institutional_complete?N(r.trust_net):null,dealerNet:r.institutional_complete?N(r.dealer_net):null,
    institutionalNet:r.institutional_complete?N(r.total_institutional_net):null,
    coverage:N(r.coverage_pct)
  };
}

// Existing W3 audit tables are reused: no new Neon tables or migrations.
// Include the model version in the fingerprint: old W3 audit rows cannot be
 // mistaken for W3-D.1.2, even if the original daily inputs were unchanged.
async function saveW3Audit(sql,records,inputs){
 const VERSION='W3-D.1.2';
 const hashes=new Map(inputs.map(r=>[r.date,createHash('sha256').update(VERSION+'|'+JSON.stringify(r)).digest('hex')]));
 const args=[],values=[];
 // Never persist a provisional result as an actual current-day computation.
 for(const r of records){
  if(!r.valid||!hashes.has(r.date))continue;
  const n=args.length;
  args.push(r.date,r.regime,hashes.get(r.date),VERSION);
  values.push(`($${n+1}::date,$${n+2},$${n+3},$${n+4})`);
 }
 if(values.length){
  const derived=`(VALUES ${values.join(',')}) AS v(trade_date,regime,input_hash,model_version)`;
  // Recalculations are logged only when inputs, regime OR model version change.
  await sql.query(`INSERT INTO market_w3_recalc_audit(trade_date,old_regime,new_regime,old_input_hash,new_input_hash)
   SELECT v.trade_date,old.regime,v.regime,old.input_hash,v.input_hash FROM ${derived}
   JOIN market_w3_run_daily old ON old.trade_date=v.trade_date
   WHERE old.input_hash IS DISTINCT FROM v.input_hash OR old.regime IS DISTINCT FROM v.regime
     OR old.model_version IS DISTINCT FROM v.model_version`,args);
  await sql.query(`INSERT INTO market_w3_run_daily(trade_date,regime,input_hash,model_version)
   VALUES ${values.join(',')}
   ON CONFLICT(trade_date) DO UPDATE SET regime=EXCLUDED.regime,input_hash=EXCLUDED.input_hash,
     model_version=EXCLUDED.model_version,computed_at=now()
   WHERE market_w3_run_daily.input_hash IS DISTINCT FROM EXCLUDED.input_hash
      OR market_w3_run_daily.regime IS DISTINCT FROM EXCLUDED.regime
      OR market_w3_run_daily.model_version IS DISTINCT FROM EXCLUDED.model_version`,args);
 }
 const saved=await sql.query(`SELECT trade_date::text AS date,regime,input_hash AS "inputHash",
   model_version AS "modelVersion",computed_at AS "computedAt"
   FROM market_w3_run_daily WHERE model_version=$1 ORDER BY trade_date ASC LIMIT 550`,[VERSION]);
 // An old/corrupted canonical row cannot override the live read-only replay.
 return saved.filter(r=>hashes.get(r.date)===r.inputHash)
   .map(r=>({...r,status:'computed'}));
}
// v2.6.8.3 — one durable, read-only-to-browsers snapshot. W3 calculations
// still execute via the ORIGINAL computeW3D112 path above; the cache never
// approximates, substitutes, or modifies that formula or its daily audit.
async function ensureMarketSnapshotSchema(sql=getSql()){
  await sql.query(`CREATE TABLE IF NOT EXISTS market_dynamic_snapshot (
    id smallint PRIMARY KEY CHECK (id=1),
    payload jsonb NOT NULL,
    source_date date,
    calculated_at timestamptz NOT NULL DEFAULT now()
  )`);
}
async function readMarketSnapshot(sql=getSql()){
  await ensureMarketSnapshotSchema(sql);
  const result=await sql.query('SELECT payload,source_date::text AS source_date,calculated_at FROM market_dynamic_snapshot WHERE id=1');
  const row=result[0];
  if(!row?.payload?.ok)return null;
  return {...row.payload,meta:{...(row.payload.meta||{}),snapshotAt:row.calculated_at,snapshotSourceDate:row.source_date}};
}
async function writeMarketSnapshot(sql,payload){
  await ensureMarketSnapshotSchema(sql);
  await sql.query(`INSERT INTO market_dynamic_snapshot(id,payload,source_date,calculated_at)
    VALUES(1,$1::jsonb,$2::date,now())
    ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,source_date=EXCLUDED.source_date,calculated_at=now()`,
    [JSON.stringify(payload),payload?.latest?.date||null]);
  return payload;
}
async function getMarketDynamicCached({days=60,fresh=false}={}){
  const blob=require('./market-dynamic-blob');
  try{
    const stored=await blob.read({fresh});
    if(stored)return blob.page(stored,days,'vercel-private-blob');
  }catch(e){console.error('W3 Blob cache unavailable, Neon emergency fallback',String(e?.message||e))}
  // Deployment bootstrap / emergency fallback only: existing immutable daily Neon snapshot.
  // No original W3 formula replay is invoked on normal page loads.
  const data=await readMarketSnapshot(getSql());
  if(data)return blob.page(data,days,'neon-fallback');
  return blob.page(await refreshMarketSnapshot({force:false}),days,'initial-bootstrap');
}
async function refreshMarketSnapshot({force=false}={}){
  const data=await getMarketDynamic({days:120,force});
  // Display-only official CASH amount overlay. The original W3 replay and its
  // Neon stock-level inputs have already completed; neither is modified here.
  let previous=null;
  try{previous=await require('./market-dynamic-blob').read({fresh:true})}
  catch(e){console.warn('Previous official market snapshot unavailable',String(e?.message||e))}
  // Official reports are archived independently from W3 and all prior market tables.
  // The 20D overlay supplies a bootstrap and future cron updates append into a
  // dedicated rolling 250-trading-day Neon table, without refetching reports.
  const archiveAttempts=[];
  try{await require('./market-institutional-official').enrichOfficialInstitutional(data,previous,{
    onMarketAttempt:attempt=>archiveAttempts.push(attempt)
  })}
  catch(e){console.error('Official market institutional overlay failed',String(e?.message||e))}
  try{await require('./official-institutional-archive').saveOfficialArchive({
    history:data.history,attempts:archiveAttempts
  },getSql())}
  catch(e){console.error('Separate 250D official institutional archive failed (W3 unaffected)',String(e?.message||e))}
  await writeMarketSnapshot(getSql(),data); // canonical disaster-recovery copy
  await require('./market-dynamic-blob').write(data); // normal page-read path; same computed bytes
  return data;
}
async function getMarketDynamic({days=60,force=false}={}){
  const sql=getSql(); await ensureMarketDynamicSchema(sql);
  const refresh=await refreshMarketDynamic({force});
  const lim=Math.max(20,Math.min(120,Number(days)||60));
  const rows=await sql.query(`SELECT * FROM market_dynamic_daily ORDER BY trade_date DESC LIMIT $1`,[lim]);
  // The OFFICIAL card now consumes the same native, coverage-gated stock-level
  // W3-D.1.2 frozen model consumes the existing coverage-gated stock-level inputs.
  // A partial day retains history but is NOT advertised as a newly valid signal.
  const inputs=await fetchW3D112Inputs(sql);
  const w3Replay=computeW3D112(inputs);
  let w3Records=[],w3AuditError=null;
  try{w3Records=await saveW3Audit(sql,w3Replay.records,inputs)}
  catch(e){w3AuditError=String(e?.message||e);console.warn('W3-D.1.2 audit failed',e)}
  const savedByDate=new Map(w3Records.map(r=>[r.date,r]));
  // Read canonical W3 history INCLUDING rows whose raw inputs expired or changed.
  // Never label such historical rows as freshly validated, and never invent Warning flags.
  // If a row is deleted from canonical Neon, it disappears from the next Blob snapshot.
  const persistentRows=await sql.query(`SELECT trade_date::text AS date,regime,input_hash AS "inputHash",
    model_version AS "modelVersion",computed_at AS "computedAt"
    FROM market_w3_run_daily WHERE model_version=$1 ORDER BY trade_date ASC`,['W3-D.1.2']);
  const allSavedByDate=new Map(persistentRows.map(r=>[r.date,r]));
  const auditRecords=w3Replay.records.map(r=>{
    const match=savedByDate.get(r.date),archive=allSavedByDate.get(r.date);
    if(match)return {...r,...match,status:'computed'};
    if(archive)return {...r,...archive,regime:archive.regime,warning:false,warningActive:false,
      valid:false,storedOnly:true,status:'historical_saved'};
    return {...r,status:r.valid?'not_saved':'incomplete'};
  });
  const rawDates=new Set(w3Replay.records.map(r=>r.date));
  for(const row of persistentRows){
    if(rawDates.has(row.date))continue;
    auditRecords.push({...row,valid:false,storedOnly:true,warning:false,warningActive:false,
      inputQuality:'raw-expired',score:null,status:'historical_saved'});
  }
  auditRecords.sort((a,b)=>a.date.localeCompare(b.date));
  // Oldest visible history follows the earliest canonical W3 date still saved in Neon.
  // Once Neon prunes an old W3 date, the next Blob publication drops earlier display rows.
  if(persistentRows.length){
    const firstSaved=persistentRows[0].date;
    while(auditRecords.length&&auditRecords[0].date<firstSaved)auditRecords.shift();
  }
  const lastSwitch=w3Replay.switches.at(-1)?.date||null;
  const lastSwitchIndex=lastSwitch?auditRecords.findIndex(r=>r.date===lastSwitch):-1;
  const heldTradingDays=lastSwitchIndex>=0?auditRecords.length-1-lastSwitchIndex:null;
  const w3ByDate=new Map(w3Replay.records.map(r=>[r.date,r]));
  let w3StorageBytes=null;
  try{
   const z=await sql.query(`SELECT (pg_total_relation_size('market_w3_run_daily')+
    pg_total_relation_size('market_w3_recalc_audit'))::bigint AS bytes`);
   w3StorageBytes=Number(z[0]?.bytes);
  }catch(_e){}
  const history=rows.map(r=>{
    const record=w3ByDate.get(iso(r.trade_date));
    return {...rowOut(r),w3Regime:record?.valid?record.regime:null,
      w3Warning:record?.valid?record.warning:false,
      w3WarningActive:record?.valid?record.warningActive:false,
      w3WarningOffCovered:record?.valid?record.offCovered:false,
      w3RiskScore:record?.valid?record.score:null,
      w3InputQuality:record?.inputQuality||'missing'};
  });
  const latest=history[0]||null;
  const latestW3=latest?w3ByDate.get(latest.date):null;
  const lastValidW3=w3Replay.records.findLast(r=>r.valid)||null;
  const currentValid=Boolean(latestW3?.valid&&latestW3.date===w3Replay.lastInputDate);
  const distribution=latest?await getLatestDistribution(sql,latest.date):null;
  return {
    ok:true,version:'market-dynamic-v1.6-W3-D.1.2',latest,history,distribution,
    w3:{modelVersion:'W3-D.1.2',storageBytes:w3StorageBytes,
      regime:currentValid?latestW3.regime:null,
      warning:currentValid?latestW3.warning:false,
      warningActive:currentValid?latestW3.warningActive:false,
      warningOffCovered:currentValid?latestW3.offCovered:false,
      warningEvent:currentValid?latestW3.warningEvent:null,
      warningExitReason:currentValid?latestW3.warningExitReason:null,
      riskScore:currentValid?latestW3.score:null,
      lastValidRegime:lastValidW3?.regime||null,
      lastValidDate:lastValidW3?.date||null,
      source:'neon-stock-level-W3-D.1.2',sourceDate:w3Replay.lastInputDate,
      isLiveModel:currentValid,stale:!currentValid||Boolean(w3AuditError),
      error:w3AuditError,records:auditRecords,
      lastSwitchDate:lastSwitch,heldTradingDays,
      missingInstitutionalDays:inputs.filter(r=>r.institutional_value_twd===null).length,
      missingMarginDays:inputs.filter(r=>r.financing_value_twd===null).length,
      incompleteBreadthDays:inputs.filter(r=>!r.sourceQuality?.breadthReliable).length},
    meta:{returnedDays:history.length,retentionDays:KEEP_DAYS,source:'TWSE FMTQIK + StockZone TWSE/TPEx daily raw',refresh}
  };
}
// Lightweight official TWSE EOD index. Does not touch W3, market cache, or Neon.
// Turnover from this endpoint covers LISTED market only, never pretend it is TWSE+TPEx.
let lastIndexResult=null,lastIndexAt=0;
async function getMarketIndexQuote(){
  if(lastIndexResult&&Date.now()-lastIndexAt<180000)return lastIndexResult;
  const tw=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const year=Number(tw.slice(0,4)),month=Number(tw.slice(5,7));
  const prev=month===1?`${year-1}-12`:`${year}-${String(month-1).padStart(2,'0')}`;
  const entries=[];
  for(const mm of [tw.slice(0,7),prev]){
    const doc=await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${mm.replace('-','')}01&response=json`).catch(()=>null);
    const fields=Array.isArray(doc?.fields)?doc.fields:[];
    const di=fields.findIndex(x=>String(x).includes('日期'));
    const ci=fields.findIndex(x=>String(x).includes('發行量加權股價指數'));
    const vi=fields.findIndex(x=>String(x).includes('成交金額'));
    const pi=fields.findIndex(x=>String(x).includes('漲跌點數'));
    if(di<0||ci<0||vi<0)continue;
    for(const row of doc.data||[]){
      const date=rocToIso(row[di]),close=num(row[ci]),tradeValue=num(row[vi]);
      const delta=pi>=0?num(row[pi]):null;
      if(!date||date>tw||close===null||tradeValue===null)continue;
      const yesterday=delta===null?null:close-delta;
      const changePct=Number.isFinite(yesterday)&&yesterday>0?round(delta/yesterday*100,4):null;
      entries.push({date,taiexClose:close,tradeValue,changePct,source:'TWSE FMTQIK',turnoverMarket:'上市',dataType:'official_daily_close'});
    }
    if(entries.length)break;
  }
  if(!entries.length)throw new Error('證交所當月指數資料尚未發布');
  entries.sort((a,b)=>b.date.localeCompare(a.date));
  lastIndexResult={ok:true,...entries[0]};lastIndexAt=Date.now();
  return lastIndexResult;
}
module.exports={ensureMarketDynamicSchema,refreshMarketDynamic,getMarketDynamic,getMarketDynamicCached,refreshMarketSnapshot,readMarketSnapshot,getMarketIndexQuote,deriveRows};
