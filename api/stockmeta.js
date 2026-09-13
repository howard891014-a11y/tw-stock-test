const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const CACHE_MS=6*60*60*1000;
let masterCache=null,masterCacheAt=0,masterPromise=null;
function clean(v=''){return String(v??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\u3000/g,' ').replace(/\s+/g,' ').trim()}
function compact(v=''){return clean(v).replace(/[-－]/g,'')}
function shortLegalName(v=''){return clean(v).replace(/股份有限公司$/,'').replace(/有限公司$/,'').replace(/公司$/,'')}
function pick(obj,keys){for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&clean(obj[k])!=='')return clean(obj[k])}return ''}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function fetchText(url,timeoutMs=5000,retries=0){let last;for(let i=0;i<=retries;i++){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*','accept-language':'zh-TW,zh;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<retries)await sleep(180*(i+1))}finally{clearTimeout(t)}}throw last||new Error('官方資料暫時無法取得')}
async function fetchJson(url,timeoutMs=5000,retries=0){const text=await fetchText(url,timeoutMs,retries);try{return JSON.parse(text)}catch{throw new Error('官方資料格式錯誤')}}
function normalizeRows(rows,market){if(!Array.isArray(rows))return [];const out=[];for(const x of rows){const code=pick(x,['Code','code','SecuritiesCompanyCode','SecuritiesCode','公司代號','股票代號','證券代號','股票代碼']);const name=pick(x,['CompanyAbbreviation','SecuritiesCompanyAbbreviation','SecuritiesCompanyName','SecuritiesName','Name','name','CompanyName','公司簡稱','股票名稱','證券名稱','公司名稱']);if(!/^\d{4,6}$/.test(code)||!name)continue;out.push({code,name:shortLegalName(name),market})}return out}
function dedupe(rows){const map=new Map();for(const r of rows||[]){if(!r?.code||!r?.name)continue;const key=`${r.market}|${r.code}`;const old=map.get(key);if(!old||clean(r.name).length<clean(old.name).length)map.set(key,r)}return [...map.values()]}
async function sourceRows(url,market){try{return normalizeRows(await fetchJson(url),market)}catch{return []}}
async function buildMaster(){const sources=[
 ['https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL','上市'],
 ['https://openapi.twse.com.tw/v1/opendata/t187ap03_L','上市'],
 ['https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes','上櫃'],
 ['https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes','上櫃'],
 ['https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O','上櫃']
];const batches=await Promise.all(sources.map(async([u,m])=>({market:m,rows:await sourceRows(u,m)})));const listed=batches.filter(x=>x.market==='上市').flatMap(x=>x.rows),otc=batches.filter(x=>x.market==='上櫃').flatMap(x=>x.rows);if(!listed.length||!otc.length)throw new Error(`TWSE／TPEx 股票主檔暫時不完整（上市 ${listed.length?'正常':'失敗'}／上櫃 ${otc.length?'正常':'失敗'}）`);return dedupe([...listed,...otc])}
async function officialMaster(){if(masterCache&&Date.now()-masterCacheAt<CACHE_MS)return masterCache;if(masterPromise)return masterPromise;masterPromise=buildMaster().then(rows=>{masterCache=rows;masterCacheAt=Date.now();return rows}).finally(()=>{masterPromise=null});return masterPromise}
function rank(row,q){const code=row.code,name=clean(row.name),needle=clean(q);if(code===needle)return 1000;if(name===needle)return 980;if(compact(name)===compact(needle))return 970;if(name.startsWith(needle))return 850-Math.min(100,name.length-needle.length);if(name.includes(needle))return 750-Math.min(100,name.length-needle.length);return -1}
module.exports=async function handler(req,res){const q=clean(req.query?.q||'');if(!q)return res.status(400).json({ok:false,error:'缺少股票名稱或代碼'});try{const master=await officialMaster();const hits=master.map(x=>({...x,_score:rank(x,q)})).filter(x=>x._score>=0).sort((a,b)=>b._score-a._score||a.code.localeCompare(b.code));if(!hits.length)return res.status(404).json({ok:false,error:'找不到對應的台股名稱或代碼'});const best=hits[0];res.setHeader('Cache-Control','s-maxage=21600, stale-while-revalidate=86400');return res.status(200).json({ok:true,code:best.code,name:best.name,market:best.market,symbol:`${best.code}${best.market==='上櫃'?'.TWO':'.TW'}`,matches:hits.slice(0,8).map(({_score,...x})=>x),identitySource:'TWSE/TPEx OpenAPI'})}catch(e){return res.status(503).json({ok:false,error:e?.message||'股票基本資料查詢失敗'})}}
