const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const HEADERS={'user-agent':UA,'accept':'application/json,text/plain,*/*'};

function num(x){if(x===null||x===undefined||x==='')return null;x=Number(x);return Number.isFinite(x)?x:null}
function avg(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function sma(a,n){return a.length>=n?avg(a.slice(-n)):null}
function std(a,n){if(a.length<n)return null;const x=a.slice(-n),m=avg(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/n)}
function emaSeries(a,n){if(!a.length)return[];const k=2/(n+1),out=[a[0]];for(let i=1;i<a.length;i++)out.push(a[i]*k+out[i-1]*(1-k));return out}
function rsi(a,n=14){if(a.length<=n)return null;let g=0,l=0;for(let i=a.length-n;i<a.length;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}if(l===0)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs))}
function pct(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?(a/b-1)*100:null}
function round(x,d=2){return Number.isFinite(x)?Number(x.toFixed(d)):null}
function yahooSymbol(q,market){let s=String(q||'').trim().toUpperCase();if(/^[0-9]{4,6}$/.test(s))s+=String(market||'').includes('上櫃')?'.TWO':'.TW';return s}
function codeOf(v){return String(v||'').trim().toUpperCase().replace(/\.(?:TW|TWO)$/i,'')}
function marketSymbols(code,market){
  const m=String(market||'');
  if(m.includes('上櫃'))return [`${code}.TWO`,`${code}.TW`];
  if(m.includes('上市'))return [`${code}.TW`,`${code}.TWO`];
  return [`${code}.TW`,`${code}.TWO`];
}
async function fetchJson(url){const r=await fetch(url,{headers:HEADERS,redirect:'follow'});if(!r.ok)throw new Error(`Yahoo HTTP ${r.status}`);return r.json()}
async function chart(symbol){
  let last;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      const u=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&events=history&includeAdjustedClose=true`;
      const j=await fetchJson(u);
      const r=j?.chart?.result?.[0];
      if(r)return r;
      last=new Error(j?.chart?.error?.description||'Yahoo 無歷史資料');
    }catch(e){last=e}
  }
  throw last||new Error('Yahoo 歷史資料取得失敗');
}
async function fetchChart(symbol,period1,period2){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false&events=div%2Csplits`;
  const j=await fetchJson(url),x=j?.chart?.result?.[0];
  if(!x?.timestamp?.length)throw Error(`Yahoo ${symbol} 無歷史資料`);
  const q=x.indicators?.quote?.[0]||{},adj=x.indicators?.adjclose?.[0]?.adjclose||[];
  const rows=[];
  for(let i=0;i<x.timestamp.length;i++){
    const close=num(q.close?.[i]);
    if(close===null)continue;
    const ts=Number(x.timestamp[i]);
    rows.push({timestamp:ts,date:new Date(ts*1000).toISOString().slice(0,10),open:num(q.open?.[i]),high:num(q.high?.[i]),low:num(q.low?.[i]),close,adjClose:num(adj[i]),volume:num(q.volume?.[i])});
  }
  return {symbol,rows,meta:x.meta||{}};
}
async function firstChart(symbols,period1,period2){let last=null;for(const s of symbols){try{return await fetchChart(s,period1,period2)}catch(e){last=e}}throw last||Error('Yahoo 歷史資料取得失敗')}

