const { getSql } = require('./db');
const { STORAGE_POLICY } = require('./storage-policy');

const SOURCE = 'StockZone market-dynamic-v1';
const KEEP_DAYS = Number(STORAGE_POLICY?.compact?.marketDynamics || 500);
let schemaReady = false;

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g,'').replace(/<[^>]+>/g,''));
  return Number.isFinite(n) ? n : null;
};
const round = (v,d=4) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
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
      trust_net numeric(24,0),
      dealer_net numeric(24,0),
      total_institutional_net numeric(24,0),
      coverage_pct numeric(8,4),
      source text NOT NULL DEFAULT 'StockZone market-dynamic-v1',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
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
  for(const month of months){
    try{
      const ymd=month.replace('-','')+'01';
      const j=await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${ymd}&response=json`);
      const fields=Array.isArray(j?.fields)?j.fields:[];
      const di=fields.findIndex(x=>String(x).includes('日期'));
      const ci=fields.findIndex(x=>String(x).includes('發行量加權股價指數'));
      if(di<0||ci<0)continue;
      for(const row of j?.data||[]){
        const d=rocToIso(row?.[di]),close=num(row?.[ci]);
        if(d&&Number.isFinite(close))out.set(d,close);
      }
    }catch(e){console.warn('market-dynamic TAIEX fetch failed',month,e?.message||e)}
  }
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
async function rawInstitutionalRows(sql){
  return sql.query(`
    SELECT trade_date::text AS trade_date,
      COALESCE(SUM(foreign_net),0)::numeric AS foreign_net,
      COALESCE(SUM(trust_net),0)::numeric AS trust_net,
      COALESCE(SUM(dealer_net),0)::numeric AS dealer_net,
      COALESCE(SUM(total_net),0)::numeric AS total_institutional_net
    FROM institutional_trading_daily
    WHERE market IN ('上市','上櫃')
    GROUP BY trade_date
    ORDER BY trade_date
  `);
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
      foreign_net:num(i.foreign_net)||0,trust_net:num(i.trust_net)||0,dealer_net:num(i.dealer_net)||0,
      total_institutional_net:num(i.total_institutional_net)||0,
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
        foreign_net,trust_net,dealer_net,total_institutional_net,coverage_pct,source,updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now()
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
        source=EXCLUDED.source,updated_at=now()
    `,[
      r.trade_date,r.taiex_close,round(r.taiex_change_pct),round(r.taiex_return_5_pct),round(r.taiex_return_20_pct),
      round(r.ma20_gap_pct),round(r.ma60_gap_pct),round(r.volatility_20_pct),round(r.drawdown_20_pct),
      r.up_count,r.down_count,r.flat_count,round(r.advance_ratio),round(r.breadth_5),r.total_trade_value,
      r.foreign_net,r.trust_net,r.dealer_net,r.total_institutional_net,round(r.coverage_pct),SOURCE
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
  if(!force&&dbLatest===latest)return {ok:true,skipped:true,latest,written:0};
  const inst=await rawInstitutionalRows(sql);
  const months=[...new Set(raw.map(r=>iso(r.trade_date).slice(0,7)))];
  const taiex=await fetchTaiexMonths(months);
  const derived=deriveRows(raw,inst,taiex);
  const existing=await sql.query(`SELECT trade_date::text AS trade_date FROM market_dynamic_daily`);
  const have=new Set(existing.map(r=>iso(r.trade_date)));
  const pending=derived.filter((r,i)=>force||!have.has(r.trade_date)||r.trade_date===latest||(i>=derived.length-60&&r.taiex_close===null));
  const written=await upsertRows(sql,pending);
  await prune(sql);
  return {ok:true,latest,written,sourceDays:raw.length,taiexDays:taiex.size,retentionDays:KEEP_DAYS};
}
function rowOut(r){
  const N=v=>v===null||v===undefined?null:Number(v);
  return {
    date:iso(r.trade_date),taiexClose:N(r.taiex_close),changePct:N(r.taiex_change_pct),
    ret5:N(r.taiex_return_5_pct),ret20:N(r.taiex_return_20_pct),
    ma20Gap:N(r.ma20_gap_pct),ma60Gap:N(r.ma60_gap_pct),vol20:N(r.volatility_20_pct),drawdown20:N(r.drawdown_20_pct),
    up:Number(r.up_count)||0,down:Number(r.down_count)||0,flat:Number(r.flat_count)||0,
    advanceRatio:N(r.advance_ratio),breadth5:N(r.breadth_5),tradeValue:N(r.total_trade_value),
    foreignNet:N(r.foreign_net),trustNet:N(r.trust_net),dealerNet:N(r.dealer_net),institutionalNet:N(r.total_institutional_net),
    coverage:N(r.coverage_pct)
  };
}
async function getMarketDynamic({days=60,force=false}={}){
  const sql=getSql(); await ensureMarketDynamicSchema(sql);
  const refresh=await refreshMarketDynamic({force});
  const lim=Math.max(20,Math.min(120,Number(days)||60));
  const rows=await sql.query(`SELECT * FROM market_dynamic_daily ORDER BY trade_date DESC LIMIT $1`,[lim]);
  const history=rows.map(rowOut);
  return {
    ok:true,version:'market-dynamic-v1',latest:history[0]||null,history,
    meta:{returnedDays:history.length,retentionDays:KEEP_DAYS,source:'TWSE FMTQIK + StockZone TWSE/TPEx daily raw',refresh}
  };
}
module.exports={ensureMarketDynamicSchema,refreshMarketDynamic,getMarketDynamic,deriveRows};
