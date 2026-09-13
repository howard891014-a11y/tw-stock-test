const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null}
function date8(d=new Date()){const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');return `${y}${m}${day}`}
function minusDays(days){const d=new Date();d.setUTCDate(d.getUTCDate()-days);return date8(d)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function jfetch(url,retries=1,timeoutMs=8000){let last;for(let i=0;i<=retries;i++){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*','accept-language':'zh-TW,zh;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`官方資料 HTTP ${r.status}`);const t=await r.text();try{return JSON.parse(t)}catch{throw new Error('官方資料格式錯誤')}}catch(e){last=e;if(i<retries)await sleep(220*(i+1))}finally{clearTimeout(timer)}}throw last||new Error('官方資料暫時無法取得')}
async function tfetch(url,retries=1,timeoutMs=9000){let last;for(let i=0;i<=retries;i++){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,text/plain,*/*','accept-language':'zh-TW,zh;q=0.9'},redirect:'follow',signal:c.signal});if(!r.ok)throw new Error(`官方備援 HTTP ${r.status}`);return await r.text()}catch(e){last=e;if(i<retries)await sleep(260*(i+1))}finally{clearTimeout(timer)}}throw last||new Error('官方備援資料暫時無法取得')}
function taipeiToday(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function htmlLines(html=''){return String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<(?:br|\/tr|\/td|\/th|\/p|\/div|\/li)[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#40;/g,'(').replace(/&#41;/g,')').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').split(/\n+/).map(clean).filter(Boolean)}
function escapeRe(s=''){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function rocTextDate(s=''){let m=String(s).match(/(\d{3})[\/.-](\d{1,2})[\/.-](\d{1,2})/);if(m)return `${Number(m[1])+1911}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;m=String(s).match(/(\d{3})年(\d{1,2})月(\d{1,2})日/);if(m)return `${Number(m[1])+1911}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;return isoDate(s)}
function parseDispositionPeriod(value='',text=''){const s=`${value||''} ${text||''}`;let m=s.match(/(\d{3})[\/. -]?(\d{2})[\/. -]?(\d{2})\s*[~～至-]\s*(\d{3})[\/. -]?(\d{2})[\/. -]?(\d{2})/);if(m)return {start:`${Number(m[1])+1911}-${m[2]}-${m[3]}`,end:`${Number(m[4])+1911}-${m[5]}-${m[6]}`};const ds=[...s.matchAll(/(\d{3})年(\d{1,2})月(\d{1,2})日/g)];if(ds.length>=2){const a=ds[0],b=ds.at(-1);return {start:`${Number(a[1])+1911}-${String(a[2]).padStart(2,'0')}-${String(a[3]).padStart(2,'0')}`,end:`${Number(b[1])+1911}-${String(b[2]).padStart(2,'0')}-${String(b[3]).padStart(2,'0')}`}}return {start:'',end:''}}
function isActiveDisposal(row,today=taipeiToday()){const raw=row?.raw||{},p=parseDispositionPeriod(raw.DispositionPeriod||raw['處置起訖時間']||'',row?.text||'');return Boolean(p.start&&p.end&&today>=p.start&&today<=p.end)}
function parseTpexDisposalHtml(html,code){const lines=htmlLines(html),out=[],needle=new RegExp(String.raw`(?:代號[：:]\s*${escapeRe(code)}(?:\D|$)|^${escapeRe(code)}(?:\s|$))`);for(let i=0;i<lines.length;i++){if(!needle.test(lines[i]))continue;const from=Math.max(0,i-8),to=Math.min(lines.length,i+18),block=lines.slice(from,to);const text=block.find(x=>/爰自|處置內容/.test(x)&&new RegExp(String.raw`代號[：:]\s*${escapeRe(code)}(?:\D|$)`).test(x))||lines[i];const pi=block.findIndex(x=>/處置起訖時間/.test(x)),periodLine=pi>=0?`${block[pi]} ${block[pi+1]||''}`:text;const p=parseDispositionPeriod(periodLine,text);const di=block.findIndex(x=>/公布日期/.test(x)),dateLine=di>=0?`${block[di]} ${block[di+1]||''}`:'';out.push({date:rocTextDate(dateLine),text:clean(text),raw:{SecuritiesCompanyCode:String(code),DispositionPeriod:p.start&&p.end?`${p.start}~${p.end}`:'',DisposalCondition:clean(text),source:'TPEx official HTML backup'}})}const seen=new Set();return out.filter(x=>{const k=`${x.raw.DispositionPeriod}|${x.text}`;if(seen.has(k))return false;seen.add(k);return true})}
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
  return {rows,punish:p,warning,historyComplete:true,availability:{attention:true,disposal:true,warning:warn!==null}};
}
async function tradingDays(code,market){try{const s=yahooSymbol(code,market),j=await jfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=3mo&interval=1d&events=history`),r=j?.chart?.result?.[0];return (r?.timestamp||[]).map(x=>{const d=new Date(Number(x)*1000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`}).filter(Boolean)}catch{return []}}
function legacyTpexRows(j){
  const tables=Array.isArray(j?.tables)?j.tables:[];
  const table=tables.find(t=>Array.isArray(t?.fields)&&Array.isArray(t?.data))||(Array.isArray(j?.fields)&&Array.isArray(j?.data)?j:null);
  if(!table)return [];
  const fields=(table.fields||[]).map(clean),data=Array.isArray(table.data)?table.data:[];
  const idx=(names)=>{for(const n of names){const i=fields.indexOf(n);if(i>=0)return i}return -1};
  const ci=idx(['證券代號','股票代號']),ni=idx(['證券名稱','股票名稱']),di=idx(['公布日期','公告日期','日期']),pi=idx(['處置起訖時間','處置起迄時間']),ri=idx(['處置原因','處置條件']),ti=idx(['處置內容','處置措施']);
  if(ci<0||pi<0)return [];
  return data.map(r=>({
    Date:di>=0?clean(r[di]):'',
    SecuritiesCompanyCode:clean(r[ci]),
    CompanyName:ni>=0?clean(r[ni]):'',
    DispositionPeriod:clean(r[pi]),
    DispositionReasons:ri>=0?clean(r[ri]):'',
    DisposalCondition:ti>=0?clean(r[ti]):ri>=0?clean(r[ri]):''
  })).filter(x=>x.SecuritiesCompanyCode);
}
async function tpex(code){
  const safe=async(url,retries=0,timeoutMs=2800)=>{try{return {ok:true,data:await jfetch(url,retries,timeoutMs),source:url}}catch(e){return {ok:false,data:[],error:e?.message||'fetch failed',source:url}}};
  const attUrl='https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information';
  const disUrl='https://www.tpex.org.tw/openapi/v1/tpex_disposal_information';
  const noteUrl='https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_note';
  const [attR,primaryDisR,noteR]=await Promise.all([safe(attUrl),safe(disUrl),safe(noteUrl)]);
  let disR=primaryDisR;
  if(!disR.ok){
    // TPEx 官網另一條正式公告 JSON。它與 OpenAPI 為不同路徑，可避開單一路徑／CDN 暫時失敗。
    const legacyUrl='https://www.tpex.org.tw/web/bulletin/disposal_information/disposal_information_result.php?l=zh-tw&o=json';
    const legacy=await safe(legacyUrl,0,4500);
    if(legacy.ok){
      const normalized=legacyTpexRows(legacy.data);
      if(normalized.length)disR={ok:true,data:normalized,source:legacyUrl,legacy:true};
      else disR={...disR,backupError:'官方 JSON 備援回傳格式無可解析處置資料'};
    }else disR={...disR,backupError:legacy.error||'官方 JSON 備援失敗'};
  }
  if(!disR.ok){
    // 最後才嘗試 TPEx 官方公告 HTML；只有真的解析出資料才視為成功，避免 HTTP 200 空殼頁被誤判可用。
    try{
      const html=await tfetch('https://app.tpex.org.tw/HTML/Announce/MarketNews/disposal_info.html',0,2500),parsed=parseTpexDisposalHtml(html,code);
      if(parsed.length)disR={ok:true,data:parsed,source:'https://app.tpex.org.tw/HTML/Announce/MarketNews/disposal_info.html',preparsed:true};
      else disR={...disR,htmlBackupError:'官方 HTML 備援沒有解析到該股票處置資料'};
    }catch(e){disR={...disR,htmlBackupError:e?.message||'HTML backup failed'}}
  }
  const att=attR.data,dis=disR.data,note=noteR.data;
  const val=(x,keys)=>{for(const k of keys){if(x?.[k]!==undefined&&x?.[k]!==null&&clean(x[k])!=='')return clean(x[k])}return ''};
  const stockCode=x=>val(x,['SecuritiesCompanyCode','SecuritiesCode','Code','證券代號','股票代號']);
  const rows=(Array.isArray(att)?att:[]).filter(x=>stockCode(x)===String(code)).map(x=>({date:rocToIso(val(x,['Date','AnnouncementDate','公告日期','資料日期'])),text:clean(val(x,['TradingInformation','TradingInfo','AttentionInformation','WarningInformation','注意交易資訊','近期達本中心「公布注意交易資訊」標準之情形'])),raw:x}));
  const punish=disR.preparsed?(Array.isArray(dis)?dis:[]):(Array.isArray(dis)?dis:[]).filter(x=>stockCode(x)===String(code)).map(x=>({date:rocToIso(val(x,['Date','AnnouncementDate','公布日期','處置日期'])),text:clean(val(x,['DisposalCondition','DispositionReasons','DispositionReason','DisposalInformation','處置原因','處置內容','處置起訖時間'])),raw:x}));
  const activePunish=punish.filter(x=>isActiveDisposal(x));
  const warning=(Array.isArray(note)?note:[]).find(x=>stockCode(x)===String(code))||null;
  // TPEx OpenAPI 的注意股資料是每日快照，不把單日快照假裝成近 3/10/30 日歷史。
  return {rows,punish,activePunish,warning,historyComplete:false,availability:{attention:attR.ok,disposal:disR.ok,warning:noteR.ok},sources:{attention:attR.source,disposal:disR.source,warning:noteR.source},errors:{attention:attR.error||'',disposal:disR.error||'',disposalBackup:disR.backupError||'',disposalHtmlBackup:disR.htmlBackupError||'',warning:noteR.error||''}};
}

function yahooSymbol(code,market){return `${code}${String(market||'').includes('上櫃')?'.TWO':'.TW'}`}
async function priceLine(code,market,current){
  try{const s=yahooSymbol(code,market),j=await jfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d&events=history`),r=j?.chart?.result?.[0],q=r?.indicators?.quote?.[0],cl=(q?.close||[]).filter(x=>Number.isFinite(Number(x))).map(Number);if(cl.length<6)return {value:null,note:'歷史價格不足'};const base=cl.at(-6);const a=base*1.32,b=Math.max(base*1.25,base+50),line=Math.min(a,b),gap=Number.isFinite(current)&&current>0?(line/current-1)*100:null;return {value:Math.floor(line*100)/100,tone:gap!==null&&gap<0?'bad':gap!==null&&gap<5?'watch':'good',note:`6日價格異常保守線；現價距離 ${gap===null?'--':`${gap>=0?'+':''}${gap.toFixed(2)}%`}`};}catch{return {value:null,note:'價格警戒線暫無法估算'}}
}

function disposalPeriodLabel(punish=[]){
 const periods=(punish||[]).map(row=>{const raw=row?.raw||{},p=parseDispositionPeriod(raw.DispositionPeriod||raw['處置起訖時間']||'',row?.text||'');return p.start&&p.end?p:null}).filter(Boolean).sort((a,b)=>String(b.start).localeCompare(String(a.start))||String(b.end).localeCompare(String(a.end)));
 const p=periods[0];return p?`${p.start.replace(/-/g,'/')}～${p.end.replace(/-/g,'/')}`:'';
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
  const isOtc=market.includes('上櫃');
  const src=isOtc?await tpex(code):await twse(code);
  const [td,pl]=await Promise.all([tradingDays(code,market),priceLine(code,market,current)]);
  const attentionAvailable=src.availability?.attention!==false,disposalAvailable=src.availability?.disposal!==false;
  const historyComplete=src.historyComplete!==false;
  const activePunish=isOtc?(src.activePunish||[]):(src.punish||[]);
  const counts=countEligibleRows(src.rows,td);
  const warningText=src.warning?clean(Object.values(src.warning).join(' ')):'';
  const fast=historyComplete&&attentionAvailable?fastestFuture(counts,Boolean(src.warning)):src.warning?{days:1,path:'TPEx 官方累計次數異常預警：下一交易日若再次符合注意條件，即可能處置'}:{days:null,path:'TPEx 官方 OpenAPI 僅提供每日注意股快照；未取得完整歷史時不虛算 3／10／30 日次數'};
  const latestTrading=td.at(-1)||isoDate(new Date().toISOString().slice(0,10)),latest=(src.rows||[]).slice().sort((a,b)=>String(isoDate(b.date)).localeCompare(String(isoDate(a.date))))[0];
  const todayAttention=Boolean(latest&&isoDate(latest.date)===latestTrading);
  // 「是否正在處置」與「注意股風險資料是否完整」分開判斷：只要官方處置清單可核對，就不應因注意股來源失敗而寫成「處置資料不足」。
  let state=activePunish.length?'處置中':!disposalAvailable?'資料不足':(todayAttention||src.warning)?'注意股票':attentionAvailable?'正常':'未處置';
  const reasonText=todayAttention?(latest?.text||'今日已發布注意資訊'):src.warning?(warningText||'官方公布注意累計次數異常預警'):'今日未發布注意資訊',reasonKeys=todayAttention?pickKeys(reasonText):[];
  let risk='低';
  if(state==='處置中')risk='處置中';
  else if(state==='資料不足'||state==='未處置')risk='--';
  else if(src.warning)risk='高';
  else if(historyComplete)risk=riskFrom(counts,state,fast,pl);
  else if(todayAttention||pl?.tone==='bad'||pl?.tone==='watch')risk='中';
  const stateNote=state==='處置中'?disposalInterval(activePunish):state==='注意股票'?(src.warning?'官方已列累計次數異常預警':'若進入處置：2分盤'):state==='資料不足'?'官方處置資料暫時無法取得':state==='未處置'?'官方處置公告已核對；注意資料暫缺':'目前未列為注意股票';
  const riskNote=state==='處置中'?'已進入處置期間':historyComplete?`近30個交易日納入計算 ${counts.d30} 次`:src.warning?'TPEx 官方已發布累計次數異常資訊':attentionAvailable?'TPEx 每日快照正常；歷史次數不以單日資料推算':'官方注意資料暫時無法取得';
  const riskDistance=state==='處置中'?(disposalPeriodLabel(activePunish)||'請依官方處置期間交易'):state==='資料不足'?'待官方處置資料恢復後更新':state==='未處置'?'目前未處置；注意風險待資料恢復':src.warning?'最快下一交易日可能處置':historyComplete?(fast.days===0?'已達核心門檻，待官方公告':fast.days===1?'最快下一交易日可能處置':Number.isFinite(fast.days)?`最快 ${fast.days} 個交易日後可能處置`:'目前無近期處置路徑'):'官方未發布累計次數異常預警';
  let summary=state==='處置中'?'官方已公告處置，請直接以處置起訖日與措施為準。':state==='資料不足'?'TPEx／TWSE 官方處置資料本次未取得；本次不把缺資料誤判為未處置。':state==='未處置'?'TPEx 官方處置公告已成功核對，目前未列為處置股票；但注意股／累計預警來源本次未取得，因此風險進度暫不判讀。':src.warning?'TPEx 官方已發布「公布注意累計次數異常」資訊；若下一交易日再次符合注意條件，可能進入處置。':todayAttention?(historyComplete?`今日為注意股；近3日第一款 ${counts.d3}/3、近10日第一至八款 ${counts.d10}/6、近30日 ${counts.d30}/12。${fast.path}。`:'今日為注意股。TPEx OpenAPI 的注意股資料屬每日快照，因此本版不再用單日快照假算近 3／10／30 日次數；是否接近處置以 TPEx 官方累計次數異常資訊為優先。'):(historyComplete?`目前未列為今日注意股；近10日納入計算 ${counts.d10}/6、近30日 ${counts.d30}/12。${fast.path}。`:'目前未列為今日注意股，且 TPEx 官方未發布累計次數異常預警；歷史 3／10／30 日次數在沒有完整官方歷史資料時顯示為「--」，不再誤報 0 次。');
  if(pl.value)summary+=` 價格異常款保守警戒線約 ${pl.value} 元；低於此線只能排除該價格條件，不能保證其他注意條件不成立。`;
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ok:true,source:isOtc?'TPEx':'TWSE',state,stateNote,risk:risk==='處置中'?'高':risk,riskNote,riskDistance,countsAvailable:historyComplete&&attentionAvailable,counts:{d3:counts.d3,d5:counts.d5,d10:counts.d10,d30:counts.d30},historyComplete,fastest:{days:fast.days,path:fast.path},reasonKeys,reasonText,priceLine:pl,exceptions:{volume:{label:'依適用款次判斷',tone:'watch'},turnover:{label:'依適用款次判斷',tone:'watch'},etf:{label:'一般個股不適用',tone:''},other:{label:'依官方公告',tone:''}},summary,official:{attentionRows:src.rows?.slice(0,12)||[],disposalRows:src.punish?.slice(0,8)||[],activeDisposalRows:activePunish.slice(0,5),warning:src.warning||null},availability:src.availability||null,sources:src.sources||null,sourceErrors:src.errors||null});
 }catch(e){return res.status(500).json({ok:false,error:e?.message||'處置資料取得失敗'})}
}
