const $=id=>document.getElementById(id);

function setText(id,value){
  const el=$(id); if(el) el.textContent=value ?? "—";
}
let statusTimer=null;
function setStatus(msg,error=false){
  const el=$("statusText"); if(!el)return;
  clearTimeout(statusTimer);
  const loading=/^(?:搜尋股票|搜尋目標價|搜尋新聞|搜尋摘要相關新聞)(?:…|\.\.\.)?$/.test(String(msg||""));
  el.innerHTML=loading?`${String(msg).replace(/…|\.\.\.$/,"")}<span class="search-wave" aria-hidden="true"><i>•</i><i>•</i><i>•</i></span>`:msg;
  el.classList.toggle("error",error);el.classList.add("show");
  if(!loading){const ms=msg==="請先搜尋股票"?1500:(error?4200:1800);statusTimer=setTimeout(()=>el.classList.remove("show"),ms)}
}
function fmt(n){
  const x=Number(n);
  if(!Number.isFinite(x)) return "—";
  return x.toLocaleString("zh-TW",{maximumFractionDigits:2});
}
async function readJson(res,label){
  const text=await res.text();
  let data;
  try{data=JSON.parse(text)}catch{throw new Error(`${label}回傳格式錯誤`)}
  if(!res.ok || data?.ok===false) throw new Error(data?.error||`${label}查詢失敗（HTTP ${res.status}）`);
  return data;
}
async function quote(query){
  async function once(timeoutMs){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      return await readJson(
        await fetch(`/api/quote?q=${encodeURIComponent(query)}`,{
          cache:"no-store",signal:controller.signal
        }),
        "股價"
      );
    }finally{clearTimeout(timer)}
  }
  try{
    return await once(15000);
  }catch(e){
    const retryable=e?.name==="AbortError"||/逾時|Failed to fetch|network|fetch/i.test(String(e?.message||""));
    if(!retryable)throw e;
    await new Promise(r=>setTimeout(r,350));
    try{
      return await once(20000);
    }catch(e2){
      if(e2?.name==="AbortError")throw new Error("股價查詢逾時");
      throw e2;
    }
  }
}

function shortStockName(name){
  let s=String(name||"").trim();
  if(!s)return s;
  s=s.replace(/股份有限公司$/,"").replace(/有限公司$/,"").replace(/公司$/,"");
  // UI display name: remove common legal/industry suffixes rather than maintaining one-off names.
  s=s.replace(/科技$/,"");
  return s;
}

