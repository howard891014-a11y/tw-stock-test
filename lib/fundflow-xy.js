// StockZone v2.6.5.28 — Stock-First Robust Market-State XY Engine v6.0 + manual DB-only snapshot warm
// Y = literal business-weighted 5-session constituent price return. Price remains the primary profit axis.
// X is built stock-first: each stock keeps the literal sign of 5D institutional net-flow / turnover,
// then its distance from zero is scaled continuously against that stock's own PRIOR rolling history.
// Topic X is a capped robust aggregation of stock X scores; one hot large-cap cannot own the whole topic.
// Missing flow is abstain, never fake zero. Breadth/votes/persistence/reliability are Confirmation (C), not X.
// Credit stays Chip Quality; overheating/divergence stays Exhaustion (E). No future observation enters normalization.

function getSql(){ return require('./db').getSql(); }
const { resolveCompanyBusinessTags, parseAutoBusinessTags } = require('./company-business-tags');
const { classifyBusinessText } = require('./business-enrichment');
const { marketTopicLinks, listMarketDefinitions } = require('./market-topic-taxonomy');
const { ensureInstitutionalHistorySchema } = require('./institutional-history');
const { ensureCreditTradingSchema } = require('./credit-trading');

const ENGINE_VERSION = 'xy-6.0.0-stock-robust-flow-price';
const DEFAULT_TRAJECTORY_DAYS = 15;
const ENGINE_HISTORY_DAYS = 60;
const STOCK_FLOW_LOOKBACK_DAYS = 60;
const STOCK_FLOW_MIN_HISTORY_DAYS = 20;
const STOCK_FLOW_SCALE_FLOOR_PCT = 0.08;
const STOCK_FLOW_TANH_DIVISOR = 2.2;
const TOPIC_SINGLE_STOCK_CAP = 0.25;
const VOTE_NEUTRAL_SCORE = 10;
// Compatibility aliases for older callers/diagnostics. v6 no longer applies a topic-level percentile.
const SELF_RELATIVE_LOOKBACK_DAYS = STOCK_FLOW_LOOKBACK_DAYS;
const SELF_RELATIVE_MIN_HISTORY_DAYS = STOCK_FLOW_MIN_HISTORY_DAYS;
const PREPARED_SNAPSHOT_DAYS = Object.freeze([5,10,15]);
const IMPORTANCE_WEIGHT = Object.freeze({ core:1, important:0.5, related:0.2 });
const NON_CORE_EXPOSURE_BUDGET = null;
const PHASES = Object.freeze({
  cold:{key:'cold',label:'混沌／方向未明',order:0},
  germination:{key:'germination',label:'資金先行',order:1},
  potential:{key:'potential',label:'資金先行',order:2},
  mainline:{key:'mainline',label:'共振轉強',order:3},
  overheating:{key:'overheating',label:'強勢延續',order:4},
  cooling:{key:'cooling',label:'轉弱',order:5},
  transition:{key:'transition',label:'混沌／方向未明',order:null},
});
let schemaReady = false;
const memoryCache = new Map();
const browserMemoryCache = new Map();
const detailMemoryCache = new Map();

