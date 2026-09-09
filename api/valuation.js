const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeHtml(s=""){
  return String(s)
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
}
function htmlToLines(html=""){
  return decodeHtml(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[\s\S]*?<\/style>/gi," ")
    .replace(/<\/(?:div|li|tr|td|th|p|h\d|span|section|article)>/gi,"\n")
    .replace(/<(?:br|hr)\s*\/?\s*>/gi,"\n")
    .replace(/<[^>]+>/g," "))
    .split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function num(v){const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n:null}
function round2(n){return Number.isFinite(n)?Math.round(n*100)/100:null}
function pickPeFromText(text=""){
  const m=String(text).match(/(-?\d+(?:\.\d+)?)\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)\s*本益比\s*\(同業平均\)/);
  return m?{currentPe:num(m[1]),peerPe:num(m[2])}:{};
}
function parseQuarterly(lines){
  const out=[];
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^(20\d{2})\s*Q([1-4])$/i);
    if(!m)continue;
    const vals=[];
    for(let j=i+1;j<Math.min(lines.length,i+8);j++){
      if(/^(20\d{2})\s*Q[1-4]$/i.test(lines[j]))break;
      const token=lines[j].replace(/,/g,"").replace(/%$/g,"").trim();
      if(/^-?\d+(?:\.\d+)?$/.test(token))vals.push(Number(token));
    }
    if(vals.length){out.push({period:`${m[1]} Q${m[2]}`,eps:vals[0]})}
  }
  const seen=new Set();
  return out.filter(x=>!seen.has(x.period)&&(seen.add(x.period),true));
}
function parseYahooEpsPage(html){
  const lines=htmlToLines(html);
  const joined=lines.join(" ");
  const pe=pickPeFromText(joined);
  const quarterly=parseQuarterly(lines);
  const latest4=quarterly.slice(0,4);
  const ttm=latest4.length===4?round2(latest4.reduce((s,x)=>s+x.eps,0)):null;
  const nameIdx=lines.findIndex(x=>/每股盈餘/.test(x));
  return {name:nameIdx>1?lines[Math.max(0,nameIdx-2)]:"",quarterly,latest4,ttm,...pe};
}
async function fetchText(url,timeout=9000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{"user-agent":UA,"accept-language":"zh-TW,zh;q=0.9,en;q=0.7"},redirect:"follow",signal:controller.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();
  }finally{clearTimeout(timer)}
}
function suffixFor(market=""){
  const m=String(market);
  if(/上櫃|OTC|TWO/i.test(m))return ".TWO";
  if(/上市|TWSE|TW/i.test(m))return ".TW";
  return "";
}
function buildValuation(parsed,price){
  const ttm=num(parsed.ttm),peerPe=num(parsed.peerPe),currentPe=num(parsed.currentPe),last=num(price);
  let conservativePe=null,neutralPe=null,optimisticPe=null,conservativePrice=null,neutralPrice=null,optimisticPrice=null,diffPct=null,label="資料不足";
  if(ttm<=0){label="近四季虧損"}
  else if(ttm>0&&peerPe>0){
    conservativePe=round2(peerPe*.8); neutralPe=round2(peerPe); optimisticPe=round2(peerPe*1.2);
    conservativePrice=round2(ttm*conservativePe); neutralPrice=round2(ttm*neutralPe); optimisticPrice=round2(ttm*optimisticPe);
    if(last>0&&neutralPrice>0){
      diffPct=round2((neutralPrice/last-1)*100);
      const ratio=last/neutralPrice;
      label=ratio<=.8?"相對低估":ratio<=1?"相對合理":ratio<=1.2?"相對偏高":"相對過熱";
    }
  }
  return {ttm,currentPe,peerPe,last,conservativePe,neutralPe,optimisticPe,conservativePrice,neutralPrice,optimisticPrice,diffPct,label,latest4:parsed.latest4||[],method:"近四季 EPS × Yahoo 同業平均本益比",source:"Yahoo 股市"};
}

module.exports=async function handler(req,res){
  try{
    const q=String(req.query?.q||"").trim().toUpperCase().replace(/\.(TW|TWO)$/i,"");
    const market=String(req.query?.market||""); const price=req.query?.price;
    if(!/^\d{4,6}$/.test(q))return res.status(400).json({ok:false,error:"股票代碼格式錯誤"});
    const preferred=suffixFor(market); const suffixes=preferred?[preferred]:[".TW",".TWO"];
    let parsed=null,symbol="",lastErr=null;
    for(const suffix of suffixes){
      try{
        const html=await fetchText(`https://tw.stock.yahoo.com/quote/${q}${suffix}/eps`);
        const p=parseYahooEpsPage(html);
        if(p.latest4?.length||p.currentPe||p.peerPe){parsed=p;symbol=q+suffix;break}
      }catch(e){lastErr=e}
    }
    if(!parsed)throw lastErr||new Error("Yahoo EPS 資料解析失敗");
    const valuation=buildValuation(parsed,price);
    return res.status(200).json({ok:true,code:q,symbol,...valuation});
  }catch(e){
    console.error("valuation error",e);
    return res.status(500).json({ok:false,error:e?.name==="AbortError"?"Yahoo 估值資料查詢逾時":String(e?.message||"估值資料查詢失敗")});
  }
};

module.exports._test={htmlToLines,parseQuarterly,parseYahooEpsPage,buildValuation,pickPeFromText};