async function disposal(query,market,price){
  const params=new URLSearchParams({q:String(query||""),market:String(market||""),price:String(price??"")});
  return await readJson(await fetch(`/api/disposal?${params.toString()}`,{cache:"no-store"}),"處置資料");
}
function disposalToneClass(state){return state==="處置中"?"disposal-state-danger":state==="注意股票"||state==="注意股"?"disposal-state-watch":""}
function disposalDots(id,count,total,dangerAt){
  const host=$(id);if(!host)return;const n=Math.max(0,Math.min(total,Number(count)||0));host.innerHTML=Array.from({length:total},(_,i)=>`<span class="disposal-dot${i<n?(n>=dangerAt?" danger":" on"):""}"></span>`).join("");
}
function disposalTag(id,count,total){const el=$(id);if(!el)return;const left=Math.max(0,total-(Number(count)||0));el.textContent=left===0?"達標":left===1?"警戒":"安全";el.style.background=left===0?"rgba(255,95,111,.2)":left===1?"rgba(255,201,67,.18)":"#34475a";el.style.color=left===0?"#ff7b87":left===1?"#ffd04d":"#edf4fa"}
function resetDisposal(msg="搜尋股票後判讀"){
  setText("disposalState","--");setText("disposalStateNote",msg);setText("disposalRisk","--");setText("disposalRiskNote","--");setText("disposalRiskDistance","--");
  [["disposalDots3","disposalCount3","disposalTag3",3],["disposalDots10","disposalCount10","disposalTag10",6],["disposalDots30","disposalCount30","disposalTag30",12]].forEach(([d,c,t,n])=>{disposalDots(d,0,n,n);setText(c,`-- / ${n}`);setText(t,"--")});
  const reason=$('disposalReasonList');if(reason)reason.querySelectorAll('div').forEach(x=>x.classList.remove('active'));setText("disposalReasonNote","尚未取得今日注意資訊");
  setText("disposalPriceLine","--");setText("disposalPriceLineGap","僅價格款估算");setText("disposalExVolume","資料判讀");setText("disposalExTurnover","資料判讀");setText("disposalExEtf","不適用");setText("disposalExOther","不適用");setText("disposalSummary",msg);setText("overviewDisposalState","--");setText("overviewDisposalRisk","處置風險 --");
}
function renderDisposal(d){
  const panel=$("disposal");if(panel){panel.classList.remove("disposal-state-watch","disposal-state-danger");const c=disposalToneClass(d.state);if(c)panel.classList.add(c)}
  setText("disposalState",d.state||"正常");setText("disposalStateNote",d.stateNote||"目前未列為注意股票");setText("disposalRisk",d.risk||"低");setText("disposalRiskNote",d.riskNote||"--");setText("disposalRiskDistance",d.riskDistance||"--");
  const counts=d.counts||{};const c3=Number(counts.d3)||0,c10=Number(counts.d10)||0,c30=Number(counts.d30)||0;
  disposalDots("disposalDots3",c3,3,3);disposalDots("disposalDots10",c10,6,6);disposalDots("disposalDots30",c30,12,12);
  setText("disposalCount3",`${c3} / 3`);setText("disposalCount10",`${c10} / 6`);setText("disposalCount30",`${c30} / 12`);disposalTag("disposalTag3",c3,3);disposalTag("disposalTag10",c10,6);disposalTag("disposalTag30",c30,12);
  const keys=new Set(Array.isArray(d.reasonKeys)?d.reasonKeys:[]), rows=$('disposalReasonList')?.querySelectorAll('div')||[];rows.forEach((x,i)=>x.classList.toggle('active',keys.has(["price","volume","turnover","concentration","valuation","margin","sbl"][i])));setText("disposalReasonNote",d.reasonText||"今日未發布注意資訊");
  const ex=d.exceptions||{};const setEx=(id,val,tone)=>{const e=$(id);if(!e)return;e.textContent=val||"資料不足";e.classList.remove("good","watch","bad");if(tone)e.classList.add(tone)};setEx("disposalExVolume",ex.volume?.label,ex.volume?.tone);setEx("disposalExTurnover",ex.turnover?.label,ex.turnover?.tone);setEx("disposalExEtf",ex.etf?.label,ex.etf?.tone);setEx("disposalExOther",ex.other?.label,ex.other?.tone);
  if(d.priceLine&&Number.isFinite(Number(d.priceLine.value))){setText("disposalPriceLine",`${fmt(d.priceLine.value)} 元`);setText("disposalPriceLineGap",d.priceLine.note||"僅價格款估算");const e=$("disposalPriceLine");if(e){e.classList.remove("good","watch","bad");e.classList.add(d.priceLine.tone||"")}}else{setText("disposalPriceLine","資料不足");setText("disposalPriceLineGap",d.priceLine?.note||"無法估算")}
  setText("disposalSummary",d.summary||"--");setText("overviewDisposalState",d.state||"正常");setText("overviewDisposalRisk",`處置風險 ${d.risk||"低"}`);
}
async function loadDisposal(stock){
  resetDisposal("讀取官方注意／處置資料中…");
  try{const code=stock?.code||stock?.symbol||"",price=Number(stock?.last??stock?.price??stock?.regularMarketPrice);const d=await disposal(code,stock?.market||stock?.marketLabel||"",price);renderDisposal(d)}catch(e){console.warn("處置資料更新失敗",e);resetDisposal(`處置資料暫時無法取得：${e.message}`)}
}
async function technical(query,market){
  const params=new URLSearchParams({q:String(query||""),market:String(market||"")});
  return await readJson(await fetch(`/api/technical?${params.toString()}`,{cache:"no-store"}),"技術資料");
}
function technicalFmt(n,suffix=""){const x=Number(n);return Number.isFinite(x)?`${x.toLocaleString("zh-TW",{maximumFractionDigits:2})}${suffix}`:"--"}
function technicalVolumeFmt(n){const x=Number(n);if(!Number.isFinite(x))return "--";if(Math.abs(x)>=10000){const w=x/10000;return `${w.toLocaleString("zh-TW",{maximumFractionDigits:w>=100?0:1})}萬`;}return x.toLocaleString("zh-TW",{maximumFractionDigits:0});}
function technicalMetrics(id,items){const el=$(id);if(!el)return;el.classList.add("tech-metrics");el.style.setProperty("--cols",String(items.length));el.innerHTML=items.map(([label,value])=>`<span class="tech-metric"><span>${label}</span><b>${value}</b></span>`).join("")}
function techTone(el,tone){if(!el)return;el.classList.remove("tone-good","tone-watch","tone-bad","tone-neutral");el.classList.add(`tone-${tone||"neutral"}`)}
function techSet(id,text,tone){const el=$(id);if(el){el.textContent=text||"--";if(tone)techTone(el,tone)}}
async function loadTechnical(data){
  const code=data?.code||data?.symbol||"",market=data?.market||data?.marketLabel||"";
  try{
    const t=await technical(code,market),a=t.analysis||{};
    setText("technicalSource",`Yahoo｜${t.updatedAt||"--"}`);
    techSet("techState",a.overall?.state||"--",a.overall?.tone); setText("techScore",a.overall?.score??"--"); setText("techHeadline",a.overall?.headline||"--");
    const overviewState=a.overall?.state||"--", overviewScore=a.overall?.score;
    setText("overviewTechnicalState",`${overviewState}${Number.isFinite(Number(overviewScore))?` ${overviewScore}分`:""}`);
    setText("overviewTechnicalNote",a.overall?.headline||a.ma?.conclusion||"--");
    techSet("techMaState",a.ma?.state||t.ma?.order||"--",a.ma?.tone); setText("techMaConclusion",a.ma?.conclusion||"--");
    technicalMetrics("techMaValues",[["5MA",technicalFmt(t.ma?.ma5)],["10MA",technicalFmt(t.ma?.ma10)],["20MA",technicalFmt(t.ma?.ma20)],["60MA",technicalFmt(t.ma?.ma60)]]);
    techSet("techBollState",a.bollinger?.state||"--",a.bollinger?.tone); setText("techBollConclusion",a.bollinger?.conclusion||"--"); technicalMetrics("techBoll",[["上軌",technicalFmt(t.bollinger?.upper)],["中軌",technicalFmt(t.bollinger?.middle)],["下軌",technicalFmt(t.bollinger?.lower)],["帶寬",technicalFmt(t.bollinger?.bandwidth,"%")]]);
    techSet("techVolumeState",a.volume?.state||"--",a.volume?.tone); setText("techVolumeConclusion",a.volume?.conclusion||"--"); technicalMetrics("techVolume",[["成交量",technicalVolumeFmt(t.volume?.current)],["5日均量",technicalVolumeFmt(t.volume?.avg5)],["20日均量",technicalVolumeFmt(t.volume?.avg20)],["量比",technicalFmt(t.volume?.ratio20)]]);
    techSet("techBiasState",a.bias?.state||"--",a.bias?.tone); setText("techBiasConclusion",a.bias?.conclusion||"--"); technicalMetrics("techBias",[["5MA",technicalFmt(t.bias?.ma5,"%")],["10MA",technicalFmt(t.bias?.ma10,"%")],["20MA",technicalFmt(t.bias?.ma20,"%")],["60MA",technicalFmt(t.bias?.ma60,"%")]]);
    techSet("techTrendState",a.trend?.state||"--",a.trend?.tone); setText("techTrendConclusion",a.trend?.conclusion||"--"); technicalMetrics("techTrend",[["60日高",technicalFmt(t.trend?.high60)],["60日低",technicalFmt(t.trend?.low60)],["距高",technicalFmt(t.trend?.fromHigh60Pct,"%")],["距低",technicalFmt(t.trend?.fromLow60Pct,"%")]]);
    techSet("techMomentumState",a.momentum?.state||"--",a.momentum?.tone); setText("techMomentumConclusion",a.momentum?.conclusion||"--"); technicalMetrics("techMomentum",[["RSI",technicalFmt(t.momentum?.rsi14)],["MACD",technicalFmt(t.momentum?.macd)],["Signal",technicalFmt(t.momentum?.signal)],["Histogram",technicalFmt(t.momentum?.histogram)]]);
    const keyPoints=[a.ma?.conclusion,a.bollinger?.conclusion,a.volume?.conclusion,a.trend?.conclusion,a.momentum?.conclusion].filter(Boolean);
    const keyHost=$("techKeyPoints"); if(keyHost)keyHost.innerHTML=keyPoints.slice(0,5).map(x=>`<li>${String(x)}</li>`).join("");
    const overallBox=$("techOverview"); if(overallBox){overallBox.classList.remove("tone-good","tone-watch","tone-bad","tone-neutral");overallBox.classList.add(`tone-${a.overall?.tone||"neutral"}`);}
    setText("techSummary",a.overall?.summary||"--");
  }catch(e){console.warn("技術資料更新失敗",e);setText("technicalSource","Yahoo｜取得失敗")}
}
async function valuation(query,market,price){
  const params=new URLSearchParams({q:String(query||""),market:String(market||""),price:String(price??"")});
  return await readJson(await fetch(`/api/valuation?${params.toString()}`,{cache:"no-store"}),"估值");
}
function valuationNum(n){
  if(n===null||n===undefined||n==="")return null;
  const x=Number(n);return Number.isFinite(x)?x:null;
}
function valuationTrunc(n){
  const x=valuationNum(n);return x===null?null:Math.trunc(x);
}
function valuationFmt(n,suffix=""){
  // Only prices calculated by StockZone (PE/PB/composite fair price) are truncated.
  const x=valuationTrunc(n);return x!==null?`${x.toLocaleString("zh-TW")}${suffix}`:"--";
}
function valuationMetric(n,suffix="",na="--"){
  const x=valuationNum(n);return x!==null?`${x.toLocaleString("zh-TW",{maximumFractionDigits:2,minimumFractionDigits:0})}${suffix}`:na;
}
function valuationPercent(n,na="--"){
  const x=valuationNum(n);return x!==null?`${x.toLocaleString("zh-TW",{maximumFractionDigits:2,minimumFractionDigits:0})}%`:na;
}
function valuationEpsFmt(n){
  const x=valuationNum(n);
  return x!==null?x.toLocaleString("zh-TW",{maximumFractionDigits:2,minimumFractionDigits:0}):"--";
}
function valuationRiskByCurrentFair(current,fair){
  if(!(current>0&&fair>0))return "neutral";
  const premium=(current/fair-1)*100;
  return premium<-10?"safe":premium<=20?"watch":"danger";
}
function valuationRiskByPeer(premium){
  const x=valuationNum(premium);if(x===null)return "neutral";
  return x<=0?"safe":x<=30?"watch":"danger";
}
function resetValuation(msg="--"){
  setText("valuationStatus",msg);setText("valuationStatusDetail","--");
  ["valuationCompositeFair","valuationCompositeGap","valuationPeFair","valuationPeFairGap","valuationPbFair","valuationPbFairGap","valuationSummaryBps"].forEach(id=>setText(id,"--"));
  ["valuationCurrentPe","valuationPeerPe","valuationPeGap","valuationBookValue","valuationCurrentPb","valuationPeerPb","valuationPbGap"].forEach(id=>setText(id,"--"));
  setText("overviewCompositeFair","--");latestValuationScenario=null;setText("overviewValuationScenario","--");setText("overviewValuationScenarioNote","估值情境判讀");
  const qhost=$("valuationQuarterGrid");if(qhost)qhost.innerHTML="";setText("valuationTtmEps","--");
}
let latestValuationScenario=null;
function currentTargetPrice(){const main=preferredMainTarget();return main?valuationNum(targetPriceValue(main.latest)):null}
function scenarioClassify(P,O,B,F,T){
  if(!(P>0&&O>0&&B>0&&F>0))return {n:null,state:"資料不足",consensus:"資料不足",confidence:"低",tone:"watch",summary:"營運合理價或 PB 合理價資料不足，暫時無法完成九情境判讀。"};
  if(!(T>0))return {n:null,state:"等待目標價",consensus:"待完成",confidence:"--",tone:"watch",summary:"內部估值已完成，等待券商目標價後再進行完整九情境判讀。"};
  const divergence=Math.abs(O-B)/F*100, close=divergence<=20, mid=divergence<=40;
  const near=(a,b)=>a>0&&b>0&&Math.abs(a/b-1)<=.05;
  let n,state,summary,tone="watch";
  if(close){
    if(P<F&&!near(P,F)&&(T?F<T:true)){n=1;state="低估偏多";summary="兩種估值高度接近，現價低於綜合合理價，且仍低於券商目標價。";tone="good"}
    else if(near(P,F)&&(T?P<T:true)){n=2;state="合理偏多";summary="現價已接近綜合合理價，估值大致合理；若券商目標價更高，仍保留上行預期。";tone="good"}
    else if(P>F&&T&&P<T&&!near(P,T)){n=3;state="溢價偏多";summary="現價高於內部合理價，但尚未到券商目標價，市場正給予一定成長溢價。"}
    else if(P>F&&T&&near(P,T)){n=4;state="接近目標價";summary="現價已高於內部合理價並接近券商目標價，上行空間開始受限。";tone="watch"}
    else {n=5;state="明顯高估";summary="現價高於內部合理價，且已高於券商目標價或缺乏更高目標價支撐。";tone="danger"}
  }else{
    const lo=Math.min(O,B),hi=Math.max(O,B);
    if(P<lo){n=6;state="雙重低估";summary="營運估值與 PB 雖有分歧，但現價同時低於兩者，屬雙重低估區。";tone="good"}
    else if(P>=lo&&P<=hi){n=7;state="估值分歧區";summary="現價介於營運合理價與 PB 合理價之間，不同估值方法對合理價格看法明顯不同。"}
    else if(P>hi&&T&&P<T){n=8;state="成長預期區";summary="現價已高於兩種內部合理價，但仍低於券商目標價，市場正在交易未來成長預期。";tone="watch"}
    else {n=9;state="全面高估";summary="現價高於營運合理價、PB 合理價，且已高於券商目標價或缺乏目標價支撐。";tone="danger"}
  }
  return {n,state,consensus:close?"高共識":mid?"有分歧":"高分歧",confidence:close?"高":mid?"中":"低",tone,summary,divergence};
}
function renderValuationScenario(){
  const x=latestValuationScenario;if(!x)return;
  const T=currentTargetPrice(),r=scenarioClassify(x.P,x.O,x.B,x.F,T),card=$("valuationScenario");
  card?.classList.remove("scenario-tone-watch","scenario-tone-danger");if(r.tone==="watch")card?.classList.add("scenario-tone-watch");if(r.tone==="danger")card?.classList.add("scenario-tone-danger");
  setText("valuationScenarioState",r.n?`情境 ${r.n}｜${r.state}`:r.state);setText("valuationScenarioConsensus",r.consensus);setText("valuationScenarioConfidence",`估值可信度 ${r.confidence}`);setText("valuationScenarioSummary",r.summary);
  setText("scenarioPrice",valuationMetric(x.P));setText("scenarioOperatingLabel",x.usePs?"PS 合理價":"PE 合理價");setText("scenarioOperating",valuationFmt(x.O));setText("scenarioPb",valuationFmt(x.B));setText("scenarioComposite",valuationFmt(x.F));setText("scenarioTarget",T?valuationMetric(T):"--");
  setText("overviewValuationScenario",r.n?`${r.n}｜${r.state}`:r.state);setText("overviewValuationScenarioNote",`${r.consensus}｜可信度${r.confidence}`);
}
function renderValuation(v){
  const profitable=v.profitable===true || Number(v.ttm)>0;
  const usePs=!profitable;
  const operatingPremium=usePs?v.psPremiumPct:v.pePremiumPct;
  const operatingPeer=usePs?v.peerPs:v.peerPe;
  setText("valuationOperatingFairLabel",usePs?"PS 合理股價":"PE 合理股價");
  setText("valuationOperatingIcon",usePs?"PS":"PE");
  setText("valuationOperatingTitle",usePs?"股價營收比":"本益比");
  const operatingInfo=document.querySelector('#valuation .valuation-section-title [data-formula="pedef"], #valuation .valuation-section-title [data-formula="psdef"]'); if(operatingInfo){operatingInfo.dataset.formula=usePs?"psdef":"pedef"; operatingInfo.setAttribute("aria-label",usePs?"查看股價營收比定義":"查看本益比定義");}
  setText("valuationOperatingCurrentLabel",usePs?"目前 PS":"目前本益比");
  setText("valuationOperatingPeerLabel",usePs?"同業 PS 中位數":"同業平均本益比");
  const last=valuationNum(v.last), ttm=valuationNum(v.ttm), bps=valuationNum(v.bookValue), peerPb=valuationNum(v.peerPb);
  const peFair=(ttm!==null&&ttm>0&&valuationNum(v.peerPe)>0)?ttm*valuationNum(v.peerPe):null;
  const psFair=(valuationNum(v.salesPerShare)>0&&valuationNum(v.peerPs)>0)?valuationNum(v.salesPerShare)*valuationNum(v.peerPs):null;
  const operatingFair=usePs?psFair:peFair;
  const pbFair=(bps!==null&&bps>0&&peerPb!==null&&peerPb>0)?bps*peerPb:null;
  const fairVals=[operatingFair,pbFair].filter(x=>Number.isFinite(x)&&x>0);
  const compositeFair=fairVals.length?fairVals.reduce((a,b)=>a+b,0)/fairVals.length:null;
  latestValuationScenario={P:last,O:operatingFair,B:pbFair,F:compositeFair,usePs};renderValuationScenario();
  const fairGap=x=>(last!==null&&last>0&&Number.isFinite(x))?(x/last-1)*100:null;
  const renderFair=(valueId,gapId,value)=>{const el=$(gapId),gap=fairGap(value);setText(valueId,Number.isFinite(value)?valuationFmt(value,""):"資料不足");if(!el)return;el.classList.remove("risk-safe","risk-watch","risk-danger","risk-neutral");if(gap===null){el.textContent="--";el.classList.add("risk-neutral");return;}el.textContent=`較現價 ${gap>=0?"+":"-"}${valuationPercent(Math.abs(gap))}`;el.classList.add(`risk-${valuationRiskByCurrentFair(last,value)}`);};
  renderFair("valuationPeFair","valuationPeFairGap",operatingFair);renderFair("valuationPbFair","valuationPbFairGap",pbFair);renderFair("valuationCompositeFair","valuationCompositeGap",compositeFair);
  setText("overviewCompositeFair",Number.isFinite(compositeFair)?valuationFmt(compositeFair):"--");setText("valuationSummaryBps",bps!==null?valuationMetric(bps,""):"資料不足");
  setText("valuationCurrentPe",usePs?valuationMetric(v.currentPs," 倍","資料不足"):valuationMetric(v.currentPe," 倍","資料不足"));
  setText("valuationPeerPe",usePs?valuationMetric(v.peerPs," 倍","資料不足"):valuationMetric(v.peerPe," 倍","資料不足"));
  setText("valuationPeGap",Number.isFinite(Number(operatingPremium))?`${Number(operatingPremium)>=0?"+":"-"}${valuationPercent(Math.abs(Number(operatingPremium)))}`:"不適用");
  setText("valuationBookValue",valuationMetric(v.bookValue," 元","資料不足"));setText("valuationCurrentPb",valuationMetric(v.currentPb," 倍","資料不足"));setText("valuationPeerPb",valuationMetric(v.peerPb," 倍","資料不足"));setText("valuationPbGap",Number.isFinite(Number(v.pbPremiumPct))?`${Number(v.pbPremiumPct)>=0?"+":"-"}${valuationPercent(Math.abs(Number(v.pbPremiumPct)))}`:"資料不足");
  const peGap=$("valuationPeGap"),pbGap=$("valuationPbGap");
  const applyPeerRisk=(el,premium)=>{if(!el)return;el.classList.remove("valuation-premium-high","valuation-premium-low","risk-safe","risk-watch","risk-danger","risk-neutral","valuation-not-applicable");el.removeAttribute("data-tag");if(!Number.isFinite(Number(premium))){if(el.textContent.includes("不適用"))el.classList.add("valuation-not-applicable");return;}const risk=valuationRiskByPeer(premium);el.classList.add(`risk-${risk}`);el.dataset.tag=risk==="safe"?"安全":risk==="watch"?"注意":"危險";};
  applyPeerRisk(peGap,operatingPremium);applyPeerRisk(pbGap,v.pbPremiumPct);
  const statusRisk=valuationRiskByCurrentFair(last,compositeFair);let statusLabel=statusRisk==="safe"?"相對低估":statusRisk==="watch"?"接近合理":"相對高估";if(compositeFair===null)statusLabel="資料不足";
  setText("valuationStatus",statusLabel);setText("valuationStatusDetail",usePs?"虧損公司以 PS 取代 PE，與 PB 共同估值":(v.statusDetail||"--"));
  const statusEl=$("valuationStatus");if(statusEl){statusEl.classList.remove("risk-text-safe","risk-text-watch","risk-text-danger","risk-text-neutral","valuation-not-applicable");statusEl.classList.add(`risk-text-${compositeFair===null?"neutral":statusRisk}`);if(statusEl.textContent.includes("不適用"))statusEl.classList.add("valuation-not-applicable");}
  setText("valuationMethod",usePs?"Yahoo 營收／股數計算 PS；同業 PS 採中位數；再與 PB 合併":"Yahoo PE 同業比較＋PB 同業比較");
  setText("valuationNote",usePs?"近四季 EPS 為負時，以 PS（股價營收比）補位 PE；PS 合理價與 PB 合理價共同形成綜合合理價。":"估值用來判斷相對昂貴程度，不直接當作買賣價。");
  setText("valuationTtmEps",ttm!==null?valuationEpsFmt(ttm):"資料不足");
  const host=$("valuationQuarterGrid");if(host){const q=Array.isArray(v.latest4)?v.latest4:[];host.innerHTML=q.slice(0,4).map((x,i)=>`<div class="valuation-quarter-chip${i===0?" is-latest":""}"><span>${String(x.period||"")}</span><b>${valuationEpsFmt(x.eps)}</b>${i===0?'<em>最新</em>':''}</div>`).join("");}
}
async function loadValuation(stock){
  const card=$("valuation");card?.classList.add("is-loading");resetValuation("讀取中");
  try{
    const code=stock?.code||stock?.symbol||"";
    const price=Number(stock?.last??stock?.price??stock?.regularMarketPrice);
    const data=await valuation(code,stock?.market||"",price);
    renderValuation(data);
  }catch(e){
    console.warn("估值更新失敗",e);resetValuation("資料不足");
    setText("valuationNote",`Yahoo 估值資料暫時無法取得：${e.message}`);
  }finally{card?.classList.remove("is-loading")}
}

