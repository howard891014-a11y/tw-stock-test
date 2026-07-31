const RSS_HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/rss+xml,application/xml,text/xml,*/*"};
const PAGE_HEADERS={"User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36","Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","Accept-Language":"zh-TW,zh;q=0.9,en;q=0.7"};
const BROKERS=[
["摩根士丹利","外資"],["大摩","外資"],["摩根大通","外資"],["小摩","外資"],["高盛","外資"],["花旗","外資"],["美銀","外資"],["瑞銀","外資"],["瑞信","外資"],["野村","外資"],["麥格理","外資"],["匯豐","外資"],["滙豐","外資"],["里昂","外資"],["巴克萊","外資"],["德意志","外資"],["亞系外資","外資"],["美系外資","外資"],["歐系外資","外資"],["日系外資","外資"],
["元大","本土"],["群益","本土"],["凱基","本土"],["富邦","本土"],["國泰","本土"],["永豐","本土"],["統一","本土"],["兆豐","本土"],["第一金","本土"],["華南永昌","本土"],["玉山","本土"],["台新","本土"],["康和","本土"],["宏遠","本土"],["國票","本土"],["新光","本土"],["中國信託綜合證券","本土"],["中國信託證券","本土"],["中信投顧","本土"],["中信","本土"],["本土投顧","本土"]
];
const CANONICAL={"大摩":"摩根士丹利","小摩":"摩根大通","滙豐":"匯豐","中國信託綜合證券":"中信","中國信託證券":"中信","中信投顧":"中信"};
const SOURCE_DOMAINS=["tw.stock.yahoo.com","money.udn.com","udn.com","ec.ltn.com.tw","ctee.com.tw","moneydj.com","anue.com","sinotrade.com.tw"];
const clean=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?clean(m[1]):""}
function iso(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d.toISOString()}
function brokerMatches(text){const out=[];for(const [name,type] of BROKERS){let p=0;while((p=text.indexOf(name,p))!==-1){out.push({name:CANONICAL[name]||name,type,index:p});p+=name.length}}return out.sort((a,b)=>a.index-b.index)}
function targetMatches(text){const out=[];const patterns=[
/目標價(?:由|從)?\s*(?:最高|上看|調升至|調高至|下修至|維持在|維持|喊到|看至|達到|為)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元?/gi,
/目標價\s*(?:最高|上看|調升至|調高至|下修至|維持在|維持|喊到|看至|達到|為|由\s*[\d,]+(?:\.\d+)?\s*元?\s*(?:調高|調升|上修|提高)至)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元?/gi,
/(?:上看|調升至|調高至|下修至|喊到|看至)\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元/gi
];
for(const p of patterns){let m;while((m=p.exec(text))){const n=Number(m[1].replace(/,/g,""));if(Number.isFinite(n)&&n>=10&&n<=100000)out.push({target:n,index:m.index,text:m[0]})}}
return out.filter((x,i,a)=>a.findIndex(y=>y.target===x.target&&Math.abs(y.index-x.index)<8)===i).sort((a,b)=>a.index-b.index)}
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
function pairRows(text,base,code,name){
  const allTargets=targetMatches(text),rows=[];
  for(const seg of requestedSegments(text,code,name)){
    const segmentText=text.slice(seg.start,seg.end);
    const brokers=brokerMatches(segmentText).map(x=>({...x,index:x.index+seg.start}));
    const targets=allTargets.filter(x=>x.index>=seg.start&&x.index<seg.end);
    for(const t of targets){
      // 優先採用目標價之前、同一股票段落內最近出現的券商。
      const preceding=brokers.filter(x=>x.index<=t.index).sort((a,b)=>b.index-a.index)[0];
      const following=brokers.filter(x=>x.index>t.index&&x.index-t.index<=140).sort((a,b)=>a.index-b.index)[0];
      const b=preceding||following||null;
      // 上下文不得跨越下一檔股票段落。
      const context=text.slice(Math.max(seg.start,t.index-320),Math.min(seg.end,t.index+320));
      const broker=b?{broker:b.name,brokerType:b.type}:{broker:"未知券商",brokerType:"未知"};
      rows.push({...base,...broker,brokerKey:b?b.name:`未知券商:${base.date||""}:${t.target}:${base.title||""}`,...periodInfo(context),...reasonInfo(context),target:t.target});
    }
  }
  return rows;
}
async function fetchRss(query){const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;const r=await fetch(url,{headers:RSS_HEADERS});if(!r.ok)return[];const xml=await r.text();return(xml.match(/<item>[\s\S]*?<\/item>/gi)||[]).map(item=>({title:tag(item,"title"),description:tag(item,"description"),date:iso(tag(item,"pubDate")),sourceUrl:tag(item,"link")}))}
async function fetchArticle(url){if(!url)return{url,text:""};try{const c=new AbortController(),timer=setTimeout(()=>c.abort(),2600);const r=await fetch(url,{headers:PAGE_HEADERS,redirect:"follow",signal:c.signal});clearTimeout(timer);if(!r.ok)return{url:r.url||url,text:""};const html=await r.text();const canonical=html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]||html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i)?.[1]||r.url||url;const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||"";const desc=html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i)?.[1]||"";return{url:canonical,text:clean(`${title} ${desc} ${html}`)}}catch{return{url,text:""}}}
async function pooled(items,limit,fn){const out=[];let i=0;async function worker(){while(i<items.length){const idx=i++;out[idx]=await fn(items[idx],idx)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}
module.exports=async function handler(req,res){res.setHeader("Cache-Control","no-store");const code=String(req.query.code||"").trim(),name=String(req.query.name||"").trim();if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:"股票代碼格式錯誤"});try{
const base=name||code;const queries=[`${base} ${code} 目標價`,`${base} ${code} 外資 目標價`,`${base} ${code} 券商 調升 上看`,...SOURCE_DOMAINS.map(d=>`${base} ${code} 目標價 site:${d}`)];
const rssResults=(await Promise.all(queries.map(fetchRss))).flat();const seen=new Set(),items=[];for(const x of rssResults){const k=`${x.title}|${x.date}`;if(!seen.has(k)){seen.add(k);items.push(x)}}items.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
async function collect(windowDays){const scoped=items.filter(x=>dayAge(x.date)<=windowDays);const selected=scoped.slice(0,60);const articles=await pooled(selected,8,async item=>{const article=await fetchArticle(item.sourceUrl);return{...item,articleUrl:article.url,fullText:`${item.title} ${item.description} ${article.text}`}});const rows=[];for(const item of scoped){const text=`${item.title} ${item.description}`;if(!(text.includes(code)||(name&&text.includes(name))))continue;for(const row of pairRows(text,{date:item.date,title:item.title,sourceUrl:item.sourceUrl},code,name))rows.push(row)}for(const a of articles){const text=a.fullText;if(!(text.includes(code)||(name&&text.includes(name))))continue;for(const row of pairRows(text,{date:a.date,title:a.title,sourceUrl:a.articleUrl||a.sourceUrl},code,name))rows.push(row)}return{rows,articles}}
let collected=await collect(180);if(!collected.rows.length)collected=await collect(360);const rows=collected.rows,articles=collected.articles;
rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));const groups={};for(const row of rows){const key=row.brokerKey||row.broker;groups[key]??=[];if(!groups[key].some(x=>x.target===row.target&&String(x.date||"").slice(0,10)===String(row.date||"").slice(0,10)))groups[key].push(row)}
const brokers=Object.values(groups).map(history=>{const latest=history[0],fullHistory=history.slice(0,5);return{...latest,previousTarget:fullHistory[1]?.target??null,previousDate:fullHistory[1]?.date??null,targetHistory:fullHistory.map(x=>({target:x.target,date:x.date,title:x.title,sourceUrl:x.sourceUrl,periodType:x.periodType,periodLabel:x.periodLabel,revisionReason:x.revisionReason,revisionReasonLabel:x.revisionReasonLabel}))}}).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
return res.status(200).json({ok:true,brokers,fetchedAt:new Date().toISOString(),searchedArticles:articles.length});
}catch(e){return res.status(502).json({ok:false,error:"目標價資料暫時無法取得",detail:e.message})}}
