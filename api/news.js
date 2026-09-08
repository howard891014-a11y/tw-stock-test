function decode(s="") { return s.replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).trim(); }
function stripHtml(s="") { return decode(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?decode(m[1]):""}
function sourceTag(block){const m=block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);return m?stripHtml(m[1]):""}
function cleanTitle(s=""){return stripHtml(s).replace(/\s+-\s+[^-]{1,40}$/,'').trim()}
function sameHostGoogle(u=""){try{return /(^|\.)google\./.test(new URL(u).hostname)||/news\.google\.com/.test(new URL(u).hostname)}catch{return false}}
function outboundFromHtml(html=""){
  const urls=[...html.matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+/g)].map(m=>m[0].replace(/\\u0026/g,"&").replace(/\\\//g,"/").replace(/&amp;/g,"&"));
  return urls.find(u=>{try{const h=new URL(u).hostname;return !/(^|\.)google\.|gstatic\.com|googleusercontent\.com/.test(h)}catch{return false}})||"";
}
async function fetchHtml(url,ms=9000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{redirect:"follow",signal:c.signal,headers:{"User-Agent":"Mozilla/5.0 (compatible; StockZone/2.5; +news-reader)","Accept-Language":"zh-TW,zh;q=0.9,en;q=0.6"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return {html:await r.text(),finalUrl:r.url||url}}finally{clearTimeout(t)}}
async function resolveArticle(url){
  try{const first=await fetchHtml(url);if(!sameHostGoogle(first.finalUrl))return first;
    const out=outboundFromHtml(first.html);if(out){try{return await fetchHtml(out)}catch{}}
    return first;
  }catch{return {html:"",finalUrl:url}}
}
function articleText(html=""){
  if(!html)return "";
  const bodies=[];
  for(const m of html.matchAll(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/gi)){try{bodies.push(JSON.parse('"'+m[1]+'"'))}catch{}}
  const article=[...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m=>stripHtml(m[1]));
  const paras=[...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>stripHtml(m[1])).filter(x=>x.length>=25);
  return [...bodies,...article,paras.join(" ")].sort((a,b)=>b.length-a.length)[0]?.replace(/\s+/g," ").trim()||"";
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
    const r=await fetch(rss,{headers:{"User-Agent":"Mozilla/5.0 StockZone/2.5"}});if(!r.ok)throw new Error(`Google News HTTP ${r.status}`);
    const xml=await r.text(),raw=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]).map(block=>({title:stripHtml(tag(block,"title")),url:stripHtml(tag(block,"link")),publishedAt:stripHtml(tag(block,"pubDate")),source:sourceTag(block)})).filter(x=>x.title&&x.url);
    const seen=new Set(),picked=[];for(const x of raw){const k=x.title.replace(/\s+/g," ");if(seen.has(k))continue;seen.add(k);picked.push(x);if(picked.length>=24)break}
    const items=[];
    for(let i=0;i<picked.length;i+=4){const batch=picked.slice(i,i+4);const got=await Promise.all(batch.map(async x=>{const a=await resolveArticle(x.url),text=articleText(a.html),points=summarize(text);return {...x,title:cleanTitle(x.title)||x.title,url:a.finalUrl||x.url,summaryPoints:points,summary:points.join("\n"),contentAvailable:points.length>0}}));items.push(...got)}
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");return res.status(200).json({ok:true,code,name,mode,items});
  }catch(e){return res.status(502).json({ok:false,error:e.message||"新聞搜尋失敗"})}
}