function renderStock(x){
  currentStock=x;
  const last=Number(x.last ?? x.price ?? x.regularMarketPrice);
  const change=Number(x.change ?? x.regularMarketChange);
  const pct=Number(x.changePct ?? x.changePercent ?? x.regularMarketChangePercent);

  setText("stockName",shortStockName(x.name||x.shortName)||"—");
  setText("stockCodeLabel",`${x.code||x.symbol||"—"} | ${x.market||"台股"}`);
  setText("marketLabel","");
  setText("currentPrice",fmt(last));
  setText("metricPrice",fmt(last));
  setText("decisionPrice",fmt(last));

  const ch=Number.isFinite(change)
    ? `${change>0?"+":""}${fmt(change)}${Number.isFinite(pct)?`(${pct>0?"+":""}${fmt(pct)}%)`:""}`
    : "—";
  setText("priceChange",ch);
  setText("metricChange",ch);
  setText("updateTime","剛剛更新");
  if($("updateRow"))$("updateRow").hidden=false;

  const cls=change>0?"up":change<0?"down":"";
  updateListButtons();
  beginNews();
  ["currentPrice","priceChange","metricChange"].forEach(id=>{
    const el=$(id); if(el) el.className=cls;
  });
}
async function search(){
  const input=$("stockCode");
  const btn=$("searchButton");
  const q=input?.value.trim();
  if(!q){setStatus("請輸入股票名稱或代碼",true);return}

  btn.disabled=true;
  setStatus("搜尋股票…");
  try{
    const data=await quote(q);
    renderStock(data);
    loadValuation(data);
    loadTechnical(data);
    loadDisposal(data);
    setView("overview");
    beginTargetSearch();
    setStatus("搜尋目標價…");
    try{await loadTargetPlay(data.code||data.symbol||q,data.name||data.shortName||"")}catch(e){console.warn("目標價更新失敗，保留其他搜尋",e)}
    setStatus("搜尋新聞…");
    try{await loadNews(data.code||data.symbol||q,data.name||data.shortName||"")}catch(e){console.warn("新聞更新失敗",e)}
    setStatus(`搜尋成功：${shortStockName(data.name)||data.code||q}`);
  }catch(e){
    console.error(e);
    setStatus(`搜尋失敗：${e.message}`,true);
  }finally{
    btn.disabled=false;
  }
}

$("searchButton")?.addEventListener("click",search);
$("stockCode")?.addEventListener("keydown",e=>{if(e.key==="Enter")search()});
$("manualRefreshBtn")?.addEventListener("click",async()=>{if(!currentStock)return setStatus("請先搜尋股票",true);const btn=$("manualRefreshBtn"),input=$("stockCode");if(btn)btn.disabled=true;if(input)input.value=currentStock.code||currentStock.symbol||currentStock.name||"";try{await search()}finally{if(btn)btn.disabled=false}});
document.querySelectorAll("[data-disposal-help]").forEach(btn=>btn.addEventListener("click",()=>{const type=btn.dataset.disposalHelp,title=type==="progress"?"距離處置進度":"除外／豁免條件",text=type==="progress"?"處置主要計數門檻：連續 3 個營業日達第一款，或連續 5 日／近 10 日 6 次／近 30 日 12 次達第一至第八款。畫面中的 3、10、30 日進度只顯示可直接量化的核心門檻。":"除外條件依各注意款次不同而定。價格注意警戒線是以價格異常款的公開門檻做保守估算；低於此線只能排除該價格條件，不能保證其他注意條件不成立。";setText("disposalPopoverTitle",title);setText("disposalPopoverText",text);const p=$("disposalPopover");if(p)p.hidden=false}));
$("disposalPopoverClose")?.addEventListener("click",()=>{const p=$("disposalPopover");if(p)p.hidden=true});