async function handleHistory(req,res){
  const code=codeOf(req.query.q||req.query.code||req.query.symbol),market=String(req.query.market||'');
  if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:'股票代碼格式錯誤'});
  try{
    const now=Math.floor(Date.now()/1000),period2=now+86400,period1=now-Math.round(5.35*365.25*86400);
    const stockPromise=firstChart(marketSymbols(code,market),period1,period2);
    const benchmarkSymbols=market.includes('上櫃')?['^TWOII','^TWII']:['^TWII'];
    const benchmarkPromise=firstChart(benchmarkSymbols,period1,period2).catch(()=>null);
    const [stock,benchmark]=await Promise.all([stockPromise,benchmarkPromise]);
    const cutoff=now-Math.round(5*365.25*86400);
    const stockRows=stock.rows.filter(x=>Number(x.timestamp)>=cutoff);
    const benchmarkRows=benchmark?.rows?.filter(x=>Number(x.timestamp)>=cutoff)||[];
    res.setHeader('Cache-Control','public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ok:true,source:'Yahoo Finance',code,market,symbol:stock.symbol,windowYears:5,updatedAt:new Date().toISOString(),history:stockRows,benchmark:benchmark?{symbol:benchmark.symbol,history:benchmarkRows}:null});
  }catch(e){
    return res.status(502).json({ok:false,error:e?.message||'五年歷史資料取得失敗'});
  }
}



