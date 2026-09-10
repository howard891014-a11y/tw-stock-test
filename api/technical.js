const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
function num(x){x=Number(x);return Number.isFinite(x)?x:null}
function avg(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function sma(a,n){return a.length>=n?avg(a.slice(-n)):null}
function std(a,n){if(a.length<n)return null;const x=a.slice(-n),m=avg(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/n)}
function emaSeries(a,n){if(!a.length)return[];const k=2/(n+1),out=[a[0]];for(let i=1;i<a.length;i++)out.push(a[i]*k+out[i-1]*(1-k));return out}
function rsi(a,n=14){if(a.length<=n)return null;let g=0,l=0;for(let i=a.length-n;i<a.length;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d}if(l===0)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs))}
function pct(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?(a/b-1)*100:null}
function round(x,d=2){return Number.isFinite(x)?Number(x.toFixed(d)):null}
function yahooSymbol(q,market){let s=String(q||'').trim().toUpperCase();if(/^[0-9]{4,6}$/.test(s))s+=String(market||'').includes('上櫃')?'.TWO':'.TW';return s}
async function fetchJson(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},redirect:'follow'});if(!r.ok)throw new Error(`Yahoo HTTP ${r.status}`);return r.json()}
async function chart(symbol){let last;for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{const u=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&events=history&includeAdjustedClose=true`;const j=await fetchJson(u);const r=j?.chart?.result?.[0];if(r)return r;last=new Error(j?.chart?.error?.description||'Yahoo 無歷史資料')}catch(e){last=e}}throw last||new Error('Yahoo 歷史資料取得失敗')}
export default async function handler(req,res){
 try{
  const q=req.query?.q,market=req.query?.market||'';if(!q)return res.status(400).json({ok:false,error:'缺少股票代碼'});
  const symbol=yahooSymbol(q,market),r=await chart(symbol),ts=r.timestamp||[],z=r.indicators?.quote?.[0]||{};
  const rows=ts.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),open:num(z.open?.[i]),high:num(z.high?.[i]),low:num(z.low?.[i]),close:num(z.close?.[i]),volume:num(z.volume?.[i])})).filter(x=>Number.isFinite(x.close));
  if(rows.length<60)throw new Error('Yahoo 歷史資料不足 60 個交易日');
  const c=rows.map(x=>x.close),v=rows.map(x=>x.volume),last=c.at(-1),ma5=sma(c,5),ma10=sma(c,10),ma20=sma(c,20),ma60=sma(c,60);
  const sd20=std(c,20),upper=ma20+2*sd20,lower=ma20-2*sd20,bw=ma20?((upper-lower)/ma20)*100:null;
  const e12=emaSeries(c,12),e26=emaSeries(c,26),dif=e12.map((x,i)=>x-e26[i]),signal=emaSeries(dif.slice(25),9),difLast=dif.at(-1),sigLast=signal.at(-1),hist=difLast-sigLast;
  const vol5=sma(v,5),vol20=sma(v,20),volRatio=vol20?v.at(-1)/vol20:null;
  const recent60=rows.slice(-60),high60=Math.max(...recent60.map(x=>x.high??x.close)),low60=Math.min(...recent60.map(x=>x.low??x.close));
  const maOrder=last>ma5&&ma5>ma10&&ma10>ma20&&ma20>ma60?'多頭排列':last<ma5&&ma5<ma10&&ma10<ma20&&ma20<ma60?'空頭排列':'均線交錯';
  let bollPos='中軌附近';if(last>=upper)bollPos='上軌以上';else if(last>ma20)bollPos='中上軌';else if(last<=lower)bollPos='下軌以下';else if(last<ma20)bollPos='中下軌';
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ok:true,source:'Yahoo Finance',symbol,updatedAt:rows.at(-1).date,count:rows.length,latest:rows.at(-1),ma:{ma5:round(ma5),ma10:round(ma10),ma20:round(ma20),ma60:round(ma60),order:maOrder,bias20:round(pct(last,ma20))},bollinger:{middle:round(ma20),upper:round(upper),lower:round(lower),bandwidth:round(bw),position:bollPos},volume:{current:round(v.at(-1),0),avg5:round(vol5,0),avg20:round(vol20,0),ratio20:round(volRatio)},trend:{high60:round(high60),low60:round(low60),fromHigh60Pct:round(pct(last,high60)),fromLow60Pct:round(pct(last,low60))},momentum:{rsi14:round(rsi(c,14)),macd:round(difLast),signal:round(sigLast),histogram:round(hist)},history:rows.slice(-120)});
 }catch(e){return res.status(500).json({ok:false,error:e?.message||'技術資料取得失敗'})}
}
