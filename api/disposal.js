const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(String(v).replace(/,/g,''));return Number.isFinite(x)?x:null}
function date8(d=new Date()){const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');return `${y}${m}${day}`}
function minusDays(days){const d=new Date();d.setUTCDate(d.getUTCDate()-days);return date8(d)}
async function jfetch(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},redirect:'follow'});if(!r.ok)throw new Error(`官方資料 HTTP ${r.status}`);const t=await r.text();try{return JSON.parse(t)}catch{throw new Error('官方資料格式錯誤')}}
function clean(s=''){return String(s).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()}
function pickKeys(text=''){const t=String(text);const out=[];if(/漲幅|跌幅|收盤價|最後成交價|價格|第一款|第二款/.test(t))out.push('price');if(/成交量|第三款/.test(t))out.push('volume');if(/週轉率|第四款|第十款/.test(t))out.push('turnover');if(/集中度|買進金額|賣出金額|單一投資人|第五款|第六款/.test(t))out.push('concentration');if(/本益比|股價淨值比/.test(t))out.push('valuation');if(/券資比|融券|融資/.test(t))out.push('margin');if(/借券賣出/.test(t))out.push('sbl');return [...new Set(out)]}
function countEligibleRows(rows){
  const eligible=rows.filter(r=>{const t=r.text||'';const ms=[...t.matchAll(/第([一二三四五六七八九十]+)款/g)];if(!ms.length)return true;return ms.some(m=>/^[一二三四五六七八]$/.test(m[1]))});
  const dates=[...new Set(eligible.map(r=>r.date).filter(Boolean))].sort().reverse();
  return {d3:dates.slice(0,3).length?eligible.filter(r=>dates.slice(0,3).includes(r.date)).map(r=>r.date).filter((x,i,a)=>a.indexOf(x)===i).length:0,d10:Math.min(6,dates.slice(0,10).length),d30:Math.min(12,dates.slice(0,30).length),dates};
}
function twseRows(j,code){
  const fields=(j?.fields||[]).map(clean), data=Array.isArray(j?.data)?j.data:[];const find=(re)=>fields.findIndex(x=>re.test(x));
  const ci=find(/證券代號/),di=find(/日期|公告日期/),ti=find(/注意交易資訊/);return data.filter(r=>ci<0||String(r[ci]).trim()===String(code)).map(r=>({date:di>=0?clean(r[di]):'',text:ti>=0?clean(r[ti]):clean(r.join(' ')),raw:r}));
}
function rocToIso(s=''){const z=String(s).replace(/\D/g,'');if(z.length<7)return '';const y=Number(z.slice(0,3))+1911,m=z.slice(3,5),d=z.slice(5,7);return `${y}-${m}-${d}`}
async function twse(code){
  const start=minusDays(70),end=date8();
  const notice=await jfetch(`https://www.twse.com.tw/rwd/zh/announcement/notice?response=json&startDate=${start}&endDate=${end}&stockNo=${encodeURIComponent(code)}&querytype=2`);
  const punish=await jfetch(`https://www.twse.com.tw/rwd/zh/announcement/punish?response=json&startDate=${start}&endDate=${end}&stockNo=${encodeURIComponent(code)}&querytype=2`);
  const rows=twseRows(notice,code);const p=twseRows(punish,code);
  return {rows,punish:p};
}
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
function riskFrom(c,state){if(state==='處置中')return '處置中';const max=Math.max(c.d3/3,c.d10/6,c.d30/12);return max>=.83?'高':max>=.5?'中':'低'}
export default async function handler(req,res){
 try{
  const code=String(req.query?.q||'').trim(),market=String(req.query?.market||''),current=n(req.query?.price);if(!code)return res.status(400).json({ok:false,error:'缺少股票代碼'});
  const src=market.includes('上櫃')?await tpex(code):await twse(code);
  const counts=countEligibleRows(src.rows);let state=src.punish?.length?'處置中':src.rows?.length?'注意股票':'正常';
  const latest=src.rows?.[0],reasonText=latest?.text||'今日未發布注意資訊',reasonKeys=pickKeys(reasonText),risk=riskFrom(counts,state);
  if(src.warning&&state!=='處置中')state='注意股票';
  const pl=await priceLine(code,market,current);
  const stateNote=state==='處置中'?'官方已公告處置':state==='注意股票'?'目前有注意交易資訊':'目前未列為注意股票';
  const distance=Math.min(3-counts.d3,6-counts.d10,12-counts.d30);
  const riskNote=state==='處置中'?'已進入處置期間':`近30日納入計算注意次數 ${counts.d30} 次`;
  const riskDistance=state==='處置中'?'請依官方處置期間交易':distance<=1?'距核心處置門檻僅差 1 次':`距核心門檻至少還差 ${Math.max(0,distance)} 次`;
  let summary=state==='處置中'?'官方已公告處置，請直接以處置起訖日與措施為準。':state==='注意股票'?`目前為注意股票；3日 ${counts.d3}/3、10日 ${counts.d10}/6、30日 ${counts.d30}/12。請持續監控下一交易日是否再次被列注意。`:`目前未列為注意股票，核心處置計數仍有安全距離。`;
  if(pl.value)summary+=` 價格異常款保守警戒線約 ${pl.value} 元；低於此線只能排除該價格條件，不能保證其他注意條件不成立。`;
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ok:true,source:market.includes('上櫃')?'TPEx':'TWSE',state,stateNote,risk:risk==='處置中'?'高':risk,riskNote,riskDistance,counts:{d3:counts.d3,d10:counts.d10,d30:counts.d30},reasonKeys,reasonText,priceLine:pl,exceptions:{volume:{label:'依適用款次判斷',tone:'watch'},turnover:{label:'依適用款次判斷',tone:'watch'},etf:{label:'一般個股不適用',tone:''},other:{label:'依官方公告',tone:''}},summary,official:{attentionRows:src.rows?.slice(0,12)||[],disposalRows:src.punish?.slice(0,5)||[]}});
 }catch(e){return res.status(500).json({ok:false,error:e?.message||'處置資料取得失敗'})}
}