document.querySelectorAll("[data-scroll]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.getElementById(btn.dataset.scroll)?.scrollIntoView({behavior:"smooth",block:"start"});
    $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
  });
});
$("menuBtn")?.addEventListener("click",()=>{
  $("sidebar")?.classList.toggle("open");$("overlay")?.classList.toggle("show");
});
$("overlay")?.addEventListener("click",()=>{
  $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
});
$("mobileSearch")?.addEventListener("click",()=>{
  document.querySelector(".searchbox")?.classList.add("mobile-open");
  $("stockCode")?.focus();
  window.scrollTo({top:0,behavior:"smooth"});
});


// v2.2.2 — full target list + holdings/watchlist management.
let currentStock=null;
let targetRowsCache=[];
let targetTypeFilter="外資";
const LIST_KEYS={holdings:"stockzone_holdings_v2",watchlist:"stockzone_watchlist_v2"};

function syncMobileMarketLabel(){const el=$("marketLabel");if(!el)return;const raw=String(el.textContent||"").trim();el.dataset.shortMarket=/上櫃/.test(raw)?"上櫃":/上市/.test(raw)?"上市":"";}

function targetFmt(n){
  const x=Number(n); return Number.isFinite(x)?x.toLocaleString("zh-TW",{maximumFractionDigits:2}):"--";
}
function targetDateValue(x){
  const d=new Date(x?.date||x?.publishedAt||x?.published||x?.time||0);
  return Number.isNaN(d.getTime())?0:d.getTime();
}
function targetPriceValue(x){return Number(x?.target ?? x?.targetPrice ?? x?.price)}
function targetBrokerName(x){return x?.broker||x?.brokerName||x?.name||"未知券商"}
function inferredBrokerType(name,fallback="未知"){
 const n=String(name||"").trim();
 const foreign=["高盛","美銀","美林","里昂","摩根士丹利","大摩","摩根大通","小摩","花旗","瑞銀","UBS","野村","麥格理","滙豐","匯豐","德意志","德銀","巴克萊","瑞信","大和","法巴","法國巴黎","Jefferies","傑富瑞"];
 const local=["中信","中國信託","元大","國泰","富邦","第一金","第一金證券","永豐","永豐金","凱基","群益","兆豐","華南","統一","玉山","台新","元富","新光","康和","宏遠","亞東","台中銀","彰銀","合庫","合作金庫","土銀","國票","大展","福邦","高橋"];
 if(foreign.some(x=>n.includes(x)))return "外資";
 if(local.some(x=>n.includes(x)))return "本土";
 return fallback;
}
function targetBrokerType(x){
 const t=String(x?.brokerType||x?.type||"");
 return inferredBrokerType(targetBrokerName(x),t.includes("外資")?"外資":t.includes("本土")?"本土":"未知");
}
function targetHistoryOf(x){
  const h=x?.targetHistory||x?.history||x?.records||x?.targets;
  return Array.isArray(h)&&h.length?h:[x];
}
function normalizeTargetRows(payload){
  if(Array.isArray(payload))return payload;
  for(const k of ["brokers","targets","items","results","data"]){
    if(Array.isArray(payload?.[k]))return payload[k];
  }
  return [];
}
function targetCandidate(row){
  const history=targetHistoryOf(row)
    .filter(r=>Number.isFinite(targetPriceValue(r)))
    .sort((a,b)=>targetDateValue(b)-targetDateValue(a));
  return history.length?{row,history,latest:history[0],time:targetDateValue(history[0])}:null;
}
function pickMainTarget(rows){
  return rows.map(targetCandidate).filter(Boolean).sort((a,b)=>b.time-a.time)[0]||null;
}
function targetBasis(main){
  const h=main.history,latest=targetPriceValue(h[0]),previous=h.length>1?targetPriceValue(h[1]):NaN;
  if(Number.isFinite(previous)){
    if(latest>previous)return {base:previous,rule:"上調 → 以前次為基準"};
    if(latest<previous)return {base:latest,rule:"下調 → 以最新為基準"};
  }
  return {base:latest,rule:h.length>1?"維持 → 以最新為基準":"只有一筆 → 以最新為基準"};
}

const MAIN_BROKER_KEY="stockzone_main_broker_v232";
function brokerPrefKey(){return `${currentStock?.code||""}`}
function getBrokerPref(){try{return JSON.parse(localStorage.getItem(MAIN_BROKER_KEY)||"{}")[brokerPrefKey()]||""}catch{return""}}
function setBrokerPref(name){let x={};try{x=JSON.parse(localStorage.getItem(MAIN_BROKER_KEY)||"{}")||{}}catch{};if(name)x[brokerPrefKey()]=name;else delete x[brokerPrefKey()];localStorage.setItem(MAIN_BROKER_KEY,JSON.stringify(x))}
function allTargetCandidates(){return targetRowsCache.map(targetCandidate).filter(Boolean).sort((a,b)=>b.time-a.time)}
function fillMainBrokerSelect(){
  const sel=$("mainBrokerSelect"); if(!sel)return;
  const pref=getBrokerPref();
  const names=[...new Set(allTargetCandidates().map(x=>targetBrokerName(x.row)))];
  sel.innerHTML=`<option value="">自動選擇</option>`+names.map(n=>`<option value="${n.replace(/"/g,"&quot;")}">${n}</option>`).join("");
  if(pref&&names.includes(pref))sel.value=pref;
}
function preferredMainTarget(){
  const all=allTargetCandidates(),pref=getBrokerPref();
  if(pref){
    const hit=all.find(x=>targetBrokerName(x.row)===pref);
    if(hit)return hit;
  }
  return all[0]||null;
}
function renderTargetHistory3(main){
  const host=$("targetHistory3"); if(!host)return;
  if(!main){host.innerHTML="";return}
  const h=main.history.slice(0,3);
  host.innerHTML=h.map((x,i)=>`<div class="history3-row"><span>${i===0?"最新":i===1?"前次":"上次"}</span><strong>${targetFmt(targetPriceValue(x))}</strong><time>${String(x.date||x.publishedAt||x.published||"—").slice(0,10)}</time></div>`).join("");
}
$("mainBrokerSelect")?.addEventListener("change",e=>{
  setBrokerPref(e.target.value);
  const main=preferredMainTarget();
  renderMainTarget(main);
  renderTargetHistory3(main);
});

function renderMainTarget(main){
 const play=$("targetPlay");
 if(!main){
  play?.classList.add("hidden");
  setText("overviewNearestPrice","--"); setText("overviewNearestRate","倍率--");
  setText("overviewMainBrokerLine","目標券商：--"); renderValuationScenario(); return;
 }
 const basis=targetBasis(main);
 const current=Number(currentStock?.last??currentStock?.price??currentStock?.regularMarketPrice);
 const levels=[.80,.85,.88].map(rate=>({rate,price:Math.floor(basis.base*rate)}));
 const nearest=Number.isFinite(current)?levels.slice().sort((x,y)=>Math.abs(x.price-current)-Math.abs(y.price-current))[0]:levels[0];
 setText("overviewNearestPrice",`${targetFmt(nearest.price)}`);
 setText("overviewNearestRate",`（倍率${Math.round(nearest.rate*100)}%）`);
 setText("overviewMainBrokerLine",`${targetBrokerName(main.row)}：${targetFmt(targetPriceValue(main.latest))}`);
 setText("targetBase",`${targetFmt(basis.base)}`); setText("targetRule",basis.rule);
 setText("target80",`${targetFmt(Math.floor(basis.base*.80))}`); setText("target85",`${targetFmt(Math.floor(basis.base*.85))}`); setText("target88",`${targetFmt(Math.floor(basis.base*.88))}`);
 renderTargetHistory3(main); play?.classList.remove("hidden"); renderValuationScenario();
}
const TARGET_CORR_KEY="stockzone_target_corrections_v239"; let editingTarget=null;
function readCorr(){try{return JSON.parse(localStorage.getItem(TARGET_CORR_KEY)||"{}")||{}}catch{return{}}}
function writeCorr(x){localStorage.setItem(TARGET_CORR_KEY,JSON.stringify(x))}
function corrStableId(row){
 if(row?._corrId)return row._corrId;
 const latest=targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row||{};
 return [currentStock?.code||"",row?.originalBroker||targetBrokerName(row),String(latest?.date||latest?.publishedAt||latest?.published||"").slice(0,10),String(targetPriceValue(latest)||"")].join("|");
}
function historyCorrId(row,item){
 const broker=row?.originalBroker||targetBrokerName(row),d=String(item?.date||item?.publishedAt||item?.published||"").slice(0,10);
 return `history|${currentStock?.code||""}|${broker}|${d}|${targetPriceValue(item)}`;
}
function applyCorr(rows){
 const c=readCorr();
 return rows.map(row=>{
  const id=corrStableId(row),fix=c[id],r={...row,_corrId:id};
  if(fix?.deleted)return null;
  if(fix?.broker){r.broker=fix.broker;r.brokerType=fix.brokerType||inferredBrokerType(fix.broker,"未知");}
  let h=targetHistoryOf(r).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a));
  h=h.map((x,i)=>{
    const hf=c[historyCorrId(row,x)];
    if(hf?.deleted)return null;
    let y={...x};
    if(hf?.broker)y.broker=hf.broker;
    if(Number.isFinite(Number(hf?.target)))y.target=Number(hf.target);
    if(i===0&&Number.isFinite(Number(fix?.target)))y.target=Number(fix.target);
    return y;
  }).filter(Boolean);
  if(!h.length)return null;
  r.targetHistory=h; r.target=targetPriceValue(h[0]);
  return r;
 }).filter(Boolean);
}
function openEdit(row){
  editingTarget={row,item:null};
  const latest=targetHistoryOf(row).slice().sort((a,b)=>targetDateValue(b)-targetDateValue(a))[0]||row;
  $("editBrokerName").value=targetBrokerName(row);
  $("editTargetPrice").value=targetPriceValue(latest)||"";
  $("targetEditModal").classList.remove("hidden");
}
function openHistoryEdit(row,item){
  editingTarget={row,item};
  $("editBrokerName").value=targetBrokerName(item)||targetBrokerName(row);
  $("editTargetPrice").value=targetPriceValue(item)||"";
  $("targetEditModal").classList.remove("hidden");
}
function closeEdit(){editingTarget=null;$("targetEditModal")?.classList.add("hidden")}
$("closeTargetEdit")?.addEventListener("click",closeEdit);
$("cancelTargetEdit")?.addEventListener("click",closeEdit);

