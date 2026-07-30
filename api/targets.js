const HEADERS={"User-Agent":"Mozilla/5.0","Accept":"application/rss+xml,application/xml,text/xml,*/*"};
const BROKERS=[["摩根士丹利","外資"],["大摩","外資"],["摩根大通","外資"],["小摩","外資"],["高盛","外資"],["花旗","外資"],["美銀","外資"],["瑞銀","外資"],["瑞信","外資"],["野村","外資"],["麥格理","外資"],["匯豐","外資"],["滙豐","外資"],["里昂","外資"],["巴克萊","外資"],["德意志","外資"],["元大","本土"],["群益","本土"],["凱基","本土"],["富邦","本土"],["國泰","本土"],["永豐","本土"],["統一","本土"],["兆豐","本土"],["第一金","本土"],["華南永昌","本土"],["玉山","本土"],["台新","本土"],["康和","本土"],["宏遠","本土"],["國票","本土"],["新光","本土"],["中信","本土"]];
const CANONICAL={"大摩":"摩根士丹利","小摩":"摩根大通","滙豐":"匯豐"};
const clean=s=>String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
function tag(block,name){const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?clean(m[1]):""}
function findBroker(text){for(const [name,type] of BROKERS){if(text.includes(name))return{broker:CANONICAL[name]||name,brokerType:type}}return null}
function findTargets(text){const out=[];const patterns=[/目標價(?:由|從)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元/gi,/目標價\s*(?:上看|調升至|調高至|下修至|維持在|喊到|看至)?\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)/gi,/(?:上看|調升至|調高至|下修至|喊到)\s*(?:新台幣|台幣)?\s*([\d,]+(?:\.\d+)?)\s*元/gi];for(const p of patterns){let m;while((m=p.exec(text))){const n=Number(m[1].replace(/,/g,""));if(Number.isFinite(n)&&n>=10&&n<=100000)out.push(n)}}return[...new Set(out)]}
function periodInfo(text){
  const t=String(text||"");
  const twelve=t.match(/(?:未來|未來的)?\s*12\s*(?:個)?月|十二個月|12[- ]month/i);
  if(twelve)return{periodType:"12m",periodLabel:"12個月"};
  const quarter=t.match(/(?:20\d{2}\s*[年/]?\s*)?(?:第\s*[一二三四1234]\s*季|Q[1-4]|[1-4]Q)|(?:季度|單季)(?:目標|估值|展望|財測)?/i);
  if(quarter){const label=quarter[0].replace(/\s+/g," ").trim();return{periodType:"quarter",periodLabel:`季度${label?`（${label}）`:""}`}}
  const annual=t.match(/(?:以|採用|基於)?\s*(20\d{2})\s*(?:年|E|F)?\s*(?:度)?\s*(?:EPS|每股盈餘|獲利|盈餘|財測|估值|預估)|(?:20\d{2}\s*年度|全年)(?:目標|估值|展望|財測)?/i);
  if(annual){const y=(annual[1]||annual[0].match(/20\d{2}/)?.[0]||"").trim();return{periodType:"annual",periodLabel:y?`年度（${y}）`:"年度"}}
  return{periodType:"unknown",periodLabel:"期間不明"};
}
function reasonInfo(text){
  const t=String(text||"");
  const fundamental=/(?:EPS|每股盈餘|營收|獲利|盈餘|訂單|出貨|需求|毛利率|產能|財測|營運|展望|市占|產品組合|成本下降|獲利預估)(?:上修|調升|提高|改善|成長|優於|強勁)?/i.test(t);
  const valuation=/(?:本益比|目標本益比|股價淨值比|P\s*\/\s*E|P\s*\/\s*B|PE\b|PB\b|估值倍數|評價倍數|估值|評價)(?:上修|調升|提高|重估|提升)?/i.test(t);
  if(fundamental&&valuation)return{revisionReason:"mixed",revisionReasonLabel:"基本面＋估值倍數"};
  if(valuation)return{revisionReason:"valuation",revisionReasonLabel:"純估值倍數上修"};
  if(fundamental)return{revisionReason:"fundamental",revisionReasonLabel:"基本面上修"};
  return{revisionReason:"unknown",revisionReasonLabel:"原因不明"};
}
function iso(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d.toISOString()}
module.exports = async function handler(req,res){res.setHeader("Cache-Control","no-store");const code=String(req.query.code||"").trim(),name=String(req.query.name||"").trim();if(!/^\d{4,6}$/.test(code))return res.status(400).json({ok:false,error:"股票代碼格式錯誤"});try{const q=encodeURIComponent(`${name||code} ${code} 券商 目標價`);const url=`https://news.google.com/rss/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;const response=await fetch(url,{headers:HEADERS});if(!response.ok)throw Error(`公開新聞來源回應 ${response.status}`);const xml=await response.text(),items=xml.match(/<item>[\s\S]*?<\/item>/gi)||[],rows=[];for(const item of items.slice(0,80)){const title=tag(item,"title"),description=tag(item,"description"),text=`${title} ${description}`;if(!(text.includes(code)||(name&&text.includes(name))))continue;const broker=findBroker(text);if(!broker)continue;const period=periodInfo(text),reason=reasonInfo(text);for(const target of findTargets(text)){rows.push({...broker,...period,...reason,target,date:iso(tag(item,"pubDate")),title,sourceUrl:tag(item,"link")})}}rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));const groups={};for(const row of rows){groups[row.broker]??=[];if(!groups[row.broker].some(x=>x.target===row.target&&String(x.date||"").slice(0,10)===String(row.date||"").slice(0,10)))groups[row.broker].push(row)}const brokers=Object.values(groups).map(history=>{const latest=history[0],fullHistory=history.slice(0,20);return{...latest,previousTarget:fullHistory[1]?.target??null,previousDate:fullHistory[1]?.date??null,targetHistory:fullHistory.map(x=>({target:x.target,date:x.date,title:x.title,sourceUrl:x.sourceUrl,periodType:x.periodType,periodLabel:x.periodLabel,revisionReason:x.revisionReason,revisionReasonLabel:x.revisionReasonLabel}))}}).sort((a,b)=>a.brokerType!==b.brokerType?(a.brokerType==="外資"?-1:1):new Date(b.date||0)-new Date(a.date||0));return res.status(200).json({ok:true,brokers,fetchedAt:new Date().toISOString()})}catch(e){return res.status(502).json({ok:false,error:"目標價資料暫時無法取得",detail:e.message})}};