function num(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function clamp(v,lo=0,hi=100){return Math.max(lo,Math.min(hi,Number(v)||0));}
function clampRange(v,lo,hi){const n=Number(v);return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):0;}
function flowPhaseScore(v){return clamp(50+(num(v)??0)*0.5);}
function pricePhaseScore(v){return clamp(50+(num(v)??0)*5);}
function round(v,d=1){const p=10**d;return Math.round((Number(v)||0)*p)/p;}
function roundNullable(v,d=1){const n=num(v);if(n===null)return null;const p=10**d;return Math.round(n*p)/p;}
function isoDate(v){
  if(!v)return '';
  if(typeof v==='string')return v.slice(0,10);
  if(v instanceof Date && Number.isFinite(v.getTime()))return v.toISOString().slice(0,10);
  return String(v).slice(0,10);
}
function importanceWeight(v){return IMPORTANCE_WEIGHT[String(v||'related')]||0.2;}
function median(values){
  const a=(values||[]).map(num).filter(v=>v!==null).sort((x,y)=>x-y);if(!a.length)return null;
  const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function quantile(values,q){
  const a=(values||[]).map(num).filter(v=>v!==null).sort((x,y)=>x-y);if(!a.length)return null;if(a.length===1)return a[0];
  const p=Math.max(0,Math.min(1,q))*(a.length-1),lo=Math.floor(p),hi=Math.ceil(p),t=p-lo;return a[lo]*(1-t)+a[hi]*t;
}
function mad(values,center=median(values)){
  const c=num(center);if(c===null)return null;return median((values||[]).map(v=>{const n=num(v);return n===null?null:Math.abs(n-c)}));
}
function stockFlowScale(history){
  const mags=(history||[]).map(v=>Math.abs(num(v)??NaN)).filter(Number.isFinite);if(!mags.length)return STOCK_FLOW_SCALE_FLOOR_PCT;
  const med=median(mags)??0,m=mad(mags,med)??0;return Math.max(STOCK_FLOW_SCALE_FLOOR_PCT,med+1.4826*m);
}
function continuousStockFlowScore(raw,historyLength,scale){
  const r=num(raw);if(r===null)return null;if(r===0)return 0;
  const maturity=Math.min(1,Math.max(0,Number(historyLength)||0)/STOCK_FLOW_MIN_HISTORY_DAYS),z=Math.abs(r)/Math.max(STOCK_FLOW_SCALE_FLOOR_PCT,num(scale)??STOCK_FLOW_SCALE_FLOOR_PCT);
  return sign(r)*100*Math.tanh(z/STOCK_FLOW_TANH_DIVISOR)*maturity;
}
function capWeightShares(entries,baseCap=TOPIC_SINGLE_STOCK_CAP){
  const usable=(entries||[]).map((x,i)=>({i,w:Math.max(0,num(x?.baseWeight)??0)})).filter(x=>x.w>0),out=new Array((entries||[]).length).fill(0);if(!usable.length)return out;
  const n=usable.length,cap=Math.min(1,Math.max(baseCap,1/n+.10));let free=new Set(usable.map(x=>x.i)),fixed=new Map(),remaining=1;
  for(let guard=0;guard<12&&free.size;guard++){const sum=[...free].reduce((a,i)=>a+(usable.find(x=>x.i===i)?.w||0),0);if(sum<=0)break;let clipped=false;for(const i of [...free]){const w=usable.find(x=>x.i===i)?.w||0,share=remaining*w/sum;if(share>cap+1e-12){fixed.set(i,cap);free.delete(i);remaining-=cap;clipped=true;}}if(!clipped){for(const i of free){const w=usable.find(x=>x.i===i)?.w||0;fixed.set(i,remaining*w/sum);}free.clear();}}
  const total=[...fixed.values()].reduce((a,b)=>a+b,0)||1;for(const [i,w] of fixed)out[i]=w/total;return out;
}
function phaseMeta(key){return PHASES[key]||PHASES.transition;}
function resolveProfileBusinessTags(p={}){
  const existing=parseAutoBusinessTags(p.auto_business_tags);
  const live=classifyBusinessText(p.main_business||'',{industryCode:p.industry_code,code:p.stock_code||p.symbol,allowBroad:false});
  const merged=[...new Set([...existing,...live])];
  return resolveCompanyBusinessTags({
    stock_code:p.stock_code||p.symbol,stock_name:p.stock_name||p.name,name:p.stock_name||p.name,market:p.market,
    industry_code:p.industry_code,industry:p.industry,auto_business_tags:merged
  });
}

function buildBusinessBrowserCatalog(profiles=[],snapshot={}){
  const companyMap=new Map();
  for(const p of profiles||[]){
    const resolved=resolveProfileBusinessTags(p);
    const seen=new Set(),companyName=resolved.name||String(p.stock_name||p.name||''),companyCode=resolved.symbol||String(p.stock_code||p.symbol||'');
    const marketLinks=marketTopicLinks(resolved.tags||[],companyName,companyCode,{main_business:p.main_business,auto_market_topics:p.auto_market_topics});
    for(const link of marketLinks){
      if(!link?.id||seen.has(link.id))continue;seen.add(link.id);
      const cur=companyMap.get(link.id)||{companyCount:0,examples:[],companyNames:[],companyCodes:[]};cur.companyCount++;
      if(companyName&&!cur.companyNames.includes(companyName))cur.companyNames.push(companyName);
      if(companyCode&&!cur.companyCodes.includes(companyCode))cur.companyCodes.push(companyCode);
      if(cur.examples.length<5)cur.examples.push({code:companyCode,name:companyName});
      companyMap.set(link.id,cur);
    }
  }
  const groupMap=new Map((snapshot?.groups||[]).map(g=>[g.tagId,g]));
  const definitions=listMarketDefinitions();
  const items=definitions.map(tag=>{
    const company=companyMap.get(tag.id)||{companyCount:0,examples:[],companyNames:[],companyCodes:[]},g=groupMap.get(tag.id)||null;
    const scope=tag.scope||'traditional-coarse',companyCount=Number(company.companyCount||0);
    const trajectoryLength=Array.isArray(g?.trajectory)?g.trajectory.length:0,validCount=Number(g?.validCount||0);
    const xyEligible=Boolean(g&&validCount>=2&&trajectoryLength>=2);
    let noXYReason='';
    if(!companyCount)noXYReason='尚無公司映射';
    else if(companyCount<2)noXYReason='資料不足（僅 1 家）';
    else if(!g)noXYReason='資料不足（尚無 activity-ready XY）';
    else if(validCount<2)noXYReason=`資料不足（有效 ${validCount}/${companyCount} 家）`;
    else if(trajectoryLength<2)noXYReason='資料不足（XY 軌跡不足 2 日）';
    return {
      tagId:tag.id,name:tag.name,parentId:tag.parentId||'',parentName:tag.parentName||'',kind:tag.kind,resolution:tag.resolution,scope,
      aliases:[...(tag.aliases||[])],companyCount,examples:company.examples,companyNames:company.companyNames||[],companyCodes:company.companyCodes||[],represented:companyCount>0,
      hasXY:Boolean(g),xyEligible,noXYReason,asOf:snapshot?.asOf||'',
      x:g?.x??null,y:g?.y??null,rawX:g?.rawX??null,rawY:g?.rawY??null,xPercentile:g?.selfRelativeXPercentile??null,xHistoryDays:g?.xHistoryDays??null,quadrant:g?.quadrant||'',status:g?.status||'',statusLabel:g?.statusLabel||'',
      phaseState:g?.phaseState||'',phaseLabel:g?.phaseLabel||'',phaseConfidence:g?.phaseConfidence??null,
      confirmation:g?.confirmation??null,overheating:g?.overheating??null,projection:g?.projection||null,
      validCount:g?.validCount??0,memberCount:g?.memberCount??companyCount,coveragePct:g?.coveragePct??0,reliability:g?.reliability??0,
      dx3:g?.dx3??null,dy3:g?.dy3??null,leaders:Array.isArray(g?.leaders)?g.leaders.slice(0,5):[]
    };
  }).sort((a,b)=>{
    const order={'technology-fine':0,'electronics-product':1,'traditional-coarse':2,'other':3};
    return (order[a.scope]-order[b.scope])||(b.companyCount-a.companyCount)||a.name.localeCompare(b.name,'zh-Hant');
  });
  const count=fn=>items.filter(fn).length;
  return {
    ok:true,asOf:snapshot?.asOf||'',engineVersion:snapshot?.engineVersion||ENGINE_VERSION,
    counts:{
      totalDefinitions:items.length,technologyFineDefinitions:count(x=>x.scope==='technology-fine'),technologyFallbackDefinitions:0,
      traditionalDefinitions:count(x=>x.scope==='traditional-coarse'),otherDefinitions:0,representedDefinitions:count(x=>x.represented),withXY:count(x=>x.xyEligible),withoutXY:count(x=>!x.xyEligible),
      zeroMemberDefinitions:count(x=>x.companyCount===0),singleMemberDefinitions:count(x=>x.companyCount===1)
    },items
  };
}

function percentileRanks(values){
  const usable=values.map((v,i)=>({v:num(v),i})).filter(x=>x.v!==null).sort((a,b)=>a.v-b.v);
  const out=new Array(values.length).fill(50),n=usable.length;if(!n)return out;if(n===1){out[usable[0].i]=50;return out;}
  let p=0;while(p<n){let q=p+1;while(q<n&&usable[q].v===usable[p].v)q++;const mid=(p+q-1)/2,score=mid/(n-1)*100;for(let k=p;k<q;k++)out[usable[k].i]=score;p=q;}return out;
}
function percentileRanksNullable(values){
  const usable=values.map((v,i)=>({v:num(v),i})).filter(x=>x.v!==null).sort((a,b)=>a.v-b.v);
  const out=new Array(values.length).fill(null),n=usable.length;if(!n)return out;if(n===1){out[usable[0].i]=50;return out;}
  let p=0;while(p<n){let q=p+1;while(q<n&&usable[q].v===usable[p].v)q++;const mid=(p+q-1)/2,score=mid/(n-1)*100;for(let k=p;k<q;k++)out[usable[k].i]=score;p=q;}return out;
}

function weightedMean(items,key){let sum=0,w=0;for(const item of items){const v=num(item[key]),ww=num(item.weight);if(v===null||ww===null||ww<=0)continue;sum+=v*ww;w+=ww;}return w?sum/w:null;}
function weightedMedian(items,key){
  const arr=items.map(x=>({v:num(x[key]),w:num(x.weight)})).filter(x=>x.v!==null&&x.w!==null&&x.w>0).sort((a,b)=>a.v-b.v);
  const total=arr.reduce((s,x)=>s+x.w,0);if(!total)return null;let c=0;for(const x of arr){c+=x.w;if(c>=total/2)return x.v;}return arr.at(-1)?.v??null;
}
function weightedShare(items,predicate){let yes=0,total=0;for(const item of items){const w=num(item.weight);if(w===null||w<=0)continue;total+=w;if(predicate(item))yes+=w;}return total?yes/total*100:null;}

function sign(v){const n=num(v);return n===null||n===0?0:(n>0?1:-1);}
function pctChange(current,prior){const a=num(current),b=num(prior);return a===null||b===null||Math.abs(b)<1?null:(a-b)/Math.abs(b)*100;}
function weightedAverageAvailable(parts){let sum=0,w=0;for(const [value,weight] of parts){const v=num(value);if(v===null||!Number.isFinite(weight)||weight<=0)continue;sum+=v*weight;w+=weight;}return w?sum/w:50;}

// Build rolling institutional-flow and credit-quality features once for the
// whole engine input.  Institutional quantities are official shares; we
// convert them to an approximate net-flow value with the daily close (or VWAP
// fallback) and normalize by turnover so large caps do not dominate merely
// because their absolute foreign-flow shares are large.
function enrichFlowFeatures(rows){
  const copied=(rows||[]).map(r=>({...r})),byCode=new Map();
  for(const row of copied){const code=String(row.stock_code||'').trim();if(!code)continue;if(!byCode.has(code))byCode.set(code,[]);byCode.get(code).push(row);}
  for(const list of byCode.values()){
    list.sort((a,b)=>isoDate(a.trade_date).localeCompare(isoDate(b.trade_date)));
    const priorFlow5=[];
    for(let i=0;i<list.length;i++){
      const row=list[i],tradeValue=num(row.trade_value),tradeVolume=num(row.trade_volume),close=num(row.close_price);
      const avgPrice=close!==null?close:(tradeValue!==null&&tradeVolume>0?tradeValue/tradeVolume:null);
      const totalShares=num(row.institutional_total_net);
      row.inst_net_value=totalShares!==null&&avgPrice!==null?totalShares*avgPrice:null;
      const rolling=(days,key='inst_net_value')=>{
        let flow=0,value=0,valid=0;
        for(let j=Math.max(0,i-days+1);j<=i;j++){
          const f=num(list[j][key]),tv=num(list[j].trade_value);
          if(f===null||tv===null||tv<=0)continue;flow+=f;value+=tv;valid++;
        }
        return {ratio:value>0&&valid?flow/value*100:null,value:valid?flow:null,turnover:valid?value:null,days:valid};
      };
      const r1=rolling(1),r5=rolling(5),r10=rolling(10),r20=rolling(20);
      row.inst_flow_ratio_1=r1.ratio;row.inst_flow_ratio_5=r5.ratio;row.inst_flow_ratio_10=r10.ratio;row.inst_flow_ratio_20=r20.ratio;
      row.inst_flow_value_1=r1.value;row.inst_flow_value_5=r5.value;row.inst_flow_value_10=r10.value;row.inst_flow_value_20=r20.value;
      row.inst_turnover_value_1=r1.turnover;row.inst_turnover_value_5=r5.turnover;row.inst_turnover_value_10=r10.turnover;row.inst_turnover_value_20=r20.turnover;
      row.inst_flow_days_1=r1.days;row.inst_flow_days_5=r5.days;row.inst_flow_days_10=r10.days;row.inst_flow_days_20=r20.days;

      // v6 stock-first causal normalization. The current observation never enters its own baseline.
      const raw5=num(r5.ratio),history=priorFlow5.slice(-STOCK_FLOW_LOOKBACK_DAYS),scale=stockFlowScale(history),historyDays=history.length;
      const maturity=Math.min(1,historyDays/STOCK_FLOW_MIN_HISTORY_DAYS),dayCoverage=Math.min(1,r5.days/5),stockFlowReliability=maturity*dayCoverage;
      row.stock_flow_scale=scale;row.stock_flow_history_days=historyDays;row.stock_flow_maturity_pct=maturity*100;row.stock_flow_reliability=stockFlowReliability;
      row.stock_flow_score=raw5===null?null:continuousStockFlowScore(raw5,historyDays,scale);
      if(raw5!==null){priorFlow5.push(raw5);if(priorFlow5.length>STOCK_FLOW_LOOKBACK_DAYS)priorFlow5.splice(0,priorFlow5.length-STOCK_FLOW_LOOKBACK_DAYS);}

      let streak=0,lastSign=0;
      for(let j=i;j>=0&&i-j<10;j--){const s=sign(list[j].institutional_total_net);if(!s)break;if(!lastSign)lastSign=s;if(s!==lastSign)break;streak+=s;}
      row.inst_streak=streak;
      const directions=[row.institutional_foreign_net,row.institutional_trust_net,row.institutional_dealer_net].map(sign);
      row.inst_agreement=directions.reduce((sum,x)=>sum+x,0)/3*100;

      const start5=list[Math.max(0,i-4)]||row;
      const margin5Pct=pctChange(row.margin_balance,num(start5.margin_prev_balance)??num(start5.margin_balance));
      const short5Pct=pctChange(row.short_balance,num(start5.short_prev_balance)??num(start5.short_balance));
      const sbl5Pct=pctChange(row.sbl_balance,num(start5.sbl_prev_balance)??num(start5.sbl_balance));
      const price5=num(row.return_5_pct),inst5=num(row.inst_flow_ratio_5);
      const hasCredit=[row.margin_balance,row.short_balance,row.sbl_balance].some(v=>num(v)!==null);
      let correction=0;
      if(hasCredit){
        if(inst5!==null&&price5!==null&&margin5Pct!==null){
          if(inst5>0&&price5>0&&margin5Pct<0)correction+=5;
          if(inst5<0&&price5<0&&margin5Pct>0)correction-=6;
          if(price5>=5&&margin5Pct>=5)correction-=4;
          if(price5<=-5&&margin5Pct>=5)correction-=2;
        }
        if(short5Pct!==null&&price5!==null){if(short5Pct>2&&price5>0)correction+=2;if(short5Pct<-4&&price5>0)correction+=1;}
        if(sbl5Pct!==null&&price5!==null&&inst5!==null){if(sbl5Pct>3&&price5<0&&inst5<0)correction-=3;if(sbl5Pct<-3&&price5>0&&inst5>0)correction+=1;}
      }
      row.credit_correction=clamp(correction,-15,15);
      row.margin_5_pct=margin5Pct;row.short_5_pct=short5Pct;row.sbl_5_pct=sbl5Pct;row._flowEnriched=true;
    }
  }
  return copied;
}

// Stock-level X is now the stock's own causal robust institutional-flow score.
// raw institutional flow remains separately available as stockInstitutionalX.
function scoreStocksForDate(rows){
  const r=rows.map(x=>({...x}));
  const ranks={value_ratio_20:percentileRanks(r.map(x=>x.value_ratio_20)),value_trend_5_15:percentileRanks(r.map(x=>x.value_trend_5_15))};
  return r.map((x,i)=>{
    const legacyX=.55*ranks.value_ratio_20[i]+.45*ranks.value_trend_5_15[i];
    const rawFlow=num(x.inst_flow_ratio_5),flowScore=num(x.stock_flow_score),priceReturnPct=num(x.return_5_pct)??num(x.change_pct);
    return {...x,
      stockX:roundNullable(flowScore,3),stockFlowScore:roundNullable(flowScore,3),stockInstitutionalX:roundNullable(rawFlow,4),
      stockFlowScale:round(num(x.stock_flow_scale)??STOCK_FLOW_SCALE_FLOOR_PCT,4),stockFlowHistoryDays:Number(x.stock_flow_history_days||0),stockFlowReliability:round((num(x.stock_flow_reliability)??0)*100,1),
      creditCorrection:clamp(num(x.credit_correction)??0,-15,15),legacyStockX:clamp(legacyX),stockY:priceReturnPct===null?null:round(priceReturnPct,4),rankValueRatio20:ranks.value_ratio_20[i],rankValueTrend515:ranks.value_trend_5_15[i],persistenceScore:clamp((num(x.positive_days_5)??2.5)/5*100)
    };
  });
}

function applyCompanyExposureBudget(links=[]){
  // Compatibility helper only. Topic relevance is local to each topic in v4:
  // adding another valid topic must not dilute this topic's own relevance weight.
  return (links||[]).map(link=>({...link,baseWeight:importanceWeight(link.importance),weight:importanceWeight(link.importance),exposureScale:1}));
}
function buildProfileTagMap(profiles){
  const byCode=new Map(),tagMeta=new Map();
  for(const p of profiles||[]){
    const code=String(p.stock_code||p.symbol||'').trim();if(!code)continue;
    const resolved=resolveProfileBusinessTags({...p,stock_code:code});
    const rawLinks=marketTopicLinks(resolved.tags||[],resolved.name||p.stock_name||p.name||'',resolved.symbol||code,{main_business:p.main_business,auto_market_topics:p.auto_market_topics});
    const links=applyCompanyExposureBudget(rawLinks).map(link=>{
      const out={...link,scope:link.scope|| (link.technology?'technology-fine':'traditional-coarse'),parentName:link.parentName||''};
      if(!tagMeta.has(link.id))tagMeta.set(link.id,{tagId:link.id,name:link.name,parent:'',parentName:out.parentName,scope:out.scope,resolution:link.resolution||'market-topic',technology:Boolean(link.technology)});
      return out;
    });
    byCode.set(code,{...p,code,resolved,links});
  }
  const denominator=new Map();for(const profile of byCode.values())for(const link of profile.links){const cur=denominator.get(link.id)||{memberCount:0,totalWeight:0};cur.memberCount++;cur.totalWeight+=link.weight;denominator.set(link.id,cur);}
  return {byCode,tagMeta,denominator};
}
function tagItem(row,profile,link){return {...row,weight:link.weight,importance:link.importance,companyName:profile.stock_name||row.stock_name||'',market:profile.market||row.market||''};}


function topicFlowItems(items){
  const valid=(items||[]).filter(x=>num(x.stockFlowScore??x.stockX)!==null&&num(x.inst_flow_ratio_5)!==null);
  if(!valid.length)return [];
  const turnovers=valid.map(x=>num(x.inst_turnover_value_5)).filter(v=>v!==null&&v>0),medTurnover=median(turnovers)||1;
  const entries=valid.map(item=>{
    const turnover=Math.max(0,num(item.inst_turnover_value_5)??0),liquidity=turnover>0?clampRange(Math.sqrt(turnover/medTurnover),.5,2.5):.5;
    const reliability=clampRange((num(item.stock_flow_reliability)??0),0,1),businessWeight=Math.max(.01,num(item.weight)??importanceWeight(item.importance));
    return {item,baseWeight:businessWeight*liquidity*Math.max(.15,reliability),liquidity,reliability,businessWeight};
  });
  const shares=capWeightShares(entries,TOPIC_SINGLE_STOCK_CAP);
  return entries.map((x,i)=>({...x,topicWeight:shares[i]}));
}
function weightedByTopic(flowEntries,key){let sum=0,w=0;for(const e of flowEntries||[]){const v=num(e.item?.[key]),ww=num(e.topicWeight);if(v===null||ww===null||ww<=0)continue;sum+=v*ww;w+=ww;}return w?sum/w:null;}
function topicVoteMetrics(flowEntries){
  let buy=0,sell=0,neutral=0,abstain=0,coreBuy=0,coreSell=0,coreNeutral=0,coreTotal=0,instAgreement=0,persistence=0,rel=0,total=0;
  for(const e of flowEntries||[]){const item=e.item,w=num(e.topicWeight)??0,score=num(item.stockFlowScore??item.stockX),raw=num(item.inst_flow_ratio_5),importance=String(item.importance||'related');if(w<=0)continue;total+=w;rel+=w*clampRange((num(item.stock_flow_reliability)??0)*100,0,100);
    if(score===null||raw===null){abstain+=w;continue;}const vote=Math.abs(score)<VOTE_NEUTRAL_SCORE?0:sign(raw);if(vote>0)buy+=w;else if(vote<0)sell+=w;else neutral+=w;
    if(importance==='core'){coreTotal+=w;if(vote>0)coreBuy+=w;else if(vote<0)coreSell+=w;else coreNeutral+=w;}
    instAgreement+=w*Math.abs(num(item.inst_agreement)??0);
    const st=num(item.inst_streak)??0,aligned=sign(st)!==0&&sign(st)===sign(raw)?Math.min(100,Math.abs(st)*20):0;persistence+=w*aligned;
  }
  const directional=buy+sell,voteAgreement=total?Math.abs(buy-sell)/total*100:0,buyShare=total?buy/total*100:0,sellShare=total?sell/total*100:0,neutralShare=total?neutral/total*100:0;
  const coreDirectional=coreBuy+coreSell,coreSync=coreTotal?(coreDirectional?Math.abs(coreBuy-coreSell)/coreTotal*100:0):voteAgreement;
  return {buyShare,sellShare,neutralShare,abstainShare:total?abstain/total*100:100,voteAgreement,coreSync,institutionAgreement:total?instAgreement/total:0,persistence:total?persistence/total:0,stockReliability:total?rel/total:0};
}
function summarizeTagItemsRaw(items,denom){
  const validCount=items.length,memberCount=Number(denom?.memberCount||validCount||0);if(!validCount)return null;
  const coveragePct=memberCount?validCount/memberCount*100:0,totalBusinessWeight=Math.max(0,num(denom?.totalWeight)??items.reduce((sum,x)=>sum+Math.max(0,num(x.weight)??0),0)),presentWeight=items.reduce((sum,x)=>sum+Math.max(0,num(x.weight)??0),0),businessCoveragePct=totalBusinessWeight>0?clamp(presentWeight/totalBusinessWeight*100):coveragePct;
  const flowEntries=topicFlowItems(items),flowItems=flowEntries.map(e=>e.item),flowBusinessWeight=flowItems.reduce((sum,x)=>sum+Math.max(0,num(x.weight)??0),0),flowCoveragePct=totalBusinessWeight>0?clamp(flowBusinessWeight/totalBusinessWeight*100):0;

  // v6: final topic X is the capped aggregate of stock-first robust X scores.
  const x=flowEntries.length?flowEntries.reduce((sum,e)=>sum+(num(e.item.stockFlowScore??e.item.stockX)??0)*(num(e.topicWeight)??0),0):0;
  const rawX=flowEntries.length?flowEntries.reduce((sum,e)=>sum+(num(e.item.inst_flow_ratio_5)??0)*(num(e.topicWeight)??0),0):0;
  const themeFlow1Pct=weightedByTopic(flowEntries,'inst_flow_ratio_1'),themeFlow5Pct=rawX,themeFlow10Pct=weightedByTopic(flowEntries,'inst_flow_ratio_10'),themeFlow20Pct=weightedByTopic(flowEntries,'inst_flow_ratio_20');
  const themeReturn1Pct=weightedMean(items,'change_pct'),themeReturn3Pct=weightedMean(items,'return_3_pct'),themeReturn5Pct=weightedMean(items,'return_5_pct'),themeReturn20Pct=weightedMean(items,'return_20_pct');
  const y=num(themeReturn5Pct)??0,themeStreak=weightedByTopic(flowEntries,'inst_streak'),themeAgreement=weightedByTopic(flowEntries,'inst_agreement');
  const vote={...topicVoteMetrics(flowEntries),abstainShare:clamp(100-flowCoveragePct)},flowBreadth=vote.buyShare,priceBreadth=weightedShare(items,a=>(num(a.return_5_pct)??0)>0)??0,upBreadth=weightedShare(items,a=>(num(a.change_pct)??0)>0)??0;
  const topicShares=flowEntries.map(e=>num(e.topicWeight)??0).filter(v=>v>0),maxShare=topicShares.length?Math.max(...topicShares):1,n=topicShares.length;
  const ideal=n?1/n:1,concentrationQuality=n<=1?25:clamp((1-maxShare)/Math.max(.0001,1-ideal)*100,25,100),topFlowSharePct=maxShare*100;
  const sampleReliability=Math.min(1,Math.sqrt(Math.max(0,flowEntries.length)/5)),coverageReliability=Math.min(1,flowCoveragePct/80),stockReliability=clampRange(vote.stockReliability/100,0,1),reliability=sampleReliability*coverageReliability*stockReliability;
  const legacyMedian=weightedMedian(items,'legacyStockX')??50,legacyMean=weightedMean(items,'legacyStockX')??50,legacyBreadth=weightedShare(items,a=>a.legacyStockX>=60)??0,legacyBaseX=.45*legacyMedian+.25*legacyMean+.30*legacyBreadth,legacyX=clamp(50+(legacyBaseX-50)*Math.max(.25,reliability)),rawCreditCorrection=clamp(weightedMean(items,'creditCorrection')??0,-15,15);
  const confirmation=clamp(.30*vote.voteAgreement+.18*vote.coreSync+.14*vote.institutionAgreement+.14*vote.persistence+.14*(reliability*100)+.10*concentrationQuality);
  return {
    memberCount,validCount,flowValidCount:flowEntries.length,coveragePct:round(coveragePct),businessCoveragePct:round(businessCoveragePct),reliability:round(reliability*100),
    x:round(x,3),rawX:round(rawX,4),y:round(y,4),rawY:round(y,4),institutionalX:round(rawX,4),creditCorrection:round(rawCreditCorrection,2),legacyX:round(legacyX,2),
    flowCoveragePct:round(flowCoveragePct),flowBreadth:round(flowBreadth),sellBreadth:round(vote.sellShare),neutralBreadth:round(vote.neutralShare),abstainBreadth:round(vote.abstainShare),voteAgreement:round(vote.voteAgreement),coreSync:round(vote.coreSync),institutionAgreement:round(vote.institutionAgreement),persistence:round(vote.persistence),
    concentrationQuality:round(concentrationQuality),topFlowSharePct:round(topFlowSharePct),rawCreditCorrection:round(rawCreditCorrection,2),
    themeFlow1Pct,themeFlow5Pct,themeFlow10Pct,themeFlow20Pct,themeReturn1Pct,themeReturn3Pct,themeReturn5Pct,themeReturn20Pct,themeStreak,themeAgreement,confirmation:round(confirmation),activityBreadth:round(flowBreadth),priceBreadth:round(priceBreadth),upBreadth:round(upBreadth),
    xMedian:round(median(flowItems.map(a=>num(a.stockFlowScore??a.stockX))),2),xMean:round(flowEntries.length?flowEntries.reduce((sum,e)=>sum+(num(e.item.stockFlowScore??e.item.stockX)??0)*(num(e.topicWeight)??0),0):0,2),xHistoryDays:round(weightedByTopic(flowEntries,'stock_flow_history_days')??0,1),xMaturityPct:round(weightedByTopic(flowEntries,'stock_flow_maturity_pct')??0,1),selfRelativeXPercentile:round(Math.abs(x),1),
    rawXMedian:round(median(flowItems.map(a=>num(a.inst_flow_ratio_5)))??0,4),yMedian:round(weightedMedian(items,'stockY')??0,4),yMean:round(weightedMean(items,'stockY')??0,4),baseY:round(y,4),strongCount:items.filter(a=>(num(a.stockFlowScore??a.stockX)??0)>0||(num(a.stockY)??0)>0).length,
    topicWeightCapPct:round(Math.min(100,Math.max(TOPIC_SINGLE_STOCK_CAP,n?1/n+.10:1)*100),1)
  };
}

function normalizeTagSummaries(rawSummaries){
  // v6 keeps coordinates interpretable: X is already the stock-first robust fund score,
  // Y is still literal price return. C/E/Chip diagnostics remain separate.
  return (rawSummaries||[]).map(r=>{
    const x=num(r.x)??0,rawX=num(r.rawX)??num(r.themeFlow5Pct)??0,y=num(r.y)??num(r.themeReturn5Pct)??0,creditQuality=clamp(50+(num(r.rawCreditCorrection)??0)/15*50);
    const factorSignals={x:{
      robustX:round(x,2),rawInst5:round(rawX,4),inst1:round(num(r.themeFlow1Pct)??0,3),inst5:round(num(r.themeFlow5Pct)??0,3),inst10:round(num(r.themeFlow10Pct)??0,3),inst20:round(num(r.themeFlow20Pct)??0,3),
      buyVote:round(r.flowBreadth??0),sellVote:round(r.sellBreadth??0),neutralVote:round(r.neutralBreadth??0),abstainVote:round(r.abstainBreadth??0),voteAgreement:round(r.voteAgreement??0),coreSync:round(r.coreSync??0),institutionAgreement:round(r.institutionAgreement??0),persistence:round(r.persistence??0),
      concentrationQuality:round(r.concentrationQuality??50),creditQuality:round(creditQuality),flowCoverage:round(r.flowCoveragePct??0),businessCoverage:round(r.businessCoveragePct??0),weightCapPct:round(r.topicWeightCapPct??0,1)
    },y:{changePct:round(num(r.themeReturn1Pct)??0,3),return3Pct:round(num(r.themeReturn3Pct)??0,3),return5Pct:round(num(r.themeReturn5Pct)??0,3),return20Pct:round(num(r.themeReturn20Pct)??0,3),persistence5:round(r.priceBreadth??0)}};
    return {...r,x:round(x,3),rawX:round(rawX,4),y:round(y,4),rawY:round(y,4),institutionalX:round(rawX,4),creditCorrection:round(num(r.rawCreditCorrection)??0,2),baseX:round(x,3),factorSignals};
  });
}
function collectTagItems(scoredRows,profileMaps,tagId){
  const items=[];for(const row of scoredRows){const code=String(row.stock_code||'').trim(),profile=profileMaps.byCode.get(code);if(!profile)continue;for(const link of profile.links){if(tagId&&link.id!==tagId)continue;items.push({tagId:link.id,item:tagItem(row,profile,link)});}}return items;
}
function aggregateTagDate(scoredRows,profileMaps,date){
  const groups=new Map();for(const pair of collectTagItems(scoredRows,profileMaps)){if(!groups.has(pair.tagId))groups.set(pair.tagId,[]);groups.get(pair.tagId).push(pair.item);}
  const staged=[];
  for(const [tagId,items] of groups){const meta=profileMaps.tagMeta.get(tagId);if(!meta)continue;const denom=profileMaps.denominator.get(tagId)||{memberCount:items.length,totalWeight:items.reduce((s,x)=>s+x.weight,0)},raw=summarizeTagItemsRaw(items,denom);if(!raw||Number(raw.flowValidCount||0)===0)continue;staged.push({tagId,items,meta,raw});}
  const normalized=normalizeTagSummaries(staged.map(x=>x.raw));
  const out=[];for(let i=0;i<staged.length;i++){
    const {tagId,items,meta}=staged[i],summary=normalized[i];
    const leaders=items.slice().sort((a,b)=>((b.stockX+b.stockY)*(b.weight||.2))-((a.stockX+a.stockY)*(a.weight||.2))).slice(0,5).map(a=>({code:String(a.stock_code),name:a.companyName||a.stock_name||'',market:a.market,x:round(a.stockX),y:round(a.stockY),changePct:round(num(a.change_pct)||0,2),return5Pct:round(num(a.return_5_pct)||0,2),instFlow5Pct:round(num(a.inst_flow_ratio_5)||0,3),creditCorrection:round(num(a.creditCorrection)||0,1),importance:a.importance,weight:round(a.weight,2)}));
    out.push({tradeDate:date,...meta,...summary,leaders});
  }return out;
}

function quadrant(x,y){const xx=num(x)??0,yy=num(y)??0;if(xx>=0&&yy<0)return 'potential';if(xx>=0&&yy>=0)return 'mainline';if(xx<0&&yy>=0)return 'price-led';return 'cold';}
function emaNext(prev,value,alpha=.5){const v=num(value);if(v===null)return prev??50;if(prev===null||prev===undefined)return v;return alpha*v+(1-alpha)*prev;}
function rawPhaseForPoint(p){
  const x=num(p.x)??0,y=num(p.y)??0,dx3=num(p.dx3)??0,dy3=num(p.dy3)??0,dx1=num(p.dx1)??0,dy1=num(p.dy1)??0,c=num(p.confirmation)??50,e=num(p.overheating)??0;let key='transition';
  // Cold and overheating are no longer standalone phases. Cold/unclear stays transition;
  // overheating is E (Exhaustion) and can coexist with a strong or weakening path.
  if(y>0&&((dx3<-12&&dy3<-.8)||(e>=70&&dx1<0&&dy1<=0)))key='cooling';
  else if(x>=28&&y>0&&c>=35)key='mainline';
  else if(x>=22&&y<=0&&dx3>=-12&&dy3>=-2.5&&c>=28)key='potential';
  else if(y<=1.5&&((x>0&&dx3>8)||(x>45&&dx1>=0)))key='germination';
  else key='transition';
  const m=phaseMeta(key),xs=flowPhaseScore(x),ys=pricePhaseScore(y),mx=clamp(50+dx3*1.25),my=clamp(50+dy3*12);let confidence=45;
  if(key==='germination')confidence=clamp(38+Math.max(0,mx-50)*.65+Math.max(0,x)*.15+c*.18);
  else if(key==='potential')confidence=clamp(40+Math.max(0,x)*.16+Math.max(0,50-ys)*.25+Math.max(0,my-40)*.2+c*.20);
  else if(key==='mainline')confidence=clamp(42+Math.max(0,x)*.14+Math.max(0,y)*3+c*.22-Math.max(0,e-70)*.25);
  else if(key==='cooling')confidence=clamp(42+Math.max(0,-dx3)*1.3+Math.max(0,-dy3)*7+e*.30);
  else confidence=clamp(34+c*.28-Math.abs(mx-my)*.06);
  return {key,label:m.label,confidence:round(confidence)};
}
function decorateDynamics(trajectory,{smooth=false}={}){
  for(let i=0;i<trajectory.length;i++){const p=trajectory[i];p.rawX=num(p.rawX)??num(p.x)??0;p.rawY=num(p.rawY)??num(p.y)??0;p.x=num(p.x)??0;p.y=p.rawY;const prev=trajectory[i-1]||p,p3=trajectory[Math.max(0,i-3)]||trajectory[0]||p,prev2=trajectory[i-2]||prev;p.dx1=round((num(p.x)??0)-(num(prev.x)??0),4);p.dy1=round((num(p.y)??0)-(num(prev.y)??0),4);p.dx3=round((num(p.x)??0)-(num(p3.x)??0),4);p.dy3=round((num(p.y)??0)-(num(p3.y)??0),4);const prevDx=(num(prev.x)??0)-(num(prev2.x)??0),prevDy=(num(prev.y)??0)-(num(prev2.y)??0);p.ddx1=round(p.dx1-prevDx,4);p.ddy1=round(p.dy1-prevDy,4);const heatLevel=clamp((p.y-4)*12.5),capitalFade=clamp(50-p.dx3*1.25),priceFade=clamp(50-p.dy1*14),breadthFade=clamp(50+((num(prev.priceBreadth)??num(p.priceBreadth)??50)-(num(p.priceBreadth)??50))*2);p.overheating=round(clamp(.50*heatLevel+.20*capitalFade+.18*priceFade+.12*breadthFade));p.confirmation=round(num(p.confirmation)??50);const raw=rawPhaseForPoint(p);p.rawPhaseState=raw.key;p.rawPhaseConfidence=raw.confidence;}
  let confirmed=trajectory[0]?.rawPhaseState||'transition',candidate='',streak=0;for(const p of trajectory){if(p.rawPhaseState===confirmed){candidate='';streak=0;}else if(p.rawPhaseState===candidate)streak++;else{candidate=p.rawPhaseState;streak=1;}if(p.rawPhaseConfidence>=86||streak>=2){confirmed=p.rawPhaseState;candidate='';streak=0;}const meta=phaseMeta(confirmed);p.phaseState=confirmed;p.phaseLabel=meta.label;p.phaseConfidence=round(clamp(.72*p.rawPhaseConfidence+.28*(num(p.confirmation)??50)));}return trajectory;
}
function movementStatus(latest){
  const s=latest.phaseState||'transition';
  const labels={cold:'混沌／方向未明',germination:'資金先行',potential:'資金先行',mainline:'共振轉強',overheating:'強勢延續',cooling:'轉弱',transition:'混沌／方向未明'};
  return {key:s,label:labels[s]||'混沌／方向未明'};
}
function attachTrajectories(rowsByDate,dates,{smooth=false}={}){
  const byTag=new Map();for(const date of dates)for(const row of rowsByDate.get(date)||[]){if(!byTag.has(row.tagId))byTag.set(row.tagId,[]);byTag.get(row.tagId).push(row);}const groups=[];
  for(const [tagId,trajectory] of byTag){trajectory.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));decorateDynamics(trajectory,{smooth:false});const latest=trajectory.at(-1);if(!latest)continue;const status=movementStatus(latest),q=quadrant(latest.x,latest.y);let rightMoves=0,totalMoves=0;for(let i=Math.max(1,trajectory.length-5);i<trajectory.length;i++){totalMoves++;if(trajectory[i].x>trajectory[i-1].x)rightMoves++;}const rightPersistence=totalMoves?rightMoves/totalMoves*100:0,xScore=flowPhaseScore(latest.x),yScore=pricePhaseScore(latest.y),dxScore=clamp(50+latest.dx3*1.25),dyScore=clamp(50+latest.dy3*12),potentialScore=['germination','potential'].includes(latest.phaseState)?xScore*.40+dxScore*.20+dyScore*.20+latest.confirmation*.20:0,mainlineScore=latest.phaseState==='mainline'?xScore*.30+yScore*.35+latest.confirmation*.25+clamp(50+latest.dx3*1.25+latest.dy3*6)*.10:0,coolingScore=['overheating','cooling'].includes(latest.phaseState)?latest.overheating*.45+(100-dxScore)*.25+(100-dyScore)*.20+(100-latest.confirmation)*.10:0,rotationScore=xScore*.25+yScore*.15+dxScore*.25+dyScore*.20+rightPersistence*.15;
    groups.push({...latest,quadrant:q,status:status.key,statusLabel:status.label,dx1:latest.dx1,dy1:latest.dy1,dx3:latest.dx3,dy3:latest.dy3,ddx1:latest.ddx1,ddy1:latest.ddy1,rightPersistence:round(rightPersistence),potentialScore:round(potentialScore),mainlineScore:round(mainlineScore),coolingScore:round(coolingScore),rotationScore:round(rotationScore),trajectory:trajectory.map(p=>({date:p.tradeDate,x:round(p.x,4),y:round(p.y,4),rawX:round(p.rawX,4),rawY:round(p.rawY,4),xPercentile:round(p.selfRelativeXPercentile??Math.abs(p.x),1),xHistoryDays:Number(p.xHistoryDays||0),institutionalX:round(p.institutionalX,4),creditCorrection:round(p.creditCorrection,2),legacyX:round(p.legacyX,2),flowBreadth:round(p.flowBreadth,1),concentrationQuality:round(p.concentrationQuality,1),confirmation:p.confirmation,overheating:p.overheating,phaseState:p.phaseState,phaseLabel:p.phaseLabel,phaseConfidence:p.phaseConfidence,dx1:p.dx1,dy1:p.dy1,dx3:p.dx3,dy3:p.dy3,ddx1:p.ddx1,ddy1:p.ddy1,activityBreadth:p.activityBreadth,priceBreadth:p.priceBreadth,upBreadth:p.upBreadth,validCount:p.validCount,reliability:p.reliability,factors:p.factorSignals||p.factors||{}}))});}
  return groups;
}