$("deleteTargetEdit")?.addEventListener("click",()=>{
 if(!editingTarget)return; const {row,item}=editingTarget,c=readCorr(),id=item?historyCorrId(row,item):corrStableId(row);
 c[id]={...(c[id]||{}),deleted:true};writeCorr(c);targetRowsCache=applyCorr(targetRowsCache);
 closeEdit();renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget());setStatus("已刪除");
});
$("saveTargetEdit")?.addEventListener("click",()=>{
 if(!editingTarget)return;
 const broker=$("editBrokerName").value.trim(),target=Number($("editTargetPrice").value);
 if(!broker||!Number.isFinite(target)||target<=0)return setStatus("請輸入正確資料",true);
 const {row,item}=editingTarget,c=readCorr(),id=item?historyCorrId(row,item):corrStableId(row);
 c[id]={broker,target,brokerType:inferredBrokerType(broker,"未知")};writeCorr(c);
 targetRowsCache=applyCorr(targetRowsCache);
 closeEdit();renderBrokerRows();fillMainBrokerSelect();renderMainTarget(preferredMainTarget());setStatus("已修改");
});

const TARGET_CACHE_KEY="stockzone_target_cache_v2461";
const TARGET_SEEN_KEY="stockzone_target_seen_v2503";
let targetNewKeys=new Set(),expandedBrokerRows=new Set();
function readTargetUnread(){try{return JSON.parse(localStorage.getItem(TARGET_SEEN_KEY)||"{}")||{}}catch{return{}}}
function writeTargetUnread(x){try{localStorage.setItem(TARGET_SEEN_KEY,JSON.stringify(x))}catch{}}
function targetUnreadFor(code){return new Set(readTargetUnread()[String(code)]||[])}
function saveTargetUnread(code,set){const all=readTargetUnread();all[String(code)]=[...set];writeTargetUnread(all)}
function readTargetCache(){try{return JSON.parse(localStorage.getItem(TARGET_CACHE_KEY)||"{}")||{}}catch{return{}}}
function writeTargetCache(x){localStorage.setItem(TARGET_CACHE_KEY,JSON.stringify(x))}
function targetSig(row){const c=targetCandidate(row);if(!c)return"";return `${targetBrokerName(row)}|${targetPriceValue(c.latest)}|${String(c.latest.date||c.latest.publishedAt||"").slice(0,10)}`}
function mergeTargetRows(oldRows,newRows){
 const all=[...(newRows||[]),...(oldRows||[])],groups=new Map();
 for(const row of all){const name=targetBrokerName(row),key=`${targetBrokerType(row)}|${name}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(...targetHistoryOf(row))}
 return [...groups.entries()].map(([key,h])=>{h=h.filter(x=>Number.isFinite(targetPriceValue(x))).sort((a,b)=>targetDateValue(b)-targetDateValue(a));const uniq=[];for(const x of h){if(!uniq.some(y=>targetPriceValue(y)===targetPriceValue(x)&&String(y.date||y.publishedAt||"").slice(0,10)===String(x.date||x.publishedAt||"").slice(0,10)))uniq.push(x)}const latest=uniq[0];return latest?{...latest,broker:targetBrokerName(latest),brokerType:targetBrokerType(latest),targetHistory:uniq.slice(0,3)}:null}).filter(Boolean)
}
function cacheTargetsForStock(code,rows){const all=readTargetCache(),prev=all[code]?.rows||[];const prevSigs=new Set(prev.map(targetSig)),unread=targetUnreadFor(code);if(prev.length)for(const sig of rows.map(targetSig))if(sig&&!prevSigs.has(sig))unread.add(sig);targetNewKeys=unread;saveTargetUnread(code,unread);all[code]={rows,updatedAt:new Date().toISOString()};writeTargetCache(all)}
function isNewTarget(row){return targetNewKeys.has(targetSig(row))}
function markTargetRead(row){const sig=targetSig(row);if(!sig||!targetNewKeys.has(sig))return;targetNewKeys.delete(sig);saveTargetUnread(newsCode(),targetNewKeys);renderBrokerRows()}
function renderBrokerRows(){
  const host=$("brokerRows"); if(!host)return;
  const play=$("targetPlay");
  play?.classList.remove("hidden");
  renderMainTarget(preferredMainTarget());
  const rows=targetRowsCache.map(targetCandidate).filter(Boolean).filter(x=>targetBrokerType(x.row)===targetTypeFilter).sort((a,b)=>b.time-a.time);
  if(!rows.length){host.innerHTML=`<p>目前沒有${targetTypeFilter}目標價。</p>`;return}
  host.innerHTML=rows.map((x,i)=>{
    const d=x.latest.date||x.latest.publishedAt||x.latest.published||"—",src=x.latest?.sourceUrl||x.row?.sourceUrl||"",name=targetBrokerName(x.row),open=expandedBrokerRows.has(name);
    const history=x.history.map((h,j)=>{const hsrc=h?.sourceUrl||x.row?.sourceUrl||"";return `<div class="broker-history-row"><span>${j===0?"最新":`歷史 ${j}`}</span><strong>${targetFmt(targetPriceValue(h))}</strong><time>${String(h.date||h.publishedAt||"—").slice(0,10)}</time><span class="broker-actions history-actions"><button class="broker-menu-btn" data-history-menu="${i}-${j}" type="button">︙</button><span class="broker-menu hidden" data-history-menu-box="${i}-${j}">${hsrc?`<a href="${hsrc}" target="_blank" rel="noopener">來源</a>`:""}<button type="button" data-edit-history="${i}-${j}">修改</button></span></span></div>`}).join("");
    return `<div class="broker-row" data-index="${i}" data-target-read="${i}"><span><b>${name}</b>${isNewTarget(x.row)?'<em class="target-new">NEW</em>':''}</span><strong>${targetFmt(targetPriceValue(x.latest))}</strong><time>${String(d).slice(0,10)}</time><button class="broker-expand" data-expand="${i}" type="button">${open?"︿":"⌵"}</button><span class="broker-actions"><button class="broker-menu-btn" data-menu="${i}" type="button">︙</button><span class="broker-menu hidden" data-menu-box="${i}">${src?`<a href="${src}" target="_blank" rel="noopener">來源</a>`:""}<button type="button" data-edit-target="${i}">修改</button></span></span><div class="broker-history ${open?"":"hidden"}" data-history="${i}">${history}</div></div>`;
  }).join("");
  host.querySelectorAll("[data-target-read]").forEach(row=>row.addEventListener("click",e=>{if(e.target.closest("button,a,.broker-menu"))return;const i=Number(row.dataset.targetRead);if(rows[i])markTargetRead(rows[i].row)}));
  host.querySelectorAll("[data-expand]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const i=Number(btn.dataset.expand),name=targetBrokerName(rows[i].row);expandedBrokerRows.has(name)?expandedBrokerRows.delete(name):expandedBrokerRows.add(name);renderBrokerRows()}));
  host.querySelectorAll("[data-menu]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const box=host.querySelector(`[data-menu-box="${btn.dataset.menu}"]`);host.querySelectorAll(".broker-menu").forEach(x=>{if(x!==box)x.classList.add("hidden")});box?.classList.toggle("hidden")}));
  host.querySelectorAll("[data-edit-target]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();openEdit(rows[Number(btn.dataset.editTarget)].row)}));
  host.querySelectorAll("[data-history-menu]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const box=host.querySelector(`[data-history-menu-box="${btn.dataset.historyMenu}"]`);host.querySelectorAll(".broker-menu").forEach(x=>{if(x!==box)x.classList.add("hidden")});box?.classList.toggle("hidden")}));
  host.querySelectorAll("[data-edit-history]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const [ri,hi]=btn.dataset.editHistory.split("-").map(Number);openHistoryEdit(rows[ri].row,rows[ri].history[hi])}));
}
function filterBadKnownTarget(rows){
  const code=String(currentStock?.code||currentStock?.symbol||"");
  if(code!=="2330")return rows;
  return rows.filter(row=>!(targetBrokerName(row).includes("高盛") && Number(targetPriceValue(row))===22000));
}

function beginTargetSearch(){
  targetRowsCache=[];
  renderMainTarget(null);
  const host=$("brokerRows");if(host)host.innerHTML="<p>搜尋目標價…</p>";
  $("targetPlay")?.classList.add("hidden");
}
function renderTargetPlay(payload){
  const code=String(currentStock?.code||currentStock?.symbol||"");
  const fresh=filterBadKnownTarget(applyCorr(normalizeTargetRows(payload)));
  const cached=readTargetCache()[code]?.rows||[];
  targetRowsCache=mergeTargetRows(cached,fresh);
  cacheTargetsForStock(code,targetRowsCache);
  renderBrokerRows(); fillMainBrokerSelect(); if(targetTypeFilter==="目標")renderMainTarget(preferredMainTarget());
}
async function fetchTargetPayload(code,name){
  const cached=readTargetCache()[String(code)]?.rows||[];
  const recent=cached.length?"&recent=3":"";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);
  try{const res=await fetch(`/api/targets?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}${recent}`,{cache:"no-store",signal:controller.signal});return await readJson(res,"目標價")}finally{clearTimeout(timer)}
}
async function loadTargetPlay(code,name){
  try{renderTargetPlay(await fetchTargetPayload(code,name));return true}catch(e){console.warn("目標價載入失敗",e);if($("brokerRows"))$("brokerRows").innerHTML="<p>目標價暫時無法載入。</p>";$("targetPlay")?.classList.add("hidden");if(e?.name==="AbortError")throw new Error("目標價查詢逾時");throw e}
}
// target tabs: 外資 / 本土 / 未知
document.querySelectorAll(".target-tabs button").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".target-tabs button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    targetTypeFilter=btn.dataset.targetType||"外資";
    renderBrokerRows();
  });
});


// ---------- v2.5.0.16 news: executable event rules + event-field merge + market-data exclusion ----------
const NEWS_CACHE_KEY="stockzone_news_cache_v2517";
const NEWS_MATCH_CACHE_KEY="stockzone_news_match_cache_v2517";
const NEWS_SUMMARY_KEY="stockzone_news_summary_v2501";
const NEWS_STAR_KEY="stockzone_news_star_v2503";
const NEWS_UNREAD_KEY="stockzone_news_unread_v2503";
const NEWS_DIGEST_NEW_KEY="stockzone_news_digest_new_v2517";
let newsRowsCache=[],newsMatchRowsCache=[],newsFilter="digest";
function newsSet(key,code=newsCode()){const all=readNewsStore(key);return new Set(all[String(code)]||[])}
function saveNewsSet(key,set,code=newsCode()){const all=readNewsStore(key);all[String(code)]=[...set];writeNewsStore(key,all)}
function isNewsStarred(x){return newsSet(NEWS_STAR_KEY).has(newsKey(x))}
function isNewsNew(x){return newsSet(NEWS_UNREAD_KEY).has(newsKey(x))}
function readNewsStore(k){try{return JSON.parse(localStorage.getItem(k)||"{}")||{}}catch{return {}}}
function writeNewsStore(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
function newsCode(){return String(currentStock?.code||currentStock?.symbol||"")}
function newsTime(x){const t=Date.parse(x?.publishedAt||x?.date||"");return Number.isFinite(t)?t:0}
function newsKey(x){return `${String(x?.title||"").trim()}|${String(x?.url||"").trim()}`}
function newsMergeKey(x){return String(x?.title||"").replace(/【[^】]{0,16}】/g,"").replace(/[「」『』\[\](){ }（）｜|：:，,。！？!?\s]/g,"").replace(/即時新聞|新聞/g,"").toLowerCase()}
function pureFlowNewsTitle(title=""){
 const t=String(title||"");
 return /(?:三大法人買賣超|外資買賣超|投信買賣超|自營商買賣超|法人合計買賣超|買超股票\s*TOP\s*\d+|賣超股票\s*TOP\s*\d+|買賣超股票\s*TOP\s*\d+|外資買超金額最大|外資賣超金額最大|投信買超金額最大|投信賣超金額最大)/i.test(t)
   && !/(?:營收|獲利|毛利率|EPS|訂單|產能|擴產|量產|法說|財測|新產品|新技術|客戶|合作|漲價|降價|缺貨|供需)/i.test(t);
}
function blockedNewsItem(x){const t=`${x?.title||""} ${x?.source||""}`,u=String(x?.url||"");return /股市爆料同學會|同學風向與貼文摘要/.test(t)||/cmoney\.tw\/forum\//i.test(u)||pureFlowNewsTitle(x?.title||"")}
function mergeNews(oldRows,newRows){const rows=[];[...(newRows||[]),...(oldRows||[])].sort((a,b)=>newsTime(b)-newsTime(a)).forEach(x=>{if(!x?.title||blockedNewsItem(x))return;const k=newsMergeKey(x);const dup=rows.find(y=>{const q=newsMergeKey(y);return k===q||(k.length>18&&q.length>18&&(k.includes(q)||q.includes(k)))});if(!dup)rows.push(x)});const stars=newsSet(NEWS_STAR_KEY);rows.sort((a,b)=>(stars.has(newsKey(b))-stars.has(newsKey(a)))||(newsTime(b)-newsTime(a)));const pinned=rows.filter(x=>stars.has(newsKey(x))),normal=rows.filter(x=>!stars.has(newsKey(x))).slice(0,80);return [...pinned,...normal]}
function currentNewsSummary(){return String(readNewsStore(NEWS_SUMMARY_KEY)[newsCode()]||"").trim()}
function escNews(s=""){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function digestClean(s=""){
 let t=String(s||"").replace(/\s+/g," ").trim();
 t=t.replace(/^(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*/,"");
 t=t.replace(/^(?:護國神山|晶圓代工龍頭|全球最大晶圓代工廠|全球最大晶圓代工廠商|半導體龍頭|科技巨頭|重量級|市場焦點|指標大廠)\s*/,"");
 t=t.replace(/(?:普遍|不約而同|順利|有機會|可望|有望|備受|持續受到|相當|非常|明顯|強勁地|積極地|大舉|全力|火速|重磅|亮眼)/g,"");
 t=t.replace(/(?:吃下定心丸|成為市場焦點|備受市場關注|引發市場關注|值得關注|受到市場矚目|成為討論焦點)/g,"");
 t=t.replace(/^(?:回顧前一交易日|截至目前|從營運數字來看|從基本面來看|就營運面而言)[，,:：]?\s*/,"");
 t=t.replace(/(?:市場|法人|投資人|外界)[^，。；]{0,18}(?:認為|預期|看好|關注)[，,:：]?\s*/g,"");
 t=t.replace(/([，；])(?:顯示|反映|意味著|可見|由此可見)[^，。；]{0,24}(?=[，；。]|$)/g,"$1");
 t=t.replace(/\s+/g," ").replace(/^[，、；：:\s]+|[。；，\s]+$/g,"").replace(/，{2,}/g,"，").trim();
 return t;
}
function digestCompress(s=""){
 let t=digestClean(s);
 t=t.replace(/^(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*/,"");
 t=t.replace(/^(?:護國神山|晶圓代工龍頭|全球晶圓代工龍頭|全球最大晶圓代工廠商?|半導體龍頭|科技巨頭|重量級|市場焦點|指標大廠)\s*/,"");
 t=t.replace(/^(?:以及|並且|並|而且|但|不過|然而|即使|雖然|儘管|另外|此外|同時|至於|其中|另一方面|展望未來|回顧前一交易日)[，,:：]?\s*/,"");
 t=t.replace(/(?:不約而同|普遍|順利|備受|相當|非常|明顯|積極地|強勁地|全力|大舉|火速|強勢|重磅|驚人|亮眼|樂觀地)/g,"");
 t=t.replace(/(?:吃下定心丸|抱持樂觀看法|充滿期待|成為市場焦點|引發市場關注|值得關注|備受市場關注|受到市場矚目|成為討論焦點)/g,"");
 t=t.replace(/^(?:群益投顧|統一投顧|外資|法人|分析師|券商)(?:董事長|董座|研究員)?[^，。]{0,12}(?:表示|指出|預估|預期|認為)[，,:：]?\s*/,"");
 t=t.replace(/^(?:台積電|聯發科|新唐|萬潤|奇鋐|志聖|東捷|鴻勁)\s*[（(]\d{4,6}[）)]\s*/,(m)=>m.replace(/[（(]\d{4,6}[）)]/,""));
 t=t.replace(/(?:並預估|並指出|並表示|同時預估|同時指出)/g,"預估");
 t=t.replace(/(?:真正的|目前的|現階段的|主要的|進一步的|相關的)(?=(?:訂單|產能|營收|毛利率|EPS|需求|產品|技術|成本))/g,"");
 return t.replace(/^[，、；：:\s]+|[。；，\s]+$/g,"").replace(/，{2,}/g,"，").trim();
}
function digestEvent(s=""){
 const t=String(s||"");if(/營收/.test(t))return"revenue";if(/毛利率|毛利/.test(t))return"margin";if(/EPS|每股盈餘|淨利|獲利/.test(t))return"profit";if(/訂單|接單|能見度|需求/.test(t))return"order";if(/產能|擴產|量產|產線|稼動率/.test(t))return"capacity";if(/資本支出/.test(t))return"capex";if(/矽光子|CPO|CoWoS|先進封裝|技術|研發|產品/.test(t))return"technology";if(/客戶|合作|認證|供應鏈/.test(t))return"customer";if(/缺貨|供需|漲價|降價|庫存/.test(t))return"supply";if(/(?:營運|展望|財測|預估|預期|有望|優於|低於|持平|好轉|改善|回升|成長|衰退|轉強)/.test(t)&&/(?:20\d{2}年|\d{1,2}月|第?[一二三四1234]季|Q[1-4]|今年|明年|全年|上半年|下半年)/i.test(t))return"outlook";return"other";
}
function digestPeriod(s="",defaultYear=""){
 const t=String(s||"");let m;if((m=t.match(/(20\d{2})年\s*(\d{1,2})月/)))return `${m[1]}-${String(+m[2]).padStart(2,"0")}`;if((m=t.match(/(20\d{2})年\s*第?([一二三四1234])季/))){const q={一:1,二:2,三:3,四:4}[m[2]]||m[2];return `${m[1]}-Q${q}`}if((m=t.match(/第?([一二三四1234])季|Q([1-4])/i))){const q=m[2]||({一:1,二:2,三:3,四:4}[m[1]]||m[1]);return `Q${q}`}if((m=t.match(/(\d{1,2})月/)))return `${defaultYear||""}-${String(+m[1]).padStart(2,"0")}`;if((m=t.match(/(20\d{2})年/)))return `${m[1]}-FY`;if(/今年/.test(t))return"THIS-FY";if(/明年/.test(t))return"NEXT-FY";if(/上半年/.test(t))return"H1";if(/下半年/.test(t))return"H2";return"";
}
function digestMarketOnly(s=""){
 const t=String(s||""),market=/(?:股價|現價|收盤價|盤中價|漲幅|跌幅|漲跌|上漲|下跌|漲停|跌停|成交量|成交金額|成交張數|加權指數|大盤|櫃買指數|買超|賣超|主力|外資|投信|自營商)/i.test(t),fund=/(?:營收|毛利率|EPS|每股盈餘|淨利|獲利|訂單|能見度|需求|出貨|產能|擴產|量產|稼動率|資本支出|產品|技術|研發|認證|客戶|合作|財測|營運|展望|預估|預期|有望|優於|低於|持平|好轉|改善|回升|成長|衰退|轉強)/i.test(t);return market&&!fund;
}
function digestKey(s="",time=0){
 const t=digestCompress(s),ev=digestEvent(t),year=time?String(new Date(time).getFullYear()):"",period=digestPeriod(t,year);if(ev!=="other")return `${ev}|${period}`;return t.replace(/[\s，。；、：:（）()「」『』｜|／/!?！？]/g,"").slice(0,34);
}
function mergeDigestFacts(list){
 const sorted=[...list].sort((a,b)=>b.score-a.score||b.text.length-a.text.length||b.time-a.time);let base=sorted[0]?.text||"";
 if(!base)return"";
 const have=new Set(base.match(/\d+(?:\.\d+)?[%％億兆元張]?/g)||[]);
 for(const x of sorted.slice(1)){
   const clauses=x.text.split(/[，；。]/).map(v=>v.trim()).filter(Boolean);
   for(const c of clauses){
     const nums=c.match(/\d+(?:\.\d+)?[%％億兆元張]?/g)||[];
     if(nums.some(n=>!have.has(n))&&c.length>=5&&base.length+c.length<105){base+=`，${c}`;nums.forEach(n=>have.add(n))}
   }
 }
 return digestCompress(base);
}
function buildNewsDigest(rows){
 const pool=[];
 for(const x of rows||[])for(const raw of (Array.isArray(x.summaryPoints)?x.summaryPoints:[])){
   const p=digestCompress(raw);if(p.length<7||digestMarketOnly(p))continue;
   let score=0;if(/\d/.test(p))score+=3;if(/訂單|能見度|營收|毛利率|EPS|獲利|產能|擴產|量產|資本支出|出貨|新產品|新技術|矽光子|CPO|CoWoS|客戶|營運|展望|持平|好轉|改善|優於/.test(p))score+=4;if(/主因|導致|較去年|年增|月增|季增/.test(p))score+=2;
   const tm=newsTime(x);pool.push({text:p,key:digestKey(p,tm),score,time:tm,sourceNewsKey:newsKey(x)});
 }
 const groups=new Map();for(const x of pool){if(!groups.has(x.key))groups.set(x.key,[]);groups.get(x.key).push(x)}
 const merged=[];for(const [key,list] of groups){const text=mergeDigestFacts(list);if(text)merged.push({text,key,score:Math.max(...list.map(x=>x.score)),time:Math.max(...list.map(x=>x.time))})}
 merged.sort((a,b)=>b.score-a.score||b.time-a.time);
 const kept=[];
 for(const x of merged){const n=x.text.replace(/[\s，。；、：:（）()]/g,"");if(kept.some(y=>n.length>16&&y.n.length>16&&(n.includes(y.n)||y.n.includes(n))))continue;kept.push({...x,n});if(kept.length>=10)break}
 return kept;
}

function readDigestState(code=newsCode()){
 const all=readNewsStore(NEWS_DIGEST_NEW_KEY),raw=all[String(code)]||{};
 return {known:Array.isArray(raw.known)?raw.known:[],pending:Array.isArray(raw.pending)?raw.pending:[],active:raw.active&&typeof raw.active==="object"?raw.active:{}};
}
function writeDigestState(state,code=newsCode()){const all=readNewsStore(NEWS_DIGEST_NEW_KEY);all[String(code)]=state;writeNewsStore(NEWS_DIGEST_NEW_KEY,all)}
function digestSnapshot(rows){return buildNewsDigest(rows).map(x=>x.key)}
function updateDigestNewState(beforeRows,afterRows,code=newsCode()){
 const before=digestSnapshot(beforeRows),after=digestSnapshot(afterRows),state=readDigestState(code),now=Date.now();
 state.active=Object.fromEntries(Object.entries(state.active||{}).filter(([,exp])=>Number(exp)>now));
 if(!state.known.length){state.known=before.length?before:after;state.pending=[];writeDigestState(state,code);return}
 const baseline=new Set([...state.known,...before]);
 for(const key of after)if(!baseline.has(key)&&!state.pending.includes(key)&&!state.active[key])state.pending.push(key);
 state.known=[...new Set([...state.known,...after])].slice(-120);state.pending=state.pending.filter(k=>after.includes(k));writeDigestState(state,code);
}
function activateDigestPending(code=newsCode()){
 const state=readDigestState(code),now=Date.now(),expiry=now+24*60*60*1000;
 state.active=Object.fromEntries(Object.entries(state.active||{}).filter(([,exp])=>Number(exp)>now));
 for(const key of state.pending)if(!state.active[key])state.active[key]=expiry;
 state.pending=[];writeDigestState(state,code);return state;
}
function isDigestNew(key){const state=readDigestState(),exp=Number(state.active?.[key]||0);return exp>Date.now()}
function renderNews(){
 const host=$("newsList");if(!host)return;
 if(newsFilter==="digest"){
   activateDigestPending();
   const pts=buildNewsDigest(newsRowsCache);
   host.innerHTML=pts.length?`<article class="news-item"><div class="news-summary" style="margin-top:0;padding-top:0;border-top:0"><b>近期新聞摘要</b><ul>${pts.map(p=>`<li>${escNews(p.text)}${isDigestNew(p.key)?'<em class="target-new news-new">NEW</em>':''}</li>`).join("")}</ul></div></article>`:`<div class="news-empty">目前沒有可整理的新聞重點。</div>`;
   return;
 }
 const rows=newsFilter==="match"?newsMatchRowsCache:newsRowsCache;
 if(!rows.length){host.innerHTML=`<div class="news-empty">${newsFilter==="match"?(currentNewsSummary()?"目前沒有搜尋到符合關鍵字的相關新聞。":"請先輸入自訂關鍵字。") : "目前沒有近期新聞。"}</div>`;return}
 host.innerHTML=rows.map((x,i)=>{const pts=Array.isArray(x.summaryPoints)?x.summaryPoints.filter(Boolean):(x.summary?String(x.summary).split("\n").filter(Boolean):[]);const summary=pts.length?`<ul>${pts.map(p=>`<li>${escNews(p)}</li>`).join("")}</ul>`:(x.contentAvailable?`<p>已取得內文，但暫無符合條件的重點</p>`:`<p>暫時無法取得內文</p>`);const starred=isNewsStarred(x),fresh=isNewsNew(x);return `<article class="news-item" data-news-read="${i}"><div class="news-head"><a class="news-title" href="${escNews(x.url||"#")}" target="_blank" rel="noopener">${escNews(x.title||"")}${fresh?'<em class="target-new news-new">NEW</em>':''}</a><button class="news-star ${starred?'active':''}" data-news-star="${i}" type="button" aria-label="${starred?'取消置頂':'置頂'}">${starred?'★':'☆'}</button></div><div class="news-meta">${escNews(x.source||"")} ${x.publishedAt?`｜${new Date(x.publishedAt).toLocaleDateString("zh-TW")}`:""}</div><div class="news-summary"><b>重點整理</b>${summary}</div></article>`}).join("");
 host.querySelectorAll("[data-news-star]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();const x=rows[Number(btn.dataset.newsStar)];if(!x)return;const set=newsSet(NEWS_STAR_KEY),k=newsKey(x);set.has(k)?set.delete(k):set.add(k);saveNewsSet(NEWS_STAR_KEY,set);newsRowsCache=mergeNews(newsRowsCache,[]);newsMatchRowsCache=mergeNews(newsMatchRowsCache,[]);renderNews()}));
 host.querySelectorAll("[data-news-read]").forEach(el=>el.addEventListener("click",e=>{if(e.target.closest(".news-star"))return;const x=rows[Number(el.dataset.newsRead)],set=newsSet(NEWS_UNREAD_KEY),k=newsKey(x);if(set.delete(k)){saveNewsSet(NEWS_UNREAD_KEY,set);renderNews()}}));
}
function loadNewsSummary(){const el=$("newsSummaryInput");if(el)el.value=currentNewsSummary();const st=$("newsSummaryStatus");if(st)st.textContent="此關鍵字會依目前股票分開保存"}
function beginNews(){const code=newsCode();newsRowsCache=mergeNews(readNewsStore(NEWS_CACHE_KEY)[code]?.rows||[],[]);newsMatchRowsCache=mergeNews(readNewsStore(NEWS_MATCH_CACHE_KEY)[code]?.rows||[],[]);loadNewsSummary();renderNews()}
function newsSince(rows){if(!rows?.length)return"";const newest=Math.max(...rows.map(newsTime));if(!Number.isFinite(newest)||newest<=0)return"";return new Date(newest-86400000).toISOString().slice(0,10)}
async function fetchNewsMode(code,name,mode,forceReset=false){
 const key=mode==="match"?NEWS_MATCH_CACHE_KEY:NEWS_CACHE_KEY,all=readNewsStore(key),cached=forceReset?[]:(all[String(code)]?.rows||[]),terms=mode==="match"?currentNewsSummary():"";
 if(mode==="match"&&!terms){newsMatchRowsCache=[];renderNews();return true}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
   const beforeRows=mode==="all"?mergeNews(cached,[]):[];
   const r=await fetch(`/api/news?code=${encodeURIComponent(code||"")}&name=${encodeURIComponent(name||"")}&mode=${mode}${terms?`&terms=${encodeURIComponent(terms)}`:""}&v=2517`,{cache:"no-store",signal:controller.signal});
   const data=await readJson(r,"新聞"),incoming=(data.items||[]).filter(x=>!blockedNewsItem(x)),oldKeys=new Set(cached.map(newsMergeKey)),unread=newsSet(NEWS_UNREAD_KEY,code);
   if(cached.length)for(const x of incoming)if(x?.title&&!oldKeys.has(newsMergeKey(x)))unread.add(newsKey(x));saveNewsSet(NEWS_UNREAD_KEY,unread,code);
   const merged=mergeNews(cached,incoming);all[String(code)]={rows:merged,query:terms,updatedAt:new Date().toISOString()};writeNewsStore(key,all);
   if(mode==="match")newsMatchRowsCache=merged;else{newsRowsCache=merged;updateDigestNewState(beforeRows,merged,code)}
   renderNews();return true;
 }finally{clearTimeout(timer)}
}
async function loadNews(code,name){return fetchNewsMode(code,name,"all")}
$("saveNewsSummary")?.addEventListener("click",async()=>{if(!currentStock)return setStatus("請先搜尋股票",true);const all=readNewsStore(NEWS_SUMMARY_KEY),code=newsCode(),val=$("newsSummaryInput")?.value.trim()||"";all[code]=val;writeNewsStore(NEWS_SUMMARY_KEY,all);loadNewsSummary();const match=readNewsStore(NEWS_MATCH_CACHE_KEY);delete match[code];writeNewsStore(NEWS_MATCH_CACHE_KEY,match);newsMatchRowsCache=[];renderNews();if(val){setStatus("搜尋關鍵字相關新聞…");try{await fetchNewsMode(code,currentStock?.name||currentStock?.shortName||"","match",true);setStatus("關鍵字與相關新聞已更新")}catch(e){setStatus(`關鍵字已儲存，相關新聞搜尋失敗：${e.message}`,true)}}else setStatus("關鍵字已儲存")});
document.querySelectorAll("[data-news-filter]").forEach(btn=>btn.addEventListener("click",async()=>{document.querySelectorAll("[data-news-filter]").forEach(x=>x.classList.remove("active"));btn.classList.add("active");newsFilter=btn.dataset.newsFilter||"all";renderNews();if(newsFilter==="match"&&currentStock&&currentNewsSummary()){const store=readNewsStore(NEWS_MATCH_CACHE_KEY),row=store[newsCode()];if(!row||row.query!==currentNewsSummary()){try{await fetchNewsMode(newsCode(),currentStock?.name||currentStock?.shortName||"","match",true)}catch(e){console.warn("關鍵字新聞搜尋失敗",e)}}}}));

