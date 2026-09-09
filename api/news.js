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
    .split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean).filter((line,i,arr)=>{const cut=arr.findIndex(x=>/^(?:延伸閱讀|相關新聞|更多新聞|推薦閱讀|熱門新聞|你可能也喜歡|延伸影音|看更多)/i.test(x));return cut<0||i<cut}).join("\n");
}
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?decode(m[1]):""}
function sourceTag(block){const m=block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);return m?stripHtml(m[1]):""}
function cleanTitle(s=""){return stripHtml(s).replace(/\s+-\s+[^-]{1,40}$/,'').trim()}
function attr(html,name){const m=String(html||"").match(new RegExp(`${name}=["']([^"']+)["']`,`i`));return m?decodeEntities(m[1]):""}
function usableSourceUrl(url){return /^https?:\/\//i.test(String(url||""))&&!/^https?:\/\/news\.google\.com\//i.test(String(url||""))}
function blockedUrl(url=""){const u=String(url||"").toLowerCase();return /(?:^|\.)cmoney\.tw\/forum\/(?:article|topic|post)\//i.test(u)||/cmoney\.tw\/forum\//i.test(u)}
function pureFlowTitle(title=""){
  const t=String(title||"").replace(/\s+/g," ").trim();
  if(!t)return false;
  // 只排除「整篇主題就是法人/外資/投信買賣超排行」；一般新聞內文提到買賣超仍保留。
  return /(?:三大法人買賣超|外資買賣超|投信買賣超|自營商買賣超|法人合計買賣超|買超股票\s*TOP\s*\d+|賣超股票\s*TOP\s*\d+|買賣超股票\s*TOP\s*\d+|外資買超金額最大|外資賣超金額最大|投信買超金額最大|投信賣超金額最大|法人買超金額最大|法人賣超金額最大)/i.test(t)
    && !/(?:營收|獲利|毛利率|EPS|訂單|產能|擴產|量產|法說|財測|新產品|新技術|客戶|合作|漲價|降價|缺貨|供需)/i.test(t);
}
function blockedTitle(title=""){
  const t=String(title||"");
  return pureFlowTitle(t)||/(?:零股排行榜|零股排行|盤中零股成交量|零股成交量\s*TOP|零股成交量TOP|零股交易排行|PTT\s*[:：]|神秘客|洗盤結束|該補漲了|盤前分析|籌碼卡位|短線朋友|技術面.*(?:買點|賣點|洗盤|拉回))/i.test(t);
}
function blockedNews(x={}){const t=`${x.title||""} ${x.source||""}`;return /股市爆料同學會|同學風向與貼文摘要/.test(t)||blockedUrl(x.url)||blockedTitle(x.title)}
function trimPoint(s="",max=90){s=String(s||"").replace(/\s+/g," ").trim();if(s.length<=max)return s;const cut=s.slice(0,max);const at=Math.max(cut.lastIndexOf("，"),cut.lastIndexOf("；"),cut.lastIndexOf("。"));return (at>=28?cut.slice(0,at):cut).replace(/[，；。]+$/,'')+"…"}
function stockMarkers(s=""){return [...String(s||"").matchAll(/([\u4e00-\u9fffA-Za-z]{2,14})\s*[（(](\d{4,6})[）)]/g)].map(m=>({name:m[1],code:m[2]}))}
function priceOnlySentence(s=""){return /股價|現價|收盤價|漲幅|漲跌|即時股價|盤中.{0,18}(?:漲|跌)|(?:上漲|下跌|強漲|走高|走低).{0,18}(?:%|％|元)|漲停|跌停/.test(String(s||""))}

function absoluteUrl(base,href=""){try{return new URL(decodeEntities(href),base).href}catch{return ""}}
function ampUrlFromHtml(html,base){const m=String(html||"").match(/<link[^>]+rel=["']amphtml["'][^>]+href=["']([^"']+)["']/i)||String(html||"").match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']amphtml["']/i);return m?absoluteUrl(base,m[1]):""}
function canonicalUrlFromHtml(html,base){
  const src=String(html||"");
  const m=src.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)||src.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)||src.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  const u=m?absoluteUrl(base,m[1]):"";return usableSourceUrl(u)&&!blockedUrl(u)?u:"";
}
function isCmoneyUrl(url=""){try{return /(?:^|\.)cmoney\.tw$/i.test(new URL(String(url||"")).hostname)}catch{return false}}
function cmoneyNid(url="",html=""){
  const src=`${String(url||"")} ${String(html||"")}`;
  const m=src.match(/[?&]nid=(\d{4,})/i)||src.match(/note[-_]?detail[^"'<>]{0,80}nid[=:"'\s]+(\d{4,})/i)||src.match(/\bnid["']?\s*[:=]\s*["']?(\d{4,})/i);
  return m?.[1]||"";
}
function cmoneyNoteUrl(nid=""){return /^\d{4,}$/.test(String(nid||""))?`https://www.cmoney.tw/notes/note-detail.aspx?nid=${nid}`:""}
function normalizeCmoneyUrl(url="",html=""){
  const nid=cmoneyNid(url,html);return nid?cmoneyNoteUrl(nid):String(url||"");
}
function titleSimilarity(a="",b=""){
  const norm=x=>String(x||"").replace(/【[^】]*】/g,"").replace(/[「」『』\[\](){ }（）｜|：:，,。！？!?%％\s]/g,"").toLowerCase();
  const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 100;
  const shorter=x.length<y.length?x:y,longer=x.length<y.length?y:x;
  if(shorter.length>=12&&longer.includes(shorter))return 80+Math.min(15,shorter.length/4);
  let hit=0;for(let i=0;i<shorter.length-2;i+=3)if(longer.includes(shorter.slice(i,i+3)))hit++;
  return hit/Math.max(1,Math.ceil((shorter.length-2)/3))*60;
}
async function recoverCmoneyByTitle(title="",name="",code=""){
  const query=[name&&`"${name}"`,code&&`"${code}"`,`CMoney`].filter(Boolean).join(" ")+" when:45d";
  if(!query.trim())return "";
  try{
    const rss=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const r=await fetchText(rss,{headers:RSS_HEADERS},2600);if(!r.ok)return "";
    const xml=await r.text();
    const rows=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m=>m[1]).map(block=>({title:stripHtml(tag(block,"title")),url:stripHtml(tag(block,"link")),source:sourceTag(block)})).filter(x=>/CMoney/i.test(x.source)||/cmoney/i.test(x.title));
    rows.sort((a,b)=>titleSimilarity(b.title,title)-titleSimilarity(a.title,title));
    for(const x of rows.slice(0,5)){
      const d=await decodeGoogleNewsUrl(x.url);const u=normalizeCmoneyUrl(d);if(isCmoneyUrl(u)&&/note-detail\.aspx\?nid=\d+/i.test(u))return u;
    }
  }catch{}
  return "";
}
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
  return /(?:作者|小編|筆者|撰文|編輯|記者|責任編輯|關於作者|個人簡介|自我介紹|本文作者|在.{0,12}(?:產業|公司|科技業).{0,12}(?:工作|任職).{0,10}(?:年|多年|十幾年)|平常(?:習慣|喜歡).{0,12}(?:財報|產業動態|投資)|投資經驗|追蹤產業動態|免責聲明|僅供參考|非投資建議|加入會員|登入|註冊|延伸閱讀|相關新聞|熱門新聞|今天舉行法說會|今日舉行法說會|今日在法說會上表示|概念股|盤中觀察|族群齊揚|值得關注|真正要盯|三道驗證|市場焦點|討論焦點|多空分歧|產業即時新聞|主要業務|台股公司基本資料|深層頁|確認標的|閱讀更多|延伸影音)/i.test(t)
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
  let source=String(html||"");
  // 先在 HTML 層切掉「延伸閱讀／相關新聞」區塊，避免其他新聞被當成本文。
  const related=source.match(/<[^>]+>\s*(?:延伸閱讀|相關新聞|更多新聞|推薦閱讀|熱門新聞|你可能也喜歡|看更多)\s*[:：]?\s*<\/[^>]+>/i);
  if(related&&Number.isFinite(related.index)&&related.index>500)source=source.slice(0,related.index);
  const anchors=[...String(title||"").matchAll(/[\u4e00-\u9fffA-Za-z0-9]{4,}/g)].map(m=>m[0]).slice(0,5);
  const choose=tier=>{
    const cleaned=(tier||[]).map(x=>cleanArticleHtml(x)).filter(x=>x.length>=80);
    if(!cleaned.length)return "";
    const anchored=cleaned.filter(x=>anchors.some(k=>x.includes(k))).sort((a,b)=>b.length-a.length)[0];
    return anchored||cleaned.sort((a,b)=>b.length-a.length)[0]||"";
  };
  // 嚴格維持正文容器優先級，不能讓較長的 <main>／整頁段落蓋過真正 <article>。
  const jsonTier=jsonLdArticleBodies(source);
  let best=choose(jsonTier);if(best)return best;
  const articleTier=source.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi)||[];
  best=choose(articleTier);if(best)return best;
  const scopedTier=[];
  const scoped=/<(?:div|section)[^>]+(?:id|class)=["'][^"']*(?:article[-_ ]?(?:body|content|detail)|story[-_ ]?(?:body|content)|news[-_ ]?(?:body|content)|post[-_ ]?content|entry[-_ ]?content|content[-_ ]?body|article-content|article-body|story-content|story-body|news-content|content-body|main-content|main-article)[^"']*["'][^>]*>[\s\S]{120,}?<\/(?:div|section)>/gi;
  for(const block of source.match(scoped)||[])scopedTier.push(block);
  best=choose(scopedTier);if(best)return best;
  best=choose(embeddedArticleStrings(source));if(best)return best;
  best=choose(source.match(/<main\b[^>]*>[\s\S]*?<\/main>/gi)||[]);if(best)return best;
  // 最後才退到 <p>，且遇到相關新聞標題即停止。
  const paragraphs=[];
  for(const m of source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)){
    const t=cleanArticleHtml(m[1]);
    if(/^(?:延伸閱讀|相關新聞|更多新聞|熱門新聞|推薦閱讀|你可能也喜歡|看更多)/i.test(t))break;
    if(t.length<24||/^(?:責任編輯|版權所有|Copyright|廣告|登入|註冊)/i.test(t))continue;
    paragraphs.push(t);
  }
  return paragraphs.length>=2?cleanArticleHtml(paragraphs.join("\n")):"";
}
function anchoredWholePageText(html,title=""){
  const text=cleanArticleHtml(html);if(text.length<140)return "";
  const rawTitle=stripHtml(title).replace(/\s+-\s+[^-]{1,40}$/,'').trim();
  let start=-1;
  if(rawTitle.length>=8)start=text.indexOf(rawTitle);
  if(start<0){const key=(rawTitle.match(/[\u4e00-\u9fffA-Za-z0-9]{6,}/)||[])[0]||"";if(key)start=text.indexOf(key)}
  if(start<0)return "";
  let body=text.slice(start+Math.min(rawTitle.length,120));
  const stop=body.search(/(?:文章相關股票|想更快掌握|延伸閱讀|相關新聞|更多新聞|推薦閱讀|熱門新聞|CMoney 團隊透過|關於作者|免責聲明|Copyright)/i);
  if(stop>120)body=body.slice(0,stop);
  body=body.split(/\n+/).filter(line=>!/^(?:CMoney|撰文者|作者|更新|最後更新|收藏|分享|瀏覽人次|標籤|繼續閱讀)/i.test(line.trim())).join("\n");
  return body.length>=100&&/[。！？]/.test(body)?body:"";
}

async function fetchArticle(url,meta={}){
  if(!url)return{url:"",text:"",resolved:false,status:0,blocked:false};
  const original=url;
  let resolved=url;
  try{resolved=await decodeGoogleNewsUrl(url)}catch{}
  if(isCmoneyUrl(resolved))resolved=normalizeCmoneyUrl(resolved);
  if(blockedUrl(resolved))return{url:resolved,text:"",resolved:true,status:200,blocked:true};
  if(!usableSourceUrl(resolved))return{url:original,text:"",resolved:false,status:0,blocked:false};
  const headersList=[PAGE_HEADERS,{...PAGE_HEADERS,"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}];
  let lastStatus=0,lastUrl=resolved,lastHtml="",verifiedUrl="";
  const attempt=async candidate=>{
    for(const headers of headersList){
      try{
        const r=await fetchText(candidate,{headers,redirect:"follow"},5200),finalUrl=r.url||candidate;lastStatus=r.status;lastUrl=finalUrl;
        if(blockedUrl(finalUrl))return{done:true,result:{url:finalUrl,text:"",resolved:true,status:r.status,blocked:true}};
        if(!r.ok)continue;
        const html=await r.text();lastHtml=html;verifiedUrl=finalUrl;
        if(/^https?:\/\/news\.google\.com\//i.test(finalUrl)&&/<c-wiz|DotsSplashUi|data-n-a-/i.test(html))continue;
        const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||meta.title||"";
        let text=extractArticleText(html,title);
        if(text.length<80)text=anchoredWholePageText(html,title||meta.title||"");
        if(text.length>=80){
          const canonical=canonicalUrlFromHtml(html,finalUrl),cmoney=normalizeCmoneyUrl(canonical||finalUrl,html);
          const clickUrl=isCmoneyUrl(cmoney)?cmoney:(canonical||finalUrl);
          return{done:true,result:{url:clickUrl,text,resolved:true,status:r.status,blocked:false}};
        }
      }catch{}
    }
    return{done:false};
  };

  let got=await attempt(resolved);if(got.done)return got.result;

  // CMoney 常見問題：Google News 解到舊路徑或 404。只要能取得 nid 就重建正式 note-detail URL；否則用標題再找一次。
  if(isCmoneyUrl(resolved)||/CMoney/i.test(String(meta.source||""))){
    const reconstructed=normalizeCmoneyUrl(resolved,lastHtml);
    if(reconstructed&&reconstructed!==resolved){got=await attempt(reconstructed);if(got.done)return got.result}
    const recovered=await recoverCmoneyByTitle(meta.title||"",meta.name||"",meta.code||"");
    if(recovered&&recovered!==resolved&&recovered!==reconstructed){got=await attempt(recovered);if(got.done)return got.result}
  }

  // 第二層：原頁 HTML 有 AMP 版本時改抓 AMP。
  const amp=ampUrlFromHtml(lastHtml,lastUrl);
  if(amp&&!blockedUrl(amp)&&amp!==lastUrl){
    got=await attempt(amp);if(got.done)return got.result;
  }
  // 不能把已確認 404 的 publisher URL 當點擊網址；退回原 Google News 連結至少不會直送失效頁。
  return{url:verifiedUrl||original,text:"",resolved:usableSourceUrl(verifiedUrl||original),status:lastStatus,blocked:false};
}


const GROUPS={
  fundamental:["產能","擴產","營收","eps","每股盈餘","毛利","毛利率","獲利","訂單","接單","能見度","財測","資本支出","出貨","營運","營收成長","庫存","產品組合","研發","客戶需求"],
  news:["缺貨","供需","轉型","切入","供應鏈","外溢單","轉單","受惠","新客戶","新產品","新技術","新市場","合作","認證","量產","利多","利空","漲價","降價","同業","產業","矽光子","CPO","CoWoS","先進封裝","設備","下一世代","發展項目"],
  chips:["外資","投信","自營商","法人","主力","大戶","資金流","買超","賣超","持股","籌碼"]
};
const TARGET_WORDS=["目標價","券商喊價","評等","合理價"];
const OTHER_COMPANY_TOKENS=["台積電","日月光","聯發科","鴻海","廣達","緯創","緯穎","奇鋐","雙鴻","信驊","世芯","創意","AMD","NVIDIA","輝達","Intel","英特爾","Broadcom","博通","Micron","美光","Samsung","三星","SK海力士","ASML","Applied Materials","應材","Lam Research","科林研發"]; 
function unrelatedCompanySentence(s="",name="",code=""){
  const t=String(s||""),n=String(name||"").trim(),c=String(code||"").trim();
  if((n&&t.includes(n))||(c&&t.includes(c)))return false;
  const markers=stockMarkers(t);if(markers.some(x=>x.code&&x.code!==c))return true;
  return OTHER_COMPANY_TOKENS.some(x=>x!==n&&t.toLowerCase().includes(x.toLowerCase()));
}
function normNewsText(s=""){return String(s||"").replace(/【[^】]*】/g,"").replace(/[\s，。；、：:（）()「」『』｜|／/!?！？]/g,"").toLowerCase()}
function stripLeadJunk(s=""){
  return String(s||"")
    .replace(/^(?:以及|並且|並|而且|但|不過|然而|即使|另外|此外|同時|至於|其中|值得注意的是|市場認為|市場預期|外界預期|法人認為|法人預期|消息指出)[，,:：]?\s*/,"")
    .replace(/^(?:根據[^，。]{0,24}(?:財報|資料|統計|公告))[，,:：]?\s*/,"")
    .trim();
}
function obviousBoilerplate(s=""){
  const t=String(s||"").trim();
  return /(?:更新時間|最後更新|發布時間|本文僅供|投資人仍應|投資有風險|本文不代表|合作關係|部分商品|平台與Yahoo|作者觀點|個人看法|因此選擇|先將低檔布局|核心持股仍應|應扣有賺錢的AI股|不構成投資建議|按讚|分享|訂閱|加入LINE|更多內容|完整文章|點此查看|來源：|圖片來源)/i.test(t)
    || /^20\d{2}年\d{1,2}月\d{1,2}日(?:週.|星期.)?\s*(?:上午|下午)?\d{1,2}:\d{2}$/i.test(t);
}
function fragmentLike(s=""){
  const t=String(s||"").trim();
  if(!t)return true;
  return /^(?:即使|雖然|儘管|在.+(?:情況|情形|背景|之下)|因為|由於|受到|若|如果|隨著|相較|較去年|較上季|但|不過|然而|並|以及|同時)/.test(t)
    || /(?:的情況下|之下|之際|同時)$/.test(t);
}
function sentenceHasConcrete(s=""){
  return /(?:訂單能見度|訂單|接單|產能|擴產|量產|資本支出|營收|毛利率|EPS|每股盈餘|獲利|出貨|庫存|客戶|新產品|新技術|新市場|認證|合作|切入|供需|缺貨|轉單|漲價|降價|矽光子|CPO|CoWoS|先進封裝|買超|賣超|持股|外資|投信|自營商|20\d{2}年|第[一二三四1234]季|Q[1-4]|\d+(?:\.\d+)?[%％]|\d+(?:\.\d+)?億|\d+(?:\.\d+)?兆)/i.test(String(s||""));
}
function genericLowValue(s=""){
  const t=String(s||"").trim();
  if(/(?:市場期待|市場關注|值得關注|備受關注|成為焦點|討論焦點|表現強勢|表現亮眼|題材發酵|族群齊揚|多頭結構|多空分歧|後市可期|前景看好|成長動能可期|有望受惠|搶卡位|概念股|大戶籌碼動向曝光|盤中強勢|短線拉回|高檔震盪|均線|KD|MACD)/i.test(t)&&!/(?:\d+(?:\.\d+)?[%％億兆]|訂單|產能|營收|毛利率|EPS|量產|資本支出)/i.test(t))return true;
  if(/^(?:全球最大|全球領先|半導體龍頭|晶圓代工龍頭).{0,30}(?:公司|廠|台積電)/.test(t)&&!/(?:\d|擴產地點|資本支出|產能增加|量產)/.test(t))return true;
  return false;
}
function directTargetMention(s="",name="",code=""){
  const t=String(s||"");return !!((name&&t.includes(name))||(code&&t.includes(code)));
}
function otherCompanyMention(s="",name="",code=""){
  return unrelatedCompanySentence(s,name,code);
}
function removeOtherCompanyClauses(s="",name="",code=""){
  const parts=String(s||"").split(/([，；。])/),out=[];let lastSep="";
  for(let i=0;i<parts.length;i+=2){
    const part=(parts[i]||"").trim(),sep=parts[i+1]||"";if(!part)continue;
    const direct=directTargetMention(part,name,code),other=otherCompanyMention(part,name,code);
    if(other&&!direct)continue;
    out.push((lastSep&&out.length?lastSep:"")+part);lastSep=sep;
  }
  return out.join("").trim()||String(s||"");
}
function compressPoint(s="",name="",code=""){
  let t=stripLeadJunk(concisePoint(removeOtherCompanyClauses(s,name,code),name,code));
  // 第二次濃縮：把第一層抽出的句群改寫成「事實句」，不是只做表面清字。
  t=t.replace(/^(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*/,"");
  t=t.replace(/^(?:護國神山|晶圓代工龍頭|全球最大晶圓代工廠|全球最大晶圓代工廠商|半導體龍頭|科技巨頭|重量級|市場焦點|指標大廠|指標股)\s*/,"");
  t=t.replace(/(?:法人圈)?(?:普遍)?(?:吃下定心丸|抱持樂觀看法|充滿期待|看好後市)/g,"");
  t=t.replace(/(?:不約而同|普遍|順利|備受|持續受到|相當|非常|明顯|積極地|強勁地|全力|大舉|火速|強勢|重磅|驚人|亮眼|樂觀地)/g,"");
  t=t.replace(/(?:成為市場焦點|引發市場關注|值得關注|備受市場關注|受到市場矚目|成為討論焦點|為後市增添想像空間)/g,"");
  t=t.replace(/(?:市場|法人|投資人|外界)[^，。；]{0,18}(?:認為|預期|看好|關注)[，,:：]?\s*/g,"");
  t=t.replace(/(?:目前|現階段|近期|接下來)\s*(?=(?:公司|訂單|產能|營收|毛利率|EPS|矽光子|資本支出|客戶|產品))/g,"");
  t=t.replace(/(?:非常)?努力(?:在)?進行(?:的)?/g,"").replace(/持續(?:投入)?(?:研發)?(?:人力|資源)?/g,"持續投入研發");
  t=t.replace(/(較去年同期[^，。]{0,24}(?:下降|下滑))[，,]?(?:是)?因([^，。]{2,32})導致較去年同期(?:略為|微幅)?(?:下降|下滑)/,"$1，主因$2");
  // 刪掉只負責新聞語氣、移除後不改變事實的子句。
  t=t.split(/(?<=[，；])/).map(x=>x.trim()).filter(x=>x&&!/^(?:顯示|反映|意味著|可見|由此可見|這也讓|這使得).{0,30}(?:市場|投資人|法人|後市|信心|期待)/.test(x)).join("");
  t=t.replace(/，\s*(?:法人圈|市場|投資人)[^，。]{0,28}(?=，|$)/g,"");
  // 常見「公布時間 + 投顧預估」合併為單一事實，避免把開獎/倒數當重點。
  const fm=t.match(/^(.{2,10}?)(?:[（(](\d{4,6})[）)])?\s*(\d{1,2}月營收)(?:即將|將)?(?:在)?(?:下週|下周|近期)?(?:公布|開獎)?[，,]\s*(.{2,36}?)(?:董事長|董座|研究員)?(?:預估|預期|看好)營收(?:將|可望|有望)?(?:突破|越過|達|衝上)?\s*([\d,.]+億元)/);
  if(fm){const subject=(name||fm[1]||"").trim(),who=fm[4].replace(/(?:董事長|董座|研究員)/g,"").trim();t=`${who}預期${subject}${fm[3]}突破${fm[5]}`}
  t=t.replace(/([投顧券商]{2,}|(?:群益|統一|元大|國泰|富邦|中信|第一金|凱基|永豐|玉山|兆豐)投顧)(?:董事長|董座|研究員)/g,"$1");
  t=t.replace(/。(?=(?:在|因|主因|因此|受到|較|相較|海外|公司))/g,"，");
  t=t.replace(/^[，、；：:\s]+|[。；，\s]+$/g,"").replace(/，{2,}/g,"，").replace(/\s+/g," ").trim();
  return trimPoint(t,78);
}

function pointKey(p=""){
  const n=normNewsText(p);
  if(/訂單.*能見度/.test(p)){const y=p.match(/20\d{2}/)?.[0]||"",q=p.match(/第?([1-4一二三四])季|Q([1-4])/i);return `order|${y}|${q?.[1]||q?.[2]||""}`}
  if(/毛利率/.test(p))return `margin|${(p.match(/\d+(?:\.\d+)?[%％]/g)||[]).join("|")}`;
  if(/營收/.test(p)&&/年增|月增|季增|成長|衰退|下降/.test(p))return `revenue|${(p.match(/\d+(?:\.\d+)?[%％]/g)||[]).join("|")}`;
  if(/矽光子/.test(p))return "silicon-photonics";
  return n.slice(0,30);
}
function summarize(text="",code="",name="",headline=""){
  if(text.length<80||blockedTitle(headline))return [];
  const targetName=String(name||"").trim(),targetCode=String(code||"").trim();
  const sentences=[];
  for(const line of String(text).split(/[\n\r]+/).map(x=>x.trim()).filter(Boolean)){
    if(/^(?:延伸閱讀|相關新聞|更多新聞|推薦閱讀|熱門新聞|你可能也喜歡|看更多)/i.test(line))break;
    if(obviousBoilerplate(line)||authorNoiseSentence(line))continue;
    for(const z of line.split(/(?<=[。！？!?；;])/).map(x=>x.trim()).filter(x=>x.length>=8&&x.length<=360)){
      if(!obviousBoilerplate(z)&&!authorNoiseSentence(z))sentences.push(z);
    }
  }
  const candidates=[];
  for(let i=0;i<sentences.length;i++){
    const s0=sentences[i];
    if(!directTargetMention(s0,targetName,targetCode))continue;
    if(priceOnlySentence(s0)||genericLowValue(s0))continue;
    let parts=[s0];
    // 只承接緊鄰的因果／比較／代名詞句；遇到別家公司立即停止。
    for(let j=1;j<=2&&i+j<sentences.length;j++){
      const nx=sentences[i+j];
      if(otherCompanyMention(nx,targetName,targetCode)&&!directTargetMention(nx,targetName,targetCode))break;
      const connective=fragmentLike(nx)||/^(?:公司|該公司|其|同時|另外|此外|其中|主因|原因|因此|因而|導致|受到|較|相較)/.test(nx);
      const continuation=!directTargetMention(nx,targetName,targetCode)&&connective&&sentenceHasConcrete(nx);
      if(continuation)parts.push(nx); else break;
    }
    // 若後句已完整包含前句的核心數字/事件，直接以後句為主，避免重複敘述。
    if(parts.length>1){
      const firstCore=normNewsText(compressPoint(parts[0],targetName,targetCode));
      const later=parts.slice(1).join(" ");
      if(firstCore.length>6&&normNewsText(later).includes(firstCore.slice(0,Math.min(14,firstCore.length))))parts=parts.slice(1);
    }
    let g=parts.join(" ").replace(/\s+/g," ").trim();
    if(!g||obviousBoilerplate(g)||authorNoiseSentence(g)||priceOnlySentence(g)||genericLowValue(g))continue;
    if(!sentenceHasConcrete(g))continue;
    candidates.push({g,order:i});
  }

  const facts=[];
  for(const {g,order} of candidates){
    let score=0,low=g.toLowerCase();
    for(const words of Object.values(GROUPS))score+=words.filter(w=>low.includes(w.toLowerCase())).length*4;
    if(/\d+(?:\.\d+)?[%％億兆]/.test(g))score+=4;
    if(/(?:年增|月增|季增|較去年|較上季|主因|導致|訂單能見度|量產|擴產|資本支出|認證|新客戶|新產品)/.test(g))score+=5;
    if(TARGET_WORDS.some(w=>g.includes(w)))score-=5;
    if(score<9)continue;
    let point=compressPoint(g,targetName,targetCode);
    point=point.replace(/^(?:（?\d{4,6}）?)\s*/,"");
    if(point.length<8||obviousBoilerplate(point)||authorNoiseSentence(point)||priceOnlySentence(point)||genericLowValue(point))continue;
    if(/^(?:根據|以及|並|但|不過|然而|因此|由於|受到|即使)/.test(point))continue;
    facts.push({point,score,order});
  }

  const kept=[];
  for(const x of facts.sort((a,b)=>b.score-a.score||a.order-b.order)){
    const key=pointKey(x.point),norm=normNewsText(x.point);
    if(kept.some(y=>y.key===key||(norm.length>18&&y.norm.length>18&&(norm.includes(y.norm)||y.norm.includes(norm)))))continue;
    kept.push({...x,key,norm});
  }
  return kept.sort((a,b)=>a.order-b.order).slice(0,8).map(x=>x.point);
}

function termsFrom(raw=""){return [...new Set(raw.split(/[，,、;；\n]+/).map(x=>x.trim()).filter(x=>x.length>=2))].slice(0,8)}

module.exports=async function handler(req,res){
  const code=String(req.query.code||"").trim(),name=String(req.query.name||"").trim(),mode=String(req.query.mode||"all");
  if(!code&&!name)return res.status(400).json({ok:false,error:"缺少股票名稱或代碼"});
  const terms=termsFrom(String(req.query.terms||""));
  if(mode==="match"&&!terms.length)return res.status(200).json({ok:true,code,name,mode,items:[]});
  const base=[name,code].filter(Boolean).join(" ");
  const since=String(req.query.since||"").trim(),dateOk=/^\d{4}-\d{2}-\d{2}$/.test(since);
  const window=dateOk?` after:${since}`:" when:30d";
  const queries=mode==="match"
    ? [`${base} (${terms.map(x=>`\"${x}\"`).join(" OR ")})`]
    : [...new Set([base,name,code,name&&code?`\"${name}(${code})\"`:""]).filter(Boolean)];
  try{
    const xmls=[];
    for(const q of queries.slice(0,4)){
      const rss=`https://news.google.com/rss/search?q=${encodeURIComponent(q+window)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
      const r=await fetch(rss,{headers:RSS_HEADERS});if(!r.ok)continue;xmls.push(await r.text());
    }
    if(!xmls.length)throw new Error("Google News 無可用回應");
    const raw=xmls.flatMap(xml=>[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]).map(block=>({title:stripHtml(tag(block,"title")),url:stripHtml(tag(block,"link")),publishedAt:stripHtml(tag(block,"pubDate")),source:sourceTag(block)}))).filter(x=>x.title&&x.url&&!blockedNews(x));
    raw.sort((a,b)=>{const score=x=>((name&&x.title.includes(name))?8:0)+((code&&x.title.includes(code))?8:0)+(/CMoney/i.test(x.source)?2:0)+(Date.parse(x.publishedAt)||0)/1e13;return score(b)-score(a)});
    const seen=[] ,picked=[];for(const x of raw){const k=x.title.replace(/【[^】]{0,16}】/g,"").replace(/[「」『』\[\]()（）｜|：:，,。！？!?\s]/g,"").replace(/即時新聞|新聞/g,"").toLowerCase();if(seen.some(y=>k===y||(k.length>18&&y.length>18&&(k.includes(y)||y.includes(k)))))continue;seen.push(k);picked.push(x);if(picked.length>=32)break}
    const items=[];
    for(let i=0;i<picked.length;i+=4){
      const batch=picked.slice(i,i+4);
      const got=await Promise.all(batch.map(async x=>{const a=await fetchArticle(x.url,{title:x.title,source:x.source,name,code});if(a.blocked)return null;const points=summarize(a.text,code,name,x.title);return {...x,title:cleanTitle(x.title)||x.title,url:a.url||x.url,summaryPoints:points,summary:points.join("\n"),contentAvailable:points.length>0}}));
      items.push(...got.filter(Boolean))
    }
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");return res.status(200).json({ok:true,code,name,mode,items});
  }catch(e){return res.status(502).json({ok:false,error:e.message||"新聞搜尋失敗"})}
}
