const RSS_HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/rss+xml,application/xml,text/xml,*/*"};
const PAGE_HEADERS={"User-Agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36","Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","Accept-Language":"zh-TW,zh;q=0.9,en;q=0.7"};

function decode(s="") { return String(s||"").replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).trim(); }
function decodeEntities(s=""){return String(s||"").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")}
function stripHtml(s="") { return decode(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function cleanArticleHtml(html){
  return decodeEntities(String(html||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|tr)>/gi,"\n")
    .replace(/<br\s*\/?\s*>/gi,"\n")
    .replace(/<[^>]+>/g," "))
    .split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean)
    .reduce((out,line)=>{if(out.stop)return out;if(/^(?:延伸閱讀|相關新聞|更多新聞|推薦閱讀|熱門新聞|你可能也喜歡|延伸影音|看更多)/i.test(line)){out.stop=true;return out}out.push(line);return out},{stop:false})
    .filter(Boolean).join("\n");
}
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?decode(m[1]):""}
function sourceTag(block){const m=block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);return m?stripHtml(m[1]):""}
function cleanTitle(s=""){return stripHtml(s).replace(/\s+-\s+[^-]{1,40}$/,'').trim()}
function attr(html,name){const m=String(html||"").match(new RegExp(`${name}=["']([^"']+)["']`,`i`));return m?decodeEntities(m[1]):""}
function usableSourceUrl(url){return /^https?:\/\//i.test(String(url||""))&&!/^https?:\/\/news\.google\.com\//i.test(String(url||""))}
function blockedUrl(url=""){const u=String(url||"").toLowerCase();return /(?:^|\.)cmoney\.tw\/forum\/(?:article|topic|post)\//i.test(u)||/cmoney\.tw\/forum\//i.test(u)}
function blockedNews(x={}){const t=`${x.title||""} ${x.source||""}`;return /股市爆料同學會|同學風向與貼文摘要/.test(t)||blockedUrl(x.url)}
function trimPoint(s="",max=90){s=String(s||"").replace(/\s+/g," ").trim();if(s.length<=max)return s;const cut=s.slice(0,max);const at=Math.max(cut.lastIndexOf("，"),cut.lastIndexOf("；"),cut.lastIndexOf("。"));return (at>=28?cut.slice(0,at):cut).replace(/[，；。]+$/,'')+"…"}
function stockMarkers(s=""){return [...String(s||"").matchAll(/([\u4e00-\u9fffA-Za-z]{2,14})\s*[（(](\d{4,6})[）)]/g)].map(m=>({name:m[1],code:m[2]}))}
function priceOnlySentence(s=""){return /股價|現價|收盤價|漲幅|漲跌|即時股價|盤中.{0,18}(?:漲|跌)|(?:上漲|下跌|強漲|走高|走低).{0,18}(?:%|％|元)|漲停|跌停/.test(String(s||""))}

function absoluteUrl(base,href=""){try{return new URL(decodeEntities(href),base).href}catch{return ""}}
function ampUrlFromHtml(html,base){const m=String(html||"").match(/<link[^>]+rel=["']amphtml["'][^>]+href=["']([^"']+)["']/i)||String(html||"").match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']amphtml["']/i);return m?absoluteUrl(base,m[1]):""}
function embeddedArticleStrings(html){
  const out=[];
  const blocks=String(html||"").match(/<script[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>[\s\S]*?<\/script>/gi)||[];
  for(const block of blocks){
    const raw=block.replace(/^<script[^>]*>/i,"").replace(/<\/script>$/i,"").trim();
    try{
      const root=JSON.parse(raw),seen=new Set();
      const walk=(x,key="")=>{
        if(x==null)return;
        if(typeof x==="string"){
          const t=cleanArticleHtml(x);
          if(t.length>=100&&/[。！？]/.test(t)&&/(article|body|content|text|story|detail|description)/i.test(key)&&!seen.has(t)){seen.add(t);out.push(t)}
          return;
        }
        if(Array.isArray(x)){for(const y of x)walk(y,key);return}
        if(typeof x==="object")for(const [k,v] of Object.entries(x))walk(v,k);
      };
      walk(root);
    }catch{}
  }
  return out;
}
function authorNoiseSentence(s=""){
  const t=String(s||"").trim();
  return /(?:作者|小編|筆者|撰文|編輯|記者|責任編輯|關於作者|個人簡介|自我介紹|本文作者|在.{0,12}(?:產業|公司|科技業).{0,12}(?:工作|任職).{0,10}(?:年|多年|十幾年)|平常(?:習慣|喜歡).{0,12}(?:財報|產業動態|投資)|投資經驗|追蹤產業動態|免責聲明|僅供參考|非投資建議|加入會員|登入|註冊|延伸閱讀|相關新聞|熱門新聞|今天舉行法說會|今日舉行法說會|今日在法說會上表示|概念股|盤中觀察|族群齊揚|值得關注|真正要盯|三道驗證|市場焦點|討論焦點|多空分歧|先進製程需求推動|產業即時新聞)/i.test(t)
}
function headlineOtherNames(headline="",target=""){
  const title=String(headline||""),name=String(target||"").trim(),out=new Set();if(!name)return out;
  const esc=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  for(const re of [new RegExp(`([\\u4e00-\\u9fffA-Za-z]{2,10})[、／/]\\s*${esc}`),new RegExp(`${esc}\\s*[、／/]\\s*([\\u4e00-\\u9fffA-Za-z]{2,10})`)]){
    const m=title.match(re);if(m?.[1]&&m[1]!==name)out.add(m[1]);
  }
  return out;
}
function concisePoint(s="",name="",code=""){
  let t=String(s||"").replace(/\s+/g," ").trim();
  if(!t)return "";
  const n=String(name||"").trim(),c=String(code||"").trim();
  if(n){const esc=n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");t=t.replace(new RegExp(`^(?:半導體|先進封裝|設備)?[^，。；]{0,18}${esc}\s*(?:[（(]${c}[）)])?[^，。；]{0,22}(?:表示|指出|說明|提到|認為|預期|強調)[，,:：]?\s*`),"");t=t.replace(new RegExp(`^${esc}\s*(?:[（(]${c}[）)])?[：:，,]?\s*`),"");t=t.replace(new RegExp(`是${esc}`),"是")}
  t=t.replace(/^(?:公司|該公司|其|同時|另外|此外|至於|而|其中)[，,:：]?\s*/,"");
  t=t.replace(/^[^，。；]{0,35}(?:董事長|總經理|發言人|財務長|法人|公司)[^，。；]{0,20}(?:表示|指出|說明|提到|預期|強調)[，,:：]?\s*/,"");
  t=t.replace(/(?:。|；)+$/g,"").trim();
  return trimPoint(t,72);
}