// ---------- holdings / watchlist ----------
function readList(type){
  try{const v=JSON.parse(localStorage.getItem(LIST_KEYS[type])||"[]");return Array.isArray(v)?v:[]}catch{return[]}
}
function writeList(type,rows){localStorage.setItem(LIST_KEYS[type],JSON.stringify(rows))}
function stockKey(x){return String(x?.code||x?.symbol||"")}
function snapshotStock(x){
  return {code:x.code||x.symbol||"",name:shortStockName(x.name||x.shortName),last:Number(x.last??x.price??x.regularMarketPrice),market:x.market||"台股",savedAt:new Date().toISOString()}
}
function inList(type,stock){
  const key=stockKey(stock);return !!key&&readList(type).some(x=>stockKey(x)===key)
}
function addToList(type){
  if(!currentStock)return setStatus("請先搜尋股票",true);
  const rows=readList(type),item=snapshotStock(currentStock),key=stockKey(item);
  const exists=rows.some(x=>stockKey(x)===key);
  if(exists){
    writeList(type,rows.filter(x=>stockKey(x)!==key));
    renderLists();updateListButtons();
    setStatus(`${item.name||item.code} 已從${type==="holdings"?"持股":"觀察"}清單移除`);
    return;
  }
  rows.unshift(item);writeList(type,rows);
  renderLists();updateListButtons();
  setStatus(`${item.name||item.code} 已加入${type==="holdings"?"持股":"觀察"}清單`);
}
function removeFromList(type,code){
  writeList(type,readList(type).filter(x=>stockKey(x)!==String(code)));
  renderLists();updateListButtons();
}
function renderOneList(type,hostId){
  const host=$(hostId),rows=readList(type);
  if(!host)return;
  host.innerHTML=rows.length?rows.map(x=>`<div class="manage-stock">
    <div class="manage-stock-main" data-search-stock="${x.code}">
      <strong>${x.name||"—"} <small>${x.code}</small></strong>
    </div>
    <small class="list-market">${x.market||"台股"}</small>
    <strong class="list-price">${targetFmt(x.last)}</strong>
    <button class="remove-list" type="button" data-remove-type="${type}" data-remove-code="${x.code}" aria-label="刪除">×</button>
  </div>`).join(""):`<div class="manage-empty">${type==="holdings"?"尚無持股":"尚無觀察股票"}</div>`;
  host.querySelectorAll("[data-search-stock]").forEach(el=>el.addEventListener("click",()=>{
    $("stockCode").value=el.dataset.searchStock; search(); window.scrollTo({top:0,behavior:"smooth"});
  }));
  host.querySelectorAll("[data-remove-type]").forEach(btn=>btn.addEventListener("click",()=>removeFromList(btn.dataset.removeType,btn.dataset.removeCode)));
}
function renderLists(){
  renderOneList("holdings","holdingsCards");renderOneList("watchlist","watchlistCards");
  setText("holdingsCount",readList("holdings").length);setText("watchlistCount",readList("watchlist").length);
}
function updateListButtons(){
  const h=$("addHoldingBtn"),w=$("addWatchBtn");
  h?.classList.toggle("in-list",currentStock&&inList("holdings",currentStock));
  w?.classList.toggle("in-list",currentStock&&inList("watchlist",currentStock));
  if(h)h.textContent=currentStock&&inList("holdings",currentStock)?"✓ 已在持股":"＋ 持股";
  if(w)w.textContent=currentStock&&inList("watchlist",currentStock)?"★ 已觀察":"☆ 觀察";
}
$("addHoldingBtn")?.addEventListener("click",()=>addToList("holdings"));
$("addWatchBtn")?.addEventListener("click",()=>addToList("watchlist"));
document.querySelectorAll("[data-manage-tab]").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll("[data-manage-tab]").forEach(b=>b.classList.toggle("active",b===btn));
  document.querySelectorAll("[data-manage-panel]").forEach(p=>p.classList.toggle("active",p.dataset.managePanel===btn.dataset.manageTab));
}));
function setManagementTab(type){document.querySelectorAll("[data-manage-tab]").forEach(b=>b.classList.toggle("active",b.dataset.manageTab===type));document.querySelectorAll("[data-manage-panel]").forEach(p=>p.classList.toggle("active",p.dataset.managePanel===type));document.querySelectorAll("[data-manage-page]").forEach(b=>b.classList.toggle("active",b.dataset.managePage===type))}
document.querySelectorAll("[data-manage-page]").forEach(btn=>btn.addEventListener("click",()=>setManagementTab(btn.dataset.managePage)));
document.querySelectorAll("[data-manage-jump]").forEach(btn=>btn.addEventListener("click",()=>{setManagementTab(btn.dataset.manageJump);setView("management")}));
document.querySelectorAll("[data-search-jump]").forEach(btn=>btn.addEventListener("click",()=>{
  $("stockCode")?.focus();window.scrollTo({top:0,behavior:"smooth"});
}));

