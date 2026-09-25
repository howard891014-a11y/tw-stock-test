const {getSql}=require('./db');
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const CACHE_MS=6*60*60*1000;
const FALLBACK=[
  {code:'1595',name:'川寶',market:'上櫃'},
  {code:'6187',name:'萬潤',market:'上櫃'},
  {code:'8064',name:'東捷',market:'上櫃'},
  {code:'2330',name:'台積電',market:'上市'}
];
let masterCache=null,masterCacheAt=0,masterPromise=null;
function clean(v=''){return String(v??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\u3000/g,' ').replace(/\s+/g,' ').trim()}
function compact(v=''){return clean(v).replace(/[-－]/g,'')}
function shortLegalName(v=''){return clean(v).replace(/股份有限公司$/,'').replace(/有限公司$/,'').replace(/公司$/,'')}
function pick(obj,keys){for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&clean(obj[k])!=='')return clean(obj[k])}return ''}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function fetchText(url,timeoutMs=6500,retries=1){let last;for(let i=0;i<=retries;i++){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/csv,text/plain,*/*','accept-language':'zh-TW,zh;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<retries)await sleep(220*(i+1))}finally{clearTimeout(t)}}throw last||new Error('官方資料暫時無法取得')}
async function fetchJson(url,timeoutMs=6500,retries=1){const text=await fetchText(url,timeoutMs,retries);try{return JSON.parse(text)}catch{throw new Error('官方資料格式錯誤')}}
function normalizeRows(rows,market){if(!Array.isArray(rows))return [];const out=[];for(const x of rows){const code=pick(x,['Code','code','SecuritiesCompanyCode','SecuritiesCode','公司代號','股票代號','證券代號','股票代碼']);const name=pick(x,['CompanyAbbreviation','SecuritiesCompanyAbbreviation','SecuritiesCompanyName','SecuritiesName','Name','name','CompanyName','公司簡稱','股票名稱','證券名稱','公司名稱']);if(!/^\d{4,6}$/.test(code)||!name)continue;out.push({code,name:shortLegalName(name),market})}return out}
function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;const s=String(text||'').replace(/^\uFEFF/,'');for(let i=0;i<s.length;i++){const ch=s[i];if(quoted){if(ch==='"'&&s[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=ch;}if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}return rows}
function csvRows(text,market){const rows=parseCsv(text);if(rows.length<2)return [];const headers=rows[0].map(clean),out=[];for(const r of rows.slice(1)){const obj={};headers.forEach((h,i)=>obj[h]=r[i]??'');const code=pick(obj,['公司代號','股票代號','證券代號','Code']);const name=pick(obj,['公司簡稱','公司名稱','股票名稱','證券名稱','CompanyName']);if(/^\d{4,6}$/.test(code)&&name)out.push({code,name:shortLegalName(name),market})}return out}
function dedupe(rows){const map=new Map();for(const r of rows||[]){if(!r?.code||!r?.name)continue;const key=`${r.market}|${r.code}`;const old=map.get(key);if(!old||clean(r.name).length<clean(old.name).length)map.set(key,r)}return [...map.values()]}
async function jsonSource(url,market){try{return normalizeRows(await fetchJson(url),market)}catch{return []}}
async function csvSource(url,market){try{return csvRows(await fetchText(url,8000,1),market)}catch{return []}}
async function buildMaster(){
  const listedSources=[
    ()=>jsonSource('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL','上市'),
    ()=>jsonSource('https://openapi.twse.com.tw/v1/opendata/t187ap03_L','上市'),
    ()=>csvSource('https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv','上市')
  ];
  const otcSources=[
    ()=>jsonSource('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes','上櫃'),
    ()=>jsonSource('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes','上櫃'),
    ()=>csvSource('https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv','上櫃')
  ];
  const run=async(list)=>{const parts=await Promise.all(list.map(fn=>fn()));return dedupe(parts.flat())};
  const [listed,otc]=await Promise.all([run(listedSources),run(otcSources)]);
  const rows=dedupe([...listed,...otc,...FALLBACK]);
  return {rows,availability:{listed:listed.length>0,otc:otc.length>0},counts:{listed:listed.length,otc:otc.length}};
}
async function officialMaster(){if(masterCache&&Date.now()-masterCacheAt<CACHE_MS)return masterCache;if(masterPromise)return masterPromise;masterPromise=buildMaster().then(v=>{masterCache=v;masterCacheAt=Date.now();return v}).finally(()=>{masterPromise=null});return masterPromise}

async function dbHits(q){
  const needle=clean(q);if(!needle)return [];
  try{
    const sql=getSql(),compactNeedle=compact(needle);
    const exact=await sql.query(`
      SELECT stock_code,stock_name,market
      FROM market_company_profile
      WHERE stock_code=$1 OR stock_name=$1 OR REPLACE(REPLACE(stock_name,'-',''),'－','')=$2
      ORDER BY CASE WHEN stock_code=$1 THEN 0 WHEN stock_name=$1 THEN 1 ELSE 2 END,market,stock_code
      LIMIT 8
    `,[needle,compactNeedle]);
    if(exact.length)return exact.map(x=>({code:String(x.stock_code),name:shortLegalName(x.stock_name),market:String(x.market||''),_score:1000}));
    if(!/^\d{4,6}$/.test(needle)&&needle.length>=2){
      const partial=await sql.query(`
        SELECT stock_code,stock_name,market
        FROM market_company_profile
        WHERE stock_name ILIKE '%' || $1 || '%'
        ORDER BY LENGTH(stock_name),stock_code
        LIMIT 8
      `,[needle]);
      return partial.map(x=>({code:String(x.stock_code),name:shortLegalName(x.stock_name),market:String(x.market||''),_score:800}));
    }
  }catch(e){console.warn('[stockmeta] DB master fallback',e?.message||e)}
  return [];
}

function rank(row,q){const code=row.code,name=clean(row.name),needle=clean(q);if(code===needle)return 1000;if(name===needle)return 980;if(compact(name)===compact(needle))return 970;if(name.startsWith(needle))return 850-Math.min(100,name.length-needle.length);if(name.includes(needle))return 750-Math.min(100,name.length-needle.length);return -1}
module.exports=async function handler(req,res){const q=clean(req.query?.q||'');if(!q)return res.status(400).json({ok:false,error:'缺少股票名稱或代碼'});try{const local=await dbHits(q);if(local.length){const best=local[0];res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=3600');return res.status(200).json({ok:true,code:best.code,name:best.name,market:best.market,symbol:`${best.code}${best.market==='上櫃'?'.TWO':'.TW'}`,matches:local.slice(0,8).map(({_score,...x})=>x),identitySource:'Neon market_company_profile',availability:{listed:true,otc:true}})}const master=await officialMaster();const hits=master.rows.map(x=>({...x,_score:rank(x,q)})).filter(x=>x._score>=0).sort((a,b)=>b._score-a._score||a.code.localeCompare(b.code));if(!hits.length)return res.status(404).json({ok:false,error:'官方主檔目前查無此名稱或代碼',availability:master.availability});const best=hits[0];res.setHeader('Cache-Control','s-maxage=21600, stale-while-revalidate=86400');return res.status(200).json({ok:true,code:best.code,name:best.name,market:best.market,symbol:`${best.code}${best.market==='上櫃'?'.TWO':'.TW'}`,matches:hits.slice(0,8).map(({_score,...x})=>x),identitySource:'TWSE/TPEx/MOPS open data',availability:master.availability})}catch(e){return res.status(503).json({ok:false,error:e?.message||'股票基本資料查詢失敗'})}}