const FALLBACK_VECTOR=Object.freeze({
  cold:{dx:2,dy:.20},germination:{dx:12,dy:.55},potential:{dx:8,dy:1.10},mainline:{dx:5,dy:.90},overheating:{dx:-5,dy:.20},cooling:{dx:-14,dy:-1.10},transition:{dx:0,dy:0}
});
const X_DIRECTION_UNIT=10,Y_DIRECTION_UNIT=.90;
function directionLabel(dx,dy){const nx=(num(dx)??0)/X_DIRECTION_UNIT,ny=(num(dy)??0)/Y_DIRECTION_UNIT,t=.85;if(nx>=t&&ny>=t)return '右上';if(nx>=t&&ny<=-t)return '右下';if(nx<=-t&&ny>=t)return '左上';if(nx<=-t&&ny<=-t)return '左下';if(nx>=t)return '向右';if(nx<=-t)return '向左';if(ny>=t)return '向上';if(ny<=-t)return '向下';return '盤整';}
const DIRECTION_VECTORS=Object.freeze({'右上':{x:1,y:1},'右下':{x:1,y:-1},'左上':{x:-1,y:1},'左下':{x:-1,y:-1},'向右':{x:1,y:0},'向左':{x:-1,y:0},'向上':{x:0,y:1},'向下':{x:0,y:-1},'盤整':{x:0,y:0}});
function directionVector(label){return DIRECTION_VECTORS[label]||DIRECTION_VECTORS['盤整'];}
function directionSimilarity(a,b){if(a===b)return 1;const va=directionVector(a),vb=directionVector(b),na=Math.hypot(va.x,va.y),nb=Math.hypot(vb.x,vb.y);if(!na||!nb)return a==='盤整'&&b==='盤整'?1:.18;return clamp(((va.x*vb.x+va.y*vb.y)/(na*nb)+1)/2,0,1);}
function displacementStats(arr){const dx=arr.map(x=>x.dx),dy=arr.map(x=>x.dy);return {n:arr.length,medianDx:round(median(dx)??0,2),medianDy:round(median(dy)??0,2),q20Dx:round(quantile(dx,.2)??0,2),q80Dx:round(quantile(dx,.8)??0,2),q20Dy:round(quantile(dy,.2)??0,2),q80Dy:round(quantile(dy,.8)??0,2)};}
function buildTransitionCalibration(groups){
  const horizons=[3,5,10],buckets={};let sampleCount=0;const dateSet=new Set();
  for(const g of groups||[])for(const p of g.trajectory||[])dateSet.add(p.date);
  for(const phase of Object.keys(PHASES)){buckets[phase]={};for(const h of horizons)buckets[phase][h]=[];}
  for(const g of groups||[]){const t=g.trajectory||[];for(let i=0;i<t.length;i++){const s=t[i].phaseState||'transition';for(const h of horizons){if(i+h>=t.length)continue;buckets[s]??={};buckets[s][h]??=[];buckets[s][h].push({dx:t[i+h].x-t[i].x,dy:t[i+h].y-t[i].y});sampleCount++;}}}
  const stats={};for(const [state,byH] of Object.entries(buckets)){stats[state]={};for(const [h,arr] of Object.entries(byH)){const base=displacementStats(arr),directions={};for(const label of Object.keys(DIRECTION_VECTORS)){const subset=arr.filter(x=>directionLabel(x.dx,x.dy)===label);if(subset.length)directions[label]=displacementStats(subset);}stats[state][h]={...base,directions};}}
  const historyDays=dateSet.size,maturityPct=round(clamp((historyDays-10)/50*100));
  return {historyDays,maturityPct,sampleCount,horizons,stats};
}
function scenarioTendency(state,p5){if(['germination','potential'].includes(state)&&p5.dx>0)return '資金先行';if(state==='mainline'&&p5.dy>=0)return '強勢延續';if(state==='cooling'&&(p5.dx<0||p5.dy<0))return '轉弱';if(p5.dx>8&&p5.dy>1)return '共振轉強';if(p5.dx<-8&&p5.dy<-1)return '共振轉弱';if(p5.dy>1&&p5.dx<=0)return '價格先行';if(p5.dx>8&&p5.dy<=0)return '資金先行';return '方向未明';}
function scenarioDirectionScores(group,calibration,state,fallback){
  const st5=calibration?.stats?.[state]?.[5]||{n:0,directions:{}},trendDx=(num(group.dx3)??0)/3*5,trendDy=(num(group.dy3)??0)/3*5,trendDir=directionLabel(trendDx,trendDy),phaseDir=directionLabel(fallback.dx*5/3,fallback.dy*5/3),labels=new Set([trendDir,phaseDir,'盤整']);
  for(const label of Object.keys(st5.directions||{}))labels.add(label);
  const total=Math.max(1,Number(st5.n||0)),raw=[];for(const label of labels){const n=Number(st5.directions?.[label]?.n||0),hist=n/total,trend=directionSimilarity(label,trendDir),phase=directionSimilarity(label,phaseDir);let score=.62*hist+.24*trend+.10*phase+.04;if(label==='盤整'&&Math.hypot(trendDx/10,trendDy)>1.2)score*=.55;raw.push({label,score,n});}
  raw.sort((a,b)=>b.score-a.score);const sum=raw.reduce((s,x)=>s+x.score,0)||1,maturity=clamp(num(calibration?.maturityPct)??0),sampleReliability=clamp(total/60*100),modelReliability=clamp(.35*(num(group.phaseConfidence)??50)+.25*(num(group.confirmation)??50)+.25*maturity+.15*sampleReliability),reliability=(calibration?.historyDays||0)<30?Math.min(modelReliability,68):modelReliability;
  return raw.map(x=>({...x,routeShare:x.score/sum*100,confidence:x.score/sum*reliability}));
}
function buildScenarioPath(group,calibration,state,fallback,choice,rank){
  const dir=choice.label,vec=directionVector(dir),points=[],enforce=(value,signWanted,fallbackValue)=>{if(!signWanted)return value*.35;if(sign(value)===signWanted||Math.abs(value)<1e-9)return signWanted*Math.max(Math.abs(value),Math.abs(fallbackValue)*.45);return signWanted*(Math.abs(value)*.25+Math.abs(fallbackValue)*.75);};
  for(const h of [3,5,10]){const st=calibration?.stats?.[state]?.[h]||{n:0,medianDx:0,medianDy:0,directions:{}},dst=st.directions?.[dir]||null,histN=Number(dst?.n||0),histW=Math.min(.62,histN/45),trendW=.24,stateW=Math.max(.14,1-histW-trendW),trendDx=(num(group.dx3)??0)/3*h,trendDy=(num(group.dy3)??0)/3*h,stateDx=fallback.dx*h/3,stateDy=fallback.dy*h/3,histDx=num(dst?.medianDx),histDy=num(dst?.medianDy);let dx=histW*(histDx??stateDx)+trendW*trendDx+stateW*stateDx,dy=histW*(histDy??stateDy)+trendW*trendDy+stateW*stateDy;dx=enforce(dx,Math.sign(vec.x),stateDx);dy=enforce(dy,Math.sign(vec.y),stateDy);if(dir==='盤整'){dx*=.25;dy*=.25;}const baseUncX=Math.max(6,12*h/5)*(1-Math.min(70,choice.confidence)/190),baseUncY=Math.max(.65,1.10*h/5)*(1-Math.min(70,choice.confidence)/190),spreadX=dst&&histN>=5?Math.max(5,Math.max(Math.abs((num(dst.q20Dx)??histDx??0)-(histDx??0)),Math.abs((num(dst.q80Dx)??histDx??0)-(histDx??0)))):baseUncX,spreadY=dst&&histN>=5?Math.max(.45,Math.max(Math.abs((num(dst.q20Dy)??histDy??0)-(histDy??0)),Math.abs((num(dst.q80Dy)??histDy??0)-(histDy??0)))):baseUncY,uncScale=1+.10*(h/3-1),startX=num(group.x)??0,x=clampRange(startX+dx,-100,100),actualDx=x-startX,y=(num(group.y)??0)+dy;points.push({horizon:h,x:round(x,4),y:round(y,4),dx:round(actualDx,4),dy:round(dy,4),sampleN:histN,lowX:round(clampRange(x-spreadX*uncScale,-100,100),4),highX:round(clampRange(x+spreadX*uncScale,-100,100),4),lowY:round(y-spreadY*uncScale,4),highY:round(y+spreadY*uncScale,4)});}
  const p5=points.find(p=>p.horizon===5)||points[0];return {id:rank===0?'A':'B',rank:rank+1,direction:dir,tendency:scenarioTendency(state,p5),confidence:round(choice.confidence),routeShare:round(choice.routeShare),sampleN:choice.n,points};
}
function projectGroup(group,calibration){
  const state=group.phaseState||'transition',fallback=FALLBACK_VECTOR[state]||FALLBACK_VECTOR.transition,maturity=num(calibration?.maturityPct)??0,choices=scenarioDirectionScores(group,calibration,state,fallback),selected=choices.slice(0,2);
  if(selected.length<2){const existing=new Set(selected.map(x=>x.label));for(const label of Object.keys(DIRECTION_VECTORS)){if(existing.has(label))continue;selected.push({label,score:0,n:0,routeShare:0,confidence:0});if(selected.length===2)break;}}
  const scenarios=selected.map((choice,i)=>buildScenarioPath(group,calibration,state,fallback,choice,i)),primary=scenarios[0],secondary=scenarios[1],pathGap=round(Math.max(0,(primary?.confidence||0)-(secondary?.confidence||0))),chaosLevel=pathGap<=7?'高混沌':pathGap<=18?'中度分歧':pathGap<=30?'有次要劇本':'主路徑明確',top2Share=round((primary?.routeShare||0)+(secondary?.routeShare||0)),residualPct=round(Math.max(0,100-top2Share));
  return {mode:'top2-scenario',state,stateLabel:phaseMeta(state).label,tendency:primary?.tendency||'方向未明',direction:primary?.direction||'盤整',confidence:primary?.confidence||0,historyDays:calibration?.historyDays||0,maturityPct:maturity,points:primary?.points||[],
    scenarios,primary,secondary,pathGap,chaosLevel,top2Share,residualPct,
    caution:'只畫信心最高的兩條未來路徑；每條路徑各自有 3/5/10 日中心線與不確定錐。其他低順位情境不畫入扇形，避免用超大範圍掩蓋方向錯誤。'};
}
function decorateProjections(groups,calibration){for(const g of groups||[])g.projection=projectGroup(g,calibration);return groups;}