const AUTO_QUOTE_MS=5*60*1000,AUTO_TARGET_MS=2*60*60*1000;
let autoRefreshing=false;
async function autoRefreshLists(force=false){
 if(autoRefreshing)return; autoRefreshing=true;
 try{
  const types=["holdings","watchlist"],byCode=new Map();
  for(const type of types)for(const x of readList(type))if(x.code)byCode.set(String(x.code),x);
  for(const [code,base] of byCode){
   let q=base;
   const quoteDue=force||!base.quoteUpdatedAt||Date.now()-new Date(base.quoteUpdatedAt).getTime()>=AUTO_QUOTE_MS;
   const targetDue=force||!base.targetUpdatedAt||Date.now()-new Date(base.targetUpdatedAt).getTime()>=AUTO_TARGET_MS;
   if(quoteDue){try{const d=await quote(code);q={...q,last:Number(d.last??d.price??d.regularMarketPrice),name:shortStockName(d.name||d.shortName||q.name),quoteUpdatedAt:new Date().toISOString()}}catch(e){console.warn("清單股價更新失敗",code,e)}}
   if(targetDue){try{const payload=await fetchTargetPayload(code,q.name||"");const fresh=normalizeTargetRows(payload),cache=readTargetCache(),old=cache[code]?.rows||[],merged=mergeTargetRows(old,fresh),main=pickMainTarget(merged);cache[code]={rows:merged,updatedAt:new Date().toISOString()};writeTargetCache(cache);q={...q,target:main?targetPriceValue(main.latest):q.target,targetBroker:main?targetBrokerName(main.row):q.targetBroker,targetUpdatedAt:new Date().toISOString()}}catch(e){console.warn("清單目標價更新失敗",code,e)}}
   for(const type of types){const rows=readList(type),i=rows.findIndex(x=>String(x.code)===code);if(i>=0){rows[i]={...rows[i],...q};writeList(type,rows)}}
   renderLists();
  }
 }finally{autoRefreshing=false}
}
setTimeout(()=>autoRefreshLists(true),800);
setInterval(()=>autoRefreshLists(false),AUTO_QUOTE_MS);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")autoRefreshLists(false)});

