/* StockZone 共振研究室 R1 — 可重現的價格資料驗證、進場視角研究候選、不可覆蓋快照。
 * 不改動正式 V4.3.1／共振價格原始計算；歷史價格基準測試不等於正式目標歷史重算。
 * Browser: window.StockZoneResonanceLab; Node: require('...')
 */
(function (root, factory) {
  const api = factory();

// v2.6.9.4 | 近期玩法獨立研究引擎。僅使用使用者指定的 14 類指標；不使用 MA120、估值、W3 或五年股性作為近期特徵。
// 這個研究輸出不是實測的勝率，也不會改寫原R1五年18筆、V4、共振或實際下單。
api.recentPlayStudy=function({bars=[],institutional=null,asOf=null}={}){
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const num=x=>(x===null||x===undefined||x==='')?null:(finite(+x)?+x:null);
  const rnd=(x,d=2)=>finite(x)?+x.toFixed(d):null;
  const pct=(a,b)=>finite(a)&&finite(b)&&b!==0?(a/b-1)*100:null;
  const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
  const safeDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?String(s):null;
  const raw=Array.isArray(bars)?bars:[];
  const ordered=raw.map(row=>({date:safeDate(row?.date||row?.tradeDate||row?.trade_date),
    open:num(row?.open),high:num(row?.high),low:num(row?.low),close:num(row?.close),volume:num(row?.volume??row?.tradeVolume??row?.trade_volume)}))
    .filter(x=>x.date&&x.open>0&&x.close>0&&x.high>=Math.max(x.open,x.close)&&x.low>0&&x.low<=Math.min(x.open,x.close)&&x.high>=x.low)
    .sort((a,b)=>a.date.localeCompare(b.date));
  const cur=asOf?safeDate(asOf):ordered.at(-1)?.date;
  const data=ordered.filter(x=>!cur||x.date<=cur),missing=[];
  if(data.length<65)return {valid:false,status:'insufficient',missing:['至少65根有效OHLCV日K'],reason:'近期價格歷史不足',asOf:cur,studyOnly:true};
  const last=data.at(-1),recent65=data.slice(-65);
  if(cur&&last.date!==cur)return {valid:false,status:'insufficient',missing:['指定日期沒有價格資料'],reason:'歷史日期未對齊',asOf:cur,studyOnly:true};
  if(new Set(recent65.map(x=>x.date)).size!==recent65.length)return {valid:false,status:'insufficient',missing:['K線日期重複'],reason:'日K資料異常',asOf:last.date,studyOnly:true};
  if(recent65.some((b,i)=>i>0&&Math.abs(pct(b.close,recent65[i-1].close))>35))return {valid:false,status:'insufficient',missing:['近期疑似分割／增資減資價格跳變，待校正'],reason:'價格需先校正',asOf:last.date,studyOnly:true};
  if(recent65.some(x=>!finite(x.volume)||x.volume<0)){missing.push('完整成交量');}
  const price=data.map(x=>x.close),vol=data.slice(-20).map(x=>x.volume),n=price.length,lastClose=last.close;
  const ma=k=>mean(price.slice(-k)),MA={ma5:ma(5),ma10:ma(10),ma20:ma(20),ma60:ma(60)};
  const p20=price.slice(-20),std=Math.sqrt(mean(p20.map(x=>(x-MA.ma20)**2)));
  const boll={middle:MA.ma20,upper:MA.ma20+2*std,lower:MA.ma20-2*std,
    percentB:std===0?.5:(lastClose-(MA.ma20-2*std))/(4*std),bandwidthPct:std===0?0:4*std/MA.ma20*100};
  const emaSeries=(array,period)=>{const a=2/(period+1);let prev=array[0];return array.map((v,i)=>{prev=i?prev+(v-prev)*a:v;return prev})};
  const fast=emaSeries(price,12),slow=emaSeries(price,26),dif=fast.map((x,i)=>x-slow[i]),dea=emaSeries(dif,9);
  const macd={dif:dif.at(-1),signal:dea.at(-1),hist:dif.at(-1)-dea.at(-1),prevHist:dif.at(-2)-dea.at(-2)};
  let gains=0,losses=0;for(let i=n-14;i<n;i++){const d=price[i]-price[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d)}
  const rsi=losses===0?(gains===0?50:100):100-(100/(1+gains/losses));
  const lowest=(i,period)=>Math.min(...data.slice(i-period+1,i+1).map(x=>x.low));
  const highest=(i,period)=>Math.max(...data.slice(i-period+1,i+1).map(x=>x.high));
  let k=50,d=50;for(let i=8;i<data.length;i++){
    const low=lowest(i,9),high=highest(i,9),rsv=(high===low)?50:(data[i].close-low)/(high-low)*100;
    k=(2*k+rsv)/3;d=(2*d+k)/3;
  }
  const support20=Math.min(...data.slice(-21,-1).map(x=>x.low)),support60=Math.min(...data.slice(-61,-1).map(x=>x.low));
  const resistance20=Math.max(...data.slice(-21,-1).map(x=>x.high)),resistance60=Math.max(...data.slice(-61,-1).map(x=>x.high));
  const supportCandidates=[support20,support60].filter(x=>x<lastClose).sort((a,b)=>b-a);
  const resistanceCandidates=[resistance20,resistance60].filter(x=>x>lastClose).sort((a,b)=>a-b);
  const support=supportCandidates[0]??Math.min(support20,support60),resistance=resistanceCandidates[0]??Math.max(resistance20,resistance60);
  const volatility=mean(data.slice(-20).map(x=>(x.high-x.low)/x.close*100));
  const volumeComplete=!missing.includes('完整成交量');
  const volume5=volumeComplete?mean(data.slice(-5).map(x=>x.volume)):null;
  const volume20=volumeComplete?mean(vol):null;
  const volumeRatio=volumeComplete&&volume20>0?volume5/volume20:null;
  if(volumeComplete&&!finite(volumeRatio))missing.push('有效的20日成交量比較基準');
  const advancingVolume=volumeComplete?data.slice(-5).reduce((t,x,i,a)=>t+((i>0&&x.close>a[i-1].close)?x.volume:0),0):null;
  const decliningVolume=volumeComplete?data.slice(-5).reduce((t,x,i,a)=>t+((i>0&&x.close<a[i-1].close)?x.volume:0),0):null;
  const fiveDate=String(institutional?.asOfDate||''),marginDate=String(institutional?.creditTrading?.asOfDate||'');
  const inst5=institutional?.periods?.['5'],margin5=institutional?.creditTrading?.periods?.['5'];
  const age=stamp=>safeDate(stamp)?(Date.parse(last.date+'T00:00:00Z')-Date.parse(stamp+'T00:00:00Z'))/86400000:Infinity;
  const instReady=inst5?.complete===true&&finite(num(inst5?.total))&&age(fiveDate)>=0&&age(fiveDate)<=7;
  const marginReady=margin5?.complete===true&&finite(num(margin5?.marginChange))&&
    finite(num(institutional?.creditTrading?.latest?.margin_balance))&&age(marginDate)>=0&&age(marginDate)<=7;
  if(!instReady)missing.push('法人近5日完整資料（發布日需在價格資料日之前7日內）');
  if(!marginReady)missing.push('融資近5日完整資料（發布日需在價格資料日之前7日內）');
  const instNet=instReady?num(inst5.total):null,marginChange=marginReady?num(margin5.marginChange):null;
  const marginBalance=marginReady?num(institutional.creditTrading.latest.margin_balance):null;
  const scoreParts={trend:[MA.ma5,MA.ma10,MA.ma20,MA.ma60].reduce((s,m)=>s+(lastClose>=m?1:-1),0),
    momentum:(pct(lastClose,price[n-6])>0?1:-1)+(pct(lastClose,price[n-21])>0?1:-1),
    macd:macd.hist>0?1:-1,rsi:rsi>=55?1:rsi<45?-1:0,kd:k>d?1:-1,
    volume:volumeComplete?(volumeRatio>1.1&&lastClose>=price[n-2]?1:volumeRatio>1.1&&lastClose<price[n-2]?-1:0):0,
    institution:instReady?(instNet>0?1:instNet<0?-1:0):0,
    margin:marginReady?(marginChange<0&&pct(lastClose,price[n-6])>=0?1:marginChange>0&&pct(lastClose,price[n-6])<0?-1:0):0};
  const score=Object.values(scoreParts).reduce((a,b)=>a+b,0);
  const strong60=lastClose>MA.ma60&&MA.ma20>MA.ma60;
  const overheat=boll.percentB>1.08||rsi>=78;
  const recentMode=strong60&&score>=9&&volatility<3&&pct(lastClose,price[n-21])>7?'長期':strong60&&score>=6?'長波':score>=4?'波段':score<=-3?'短期':(Math.abs(pct(lastClose,price[n-6]))>=6||volatility>=6)?'短波':'波段';
  const indicator={ma5:rnd(MA.ma5),ma10:rnd(MA.ma10),ma20:rnd(MA.ma20),ma60:rnd(MA.ma60),
    ret5Pct:rnd(pct(lastClose,price[n-6])),ret20Pct:rnd(pct(lastClose,price[n-21])),
    volatilityPct:rnd(volatility),support:rnd(support),resistance:rnd(resistance),support20:rnd(support20),support60:rnd(support60),resistance20:rnd(resistance20),resistance60:rnd(resistance60),
    bollinger:{upper:rnd(boll.upper),middle:rnd(boll.middle),lower:rnd(boll.lower),percentB:rnd(boll.percentB,3),bandwidthPct:rnd(boll.bandwidthPct)},
    macd:{dif:rnd(macd.dif,4),signal:rnd(macd.signal,4),hist:rnd(macd.hist,4),prevHist:rnd(macd.prevHist,4)},
    rsi14:rnd(rsi),kd:{k:rnd(k),d:rnd(d)},volume:{avg5:rnd(volume5),avg20:rnd(volume20),ratio:rnd(volumeRatio,3),advancing5:rnd(advancingVolume),declining5:rnd(decliningVolume)},
    institutional:{net5:instNet,asOf:instReady?fiveDate:null},margin:{change5:marginChange,balance:marginBalance,asOf:marginReady?marginDate:null}};
  const qualityComplete=missing.length===0;
  const stopBuffer=Math.max(.004,Math.min(.02,volatility/100*.25));
  const stopPrice=rnd(Math.min(support*(1-stopBuffer),lastClose*(1-.006)),2);
  // 初始比例只是「可回測的研究假設」，沒有經樣本外證明；不具正式買賣指令效力。
  let action=null,probePct=null;
  if(qualityComplete){
    if(score<=-3||rsi>=85||(lastClose<support20&&score<1)){action='觀望';probePct=0;}
    else if(score>=7&&!overheat&&volumeRatio>=.85&&instNet>=0){action='不試單，直接評估進場';probePct=100;}
    else{action='先試單';probePct=score>=4?50:score>=1?30:15;}
  }
  const gate=action==='觀望'?(rsi>=85||overheat?`短線過熱；等 RSI 回落並重新止跌、且價格守住研究支撐 ${rnd(support)}，隔日再評估`:`等待收盤重新站上 MA10 ${rnd(MA.ma10)}，MACD柱狀體回升後，次一交易日再評估`):
    action==='先試單'?`收盤守住支撐 ${rnd(support)} 且 MA5 ${rnd(MA.ma5)} 止跌，下一交易日評估試單`:
    action==='不試單，直接評估進場'?`下一交易日評估進場；不可在今日收盤價假設成交`:'法人／融資／成交量補齊後才提供進場時機';
  return {valid:true,status:qualityComplete?'research-candidate':'partial',asOf:last.date,mode:recentMode,score,scoreParts,
    inputWhitelist:['5MA','10MA','20MA','60MA','5日漲跌幅','20日漲跌幅','波動率','支撐壓力','布林通道','MACD','RSI/KD','量價','法人','融資'],
    inputs:indicator,missing,studyOnly:true,tradeAuthority:false,changeFiveYearPlay:false,
    trial:{action:action??'資料不足，暫不判定',shouldProbe:action==='先試單'?true:action?false:null,
      probePct,entryTiming:gate,
      replenishTiming:qualityComplete?`若收盤站回 MA10 ${rnd(MA.ma10)} 且 MACD柱上升、5日均量／20日均量≥1，再於下一交易日評估加碼；不改原交易玩法`:'資料補齊後再定義補倉條件',
      stopTiming:qualityComplete?`若股價跌破研究防守位 ${stopPrice}（近20／60日支撐加波動緩衝），需重新評估停損；非自動掛單`:'價格防守位可研究，但法人／融資資料不足時不發布正式停損指令',
      stopPrice},
    reason:qualityComplete?'未經樣本外驗證的進場策略候選':'近期數據部分缺漏；僅顯示已驗證的價格指標，不猜測試單比例'};
};
if(root&&root.document&&typeof root.fetch==='function'){
  const cache=new Map();
  const codeNow=()=>String(root.document.getElementById('stockCodeLabel')?.textContent||'').match(/\b\d{4,6}\b/)?.[0]||'';
  const done=(code,result)=>{if(codeNow()===code){api.liveRecentAnalysis={code,result};root.dispatchEvent?.(new root.Event('stockzone:recent-study'));}};
  api.loadRecentForCode=function(code){
    if(!/^\d{4,6}$/.test(String(code)))return Promise.resolve(null);
    const old=cache.get(code),now=Date.now();
    if(old&&now-old.time<15*60*1000){if(old.result)done(code,old.result);return old.promise||Promise.resolve(old.result)}
    const search='q='+encodeURIComponent(code);
    const promise=Promise.all([
      root.fetch('/api/technical?mode=history&range=5y&'+search,{cache:'default'}).then(r=>{if(!r.ok)throw Error('歷史價量讀取失敗 '+r.status);return r.json()}),
      root.fetch('/api/stock?action=institutional&'+search,{cache:'default'}).then(r=>{if(!r.ok)throw Error('法人融資讀取失敗 '+r.status);return r.json()})
    ]).then(([p,i])=>{
      if(!p?.ok||!Array.isArray(p?.history))throw Error('歷史資料來源沒有可用日K');
      if(i?.code&&String(i.code)!==String(code))throw Error('法人資料與股票代號不符');
      const result=api.recentPlayStudy({bars:p.history,institutional:i});
      cache.set(code,{time:Date.now(),result});done(code,result);return result;
    }).catch(err=>{const result={valid:false,status:'insufficient',reason:String(err.message||err),missing:['資料來源暫缺'],studyOnly:true};cache.set(code,{time:Date.now(),result});done(code,result);return result});
    cache.set(code,{time:now,promise});return promise;
  };
}

  // R1.4 第一階段：僅將現有三種研究「作出可追溯的研究判讀」。
  // 原本五策略公式、抽樣、歷史回測函式與 V4.3.1 的輸出完全不修改。
  if (root && root.document && typeof root.setTimeout === 'function') {
    const doc = root.document;
    const labels = {short:'短期',mixed:'短波',swing:'波段','long-swing':'長波',long:'長期'};
    const order = ['short','mixed','swing','long-swing','long'];
    const state = {report:null,bars:null,date:null,renderTimer:0};
    const el = id => doc.getElementById(id);
    const fmt = v => typeof v === 'number' && Number.isFinite(v) ? (v>0?'+':'')+v.toFixed(2)+'%' : '—';
    const safe = v => String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const style = `
      #szLabIntegrated{margin:12px 0 15px;padding:15px 14px;border:1px solid #cad8f6;
        border-radius:17px;background:linear-gradient(145deg,#f7faff,#f5f3ff);color:#263856;
        box-shadow:0 5px 17px rgba(69,100,170,.055);font-size:13px;line-height:1.65}
      #szLabIntegrated .szli-title{display:flex;align-items:center;justify-content:space-between;
        flex-wrap:wrap;gap:6px;margin-bottom:9px}
      #szLabIntegrated .szli-title b{font-size:16px;color:#263c74}
      #szLabIntegrated .szli-title small{font-size:11px;color:#64738c}
      #szLabIntegrated .szli-main{padding:10px 11px;margin-bottom:11px;background:#eaf0ff;
        border-left:3px solid #557dea;border-radius:9px;overflow-wrap:anywhere}
      #szLabIntegrated .szli-main strong{font-size:15px;color:#244dba}
      #szLabIntegrated .szli-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
      #szLabIntegrated .szli-tile{border:1px solid #e2e8f4;background:#fff;
        border-radius:10px;padding:9px 8px;min-width:0;overflow-wrap:anywhere}
      #szLabIntegrated .szli-tile small{display:block;color:#72819b;font-size:11px}
      #szLabIntegrated .szli-tile b{display:block;color:#32476e;margin:2px 0 3px;font-size:14px}
      #szLabIntegrated .szli-tile p{margin:0;color:#66738a;font-size:11.5px}
      #szLabIntegrated .szli-note{margin-top:10px;color:#6d7890;font-size:11.5px}
      #szLabOriginalReadouts{margin:8px 0 14px;padding:9px 11px;border:1px solid #e5eaf7;border-radius:11px;background:#f7f9fd}
      #szLabOriginalReadouts>summary{cursor:pointer;color:#607399;font-size:12px;font-weight:700}
      #szLabOriginalReadouts .sz-reslab-candidate,#szLabOriginalReadouts .sz-reslab-reach{margin:9px 0 0}
      @media(max-width:600px){#szLabIntegrated{padding:12px 10px}
        #szLabIntegrated .szli-grid{grid-template-columns:1fr;gap:7px}
        #szLabIntegrated .szli-tile{display:grid;grid-template-columns:70px 1fr;column-gap:5px;align-items:start}
        #szLabIntegrated .szli-tile small{grid-column:1;grid-row:1/3}
        #szLabIntegrated .szli-tile b{grid-column:2;grid-row:1;margin:0}
        #szLabIntegrated .szli-tile p{grid-column:2;grid-row:2}}
    `;
    function init(){
      const lab = doc.querySelector('.sz-reslab');
      if (!lab) return null;
      let panel = el('szLabIntegrated');
      if(!panel){
        panel=doc.createElement('section');panel.id='szLabIntegrated';
        panel.setAttribute('aria-label','三軸玩法整合研究');
        const anchor=el('szLabCandidate');
        if(anchor) lab.insertBefore(panel,anchor);else lab.appendChild(panel);
      }
      // 原本兩塊逐項文字保留可查，不再與統一摘要並排重複佔版面。
      if(!el('szLabOriginalReadouts')){
        const candidate=el('szLabCandidate'),reach=el('szLabReach');
        if(candidate&&reach){
          const details=doc.createElement('details');details.id='szLabOriginalReadouts';
          const caption=doc.createElement('summary');caption.textContent='展開原R1歷史比較候選與到達時間明細（不參與新版近期玩法）';
          details.appendChild(caption);lab.insertBefore(details,candidate);
          details.appendChild(candidate);details.appendChild(reach);
        }
      }
      if(!el('szLabIntegratedStyle')){
        const node=doc.createElement('style');node.id='szLabIntegratedStyle';node.textContent=style;
        (doc.head||doc.documentElement).appendChild(node);
      }
      return panel;
    }
    function selectBaseline(report){
      if(!report?.valid || !Array.isArray(report.results))return null;
      // 第一階段研究判讀，不是變更原回測公式：要求多數獲利、典型（中位數）獲利，
      // 再用每筆平均淨報酬／平均不利幅度比較，避免最長持有期靠少數右尾報酬霸榜。
      const eligible=report.results.filter(x=>x.stats?.avgPct>0 && x.stats?.medianPct>0 && x.stats?.winPct>=50 && x.stats?.count>=10);
      if(!eligible.length)return {key:null,reason:'18筆沒有同時符合「平均淨報酬>0、中位數>0、勝率≥50%」的玩法；不強選第一名。'};
      const sorted=eligible.map(x=>({...x,eff:x.stats.avgPct/Math.max(.01,Math.abs(x.stats.avgMaePct))}))
        .sort((a,b)=>b.eff-a.eff || a.strategy.days-b.strategy.days);
      const best=sorted[0];
      return {key:best.strategy.key,stats:best.stats,eff:best.eff,
        reason:`${best.strategy.days}日｜${best.stats.count}筆勝率 ${best.stats.winPct}%・平均淨報酬 ${fmt(best.stats.avgPct)}・中位數 ${fmt(best.stats.medianPct)}；平均不利幅度 ${fmt(best.stats.avgMaePct)}。`};
    }
    function recentInfo(){
      const code=String(el('stockCodeLabel')?.textContent||'').match(/\b\d{4,6}\b/)?.[0]||'';
      const live=api.liveRecentAnalysis;
      if(live?.code!==code||!live.result?.valid)return null;
      const r=live.result;
      return {label:r.mode,key:Object.keys(labels).find(k=>labels[k]===r.mode),
        note:r.status==='research-candidate'?'僅為近期研究候選；採用指定技術、量價、法人與融資，不用MA120。':`資料待補：${r.missing?.join('、')||'不明'}`};
    }
    function reachInfo(){
      const txt=el('szLabReach')?.textContent||'';
      const r={};
      for (const line of txt.split('\n')) {
        const m=line.match(/^(主要|次要|回測)：距現價\s*([+\-]?[\d.]+)%｜歷史同幅度20D\s*([\d.]+)%・40D\s*([\d.]+)%（(\d+)筆）/);
        if(m)r[m[1]]={distance:Number(m[2]),h20:Number(m[3]),h40:Number(m[4]),count:Number(m[5])};
      }
      return r;
    }
    function explain(baseline,recent,reach){
      if(!baseline?.key)return baseline?.reason||'請先執行五年價格基準回測，才能提出整合研究結論。';
      const base=labels[baseline.key],rt=recent?.label;
      const main=reach?.主要,secondary=reach?.次要;
      const horizon=api.STRATEGIES.find(x=>x.key===baseline.key)?.days||20;
      const comparableH=horizon<=20?20:horizon<=40?40:null;
      const more=(main&&secondary&&comparableH)?`；共振價格僅可參考歷史同幅度${comparableH}日觸及率（次要${secondary['h'+comparableH]}%、主要${main['h'+comparableH]}%），不可當作預測勝率。`:'';
      if(!rt)return `五年股性初步傾向${base}；近期候選資料不足，先不判定本次是否適合進場${more}`;
      let now;
      if (rt===base) now=`近期亦偏${rt}，兩個角度一致；進出場仍以原買賣決策條件為準`;
      else if(order.indexOf(recent.key)<order.indexOf(baseline.key)) now=`近期轉為${rt}，比五年${base}主軸短；不宜把長期優勢直接當成現在的追價依據`;
      else now=`近期偏${rt}，比五年${base}主軸長；不因此自動拉長持有期`;
      return `五年初步主軸：${base}。${now}${more}`;
    }
    function render(){
      const panel=init();if(!panel)return;
      const original=el('szLabBacktest')?.textContent||'';
      if(state.report && (original.includes('按「執行')||original.includes('無法進行價格回測'))){
        state.report=null;state.bars=null;state.date=null;
      }
      const baseline=selectBaseline(state.report),recent=recentInfo(),reach=reachInfo();
      const baselineTag=!state.report?'未回測':!baseline?.key?'無明確優勢':labels[baseline.key];
      const candidateTag=recent?.label||'資料不足';
      const candidateNote=recent?recent.note:'待取得完整價格、量價、法人與融資資料';
      const rMain=reach.主要,rSecondary=reach.次要;
      const reachTag=rSecondary&&rMain?`次要 ${rSecondary.distance>0?'+':''}${rSecondary.distance}%｜主要 ${rMain.distance>0?'+':''}${rMain.distance}%`:'暫無完整目標資料';
      const reachNote=rSecondary&&rMain?`歷史同幅度20日觸及：次要 ${rSecondary.h20}%／主要 ${rMain.h20}%；不是共振達標機率。`:'資料不足，不能據此推估期限';
      const summary=explain(baseline,recent,reach);
      const status=state.report?.valid?'僅供研究｜尚未接管正式玩法':'先執行一次五年回測';
      panel.innerHTML=`<div class="szli-title"><b>三軸玩法整合 · 第一階段</b><small>${safe(status)}</small></div>
        <div class="szli-main"><strong>${safe(baseline?.key?`研究主軸：${baselineTag}`:'研究判讀待確認')}</strong><div>${safe(summary)}</div></div>
        <div class="szli-grid">
          <div class="szli-tile"><small>五年整體（${state.report?.coverage?.signals??'待回測'}筆）</small><b>${safe(baselineTag)}</b><p>${safe(baseline?.reason||'保留60交易日抽樣；按下回測後比較五種策略。')}</p></div>
          <div class="szli-tile"><small>近期候選</small><b>${safe(candidateTag)}</b><p>${safe(candidateNote)}</p></div>
          <div class="szli-tile"><small>到達時間參考</small><b>${safe(reachTag)}</b><p>${safe(reachNote)}</p></div>
        </div>`;
    }
    function schedule(){root.clearTimeout(state.renderTimer);state.renderTimer=root.setTimeout(render,0);}
    // 頁面首次渲染、股票更換、近期行情或共振數值更新皆同步刷新，防止前檔結果殘留。
    function watch(){
      if(!init())return;
      const Observer=root.MutationObserver;
      if(Observer){
        for (const id of ['szLabReach','szLabBacktest','stockCodeLabel']){
          const node=el(id);if(!node)continue;
          new Observer(()=>schedule()).observe(node,{childList:true,characterData:true,subtree:true});
        }
      }
      root.addEventListener?.('stockzone:recent-study',schedule);
      schedule();
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',watch,{once:true});else root.setTimeout(watch,0);
    const rawBacktest=api.backtestPriceBaselines;
    api.backtestPriceBaselines=function(input,options){
      const report=rawBacktest.call(this,input,options);
      // 回傳結果完全沿用原R1；只在畫面額外製作三軸研究摘要。
      state.report=report.valid?report:null;
      state.date=report.coverage?.to||null;
      schedule();
      return report;
    };
  }
  // R1.5 第二階段：獨立的核心/機動/現金倉位研究。
  // 僅作研究建議，確認後才寫入「即時校正」；從未覆寫既有原始交易計畫。
  if (root && root.document && typeof root.setTimeout === 'function') {
    const doc = root.document;
    const byId = id => doc.getElementById(id);
    const codeNow = () => String(byId('stockCodeLabel')?.textContent||'').match(/\b\d{4,6}\b/)?.[0]||'';
    const nameOf = {short:'短期',mixed:'短波',swing:'波段','long-swing':'長波',long:'長期'};
    const st = {code:'',bars:[],barsCode:'',override:'auto',w3Label:'',w3Date:'',pending:null,timer:0,opened:false};
    const snapshotNow = code => {try {const db=JSON.parse(root.localStorage?.getItem('sz_resonance_lab_r1_plans')||'{}');const r=db?.[code];return (r?.plans||[]).find(p=>p.id===r.activeId)||null;}catch{return null;}};
    const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fmt = n => typeof n==='number' && Number.isFinite(n)?Number(n.toFixed(1)):'—';
    function w3Source(lastDate) {
      const raw=String(byId('marketW3Regime')?.textContent||'').trim();
      const date=String(byId('marketW3TradeDate')?.textContent||'').trim().slice(0,10);
      const value=raw==='多頭環境'?'on':raw==='風險升溫'?'warning':raw==='空頭環境'?'off':null;
      const gap=/^\d{4}-\d{2}-\d{2}$/.test(date)&&/^\d{4}-\d{2}-\d{2}$/.test(lastDate)
        ?Math.abs((Date.parse(date+'T00:00:00Z')-Date.parse(lastDate+'T00:00:00Z'))/86400000):Infinity;
      const currentGap=/^\d{4}-\d{2}-\d{2}$/.test(date)?(Date.now()-Date.parse(date+'T00:00:00Z'))/86400000:Infinity;
      if(value && gap<=7 && currentGap>=-1 && currentGap<=7)return {value,source:'W3動態',date};
      return {value:'unknown',source:'W3未取得或日期不匹配',date:date||'--'};
    }
    function getMarket(lastDate) {
      const official=w3Source(lastDate);
      if(st.override!=='auto')return {value:st.override,source:'手動情境（非官方W3）',date:lastDate};
      return official;
    }
    const css = `
    #szLabAllocation{margin:10px 0 14px;border:1px solid #d6e1f2;border-radius:13px;background:#fff;max-width:100%;color:#32445f}
    #szLabAllocation summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:9px;
      padding:12px 13px;list-style:none;font-size:13px;line-height:1.45}
    #szLabAllocation summary::-webkit-details-marker{display:none}
    #szLabAllocation summary b{font-size:13.5px;color:#35548a}
    #szLabAllocation summary span{font-size:12px;text-align:right;color:#3e5791}
    #szLabAllocation .szla-body{border-top:1px solid #e7edf5;padding:10px 12px 12px;font-size:12px;line-height:1.65}
    #szLabAllocation .szla-bars{display:flex;width:100%;height:13px;overflow:hidden;border-radius:9px;background:#edf1f7;margin:8px 0 9px}
    #szLabAllocation .szla-bars>span{height:100%;transition:width .2s ease}
    #szLabAllocation .szla-legend{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:5px 0 9px;font-weight:750}
    #szLabAllocation .szla-msg{margin:7px 0;padding:8px;border-radius:9px;background:#f3f6fc;color:#526682}
    #szLabAllocation .szla-market{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:9px 0}
    #szLabAllocation .szla-market select{flex:1 1 170px;min-width:0;max-width:100%;padding:9px;border:1px solid #dbe2ee;border-radius:8px;background:#fff;color:#34465f}
    #szLabAllocation .szla-confirm{width:100%;border:0;background:#347cff;color:#fff;border-radius:10px;
       cursor:pointer;padding:10px 12px;font-weight:750;font-size:13px}
    #szLabAllocation .szla-confirm:disabled{background:#e8edf4;color:#8b98ab;cursor:not-allowed}
    #szLabAllocation .szla-saved{margin:7px 0;color:#667c98;overflow-wrap:anywhere}
    #szLabAllocation .szla-foot{color:#7b889a;font-size:11px;line-height:1.6}
    `;
    function init() {
      const lab=doc.querySelector('.sz-reslab');if(!lab)return null;
      let box=byId('szLabAllocation');
      if(!box){box=doc.createElement('details');box.id='szLabAllocation';box.setAttribute('aria-label','第二階段核心機動比例研究');
        const anchor=byId('szLabIntegrated');if(anchor)anchor.after(box);else lab.insertBefore(box,byId('szLabCandidate')||null);
        box.addEventListener('toggle',()=>{st.opened=box.open});
        box.addEventListener('change',event=>{if(event.target?.id==='szLabAllocationW3'){st.override=event.target.value;queue();}});
        box.addEventListener('click',event=>{if(event.target?.id==='szLabAllocationApply'){saveApproved();}});
      }
      if(!byId('szLabAllocationStyle')){const node=doc.createElement('style');node.id='szLabAllocationStyle';node.textContent=css;
        (doc.head||doc.documentElement).appendChild(node)}
      return box;
    }
    function selectedPlay(plan) {
      // 鎖定後不隨近期候選、選擇框或其他重算結果改變玩法。
      if(plan?.initial?.play)return plan.initial.play;
      return byId('szLabPlaySelect')?.value||'swing';
    }
    function render(){
      const box=init();if(!box)return;
      const code=codeNow();
      if(code!==st.code){st.code=code;st.override='auto';st.pending=null;st.opened=false;}
      if(!code){box.innerHTML='<summary><b>第二階段｜核心／機動配置</b><span>請先選擇股票</span></summary>';return;}
      const plan=snapshotNow(code),play=selectedPlay(plan);
      const ok=st.barsCode===code&&st.bars?.length>=120;
      const ctx=ok?api.contextAt(st.bars,st.bars.length-1):{valid:false};
      const market=getMarket(ctx?.date||'');
      const base=Number.isFinite(+plan?.initial?.corePct)&&plan?.initial?.corePct!==null?+plan.initial.corePct:
        ({short:20,mixed:35,swing:55,'long-swing':70,long:85}[play]||55);
      const study=api.proposeAllocation({play,baseCorePct:base,context:ctx,market:market.value});
      const latest=(plan?.updates||[]).slice().reverse().find(u=>u.allocationStudy)?.allocationStudy||null;
      const tags=market.value==='on'?'多頭環境':market.value==='warning'?'風險升溫':market.value==='off'?'空頭環境':'W3尚未確認';
      const stat=study.valid?`核心 ${fmt(study.corePct)}%｜機動 ${fmt(study.tacticalPct)}%｜現金 ${fmt(study.cashPct)}%`:'缺少有效資料';
      const opened=box.open;
      box.innerHTML=`<summary><b>第二階段｜持倉配置研究</b><span>${esc(stat)} ▾</span></summary>
      <div class="szla-body">
        <div><b>玩法：${esc(nameOf[play]||play)}</b> ${plan?'（原始已鎖定）':'（預覽，尚未鎖定交易）'}；基準核心 ${fmt(base)}%／機動 ${fmt(100-base)}%。</div>
        <div class="szla-market"><label for="szLabAllocationW3">大盤狀態</label><select id="szLabAllocationW3">
          <option value="auto" ${st.override==='auto'?'selected':''}>自動讀取W3</option>
          <option value="on" ${st.override==='on'?'selected':''}>手動試算：多頭環境</option>
          <option value="warning" ${st.override==='warning'?'selected':''}>手動試算：風險升溫</option>
          <option value="off" ${st.override==='off'?'selected':''}>手動試算：空頭環境</option></select></div>
        <div class="szla-msg">${esc(tags)}｜${esc(market.source)} ${esc(market.date||'')}${market.value==='unknown'?'；以下只有股價研究比例，W3風控尚未完成。':''}</div>
        ${study.valid?`<div class="szla-bars" role="img" aria-label="核心${fmt(study.corePct)}%，機動${fmt(study.tacticalPct)}%，現金${fmt(study.cashPct)}%">
            <span style="width:${study.corePct}%;background:#466dde"></span><span style="width:${study.tacticalPct}%;background:#36bca0"></span><span style="width:${study.cashPct}%;background:#d3dae6"></span></div>
            <div class="szla-legend"><span>核心 ${fmt(study.corePct)}%</span><span>機動 ${fmt(study.tacticalPct)}%</span><span>現金 ${fmt(study.cashPct)}%</span></div>
            <div class="szla-msg">${esc(study.reason.join('；'))}</div>`:`<div class="szla-msg">${esc(study.reason?.join('；')||'股價資料不足')}</div>`}
        <button class="szla-confirm" type="button" id="szLabAllocationApply" ${!plan||!study.valid||market.value==='unknown'?'disabled':''}>確認這次配置，寫入即時校正</button>
        ${latest?`<div class="szla-saved">最近已保存配置：${esc(latest.date||'')}｜核心 ${fmt(latest.corePct)}%／機動 ${fmt(latest.tacticalPct)}%／現金 ${fmt(latest.cashPct)}%（${esc(latest.w3Source||'未標示來源')}）</div>`:''}
        <div class="szla-foot">比例以「預定投入資金總額＝100%」計算，現金是減倉後保留的部分，不是再加一筆資金。原始玩法與初始比例不覆寫；僅手動確認後增加更新紀錄。不直接送單、不改模擬交易；新比例規則尚無歷史績效驗證。</div>
      </div>`;
      box.open=opened;
    }
    function queue(){root.clearTimeout(st.timer);st.timer=root.setTimeout(render,30)}
    function saveApproved(){
      const code=codeNow(),plan=snapshotNow(code),ctx=st.barsCode===code?api.contextAt(st.bars,st.bars.length-1):{valid:false};
      const market=getMarket(ctx?.date||''),button=byId('szLabSaveUpdate');
      if(!plan||!ctx.valid||market.value==='unknown'||!button||button.disabled){return;}
      const study=api.proposeAllocation({play:plan.initial.play,baseCorePct:plan.initial.corePct,context:ctx,market:market.value});
      if(!study.valid)return;
      st.pending={code,planId:plan.id,play:plan.initial.play,market,asOf:ctx.date,study};
      button.click();
      // 防止其它後續儲存意外沿用授權，即使目前版本更新的事件處理沒有呼叫 appendUpdate。
      st.pending=null;queue();
    }
    function watch(){
      if(!init())return;
      const Obs=root.MutationObserver;
      if(Obs) for(const id of ['szLabOriginal','szLabCandidate','szLabPlaySelect','marketW3Regime','marketW3TradeDate','stockCodeLabel']){
        const node=byId(id);if(node)new Obs(()=>queue()).observe(node,{childList:true,characterData:true,subtree:true});
      }
      byId('szLabPlaySelect')?.addEventListener('change',queue);
      byId('szLabLockPlan')?.addEventListener('click',()=>root.setTimeout(queue,30));
      byId('szLabNewTrade')?.addEventListener('click',()=>root.setTimeout(queue,30));
      byId('szLabSaveUpdate')?.addEventListener('click',()=>root.setTimeout(queue,30));
      queue();
    }
    // app.js 既有流程會在分析時呼叫 lab.cleanBars；只記錄當檔已驗證的日K，無資料時不展示假比例。
    const originalClean=api.cleanBars;
    api.cleanBars=function(input){const res=originalClean.call(this,input);
      const code=codeNow();if(code){st.barsCode=code;st.bars=res.valid?res.bars:[];}queue();return res;};
    // 只有使用者按下本研究卡片的確認鈕，本次更新才記錄新的比例；其餘原版儲存保持原樣。
    const originalAppend=api.appendUpdate;
    api.appendUpdate=function(snapshot,now){
      const pending=st.pending;
      if(pending&&snapshot?.code===pending.code&&snapshot?.id===pending.planId&&snapshot?.initial?.play===pending.play){
        const source=pending.market.source,date=pending.asOf,study=pending.study;
        st.pending=null;
        const saved=originalAppend.call(this,snapshot,{...now,corePct:study.corePct,play:pending.play});
        const updates=[...saved.updates];const last=updates[updates.length-1];
        updates[updates.length-1]={...last,tacticalPct:study.tacticalPct,cashPct:study.cashPct,allocationStudy:{
          date,corePct:study.corePct,tacticalPct:study.tacticalPct,cashPct:study.cashPct,
          play:pending.play,w3State:pending.market.value,w3Source:source,model:'allocation-study-r1.5',
          warning:'研究性配置，尚未回測證明改善績效'}};
        return {...saved,updates};
      }
      return originalAppend.call(this,snapshot,now);
    };
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',watch,{once:true});else root.setTimeout(watch,0);
  }
  // v2.6.8.49 — 使用者介面整理（只改顯示與自動觸發，不改R1/V4/W3數學函式）。
  if (root && root.document && typeof root.setTimeout === 'function') {
    const d = root.document;
    const node = id => d.getElementById(id);
    const ui = {lastRunKey:'',pending:null,sourceText:'',simpleText:'',lastCode:'',lastBars:null};
    const currentCode = () => String(node('stockCodeLabel')?.textContent||'').match(/\b\d{4,6}\b/)?.[0]||'';
    const css = `
      /* 法人／技術／估值共用藍色小卡標準：字體及間距一致，不動數據 */
      #institutionalTrend .institutional-flow-card,
      #technical .tech-tile,
      #valuation .valuation-model-tiles .valuation-tech-tile {
        background:#eef5ff!important;border:1px solid #dfe8f5!important;border-radius:16px!important;
        padding:12px 11px!important;min-width:0!important;box-shadow:0 7px 18px rgba(17,34,61,.035)!important;
      }
      #institutionalTrend .institutional-flow-title,
      #technical .tech-tile header b,
      #valuation .valuation-model-tiles .valuation-tech-tile header b {
        font-size:15px!important;line-height:1.3!important;font-weight:800!important;color:#21324b!important;
        overflow-wrap:anywhere!important;
      }
      #institutionalTrend .institutional-flow-card .institutional-flow-head,
      #technical .tech-tile header,
      #valuation .valuation-model-tiles .valuation-tech-tile header {
        display:flex!important;align-items:center!important;justify-content:space-between!important;gap:6px!important;
        margin-bottom:8px!important;
      }
      #institutionalTrend .institutional-flow-head em,
      #technical .tech-tile header em,
      #valuation .valuation-model-tiles .valuation-tech-tile header em {
        font-size:11px!important;line-height:1.4!important;white-space:nowrap!important;
        padding:3px 7px!important;font-weight:750!important;
      }
      #institutionalTrend .institutional-flow-card p,
      #technical .tech-tile p,
      #valuation .valuation-model-tiles .valuation-tech-tile p {
        font-size:12px!important;line-height:1.55!important;color:#64758e!important;
        min-height:39px!important;margin:6px 0 9px!important;overflow-wrap:anywhere!important;
      }
      #institutionalTrend .institutional-flow-rows>div,
      #technical .tech-tile small > div,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-rows>div{
        font-size:12px!important;line-height:1.5!important;
      }
      #institutionalTrend .institutional-flow-rows>div span,
      #technical .tech-tile small,
      #valuation .valuation-model-tiles .valuation-tech-tile small {font-size:12px!important;line-height:1.55!important;}
      #institutionalTrend .institutional-flow-rows>div b,
      #technical .tech-tile small b,
      #valuation .valuation-model-tiles .valuation-tech-tile small b,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-rows b {
        font-size:14px!important;font-weight:800!important;line-height:1.45!important;
      }
      #institutionalTrend .institutional-flow-rows>div{gap:5px!important;min-width:0!important}
      #institutionalTrend .institutional-flow-rows b{overflow-wrap:anywhere!important;text-align:right!important}
      /* 舊版「建議玩法」重複大卡撤下；保留V4.3.1的真實計算節點供程式讀取 */
      #playStyleCard>.playstyle-hero,
      #playStyleCard>.playstyle-short-analysis,
      #playStyleCard>.playstyle-swing-analysis,
      #playStyleCard>.playstyle-long-analysis,
      #playStyleCard>.playstyle-note {display:none!important}
      #playStyleCard>.sz-v4-candidate{margin-top:8px!important;margin-bottom:0!important;
        padding:13px 14px!important;background:#f3f7ff!important;border:1px solid #dce6f6!important}
      #playStyleCard>.sz-v4-candidate .sz-v4-head em{display:none!important}
      #playStyleCard>.sz-v4-candidate>b{font-size:21px!important;line-height:1.4!important;margin:8px 0 4px!important}
      #playStyleCard>.sz-v4-candidate>small{font-size:12px!important;line-height:1.65!important;margin:6px 0 0!important}
      /* 五年回測是自動分析，保留表格，不讓研究用提示擠滿手機 */
      #szLabRunBacktest{display:none!important}
      .sz-reslab .sz-reslab-method{display:none!important}
      #szLabBacktest .sz49-table-wrap{overflow-x:auto;width:100%;max-width:100%;-webkit-overflow-scrolling:touch}
      #szLabBacktest .sz49-table-wrap table{width:100%;min-width:380px;border-collapse:collapse}
      #szLabBacktest .sz49-table-wrap th,
      #szLabBacktest .sz49-table-wrap td{font-size:12px!important;padding:9px 5px!important;white-space:nowrap!important}
      #szLabBacktest .sz49-table-wrap th:first-child,
      #szLabBacktest .sz49-table-wrap td:first-child{white-space:normal!important;min-width:79px}
      @media(max-width:720px){
        #institutionalTrend .institutional-flow-card,
        #technical .tech-tile,
        #valuation .valuation-model-tiles .valuation-tech-tile{padding:11px 10px!important;border-radius:16px!important}
        #institutionalTrend .institutional-flow-title,
        #technical .tech-tile header b,
        #valuation .valuation-model-tiles .valuation-tech-tile header b{font-size:14px!important}
        #institutionalTrend .institutional-flow-rows>div b{font-size:13px!important}
        #technical .tech-tile small,
        #valuation .valuation-model-tiles .valuation-tech-tile small{font-size:11px!important}
        #institutionalTrend .institutional-flow-card p,
        #technical .tech-tile p,
        #valuation .valuation-model-tiles .valuation-tech-tile p{font-size:11px!important;min-height:35px!important}
      }
    `;
    function preparePlayCard(){
      const card=node('playStyleCard'),hero=card?.querySelector('.playstyle-hero');
      const newCard=hero?.querySelector('.sz-v4-candidate');
      if(newCard){hero.after(newCard);newCard.setAttribute('aria-label','V4.3.1 玩法建議');}
      const heading=card?.querySelector('.card-title .theme-title-group>span');
      if(heading && heading.textContent==='建議玩法') heading.textContent='玩法分析';
    }
    function readableV4(){
      const detail=node('szV4CandidateDetail');if(!detail)return;
      const raw=(detail.textContent||'').trim();
      if(raw && raw!==ui.simpleText)ui.sourceText=raw;
      const src=ui.sourceText||raw;
      const tentative=/暫定|未驗證|待驗證|不足|0期|資料缺口/.test(src) || /暫定|待補/.test(node('szV4Candidate')?.textContent||'');
      const evidence=/EPS.{0,20}(?:0期|不足)|長期資料待驗證|長期財報待驗證/.test(src);
      const txt=tentative
        ? `股價走勢與營運資料已納入參考；${evidence?'長期獲利資料尚待補足，':'部分條件尚待驗證，'}目前建議先作參考。`
        : '綜合歷史股價走勢與長期營運資料，評估適合的持有方式。';
      ui.simpleText=txt;
      if(raw!==txt)detail.textContent=txt;
    }
    function formatBacktest(){
      const panel=node('szLabBacktest');if(!panel)return;
      const table=panel.querySelector('table');
      if(!table)return;
      if(table.dataset.sz49Ready==='1')return;
      const clean=table.cloneNode(true);
      for(const row of clean.querySelectorAll('tr')){
        const cells=row.querySelectorAll(':scope > th, :scope > td');
        // 原R1表格第二欄是「筆數」；只隱藏此欄，其餘績效數據照原版。
        if(cells.length>=5)cells[1].remove();
      }
      clean.dataset.sz49Ready='1';
      const wrap=d.createElement('div');wrap.className='sz49-table-wrap';wrap.appendChild(clean);
      panel.replaceChildren(wrap);
    }
    function hasReadyCandidate(){
      const txt=node('szLabCandidate')?.textContent||'';
      return txt.includes('本次入場視角（研究候選）') || txt.includes('研究候選');
    }
    function maybeAutoRun(){
      if(!ui.lastBars || !hasReadyCandidate())return;
      const code=currentCode();if(!code)return;
      const {res,first,last}=ui.lastBars;
      if(!res?.valid || res.bars.length<150)return;
      const key=[code,res.bars.length,first.date,last.date,last.close,last.open].join('|');
      if(ui.lastRunKey===key || ui.pending===key)return;
      ui.pending=key;
      root.setTimeout(()=>{
        if(ui.pending!==key)return;
        ui.pending=null;
        if(currentCode()!==code)return;
        const btn=node('szLabRunBacktest');if(!btn)return;
        // 直接觸發 app.js 原有回測事件，絕不自寫一套回測或替換結果。
        ui.lastRunKey=key;
        try{btn.click()}catch(err){ui.lastRunKey='';root.console?.warn?.('自動回測執行失敗',err)}
      },140);
    }
    function init(){
      if(!node('sz49StandardStyle')){const n=d.createElement('style');n.id='sz49StandardStyle';n.textContent=css;(d.head||d.documentElement).appendChild(n)}
      preparePlayCard();readableV4();formatBacktest();
      if(!ui.lastCode)ui.lastCode=currentCode();
      if(ui.lastCode!==currentCode()){ui.lastCode=currentCode();ui.lastRunKey='';ui.pending=null;ui.lastBars=null;}
    }
    const prevClean=api.cleanBars;
    api.cleanBars=function(input){
      const res=prevClean.call(this,input);
      if(Array.isArray(res.bars)&&res.bars.length>=150){
        ui.lastBars={res,first:res.bars[0],last:res.bars[res.bars.length-1]};
        root.setTimeout(maybeAutoRun,0);
      }
      return res;
    };
    function watch(){
      init();
      const Observer=root.MutationObserver;if(!Observer)return;
      const box=node('szLabBacktest');
      if(box)new Observer(()=>formatBacktest()).observe(box,{childList:true,subtree:true});
      const candidate=node('szLabCandidate');
      if(candidate)new Observer(()=>maybeAutoRun()).observe(candidate,{childList:true,characterData:true,subtree:true});
      const detail=node('szV4CandidateDetail');
      if(detail)new Observer(()=>readableV4()).observe(detail,{childList:true,characterData:true,subtree:true});
      const code=node('stockCodeLabel');
      if(code)new Observer(()=>{
        if(ui.lastCode!==currentCode()){ui.lastCode=currentCode();ui.lastRunKey='';ui.lastBars=null;ui.pending=null;}
      }).observe(code,{childList:true,characterData:true,subtree:true});
      maybeAutoRun();
    }
    if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',watch,{once:true});
    else root.setTimeout(watch,0);
  }

  // v2.6.9.0 — 僅統一三區資料卡的字階；以「融資」小卡當前規格為唯一基準。
  // 保留 v2.6.8.49 的原始回測與版面功能，不重寫任何分析數值或狀態顏色。
  if (root && root.document) {
    const document = root.document;
    const FONT_STYLE_ID = 'stockzone-v2690-card-font-parity';
    const STYLE = `
      /* 對照融資卡：桌面 標題15／說明11／欄名11／數值12／狀態10px。 */
      :root {
        --sz-card-title-fs:15px;
        --sz-card-caption-fs:11px;
        --sz-card-label-fs:11px;
        --sz-card-value-fs:12px;
        --sz-card-status-fs:10px;
      }
      /* 三區的標題文字統一，保留原本的 icon 大小及顏色。 */
      #institutionalTrend .institutional-flow-card .institutional-flow-title,
      #technical .tech-tile header > b,
      #valuation .valuation-model-tiles .valuation-tech-tile header > b {
        font-size:var(--sz-card-title-fs)!important;
        line-height:1.2!important;
        font-weight:800!important;
      }
      /* 法人／技術／估值：狀態徽章統一（融資卡的標題附註層級）。 */
      #institutionalTrend .institutional-flow-card .institutional-flow-head > em,
      #technical .tech-tile header > em,
      #valuation .valuation-model-tiles .valuation-tech-tile header > em {
        font-size:var(--sz-card-status-fs)!important;
        line-height:1.3!important;
      }
      /* 卡片說明：與融資卡「使用率」同級。 */
      #institutionalTrend .institutional-flow-card > p,
      #technical .tech-tile > p,
      #valuation .valuation-model-tiles .valuation-tech-tile > p,
      #valuation .valuation-model-tiles .valuation-tech-tile > .valuation-mini-subnote {
        font-size:var(--sz-card-caption-fs)!important;
        line-height:1.45!important;
      }
      /* 欄位名稱（當日 / 5日 / 10MA / 目前 / 季度日期）。 */
      #institutionalTrend .institutional-flow-card .institutional-flow-rows > div > span,
      #technical .tech-tile > small,
      #technical .tech-tile .tech-metric > span,
      #technical .tech-tile .tech-metric > small,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-data-row > span,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-quarter-chip > span,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-quarter-chip > small {
        font-size:var(--sz-card-label-fs)!important;
        line-height:1.45!important;
      }
      /* 數字（與融資卡的「-28.7萬股」同級）；包含估值 EPS 季度值。 */
      #institutionalTrend .institutional-flow-card .institutional-flow-rows > div > b,
      #technical .tech-tile .tech-metric > b,
      #technical .tech-tile .tech-metric > strong,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-data-row > b,
      #valuation .valuation-model-tiles .valuation-tech-tile .valuation-quarter-chip > b {
        font-size:var(--sz-card-value-fs)!important;
        line-height:1.4!important;
        font-weight:800!important;
      }
      @media (max-width:760px) {
        /* 真正取自既有融資卡 mobile CSS：標題13／說明10／欄名10.5／數值11／狀態9px。 */
        :root {
          --sz-card-title-fs:13px;
          --sz-card-caption-fs:10px;
          --sz-card-label-fs:10.5px;
          --sz-card-value-fs:11px;
          --sz-card-status-fs:9px;
        }
      }
    `;
    function applyTypography() {
      let style = document.getElementById(FONT_STYLE_ID);
      if (!style) {
        style = document.createElement('style');style.id=FONT_STYLE_ID;
        style.textContent=STYLE;(document.head||document.documentElement).appendChild(style);
      }
    }
    // v49 樣式在 DOMContentLoaded 時才插入：本樣式在下一個排程覆蓋它。
    if (document.readyState==='loading') {
      document.addEventListener('DOMContentLoaded',()=>root.setTimeout(applyTypography,0),{once:true});
    } else root.setTimeout(applyTypography,0);
  }

  // v2.6.9.1 | 畫面去重、研究室歸位、基本面資料缺漏自動補查。
  // 不更動 EPS/估值/共振公式；缺少可靠來源時保留空值，不造同行倍數或 EPS。
  if (root && root.document && typeof root.setTimeout === 'function') {
    const doc=root.document;
    const px=id=>doc.getElementById(id);
    const completed=new Map();
    const STALE=12*60*1000;
    const patchStyle=`
      /* EPS 卡片標題已標 EPS，移除重複的「近四季 EPS」行。 */
      #valuationMiniEpsLead{display:none!important}
      /* 研究說明移出主要閱覽；細節保留於必要的已存檔資料。 */
      .sz-reslab>.sz-reslab-tip{display:none!important}
      #szLabIntegrated>.szli-note{display:none!important}
      /* 併到「玩法分析」主卡，避免重複的外層卡片容器佔掉大量空白。 */
      #playStyleCard>.sz-reslab{margin:14px 0 0!important;max-width:100%!important;width:100%!important;min-width:0!important}
      #playStyleCard>.sz-reslab .sz-reslab-header{font-size:15px}
      #playStyleCard>.sz-reslab #szLabIntegrated{max-width:100%!important}
    `;
    function layout(){
      if(!px('sz2691Style')){const n=doc.createElement('style');n.id='sz2691Style';n.textContent=patchStyle;(doc.head||doc.documentElement).appendChild(n)}
      px('valuationMiniEpsLead')?.setAttribute('hidden','');
      const card=px('playStyleCard'),lab=doc.querySelector('.sz-reslab');
      if(card&&lab&&!card.contains(lab)){
        // 搬移原有 DOM，沿用 app.js 事件監聽器與資料狀態，不複製卡片、不重啟公式。
        card.appendChild(lab);
      }
      // 此段文字沒有額外的使用者決策資訊，從 DOM 移除而非更換公式。
      lab?.querySelector('.sz-reslab-tip')?.remove();
      px('szLabIntegrated')?.querySelector('.szli-note')?.remove();
    }
    // 版本可能先於 app.js 載入；DOM Ready 後註冊補查原函式的包裝。
    function attachDataRepair(){
      // 某來源同時提供 period=2026 Q2 與 year=1911：兩者衝突時，
      // 只以該來源明確標示且合法的 period 修正「季度識別」，不修改 EPS 金額。
      const oldQuarter=root.fundamentalQuarterInfo;
      if(typeof oldQuarter==='function'&&!oldQuarter.__sz2691){
        const fixed=function(row){
          const period=String(row?.period??row?.yearQuarter??'').trim();
          const m=period.match(/^(\d{3,4})\s*(?:[-/]?\s*)?[Qq季]\s*([1-4])\s*$/);
          if(m){let year=+m[1];if(year<1911)year+=1911;const q=+m[2];
            const ceiling=new Date().getFullYear()+1;
            if(year>=2000&&year<=ceiling)return {year,quarter:q,key:`${year}Q${q}`,stamp:year*10+q};
          }
          return oldQuarter(row);
        };fixed.__sz2691=true;root.fundamentalQuarterInfo=fixed;
      }
      const oldFund=root.fundamentals;
      if(typeof oldFund==='function'&&!oldFund.__sz2691){
        const supplemented=async function(code,market){
          const primary=await oldFund(code,market);
          const cov=root.fundamentalEpsPeriodCoverage?.(primary);
          const need=!cov?.yoy || !cov?.qoq || (cov?.count||0)<5;
          if(!need)return primary;
          const key=`f:${code}:${market}`,last=completed.get(key)||0;
          if(Date.now()-last<STALE)return primary;
          completed.set(key,Date.now());
          const merge=root.mergeFundamentalPayload;
          if(typeof merge!=='function')return primary;
          let out=primary;
          // 來源本身季度缺口時，依序嘗試相同原始研究接口更早的頁面。
          // 只補「有日期 + EPS」的季度；永不自行估計財報。
          for(const offset of [0,4,8]){
            const c=root.fundamentalEpsPeriodCoverage?.(out);
            if(c?.yoy && c?.qoq && (c.count||0)>=5)break;
            try{
              const qs=new URLSearchParams({mode:'fundamentals',research:'long',offset:String(offset),q:String(code),market:String(market||'')});
              const rsp=await root.fetch('/api/technical?'+qs,{cache:'no-store'});
              if(!rsp.ok)continue;
              const d=await rsp.json();if(!Array.isArray(d?.quarters))continue;
              out=merge(out,d);
            }catch(err){root.console?.warn?.('StockZone EPS 自動補查失敗',err)}
          }
          return out;
        };supplemented.__sz2691=true;root.fundamentals=supplemented;
      }
      const oldVal=root.valuation;
      if(typeof oldVal==='function'&&!oldVal.__sz2691){
        const retried=async function(code,market,price){
          const data=await oldVal(code,market,price);
          const has=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(+n)&&+n>0;
          if(has(data?.peerPs)&&has(data?.peerPb))return data;
          const key=`v:${code}:${market}`,last=completed.get(key)||0;
          if(Date.now()-last<STALE)return data;
          completed.set(key,Date.now());
          try{
            const qs=new URLSearchParams({action:'valuation',q:String(code),market:String(market||''),price:String(price??''),refresh:'1',_t:String(Date.now())});
            const controller=new AbortController();const stop=root.setTimeout(()=>controller.abort(),6500);
            let rsp;try{rsp=await root.fetch('/api/stock?'+qs,{cache:'no-store',signal:controller.signal})}finally{root.clearTimeout(stop)}
            if(!rsp.ok)return data;
            const fresh=await rsp.json();
            if(String(fresh?.code||fresh?.symbol||'').replace(/\.(?:TW|TWO)$/i,'').trim()!==String(code).replace(/\.(?:TW|TWO)$/i,'').trim())return data;
            const fields=['peerPs','peerPb','psPremiumPct','pbPremiumPct'];
            const out={...data};
            for(const f of fields){if((f==='peerPs'||f==='peerPb')?has(fresh[f]):Number.isFinite(+fresh[f])&&fresh[f]!==null){
              if(out[f]===null||out[f]===undefined||out[f]==='')out[f]=fresh[f];
            }}
            return out;
          }catch(err){root.console?.warn?.('StockZone PS/PB 同業資料自動補查失敗',err);return data}
        };retried.__sz2691=true;root.valuation=retried;
      }
    }
    function start(){layout();attachDataRepair();
      // 個股頁 / 玩法分析區塊可能延遲出現，觀察節點變更後只搬原有節點。
      let deadline=Date.now()+15000;
      const timer=root.setInterval(()=>{if(Date.now()>deadline){root.clearInterval(timer);return;}layout();attachDataRepair()},650);
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else root.setTimeout(start,0);
  }

  // v2.6.9.2 — 持股清單驅動的輕量操作介面。
  // 僅接上前台顯示、清單與本機審計紀錄；不重新計算 R1/V4/W3 或修改下單/報價接口。
  if (root && root.document && typeof root.setTimeout === 'function') {
    const doc=root.document;
    const $=id=>doc.getElementById(id);
    const HOLDINGS_KEY='stockzone_holdings_v2';
    const HISTORY_KEY='stockzone_auto_trade_plans_v2692';
    const LEGACY_PLAN_KEY='sz_resonance_lab_r1_plans';
    const PLAY_LABELS={short:'短期',mixed:'短波',swing:'波段','long-swing':'長波',long:'長期'};
    const ui={timer:0,ready:false,code:'',lastSummary:'',initializing:false};
    const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const txt=id=>String($(id)?.textContent||'').trim();
    const getCode=()=>txt('stockCodeLabel').match(/\b\d{4,6}\b/)?.[0]||'';
    const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
    const money=x=>{const num=Number(String(x||'').replace(/[,，]/g,''));return Number.isFinite(num)&&num>0?num:null};
    const localDay=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
    const numberLabel=n=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
    function loadJSON(key,fallback){try{const v=JSON.parse(root.localStorage.getItem(key)||'null');return v&&typeof v==='object'?v:fallback;}catch{return fallback;}}
    function writeJSON(key,v){try{root.localStorage.setItem(key,JSON.stringify(v));return true;}catch(e){root.console?.warn?.('StockZone 無法儲存本機紀錄',e);return false;}}
    function holdings(){const a=loadJSON(HOLDINGS_KEY,[]);return Array.isArray(a)?a:[];}
    function holdingFor(code){return holdings().find(x=>String(x.code||x.symbol||'')===String(code))||null;}
    function records(){return loadJSON(HISTORY_KEY,{});}
    function playName(){
      const candidate=txt('szV4Candidate')||txt('playMainPeriod');
      return candidate.match(/短期|短波|波段|長波|長期/)?.[0]||'待確認';
    }
    function allocation(){
      const p=txt('szV4Candidate');
      const m=p.match(/核心\s*(\d+(?:\.\d+)?)%\s*[／\/]\s*機動\s*(\d+(?:\.\d+)?)%/);
      return m?{core:+m[1],tactical:+m[2]}:null;
    }
    function targets(){
      const v=txt('szLabLive');
      const m=v.match(/主要\s*([\d,]+(?:\.\d+)?)/),s=v.match(/次要\s*([\d,]+(?:\.\d+)?)/);
      const pb=v.match(/回測\s*([\d,]+(?:\.\d+)?)/),def=v.match(/防守\s*([\d,]+(?:\.\d+)?)/);
      return {main:money(m?.[1]),secondary:money(s?.[1]),pullback:money(pb?.[1]),defense:money(def?.[1])};
    }
    // v2.7.0.5：使用近期分析原始輸出，不再讀取已失效的 overviewFinalNext/Risk DOM 節點。
    function getSignal(){
      const t=currentRecent();
      return t?.valid?t.trial?.action||'近期條件待確認':'等待近期分析';
    }
    function getRisk(){
      const t=currentRecent();
      if(!t?.valid)return t?.reason?`近期分析待補：${t.reason}`:'近期技術資料尚未完成，暫不判斷風險';
      const i=t.inputs||{},parts=[];
      if(Number.isFinite(i.rsi14)&&i.rsi14>=78)parts.push('RSI偏高，注意短期過熱');
      if(Number.isFinite(i.bollinger?.percentB)&&i.bollinger.percentB>1.08)parts.push('股價超出布林上軌，注意追高風險');
      if(Number.isFinite(i.macd?.hist)&&Number.isFinite(i.macd?.prevHist)&&i.macd.hist<0&&i.macd.hist<i.macd.prevHist)
        parts.push('MACD空方動能擴大');
      else if(Number.isFinite(i.macd?.hist)&&i.macd.hist<0)parts.push('MACD柱狀體仍偏弱');
      if(Number.isFinite(i.volatilityPct)&&i.volatilityPct>=6)parts.push('近期波動偏大');
      if(Number.isFinite(i.ret20Pct)&&i.ret20Pct<=-10)parts.push('近20日跌幅偏大，須觀察止跌');
      const missing=Array.isArray(t.missing)?t.missing:[];
      if(missing.length)parts.unshift(`近期資料未齊（${missing.slice(0,2).join('、')}），風險判讀有限`);
      if(!parts.length){
        const support=Number(i.support);
        return `近期未觸發既有過熱／轉弱警訊${Number.isFinite(support)&&support>0?`；仍須留意研究支撐 ${numberLabel(support)}`:''}`;
      }
      return parts.slice(0,3).join('；');
    }
    function baseline(){
      const b=$('szLabIntegrated')?.querySelector('.szli-tile b');
      const s=clean(b?.textContent);
      return /^(短期|短波|波段|長波|長期)$/.test(s)?s:null;
    }
    function currentRecent(){
      const code=getCode(),lab=root.StockZoneResonanceLab;
      if(code && (!lab?.liveRecentAnalysis||lab.liveRecentAnalysis.code!==code))lab?.loadRecentForCode?.(code);
      if(lab?.liveRecentAnalysis?.code!==code)return null;
      return lab.liveRecentAnalysis.result||null;
    }
    function recent(){return currentRecent()?.valid?currentRecent().mode:null;}
    function entryTiming(held=false,originalPlay=null){
      const r=currentRecent();if(!r)return null;
      const play=held?(originalPlay||baseline()):baseline();
      // Recent analysis is independent even before the five-year result arrives.
      if(held && r.valid){
        return {...r,held:true,originalFiveYearPlay:play||null,
          trial:{...r.trial,action:'持有中：不重新試單',shouldProbe:false,probePct:null,
            entryTiming:'維持原始玩法與進場紀錄；不重新提出首次試單',
            replenishTiming:r.trial?.replenishTiming,
            stopTiming:r.trial?.stopTiming}};
      }
      return {...r,held,originalFiveYearPlay:play||null};
    }
    function dataReady(){const n=getCode();return !!n&&money(txt('currentPrice'))!==null&&/短期|短波|波段|長波|長期/.test(txt('szV4Candidate')||txt('playMainPeriod'));}
    function analysis(){
      const code=getCode(),pos=allocation(),t=targets(),h=holdingFor(code),confirmed=records()[code]?.active?.explicitPlan===true;
      return {code,name:txt('stockName'),capturedAt:new Date().toISOString(),day:localDay(),
        referencePrice:money(txt('currentPrice')),play:playName(),allocation:pos,targets:t,
        signal:getSignal(),risk:getRisk(),baseline:baseline(),recent:recent(),
        timing:entryTiming(confirmed,records()[code]?.active?.initial?.play),
        holdingCost:money(h?.avgCost),holdingShares:money(h?.shares)};
    }
    function signature(x){return JSON.stringify([x.play,x.allocation,x.targets,x.signal,x.risk,x.baseline,x.recent,x.timing?.mode,x.timing?.status,x.timing?.trial?.action,x.timing?.trial?.probePct,x.timing?.asOf,x.referencePrice]);}
    function bridgePlan(code,a){
      const lab=root.StockZoneResonanceLab;
      if(typeof lab?.createSnapshot!=='function')return null;
      const all=loadJSON(LEGACY_PLAN_KEY,{}),current=all[code]||{plans:[],activeId:null};
      // 使用者先前手動保存的原始計畫一律不碰。
      if(current.activeId)return null;
      const key=Object.keys(PLAY_LABELS).find(k=>PLAY_LABELS[k]===a.play);
      if(!key||!a.referencePrice)return null;
      try{
        const plan=lab.createSnapshot({code,stockName:a.name,tradeDate:a.day,capturedAt:a.capturedAt,
          price:a.referencePrice,play:key,corePct:a.allocation?.core??null,
          main:a.targets.main,secondary:a.targets.secondary,pullback:a.targets.pullback,defense:a.targets.defense,
          source:'v2.6.9.2 持股清單自動追蹤；價格為當時顯示的參考報價，非實際成交價'});
        plan.id=`auto-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
        current.plans=Array.isArray(current.plans)?current.plans:[];
        current.plans.push(plan);current.activeId=plan.id;all[code]=current;
        return writeJSON(LEGACY_PLAN_KEY,all)?plan.id:null;
      }catch(e){root.console?.warn?.('原始交易計畫自動建立失敗',e);return null;}
    }
    function bridgeUpdate(code,a,planId){
      if(!planId)return;
      const lab=root.StockZoneResonanceLab;if(typeof lab?.appendUpdate!=='function')return;
      const all=loadJSON(LEGACY_PLAN_KEY,{}),row=all[code];
      if(!row||row.activeId!==planId)return;
      const idx=(row.plans||[]).findIndex(p=>p.id===planId);if(idx<0)return;
      const prior=row.plans[idx],last=prior.updates?.at(-1);
      if(last?.date===a.day)return; // 不頻繁新增同日的校正紀錄。
      try{
        row.plans[idx]=lab.appendUpdate(prior,{date:a.day,capturedAt:a.capturedAt,price:a.referencePrice,
          main:a.targets.main,secondary:a.targets.secondary,pullback:a.targets.pullback,
          play:prior.initial.play,corePct:a.allocation?.core??prior.initial.corePct});
        writeJSON(LEGACY_PLAN_KEY,all);
      }catch(e){root.console?.warn?.('自動保存校正失敗',e)}
    }
    function startTracking(code,kind){
      if(!holdingFor(code)||!dataReady()||getCode()!==code)return false;
      const all=records(),rec=all[code]||{archived:[]};
      if(rec.active)return true;
      const a=analysis();
      // 當前報價為加入持股當下可見價格，不能當作真實成交價。
      const planId=bridgePlan(code,a);
      rec.active={id:`${Date.now()}-${Math.floor(Math.random()*1e6)}`,startDate:a.day,createdAt:a.capturedAt,
        origin:kind,legacyPlanId:planId,initial:Object.freeze({...a}),last:a,updates:[],closedAt:null};
      all[code]=rec;return writeJSON(HISTORY_KEY,all);
    }
    function archive(code){
      const all=records(),rec=all[code];if(!rec?.active)return;
      const pid=rec.active?.legacyPlanId;
      rec.archived=Array.isArray(rec.archived)?rec.archived:[];
      rec.archived.push({...rec.active,closedAt:new Date().toISOString()});
      rec.active=null;
      if(rec.archived.length>50)rec.archived=rec.archived.slice(-50);
      // 對我們自己建立的自動計畫解除現行標記，歷史快照與校正照舊保留。
      if(pid){const old=loadJSON(LEGACY_PLAN_KEY,{}),row=old[code];
        if(row?.activeId===pid){row.activeId=null;writeJSON(LEGACY_PLAN_KEY,old);}}
      writeJSON(HISTORY_KEY,all);
    }
    function syncRecord(){
      // v2.6.9.10：加入清單與開啟股票不能建立交易；正式計畫改由「建立計畫」按鈕明確觸發。
      // 舊自動追蹤只留作歷史，不再背景自動更動。共振建議由持股清單計畫層更新。
      return;
      /* legacy auto-tracking disabled
      const code=getCode();if(!code||!dataReady())return;
      const h=holdingFor(code);
      if(!h)return;
      let all=records(),rec=all[code];
      if(!rec?.active){startTracking(code,'existing-holding-first-view');all=records();rec=all[code];}
      if(!rec?.active)return;
      const a=analysis(),prior=rec.active.last;
      if(signature(a)===signature(prior)&&a.day===prior?.day)return;
      // 一日一筆、日內以最新分析覆蓋「更新紀錄」，原始快照永不改動。
      const updates=Array.isArray(rec.active.updates)?rec.active.updates:[];
      if(updates.length&&updates[updates.length-1].day===a.day)updates[updates.length-1]=a;
      else updates.push(a);
      rec.active.updates=updates.slice(-120);
      rec.active.last=a;writeJSON(HISTORY_KEY,all);
      bridgeUpdate(code,a,rec.active.legacyPlanId);
      */
    }
    function labelFromRec(code){
      const r=records()[code]?.active,s=r?.explicitPlan&&r.status==='open'?r.last:null;
      return s?.play&&s?.signal?`計畫：${s.play}｜${s.signal}`:'尚未建立計畫';
    }
    function decorateHoldings(){
      const node=$('holdingsCards');if(!node)return;
      for (const row of node.querySelectorAll('.manage-stock.holding-row')) {
        const code=String(row.querySelector('[data-search-stock]')?.getAttribute('data-search-stock')||'');
        const host=row.querySelector('.manage-stock-main');if(!code||!host)continue;
        let badge=host.querySelector('.sz2692-list-brief');
        if(!badge){badge=doc.createElement('small');badge.className='sz2692-list-brief';host.appendChild(badge);}
        const text=labelFromRec(code);if(badge.textContent!==text)badge.textContent=text;
      }
    }
    function render(){
      const card=$('playStyleCard'),code=getCode();if(!card)return;
      const panel=ensurePanel(card);if(!panel)return;
      // 持股狀態直接顯示在玩法分析主題卡右上角，取代原 V4.3.1 裝飾標籤。
      const badge=$('szPlayHoldingBadge');
      const setHoldingBadge=(label,held,listed)=>{
        if(!badge)return;
        if(badge.textContent!==label)badge.textContent=label;
        badge.classList.toggle('szs-held',held);
        badge.classList.toggle('szs-listed',!held&&listed);
        badge.classList.toggle('szs-notheld',!held&&!listed);
        badge.setAttribute('aria-label',`持股狀態：${label}`);
      };
      if(!code){setHoldingBadge('尚未持有',false,false);panel.innerHTML='<div class="szs-loading">搜尋股票後，自動顯示操作建議。</div>';panel.dataset.state='';return;}
      const a=analysis(),h=holdingFor(code),listed=!!h,rec=records()[code]?.active,held=listed&&rec?.explicitPlan===true&&rec.status==='open';
      const status=held?'交易計畫中':listed?'清單中・未建計畫':'尚未持有';
      setHoldingBadge(status,held,listed);
      const valid=dataReady();
      // 已持有時鎖定當初玩法與初始配置；此欄僅解讀現有研究資訊，不更改交易計畫。
      const play=held&&rec?.explicitPlan&&rec?.initial?.play?rec.initial.play:(valid?a.play:'分析中');
      const t=a.timing,trial=t?.trial;
      const risk=getRisk();
      const target=(label,value)=>`<div class="szs-target"><small>${label}</small><strong>${Number.isFinite(value)?numberLabel(value):'—'}</strong></div>`;
      const targetPart=`<div class="szs-targets">${target('主要目標',a.targets?.main)}${target('次要目標',a.targets?.secondary)}${target('風險參考',a.targets?.defense)}</div>`;
      const recentCondition=t?.valid?t.mode:'資料不足';
      const preview=(label,value)=>`<div class="szs-recent-row"><span>${esc(label)}</span><b>${esc(value??'資料不足')}</b></div>`;
      // 僅刪除冗餘提示字句；保留原引擎產生的時機和判斷條件。
      const shorten=(value,tail)=>String(value||'—').replace(new RegExp('；?'+tail,'g'),'');
      const timingLine=`<div class="szs-timing-study"><div class="szs-recent-grid">
        ${preview('是否試單',t?(t.valid?trial?.action:'待補資料'):'資料讀取中')}
        ${preview('試單時機',t?(t.valid?trial?.entryTiming:'—'):'資料讀取中')}
        ${preview('補倉時機',t?(t.valid?shorten(trial?.replenishTiming,'不改原交易玩法'):'—'):'資料讀取中')}
        ${preview('停損時機',t?(t.valid?shorten(trial?.stopTiming,'非自動掛單'):'—'):'資料讀取中')}
      </div></div>`;
      const baseAlloc=held&&rec?.explicitPlan&&rec?.initial?.allocation?rec.initial.allocation:a.allocation;
      const hasAlloc=baseAlloc?.core!==null&&baseAlloc?.core!==undefined&&baseAlloc?.tactical!==null&&baseAlloc?.tactical!==undefined&&Number.isFinite(Number(baseAlloc.core))&&Number.isFinite(Number(baseAlloc.tactical));
      const allocText=hasAlloc?`核心 ${baseAlloc.core}%／機動 ${baseAlloc.tactical}%`:'核心／機動比例待確認';
      const advice=held
        ?{headline:'核心依原計畫・機動看訊號',detail:`${allocText}（原始配置）；後續調整以近期補倉／停損條件評估`}
        :listed
          ?{headline:'尚未建立交易計畫',detail:`${allocText}｜僅供研究，尚未鎖定配置`}
          :{headline:t?.valid&&trial?.action==='觀望'?'暫以觀望為主':'等待進場條件',detail:`${allocText}｜尚未建倉，僅供研究`};
      const pos=hasAlloc
        ?`<div class="szs-allocation">${held?'<small>原始配置</small>':''}<span>核心 <b>${esc(baseAlloc.core)}%</b></span><span class="szs-alloc-separator">／</span><span>機動 <b>${esc(baseAlloc.tactical)}%</b></span></div>`
        :'<div class="szs-allocation szs-allocation-pending">部位比例待確認</div>';
      const holdingsNote=listed?(h.avgCost&&h.shares?`持股 ${numberLabel(h.shares)} 股 · 均價 ${numberLabel(h.avgCost)}`:'均價與股數可到持股清單填寫'):'';
      const controls=listed?`<button type="button" class="szs-primary" id="szSimpleManage">查看持股清單</button>`:'';
      const key=JSON.stringify([code,listed,held,status,play,advice,risk,pos,targetPart,recentCondition,timingLine,holdingsNote,!!rec]);
      if(panel.dataset.state===key)return;
      panel.dataset.state=key;
      panel.innerHTML=`<div class="szs-pair"><div><small>建議玩法</small><strong>${esc(play)}</strong></div><div><small>持倉建議</small><strong class="szs-signal">${esc(advice.headline)}</strong><small class="szs-advice-detail">${esc(advice.detail)}</small></div></div>
        ${pos}${holdingsNote?`<div class="szs-holding-note">${esc(holdingsNote)}</div>`:''}
        ${targetPart}
        <p class="szs-risk"><b>風險提醒：</b>${esc(risk)}</p>
        <div class="szs-context"><b>近期適合模式：</b>${esc(recentCondition)}</div>
        ${timingLine}
        ${controls?`<div class="szs-buttons">${controls}</div>`:''}`;
      $('szSimpleManage')?.addEventListener('click',()=>doc.querySelector('[data-manage-jump="holdings"]')?.click());
    }
    function ensurePanel(card){
      let p=$('szSimpleTrade');if(!p){p=doc.createElement('section');p.id='szSimpleTrade';p.setAttribute('aria-label','簡易持股操作建議');
        const title=card.querySelector('.card-title');if(title)title.after(p);else card.prepend(p);}
      let details=$('sz2692ResearchDetails');if(!details){details=doc.createElement('details');details.id='sz2692ResearchDetails';
        details.innerHTML='<summary>查看詳細研究依據</summary><div>五年歷史回測、近期行情與共振研究資料</div>';
        const lab=card.querySelector(':scope > .sz-reslab');if(lab)lab.before(details);else card.appendChild(details);
      }
      return p;
    }
    const css=`
      #playStyleCard>.sz-v4-candidate{display:none!important}
      #playStyleCard>.sz-reslab{display:none!important}
      #playStyleCard>#sz2692ResearchDetails[open] ~ .sz-reslab{display:block!important}
      #playStyleCard .sz-reslab-actions,#playStyleCard .sz-reslab-controls,
      #playStyleCard .sz-reslab-dual,#playStyleCard #szLabEvaluation,
      #playStyleCard #szLabExport,#playStyleCard #szLabNewTrade{display:none!important}
      /* v2.7.0.5：持股狀態與技術分析日期標籤同一套中性 pill 規格。 */
      #playStyleCard .szs-status-badge,#playStyleCard .szs-status-badge.szs-held,
      #playStyleCard .szs-status-badge.szs-listed,#playStyleCard .szs-status-badge.szs-notheld{
        display:inline-flex!important;flex:0 0 auto!important;align-items:center!important;justify-content:center!important;
        width:auto!important;min-width:0!important;height:auto!important;max-width:60%!important;
        padding:4px 8px!important;border:1px solid #e6edf5!important;border-radius:20px!important;
        background:linear-gradient(180deg,#fff,#f8fbff)!important;box-shadow:none!important;
        color:#7c8da2!important;font:400 10px/1.2 Arial,'Microsoft JhengHei',sans-serif!important;
        letter-spacing:0!important;text-align:center;white-space:nowrap!important;
      }
      #szSimpleTrade{border:1px solid #dce6f4;background:linear-gradient(150deg,#f8fbff,#f2f6fe);border-radius:17px;
        padding:18px 20px;margin:11px 0 12px;color:#273d5d;line-height:1.55;min-width:0;overflow-wrap:anywhere}
      #szSimpleTrade .szs-pair{display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #dbe5f3;padding:1px 0 15px}
      #szSimpleTrade .szs-pair>div{min-width:0;padding:0 14px}
      #szSimpleTrade .szs-pair>div:first-child{padding-left:0;border-right:1px solid #dbe5f3}
      #szSimpleTrade .szs-pair>div:last-child{padding-right:0;padding-left:18px}
      #szSimpleTrade .szs-pair small{display:block;color:#6680a4;font-size:13px;font-weight:550;margin-bottom:5px}
      #szSimpleTrade .szs-pair strong{display:block;font-size:21px;line-height:1.35;font-weight:800;color:#1673e4;overflow-wrap:anywhere}
      #szSimpleTrade .szs-pair .szs-signal{font-size:16px;color:#263e66;font-weight:750}
      #szSimpleTrade .szs-pair .szs-advice-detail{display:block;margin:6px 0 0;font-size:11px;line-height:1.5;font-weight:500;color:#6680a4}
      #szSimpleTrade .szs-allocation{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;margin:0;
        padding:15px 0 13px;border-bottom:1px solid #dbe5f3;font-size:16px;font-weight:760;color:#273d5d}
      #szSimpleTrade .szs-allocation b{color:#1376e9;font-size:19px;font-weight:850}
      #szSimpleTrade .szs-allocation small{width:100%;color:#778da9;font-size:11px;font-weight:600}
      #szSimpleTrade .szs-allocation-pending{color:#788ba5;font-size:13px}
      #szSimpleTrade .szs-holding-note{font-size:12px;color:#637b9b;padding:9px 0 0}
      #szSimpleTrade .szs-targets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;
        border-bottom:1px solid #dbe5f3;padding:15px 0 14px}
      #szSimpleTrade .szs-target{min-width:0;padding:0 13px}
      #szSimpleTrade .szs-target:first-child{padding-left:0}
      #szSimpleTrade .szs-target+ .szs-target{border-left:1px solid #dbe5f3}
      #szSimpleTrade .szs-target small{display:block;font-size:12px;font-weight:550;color:#6680a4;line-height:1.5;margin-bottom:7px}
      #szSimpleTrade .szs-target strong{display:block;color:#233a61;font-size:20px;font-weight:800;
        line-height:1.4;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
      #szSimpleTrade .szs-risk{padding:12px 0;margin:0;border-bottom:1px solid #dbe5f3;color:#536d90;font-size:14px;line-height:1.7}
      #szSimpleTrade .szs-risk b{color:#263e63;font-weight:850;margin-right:5px}
      #szSimpleTrade .szs-context{padding:13px 0;margin:0;color:#536b8d;font-size:14px;line-height:1.65}
      #szSimpleTrade .szs-context b{color:#293f60;font-weight:850;margin-right:5px}
      #szSimpleTrade .szs-timing-study{margin:0;line-height:1.55}
      #szSimpleTrade .szs-recent-grid{display:grid;gap:0;margin:0;border:1px solid #e0e7f2;border-radius:10px;overflow:hidden}
      #szSimpleTrade .szs-recent-row{display:grid;grid-template-columns:minmax(105px,26%) minmax(0,1fr);
        align-items:stretch;min-width:0;font-size:13px;line-height:1.55}
      #szSimpleTrade .szs-recent-row+.szs-recent-row{border-top:1px solid #e2eaf5}
      #szSimpleTrade .szs-recent-row span{background:rgba(225,234,248,.48);color:#647c9c;
        padding:10px 12px;font-weight:560;min-width:0}
      #szSimpleTrade .szs-recent-row b{background:rgba(255,255,255,.46);color:#2c4264;
        padding:10px 13px;font-size:13px;font-weight:560;min-width:0;white-space:normal}
      #szSimpleTrade .szs-buttons{display:flex;gap:9px;margin-top:13px}
      #szSimpleTrade .szs-primary{border:0;border-radius:11px;background:#347ffc;color:#fff;min-height:42px;
        padding:9px 18px;font-size:13px;font-weight:800;cursor:pointer;flex:1}
      #szSimpleTrade .szs-primary:disabled{background:#c5d2e2;cursor:default}
      @media(max-width:720px){
        #szSimpleTrade{padding:14px 13px;margin:8px 0 12px}
        #szSimpleTrade .szs-pair>div{padding-right:10px}
        #szSimpleTrade .szs-pair>div:last-child{padding-left:12px}
        #szSimpleTrade .szs-pair small{font-size:12px}
        #szSimpleTrade .szs-pair strong{font-size:19px}
        #szSimpleTrade .szs-pair .szs-signal{font-size:14px}
        #szSimpleTrade .szs-allocation{font-size:14px}
        #szSimpleTrade .szs-allocation b{font-size:17px}
        #szSimpleTrade .szs-target{padding:0 7px}
        #szSimpleTrade .szs-target small{font-size:11px}
        #szSimpleTrade .szs-target strong{font-size:clamp(12px,3.25vw,17px)}
        #szSimpleTrade .szs-risk,#szSimpleTrade .szs-context{font-size:12px}
        #szSimpleTrade .szs-recent-row{grid-template-columns:minmax(90px,32%) minmax(0,1fr);font-size:12px}
        #szSimpleTrade .szs-recent-row span,#szSimpleTrade .szs-recent-row b{font-size:12px;padding:9px 8px}
      }
      body.dark #szSimpleTrade,body.dark-mode #szSimpleTrade{background:linear-gradient(150deg,#202e45,#1b273a);border-color:#344866;color:#e1eafa}
      body.dark #szSimpleTrade .szs-pair,body.dark-mode #szSimpleTrade .szs-pair,
      body.dark #szSimpleTrade .szs-targets,body.dark-mode #szSimpleTrade .szs-targets,
      body.dark #szSimpleTrade .szs-allocation,body.dark-mode #szSimpleTrade .szs-allocation,
      body.dark #szSimpleTrade .szs-risk,body.dark-mode #szSimpleTrade .szs-risk,
      body.dark #szSimpleTrade .szs-recent-row,body.dark-mode #szSimpleTrade .szs-recent-row{border-color:#3c4c64}
      body.dark #szSimpleTrade .szs-pair>div:first-child,body.dark-mode #szSimpleTrade .szs-pair>div:first-child,
      body.dark #szSimpleTrade .szs-target+.szs-target,body.dark-mode #szSimpleTrade .szs-target+.szs-target{border-color:#3c4c64}
      body.dark #szSimpleTrade .szs-pair strong,body.dark-mode #szSimpleTrade .szs-pair strong,
      body.dark #szSimpleTrade .szs-allocation b,body.dark-mode #szSimpleTrade .szs-allocation b{color:#72a9ff}
      body.dark #szSimpleTrade .szs-signal,body.dark-mode #szSimpleTrade .szs-signal,
      body.dark #szSimpleTrade .szs-target strong,body.dark-mode #szSimpleTrade .szs-target strong,
      body.dark #szSimpleTrade .szs-risk b,body.dark-mode #szSimpleTrade .szs-risk b,
      body.dark #szSimpleTrade .szs-context b,body.dark-mode #szSimpleTrade .szs-context b{color:#e2ecff}
      body.dark #szSimpleTrade .szs-recent-row span,body.dark-mode #szSimpleTrade .szs-recent-row span{background:#263852;color:#c1cfe5}
      body.dark #szSimpleTrade .szs-recent-row b,body.dark-mode #szSimpleTrade .szs-recent-row b{background:#1c2b40;color:#e1eafa}
      body.dark #szSimpleTrade .szs-recent-grid,body.dark-mode #szSimpleTrade .szs-recent-grid{border-color:#3c4c64}
      #sz2692ResearchDetails{margin:10px 0;color:#6680a6;font-size:12px}
      #sz2692ResearchDetails summary{cursor:pointer;padding:9px 12px;background:#f3f6fc;border:1px solid #e3eaf5;border-radius:10px}
      #sz2692ResearchDetails>div{padding:5px 12px;color:#8998ab}
      #holdingsCards .sz2692-list-brief{display:block;color:#627ba2;font-size:12px;font-weight:600;line-height:1.5;margin-top:4px}
      @media(max-width:720px){#szSimpleTrade{padding:13px 12px;margin:8px 0}
        #szSimpleTrade .szs-pair strong{font-size:18px}
        #szSimpleTrade .szs-pair strong.szs-signal{font-size:13px}}
    `;
    function addDeveloperTools(){
      const body=doc.querySelector('#szDeveloperMode > .sz-fold-body');if(!body||$('sz2692DevExports'))return;
      const section=doc.createElement('section');section.id='sz2692DevExports';
      section.style.cssText='padding:12px 0;margin-top:15px;border-top:1px solid #dfe6f0;color:#405776;font-size:13px';
      section.innerHTML='<b>個股分析研究資料</b><div style="margin:9px 0;display:flex;gap:8px;flex-wrap:wrap">'
        +'<button type="button" id="sz2692ExportStudy">匯出共振研究</button>'
        +'<button type="button" id="sz2692ExportRecords">匯出持股追蹤紀錄</button></div>'
        +'<small style="color:#7989a0">匯出的僅是此瀏覽器內可取得的紀錄。</small>';
      body.appendChild(section);
      $('sz2692ExportStudy')?.addEventListener('click',()=>$('szLabExport')?.click());
      $('sz2692ExportRecords')?.addEventListener('click',()=>{
        const blob=new Blob([JSON.stringify({version:'2.6.9.2',exportedAt:new Date().toISOString(),
          autoTracking:records()},null,2)],{type:'application/json;charset=utf-8'});
        const url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;
        a.download=`StockZone_持股追蹤_${localDay()}.json`;doc.body.appendChild(a);a.click();a.remove();
        root.setTimeout(()=>URL.revokeObjectURL(url),1200);
      });
    }
    function sync(){
      const code=getCode();if(!code)return;
      if(ui.code!==code){ui.code=code;ui.lastSummary='';}
      syncRecord();render();decorateHoldings();
    }
    function queue(){root.clearTimeout(ui.timer);ui.timer=root.setTimeout(sync,75)}
    function onNativeHolding(){root.setTimeout(queue,120);}
    function onNativeDelete(){root.setTimeout(queue,120);}
    function init(){
      if(ui.ready)return;
      const card=$('playStyleCard');if(!card)return;
      ui.ready=true;
      const style=doc.createElement('style');style.id='sz2692CompactStyle';style.textContent=css;(doc.head||doc.documentElement).appendChild(style);
      ensurePanel(card);addDeveloperTools();
      $('addHoldingBtn')?.addEventListener('click',onNativeHolding,{capture:true});
      $('holdingsCards')?.addEventListener('click',onNativeDelete,{capture:true});
      const obs=root.MutationObserver;
      if(obs){
        for(const id of ['szV4Candidate','playMainPeriod','szLabLive','szLabCandidate','szLabIntegrated','stockCodeLabel','currentPrice','addHoldingBtn']){
          const el=$(id);if(el)new obs(queue).observe(el,{subtree:true,childList:true,characterData:true});
        }
        const list=$('holdingsCards');if(list)new obs(queue).observe(list,{childList:true});
      }
      doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)queue()});
      root.addEventListener('storage',e=>{if([HOLDINGS_KEY,HISTORY_KEY].includes(e.key))queue()});
      // 保險輪詢僅確認原頁非同步初次載入；後續以 MutationObserver 更新。
      let n=0;const id=root.setInterval(()=>{queue();if(++n>=20)root.clearInterval(id)},850);
      queue();
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init,{once:true});else root.setTimeout(init,0);
  }

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StockZoneResonanceLab = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';
  const VERSION = 'resonance-lab-r1.0';
  const HORIZONS = [3, 5, 10, 20, 40, 60];
  const STRATEGIES = Object.freeze([
    {key:'short',label:'短期',days:5,targetPct:5,stopPct:3.5},
    {key:'mixed',label:'短波',days:15,targetPct:10,stopPct:7},
    {key:'swing',label:'波段',days:20,targetPct:15,stopPct:9},
    {key:'long-swing',label:'長波',days:40,targetPct:23,stopPct:14},
    {key:'long',label:'長期',days:60,targetPct:30,stopPct:18}
  ]);
  const num = v => v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? +v : null);
  const valid = v => num(v) !== null && +v > 0;
  const round = (v,d=2) => Number.isFinite(v) ? +v.toFixed(d) : null;
  const pct = (a,b) => valid(a)&&valid(b) ? (a/b-1)*100 : null;
  function dateKey(raw){
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'number') return new Date(raw).toISOString().slice(0,10);
    const str = String(raw).trim();
    const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    const d = new Date(str);return Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10):'';
  }
  function cleanBars(raw){
    const errors=[],out=[],duplicates=new Set();
    for(const row of Array.isArray(raw)?raw:[]){
      const date=dateKey(row?.date ?? row?.tradeDate ?? row?.trade_date),close=num(row?.close),high=num(row?.high),low=num(row?.low),open=num(row?.open);
      if(!date||!valid(open)||!valid(close)||!valid(high)||!valid(low)||high<low||close>high*1.0001||close<low*.9999||open>high*1.0001||open<low*.9999){errors.push(`異常OHLC：${date||'無日期'}`);continue}
      const normalized={date,open,high,low,close};
      if(duplicates.has(date)){errors.push(`重複日期：${date}`);continue}
      duplicates.add(date);out.push(normalized);
    }
    out.sort((a,b)=>a.date.localeCompare(b.date));
    // 極端跳空可能是未校正股票分割、減資或其他公司行動：先停止績效報表，不能直接當成報酬。
    const jumps=[];
    for(let i=1;i<out.length;i++){
      const change=pct(out[i].close,out[i-1].close);
      if(Math.abs(change)>35)jumps.push({date:out[i].date,changePct:round(change)});
    }
    return {bars:out,errors,largeJumps:jumps,valid:out.length>=150 && !jumps.length && !errors.length};
  }
  function avg(values){return values.length?values.reduce((s,v)=>s+v,0)/values.length:null}
  function median(arr){if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2}
  function pastAvg(bars,i,n){if(i+1<n)return null;let total=0;for(let j=i-n+1;j<=i;j++)total+=bars[j].close;return total/n}
  function contextAt(bars,i){
    // 只讀取 <= i 的已公開日線；不允許讀取 i+1 的任何價量來推導訊號。
    if(i<119||i>=bars.length)return {valid:false,reason:'需要至少120根進場前日K'};
    const b=bars[i],ma20=pastAvg(bars,i,20),ma60=pastAvg(bars,i,60),ma120=pastAvg(bars,i,120);
    const near=bars.slice(i-19,i+1),range60=bars.slice(i-59,i+1);
    const max20=Math.max(...near.map(x=>x.high)),min20=Math.min(...near.map(x=>x.low));
    const high60=Math.max(...range60.map(x=>x.high)),low60=Math.min(...range60.map(x=>x.low));
    const vol=avg(near.map(x=>100*(x.high-x.low)/x.close));
    return {valid:true,date:b.date,price:b.close,ma20:round(ma20),ma60:round(ma60),ma120:round(ma120),volatilityPct:round(vol),
      high20:round(max20),low20:round(min20),high60:round(high60),low60:round(low60),
      ret5Pct:round(pct(b.close,bars[i-5].close)),ret20Pct:round(pct(b.close,bars[i-20].close)),
      above20:b.close>ma20,above60:b.close>ma60,above120:b.close>ma120,
      fromHigh20Pct:round(pct(b.close,max20)),fromLow60Pct:round(pct(b.close,low60))};
  }
  function entryCandidate(bars,index){
    const c=contextAt(bars,index);if(!c.valid)return {...c,key:null};
    // V1 研究性進場視角：偏好波段。長期必須有當時已公布的基本面，因此此價格版不自動推長期。
    const reasons=[];let key='swing';
    if(c.above20&&c.above60&&c.above120&&c.ret20Pct>=7&&c.volatilityPct<4&&c.fromHigh20Pct>=-5){
      key='long-swing';reasons.push('多週期上升趨勢、波動相對平穩');
    }else if(c.volatilityPct>=6 || (c.ret5Pct>=9&&c.fromHigh20Pct>=-3)){
      key='short';reasons.push('高波動或急漲接近短期高點');
    }else if((c.ret5Pct>=4 && c.fromHigh20Pct>=-6) || (c.above20&&!c.above60)){
      key='mixed';reasons.push('短線動能明顯，但中期結構尚未完全跟上');
    }else{reasons.push(c.above60?'中期結構仍支持波段管理':'尚無足夠證據偏離預設波段');}
    const profile={short:20,mixed:35,swing:55,'long-swing':70,long:85};
    return {...c,key,label:STRATEGIES.find(x=>x.key===key)?.label||'波段',corePct:profile[key],
      reason:reasons.join('；'),method:'僅價格研究候選（未使用歷史基本面、財報或W3）'};
  }
  function simulateTrade(bars,index,strategy,costPct=.5){
    // i 日產生研究候選，i+1 日開盤執行；不能使用 i 日收盤成交。
    const entry=bars[index+1];
    if(!entry||!valid(entry.open)||index+strategy.days>=bars.length)return null;
    const entryPrice=entry.open,top=entryPrice*(1+strategy.targetPct/100),floor=entryPrice*(1-strategy.stopPct/100);
    let exitIndex=null,exitPrice=null,why='期限到期',mae=0,mfe=0;
    for(let day=index+1;day<=index+strategy.days;day++){
      const bar=bars[day];
      mae=Math.min(mae,pct(bar.low,entryPrice));mfe=Math.max(mfe,pct(bar.high,entryPrice));
      // 同一日上下目標都觸及：保守採止損先達。缺任何日K便拒絕評估。
      if(bar.open<=floor){exitIndex=day;exitPrice=bar.open;why='跳空止損';break}
      if(bar.open>=top){exitIndex=day;exitPrice=bar.open;why='跳空達標';break}
      if(bar.low<=floor){exitIndex=day;exitPrice=floor;why=bar.high>=top?'同日雙觸及→保守止損':'止損';break}
      if(bar.high>=top){exitIndex=day;exitPrice=top;why='達標';break}
    }
    if(exitIndex===null){exitIndex=index+strategy.days;exitPrice=bars[exitIndex].close}
    return {signalDate:bars[index].date,entryDate:entry.date,entryPrice,exitDate:bars[exitIndex].date,exitPrice,
      holdingBars:exitIndex-index,reason:why,netPct:round(pct(exitPrice,entryPrice)-costPct),maePct:round(mae),mfePct:round(mfe)};
  }
  function summarise(trades){
    const rs=trades.map(t=>t.netPct),negative=trades.map(t=>t.maePct);return {count:trades.length,
      winPct:round(100*trades.filter(x=>x.netPct>0).length/Math.max(1,trades.length),1),
      avgPct:round(avg(rs)),medianPct:round(median(rs)),avgMaePct:round(avg(negative)),
      worstMaePct:round(trades.length?Math.min(...negative):null),
      avgHoldDays:round(avg(trades.map(x=>x.holdingBars)),1)};
  }
  function backtestPriceBaselines(input,{warmup=120,stride=60,costPct=.5}={}){
    const normalized=cleanBars(input),bars=normalized.bars;
    if(!normalized.valid)return {valid:false,reason:normalized.largeJumps.length?'偵測到超過35%的收盤跳變，請先查核分割／減資／增資與還原價格。':`有效日K不足150根或包含異常欄位`,coverage:{days:bars.length,from:bars[0]?.date,to:bars.at(-1)?.date,errors:normalized.errors.slice(0,5),largeJumps:normalized.largeJumps}};
    const results=STRATEGIES.map(s=>({strategy:s,rows:[]}));const candidates=[];
    const start=Math.max(119,warmup-1),end=bars.length-1-Math.max(...STRATEGIES.map(s=>s.days));
    for(let i=start;i<=end;i+=Math.max(1,stride)){
      const candidate=entryCandidate(bars,i);candidates.push({date:bars[i].date,key:candidate.key,label:candidate.label,reason:candidate.reason});
      for(const result of results){const trade=simulateTrade(bars,i,result.strategy,costPct);if(trade)result.rows.push(trade)}
    }
    // 使用同一批進場日比較「依當時價格選玩法」與「永遠波段」。
    // 研究候選只看決策日以前的120根K；前70%與後30%獨立列示，避免把全樣本好壞冒充樣本外成效。
    const byStrategy=new Map(results.map(r=>[r.strategy.key,r]));
    const candidateTrades=[],swingTrades=[];
    for(let j=0;j<candidates.length;j++){
      const selected=byStrategy.get(candidates[j].key)?.rows[j],swing=byStrategy.get('swing')?.rows[j];
      if(selected&&swing){candidateTrades.push(selected);swingTrades.push(swing)}
    }
    const cutoff=Math.max(1,Math.floor(candidateTrades.length*.7));
    const pair=(start,end)=>{
      const chosen=summarise(candidateTrades.slice(start,end)),always=summarise(swingTrades.slice(start,end));
      return {candidate:chosen,alwaysSwing:always,meanNetLiftPct:round(chosen.avgPct-always.avgPct)};
    };
    const policyComparison={whole:pair(0,candidateTrades.length),earlier:pair(0,cutoff),later:pair(cutoff,candidateTrades.length),
      splitDate:candidates[cutoff]?.date||null,
      byStyle:Object.fromEntries(STRATEGIES.map(s=>[s.key,candidates.filter(c=>c.key===s.key).length]))};
    return {valid:true,version:VERSION,method:'價格基準策略對照，非 V4.3.1／共振歷史重算',
      assumptions:{signal:'前一日收盤資訊',entry:'次日開盤',fill:'同日雙觸及以先停損保守處理；跳空以開盤價',costPct,stride},
      coverage:{days:bars.length,from:bars[0].date,to:bars.at(-1).date,signals:candidates.length,warnings:normalized.errors.slice(0,5)},
      candidates,policyComparison,results:results.map(x=>({strategy:x.strategy,stats:summarise(x.rows),trades:x.rows}))};
  }
  function reachabilityProfile(input,currentPrice,targetPrice,{stride=60}={}){
    const normalized=cleanBars(input),bars=normalized.bars;
    if(!normalized.valid)return {valid:false,reason:'日K有效性或公司行動檢查未通過'};
    if(!valid(currentPrice)||!valid(targetPrice))return {valid:false,reason:'目前價格或目標價缺失'};
    const distancePct=pct(targetPrice,currentPrice),direction=distancePct>=0?'up':'down';
    if(Math.abs(distancePct)<.2)return {valid:false,reason:'與現價距離過小，沒有辨識度'};
    const periods=[],maxH=Math.max(...HORIZONS);
    for(let i=119;i+maxH<bars.length;i+=Math.max(1,stride)){
      const start=bars[i].close,level=start*(1+distancePct/100);
      let first=null;
      for(let j=1;j<=maxH;j++){
        const b=bars[i+j];
        if(direction==='up'?b.high>=level:b.low<=level){first=j;break}
      }
      periods.push({signalDate:bars[i].date,firstTouchDay:first});
    }
    if(!periods.length)return {valid:false,reason:'觀察區間不足'};
    const reached=periods.filter(x=>x.firstTouchDay!==null).map(x=>x.firstTouchDay);
    return {valid:true,version:VERSION,method:'歷史同距離幅度到達率（非共振公式歷史預測）',direction,
      distancePct:round(distancePct),sample:periods.length,stride,medianFirstTouchDay:round(median(reached),1),
      horizons:HORIZONS.map(days=>({days,hit:periods.filter(x=>x.firstTouchDay!==null&&x.firstTouchDay<=days).length,
        hitPct:round(100*periods.filter(x=>x.firstTouchDay!==null&&x.firstTouchDay<=days).length/periods.length,1)}))};
  }
  function createSnapshot({code,stockName,tradeDate,capturedAt,price,play,corePct,main,secondary,pullback,defense,source='V4.3.1'}={}){
    const asof=dateKey(tradeDate),p=num(price),core=num(corePct);
    if(!code||!asof||!valid(p)||!play)throw new Error('建立計畫需要代號、資料日期、現價與玩法');
    const priceOrNull=v=>valid(v)?round(+v,4):null;
    return {schema:1,modelVersion:VERSION,source,code:String(code),stockName:String(stockName||''),tradeDate:asof,
      capturedAt:String(capturedAt||new Date().toISOString()),initial:{price:priceOrNull(p),play:String(play),corePct:core,
        tacticalPct:core===null?null:100-core,main:priceOrNull(main),secondary:priceOrNull(secondary),pullback:priceOrNull(pullback),defense:priceOrNull(defense)},
      updates:[]};
  }
  function appendUpdate(snapshot,now){
    if(!snapshot?.initial)throw new Error('缺少原始計畫');
    const value={date:dateKey(now.date),capturedAt:String(now.capturedAt||new Date().toISOString()),
      price:valid(now.price)?round(+now.price,4):null,main:valid(now.main)?round(+now.main,4):null,
      secondary:valid(now.secondary)?round(+now.secondary,4):null,pullback:valid(now.pullback)?round(+now.pullback,4):null,
      corePct:Number.isFinite(+now.corePct)?+now.corePct:null,play:String(now.play||'')};
    if(!value.date)throw new Error('缺少本次更新日期');
    return {...snapshot,updates:[...(snapshot.updates||[]),value]};
  }
  function evaluateSnapshot(snapshot,raw){
    const normalized=cleanBars(raw),bars=normalized.bars,initial=snapshot?.initial;
    if(!snapshot?.tradeDate||!initial||normalized.largeJumps.length)return {valid:false,reason:'原始快照或股價資料不可驗證（含未校正跳變）'};
    // 僅以建立計畫之後的K線評估；同日出現的價格不能視為事前已知。
    const forward=bars.filter(b=>b.date>snapshot.tradeDate);
    const levels=[['main',initial.main,'up'],['secondary',initial.secondary,'up'],['pullback',initial.pullback,'down'],['defense',initial.defense,'down']];
    const results=levels.map(([key,target,direction])=>{
      if(!valid(target))return {key,status:'no-target',horizons:[]};
      const first=forward.findIndex(b=>direction==='up'?b.high>=target:b.low<=target);
      const horizons=HORIZONS.map(h=>({days:h,status:first>=0&&first<h?'hit':forward.length>=h?'miss':'pending'}));
      return {key,target,direction,firstTouchDay:first<0?null:first+1,firstTouchDate:first<0?null:forward[first].date,horizons};
    });
    return {valid:true,tradeDate:snapshot.tradeDate,observedDays:forward.length,results,
      caveat:'只驗證價格是否在期限內觸及；不宣稱逐日路徑、盤中觸及先後或真實可成交價格。'};
  }
  // 第二階段獨立的「研究性持倉配置」；與原R1、V4.3、W3三套既有公式分離。
  // 百分比代表預定投入資金額；三者合計100。只使用截至當天已知的價格脈絡。
  function proposeAllocation({play='swing',baseCorePct=null,context=null,market='unknown'}={}){
    const profile={short:{base:20,min:10,max:35},mixed:{base:35,min:20,max:50},
      swing:{base:55,min:40,max:70},'long-swing':{base:70,min:55,max:85},long:{base:85,min:70,max:95}};
    const p=profile[play],c=context;
    if(!p)return {valid:false,reason:['未知玩法，停止配置建議']};
    if(!c?.valid||!valid(c.price)||!valid(c.ma20)||!valid(c.ma60)||!valid(c.ma120))
      return {valid:false,reason:['需要至少120日且通過資料檢核的日K']};
    const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const roundOne=v=>Math.round(v*10)/10;
    const base=clamp(Number.isFinite(+baseCorePct)&&baseCorePct!==null?+baseCorePct:p.base,p.min,p.max);
    let delta=0;const reason=[];
    if(c.price<c.ma20){delta-=5;reason.push('跌破MA20，核心保守下修5%');}
    if(c.price<c.ma60){delta-=5;reason.push('跌破MA60，核心再下修5%');}
    if(c.volatilityPct>=6){delta-=5;reason.push('近期日內波動偏高，核心再下修5%');}
    if(c.price>=c.ma20&&c.price>=c.ma60&&c.ret20Pct>0&&c.volatilityPct<5){
      delta+=5;reason.push('中短期趨勢一致，核心上修5%');}
    const coreBeforeW3=clamp(base+clamp(delta,-15,5),p.min,p.max);
    // 減少核心後移到現金，不能機械地把風險轉成更大的機動倉。
    let core=coreBeforeW3,tactical=Math.min(100-core,100-base);
    if(c.volatilityPct>=6){tactical=Math.max(0,tactical-10);reason.push('高波動，額外保留10%現金');}
    if(c.price<c.ma20&&c.price<c.ma60){tactical*=.8;reason.push('雙均線弱勢，縮小機動倉');}
    if(market==='warning'){
      core*=['short','mixed'].includes(play)?.75:play==='swing'?.85:1;
      tactical*=.5;reason.push('W3預警：壓縮機動；長波/長期保留核心');
    }else if(market==='off'){
      if(['short','mixed'].includes(play)){core=0;tactical=0;reason.push('W3 OFF：短期／短波全數退出');}
      else if(play==='swing'){core*=.5;tactical=0;reason.push('W3 OFF：波段清機動並保留一半研究核心（待回測）');}
      else{core*=.85;tactical=0;reason.push('W3 OFF：長波／長期清機動、保留85%研究核心（待回測）');}
    }else if(market==='on'){reason.push('W3多頭：依價格結構分配核心與機動');}
    else{reason.push('W3尚未確認：以上僅是價格研究配置，不可視為完整風控建議');}
    core=roundOne(clamp(core,0,100));tactical=roundOne(clamp(tactical,0,100-core));
    const cash=roundOne(Math.max(0,100-core-tactical));
    return {valid:true,modelVersion:'allocation-study-r1.5',play,baseCorePct:base,
      corePct:core,tacticalPct:tactical,cashPct:cash,market,
      requiresW3:market==='unknown',reason};
  }
  return {VERSION,HORIZONS,STRATEGIES,cleanBars,contextAt,entryCandidate,simulateTrade,backtestPriceBaselines,reachabilityProfile,createSnapshot,appendUpdate,evaluateSnapshot,proposeAllocation};
});