function computeBusinessFlow(profiles,activityRows,{maxDates=DEFAULT_TRAJECTORY_DAYS}={}){
  const enriched=enrichFlowFeatures(activityRows||[]);
  const dates=[...new Set(enriched.map(r=>isoDate(r.trade_date)).filter(Boolean))].sort().slice(-maxDates),dateSet=new Set(dates),profileMaps=buildProfileTagMap(profiles||[]),byDateRows=new Map(dates.map(d=>[d,[]]));
  for(const row of enriched){const d=isoDate(row.trade_date);if(dateSet.has(d))byDateRows.get(d).push(row);}
  const aggregated=new Map();for(const date of dates){const scored=scoreStocksForDate(byDateRows.get(date)||[]);aggregated.set(date,aggregateTagDate(scored,profileMaps,date));}
  const groups=attachTrajectories(aggregated,dates,{smooth:false}),calibration=buildTransitionCalibration(groups);decorateProjections(groups,calibration);
  return {dates,groups,profileMaps,aggregated,calibration};
}

function computeTagDetail(profiles,activityRows,tagId,{maxDates=10}={}){
  const cleanTag=String(tagId||'').trim();if(!cleanTag)throw new Error('缺少業務 tag');
  const enriched=enrichFlowFeatures(activityRows||[]),displayDays=Math.max(5,Math.min(15,Number(maxDates)||10));
  // Compute X/Phase on the full engine history, then return only the requested
  // visible trajectory. Otherwise Detail would use a shorter percentile baseline
  // than the overview and show a different X for the same topic/date.
  const dates=[...new Set(enriched.map(r=>isoDate(r.trade_date)).filter(Boolean))].sort().slice(-ENGINE_HISTORY_DAYS),dateSet=new Set(dates),profileMaps=buildProfileTagMap(profiles||[]),meta=profileMaps.tagMeta.get(cleanTag);if(!meta)throw new Error('找不到業務標籤');
  const denom=profileMaps.denominator.get(cleanTag)||{memberCount:0,totalWeight:0},byDateRows=new Map(dates.map(d=>[d,[]])),rowsByDate=new Map(dates.map(d=>[d,[]]));
  for(const row of enriched){const d=isoDate(row.trade_date);if(dateSet.has(d))byDateRows.get(d).push(row);}
  let latestItems=[],latestRawSummary=null,latestScored=[],latestDate='';
  for(const date of dates){
    const scored=scoreStocksForDate(byDateRows.get(date)||[]),all=aggregateTagDate(scored,profileMaps,date),summary=all.find(x=>x.tagId===cleanTag);if(!summary)continue;
    rowsByDate.get(date).push(summary);latestItems=collectTagItems(scored,profileMaps,cleanTag).map(x=>x.item);latestRawSummary=summary;latestScored=scored;latestDate=date;
  }
  const allGroups=attachTrajectories(rowsByDate,dates,{smooth:false}),g=allGroups.find(x=>x.tagId===cleanTag);if(!g||!latestRawSummary)throw new Error('此業務尚無可用 XY 明細');
  const calibration=buildTransitionCalibration(allGroups),projection=projectGroup(g,calibration),trajectory=g.trajectory.slice(-displayDays),latestPoint=trajectory.at(-1)||g;
  const companies=latestItems.map((item)=>{
    const code=String(item.stock_code||''),reducedScored=latestScored.filter(x=>String(x.stock_code||'')!==code),reducedGroup=aggregateTagDate(reducedScored,profileMaps,latestDate).find(x=>x.tagId===cleanTag),withoutX=reducedGroup?.x??0,withoutY=reducedGroup?.rawY??reducedGroup?.y??0,impactX=(num(latestRawSummary.x)??0)-withoutX,impactY=(num(latestRawSummary.rawY)??0)-withoutY;return {
    code,name:item.companyName||item.stock_name||'',market:item.market||'',importance:item.importance||'related',weight:round(item.weight,2),stockX:roundNullable(item.stockX),stockY:roundNullable(item.stockY),impactX:round(impactX,2),impactY:round(impactY,2),impactScore:round(Math.abs(impactX)+Math.abs(impactY),2),
    institutionalX:round(num(item.stockInstitutionalX)??0,3),stockFlowScale:round(num(item.stockFlowScale)??0,3),stockFlowHistoryDays:Number(item.stockFlowHistoryDays||0),stockFlowReliability:round(num(item.stockFlowReliability)??0,1),creditCorrection:round(num(item.creditCorrection)||0,1),legacyX:round(num(item.legacyStockX)||50,1),instFlow1Pct:round(num(item.inst_flow_ratio_1)||0,3),instFlow5Pct:round(num(item.inst_flow_ratio_5)||0,3),instFlow10Pct:round(num(item.inst_flow_ratio_10)||0,3),instFlow20Pct:round(num(item.inst_flow_ratio_20)||0,3),
    positiveDays5:num(item.positive_days_5)??0,changePct:round(num(item.change_pct)||0,2),return3Pct:round(num(item.return_3_pct)||0,2),return5Pct:round(num(item.return_5_pct)||0,2),return20Pct:round(num(item.return_20_pct)||0,2)
  };}).sort((a,b)=>b.impactScore-a.impactScore||((b.stockX+b.stockY)-(a.stockX+a.stockY)));
  const latestFactors=latestPoint?.factors||{};
  const enrichedTrajectory=trajectory.map(p=>({...p,factors:p.factors||{}}));
  return {ok:true,engineVersion:ENGINE_VERSION,tagId:cleanTag,name:meta.name,parentName:meta.parentName||'',scope:meta.scope,asOf:latestPoint.date,trajectoryDays:enrichedTrajectory.length,trajectory:enrichedTrajectory,
    latest:{x:g.x,y:g.y,rawX:g.rawX,rawY:g.rawY,xPercentile:g.selfRelativeXPercentile,xHistoryDays:g.xHistoryDays,institutionalX:g.institutionalX,creditCorrection:g.creditCorrection,legacyX:g.legacyX,quadrant:g.quadrant,status:g.status,statusLabel:g.statusLabel,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,confirmation:g.confirmation,overheating:g.overheating,
      dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1,memberCount:g.memberCount,validCount:g.validCount,coveragePct:g.coveragePct,reliability:g.reliability,activityBreadth:g.activityBreadth,flowBreadth:g.flowBreadth,concentrationQuality:g.concentrationQuality,priceBreadth:g.priceBreadth,upBreadth:g.upBreadth,factors:latestFactors,
      groupBuild:{themeFlow1Pct:round(latestRawSummary.themeFlow1Pct??0,3),themeFlow5Pct:round(latestRawSummary.themeFlow5Pct??0,3),themeFlow10Pct:round(latestRawSummary.themeFlow10Pct??0,3),themeFlow20Pct:round(latestRawSummary.themeFlow20Pct??0,3),flowBreadth:latestRawSummary.flowBreadth,concentrationQuality:latestRawSummary.concentrationQuality,institutionalX:latestRawSummary.institutionalX,creditCorrection:latestRawSummary.creditCorrection,legacyX:latestRawSummary.legacyX,themeReturn1Pct:round(latestRawSummary.themeReturn1Pct??0,3),themeReturn3Pct:round(latestRawSummary.themeReturn3Pct??0,3),themeReturn5Pct:round(latestRawSummary.themeReturn5Pct??0,3),themeReturn20Pct:round(latestRawSummary.themeReturn20Pct??0,3),yMedian:latestRawSummary.yMedian,yMean:latestRawSummary.yMean,priceBreadth:latestRawSummary.priceBreadth,upBreadth:latestRawSummary.upBreadth,reliability:latestRawSummary.reliability,businessWeights:IMPORTANCE_WEIGHT}},
    projection,calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount},companies,
    methodology:{impact:'公司 X 貢獻以移除該公司後重新計算題材 robust X 的差表示；單一公司權重受流動性平方根與題材內 cap 限制。Y 貢獻仍是移除後的 5 日價格報酬差。',factor:'X 先逐股計算近5日法人淨買賣超／成交值，再只用該股先前歷史做連續 robust scaling；真買永遠在右、真賣永遠在左。題材最後以業務關聯度×流動性修正×資料可靠度 capped 聚合。投票、breadth、一致性、streak 與 concentration 只進 C，不改 X。Y＝題材近5日實際價格漲跌幅。',projection:'Future Path 採 Top-2 劇本：只保留信心最高的 A/B 兩條 3/5/10 日路徑；路徑狀態以目前象限 → 5日預測象限解讀，E 另表示過熱／耗竭。'}};
}