const FUND_TYPES=[
  'quarterlyDilutedEPS','quarterlyBasicEPS','quarterlyTotalRevenue','quarterlyOperatingRevenue',
  'quarterlyGrossProfit','quarterlyOperatingIncome','quarterlyTotalOperatingIncomeAsReported',
  'quarterlyNetIncome','quarterlyNetIncomeCommonStockholders'
];
const OFFICIAL_CACHE_MS=6*60*60*1000;
const officialEndpointCache=new Map();
const TWSE_BASE='https://openapi.twse.com.tw/v1';
const TPEX_BASE='https://www.tpex.org.tw/openapi/v1';
const OFFICIAL_MARKETS={
  listed:{label:'上市',base:TWSE_BASE,monthly:'/opendata/t187ap05_L',statement:[
    ['general','一般業','/opendata/t187ap06_L_ci'],['financial','金融業','/opendata/t187ap06_L_basi'],['securities','證券期貨業','/opendata/t187ap06_L_bd'],['holding','金控業','/opendata/t187ap06_L_fh'],['insurance','保險業','/opendata/t187ap06_L_ins'],['mixed','異業','/opendata/t187ap06_L_mim']
  ]},
  otc:{label:'上櫃',base:TPEX_BASE,monthly:'/mopsfin_t187ap05_O',statement:[
    ['general','一般業','/mopsfin_t187ap06_O_ci'],['financial','金融業','/mopsfin_t187ap06_O_basi'],['securities','證券期貨業','/mopsfin_t187ap06_O_bd'],['holding','金控業','/mopsfin_t187ap06_O_fh'],['insurance','保險業','/mopsfin_t187ap06_O_ins'],['mixed','異業','/mopsfin_t187ap06_O_mim']
  ]}
};
function rawReported(x){const v=x?.reportedValue?.raw??x?.raw??null;return num(v)}
function quarterLabel(date){const m=String(date||'').match(/^(\d{4})-(\d{2})/);if(!m)return String(date||'');return `${m[1]} Q${Math.ceil(Number(m[2])/3)}`}
function officialNum(v){
  if(v===null||v===undefined)return null;let s=String(v).trim();if(!s||s==='--'||s==='-'||s==='N/A')return null;
  const neg=/^\(.*\)$/.test(s);s=s.replace(/[,%％元千百萬億\s]/g,'').replace(/[()]/g,'');const n=Number(s);return Number.isFinite(n)?(neg?-n:n):null;
}
function officialText(row,patterns){
  if(!row||typeof row!=='object')return null;const keys=Object.keys(row);
  for(const p of patterns){const k=keys.find(x=>p.test(String(x)));if(k!==undefined){const v=row[k];if(v!==null&&v!==undefined&&String(v).trim()!=='')return String(v).trim()}}
  return null;
}
function officialValue(row,patterns){const t=officialText(row,patterns);return officialNum(t)}
function officialCode(row){return String(officialText(row,[/^公司代號$/, /^公司代碼$/, /^證券代號$/, /^Code$/i])||'').trim()}
function rocYearToAd(v){const n=Number(String(v||'').replace(/\D/g,''));return Number.isFinite(n)&&n>0?(n<1911?n+1911:n):null}
function officialPeriod(row){
  const y=rocYearToAd(officialText(row,[/^年度$/, /^年$/, /資料年度/, /會計年度/]));let q=Number(String(officialText(row,[/^季別$/, /^季$/, /季別/])||'').replace(/\D/g,''));
  if(!(q>=1&&q<=4))q=null;return {year:y,quarter:q,label:y&&q?`${y} Q${q}`:y?String(y):null};
}
async function fetchOfficialRows(url){
  const c=officialEndpointCache.get(url);if(c&&Date.now()-c.savedAt<OFFICIAL_CACHE_MS&&Array.isArray(c.data))return c.data;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
  try{
    const r=await fetch(url,{headers:{...HEADERS,'accept':'application/json'},redirect:'follow',signal:ctl.signal});if(!r.ok)throw new Error(`官方 OpenAPI HTTP ${r.status}`);
    const j=await r.json();if(!Array.isArray(j))throw new Error('官方 OpenAPI 格式異常');officialEndpointCache.set(url,{savedAt:Date.now(),data:j});return j;
  }finally{clearTimeout(timer)}
}
function findOfficialRow(rows,code){return Array.isArray(rows)?rows.find(x=>officialCode(x)===String(code)):null}
function parseMonthlyRevenue(row,marketLabel,endpoint){
  if(!row)return null;const period=officialText(row,[/^資料年月$/, /資料年月/, /年月/]);
  return {market:marketLabel,period,
    revenue:officialValue(row,[/^營業收入-當月營收$/, /當月營收$/]),
    lastMonthRevenue:officialValue(row,[/^營業收入-上月營收$/, /上月營收$/]),
    yearAgoRevenue:officialValue(row,[/^營業收入-去年當月營收$/, /去年當月營收$/]),
    momPct:officialValue(row,[/^營業收入-上月比較增減\(%\)$/, /上月比較增減/]),
    yoyPct:officialValue(row,[/^營業收入-去年同月增減\(%\)$/, /去年同月增減/]),
    cumulativeRevenue:officialValue(row,[/^累計營業收入-當月累計營收$/, /當月累計營收/]),
    priorCumulativeRevenue:officialValue(row,[/^累計營業收入-去年累計營收$/, /去年累計營收/]),
    cumulativeYoyPct:officialValue(row,[/^累計營業收入-前期比較增減\(%\)$/, /累計.*增減/]),
    source:'官方月營收',endpoint};
}
function parseOfficialStatement(row,typeKey,typeLabel,marketLabel,endpoint){
  if(!row)return null;const p=officialPeriod(row),isGeneral=typeKey==='general';
  const revenue=officialValue(row,isGeneral?
    [/^營業收入$/, /營業收入合計/, /^收入合計$/, /^營收$/]:
    [/^營業收入$/, /淨收益/, /收益合計/, /利息淨收益/, /收入合計/, /^收入$/]);
  const grossProfit=officialValue(row,[/營業毛利/, /毛利（毛損）/, /毛利\(毛損\)/, /^毛利$/]);
  const operatingIncome=officialValue(row,[/^營業利益/, /營業利益（損失）/, /營業損益/, /營業淨利/]);
  const netIncome=officialValue(row,[/歸屬於母公司.*淨利/, /^本期淨利/, /本期淨利（淨損）/, /本期損益/, /稅後淨利/]);
  const eps=officialValue(row,[/基本每股盈餘/, /每股盈餘/]);
  const grossMargin=isGeneral&&Number.isFinite(revenue)&&revenue!==0&&Number.isFinite(grossProfit)?round(grossProfit/revenue*100):null;
  const operatingMargin=isGeneral&&Number.isFinite(revenue)&&revenue!==0&&Number.isFinite(operatingIncome)?round(operatingIncome/revenue*100):null;
  return {market:marketLabel,financialType:typeKey,financialTypeLabel:typeLabel,period:p.label,year:p.year,quarter:p.quarter,basis:'cumulative',revenue,grossProfit,operatingIncome,netIncome,eps,grossMargin,operatingMargin,marginApplicable:isGeneral,source:'官方綜合損益表',endpoint};
}
async function findOfficialStatement(code,def){
  const [first,...rest]=def.statement,errors=[];
  try{const rows=await fetchOfficialRows(def.base+first[2]),row=findOfficialRow(rows,code);if(row)return parseOfficialStatement(row,first[0],first[1],def.label,def.base+first[2])}catch(e){errors.push(e?.message||String(e))}
  const results=await Promise.all(rest.map(async x=>{try{const rows=await fetchOfficialRows(def.base+x[2]),row=findOfficialRow(rows,code);return row?parseOfficialStatement(row,x[0],x[1],def.label,def.base+x[2]):null}catch(e){errors.push(e?.message||String(e));return null}}));
  const found=results.find(Boolean);if(found)return found;return {missing:true,errors:[...new Set(errors)].slice(0,3)};
}
async function fetchOfficialMarketFundamentals(code,key){
  const def=OFFICIAL_MARKETS[key],monthlyUrl=def.base+def.monthly;
  const [statementResult,monthlyResult]=await Promise.allSettled([
    findOfficialStatement(code,def),
    fetchOfficialRows(monthlyUrl).then(rows=>parseMonthlyRevenue(findOfficialRow(rows,code),def.label,monthlyUrl))
  ]);
  const statement=statementResult.status==='fulfilled'&&!statementResult.value?.missing?statementResult.value:null;
  const monthly=monthlyResult.status==='fulfilled'?monthlyResult.value:null;
  return {market:def.label,statement,monthly,errors:[statementResult.status==='rejected'?statementResult.reason?.message:null,monthlyResult.status==='rejected'?monthlyResult.reason?.message:null].filter(Boolean)};
}
async function fetchOfficialFundamentals(code,market){
  const m=String(market||''),order=m.includes('上櫃')?['otc','listed']:m.includes('上市')?['listed','otc']:['listed','otc'];let fallback=null;
  for(const key of order){const x=await fetchOfficialMarketFundamentals(code,key);if(x.statement||x.monthly)return x;if(!fallback)fallback=x}
  return fallback||{market:null,statement:null,monthly:null,errors:['官方資料未找到股票代號']};
}
async function fetchFundamentalSeries(symbol,period1,period2){
  const qs=FUND_TYPES.map(x=>`type=${encodeURIComponent(x)}`).join('&');
  let last=null;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
      const url=`https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&${qs}&period1=${period1}&period2=${period2}&padTimeSeries=true`;
      const r=await fetch(url,{headers:{...HEADERS,'origin':'https://finance.yahoo.com','referer':`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/financials/`},redirect:'follow'});
      if(!r.ok)throw new Error(`Yahoo fundamentals HTTP ${r.status}`);
      const j=await r.json(),result=j?.timeseries?.result||[];
      if(!Array.isArray(result)||!result.length)throw new Error('Yahoo fundamentals 無資料');
      const map=new Map();
      for(const block of result){
        for(const key of FUND_TYPES){
          const arr=Array.isArray(block?.[key])?block[key]:[];
          for(const item of arr){
            const date=String(item?.asOfDate||item?.reportedDate||'').slice(0,10);if(!date)continue;
            if(!map.has(date))map.set(date,{date});
            const v=rawReported(item);if(v!==null)map.get(date)[key]=v;
          }
        }
      }
      const rows=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>{
        const eps=num(x.quarterlyDilutedEPS)??num(x.quarterlyBasicEPS),revenue=num(x.quarterlyTotalRevenue)??num(x.quarterlyOperatingRevenue),
          grossProfit=num(x.quarterlyGrossProfit),operatingIncome=num(x.quarterlyOperatingIncome)??num(x.quarterlyTotalOperatingIncomeAsReported),
          netIncome=num(x.quarterlyNetIncome)??num(x.quarterlyNetIncomeCommonStockholders);
        return {period:quarterLabel(x.date),date:x.date,eps,revenue,grossProfit,operatingIncome,netIncome,
          grossMargin:revenue&&grossProfit!==null?round(grossProfit/revenue*100):null,
          operatingMargin:revenue&&operatingIncome!==null?round(operatingIncome/revenue*100):null};
      }).filter(x=>[x.eps,x.revenue,x.grossProfit,x.operatingIncome,x.netIncome].some(Number.isFinite));
      if(!rows.length)throw new Error('Yahoo fundamentals 無可用季度資料');
      return {symbol,rows};
    }catch(e){last=e}
  }
  throw last||new Error('Yahoo fundamentals 取得失敗');
}
async function handleFundamentals(req,res){
  const code=codeOf(req.query.q||req.query.code||req.query.symbol),market=String(req.query.market||'');
  if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:'股票代碼格式錯誤'});
  try{
    const now=Math.floor(Date.now()/1000),period2=now+86400,period1=now-Math.round(3.5*365.25*86400);
    const officialPromise=fetchOfficialFundamentals(code,market).catch(e=>({market:null,statement:null,monthly:null,errors:[e?.message||String(e)]}));
    const yahooPromise=(async()=>{let data,last=null;for(const s of marketSymbols(code,market)){try{data=await fetchFundamentalSeries(s,period1,period2);break}catch(e){last=e}}return data?{data,error:null}:{data:null,error:last?.message||'Yahoo fundamentals 無資料'}})();
    const [official,yahoo]=await Promise.all([officialPromise,yahooPromise]);
    const quarters=yahoo.data?.rows?.slice(-12).reverse()||[];
    if(!official?.statement&&!official?.monthly&&!quarters.length)throw new Error([...(official?.errors||[]),yahoo.error].filter(Boolean).join('；')||'長期基本面資料取得失敗');
    const coverage={eps:quarters.filter(x=>Number.isFinite(x.eps)).length,revenue:quarters.filter(x=>Number.isFinite(x.revenue)).length,grossMargin:quarters.filter(x=>Number.isFinite(x.grossMargin)).length,operatingMargin:quarters.filter(x=>Number.isFinite(x.operatingMargin)).length,officialStatement:!!official?.statement,officialMonthlyRevenue:!!official?.monthly};
    const src=[];if(official?.statement)src.push(`${official.market}官方綜合損益表`);if(official?.monthly)src.push(`${official.market}官方月營收`);if(quarters.length)src.push('Yahoo歷史季度補充');
    res.setHeader('Cache-Control','public, s-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({ok:true,source:src.join(' + '),code,market:official?.market||market,symbol:yahoo.data?.symbol||null,updatedAt:new Date().toISOString(),officialStatement:official?.statement||null,monthlyRevenue:official?.monthly||null,quarters,coverage,sources:{official:!!(official?.statement||official?.monthly),yahooHistory:quarters.length>0,officialErrors:official?.errors||[],yahooError:yahoo.error||null}});
  }catch(e){return res.status(502).json({ok:false,error:e?.message||'長期基本面資料取得失敗'})}
}

