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
    .split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean).join("\n");
}
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?decode(m[1]):""}
function sourceTag(block){const m=block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);return m?stripHtml(m[1]):""}
function cleanTitle(s=""){return stripHtml(s).replace(/\s+-\s+[^-]{1,40}$/,'').trim()}
function attr(html,name){const m=String(html||"").match(new RegExp(`${name}=["']([^"']+)["']`,`i`));return m?decodeEntities(m[1]):""}
function usableSourceUrl(url){return /^https?:\/\//i.test(String(url||""))&&!/^https?:\/\/news\.google\.com\//i.test(String(url||""))}

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
  const scopedPatterns=[
    /<(?:div|section)[^>]+(?:id|class)=["'][^"']*(?:article[-_ ]?(?:body|content|detail)|story[-_ ]?(?:body|content)|news[-_ ]?(?:body|content)|post[-_ ]?content|entry[-_ ]?content|content[-_ ]?body)[^"']*["'][^>]*>[\s\S]{120,}?<\/(?:div|section)>/gi,
    /<main\b[^>]*>[\s\S]*?<\/main>/gi
  ];
  for(const re of scopedPatterns){for(const block of source.match(re)||[])candidates.push(cleanArticleHtml(block))}
  const cleaned=candidates.map(x=>cleanArticleHtml(x)).filter(x=>x.length>=80);
  let best=cleaned.sort((a,b)=>b.length-a.length)[0]||"";
  const anchors=[...String(title||"").matchAll(/[\u4e00-\u9fffA-Za-z0-9]{4,}/g)].map(m=>m[0]).slice(0,5);
  const anchored=cleaned.filter(x=>anchors.some(k=>x.includes(k))).sort((a,b)=>b.length-a.length)[0];
  if(anchored)best=anchored;
  return best;
}

async function fetchArticle(url){
  if(!url)return{url:"",text:"",resolved:false,status:0};
  let resolved=url;
  try{resolved=await decodeGoogleNewsUrl(url)}catch{}
  if(!usableSourceUrl(resolved))return{url:resolved,text:"",resolved:false,status:0};
  try{
    const r=await fetchText(resolved,{headers:PAGE_HEADERS,redirect:"follow"},4200);
    const finalUrl=r.url||resolved;
    if(!r.ok)return{url:finalUrl,text:"",resolved:finalUrl!==url,status:r.status};
    const html=await r.text();
    if(/^https?:\/\/news\.google\.com\//i.test(finalUrl)&&/<c-wiz|DotsSplashUi|data-n-a-/i.test(html))return{url:finalUrl,text:"",resolved:false,status:r.status};
    const title=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||"";
    const text=extractArticleText(html,title);
    return{url:finalUrl,text,resolved:usableSourceUrl(finalUrl),status:r.status};
  }catch{return{url:usableSourceUrl(resolved)?resolved:"",text:"",resolved:usableSourceUrl(resolved),status:0}}
}

const GROUPS={
  fundamental:["產能","擴產","營收","eps","每股盈餘","毛利","獲利","訂單","接單","能見度","財測","資本支出","出貨","營運","營收成長","庫存"],
  news:["缺貨","供需","轉型","切入","供應鏈","外溢單","轉單","受惠","新客戶","新產品","新技術","新市場","合作","認證","量產","利多","利空","漲價","降價","同業","產業"],
  chips:["外資","投信","自營商","法人","主力","大戶","資金流","買超","賣超","持股","籌碼"]
};
const TARGET_WORDS=["目標價","券商喊價","評等","合理價"];
function summarize(text=""){
  if(text.length<80)return [];
  const sentences=text.split(/(?<=[。！？!?])|[\n\r]+/).map(x=>x.trim()).filter(x=>x.length>=18&&x.length<=220);
  const scored=sentences.map((s,i)=>{const low=s.toLowerCase();let score=0,cat="";for(const [k,words] of Object.entries(GROUPS)){const hits=words.filter(w=>low.includes(w.toLowerCase())).length;if(hits){score+=hits*4;cat=cat||k}}if(TARGET_WORDS.some(w=>s.includes(w)))score-=6;if(/記者|報導|指出|表示|預期|預估|年增|月增|季增|成長|衰退|億元|％|%/.test(s))score+=1;score-=i*0.002;return {s,score,cat}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const out=[],seen=new Set();for(const x of scored){const key=x.s.replace(/[\s，。；、]/g,"").slice(0,24);if(seen.has(key))continue;seen.add(key);out.push(x.s);if(out.length>=4)break}
  if(!out.length){for(const s of sentences.slice(0,2))out.push(s)}
  return out;
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
    const xml=await r.text(),raw=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]).map(block=>({title:stripHtml(tag(block,"title")),url:stripHtml(tag(block,"link")),publishedAt:stripHtml(tag(block,"pubDate")),source:sourceTag(block)})).filter(x=>x.title&&x.url);
    const seen=new Set(),picked=[];for(const x of raw){const k=x.title.replace(/\s+/g," ");if(seen.has(k))continue;seen.add(k);picked.push(x);if(picked.length>=24)break}
    const items=[];
    for(let i=0;i<picked.length;i+=4){
      const batch=picked.slice(i,i+4);
      const got=await Promise.all(batch.map(async x=>{const a=await fetchArticle(x.url),points=summarize(a.text);return {...x,title:cleanTitle(x.title)||x.title,url:a.url||x.url,summaryPoints:points,summary:points.join("\n"),contentAvailable:points.length>0}}));
      items.push(...got)
    }
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");return res.status(200).json({ok:true,code,name,mode,items});
  }catch(e){return res.status(502).json({ok:false,error:e.message||"新聞搜尋失敗"})}
}
