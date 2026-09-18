const HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*"};
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function codeOf(v){return String(v||"").trim().toUpperCase().replace(/\.(?:TW|TWO)$/i,"")}
function marketSymbols(code,market){
  const m=String(market||"");
  if(m.includes("上櫃"))return [`${code}.TWO`,`${code}.TW`];
  if(m.includes("上市"))return [`${code}.TW`,`${code}.TWO`];
  return [`${code}.TW`,`${code}.TWO`];
}
async function fetchChart(symbol,period1,period2){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false&events=div%2Csplits`;
  const r=await fetch(url,{headers:HEADERS});if(!r.ok)throw Error(`Yahoo ${symbol} HTTP ${r.status}`);
  const j=await r.json(),x=j?.chart?.result?.[0];if(!x?.timestamp?.length)throw Error(`Yahoo ${symbol} 無歷史資料`);
  const q=x.indicators?.quote?.[0]||{},adj=x.indicators?.adjclose?.[0]?.adjclose||[];
  const rows=[];
  for(let i=0;i<x.timestamp.length;i++){
    const close=num(q.close?.[i]);if(close===null)continue;
    const ts=Number(x.timestamp[i]);
    rows.push({timestamp:ts,date:new Date(ts*1000).toISOString().slice(0,10),open:num(q.open?.[i]),high:num(q.high?.[i]),low:num(q.low?.[i]),close,adjClose:num(adj[i]),volume:num(q.volume?.[i])});
  }
  return {symbol,rows,meta:x.meta||{}};
}
async function firstChart(symbols,period1,period2){let last=null;for(const s of symbols){try{return await fetchChart(s,period1,period2)}catch(e){last=e}}throw last||Error("Yahoo 歷史資料取得失敗")}
module.exports=async function handler(req,res){
  res.setHeader("Cache-Control","public, s-maxage=21600, stale-while-revalidate=86400");
  const code=codeOf(req.query.q||req.query.code||req.query.symbol),market=String(req.query.market||"");
  if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:"股票代碼格式錯誤"});
  try{
    const now=Math.floor(Date.now()/1000),period2=now+86400,period1=now-Math.round(3.35*365.25*86400);
    const stockPromise=firstChart(marketSymbols(code,market),period1,period2);
    const benchmarkSymbols=market.includes("上櫃")?["^TWOII","^TWII"]:["^TWII"];
    const benchmarkPromise=firstChart(benchmarkSymbols,period1,period2).catch(()=>null);
    const [stock,benchmark]=await Promise.all([stockPromise,benchmarkPromise]),cutoff=now-Math.round(3*365.25*86400);
    const stockRows=stock.rows.filter(x=>Number(x.timestamp)>=cutoff),benchmarkRows=benchmark?.rows?.filter(x=>Number(x.timestamp)>=cutoff)||[];
    return res.status(200).json({ok:true,source:"Yahoo Finance",code,market,symbol:stock.symbol,updatedAt:new Date().toISOString(),history:stockRows,benchmark:benchmark?{symbol:benchmark.symbol,history:benchmarkRows}:null});
  }catch(e){return res.status(502).json({ok:false,error:e.message||"三年歷史資料取得失敗"})}
};
