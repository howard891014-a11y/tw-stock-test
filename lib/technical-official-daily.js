// v2.7.0.3: read-only, bounded repair of a Yahoo daily K that lags an already
// completed TWSE / TPEx official daily close stored in Neon. No data writes.
'use strict';
const OFFICIAL_SOURCES=new Set(['TWSE MI_INDEX','TPEx mainboard daily close']);
const dateKey=x=>String(x||'').slice(0,10);
function valid(row){
 const n=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dateKey(row?.date)))return false;
 if(![row.open,row.high,row.low,row.close,row.volume].every(n))return false;
 const {open,high,low,close}=row;
 return high>=Math.max(open,close,low)&&low<=Math.min(open,close,high);
}
function normalize(row){
 const v={date:dateKey(row.trade_date),open:Number(row.open_price),high:Number(row.high_price),low:Number(row.low_price),close:Number(row.close_price),volume:Number(row.trade_volume),timestamp:Date.parse(dateKey(row.trade_date)+'T01:00:00Z')/1000};
 return OFFICIAL_SOURCES.has(row.source)&&valid(v)?v:null;
}
function recognizedMarket(m){return String(m||'').includes('上櫃')?'上櫃':String(m||'').includes('上市')?'上市':'';}
async function mergeOfficialDailyBars(yahooRows,{code,market,sql}={}){
 const rows=Array.isArray(yahooRows)?yahooRows:[],last=rows.at(-1);
 const plain={rows,added:0,source:'Yahoo Finance',reason:'no-change'};
 if(!valid(last)||!/^[0-9]{4,6}$/.test(String(code||''))||typeof sql?.query!=='function')return plain;
 try{
   // Only a small tail. The five-year Yahoo series is never replaced, and
   // current intraday/unverified snapshots are not used as finished candles.
   const recent=await sql.query(`SELECT trade_date::text,open_price,high_price,low_price,close_price,trade_volume,market,source
     FROM market_daily_history
     WHERE stock_code=$1 AND ($2::text='' OR market=$2)
       AND trade_date >= $3::date - INTERVAL '15 days'
       AND trade_date <= (NOW() AT TIME ZONE 'Asia/Taipei')::date
       AND source IN ('TWSE MI_INDEX','TPEx mainboard daily close')
     ORDER BY trade_date DESC LIMIT 10`,[String(code),recognizedMarket(market),last.date]);
   const map=new Map();
   for(const raw of recent||[]){const r=normalize(raw);if(r)map.set(r.date,r)}
   const anchor=map.get(last.date),latest=[...map.keys()].sort().at(-1);
   if(!anchor||!latest||latest<=last.date)return plain;
   // Must prove same unadjusted-price basis as Yahoo. Corporate actions or
   // inconsistent calendars invalidate the merge; never splice mismatched bars.
   if(Math.abs(anchor.close-last.close)/last.close>0.005)return {...plain,reason:'price-basis-mismatch'};
   const additions=[...map.values()].filter(r=>r.date>last.date).sort((a,b)=>a.date.localeCompare(b.date));
   if(!additions.length||additions.length>5)return plain;
   return {rows:[...rows,...additions],added:additions.length,source:'Yahoo Finance + TWSE/TPEx official close (Neon)',reason:'official-close-bridged'};
 }catch(e){return {...plain,reason:'neon-unavailable'};}
}
module.exports={mergeOfficialDailyBars};