renderLists();

function setView(view){
  const screeningViews=new Set(["screening","fundflow","featured","simulation"]),management=view==="management";
  const mode=screeningViews.has(view)?"screening":management?"management":"analysis";
  document.body.classList.remove("mode-analysis","mode-screening","mode-management");
  document.body.classList.add(`mode-${mode}`);
  if(view==="screening")view="fundflow";
  document.body.classList.toggle("view-overview",view==="overview");
  document.querySelectorAll("[data-view-panel]").forEach(p=>p.classList.toggle("active-view",p.dataset.viewPanel===view));
  document.querySelectorAll(".section-tabs [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".side-group [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".bottom-nav [data-view]").forEach(b=>b.classList.toggle("active",mode==="analysis"&&b.dataset.view==="overview"?view==="overview":mode==="screening"&&b.dataset.view==="screening"));
  $("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show");
  window.scrollTo({top:mode==="analysis"?(document.querySelector(".stock-head")?.offsetTop||0):0,behavior:"smooth"});
}
document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
document.querySelectorAll("[data-view-open]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.viewOpen)));
setView("overview");

document.querySelectorAll(".settings-open").forEach(btn=>btn.addEventListener("click",()=>{
  $("settingsModal")?.classList.remove("hidden");
  $("sidebar")?.classList.remove("open"); $("overlay")?.classList.remove("show");
}));
$("closeSettings")?.addEventListener("click",()=>$("settingsModal")?.classList.add("hidden"));
$("settingsModal")?.addEventListener("click",e=>{if(e.target===$("settingsModal"))$("settingsModal").classList.add("hidden")});


// v2.5.1.11 valuation formula and definition info
(function(){
 const formulas={
  pe:{title:"PE／PS 合理價",text:"獲利公司：近四季 EPS × 同業平均 PE；近四季虧損：每股營收 × 同業 PS 中位數"},
  pb:{title:"PB 合理價",text:"每股淨值（BPS）× 同業平均 PB"},
  composite:{title:"綜合合理價",text:"獲利公司使用 PE 合理價；虧損公司以 PS 合理價補位，再與 PB 合理價各 50% 合併。"},
  epsdef:{title:"EPS 獲利能力",text:"EPS 是每股盈餘，代表公司每一股普通股能分配到多少獲利；數值越高，代表每股獲利能力越強。"},
  pedef:{title:"本益比",text:"本益比＝股價 ÷ 每股盈餘（EPS），代表市場願意用多少倍的價格購買公司目前的每股獲利。"},
  psdef:{title:"股價營收比",text:"股價營收比（PS）＝股價 ÷ 每股營收，代表市場願意用多少倍的價格購買公司每股所創造的營收；當近四季 EPS 為負、PE 不適用時，用 PS 作為營運估值的替代指標。"},
  pbdef:{title:"股價淨值比",text:"股價淨值比＝股價 ÷ 每股淨值（BPS），代表股價相對公司每股帳面淨資產價值的倍數。"}
 };
 const pop=$("valuationFormulaPopover"), title=$("valuationFormulaTitle"), text=$("valuationFormulaText");
 document.addEventListener("click",e=>{
  const btn=e.target.closest?.(".formula-info");
  if(btn&&pop){const f=formulas[btn.dataset.formula];if(f){title.textContent=f.title;text.textContent=f.text;pop.hidden=false;}return;}
  if(e.target.closest?.(".formula-popover-close")){if(pop)pop.hidden=true;}
 });
})();