async function ensureBusinessFlowSchema(sql=getSql()){
  if(schemaReady)return;
  await Promise.all([ensureInstitutionalHistorySchema(),ensureCreditTradingSchema()]);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy_daily (
      trade_date date NOT NULL,tag_id text NOT NULL,tag_name text NOT NULL,parent_name text,scope text NOT NULL,
      member_count integer NOT NULL,valid_count integer NOT NULL,coverage_pct numeric,reliability_pct numeric,
      x_score numeric,y_score numeric,raw_x_score numeric,raw_y_score numeric,institutional_x_score numeric,credit_correction numeric,legacy_x_score numeric,
      confirmation_score numeric,overheating_score numeric,phase_state text,phase_label text,phase_confidence numeric,
      activity_breadth numeric,flow_breadth numeric,flow_concentration_quality numeric,price_breadth numeric,up_breadth numeric,strong_count integer,
      leaders jsonb,engine_version text NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY (trade_date,tag_id)
    )
  `);
  for(const stmt of [
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS raw_x_score numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS raw_y_score numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS confirmation_score numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS overheating_score numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS phase_state text`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS phase_label text`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS phase_confidence numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS institutional_x_score numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS credit_correction numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS legacy_x_score numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS flow_breadth numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS flow_concentration_quality numeric`,
  ])await sql.query(stmt);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy_snapshot (
      engine_version text NOT NULL,snapshot_kind text NOT NULL,trajectory_days integer NOT NULL,
      as_of date NOT NULL,payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (engine_version,snapshot_kind,trajectory_days)
    )
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy_member (
      engine_version text NOT NULL,tag_id text NOT NULL,stock_code text NOT NULL,market text NOT NULL,
      importance text NOT NULL,weight numeric NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (engine_version,tag_id,stock_code,market)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_date_idx ON market_business_xy_daily (trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_scope_date_idx ON market_business_xy_daily (scope,trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_snapshot_asof_idx ON market_business_xy_snapshot (engine_version,as_of DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_member_tag_idx ON market_business_xy_member (engine_version,tag_id)`);
  schemaReady=true;
}

function clearFundflowCaches(){memoryCache.clear();browserMemoryCache.clear();detailMemoryCache.clear();}
function jsonPayload(v){if(!v)return null;if(typeof v==='string'){try{return JSON.parse(v)}catch{return null}}return typeof v==='object'?v:null;}
function compactProjection(p){
  if(!p||typeof p!=='object')return null;
  const point=x=>({horizon:Number(x?.horizon)||0,x:round(x?.x,4),y:round(x?.y,4),dx:round(x?.dx,4),dy:round(x?.dy,4),sampleN:Number(x?.sampleN||0),lowX:round(x?.lowX,4),highX:round(x?.highX,4),lowY:round(x?.lowY,4),highY:round(x?.highY,4)});
  const scenario=s=>({id:s?.id||'',rank:Number(s?.rank||0),direction:s?.direction||'',tendency:s?.tendency||'',confidence:round(s?.confidence,1),routeShare:round(s?.routeShare,1),sampleN:Number(s?.sampleN||0),points:(s?.points||[]).map(point)});
  const scenarios=(p.scenarios||[]).slice(0,2).map(scenario),primary=scenarios[0]||null,secondary=scenarios[1]||null;
  return {mode:p.mode||'top2-scenario',state:p.state||'',stateLabel:p.stateLabel||'',tendency:p.tendency||primary?.tendency||'',direction:p.direction||primary?.direction||'',confidence:round(p.confidence??primary?.confidence,1),historyDays:Number(p.historyDays||0),maturityPct:round(p.maturityPct,1),points:(p.points||primary?.points||[]).map(point),scenarios,primary,secondary,pathGap:round(p.pathGap,1),chaosLevel:p.chaosLevel||'',top2Share:round(p.top2Share,1),residualPct:round(p.residualPct,1)};
}
function compactOverviewGroup(g,days){
  return {tagId:g.tagId,name:g.name,parentName:g.parentName||'',scope:g.scope,memberCount:Number(g.memberCount||0),validCount:Number(g.validCount||0),coveragePct:round(g.coveragePct,1),reliability:round(g.reliability,1),x:round(g.x,4),y:round(g.y,4),rawX:round(g.rawX??0,4),rawY:round(g.rawY??g.y,4),xPercentile:round(g.selfRelativeXPercentile??Math.abs(g.x),1),xHistoryDays:Number(g.xHistoryDays||0),quadrant:g.quadrant,status:g.status,statusLabel:g.statusLabel,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:round(g.phaseConfidence,1),confirmation:round(g.confirmation,1),overheating:round(g.overheating,1),dx1:round(g.dx1,4),dy1:round(g.dy1,4),dx3:round(g.dx3,4),dy3:round(g.dy3,4),ddx1:round(g.ddx1,4),ddy1:round(g.ddy1,4),rightPersistence:round(g.rightPersistence,1),potentialScore:round(g.potentialScore,1),mainlineScore:round(g.mainlineScore,1),coolingScore:round(g.coolingScore,1),rotationScore:round(g.rotationScore,1),leaders:(g.leaders||[]).slice(0,3).map(x=>({code:String(x?.code||''),name:x?.name||''})),projection:compactProjection(g.projection),trajectory:(g.trajectory||[]).slice(-days).map(p=>({date:p.date,x:round(p.x,4),y:round(p.y,4)}))};
}
function compactPick(g){return {tagId:g.tagId,name:g.name,x:round(g.x,4),y:round(g.y,4),phaseState:g.phaseState,phaseLabel:g.phaseLabel,potentialScore:round(g.potentialScore,1),mainlineScore:round(g.mainlineScore,1),coolingScore:round(g.coolingScore,1),rotationScore:round(g.rotationScore,1),projection:g.projection?{direction:g.projection.direction||'',confidence:round(g.projection.confidence,1),pathGap:round(g.projection.pathGap,1),chaosLevel:g.projection.chaosLevel||''}:null};}
function scopeCounts(groups){const out={'technology-fine':0,'traditional-coarse':0,'electronics-product':0,'other':0};for(const g of groups)out[g.scope]=(out[g.scope]||0)+1;return out;}
function buildPreparedOverview(fullGroups,allDates,calibration,days){
  const bounded=Math.max(5,Math.min(15,Number(days)||10)),groups=(fullGroups||[]).map(g=>({...g,trajectory:(g.trajectory||[]).slice(-bounded)})),eligible=g=>g.validCount>=2&&g.trajectory.length>=2;
  const rising=groups.filter(g=>eligible(g)&&['germination','potential'].includes(g.phaseState)&&g.projection?.points?.find(p=>p.horizon===5)?.dy>0).sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,10);
  const mainline=groups.filter(g=>eligible(g)&&g.phaseState==='mainline').sort((a,b)=>b.mainlineScore-a.mainlineScore).slice(0,10);
  const cooling=groups.filter(g=>eligible(g)&&['overheating','cooling'].includes(g.phaseState)).sort((a,b)=>b.coolingScore-a.coolingScore).slice(0,10);
  const rightMoving=groups.filter(g=>eligible(g)&&g.dx3>8).sort((a,b)=>b.rotationScore-a.rotationScore).slice(0,10);
  return {ok:true,engineVersion:ENGINE_VERSION,asOf:allDates.at(-1),trajectoryDates:allDates.slice(-bounded),trajectoryDays:Math.min(bounded,allDates.length),preparedSnapshot:true,
    axes:{x:'法人個股自歷史 robust 強度',y:'近5日題材價格漲跌幅',center:0,xUnit:'robust-score',yUnit:'%',window:5,xLookback:STOCK_FLOW_LOOKBACK_DAYS},
    methodology:{stockX:'每檔股票先算 raw＝近5日三大法人淨買賣超金額／近5日成交值；再只用該股當日以前最多60個有效交易日估計 robust 正常尺度，以連續函數轉成 -100～+100。真買只在右、真賣只在左，missing 不當 0。',stockY:'Y 只描述題材成分公司近5日實際報酬的業務關聯加權平均；價格是主要獲利方向，不加入法人、信用、breadth 或可靠度修正。',group:'題材 X 最後才聚合個股 X：業務關聯度 1.0／0.5／0.2 × 流動性平方根修正 × 個股資料可靠度，並限制單一公司最大權重。投票／breadth／三法人一致性／streak／concentration 只形成 C（Confirmation），不回灌 X。',phase:'Y 決定價格有沒有肉；X 判斷這段價格背後的法人支持；C 判斷是不是族群共識；E 表示過熱／背離／耗竭風險；信用交易留在 Chip Quality。Cold 與過熱都不再是獨立 Phase。',projection:'Phase、ΔXY 與歷史同狀態轉態分布產生 Top-2 未來劇本；UI 以目前象限 → Path A 5日預測象限解讀資金先行、價格先行、共振轉強、資金撤退等路徑狀態。',caution:'X 是 robust 資金強度分數而非百分比；raw X 仍保留為個股法人流量比例的 capped 題材聚合供查核。權重 cap、歷史窗口與 neutral threshold 是可回測參數，不作為不可改動真理。'},
    calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount,warmup:calibration.historyDays<30},
    counts:{groups:groups.length,byScope:scopeCounts(groups),rising:rising.length,mainline:mainline.length,cooling:cooling.length},
    picks:{rising:rising.map(compactPick),potential:rising.map(compactPick),mainline:mainline.map(compactPick),cooling:cooling.map(compactPick),rightMoving:rightMoving.map(compactPick),retreat:cooling.map(compactPick)},groups:groups.map(g=>compactOverviewGroup(g,bounded))};
}
async function persistBusinessMembers(sql,profileMaps){
  const payload=[];for(const p of profileMaps?.byCode?.values?.()||[]){for(const link of p.links||[])payload.push({tag_id:link.id,stock_code:String(p.stock_code||p.code||''),market:String(p.market||''),importance:link.importance||'related',weight:Number(link.weight||importanceWeight(link.importance))});}
  if(!payload.length)return 0;
  await sql.query(`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(tag_id text,stock_code text,market text,importance text,weight numeric)),
    deleted AS (DELETE FROM market_business_xy_member m WHERE m.engine_version=$2 AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.tag_id=m.tag_id AND i.stock_code=m.stock_code AND i.market=m.market) RETURNING 1)
    INSERT INTO market_business_xy_member (engine_version,tag_id,stock_code,market,importance,weight,updated_at)
    SELECT $2,tag_id,stock_code,market,importance,weight,NOW() FROM incoming
    ON CONFLICT (engine_version,tag_id,stock_code,market) DO UPDATE SET importance=EXCLUDED.importance,weight=EXCLUDED.weight,updated_at=NOW()
  `,[JSON.stringify(payload),ENGINE_VERSION]);
  return payload.length;
}
async function persistPreparedSnapshots(sql,{fullGroups,allDates,calibration,profiles}){
  if(!allDates?.length)return {overview:new Map(),browser:new Map()};
  const rows=[],overview=new Map(),browser=new Map();
  for(const days of PREPARED_SNAPSHOT_DAYS){const value=buildPreparedOverview(fullGroups,allDates,calibration,days),catalog=buildBusinessBrowserCatalog(profiles,value);overview.set(days,value);browser.set(days,catalog);rows.push({snapshot_kind:'overview',trajectory_days:days,as_of:value.asOf,payload:value},{snapshot_kind:'browser',trajectory_days:days,as_of:value.asOf,payload:catalog});}
  await sql.query(`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(snapshot_kind text,trajectory_days integer,as_of date,payload jsonb))
    INSERT INTO market_business_xy_snapshot (engine_version,snapshot_kind,trajectory_days,as_of,payload,updated_at)
    SELECT $2,snapshot_kind,trajectory_days,as_of,payload,NOW() FROM incoming
    ON CONFLICT (engine_version,snapshot_kind,trajectory_days) DO UPDATE SET as_of=EXCLUDED.as_of,payload=EXCLUDED.payload,updated_at=NOW()
  `,[JSON.stringify(rows),ENGINE_VERSION]);
  const now=Date.now();for(const [days,value] of overview)memoryCache.set(days,{savedAt:now,value});for(const [days,value] of browser)browserMemoryCache.set(days,{savedAt:now,value});detailMemoryCache.clear();return {overview,browser};
}
async function readPreparedSnapshot(sql,kind,days){
  const rows=await sql.query(`SELECT payload,as_of,updated_at FROM market_business_xy_snapshot WHERE engine_version=$1 AND snapshot_kind=$2 AND trajectory_days=$3 LIMIT 1`,[ENGINE_VERSION,kind,days]);
  return jsonPayload(rows?.[0]?.payload);
}
async function readLatestPreparedSnapshotAnyEngine(sql,kind,days){
  const rows=await sql.query(`SELECT engine_version,payload,as_of,updated_at FROM market_business_xy_snapshot WHERE snapshot_kind=$1 AND trajectory_days=$2 ORDER BY updated_at DESC LIMIT 1`,[kind,days]);
  const payload=jsonPayload(rows?.[0]?.payload);if(!payload)return null;const staleEngineVersion=String(rows?.[0]?.engine_version||payload.engineVersion||'');
  return {...payload,enginePending:staleEngineVersion!==ENGINE_VERSION,targetEngineVersion:ENGINE_VERSION,staleEngineVersion};
}
async function loadEngineInputs(sql,trajectoryDays){
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
  const dateRows=await sql.query(`
    WITH activity_dates AS (
      SELECT trade_date FROM market_activity_daily
      WHERE activity_ready IS TRUE AND market IN ('上市','上櫃')
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    ), inst_dates AS (
      SELECT trade_date FROM institutional_trading_daily
      WHERE market IN ('上市','上櫃')
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    ), credit_dates AS (
      SELECT trade_date FROM credit_trading_daily
      WHERE market IN ('上市','上櫃')
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    )
    SELECT a.trade_date
    FROM activity_dates a
    JOIN inst_dates i USING (trade_date)
    JOIN credit_dates c USING (trade_date)
    ORDER BY a.trade_date DESC
    LIMIT $1
  `,[Math.max(trajectoryDays+20,trajectoryDays)]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates,activityRows:[]};
  const activityRows=await sql.query(`
    SELECT a.trade_date,a.stock_code,a.stock_name,a.market,a.trade_value,a.change_pct,a.value_ratio_20,a.value_trend_5_15,a.up_value_share_5,a.positive_days_5,a.return_3_pct,a.return_5_pct,a.return_20_pct,
      h.close_price,h.trade_volume,
      i.foreign_net AS institutional_foreign_net,i.trust_net AS institutional_trust_net,i.dealer_net AS institutional_dealer_net,i.total_net AS institutional_total_net,
      c.margin_prev_balance,c.margin_balance,c.short_prev_balance,c.short_balance,c.sbl_prev_balance,c.sbl_balance
    FROM market_activity_daily a
    LEFT JOIN market_daily_history h ON h.trade_date=a.trade_date AND h.stock_code=a.stock_code
    LEFT JOIN institutional_trading_daily i ON i.trade_date=a.trade_date AND i.stock_code=a.stock_code AND i.market=a.market
    LEFT JOIN credit_trading_daily c ON c.trade_date=a.trade_date AND c.stock_code=a.stock_code AND c.market=a.market
    WHERE a.activity_ready IS TRUE AND a.trade_date >= $1::date AND a.trade_date <= $2::date AND a.market IN ('上市','上櫃')
    ORDER BY a.stock_code,a.trade_date
  `,[dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:enrichFlowFeatures(activityRows.filter(x=>dates.includes(isoDate(x.trade_date))))};
}
async function resolveMemberEngine(sql,tagId=''){
  const clean=String(tagId||'').trim();
  const current=await sql.query(`SELECT EXISTS(SELECT 1 FROM market_business_xy_member WHERE engine_version=$1 ${clean?"AND tag_id=$2":""} LIMIT 1) AS ready`,clean?[ENGINE_VERSION,clean]:[ENGINE_VERSION]);
  if(current?.[0]?.ready)return ENGINE_VERSION;
  const rows=clean
    ?await sql.query(`SELECT engine_version FROM market_business_xy_member WHERE tag_id=$1 ORDER BY updated_at DESC LIMIT 1`,[clean])
    :await sql.query(`SELECT engine_version FROM market_business_xy_member ORDER BY updated_at DESC LIMIT 1`);
  return String(rows?.[0]?.engine_version||'');
}
async function loadTagEngineInputs(sql,tagId,trajectoryDays){
  const cleanTag=String(tagId||'').trim();if(!cleanTag)return {profiles:[],dates:[],activityRows:[]};
  // Read paths never rebuild the full member index. If v6 has not been warmed by Cron yet,
  // reuse the newest prior-engine member list for this one topic only.
  const memberEngine=await resolveMemberEngine(sql,cleanTag);if(!memberEngine)return {profiles:[],dates:[],activityRows:[]};
  const profiles=await sql.query(`
    SELECT DISTINCT p.stock_code,p.stock_name,p.market,p.industry_code,p.industry,p.auto_business_tags,p.auto_market_topics,p.main_business,p.business_enrich_status,p.business_enrich_version,p.business_enrich_checked_at
    FROM market_company_profile p JOIN market_business_xy_member m ON m.stock_code=p.stock_code AND m.market=p.market
    WHERE m.engine_version=$1 AND m.tag_id=$2 ORDER BY p.stock_code
  `,[memberEngine,cleanTag]);
  if(!profiles.length)return {profiles,dates:[],activityRows:[]};
  const dateRows=await sql.query(`
    WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE activity_ready IS TRUE AND market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    credit_dates AS (SELECT trade_date FROM credit_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2)
    SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) JOIN credit_dates c USING (trade_date) ORDER BY a.trade_date DESC LIMIT $1
  `,[STOCK_FLOW_LOOKBACK_DAYS+Math.max(DEFAULT_TRAJECTORY_DAYS,Math.max(Number(trajectoryDays)||10,5))+5]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates,activityRows:[]};
  const activityRows=await sql.query(`
    SELECT a.trade_date,a.stock_code,a.stock_name,a.market,a.trade_value,a.change_pct,a.value_ratio_20,a.value_trend_5_15,a.up_value_share_5,a.positive_days_5,a.return_3_pct,a.return_5_pct,a.return_20_pct,
      h.close_price,h.trade_volume,
      i.foreign_net AS institutional_foreign_net,i.trust_net AS institutional_trust_net,i.dealer_net AS institutional_dealer_net,i.total_net AS institutional_total_net,
      c.margin_prev_balance,c.margin_balance,c.short_prev_balance,c.short_balance,c.sbl_prev_balance,c.sbl_balance
    FROM market_activity_daily a
    JOIN market_business_xy_member m ON m.engine_version=$1 AND m.tag_id=$2 AND m.stock_code=a.stock_code AND m.market=a.market
    LEFT JOIN market_daily_history h ON h.trade_date=a.trade_date AND h.stock_code=a.stock_code
    LEFT JOIN institutional_trading_daily i ON i.trade_date=a.trade_date AND i.stock_code=a.stock_code AND i.market=a.market
    LEFT JOIN credit_trading_daily c ON c.trade_date=a.trade_date AND c.stock_code=a.stock_code AND c.market=a.market
    WHERE a.activity_ready IS TRUE AND a.trade_date >= $3::date AND a.trade_date <= $4::date AND a.market IN ('上市','上櫃')
    ORDER BY a.stock_code,a.trade_date
  `,[memberEngine,cleanTag,dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:enrichFlowFeatures(activityRows.filter(x=>dates.includes(isoDate(x.trade_date)))),memberEngine};
}
async function refreshBusinessFlowDaily({trajectoryDays=ENGINE_HISTORY_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  const factorState=await sql.query(`SELECT EXISTS(SELECT 1 FROM market_activity_daily WHERE activity_ready IS TRUE AND return_3_pct IS NULL LIMIT 1) AS needs_return3`);
  if(factorState?.[0]?.needs_return3){const {refreshMarketActivityFactors}=require('./sync-common');await refreshMarketActivityFactors();}
  const input=await loadEngineInputs(sql,trajectoryDays);if(!input.dates.length)return {ok:false,reason:'no-ready-activity-dates',dates:0,rows:0};
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:trajectoryDays}),payload=[];
  for(const date of computed.dates)for(const row of computed.aggregated.get(date)||[])payload.push({trade_date:date,tag_id:row.tagId,tag_name:row.name,parent_name:row.parentName||null,scope:row.scope,member_count:row.memberCount,valid_count:row.validCount,coverage_pct:row.coveragePct,reliability_pct:row.reliability,x_score:row.x,y_score:row.y,raw_x_score:row.rawX,raw_y_score:row.rawY,institutional_x_score:row.institutionalX,credit_correction:row.creditCorrection,legacy_x_score:row.legacyX,confirmation_score:row.confirmation,overheating_score:row.overheating,phase_state:row.phaseState,phase_label:row.phaseLabel,phase_confidence:row.phaseConfidence,activity_breadth:row.activityBreadth,flow_breadth:row.flowBreadth,flow_concentration_quality:row.concentrationQuality,price_breadth:row.priceBreadth,up_breadth:row.upBreadth,strong_count:row.strongCount,leaders:row.leaders,engine_version:ENGINE_VERSION});
  if(!payload.length)return {ok:false,reason:'no-business-groups',dates:computed.dates.length,rows:0};
  await sql.query(`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(trade_date date,tag_id text,tag_name text,parent_name text,scope text,member_count integer,valid_count integer,coverage_pct numeric,reliability_pct numeric,x_score numeric,y_score numeric,raw_x_score numeric,raw_y_score numeric,institutional_x_score numeric,credit_correction numeric,legacy_x_score numeric,confirmation_score numeric,overheating_score numeric,phase_state text,phase_label text,phase_confidence numeric,activity_breadth numeric,flow_breadth numeric,flow_concentration_quality numeric,price_breadth numeric,up_breadth numeric,strong_count integer,leaders jsonb,engine_version text)),
    refreshed_dates AS (SELECT DISTINCT trade_date FROM incoming), deleted AS (DELETE FROM market_business_xy_daily b WHERE b.trade_date IN (SELECT trade_date FROM refreshed_dates) AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.trade_date=b.trade_date AND i.tag_id=b.tag_id) RETURNING 1)
    INSERT INTO market_business_xy_daily (trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,strong_count,leaders,engine_version,updated_at)
    SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,strong_count,leaders,engine_version,NOW() FROM incoming
    ON CONFLICT (trade_date,tag_id) DO UPDATE SET tag_name=EXCLUDED.tag_name,parent_name=EXCLUDED.parent_name,scope=EXCLUDED.scope,member_count=EXCLUDED.member_count,valid_count=EXCLUDED.valid_count,coverage_pct=EXCLUDED.coverage_pct,reliability_pct=EXCLUDED.reliability_pct,x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,raw_x_score=EXCLUDED.raw_x_score,raw_y_score=EXCLUDED.raw_y_score,institutional_x_score=EXCLUDED.institutional_x_score,credit_correction=EXCLUDED.credit_correction,legacy_x_score=EXCLUDED.legacy_x_score,confirmation_score=EXCLUDED.confirmation_score,overheating_score=EXCLUDED.overheating_score,phase_state=EXCLUDED.phase_state,phase_label=EXCLUDED.phase_label,phase_confidence=EXCLUDED.phase_confidence,activity_breadth=EXCLUDED.activity_breadth,flow_breadth=EXCLUDED.flow_breadth,flow_concentration_quality=EXCLUDED.flow_concentration_quality,price_breadth=EXCLUDED.price_breadth,up_breadth=EXCLUDED.up_breadth,strong_count=EXCLUDED.strong_count,leaders=EXCLUDED.leaders,engine_version=EXCLUDED.engine_version,updated_at=NOW()
  `,[JSON.stringify(payload)]);
  await persistBusinessMembers(sql,computed.profileMaps);clearFundflowCaches();await persistPreparedSnapshots(sql,{fullGroups:computed.groups,allDates:computed.dates,calibration:computed.calibration,profiles:input.profiles});
  return {ok:true,engineVersion:ENGINE_VERSION,dates:computed.dates.length,rows:payload.length,latestTradeDate:computed.dates.at(-1),profileRows:input.profiles.length,activityRows:input.activityRows.length,preparedSnapshots:PREPARED_SNAPSHOT_DAYS,calibration:{historyDays:computed.calibration.historyDays,maturityPct:computed.calibration.maturityPct,sampleCount:computed.calibration.sampleCount}};
}
async function needsRefresh(sql){
  await ensureBusinessFlowSchema(sql);
  const rows=await sql.query(`
    WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE activity_ready IS TRUE AND market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    credit_dates AS (SELECT trade_date FROM credit_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    common_dates AS (SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) JOIN credit_dates c USING (trade_date) ORDER BY a.trade_date DESC LIMIT $2)
    SELECT (SELECT MAX(trade_date) FROM common_dates) AS activity_date,(SELECT COUNT(*)::int FROM common_dates) AS common_days,(SELECT MAX(trade_date) FROM market_business_xy_daily WHERE engine_version=$1) AS xy_date,(SELECT COUNT(DISTINCT trade_date)::int FROM market_business_xy_daily WHERE engine_version=$1) AS xy_days,(SELECT COUNT(*)::int FROM market_business_xy_daily WHERE engine_version=$1) AS xy_rows
  `,[ENGINE_VERSION,ENGINE_HISTORY_DAYS]);
  const r=rows[0]||{};return !Number(r.xy_rows||0)||isoDate(r.xy_date)!==isoDate(r.activity_date)||Number(r.xy_days||0)<Number(r.common_days||0);
}
function hydrateStoredRows(rows,dates){
  const byDate=new Map(dates.map(d=>[d,[]]));for(const r of rows){const d=isoDate(r.trade_date);if(!byDate.has(d))continue;byDate.get(d).push({tradeDate:d,tagId:r.tag_id,name:r.tag_name,parentName:r.parent_name||'',scope:r.scope,memberCount:Number(r.member_count||0),validCount:Number(r.valid_count||0),coveragePct:num(r.coverage_pct)||0,reliability:num(r.reliability_pct)||0,x:num(r.x_score)??0,y:num(r.y_score)??0,rawX:num(r.raw_x_score)??num(r.x_score)??0,rawY:num(r.raw_y_score)??num(r.y_score)??0,selfRelativeXPercentile:Math.abs(num(r.x_score)??0),xHistoryDays:SELF_RELATIVE_LOOKBACK_DAYS,institutionalX:num(r.institutional_x_score)??0,creditCorrection:num(r.credit_correction)??0,legacyX:num(r.legacy_x_score)??50,confirmation:num(r.confirmation_score)||50,overheating:num(r.overheating_score)||0,phaseState:r.phase_state||'',phaseLabel:r.phase_label||'',phaseConfidence:num(r.phase_confidence)||50,activityBreadth:num(r.activity_breadth)||0,flowBreadth:num(r.flow_breadth)??num(r.activity_breadth)??0,concentrationQuality:num(r.flow_concentration_quality)??50,priceBreadth:num(r.price_breadth)||0,upBreadth:num(r.up_breadth)||0,strongCount:Number(r.strong_count||0),leaders:Array.isArray(r.leaders)?r.leaders:[]});}
  return attachTrajectories(byDate,dates,{smooth:false});
}
async function rebuildPreparedFromStored(sql){
  const dateRows=await sql.query(`SELECT DISTINCT trade_date FROM market_business_xy_daily WHERE engine_version=$1 ORDER BY trade_date DESC LIMIT $2`,[ENGINE_VERSION,ENGINE_HISTORY_DAYS]);
  const allDates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!allDates.length)return null;
  const rows=await sql.query(`SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,strong_count,leaders FROM market_business_xy_daily WHERE engine_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date ORDER BY trade_date,tag_id`,[ENGINE_VERSION,allDates[0],allDates.at(-1)]);
  const fullGroups=hydrateStoredRows(rows,allDates),calibration=buildTransitionCalibration(fullGroups);decorateProjections(fullGroups,calibration);
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
  await persistBusinessMembers(sql,buildProfileTagMap(profiles));clearFundflowCaches();return persistPreparedSnapshots(sql,{fullGroups,allDates,calibration,profiles});
}

async function readCurrentPreparedState(sql){
  await ensureBusinessFlowSchema(sql);
  const rows=await sql.query(`
    SELECT snapshot_kind,trajectory_days,as_of,updated_at
    FROM market_business_xy_snapshot
    WHERE engine_version=$1 AND snapshot_kind IN ('overview','browser') AND trajectory_days = ANY($2::int[])
    ORDER BY snapshot_kind,trajectory_days
  `,[ENGINE_VERSION,PREPARED_SNAPSHOT_DAYS]);
  const have=new Set(rows.map(r=>`${r.snapshot_kind}:${Number(r.trajectory_days)}`));
  const expected=[];for(const kind of ['overview','browser'])for(const days of PREPARED_SNAPSHOT_DAYS)expected.push(`${kind}:${days}`);
  const missing=expected.filter(k=>!have.has(k));
  return {ready:missing.length===0,have:[...have].sort(),missing,asOf:rows.map(r=>isoDate(r.as_of)).filter(Boolean).sort().at(-1)||null,updatedAt:rows.map(r=>r.updated_at).filter(Boolean).sort().at(-1)||null};
}
async function warmCurrentEngineFromStoredDb({sql=getSql(),force=false}={}){
  await ensureBusinessFlowSchema(sql);
  const before=await readCurrentPreparedState(sql);
  // Manual-development mode: a click may happen many times. Check whether stored source data
  // has actually advanced before doing heavy work; up-to-date clicks become a cheap no-op.
  const stale=await needsRefresh(sql);
  if(before.ready&&!force&&!stale)return {ok:true,skipped:true,reason:'current-engine-snapshots-already-latest',engineVersion:ENGINE_VERSION,noUpstreamFetch:true,before,after:before};
  // DB-only: this path reads only data already stored in Neon. It never calls TWSE/TPEx/MIS
  // and is never reached by a normal fundflow page read.
  let mode='prepared-from-stored-daily',result=null;
  if(!stale){
    result=await rebuildPreparedFromStored(sql);
    if(!result){mode='full-db-rebuild';result=await refreshBusinessFlowDaily({trajectoryDays:ENGINE_HISTORY_DAYS,sql});}
  }else{
    mode='full-db-rebuild';
    result=await refreshBusinessFlowDaily({trajectoryDays:ENGINE_HISTORY_DAYS,sql});
  }
  const after=await readCurrentPreparedState(sql);
  return {ok:Boolean(after.ready),skipped:false,engineVersion:ENGINE_VERSION,noUpstreamFetch:true,mode,before,after,result};
}
async function getFundflowSnapshot({days=10,force=false}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now(),hit=memoryCache.get(bounded);
  if(!force&&hit&&now-hit.savedAt<5*60*1000)return hit.value;
  // Even an explicit refresh is read-only here: bypass memory/CDN and read the prepared row,
  // but never rebuild the engine from a public fundflow request. Settings manual warm owns writes.
  const prepared=await readPreparedSnapshot(sql,'overview',bounded);if(prepared){memoryCache.set(bounded,{savedAt:now,value:prepared});return prepared;}
  const fallback=await readLatestPreparedSnapshotAnyEngine(sql,'overview',bounded);if(fallback){memoryCache.set(bounded,{savedAt:now,value:fallback});return fallback;}
  throw new Error('XY 新引擎尚待手動建立 snapshot');
}
async function getFundflowBusinessBrowser({days=10,force=false}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now(),hit=browserMemoryCache.get(bounded);if(!force&&hit&&now-hit.savedAt<10*60*1000)return hit.value;
  const prepared=await readPreparedSnapshot(sql,'browser',bounded);if(prepared){browserMemoryCache.set(bounded,{savedAt:now,value:prepared});return prepared;}
  // Browser entry is also snapshot-only; never rebuild company coverage/member maps on a user read.
  const fallback=await readLatestPreparedSnapshotAnyEngine(sql,'browser',bounded);if(fallback){browserMemoryCache.set(bounded,{savedAt:now,value:fallback});return fallback;}
  throw new Error('業務瀏覽器 snapshot 尚未手動建立');
}
async function getFundflowDetail({tagId,days=10}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),cleanTag=String(tagId||'').trim();if(!cleanTag)throw new Error('缺少業務 tag');
  const snapshot=await getFundflowSnapshot({days:bounded,force:false}),cacheKey=`${cleanTag}|${bounded}|${snapshot.asOf||''}`,now=Date.now(),hit=detailMemoryCache.get(cacheKey);if(hit&&now-hit.savedAt<10*60*1000)return hit.value;
  const input=await loadTagEngineInputs(sql,cleanTag,bounded);if(!input.dates.length||!input.profiles.length)throw new Error('此業務尚無可用 XY 明細');
  const detail=computeTagDetail(input.profiles,input.activityRows,cleanTag,{maxDates:bounded}),g=(snapshot.groups||[]).find(x=>x.tagId===cleanTag),sameEngine=!snapshot.enginePending&&String(snapshot.engineVersion||'')===ENGINE_VERSION;if(g&&sameEngine){detail.latest={...detail.latest,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,confirmation:g.confirmation,overheating:g.overheating,dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1};detail.projection=g.projection||detail.projection;detail.calibration=snapshot.calibration||detail.calibration;}detail.lazyLoaded=true;detailMemoryCache.set(cacheKey,{savedAt:now,value:detail});return detail;
}

module.exports={ENGINE_VERSION,DEFAULT_TRAJECTORY_DAYS,ENGINE_HISTORY_DAYS,STOCK_FLOW_LOOKBACK_DAYS,STOCK_FLOW_MIN_HISTORY_DAYS,STOCK_FLOW_SCALE_FLOOR_PCT,TOPIC_SINGLE_STOCK_CAP,VOTE_NEUTRAL_SCORE,SELF_RELATIVE_LOOKBACK_DAYS,SELF_RELATIVE_MIN_HISTORY_DAYS,PREPARED_SNAPSHOT_DAYS,PHASES,NON_CORE_EXPOSURE_BUDGET,stockFlowScale,continuousStockFlowScore,capWeightShares,applyCompanyExposureBudget,percentileRanks,percentileRanksNullable,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries,aggregateTagDate,computeBusinessFlow,computeTagDetail,quadrant,buildTransitionCalibration,projectGroup,ensureBusinessFlowSchema,refreshBusinessFlowDaily,getFundflowSnapshot,getFundflowDetail,getFundflowBusinessBrowser,buildBusinessBrowserCatalog,buildPreparedOverview,compactOverviewGroup,loadTagEngineInputs,rebuildPreparedFromStored,readCurrentPreparedState,warmCurrentEngineFromStoredDb};