async function handleTechnical(req,res){
  const q=req.query?.q,market=req.query?.market||'';
  if(!q)return res.status(400).json({ok:false,error:'缺少股票代碼'});
  const symbol=yahooSymbol(q,market),r=await chart(symbol),ts=r.timestamp||[],z=r.indicators?.quote?.[0]||{};
  const rows=ts.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),open:num(z.open?.[i]),high:num(z.high?.[i]),low:num(z.low?.[i]),close:num(z.close?.[i]),volume:num(z.volume?.[i])})).filter(x=>[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(v)&&v>0)&&Number.isFinite(x.volume)&&x.volume>=0&&x.high>=x.low&&x.high>=x.open&&x.high>=x.close&&x.low<=x.open&&x.low<=x.close);
  if(rows.length<60)throw new Error('Yahoo 歷史資料不足 60 個交易日');
  const c=rows.map(x=>x.close),v=rows.map(x=>x.volume),last=c.at(-1),ma5=sma(c,5),ma10=sma(c,10),ma20=sma(c,20),ma60=sma(c,60);
  const sd20=std(c,20),upper=ma20+2*sd20,lower=ma20-2*sd20,bw=ma20?((upper-lower)/ma20)*100:null;
  const e12=emaSeries(c,12),e26=emaSeries(c,26),dif=e12.map((x,i)=>x-e26[i]),signal=emaSeries(dif.slice(25),9),difLast=dif.at(-1),sigLast=signal.at(-1),hist=difLast-sigLast;
  const vol5=sma(v,5),vol20=sma(v,20),volRatio=vol20?v.at(-1)/vol20:null;
  const recent60=rows.slice(-60),high60=Math.max(...recent60.map(x=>x.high??x.close)),low60=Math.min(...recent60.map(x=>x.low??x.close));
  const bias5=pct(last,ma5),bias10=pct(last,ma10),bias20=pct(last,ma20),bias60=pct(last,ma60);
  const maOrder=last>ma5&&ma5>ma10&&ma10>ma20&&ma20>ma60?'多頭排列':last<ma5&&ma5<ma10&&ma10<ma20&&ma20<ma60?'空頭排列':'均線交錯';
  const prev=rows.at(-2),dayPct=prev?.close?pct(last,prev.close):0;
  let maScore=50,maState='整理',maTone='neutral';
  const above=[ma5,ma10,ma20,ma60].filter(x=>last>x).length;if(maOrder==='多頭排列'){maScore=90;maState='強勢';maTone='good'}else if(maOrder==='空頭排列'){maScore=15;maState='弱勢';maTone='bad'}else if(above>=3){maScore=70;maState='偏多';maTone='good'}else if(above<=1){maScore=35;maState='偏空';maTone='bad'}
  const maConclusion=maOrder==='多頭排列'?'股價與均線呈多頭排列':maOrder==='空頭排列'?'股價與均線呈空頭排列':above>=3?'股價站上多數均線，短線偏多':above<=1?'股價跌破多數均線，短線偏弱':'均線交錯，方向尚未明確';
  let bollPos='中軌附近';if(last>=upper)bollPos='上軌以上';else if(last>ma20)bollPos='中上軌';else if(last<=lower)bollPos='下軌以下';else if(last<ma20)bollPos='中下軌';
  let bollScore=55,bollState='中性',bollTone='watch';if(last>=upper){bollScore=82;bollState='強勢';bollTone='good'}else if(last>ma20){bollScore=68;bollState='偏多';bollTone='good'}else if(last<=lower){bollScore=20;bollState='弱勢';bollTone='bad'}else if(last<ma20){bollScore=40;bollState='偏空';bollTone='bad'}
  const bollConclusion=`位於${bollPos}，帶寬${bw<12?'收縮':bw>25?'擴張':'正常'}`;
  let biasState='正常',biasTone='good';const ab=Math.abs(bias20??0);if(ab>10){biasState=bias20>0?'過熱':'超跌';biasTone='bad'}else if(ab>5){biasState=bias20>0?'偏高':'偏低';biasTone='watch'}const biasConclusion=`20MA乖離 ${round(bias20)}%，${biasState==='正常'?'與均線距離正常':biasState}`;
  let volScore=55,volState='健康',volTone='good',volConclusion='量能正常';if(volRatio>=1.5&&dayPct>0){volScore=85;volState='強勢';volConclusion='放量上漲，量價配合'}else if(volRatio>=1.5&&dayPct<0){volScore=20;volState='危險';volTone='bad';volConclusion='放量下跌，賣壓偏重'}else if(volRatio<0.7){volScore=50;volState='量縮';volTone='watch';volConclusion=dayPct>=0?'量縮上漲，追價力道有限':'量縮整理，賣壓未明顯放大'}else{volConclusion=dayPct>=0?'量價正常，未見異常爆量':'量能正常，短線回檔'}
  let trendScore=55,trendState='中性',trendTone='watch',trendConclusion='位於60日區間中段';const fh=pct(last,high60),fl=pct(last,low60);if(fh>=-3){trendScore=82;trendState='接近前高';trendTone='good';trendConclusion='接近60日高點，留意突破'}else if(fh>=-10){trendScore=70;trendState='偏強';trendTone='good';trendConclusion='位於60日區間上緣'}else if(fl<=8){trendScore=30;trendState='接近低點';trendTone='bad';trendConclusion='接近60日低點，留意支撐'}
  const rv=rsi(c,14);let momScore=55,momState='中性',momTone='watch';if(rv>=60&&hist>0){momScore=80;momState='偏多';momTone='good'}else if(rv<40&&hist<0){momScore=25;momState='偏空';momTone='bad'}else if(hist>0){momScore=65;momState='偏多';momTone='good'}else if(hist<0){momScore=40;momState='偏弱';momTone='bad'}const momConclusion=`RSI ${round(rv)}，MACD柱狀體${hist>=0?'為正':'為負'}`;
  const score=Math.round(maScore*.30+bollScore*.25+volScore*.25+momScore*.20);let overallState='整理',overallTone='watch';if(score>=80){overallState='強勢';overallTone='good'}else if(score>=65){overallState='偏多';overallTone='good'}else if(score<35){overallState='弱勢';overallTone='bad'}else if(score<50){overallState='偏空';overallTone='bad'}
  const headline=`${maState==='偏多'||maState==='強勢'?'均線有支撐':'均線仍需確認'}，${volConclusion}，${trendConclusion}`;const summary=`目前技術面${overallState}；${maConclusion}，${bollConclusion}，${volConclusion}。${trendConclusion}，動能${momState}。`;
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ok:true,source:'Yahoo Finance',symbol,updatedAt:rows.at(-1).date,count:rows.length,latest:rows.at(-1),ma:{ma5:round(ma5),ma10:round(ma10),ma20:round(ma20),ma60:round(ma60),order:maOrder,bias20:round(bias20)},bias:{ma5:round(bias5),ma10:round(bias10),ma20:round(bias20),ma60:round(bias60)},bollinger:{middle:round(ma20),upper:round(upper),lower:round(lower),bandwidth:round(bw),position:bollPos},volume:{current:round(v.at(-1),0),avg5:round(vol5,0),avg20:round(vol20,0),ratio20:round(volRatio)},trend:{high60:round(high60),low60:round(low60),fromHigh60Pct:round(pct(last,high60)),fromLow60Pct:round(pct(last,low60))},momentum:{rsi14:round(rv),macd:round(difLast),signal:round(sigLast),histogram:round(hist)},analysis:{overall:{state:overallState,tone:overallTone,score,headline,summary},ma:{state:maState,tone:maTone,conclusion:maConclusion},bollinger:{state:bollState,tone:bollTone,conclusion:bollConclusion},bias:{state:biasState,tone:biasTone,conclusion:biasConclusion},volume:{state:volState,tone:volTone,conclusion:volConclusion},trend:{state:trendState,tone:trendTone,conclusion:trendConclusion},momentum:{state:momState,tone:momTone,conclusion:momConclusion}},history:rows.slice(-120)});
}

export default async function handler(req,res){
  try{
    const mode=String(req.query?.mode||'').toLowerCase();
    if(mode==='history')return await handleHistory(req,res);
    if(mode==='fundamentals')return await handleFundamentals(req,res);
    return await handleTechnical(req,res);
  }catch(e){
    return res.status(500).json({ok:false,error:e?.message||'技術資料取得失敗'});
  }
}
