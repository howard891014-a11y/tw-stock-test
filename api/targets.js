const RSS_HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/rss+xml,application/xml,text/xml,*/*"};
const PAGE_HEADERS={"User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36","Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","Accept-Language":"zh-TW,zh;q=0.9,en;q=0.7"};
const BROKERS=[
["摩根士丹利","外資"],["大摩","外資"],["摩根大通","外資"],["小摩","外資"],["高盛證券","外資"],["高盛","外資"],["花旗","外資"],["美銀","外資"],["美林證券","外資"],["美林","外資"],["瑞銀","外資"],["瑞信","外資"],["野村","外資"],["麥格理","外資"],["匯豐","外資"],["滙豐","外資"],["里昂","外資"],["巴克萊","外資"],["德意志","外資"],["亞系外資","外資"],["美系外資","外資"],["歐系外資","外資"],["日系外資","外資"],
["元大","本土"],["群益","本土"],["凱基","本土"],["富邦","本土"],["國泰","本土"],["永豐","本土"],["統一","本土"],["兆豐","本土"],["第一金","本土"],["華南永昌","本土"],["玉山","本土"],["台新","本土"],["康和","本土"],["宏遠","本土"],["國票","本土"],["新光","本土"],["中國信託綜合證券","本土"],["中國信託證券","本土"],["中信投顧","本土"],["中信","本土"],["本土投顧","本土"]
];
const CANONICAL={"高盛證券":"高盛","美林證券":"美林","大摩":"摩根士丹利","小摩":"摩根大通","滙豐":"匯豐","中國信託綜合證券":"中信","中國信託證券":"中信","中信投顧":"中信"};
const SOURCE_DOMAINS=["tw.stock.yahoo.com","money.udn.com","udn.com","ec.ltn.com.tw","ctee.com.tw","moneydj.com","anue.com","sinotrade.com.tw"];
const clean=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const decodeEntities=s=>String(s||"").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");
function cleanArticleHtml(html){
  return decodeEntities(String(html||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|tr)>/gi,"\n")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<[^>]+>/g," "))
    .split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean).join("\n");
}
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?clean(m[1]):""}
function iso(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d.toISOString()}
function brokerMatches(text){const out=[];for(const [name,type] of BROKERS){let p=0;while((p=text.indexOf(name,p))!==-1){out.push({name:CANONICAL[name]||name,type,index:p});p+=name.length}}return out.sort((a,b)=>a.index-b.index)}
function targetMatches(text){const out=[];const patterns=[
/目標價(?:由|從)?\s*(?:最高|上看|調升至|調高至|下修至|維持在|維持|喊到|看至|達到|為)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元?/gi,
/目標價\s*(?:最高|上看|調升至|調高至|下修至|維持在|維持|喊到|看至|達到|為|由\s*[\d,]+(?:\.\d+)?\s*元?\s*(?:調高|調升|上修|提高)至)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元?/gi,
/(?:上看|調升至|調高至|下修至|喊到|看至)\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元/gi,
/(?:給予|維持|設定|喊出|看好至)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元\s*(?:的)?目標價/gi
];
for(const p of patterns){let m;while((m=p.exec(text))){const n=Number(m[1].replace(/,/g,""));if(Number.isFinite(n)&&n>=10&&n<=100000)out.push({target:n,index:m.index,text:m[0]})}}
return out.filter(x=>{const before=text.slice(Math.max(0,x.index-60),x.index),clause=text.slice(clauseBounds(text,x.index).start,Math.min(text.length,x.index+x.text.length+20));if(/(?:EPS|每股盈餘|每股稅後盈餘|獲利)\s*(?:上看|估|達|為)?\s*$/i.test(before))return false;if(/(?:EPS|每股盈餘|每股稅後盈餘)/i.test(clause)&&!/目標價/i.test(clause))return false;return true}).filter((x,i,a)=>a.findIndex(y=>y.target===x.target&&Math.abs(y.index-x.index)<8)===i).sort((a,b)=>a.index-b.index)}
function periodInfo(text){const t=String(text||"");if(/(?:未來|未來的)?\s*12\s*(?:個)?月|十二個月|12[- ]month/i.test(t))return{periodType:"12m",periodLabel:"12個月"};const quarter=t.match(/(?:20\d{2}\s*[年/]?\s*)?(?:第\s*[一二三四1234]\s*季|Q[1-4]|[1-4]Q)|(?:季度|單季)(?:目標|估值|展望|財測)?/i);if(quarter)return{periodType:"quarter",periodLabel:`季度（${quarter[0].replace(/\s+/g," ").trim()}）`};const annual=t.match(/(?:以|採用|基於)?\s*(20\d{2})\s*(?:年|E|F)?\s*(?:度)?\s*(?:EPS|每股盈餘|獲利|盈餘|財測|估值|預估)|(?:20\d{2}\s*年度|全年)(?:目標|估值|展望|財測)?/i);if(annual){const y=(annual[1]||annual[0].match(/20\d{2}/)?.[0]||"").trim();return{periodType:"annual",periodLabel:y?`年度（${y}）`:"年度"}}return{periodType:"unknown",periodLabel:""}}
function reasonInfo(text){const fundamental=/(?:EPS|每股盈餘|營收|獲利|盈餘|訂單|出貨|需求|毛利率|產能|財測|營運|展望|市占|產品組合|成本下降|獲利預估)(?:上修|調升|提高|改善|成長|優於|強勁)?/i.test(text);const valuation=/(?:本益比|目標本益比|股價淨值比|P\s*\/\s*E|P\s*\/\s*B|PE\b|PB\b|估值倍數|評價倍數|估值|評價)(?:上修|調升|提高|重估|提升)?/i.test(text);if(fundamental&&valuation)return{revisionReason:"mixed",revisionReasonLabel:"基本面＋估值倍數"};if(valuation)return{revisionReason:"valuation",revisionReasonLabel:"純估值倍數上修"};if(fundamental)return{revisionReason:"fundamental",revisionReasonLabel:"基本面上修"};return{revisionReason:"unknown",revisionReasonLabel:""}}
function dayAge(v){const d=new Date(v);return Number.isNaN(d.getTime())?Infinity:Math.max(0,Math.floor((Date.now()-d.getTime())/86400000))}
function stockMarkers(text,code,name){
  const markers=[];
  const explicit=/([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9\-]{1,24})\s*[（(]\s*(\d{4,6})(?:\.TW|\.TWO)?\s*[）)]/g;
  let m;
  while((m=explicit.exec(text))){
    markers.push({index:m.index,end:explicit.lastIndex,name:m[1].trim(),code:m[2],requested:m[2]===code||(name&&m[1].includes(name))});
  }
  // 有些文章只寫「台積電2330」或「台積電 2330.TW」，沒有括號。
  const loose=/([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9\-]{1,24})\s+(\d{4,6})(?:\.TW|\.TWO)?\b/g;
  while((m=loose.exec(text))){
    if(markers.some(x=>Math.abs(x.index-m.index)<6))continue;
    markers.push({index:m.index,end:loose.lastIndex,name:m[1].trim(),code:m[2],requested:m[2]===code||(name&&m[1].includes(name))});
  }
  // 對文章中已辨識出的每檔股票名稱建立所有後續純文字標記，避免同篇多股時誤配。
  const aliases=[...new Map(markers.filter(x=>!x.implicit&&x.name).map(x=>[`${x.name}|${x.code}`,{name:x.name,code:x.code}])).values()];
  for(const a of aliases){
    let p=0;
    while((p=text.indexOf(a.name,p))!==-1){
      if(!markers.some(x=>p>=x.index&&p<x.end))markers.push({index:p,end:p+a.name.length,name:a.name,code:a.code,requested:a.code===code||(name&&a.name.includes(name)),implicit:true});
      p+=a.name.length;
    }
  }
  // 若全文沒有「名稱(代碼)」格式，至少以查詢股票名稱建立段落起點。
  if(name){
    let p=0;
    while((p=text.indexOf(name,p))!==-1){
      if(!markers.some(x=>p>=x.index&&p<=x.end))markers.push({index:p,end:p+name.length,name,code,requested:true,implicit:true});
      p+=name.length;
    }
  }
  // 股票代碼單獨出現也可作為查詢股票起點，但避免年份等誤判。
  let cp=0;
  while((cp=text.indexOf(code,cp))!==-1){
    if(!markers.some(x=>cp>=x.index&&cp<=x.end))markers.push({index:cp,end:cp+code.length,name:name||code,code,requested:true,implicit:true});
    cp+=code.length;
  }
  return markers.sort((a,b)=>a.index-b.index||Number(a.implicit)-Number(b.implicit));
}
function requestedSegments(text,code,name){
  const markers=stockMarkers(text,code,name);
  if(!markers.length)return[];
  const segments=[];
  for(let i=0;i<markers.length;i++){
    const cur=markers[i];
    if(!cur.requested)continue;
    let end=text.length;
    for(let j=i+1;j<markers.length;j++){
      // 下一檔明確不同股票出現時，立即結束本股票段落。
      if(markers[j].code!==code&&!markers[j].requested){end=markers[j].index;break}
      // 查詢股票再次出現不切段，視為同一股票內容延續。
    }
    const start=cur.index;
    if(!segments.some(x=>Math.abs(x.start-start)<8))segments.push({start,end});
  }
  // 合併重疊段落，避免同一段因名稱與代碼各建一次。
  segments.sort((a,b)=>a.start-b.start);
  const merged=[];
  for(const seg of segments){
    const last=merged[merged.length-1];
    if(last&&seg.start<=last.end)last.end=Math.max(last.end,seg.end);else merged.push({...seg});
  }
  return merged;
}
function clauseBounds(text,index){
  const stops=/[。；;！!?？\n]/;
  let start=index,end=index;
  while(start>0&&!stops.test(text[start-1]))start--;
  while(end<text.length&&!stops.test(text[end]))end++;
  return{start,end};
}
function hasDifferentStockBetween(markers,a,b,code){
  const lo=Math.min(a,b),hi=Math.max(a,b);
  return markers.some(m=>m.index>lo&&m.index<hi&&m.code&&m.code!==code&&!m.requested&&!m.implicit);
}
function targetBelongsToRequested(text,t,code,name,markers){
  const clause=clauseBounds(text,t.index),local=markers.filter(m=>m.index>=clause.start&&m.index<clause.end);
  const requestedLocal=local.filter(m=>m.requested),differentExplicit=local.filter(m=>!m.requested&&!m.implicit);
  if(requestedLocal.length){
    const nearest=[...local].sort((a,b)=>Math.abs(a.index-t.index)-Math.abs(b.index-t.index))[0];
    return !!nearest?.requested;
  }
  if(differentExplicit.length)return false;
  const preceding=[...markers].filter(m=>m.index<=t.index).sort((a,b)=>b.index-a.index)[0];
  if(preceding&&t.index-preceding.index<=420)return !!preceding.requested;
  const around=text.slice(Math.max(0,t.index-220),Math.min(text.length,t.index+t.text.length+120));
  return around.includes(code)||!!(name&&around.includes(name));
}
function brokerForTarget(text,t,code,markers,brokers){
  const clause=clauseBounds(text,t.index);
  const sameClause=brokers.filter(b=>b.index>=clause.start&&b.index<clause.end);
  const choose=list=>[...list].sort((a,b)=>{
    const ap=a.index<=t.index?0:1,bp=b.index<=t.index?0:1;
    return ap-bp||Math.abs(a.index-t.index)-Math.abs(b.index-t.index);
  })[0]||null;
  const local=choose(sameClause);
  if(local&&!hasDifferentStockBetween(markers,local.index,t.index,code))return local;
  const nearby=brokers.filter(b=>Math.abs(b.index-t.index)<=240&&!markers.some(m=>!m.implicit&&m.index>Math.min(b.index,t.index)&&m.index<Math.max(b.index,t.index)));
  const near=choose(nearby);
  if(near)return near;
  const unique=[...new Map(brokers.map(x=>[x.name,x])).values()];
  const explicitStocks=new Set(markers.filter(m=>!m.implicit&&m.code).map(m=>m.code));
  return unique.length===1&&explicitStocks.size<=1?unique[0]:null;
}
function pairRows(text,base,code,name){
  const allTargets=targetMatches(text),rows=[],markers=stockMarkers(text,code,name),globalBrokers=brokerMatches(text);
  for(const seg of requestedSegments(text,code,name)){
    const targets=allTargets.filter(x=>x.index>=seg.start&&x.index<seg.end);
    for(const t of targets){
      if(!targetBelongsToRequested(text,t,code,name,markers))continue;
      const epsContext=text.slice(Math.max(seg.start,t.index-45),Math.min(seg.end,t.index+t.text.length+12));
      if(/(?:EPS|每股盈餘|每股稅後盈餘)\s*(?:上看|估|達|為)?\s*[\d,.]+/i.test(epsContext)&&!/^目標價/i.test(t.text))continue;
      const b=brokerForTarget(text,t,code,markers,globalBrokers);
      const context=text.slice(Math.max(seg.start,t.index-360),Math.min(seg.end,t.index+360));
      const broker=b?{broker:b.name,brokerType:b.type}:{broker:"未知券商",brokerType:"未知"};
      rows.push({...base,...broker,brokerKey:b?b.name:"未知券商",...periodInfo(context),...reasonInfo(context),target:t.target});
    }
  }
  return rows;
}


// v2.4.1：標題優先＋多公司雙重驗證。
// 單公司、單一目標價、且標題沒有問號：標題本身即視為高可信證據；
// 其餘（問號、多公司、主詞不清）必須進文章內文做股票↔目標價配對。
const LEARNED_BROKERS=new Map();
function rememberBroker(name,type){
  const n=String(name||"").trim();if(!n||n==="未知券商")return;
  const old=LEARNED_BROKERS.get(n);
  if(!old||old==="未知"||(type&&type!=="未知"))LEARNED_BROKERS.set(n,type||old||"未知");
}
function titleCompanyMarkers(title){
  const out=[];let m;
  const explicit=/([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9\-]{1,24})\s*[（(]?\s*(\d{4,6})(?:\.TW|\.TWO)?\s*[）)]?/g;
  while((m=explicit.exec(String(title||"")))){
    const code=m[2];
    // 排除日期、年份等常見非股票數字。
    const companyName=m[1].trim();
    if(/^20\d{2}$/.test(code))continue;
    if(/^(?:目標價|股價|收盤價|EPS|營收|獲利|每股盈餘|本益比|殖利率)$/i.test(companyName))continue;
    out.push({name:companyName,code,index:m.index});
  }
  return out;
}
function titleDecision(title,code,name){
  const text=String(title||"");
  const targets=targetMatches(text);
  const companies=titleCompanyMarkers(text);
  const requested=companies.filter(x=>x.code===code||(name&&x.name.includes(name)));
  const hasQuestion=/[？?]/.test(text);
  const distinctCodes=new Set(companies.map(x=>x.code));
  const requestedMentioned=requested.length>0||requestedMention(text,code,name);
  const singleCompany=(distinctCodes.size===1&&requested.length>0)||(distinctCodes.size===0&&requestedMentioned);
  return{direct:singleCompany&&targets.length===1&&!hasQuestion,needsArticle:hasQuestion||distinctCodes.size>1||!singleCompany||targets.length!==1,targets};
}
function titleDirectRows(title,base,code,name){
  const d=titleDecision(title,code,name);if(!d.direct)return[];
  const t=d.targets[0];
  const brokers=dynamicBrokerMatches(title);
  const b=brokerFromScope(title,[...new Map(brokers.map(x=>[x.name,x])).values()]);
  if(b)rememberBroker(b.name,b.type);
  const broker=b?{broker:b.name,brokerType:b.type}:{broker:"未知券商",brokerType:"未知"};
  return[{...base,...broker,brokerKey:b?b.name:"未知券商",...periodInfo(title),...reasonInfo(title),target:t.target,evidence:title,titleDirect:true}];
}

function paragraphList(text){return String(text||"").split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean)}
function sentenceList(text){return String(text||"").split(/(?<=[。！？!?；;])/).map(x=>x.trim()).filter(Boolean)}
function dynamicBrokerMatches(text){
  const out=[...brokerMatches(text)],seen=new Set(out.map(x=>`${x.index}|${x.name}`));
  for(const x of out)rememberBroker(x.name,x.type);
  const re=/([\u4e00-\u9fffA-Za-z]{2,16})(證券|投顧)/g;let m;
  while((m=re.exec(text))){
    const raw=`${m[1]}${m[2]}`,known=brokerMatches(raw)[0];
    const name=known?.name||(m[1].replace(/(?:股份有限公司|股份|綜合)$/g,"")||raw);
    // 未收錄券商不再武斷當成本土；先記住名稱，日後同名可持續辨識。
    const type=known?.type||LEARNED_BROKERS.get(name)||"未知";
    rememberBroker(name,type);
    const key=`${m.index}|${name}`;if(!seen.has(key)){seen.add(key);out.push({name,type,index:m.index})}
  }
  return out.sort((a,b)=>a.index-b.index);
}
function requestedMention(text,code,name){return !!((name&&text.includes(name))||text.includes(code))}
function brokerFromScope(scope,articleBrokerNames){
  const hits=dynamicBrokerMatches(scope);
  if(hits.length){const last=hits[hits.length-1];return last}
  if(articleBrokerNames.length===1)return articleBrokerNames[0];
  return null;
}
function articlePairRows(text,base,code,name){
  const paragraphs=paragraphList(text),rows=[];
  const allBrokers=dynamicBrokerMatches(text),articleBrokerNames=[...new Map(allBrokers.map(x=>[x.name,x])).values()];
  for(const para of paragraphs){
    const targets=targetMatches(para);if(!targets.length)continue;
    // 文章解析的第一道門：此段必須真的提到正在查詢的股票。這可直接阻止「信驊 22,000」被塞進台積電。
    if(!requestedMention(para,code,name))continue;
    const sentences=sentenceList(para);
    for(const t of targets){
      let offset=0,ownerSentence="";
      for(const sentence of sentences){const at=para.indexOf(sentence,offset);const st=at<0?offset:at,en=st+sentence.length;if(t.index>=st&&t.index<=en){ownerSentence=sentence;break}offset=en}
      ownerSentence=ownerSentence||para;
      // 同一段如果談多家公司，目標價所在句有其他主詞而沒有查詢股票時，不硬配；僅允許前一句明確承接同一股票。
      if(!requestedMention(ownerSentence,code,name)){
        const idx=sentences.indexOf(ownerSentence),prev=idx>0?sentences[idx-1]:"";
        if(!requestedMention(prev,code,name))continue;
      }
      const b=brokerFromScope(ownerSentence,articleBrokerNames)||brokerFromScope(para,articleBrokerNames);
      const broker=b?{broker:b.name,brokerType:b.type}:{broker:"未知券商",brokerType:"未知"};
      const evidence=para.slice(Math.max(0,t.index-180),Math.min(para.length,t.index+t.text.length+180));
      rows.push({...base,...broker,brokerKey:b?b.name:"未知券商",...periodInfo(para),...reasonInfo(para),target:t.target,evidence});
    }
  }
  // 全文無法明確配對時直接不收；寧可漏掉，也不退回跨段距離猜測造成誤植。
  return rows;
}

async function fetchRss(query){const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;const r=await fetch(url,{headers:RSS_HEADERS});if(!r.ok)return[];const xml=await r.text();return(xml.match(/<item>[\s\S]*?<\/item>/gi)||[]).map(item=>({title:tag(item,"title"),description:tag(item,"description"),date:iso(tag(item,"pubDate")),sourceUrl:tag(item,"link")}))}
async function fetchArticle(url){if(!url)return{url,text:""};try{const c=new AbortController(),timer=setTimeout(()=>c.abort(),2600);const r=await fetch(url,{headers:PAGE_HEADERS,redirect:"follow",signal:c.signal});clearTimeout(timer);if(!r.ok)return{url:r.url||url,text:""};const html=await r.text();const canonical=html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]||html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i)?.[1]||r.url||url;const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||"";const desc=html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i)?.[1]||"";return{url:canonical,text:cleanArticleHtml(`${title}\n${desc}\n${html}`)}}catch{return{url,text:""}}}
async function pooled(items,limit,fn){const out=[];let i=0;async function worker(){while(i<items.length){const idx=i++;out[idx]=await fn(items[idx],idx)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}
module.exports=async function handler(req,res){res.setHeader("Cache-Control","no-store");const rawCode=String(req.query.code||req.query.symbol||"").trim().toUpperCase();
const code=rawCode.replace(/\.(?:TW|TWO)$/i,"").trim();
const name=String(req.query.name||"").trim();
if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:"股票代碼格式錯誤"});try{
const base=name||code;const queries=[`${base} ${code} 目標價`,`${base} ${code} 外資 目標價`,`${base} ${code} 券商 調升 上看`,...SOURCE_DOMAINS.map(d=>`${base} ${code} 目標價 site:${d}`)];
const rssResults=(await Promise.all(queries.map(fetchRss))).flat();const seen=new Set(),items=[];for(const x of rssResults){const k=`${x.title}|${x.date}`;if(!seen.has(k)){seen.add(k);items.push(x)}}items.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
const scoped360=items.filter(x=>dayAge(x.date)<=360),selected=scoped360.slice(0,100);
const articles=await pooled(selected,8,async item=>{const article=await fetchArticle(item.sourceUrl);return{...item,articleUrl:article.url,fullText:`${item.title}\n${item.description}\n${article.text}`}});
const rows=[];
// v2.4.1 搜尋核心：標題能唯一確認時直接採用；有問號／多公司／不明確時才要求內文雙重驗證。
const articleKeys=new Set(),directKeys=new Set();
for(const item of scoped360){
  if(!(item.title.includes(code)||(name&&item.title.includes(name))))continue;
  const baseRow={date:item.date,title:item.title,sourceUrl:item.sourceUrl};
  const direct=titleDirectRows(item.title,baseRow,code,name);
  if(direct.length){for(const row of direct)rows.push(row);directKeys.add(`${item.title}|${item.date}`)}
}
for(const a of articles){
  const key=`${a.title}|${a.date}`;if(directKeys.has(key))continue;
  const text=a.fullText;if(!(text.includes(code)||(name&&text.includes(name))))continue;
  const baseRow={date:a.date,title:a.title,sourceUrl:a.articleUrl||a.sourceUrl};
  for(const row of articlePairRows(text,baseRow,code,name))rows.push(row);
  articleKeys.add(key);
}
// 抓不到文章正文時，只有「非多公司且可在 RSS 摘要完成股票↔目標價配對」才允許備援；
// 多公司與問號標題不再用跨段距離猜測。
for(const item of scoped360){
  const key=`${item.title}|${item.date}`;if(directKeys.has(key)||articleKeys.has(key))continue;
  const decision=titleDecision(item.title,code,name);
  if(/[？?]/.test(item.title)||titleCompanyMarkers(item.title).length>1)continue;
  const text=`${item.title} ${item.description}`;if(!(text.includes(code)||(name&&text.includes(name))))continue;
  for(const row of pairRows(text,{date:item.date,title:item.title,sourceUrl:item.sourceUrl},code,name))rows.push(row)
}
rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
// 已知券商：熱門股採自動縮窗，但保留被選中券商的完整歷史，避免 previousTarget 因縮窗消失。
// 規則：30 → 60 → 90 → 180 → 360 天；當某個時間窗已有至少 4 家近期券商，就不再把更舊券商塞進畫面。
// 若同一時間窗仍超過 8 家，只保留「最新報告日期」前 8 家。冷門股不足 4 家時會一路放寬到 360 天。
const knownAll=rows.filter(x=>x.brokerType!=="未知");
const knownWindows=[30,60,90,180,360],minRecentBrokers=4,maxVisibleBrokers=8;
const latestKnownByBroker=new Map();
for(const row of knownAll){const key=row.brokerKey||row.broker,prev=latestKnownByBroker.get(key);if(!prev||new Date(row.date||0)>new Date(prev.date||0))latestKnownByBroker.set(key,row)}
let knownWindow=360;
for(const days of knownWindows){const count=[...latestKnownByBroker.values()].filter(x=>dayAge(x.date)<=days).length;if(count>=minRecentBrokers){knownWindow=days;break}}
let activeKnown=[...latestKnownByBroker.entries()].filter(([,x])=>dayAge(x.date)<=knownWindow).sort((a,b)=>new Date(b[1].date||0)-new Date(a[1].date||0));
if(activeKnown.length>maxVisibleBrokers)activeKnown=activeKnown.slice(0,maxVisibleBrokers);
const activeKnownKeys=new Set(activeKnown.map(([key])=>key));
const known=knownAll.filter(x=>activeKnownKeys.has(x.brokerKey||x.broker));

// 未知券商沿用原本逐級搜尋窗：60 → 90 → 180 → 360 天。
const windows=[60,90,180,360];let unknownWindow=360;for(const days of windows){if(rows.some(x=>x.brokerType==="未知"&&dayAge(x.date)<=days)){unknownWindow=days;break}}
const unknown=rows.filter(x=>x.brokerType==="未知"&&dayAge(x.date)<=unknownWindow);
// 未知券商：相同目標價且日期前後相差一天視為同一筆，只保留較新的資料。
let mergedUnknown=[];
for(const row of unknown){const hit=mergedUnknown.find(x=>x.target===row.target&&Math.abs(new Date(x.date||0)-new Date(row.date||0))<=86400000);if(!hit)mergedUnknown.push(row)}
mergedUnknown.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
if(known.length)mergedUnknown=mergedUnknown.slice(0,3);
const groups={};
for(const row of [...known,...mergedUnknown]){const key=row.brokerType==="未知"?`未知券商:${row.target}`:(row.brokerKey||row.broker);groups[key]??=[];if(!groups[key].some(x=>x.target===row.target&&String(x.date||"").slice(0,10)===String(row.date||"").slice(0,10)))groups[key].push(row)}
const brokers=Object.values(groups).map(history=>{history.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));const latest=history[0],fullHistory=history.slice(0,3);return{...latest,previousTarget:fullHistory[1]?.target??null,previousDate:fullHistory[1]?.date??null,targetHistory:fullHistory.map(x=>({target:x.target,date:x.date,title:x.title,sourceUrl:x.sourceUrl,broker:x.broker,brokerType:x.brokerType,brokerKey:x.brokerKey,periodType:x.periodType,periodLabel:x.periodLabel,revisionReason:x.revisionReason,revisionReasonLabel:x.revisionReasonLabel,evidence:x.evidence||"",aiParsed:!!x.aiParsed,confidence:x.confidence||""}))}}).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
return res.status(200).json({ok:true,parserVersion:"2.4.1",brokers,fetchedAt:new Date().toISOString(),searchedArticles:articles.length,knownSearchWindow:knownWindow,unknownSearchWindow:unknownWindow});
}catch(e){return res.status(502).json({ok:false,error:"目標價資料暫時無法取得",detail:e.message})}}
