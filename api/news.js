function decode(s="") { return s.replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim(); }
function stripHtml(s="") { return decode(s).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(); }
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?decode(m[1]):""}
function sourceTag(block){const m=block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);return m?stripHtml(m[1]):""}
function summaryFrom(title,description){
  const d=stripHtml(description).replace(title,"").trim();
  if(d && d.length>20) return d.slice(0,260);
  return title;
}
module.exports=async function handler(req,res){
  const code=String(req.query.code||"").trim(), name=String(req.query.name||"").trim();
  if(!code&&!name)return res.status(400).json({ok:false,error:"缺少股票名稱或代碼"});
  const q=[name,code].filter(Boolean).join(" ");
  const since=String(req.query.since||"").trim();
  const dateOk=/^\d{4}-\d{2}-\d{2}$/.test(since);
  const window=dateOk?` after:${since}`:" when:30d";
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(q+window)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 StockZone/2.5"}});
    if(!r.ok)throw new Error(`Google News HTTP ${r.status}`);
    const xml=await r.text();
    const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(x=>x[1]).map(block=>{
      const title=stripHtml(tag(block,"title"));
      const link=stripHtml(tag(block,"link"));
      const publishedAt=stripHtml(tag(block,"pubDate"));
      const source=sourceTag(block);
      const description=tag(block,"description");
      return {title,summary:summaryFrom(title,description),url:link,publishedAt,source};
    }).filter(x=>x.title&&x.url);
    const seen=new Set(), unique=[];
    for(const x of items){const k=x.title.replace(/\s+/g," ");if(seen.has(k))continue;seen.add(k);unique.push(x);if(unique.length>=30)break}
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");
    return res.status(200).json({ok:true,code,name,items:unique});
  }catch(e){return res.status(502).json({ok:false,error:e.message||"新聞搜尋失敗"})}
}
