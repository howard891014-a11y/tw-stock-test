const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null}
function date8(d=new Date()){const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');return `${y}${m}${day}`}
function minusDays(days){const d=new Date();d.setUTCDate(d.getUTCDate()-days);return date8(d)}
async function jfetch(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},redirect:'follow'});if(!r.ok)throw new Error(`官方資料 HTTP ${r.status}`);const t=await r.text();try{return JSON.parse(t)}catch{throw new Error('官方資料格式錯誤')}}
function clean(s=''){return String(s).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()}
function isoDate(s=''){const z=String(s).trim();let m=z.match(/^(\d{3})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);if(m)return `${Number(m[1])+1911}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;m=z.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;const d=z.replace(/\D/g,'');if(d.length===7)return `${Number(d.slice(0,3))+1911}-${d.slice(3,5)}-${d.slice(5,7)}`;if(d.length===8)return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;return z}
function clauseNums(text=''){const zh={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十三':13};return [...String(text).matchAll(/第\s*(十三|十二|十一|十|[一二三四五六七八九]|\d+)\s*款/g)].map(m=>zh[m[1]]||Number(m[1])).filter(Number.isFinite)}
function isFirstClause(row){return clauseNums(row?.text).includes(1)}
function isEligibleClause(row){const ns=clauseNums(row?.text);if(ns.length)return ns.some(x=>x>=1&&x<=8);const ks=pickKeys(row?.text||'');return ks.some(k=>['price','volume','turnover','concentration','valuation','margin'].includes(k))&&!ks.includes('sbl')}
function pickKeys(text=''){const t=String(text);const out=[];if(/漲幅|跌幅|收盤價|最後成交價|價格|第一款|第二款/.test(t))out.push('price');if(/成交量|第三款/.test(t))out.push('volume');if(/週轉率|第四款|第十款/.test(t))out.push('turnover');if(/集中度|買進金額|賣出金額|單一投資人|第五款|第六款/.test(t))out.push('concentration');if(/本益比|股價淨值比/.test(t))out.push('valuation');if(/券資比|融券|融資/.test(t))out.push('margin');if(/借券賣出/.test(t))out.push('sbl');return [...new Set(out)]}
function countEligibleRows(rows,tradingDays=[]){
  const byDate=new Map();
  for(const r of rows||[]){const d=isoDate(r.date);if(!d)continue;const a=byDate.get(d)||[];a.push({...r,date:d});byDate.set(d,a)}
  const days=(tradingDays||[]).map(isoDate).filter(Boolean);const hist=days.length?days:[...byDate.keys()].sort();
  const last30=hist.slice(-30),last10=hist.slice(-10),last3=hist.slice(-3),last5=hist.slice(-5);
  const eligible=d=>(byDate.get(d)||[]).some(isEligibleClause),first=d=>(byDate.get(d)||[]).some(isFirstClause);
  return {d3:last3.filter(first).length,d10:last10.filter(eligible).length,d30:last30.filter(eligible).length,d5:last5.filter(eligible).length,firstStreak:(()=>{let n=0;for(let i=hist.length-1;i>=0&&first(hist[i]);i--)n++;return n})(),eligibleStreak:(()=>{let n=0;for(let i=hist.length-1;i>=0&&eligible(hist[i]);i--)n++;return n})(),dates:[...byDate.keys()].sort().reverse(),byDate,hist,eligible,first};
}
function reachesCore(seqFirst,seqEligible){
  const last=(a,n)=>a.slice(Math.max(0,a.length-n));
  return (seqFirst.length>=3&&last(seqFirst,3).every(Boolean))||(seqEligible.length>=5&&last(seqEligible,5).every(Boolean))||last(seqEligible,10).filter(Boolean).length>=6||last(seqEligible,30).filter(Boolean).length>=12;
}
function fastestFuture(counts,prewarning=false){
  if(prewarning)return {days:1,path:'官方預警：下一交易日若再納入計算即可能處置'};
  const hist=counts.hist||[], sf=hist.map(counts.first), se=hist.map(counts.eligible);
  if(reachesCore(sf,se))return {days:0,path:'核心處置門檻已達，等待官方公告確認'};
  for(let n=1;n<=12;n++){sf.push(true);se.push(true);if(reachesCore(sf,se))return {days:n,path:n===1?'最快下一交易日可能達核心門檻':`最快 ${n} 個交易日後可能達核心門檻`}}
  return {days:null,path:'目前無可量化的近期處置路徑'};
}
function twseRows(j,code){
  const fields=(j?.fields||[]).map(clean), data=Array.isArray(j?.data)?j.data:[];const find=(re)=>fields.findIndex(x=>re.test(x));
  const ci=find(/證券代號/),di=find(/日期|公告日期/),ti=find(/注意交易資訊/);return data.filter(r=>ci<0||String(r[ci]).trim()===String(code)).map(r=>({date:di>=0?isoDate(clean(r[di])):'',text:ti>=0?clean(r[ti]):clean(r.join(' ')),raw:r}));
}
function rocToIso(s=''){return isoDate(s)}
function genericRows(j){const fields=(j?.fields||[]).map(clean),data=Array.isArray(j?.data)?j.data:[];return data.map(r=>({fields,row:r,text:clean(r.join(' '))}))}
async function twse(code){
  const start=minusDays(100),end=date8();
  const [notice,punish,warn]=await Promise.all([
    jfetch(`https://www.twse.com.tw/rwd/zh/announcement/notice?response=json&startDate=${start}&endDate=${end}&stockNo=${encodeURIComponent(code)}&querytype=2`),
    jfetch(`https://www.twse.com.tw/rwd/zh/announcement/punish?response=json&startDate=${start}&endDate=${end}&stockNo=${encodeURIComponent(code)}&querytype=2`),
    jfetch(`https://www.twse.com.tw/rwd/zh/announcement/notetrans?response=json`).catch(()=>null)
  ]);
  const rows=twseRows(notice,code),p=twseRows(punish,code);const warning=genericRows(warn).find(x=>new RegExp(`(^|\s)${String(code).replace(/[-/\^$*+?.()|[\]{}]/g,'\$&')}(\s|$)`).test(x.text))||null;
  return {rows,punish:p,warning};
}
async function tradingDays(code,market){try{const s=yahooSymbol(code,market),j=await jfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=3mo&interval=1d&events=history`),r=j?.chart?.result?.[0];return (r?.timestamp||[]).map(x=>{const d=new Date(Number(x)*1000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`}).filter(Boolean)}catch{return []}}
async function tpex(code){
  const [att,dis,note]=await Promise.all([
    jfetch('https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information'),
    jfetch('https://www.tpex.org.tw/openapi/v1/tpex_disposal_information'),
    jfetch('https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_note').catch(()=>[])
  ]);
  const rows=(Array.isArray(att)?att:[]).filter(x=>String(x.SecuritiesCompanyCode||'')===String(code)).map(x=>({date:rocToIso(x.Date),text:clean(x.TradingInformation),raw:x}));
  const punish=(Array.isArray(dis)?dis:[]).filter(x=>String(x.SecuritiesCompanyCode||'')===String(code)).map(x=>({date:rocToIso(x.Date),text:clean(x.DisposalCondition||x.DispositionReasons),raw:x}));
  const warning=(Array.isArray(note)?note:[]).find(x=>String(x.SecuritiesCompanyCode||x.Code||x.SecuritiesCode||'')===String(code))||null;
  return {rows,punish,warning};
}
function yahooSymbol(code,market){return `${code}${String(market||'').includes('上櫃')?'.TWO':'.TW'}`}
async function priceLine(code,market,current){
  try{const s=yahooSymbol(code,market),j=await jfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d&events=history`),r=j?.chart?.result?.[0],q=r?.indicators?.quote?.[0],cl=(q?.close||[]).filter(x=>Number.isFinite(Number(x))).map(Number);if(cl.length<6)return {value:null,note:'歷史價格不足'};const base=cl.at(-6);const a=base*1.32,b=Math.max(base*1.25,base+50),line=Math.min(a,b),gap=Number.isFinite(current)&&current>0?(line/current-1)*100:null;return {value:Math.floor(line*100)/100,tone:gap!==null&&gap<0?'bad':gap!==null&&gap<5?'watch':'good',note:`6日價格異常保守線；現價距離 ${gap===null?'--':`${gap>=0?'+':''}${gap.toFixed(2)}%`}`};}catch{return {value:null,note:'價格警戒線暫無法估算'}}
}

function disposalInterval(punish=[]){
 const t=(punish||[]).map(x=>x?.text||'').join(' ');
 const m=t.match(/(?:每|約每)\s*(\d+)\s*分鐘/);
 if(m)return `${m[1]}分盤處置`;
 const m2=t.match(/(二|十|二十五|四十五|六十)分鐘/);
 if(m2){const map={'二':'2','十':'10','二十五':'25','四十五':'45','六十':'60'};return `${map[m2[1]]||m2[1]}分盤處置`;}
 return punish?.length?'處置撮合時間依官方公告':'若進入一般首次處置：2分盤';
}
function riskFrom(c,state,fast,pl){if(state==='處置中')return '處置中';if(fast?.days===0||fast?.days===1)return '高';if(fast?.days===2)return '中';if(pl?.tone==='bad'||pl?.tone==='watch')return '中';const max=Math.max(c.d3/3,c.d5/5,c.d10/6,c.d30/12);return max>=.83?'高':max>=.5?'中':'低'}
export default async function handler(req,res){
 try{
  const code=String(req.query?.q||'').trim(),market=String(req.query?.market||''),current=n(req.query?.price);if(!code)return res.status(400).json({ok:false,error:'缺少股票代碼'});
  const src=market.includes('上櫃')?await tpex(code):await twse(code);
  const [td,pl]=await Promise.all([tradingDays(code,market),priceLine(code,market,current)]);
  const counts=countEligibleRows(src.rows,td),fast=fastestFuture(counts,Boolean(src.warning));
  const latestTrading=td.at(-1)||isoDate(new Date().toISOString().slice(0,10)),latest=(src.rows||[]).slice().sort((a,b)=>String(isoDate(b.date)).localeCompare(String(isoDate(a.date))))[0];
  const todayAttention=Boolean(latest&&isoDate(latest.date)===latestTrading);
  let state=src.punish?.length?'處置中':(todayAttention||src.warning)?'注意股票':'正常';
  const reasonText=todayAttention?(latest?.text||'今日已發布注意資訊'):'今日未發布注意資訊',reasonKeys=todayAttention?pickKeys(reasonText):[];
  const risk=riskFrom(counts,state,fast,pl);
  const stateNote=state==='處置中'?disposalInterval(src.punish):state==='注意股票'?'若進入處置：2分盤':'目前未列為注意股票';
  const riskNote=state==='處置中'?'已進入處置期間':`近30個交易日納入計算 ${counts.d30} 次`;
  const riskDistance=state==='處置中'?'請依官方處置期間交易':fast.days===0?'已達核心門檻，待官方公告':fast.days===1?'最快下一交易日可能處置':Number.isFinite(fast.days)?`最快 ${fast.days} 個交易日後可能處置`:'目前無近期處置路徑';
  let summary=state==='處置中'?'官方已公告處置，請直接以處置起訖日與措施為準。':src.warning?'官方預警顯示：下一交易日若再次納入處置計算，即可能公告處置。':todayAttention?`今日為注意股；近3日第一款 ${counts.d3}/3、近10日第一至八款 ${counts.d10}/6、近30日 ${counts.d30}/12。${fast.path}。`:`目前未列為今日注意股；近10日納入計算 ${counts.d10}/6、近30日 ${counts.d30}/12。${fast.path}。`;
  if(pl.value)summary+=` 價格異常款保守警戒線約 ${pl.value} 元；低於此線只能排除該價格條件，不能保證其他注意條件不成立。`;
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ok:true,source:market.includes('上櫃')?'TPEx':'TWSE',state,stateNote,risk:risk==='處置中'?'高':risk,riskNote,riskDistance,counts:{d3:counts.d3,d5:counts.d5,d10:counts.d10,d30:counts.d30},fastest:{days:fast.days,path:fast.path},reasonKeys,reasonText,priceLine:pl,exceptions:{volume:{label:'依適用款次判斷',tone:'watch'},turnover:{label:'依適用款次判斷',tone:'watch'},etf:{label:'一般個股不適用',tone:''},other:{label:'依官方公告',tone:''}},summary,official:{attentionRows:src.rows?.slice(0,12)||[],disposalRows:src.punish?.slice(0,5)||[]}});
 }catch(e){return res.status(500).json({ok:false,error:e?.message||'處置資料取得失敗'})}
}