async function fetchText(url,opts={},timeout=2200){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...opts,signal:c.signal})}finally{clearTimeout(timer)}
}

// 與 v2.4.5.2 targets.js 相同的 Google News Fbv4je 解碼流程。
async function decodeGoogleNewsUrl(url){
  if(!url||!/^https?:\/\/news\.google\.com\//i.test(url))return url;
  try{
    const page=await fetchText(url,{headers:PAGE_HEADERS,redirect:"follow"},1800);
    if(!page.ok)return url;
    const html=await page.text();
    const direct=page.url&&!/^https?:\/\/news\.google\.com\//i.test(page.url)?page.url:"";
    if(direct)return direct;
    let rpcArg="";
    const dp=attr(html,"data-p");
    if(dp){
      try{
        const obj=JSON.parse(dp.replace('%.@.','["garturlreq",'));
        if(Array.isArray(obj)&&obj.length>8){const reduced=[...obj.slice(0,-6),...obj.slice(-2)];rpcArg=JSON.stringify(reduced)}
      }catch{}
    }
    if(!rpcArg){
      const id=attr(html,"data-n-a-id"),ts=attr(html,"data-n-a-ts"),sg=attr(html,"data-n-a-sg");
      if(id&&ts&&sg){
        const context=[["zh-TW","TW",["FINANCE_TOP_INDICES","WEB_TEST_1_0_0"],null,null,1,1,"TW:zh-Hant",null,480,null,null,null,null,null,0,5],"zh-TW","TW",1,[2,4,8],1,1,null,0,0,null,0];
        rpcArg=JSON.stringify(["garturlreq",context,id,Number(ts),sg]);
      }
    }
    if(!rpcArg)return url;
    const fReq=JSON.stringify([[["Fbv4je",rpcArg,"null","generic"]]]);
    const r=await fetchText("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",{method:"POST",headers:{...PAGE_HEADERS,"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8","Referer":"https://news.google.com/"},body:`f.req=${encodeURIComponent(fReq)}`},1800);
    if(!r.ok)return url;
    const txt=await r.text();
    const marker='[\\"garturlres\\",\\"';
    if(txt.includes(marker)){
      const tail=txt.slice(txt.indexOf(marker)+marker.length),raw=tail.split('\\",')[0];
      const decoded=raw.replace(/\\u003d/g,"=").replace(/\\u0026/g,"&").replace(/\\\"/g,'"').replace(/\\\\/g,"\\");
      if(/^https?:\/\//i.test(decoded))return decoded;
    }
    try{
      const json=JSON.parse(txt.replace(/^\)\]\}'\s*/,''));
      const inner=json?.[0]?.[2];if(inner){const u=JSON.parse(inner)?.[1];if(/^https?:\/\//i.test(u))return u}
    }catch{}
    return url;
  }catch{return url}
}

function jsonLdArticleBodies(html){
  const out=[];
  const blocks=String(html||"").match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
  for(const block of blocks){
    const raw=block.replace(/^<script[^>]*>/i,"").replace(/<\/script>$/i,"").trim();
    try{
      const root=JSON.parse(raw),stack=Array.isArray(root)?[...root]:[root];
      while(stack.length){
        const x=stack.shift();if(!x||typeof x!=="object")continue;
        if(Array.isArray(x)){stack.push(...x);continue}
        if(typeof x.articleBody==="string"&&x.articleBody.trim().length>80)out.push(x.articleBody);
        if(Array.isArray(x["@graph"]))stack.push(...x["@graph"]);
      }
    }catch{}
  }
  return out;
}

// 與目標價相同：JSON-LD -> <article> -> 常見正文容器 -> <main>。
// 新聞摘要只接受實際正文，沒有正文就回空字串，不用標題/description 冒充。
function extractArticleText(html,title=""){
  const source=String(html||""),candidates=[];
  for(const body of jsonLdArticleBodies(source))candidates.push(body);
  for(const block of source.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi)||[])candidates.push(cleanArticleHtml(block));
  for(const body of embeddedArticleStrings(source))candidates.push(body);
  const scopedPatterns=[
    /<(?:div|section)[^>]+(?:id|class)=["'][^"']*(?:article[-_ ]?(?:body|content|detail)|story[-_ ]?(?:body|content)|news[-_ ]?(?:body|content)|post[-_ ]?content|entry[-_ ]?content|content[-_ ]?body|article-content|article-body|story-content|story-body|news-content|content-body|main-content|main-article)[^"']*["'][^>]*>[\s\S]{120,}?<\/(?:div|section)>/gi,
    /<main\b[^>]*>[\s\S]*?<\/main>/gi
  ];
  for(const re of scopedPatterns){for(const block of source.match(re)||[])candidates.push(cleanArticleHtml(block))}
  // 結構化正文抓不到時，退到實際 <p> 段落；仍不使用標題或 RSS description 冒充正文。
  const paragraphs=[];
  for(const m of source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)){
    const t=cleanArticleHtml(m[1]);
    if(t.length<24)continue;
    if(/^(延伸閱讀|相關新聞|更多新聞|熱門新聞|責任編輯|版權所有|Copyright|廣告|登入|註冊)/i.test(t))continue;
    paragraphs.push(t);
  }
  if(paragraphs.length>=2)candidates.push(paragraphs.join("\n"));
  const cleaned=candidates.map(x=>cleanArticleHtml(x)).filter(x=>x.length>=80);
  let best=cleaned.sort((a,b)=>b.length-a.length)[0]||"";
  const anchors=[...String(title||"").matchAll(/[\u4e00-\u9fffA-Za-z0-9]{4,}/g)].map(m=>m[0]).slice(0,5);
  const anchored=cleaned.filter(x=>anchors.some(k=>x.includes(k))).sort((a,b)=>b.length-a.length)[0];
  if(anchored)best=anchored;
  return best;
}

async function fetchArticle(url){
  if(!url)return{url:"",text:"",resolved:false,status:0,blocked:false};
  let resolved=url;
  try{resolved=await decodeGoogleNewsUrl(url)}catch{}
  if(blockedUrl(resolved))return{url:resolved,text:"",resolved:true,status:200,blocked:true};
  if(!usableSourceUrl(resolved))return{url:resolved,text:"",resolved:false,status:0,blocked:false};
  const headersList=[PAGE_HEADERS,{...PAGE_HEADERS,"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}];
  let lastStatus=0,lastUrl=resolved,lastHtml="";
  for(const headers of headersList){
    try{
      const r=await fetchText(resolved,{headers,redirect:"follow"},4600),finalUrl=r.url||resolved;lastStatus=r.status;lastUrl=finalUrl;
      if(blockedUrl(finalUrl))return{url:finalUrl,text:"",resolved:true,status:r.status,blocked:true};
      if(!r.ok)continue;
      const html=await r.text();lastHtml=html;
      if(/^https?:\/\/news\.google\.com\//i.test(finalUrl)&&/<c-wiz|DotsSplashUi|data-n-a-/i.test(html))continue;
      const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||"";
      const text=extractArticleText(html,title);
      if(text.length>=80)return{url:finalUrl,text,resolved:true,status:r.status,blocked:false};
    }catch{}
  }
  // 第二層：原頁 HTML 有 AMP 版本時改抓 AMP；不少新聞站正文只在 AMP/SSR 版完整輸出。
  const amp=ampUrlFromHtml(lastHtml,lastUrl);
  if(amp&&!blockedUrl(amp)&&amp!==lastUrl){
    try{
      const r=await fetchText(amp,{headers:PAGE_HEADERS,redirect:"follow"},4200),finalUrl=r.url||amp;
      if(blockedUrl(finalUrl))return{url:finalUrl,text:"",resolved:true,status:r.status,blocked:true};
      if(r.ok){const html=await r.text(),title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||"",text=extractArticleText(html,title);if(text.length>=80)return{url:lastUrl||finalUrl,text,resolved:true,status:r.status,blocked:false}}
    }catch{}
  }
  return{url:lastUrl,text:"",resolved:usableSourceUrl(lastUrl),status:lastStatus,blocked:false};
}

const GROUPS={
  fundamental:["產能","擴產","營收","eps","每股盈餘","毛利","毛利率","獲利","訂單","接單","能見度","財測","資本支出","出貨","營運","營收成長","庫存","產品組合","研發","客戶需求"],
  news:["缺貨","供需","轉型","切入","供應鏈","外溢單","轉單","受惠","新客戶","新產品","新技術","新市場","合作","認證","量產","利多","利空","漲價","降價","同業","產業","矽光子","CPO","CoWoS","先進封裝","設備","下一世代","發展項目"],
  chips:["外資","投信","自營商","法人","主力","大戶","資金流","買超","賣超","持股","籌碼"]
};
const TARGET_WORDS=["目標價","券商喊價","評等","合理價"];
function summarize(text="",code="",name="",headline=""){
  if(text.length<80)return [];
  const targetName=String(name||"").trim(),targetCode=String(code||"").trim(),otherNames=headlineOtherNames(headline,targetName);
  const rawSentences=[];
  for(const line of String(text).split(/[\n\r]+/).map(x=>x.trim()).filter(Boolean)){
    for(const part of line.split(/(?<=[。！？!?；;])/)){const s=part.trim();if(s.length>=12&&s.length<=320)rawSentences.push(s)}
  }
  const prepared=rawSentences.map((s,i)=>{
    const markers=stockMarkers(s),hasOtherCode=markers.some(m=>m.code&&targetCode&&m.code!==targetCode),hasOtherName=[...otherNames].some(n=>s.includes(n));
    const mentionsTarget=(targetName&&s.includes(targetName))||(targetCode&&s.includes(targetCode));
    return{s,i,mentionsTarget,hasOther:hasOtherCode||hasOtherName};
  });
  const multiSubject=otherNames.size>0||prepared.some(x=>x.hasOther);
  const allowed=new Set();
  if(multiSubject){
    for(const x of prepared){if(x.mentionsTarget&&!x.hasOther){allowed.add(x.i);const n=prepared[x.i+1];if(n&&!n.hasOther&&!n.mentionsTarget)allowed.add(n.i)}}
  }else for(const x of prepared)if(!x.hasOther)allowed.add(x.i);

  // 先切成「單一事實片段」再評分；不是限制三點，而是把每一點本身濃縮。
  const facts=[];
  for(const x of prepared){
    if(!allowed.has(x.i)||x.hasOther)continue;
    const clauses=x.s.split(/[，；;]/).map(v=>v.trim()).filter(v=>v.length>=8);
    for(let j=0;j<clauses.length;j++){
      let clause=clauses[j];
      // 已被前一個財報重點合併的比較／原因片段不再各自列一次。
      if(j>0&&/(?:毛利率|營收|EPS|每股盈餘|獲利)/i.test(clauses[j-1])&&/(?:較|年增|年減|季增|季減|上升|下降|成長|衰退|%|％)/.test(clause))continue;
      if(j>1&&/(?:毛利率|營收|EPS|每股盈餘|獲利)/i.test(clauses[j-2])&&/(?:因|主因|係因|導致|產品組合|需求)/.test(clause))continue;
      if(j>0&&/矽光子/.test(clauses[j-1])&&/(?:研發|投入|資源|發展)/.test(clause))continue;
      // 財報比較通常跨 2~3 個逗號，合併成一個完整事實，避免拆成碎句。
      if(/(?:毛利率|營收|EPS|每股盈餘|獲利)/i.test(clause)&&clauses[j+1]&&/(?:較|年增|年減|季增|季減|上升|下降|成長|衰退|%|％)/.test(clauses[j+1])){
        clause=[clause,clauses[j+1],clauses[j+2]&&/(?:因|主因|係因|導致|產品組合|需求)/.test(clauses[j+2])?clauses[j+2]:""].filter(Boolean).join("，");
      }
      if(/矽光子/.test(clause)&&clauses[j+1]&&/(?:研發|投入|資源|發展)/.test(clauses[j+1]))clause=[clause,clauses[j+1]].join("，");
      if(authorNoiseSentence(clause)||priceOnlySentence(clause)||/^(?:目前)?(?:由於)?客戶需求強勁[。！!]?$/i.test(clause))continue;
      const low=clause.toLowerCase();let score=0,kw=0;
      for(const words of Object.values(GROUPS)){const hits=words.filter(w=>low.includes(w.toLowerCase())).length;kw+=hits;score+=hits*5}
      if(TARGET_WORDS.some(w=>clause.includes(w)))score-=7;
      if(/(?:年增|月增|季增|成長|衰退|下降|上升|增加|減少|較去年|較上季|億元|％|%|第[一二三四1234]季|202\d年|能見度)/.test(clause))score+=3;
      if(/(?:下一世代|重要發展|關鍵技術)/.test(clause))score+=4;
      if(/(?:表示|指出|說明|提到|認為|預期|強調)$/.test(clause))score-=3;
      const concrete=/(?:訂單能見度|接單|量產|擴產|資本支出|營收|毛利率|EPS|每股盈餘|獲利|出貨|產能|新客戶|新產品|新技術|新市場|合作|認證|缺貨|供需|轉單|外溢單|漲價|降價|矽光子|CPO|CoWoS|買超|賣超|持股|第[一二三四1234]季|20\d{2}年|\d+(?:\.\d+)?[%％]|\d+(?:\.\d+)?億)/i.test(clause);
      if(!concrete)continue;
      const point=concisePoint(clause,targetName,targetCode);
      if(point.length<7||authorNoiseSentence(point)||priceOnlySentence(point))continue;
      facts.push({point,score:score-x.i*0.001-j*0.0001});
    }
  }
  const sig=p=>{
    if(/訂單.*能見度/.test(p)){const y=p.match(/20\d{2}/)?.[0]||"",q=p.match(/第?([1-4一二三四])季|Q([1-4])/i);return `order|${y}|${q?.[1]||q?.[2]||""}`}
    if(/毛利率/.test(p))return `margin|${(p.match(/\d+(?:\.\d+)?[%％]/g)||[]).join("|")}`;
    if(/矽光子/.test(p))return "silicon-photonics";
    return p.replace(/[\s，。；、：:（）()]/g,"").slice(0,22)
  };
  const best=new Map();
  facts.forEach((x,idx)=>{if(x.score<=0)return;const k=sig(x.point),prev=best.get(k);if(!prev||x.score>prev.score)best.set(k,{...x,idx})});
  return [...best.values()].sort((a,b)=>a.idx-b.idx).slice(0,8).map(x=>x.point);
}

function termsFrom(raw=""){return [...new Set(raw.split(/[，,、;；\n]+/).map(x=>x.trim()).filter(x=>x.length>=2))].slice(0,8)}

module.exports=async function handler(req,res){
  const code=String(req.query.code||"").trim(),name=String(req.query.name||"").trim(),mode=String(req.query.mode||"all");
  if(!code&&!name)return res.status(400).json({ok:false,error:"缺少股票名稱或代碼"});
  const terms=termsFrom(String(req.query.terms||""));
  if(mode==="match"&&!terms.length)return res.status(200).json({ok:true,code,name,mode,items:[]});
  const base=[name,code].filter(Boolean).join(" ");
  const q=mode==="match"?`${base} (${terms.map(x=>`\"${x}\"`).join(" OR ")})`:base;
  const since=String(req.query.since||"").trim(),dateOk=/^\d{4}-\d{2}-\d{2}$/.test(since);
  const window=dateOk?` after:${since}`:" when:30d";
  const rss=`https://news.google.com/rss/search?q=${encodeURIComponent(q+window)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  try{
    const r=await fetch(rss,{headers:RSS_HEADERS});if(!r.ok)throw new Error(`Google News HTTP ${r.status}`);
    const xml=await r.text(),raw=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]).map(block=>({title:stripHtml(tag(block,"title")),url:stripHtml(tag(block,"link")),publishedAt:stripHtml(tag(block,"pubDate")),source:sourceTag(block)})).filter(x=>x.title&&x.url&&!blockedNews(x));
    const seen=new Set(),picked=[];for(const x of raw){const k=x.title.replace(/【[^】]{0,16}】/g,"").replace(/[「」『』\[\]()（）｜|：:，,。！？!?\s]/g,"").replace(/即時新聞|新聞/g,"").toLowerCase();if([...seen].some(y=>k===y||(k.length>18&&y.length>18&&(k.includes(y)||y.includes(k)))))continue;seen.add(k);picked.push(x);if(picked.length>=24)break}
    const items=[];
    for(let i=0;i<picked.length;i+=4){
      const batch=picked.slice(i,i+4);
      const got=await Promise.all(batch.map(async x=>{const a=await fetchArticle(x.url);if(a.blocked)return null;const points=summarize(a.text,code,name,x.title);return {...x,title:cleanTitle(x.title)||x.title,url:a.url||x.url,summaryPoints:points,summary:points.join("\n"),contentAvailable:points.length>0}}));
      items.push(...got.filter(Boolean))
    }
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");return res.status(200).json({ok:true,code,name,mode,items});
  }catch(e){return res.status(502).json({ok:false,error:e.message||"新聞搜尋失敗"})}
}
