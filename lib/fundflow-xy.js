// StockZone v2.6.5.34 — split feature/path versions + compact topic history + incremental X20/Y5/activation
// Y = literal business-weighted 5-session constituent price return. Price remains the primary profit axis.
// X = 20-session institutional net-flow / turnover position. The literal 20D sign owns left/right;
// distance from zero is stock-first robust-scaled against that stock's PRIOR short-window flow variability.
// 5D / 1D institutional flow are momentum / acceleration signals only; they no longer flip the X20 regime.
// Topic activation is an equal-company price vote: daily change > +0.2% = 1, otherwise 0; missing = abstain.
// Path influence order is institutional > activation vote > similar-history. Data completeness only widens uncertainty.
// Credit stays Chip Quality; overheating/divergence stays Exhaustion (E). No future observation enters normalization.

function getSql(){ return require('./db').getSql(); }
const { resolveCompanyBusinessTags, parseAutoBusinessTags } = require('./company-business-tags');
const { classifyBusinessText } = require('./business-enrichment');
const { marketTopicLinks, listMarketDefinitions } = require('./market-topic-taxonomy');
const { ensureInstitutionalHistorySchema, institutionalCoverageByDate } = require('./institutional-history');
const { ensureCreditTradingSchema } = require('./credit-trading');

const FEATURE_VERSION = 'feature-1.0.0-x20-y5-activation02';
const PATH_MODEL_VERSION = 'path-1.0.0-inst50-activation30-history20';
const ENGINE_VERSION = 'xy-7.1.0-feature1-path1';
const DAILY_BUILD_VERSION = 'daily-6.5.0-compact-feature-incremental';
const SNAPSHOT_SCHEMA_VERSION = 'snapshot-6.5.0-feature-path-split';
const LEGACY_V33_ENGINE_VERSION = 'xy-7.0.0-x20-y5-activation-causal-path';
const LEGACY_V33_BUILD_VERSION = 'daily-6.4.0-x20-activation-incremental';
const DEFAULT_TRAJECTORY_DAYS = 15;
const ENGINE_HISTORY_DAYS = 60;
const STOCK_FLOW_POSITION_DAYS = 20;
const STOCK_FLOW_MOMENTUM_DAYS = 5;
const STOCK_FLOW_LOOKBACK_DAYS = 20;
const STOCK_FLOW_MIN_HISTORY_DAYS = 15;
const STOCK_FLOW_SCALE_FLOOR_PCT = 0.08;
const STOCK_FLOW_TANH_DIVISOR = 2.2;
const INCREMENTAL_SOURCE_DAYS = 25;
const FEATURE_HISTORY_TARGET_DAYS = 60;
const FEATURE_HISTORY_SOURCE_DAYS = 60;
const TOPIC_SINGLE_STOCK_CAP = 0.25;
const ACTIVATION_THRESHOLD_PCT = 0.2;
const PATH_INFLUENCE = Object.freeze({ institutional:0.50, activation:0.30, history:0.20 });
const PATH_MIN_COMPLETENESS_PCT = 50;
const VOTE_NEUTRAL_SCORE = 10; // compatibility export only; v7 voting no longer uses institutional score thresholds.
// Compatibility aliases for older callers/diagnostics. v7 no longer applies a topic-level percentile.
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
    const xyEligible=Boolean(g&&g.xyEligible!==false&&g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0&&validCount>=2&&trajectoryLength>=2);
    let noXYReason='';
    if(!companyCount)noXYReason='尚無公司映射';
    else if(companyCount<2)noXYReason='資料不足（僅 1 家）';
    else if(!g)noXYReason='資料不足（尚無價格軌跡）';
    else if(g.xAvailable===false||num(g.x)===null||Number(g.flowValidCount||0)===0)noXYReason='待法人資料（X 不以 0 代替）';
    else if(validCount<2)noXYReason=`資料不足（有效 ${validCount}/${companyCount} 家）`;
    else if(trajectoryLength<2)noXYReason='資料不足（XY 軌跡不足 2 日）';
    return {
      tagId:tag.id,name:tag.name,parentId:tag.parentId||'',parentName:tag.parentName||'',kind:tag.kind,resolution:tag.resolution,scope,
      aliases:[...(tag.aliases||[])],companyCount,examples:company.examples,companyNames:company.companyNames||[],companyCodes:company.companyCodes||[],represented:companyCount>0,
      hasXY:Boolean(g),xyEligible,noXYReason,asOf:snapshot?.asOf||'',
      x:g?.x??null,y:g?.y??null,rawX:g?.rawX??null,rawY:g?.rawY??null,xPercentile:g?.selfRelativeXPercentile??null,xHistoryDays:g?.xHistoryDays??null,quadrant:g?.quadrant||'',status:g?.status||'',statusLabel:g?.statusLabel||'',
      phaseState:g?.phaseState||'',phaseLabel:g?.phaseLabel||'',phaseConfidence:g?.phaseConfidence??null,
      confirmation:g?.confirmation??null,activationRate:g?.activationRate??g?.confirmation??null,activationValidCount:g?.activationValidCount??0,dataCompleteness:g?.dataCompleteness??g?.reliability??null,flow1Pct:g?.flow1Pct??null,flow5Pct:g?.flow5Pct??null,flow20Pct:g?.flow20Pct??g?.rawX??null,overheating:g?.overheating??null,projection:g?.projection||null,
      validCount:g?.validCount??0,flowValidCount:g?.flowValidCount??0,xAvailable:Boolean(g?.xAvailable!==false&&num(g?.x)!==null&&Number(g?.flowValidCount||0)>0),memberCount:g?.memberCount??companyCount,coveragePct:g?.coveragePct??0,reliability:g?.reliability??0,
      dx3:g?.dx3??null,dy3:g?.dy3??null,leaders:Array.isArray(g?.leaders)?g.leaders.slice(0,5):[]
    };
  }).sort((a,b)=>{
    const order={'technology-fine':0,'electronics-product':1,'traditional-coarse':2,'other':3};
    return (order[a.scope]-order[b.scope])||(b.companyCount-a.companyCount)||a.name.localeCompare(b.name,'zh-Hant');
  });
  const count=fn=>items.filter(fn).length;
  return {
    ok:true,asOf:snapshot?.asOf||'',engineVersion:snapshot?.engineVersion||ENGINE_VERSION,featureVersion:snapshot?.featureVersion||FEATURE_VERSION,pathModelVersion:snapshot?.pathModelVersion||PATH_MODEL_VERSION,snapshotSchemaVersion:snapshot?.snapshotSchemaVersion||SNAPSHOT_SCHEMA_VERSION,dailyBuildVersion:snapshot?.dailyBuildVersion||DAILY_BUILD_VERSION,
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

      // v7: X position is a real 20D regime. For the first usable X20 observation we already have
      // 15 causal, fully-formed 5D windows (days 5..19), so they provide the stock-specific robust
      // noise scale without requiring a 40D institutional backfill. Current raw20 never enters its own baseline.
      const raw5=r5.days>=STOCK_FLOW_MOMENTUM_DAYS?num(r5.ratio):null;
      const raw20=r20.days>=STOCK_FLOW_POSITION_DAYS?num(r20.ratio):null;
      const history=priorFlow5.slice(-STOCK_FLOW_LOOKBACK_DAYS),scale=stockFlowScale(history),historyDays=history.length;
      const maturity=Math.min(1,Math.max(0,historyDays)/STOCK_FLOW_MIN_HISTORY_DAYS),dayCoverage=Math.min(1,r20.days/STOCK_FLOW_POSITION_DAYS),stockFlowReliability=maturity*dayCoverage;
      row.stock_flow_scale=scale;row.stock_flow_history_days=historyDays;row.stock_flow_maturity_pct=maturity*100;row.stock_flow_reliability=stockFlowReliability;
      row.stock_flow_score=raw20===null?null:continuousStockFlowScore(raw20,historyDays,scale);
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

// Stock-level X is the stock's causal robust 20D institutional position.
// 5D / 1D raw institutional flow remain separately available for path momentum.
function scoreStocksForDate(rows){
  const r=rows.map(x=>({...x}));
  const ranks={value_ratio_20:percentileRanks(r.map(x=>x.value_ratio_20)),value_trend_5_15:percentileRanks(r.map(x=>x.value_trend_5_15))};
  return r.map((x,i)=>{
    const legacyX=.55*ranks.value_ratio_20[i]+.45*ranks.value_trend_5_15[i];
    const rawFlow=num(x.inst_flow_ratio_20),flowScore=num(x.stock_flow_score),priceReturnPct=num(x.return_5_pct)??num(x.change_pct);
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
  const valid=(items||[]).filter(x=>num(x.stockFlowScore??x.stockX)!==null&&num(x.inst_flow_ratio_20)!==null);
  if(!valid.length)return [];
  const turnovers=valid.map(x=>num(x.inst_turnover_value_20)).filter(v=>v!==null&&v>0),medTurnover=median(turnovers)||1;
  const entries=valid.map(item=>{
    const turnover=Math.max(0,num(item.inst_turnover_value_20)??0),liquidity=turnover>0?clampRange(Math.sqrt(turnover/medTurnover),.5,2.5):.5;
    const reliability=clampRange((num(item.stock_flow_reliability)??0),0,1),businessWeight=Math.max(.01,num(item.weight)??importanceWeight(item.importance));
    return {item,baseWeight:businessWeight*liquidity*Math.max(.15,reliability),liquidity,reliability,businessWeight};
  });
  const shares=capWeightShares(entries,TOPIC_SINGLE_STOCK_CAP);
  return entries.map((x,i)=>({...x,topicWeight:shares[i]}));
}
function weightedByTopic(flowEntries,key){let sum=0,w=0;for(const e of flowEntries||[]){const v=num(e.item?.[key]),ww=num(e.topicWeight);if(v===null||ww===null||ww<=0)continue;sum+=v*ww;w+=ww;}return w?sum/w:null;}
function equalShare(items,predicate,key='change_pct'){const valid=(items||[]).filter(x=>num(x?.[key])!==null);if(!valid.length)return null;return valid.filter(predicate).length/valid.length*100;}
function topicActivationMetrics(items,memberCount){
  const valid=(items||[]).filter(x=>num(x.change_pct)!==null),active=valid.filter(x=>(num(x.change_pct)??-Infinity)>ACTIVATION_THRESHOLD_PCT).length,total=valid.length,member=Math.max(Number(memberCount||0),total),abstain=Math.max(0,member-total);
  return {activeCount:active,inactiveCount:Math.max(0,total-active),validCount:total,abstainCount:abstain,activationRate:total?active/total*100:0,participationRate:member?total/member*100:0};
}
function summarizeTagItemsRaw(items,denom){
  const validCount=items.length,memberCount=Number(denom?.memberCount||validCount||0);if(!validCount)return null;
  const coveragePct=memberCount?validCount/memberCount*100:0,totalBusinessWeight=Math.max(0,num(denom?.totalWeight)??items.reduce((sum,x)=>sum+Math.max(0,num(x.weight)??0),0)),presentWeight=items.reduce((sum,x)=>sum+Math.max(0,num(x.weight)??0),0),businessCoveragePct=totalBusinessWeight>0?clamp(presentWeight/totalBusinessWeight*100):coveragePct;
  const flowEntries=topicFlowItems(items),flowItems=flowEntries.map(e=>e.item),flowBusinessWeight=flowItems.reduce((sum,x)=>sum+Math.max(0,num(x.weight)??0),0),flowCoveragePct=totalBusinessWeight>0?clamp(flowBusinessWeight/totalBusinessWeight*100):0;

  // X20: robust history decides magnitude; literal weighted 20D institutional flow decides side.
  // Short-term 5D/1D flow are retained as motion signals but can never flip the current X20 side.
  const xAvailable=flowEntries.length>0;
  const robustAggregate=xAvailable?flowEntries.reduce((sum,e)=>sum+(num(e.item.stockFlowScore??e.item.stockX)??0)*(num(e.topicWeight)??0),0):0;
  const rawX=xAvailable?flowEntries.reduce((sum,e)=>sum+(num(e.item.inst_flow_ratio_20)??0)*(num(e.topicWeight)??0),0):0;
  const rawSide=sign(rawX),x=xAvailable?(rawSide===0?0:rawSide*Math.abs(robustAggregate)):0;
  const themeFlow1Pct=weightedByTopic(flowEntries,'inst_flow_ratio_1'),themeFlow5Pct=weightedByTopic(flowEntries,'inst_flow_ratio_5'),themeFlow10Pct=weightedByTopic(flowEntries,'inst_flow_ratio_10'),themeFlow20Pct=xAvailable?rawX:null;
  const themeReturn1Pct=weightedMean(items,'change_pct'),themeReturn3Pct=weightedMean(items,'return_3_pct'),themeReturn5Pct=weightedMean(items,'return_5_pct'),themeReturn20Pct=weightedMean(items,'return_20_pct');
  const y=num(themeReturn5Pct)??0,themeStreak=weightedByTopic(flowEntries,'inst_streak'),themeAgreement=weightedByTopic(flowEntries,'inst_agreement');

  // Equal-company price activation. No institutional vote and no large-cap vote weight.
  const activation=topicActivationMetrics(items,memberCount),activationRate=activation.activationRate;
  const priceBreadth=equalShare(items,a=>(num(a.return_5_pct)??0)>0,'return_5_pct')??0,upBreadth=activationRate;
  const topicShares=flowEntries.map(e=>num(e.topicWeight)??0).filter(v=>v>0),maxShare=topicShares.length?Math.max(...topicShares):1,n=topicShares.length;
  const ideal=n?1/n:1,concentrationQuality=n<=1?25:clamp((1-maxShare)/Math.max(.0001,1-ideal)*100,25,100),topFlowSharePct=maxShare*100;
  const sampleReliability=Math.min(1,Math.sqrt(Math.max(0,flowEntries.length)/5)),coverageReliability=Math.min(1,flowCoveragePct/80),stockReliability=flowEntries.length?flowEntries.reduce((sum,e)=>sum+(num(e.item.stock_flow_reliability)??0)*(num(e.topicWeight)??0),0):0;
  const xReliability=sampleReliability*coverageReliability*clampRange(stockReliability,0,1),dataCompleteness=clamp(Math.min(coveragePct,flowCoveragePct||0,activation.participationRate||0));
  const reliability=clampRange(dataCompleteness/100,0,1);
  const legacyMedian=weightedMedian(items,'legacyStockX')??50,legacyMean=weightedMean(items,'legacyStockX')??50,legacyBreadth=weightedShare(items,a=>a.legacyStockX>=60)??0,legacyBaseX=.45*legacyMedian+.25*legacyMean+.30*legacyBreadth,legacyX=clamp(50+(legacyBaseX-50)*Math.max(.25,xReliability)),rawCreditCorrection=clamp(weightedMean(items,'creditCorrection')??0,-15,15);
  // C now means price activation breadth only. Completeness and institutional quality are kept separate.
  const confirmation=clamp(activationRate);
  return {
    memberCount,validCount,flowValidCount:flowEntries.length,xAvailable,coveragePct:round(coveragePct),businessCoveragePct:round(businessCoveragePct),reliability:round(reliability*100),dataCompleteness:round(dataCompleteness),
    x:xAvailable?round(x,3):null,rawX:xAvailable?round(rawX,4):null,y:round(y,4),rawY:round(y,4),institutionalX:xAvailable?round(rawX,4):null,creditCorrection:round(rawCreditCorrection,2),legacyX:round(legacyX,2),
    flowCoveragePct:round(flowCoveragePct),flowBreadth:round(activationRate),sellBreadth:0,neutralBreadth:round(100-activationRate),abstainBreadth:round(Math.max(0,100-activation.participationRate)),voteAgreement:round(activationRate),coreSync:round(activationRate),institutionAgreement:round(Math.abs(themeAgreement??0)),persistence:round(Math.min(100,Math.abs(themeStreak??0)*20)),
    activationRate:round(activationRate),activationThresholdPct:ACTIVATION_THRESHOLD_PCT,activationValidCount:activation.validCount,activationActiveCount:activation.activeCount,activationAbstainCount:activation.abstainCount,activationParticipationPct:round(activation.participationRate),
    concentrationQuality:round(concentrationQuality),topFlowSharePct:round(topFlowSharePct),rawCreditCorrection:round(rawCreditCorrection,2),
    themeFlow1Pct,themeFlow5Pct,themeFlow10Pct,themeFlow20Pct,themeReturn1Pct,themeReturn3Pct,themeReturn5Pct,themeReturn20Pct,themeStreak,themeAgreement,confirmation:round(confirmation),activityBreadth:round(activationRate),priceBreadth:round(priceBreadth),upBreadth:round(upBreadth),
    xMedian:xAvailable?roundNullable(median(flowItems.map(a=>num(a.stockFlowScore??a.stockX))),2):null,xMean:xAvailable?round(x,2):null,xHistoryDays:xAvailable?round(weightedByTopic(flowEntries,'stock_flow_history_days')??0,1):0,xMaturityPct:xAvailable?round(weightedByTopic(flowEntries,'stock_flow_maturity_pct')??0,1):0,selfRelativeXPercentile:xAvailable?round(Math.abs(x),1):null,
    rawXMedian:xAvailable?roundNullable(median(flowItems.map(a=>num(a.inst_flow_ratio_20))),4):null,yMedian:round(weightedMedian(items,'stockY')??0,4),yMean:round(weightedMean(items,'stockY')??0,4),baseY:round(y,4),strongCount:items.filter(a=>(num(a.change_pct)??-Infinity)>ACTIVATION_THRESHOLD_PCT).length,
    topicWeightCapPct:round(Math.min(100,Math.max(TOPIC_SINGLE_STOCK_CAP,n?1/n+.10:1)*100),1)
  };
}

function normalizeTagSummaries(rawSummaries){
  return (rawSummaries||[]).map(r=>{
    const xAvailable=Boolean(r.xAvailable!==false&&Number(r.flowValidCount||0)>0&&num(r.x)!==null),x=xAvailable?num(r.x):null,rawX=xAvailable?(num(r.rawX)??num(r.themeFlow20Pct)):null,y=num(r.y)??num(r.themeReturn5Pct)??0,creditQuality=clamp(50+(num(r.rawCreditCorrection)??0)/15*50);
    const factorSignals={x:{
      available:xAvailable,robustX:xAvailable?round(x,2):null,rawInst20:xAvailable?roundNullable(rawX,4):null,inst1:xAvailable?roundNullable(r.themeFlow1Pct,3):null,inst5:xAvailable?roundNullable(r.themeFlow5Pct,3):null,inst10:xAvailable?roundNullable(r.themeFlow10Pct,3):null,inst20:xAvailable?roundNullable(r.themeFlow20Pct,3):null,
      activationRate:round(r.activationRate??0),activationThresholdPct:ACTIVATION_THRESHOLD_PCT,activationParticipationPct:round(r.activationParticipationPct??0),activeCount:Number(r.activationActiveCount||0),voteValidCount:Number(r.activationValidCount||0),abstainCount:Number(r.activationAbstainCount||0),
      concentrationQuality:xAvailable?round(r.concentrationQuality??50):null,creditQuality:round(creditQuality),flowCoverage:round(r.flowCoveragePct??0),businessCoverage:round(r.businessCoveragePct??0),dataCompleteness:round(r.dataCompleteness??r.reliability??0),weightCapPct:xAvailable?round(r.topicWeightCapPct??0,1):null
    },y:{changePct:round(num(r.themeReturn1Pct)??0,3),return3Pct:round(num(r.themeReturn3Pct)??0,3),return5Pct:round(num(r.themeReturn5Pct)??0,3),return20Pct:round(num(r.themeReturn20Pct)??0,3),persistence5:round(r.priceBreadth??0),activationRate:round(r.activationRate??0)}};
    return {...r,x:xAvailable?round(x,3):null,rawX:xAvailable?roundNullable(rawX,4):null,y:round(y,4),rawY:round(y,4),institutionalX:xAvailable?roundNullable(rawX,4):null,creditCorrection:round(num(r.rawCreditCorrection)??0,2),baseX:xAvailable?round(x,3):null,factorSignals};
  });
}
function collectTagItems(scoredRows,profileMaps,tagId){
  const items=[];for(const row of scoredRows){const code=String(row.stock_code||'').trim(),profile=profileMaps.byCode.get(code);if(!profile)continue;for(const link of profile.links){if(tagId&&link.id!==tagId)continue;items.push({tagId:link.id,item:tagItem(row,profile,link)});}}return items;
}
function aggregateTagDate(scoredRows,profileMaps,date){
  const groups=new Map();for(const pair of collectTagItems(scoredRows,profileMaps)){if(!groups.has(pair.tagId))groups.set(pair.tagId,[]);groups.get(pair.tagId).push(pair.item);}
  const staged=[];
  for(const [tagId,items] of groups){const meta=profileMaps.tagMeta.get(tagId);if(!meta)continue;const denom=profileMaps.denominator.get(tagId)||{memberCount:items.length,totalWeight:items.reduce((s,x)=>s+x.weight,0)},raw=summarizeTagItemsRaw(items,denom);if(!raw)continue;staged.push({tagId,items,meta,raw});}
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
  const validX=[];
  for(let i=0;i<trajectory.length;i++){
    const p=trajectory[i],xOk=p.xAvailable!==false&&num(p.x)!==null;
    p.xAvailable=xOk;p.rawY=num(p.rawY)??num(p.y)??0;p.y=p.rawY;p.flow1Pct=num(p.flow1Pct??p.themeFlow1Pct??p.factorSignals?.x?.inst1);p.flow5Pct=num(p.flow5Pct??p.themeFlow5Pct??p.factorSignals?.x?.inst5);p.flow20Pct=num(p.flow20Pct??p.themeFlow20Pct??p.rawX);p.activationRate=num(p.activationRate??p.factorSignals?.x?.activationRate??p.flowBreadth)??0;p.dataCompleteness=num(p.dataCompleteness??p.reliability)??0;
    const prev=trajectory[i-1]||p,prev2=trajectory[i-2]||prev;
    p.dy1=round((num(p.y)??0)-(num(prev.y)??0),4);
    const p3=trajectory[Math.max(0,i-3)]||trajectory[0]||p;
    p.dy3=round((num(p.y)??0)-(num(p3.y)??0),4);
    const prevDy=(num(prev.y)??0)-(num(prev2.y)??0);p.ddy1=round(p.dy1-prevDy,4);
    if(xOk){
      p.x=num(p.x);p.rawX=num(p.rawX)??p.x;
      const prevX=validX.at(-1)||p,prevX2=validX.at(-2)||prevX,prevX3=validX.at(-3)||validX[0]||p;
      p.dx1=round(p.x-(num(prevX.x)??p.x),4);p.dx3=round(p.x-(num(prevX3.x)??p.x),4);
      const prevDx=(num(prevX.x)??p.x)-(num(prevX2.x)??num(prevX.x)??p.x);p.ddx1=round(p.dx1-prevDx,4);
      validX.push(p);
    }else{
      // Private placeholder only. Public snapshots persist/return NULL for unavailable X.
      p.x=0;p.rawX=0;p.dx1=null;p.dx3=null;p.ddx1=null;
    }
    const heatLevel=clamp((p.y-4)*12.5),capitalFade=xOk?clamp(50-(num(p.dx3)??0)*1.25):50,priceFade=clamp(50-p.dy1*14),breadthFade=clamp(50+((num(prev.priceBreadth)??num(p.priceBreadth)??50)-(num(p.priceBreadth)??50))*2);
    p.overheating=round(clamp(.50*heatLevel+.20*capitalFade+.18*priceFade+.12*breadthFade));p.confirmation=round(num(p.confirmation)??0);
    if(!xOk){p.rawPhaseState='';p.rawPhaseConfidence=0;p.phaseState='';p.phaseLabel='待法人資料';p.phaseConfidence=0;continue;}
    const raw=rawPhaseForPoint(p);p.rawPhaseState=raw.key;p.rawPhaseConfidence=raw.confidence;
  }
  let confirmed='transition',candidate='',streak=0,started=false;
  for(const p of trajectory){
    if(!p.xAvailable){continue;}
    if(!started){confirmed=p.rawPhaseState||'transition';started=true;}
    if(p.rawPhaseState===confirmed){candidate='';streak=0;}else if(p.rawPhaseState===candidate)streak++;else{candidate=p.rawPhaseState;streak=1;}
    if(p.rawPhaseConfidence>=86||streak>=2){confirmed=p.rawPhaseState;candidate='';streak=0;}
    const meta=phaseMeta(confirmed);p.phaseState=confirmed;p.phaseLabel=meta.label;p.phaseConfidence=round(clamp(.72*p.rawPhaseConfidence+.28*(num(p.confirmation)??50)));
  }
  return trajectory;
}
function movementStatus(latest){
  if(!latest?.xAvailable)return {key:'',label:'待法人資料'};
  const s=latest.phaseState||'transition';
  const labels={cold:'混沌／方向未明',germination:'資金先行',potential:'資金先行',mainline:'共振轉強',overheating:'強勢延續',cooling:'轉弱',transition:'混沌／方向未明'};
  return {key:s,label:labels[s]||'混沌／方向未明'};
}
function attachTrajectories(rowsByDate,dates,{smooth=false}={}){
  const byTag=new Map();for(const date of dates)for(const row of rowsByDate.get(date)||[]){if(!byTag.has(row.tagId))byTag.set(row.tagId,[]);byTag.get(row.tagId).push(row);}const groups=[];
  for(const [tagId,trajectory] of byTag){
    trajectory.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));decorateDynamics(trajectory,{smooth:false});const latest=trajectory.at(-1);if(!latest)continue;
    const validX=trajectory.filter(p=>p.xAvailable),status=movementStatus(latest),q=latest.xAvailable?quadrant(latest.x,latest.y):'';
    let rightMoves=0,totalMoves=0;for(let i=Math.max(1,validX.length-5);i<validX.length;i++){totalMoves++;if(validX[i].x>validX[i-1].x)rightMoves++;}
    const rightPersistence=totalMoves?rightMoves/totalMoves*100:0,xScore=latest.xAvailable?flowPhaseScore(latest.x):0,yScore=pricePhaseScore(latest.y),dxScore=latest.xAvailable?clamp(50+(num(latest.dx3)??0)*1.25):50,dyScore=clamp(50+(num(latest.dy3)??0)*12),potentialScore=latest.xAvailable&&['germination','potential'].includes(latest.phaseState)?xScore*.40+dxScore*.20+dyScore*.20+latest.confirmation*.20:0,mainlineScore=latest.xAvailable&&latest.phaseState==='mainline'?xScore*.30+yScore*.35+latest.confirmation*.25+clamp(50+(num(latest.dx3)??0)*1.25+(num(latest.dy3)??0)*6)*.10:0,coolingScore=latest.xAvailable&&['overheating','cooling'].includes(latest.phaseState)?latest.overheating*.45+(100-dxScore)*.25+(100-dyScore)*.20+(100-latest.confirmation)*.10:0,rotationScore=latest.xAvailable?xScore*.25+yScore*.15+dxScore*.25+dyScore*.20+rightPersistence*.15:0;
    groups.push({...latest,quadrant:q,status:status.key,statusLabel:status.label,dx1:latest.xAvailable?latest.dx1:null,dy1:latest.dy1,dx3:latest.xAvailable?latest.dx3:null,dy3:latest.dy3,ddx1:latest.xAvailable?latest.ddx1:null,ddy1:latest.ddy1,rightPersistence:latest.xAvailable?round(rightPersistence):null,potentialScore:round(potentialScore),mainlineScore:round(mainlineScore),coolingScore:round(coolingScore),rotationScore:round(rotationScore),trajectory:trajectory.map(p=>({date:p.tradeDate,xAvailable:Boolean(p.xAvailable),flowValidCount:Number(p.flowValidCount||0),x:p.xAvailable?round(p.x,4):null,y:round(p.y,4),rawX:p.xAvailable?round(p.rawX,4):null,rawY:round(p.rawY,4),xPercentile:p.xAvailable?round(p.selfRelativeXPercentile??Math.abs(p.x),1):null,xHistoryDays:Number(p.xHistoryDays||0),institutionalX:p.xAvailable?roundNullable(p.institutionalX,4):null,creditCorrection:round(p.creditCorrection,2),legacyX:round(p.legacyX,2),flowBreadth:round(p.flowBreadth,1),activationRate:round(p.activationRate??p.flowBreadth,1),flow1Pct:roundNullable(p.flow1Pct,4),flow5Pct:roundNullable(p.flow5Pct,4),flow20Pct:roundNullable(p.flow20Pct??p.rawX,4),dataCompleteness:round(p.dataCompleteness??p.reliability,1),concentrationQuality:round(p.concentrationQuality,1),confirmation:p.xAvailable?p.confirmation:null,overheating:p.overheating,phaseState:p.xAvailable?p.phaseState:'',phaseLabel:p.xAvailable?p.phaseLabel:'待法人資料',phaseConfidence:p.xAvailable?p.phaseConfidence:null,dx1:p.xAvailable?p.dx1:null,dy1:p.dy1,dx3:p.xAvailable?p.dx3:null,dy3:p.dy3,ddx1:p.xAvailable?p.ddx1:null,ddy1:p.ddy1,activityBreadth:p.activityBreadth,priceBreadth:p.priceBreadth,upBreadth:p.upBreadth,validCount:p.validCount,reliability:p.reliability,factors:p.factorSignals||p.factors||{}}))});
  }
  return groups;
}

const FALLBACK_VECTOR=Object.freeze({
  cold:{dx:0,dy:0},germination:{dx:6,dy:.35},potential:{dx:4,dy:.55},mainline:{dx:3,dy:.65},overheating:{dx:-2,dy:.10},cooling:{dx:-7,dy:-.65},transition:{dx:0,dy:0}
});
const X_DIRECTION_UNIT=10,Y_DIRECTION_UNIT=.90;
function directionLabel(dx,dy){const nx=(num(dx)??0)/X_DIRECTION_UNIT,ny=(num(dy)??0)/Y_DIRECTION_UNIT,t=.85;if(nx>=t&&ny>=t)return '右上';if(nx>=t&&ny<=-t)return '右下';if(nx<=-t&&ny>=t)return '左上';if(nx<=-t&&ny<=-t)return '左下';if(nx>=t)return '向右';if(nx<=-t)return '向左';if(ny>=t)return '向上';if(ny<=-t)return '向下';return '盤整';}
const DIRECTION_VECTORS=Object.freeze({'右上':{x:1,y:1},'右下':{x:1,y:-1},'左上':{x:-1,y:1},'左下':{x:-1,y:-1},'向右':{x:1,y:0},'向左':{x:-1,y:0},'向上':{x:0,y:1},'向下':{x:0,y:-1},'盤整':{x:0,y:0}});
function directionVector(label){return DIRECTION_VECTORS[label]||DIRECTION_VECTORS['盤整'];}
function directionSimilarity(a,b){if(a===b)return 1;const va=directionVector(a),vb=directionVector(b),na=Math.hypot(va.x,va.y),nb=Math.hypot(vb.x,vb.y);if(!na||!nb)return a==='盤整'&&b==='盤整'?1:.18;return clamp(((va.x*vb.x+va.y*vb.y)/(na*nb)+1)/2,0,1);}
function displacementStats(arr){const dx=arr.map(x=>x.dx),dy=arr.map(x=>x.dy);return {n:arr.length,medianDx:round(median(dx)??0,2),medianDy:round(median(dy)??0,2),q20Dx:round(quantile(dx,.2)??0,2),q80Dx:round(quantile(dx,.8)??0,2),q20Dy:round(quantile(dy,.2)??0,2),q80Dy:round(quantile(dy,.8)??0,2)};}
function tanhUnit(v,scale){const n=num(v)??0;return Math.tanh(n/Math.max(.0001,scale));}
function pathFeatureVector(p){return [
  clampRange(num(p?.x)??0,-100,100)/100,
  clampRange(num(p?.y)??0,-15,15)/15,
  clampRange(num(p?.dx3)??0,-35,35)/35,
  clampRange(num(p?.dy3)??0,-6,6)/6,
  tanhUnit(p?.flow5Pct??p?.factorSignals?.x?.inst5,1.0),
  tanhUnit(p?.flow1Pct??p?.factorSignals?.x?.inst1,1.2),
  clampRange(((num(p?.activationRate??p?.flowBreadth)??50)-50)/50,-1,1),
  clampRange(((num(p?.confirmation)??50)-50)/50,-1,1)
];}
function pathFeatureDistance(a,b){const w=[1.0,.8,1.0,.7,1.6,.8,1.4,.35],aa=pathFeatureVector(a),bb=pathFeatureVector(b);let sum=0,ws=0;for(let i=0;i<w.length;i++){sum+=w[i]*(aa[i]-bb[i])**2;ws+=w[i];}return Math.sqrt(sum/Math.max(.001,ws));}
function buildTransitionCalibration(groups){
  const horizons=[3,5,10],buckets={},samples={};let sampleCount=0;const dateSet=new Set();
  for(const g of groups||[])for(const p of g.trajectory||[])if(p.xAvailable!==false&&num(p.x)!==null)dateSet.add(p.date);
  for(const phase of Object.keys(PHASES)){buckets[phase]={};for(const h of horizons)buckets[phase][h]=[];}for(const h of horizons)samples[h]=[];
  for(const g of groups||[]){const t=(g.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null);for(let i=0;i<t.length;i++){const s=t[i].phaseState||'transition';for(const h of horizons){if(i+h>=t.length)continue;const rec={anchor:t[i],dx:t[i+h].x-t[i].x,dy:t[i+h].y-t[i].y};rec.direction=directionLabel(rec.dx,rec.dy);rec.completeness=num(t[i].dataCompleteness??t[i].reliability)??100;buckets[s]??={};buckets[s][h]??=[];buckets[s][h].push(rec);samples[h].push(rec);sampleCount++;}}}
  const stats={};for(const [state,byH] of Object.entries(buckets)){stats[state]={};for(const [h,arr] of Object.entries(byH)){const base=displacementStats(arr),directions={};for(const label of Object.keys(DIRECTION_VECTORS)){const subset=arr.filter(x=>x.direction===label);if(subset.length)directions[label]=displacementStats(subset);}stats[state][h]={...base,directions};}}
  const historyDays=dateSet.size,maturityPct=round(clamp((historyDays-5)/45*100));
  return {historyDays,maturityPct,sampleCount,horizons,stats,samples};
}
function nearestTransitionStats(group,calibration,h){
  const all=(calibration?.samples?.[h]||[]).map(rec=>({...rec,d:pathFeatureDistance(group,rec.anchor)})).sort((a,b)=>a.d-b.d),k=Math.min(80,Math.max(12,Math.round(Math.sqrt(all.length||1)*3))),near=all.slice(0,k),weights=new Map(),byDir={};let total=0;
  for(const rec of near){const quality=clampRange((num(rec.completeness)??100)/100,.25,1),w=quality/((.10+rec.d)**2);total+=w;weights.set(rec,(weights.get(rec)||0)+w);(byDir[rec.direction]??=[]).push({...rec,w});}
  const probs={};for(const label of Object.keys(DIRECTION_VECTORS)){const a=byDir[label]||[],w=a.reduce((sum,x)=>sum+x.w,0);probs[label]=(w+.25)/(total+.25*Object.keys(DIRECTION_VECTORS).length);}
  const dirStats={};for(const [label,a] of Object.entries(byDir)){const expanded=[];for(const rec of a){const copies=Math.max(1,Math.min(12,Math.round(rec.w/(a[0]?.w||1)*8)));for(let i=0;i<copies;i++)expanded.push(rec);}dirStats[label]=displacementStats(expanded);}
  return {n:near.length,probs,byDirection:dirStats,nearest:near};
}
function evidenceDistribution(targetDir,strength){
  const labels=Object.keys(DIRECTION_VECTORS),s=clampRange(strength,0,1),raw=labels.map(label=>{const sim=directionSimilarity(label,targetDir);return {label,v:Math.exp(4.2*s*(sim-.50))};}),sum=raw.reduce((a,x)=>a+x.v,0)||1;return Object.fromEntries(raw.map(x=>[x.label,x.v/sum]));
}
function uniformDirectionDistribution(){const labels=Object.keys(DIRECTION_VECTORS),p=1/labels.length;return Object.fromEntries(labels.map(x=>[x,p]));}
function scenarioTendency(state,p5){if(['germination','potential'].includes(state)&&p5.dx>0)return '資金先行';if(state==='mainline'&&p5.dy>=0)return '強勢延續';if(state==='cooling'&&(p5.dx<0||p5.dy<0))return '轉弱';if(p5.dx>8&&p5.dy>1)return '共振轉強';if(p5.dx<-8&&p5.dy<-1)return '共振轉弱';if(p5.dy>1&&p5.dx<=0)return '價格先行';if(p5.dx>8&&p5.dy<=0)return '資金先行';return '方向未明';}
function currentSignalState(group){
  const x20=num(group.x)??0,flow5=num(group.flow5Pct??group.factorSignals?.x?.inst5)??0,flow1=num(group.flow1Pct??group.factorSignals?.x?.inst1)??flow5,activation=clamp(num(group.activationRate??group.flowBreadth)??0);
  const positionForce=tanhUnit(x20,55),momentumForce=tanhUnit(flow5,.85),accelForce=tanhUnit(flow1,1.05),capitalForce=clampRange(.45*positionForce+.40*momentumForce+.15*accelForce,-1,1);
  // Activation is a 1/0 breadth vote. Low participation is weak/absent positive confirmation, never a synthetic -1 vote.
  const activationForce=clampRange(activation/100,0,1);
  return {x20,flow5,flow1,activation,positionForce,momentumForce,accelForce,capitalForce,activationForce,capitalDir:Math.abs(capitalForce)<.06?'盤整':capitalForce>0?'向右':'向左',activationDir:activationForce<.02?'盤整':'向上'};
}
function scenarioDirectionScores(group,calibration,state,fallback){
  const labels=Object.keys(DIRECTION_VECTORS),signal=currentSignalState(group),capDist=evidenceDistribution(signal.capitalDir,Math.abs(signal.capitalForce)),voteDist=evidenceDistribution(signal.activationDir,Math.abs(signal.activationForce)),nearest=nearestTransitionStats(group,calibration,5),histDist=nearest.n?nearest.probs:uniformDirectionDistribution(),eps=1e-6,raw=[];
  for(const label of labels){const logScore=PATH_INFLUENCE.institutional*Math.log((capDist[label]||eps)+eps)+PATH_INFLUENCE.activation*Math.log((voteDist[label]||eps)+eps)+PATH_INFLUENCE.history*Math.log((histDist[label]||eps)+eps);raw.push({label,logScore,n:Number(nearest.byDirection?.[label]?.n||0)});}
  const max=Math.max(...raw.map(x=>x.logScore)),exp=raw.map(x=>({...x,score:Math.exp(x.logScore-max)})),sum=exp.reduce((a,x)=>a+x.score,0)||1;return exp.map(x=>({...x,routeShare:x.score/sum*100,confidence:x.score/sum*100,signal,nearest})).sort((a,b)=>b.routeShare-a.routeShare);
}
function buildScenarioPath(group,calibration,state,fallback,choice,rank){
  const dir=choice.label,points=[],signal=choice.signal||currentSignalState(group),completeness=clamp(num(group.dataCompleteness??group.reliability)??0),capitalVelocity=signal.capitalForce*10,activationVelocity=signal.activationForce*2.2;
  for(const h of [3,5,10]){
    const near=nearestTransitionStats(group,calibration,h),dst=near.byDirection?.[dir]||null,histDx=num(dst?.medianDx)??0,histDy=num(dst?.medianDy)??0;
    const recentDx=(num(group.dx3)??0)/3*h,recentDy=(num(group.dy3)??0)/3*h,instDx=(.55*recentDx+.45*capitalVelocity*h/5),instDy=signal.capitalForce*.9*h/5,voteDy=(.35*recentDy+.65*activationVelocity*h/5);
    // No direction sign enforcement: the chosen family does not get to rewrite contradictory evidence.
    const dx=.80*instDx+.20*histDx,dy=.50*instDy+.30*voteDy+.20*histDy,startX=num(group.x)??0,x=clampRange(startX+dx,-100,100),actualDx=x-startX,y=(num(group.y)??0)+dy;
    const histSpreadX=dst&&dst.n>=4?Math.max(4,Math.max(Math.abs((num(dst.q20Dx)??histDx)-histDx),Math.abs((num(dst.q80Dx)??histDx)-histDx))):Math.max(6,10*h/5),histSpreadY=dst&&dst.n>=4?Math.max(.40,Math.max(Math.abs((num(dst.q20Dy)??histDy)-histDy),Math.abs((num(dst.q80Dy)??histDy)-histDy))):Math.max(.55,.95*h/5),completenessScale=.80+(100-completeness)/100*1.55,horizonScale=1+.10*(h/3-1),spreadX=histSpreadX*completenessScale*horizonScale,spreadY=histSpreadY*completenessScale*horizonScale;
    points.push({horizon:h,x:round(x,4),y:round(y,4),dx:round(actualDx,4),dy:round(dy,4),sampleN:Number(dst?.n||near.n||0),lowX:round(clampRange(x-spreadX,-100,100),4),highX:round(clampRange(x+spreadX,-100,100),4),lowY:round(y-spreadY,4),highY:round(y+spreadY,4)});
  }
  const p5=points.find(p=>p.horizon===5)||points[0];return {id:rank===0?'A':'B',rank:rank+1,direction:dir,tendency:scenarioTendency(state,p5),confidence:round(choice.routeShare,1),routeShare:round(choice.routeShare,1),sampleN:choice.n,points};
}
function projectGroup(group,calibration){
  const state=group.phaseState||'transition',fallback=FALLBACK_VECTOR[state]||FALLBACK_VECTOR.transition,maturity=num(calibration?.maturityPct)??0,completeness=clamp(num(group.dataCompleteness??group.reliability)??0);
  if(completeness<PATH_MIN_COMPLETENESS_PCT)return {mode:'insufficient-data',state,stateLabel:phaseMeta(state).label,tendency:'資料不足',direction:'',confidence:0,dataCompletenessPct:completeness,historyDays:calibration?.historyDays||0,maturityPct:maturity,points:[],scenarios:[],primary:null,secondary:null,pathGap:0,chaosLevel:'資料不足',top2Share:0,residualPct:100,caution:`資料完整度 ${round(completeness)}% 低於 ${PATH_MIN_COMPLETENESS_PCT}%：不產生 Future Path。`};
  const choices=scenarioDirectionScores(group,calibration,state,fallback),selected=choices.slice(0,2);
  const scenarios=selected.map((choice,i)=>buildScenarioPath(group,calibration,state,fallback,choice,i)),primary=scenarios[0],secondary=scenarios[1],pathGap=round(Math.max(0,(primary?.routeShare||0)-(secondary?.routeShare||0))),chaosLevel=pathGap<=7?'高混沌':pathGap<=18?'中度分歧':pathGap<=30?'有次要劇本':'主路徑明確',top2Share=round((primary?.routeShare||0)+(secondary?.routeShare||0)),residualPct=round(Math.max(0,100-top2Share));
  return {mode:'institutional-activation-history-top2',state,stateLabel:phaseMeta(state).label,tendency:primary?.tendency||'方向未明',direction:primary?.direction||'盤整',confidence:primary?.routeShare||0,dataCompletenessPct:completeness,influence:{...PATH_INFLUENCE},historyDays:calibration?.historyDays||0,maturityPct:maturity,points:primary?.points||[],scenarios,primary,secondary,pathGap,chaosLevel,top2Share,residualPct,caution:'Path 方向依法人 > 價格發動率 > 相似歷史；資料完整度不改方向，只放大/縮小未來不確定圈。'};
}
function decorateProjections(groups,calibration){for(const g of groups||[]){const xyPoints=(g.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null);g.xyEligible=Boolean(g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0&&xyPoints.length>=2);g.projection=g.xyEligible?projectGroup(g,calibration):null;}return groups;}

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
    institutionalX:roundNullable(item.stockInstitutionalX,3),stockFlowScale:roundNullable(item.stockFlowScale,3),stockFlowHistoryDays:Number(item.stockFlowHistoryDays||0),stockFlowReliability:roundNullable(item.stockFlowReliability,1),creditCorrection:round(num(item.creditCorrection)||0,1),legacyX:round(num(item.legacyStockX)||50,1),instFlow1Pct:roundNullable(item.inst_flow_ratio_1,3),instFlow5Pct:roundNullable(item.inst_flow_ratio_5,3),instFlow10Pct:roundNullable(item.inst_flow_ratio_10,3),instFlow20Pct:roundNullable(item.inst_flow_ratio_20,3),
    positiveDays5:num(item.positive_days_5)??0,changePct:round(num(item.change_pct)||0,2),return3Pct:round(num(item.return_3_pct)||0,2),return5Pct:round(num(item.return_5_pct)||0,2),return20Pct:round(num(item.return_20_pct)||0,2)
  };}).sort((a,b)=>b.impactScore-a.impactScore||((b.stockX+b.stockY)-(a.stockX+a.stockY)));
  const latestFactors=latestPoint?.factors||{};
  const enrichedTrajectory=trajectory.map(p=>({...p,factors:p.factors||{}}));
  return {ok:true,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,tagId:cleanTag,name:meta.name,parentName:meta.parentName||'',scope:meta.scope,asOf:latestPoint.date,trajectoryDays:enrichedTrajectory.length,trajectory:enrichedTrajectory,
    latest:{x:g.x,y:g.y,rawX:g.rawX,rawY:g.rawY,xPercentile:g.selfRelativeXPercentile,xHistoryDays:g.xHistoryDays,institutionalX:g.institutionalX,creditCorrection:g.creditCorrection,legacyX:g.legacyX,quadrant:g.quadrant,status:g.status,statusLabel:g.statusLabel,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,confirmation:g.confirmation,overheating:g.overheating,
      dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1,memberCount:g.memberCount,validCount:g.validCount,coveragePct:g.coveragePct,reliability:g.reliability,dataCompleteness:g.dataCompleteness,activityBreadth:g.activityBreadth,flowBreadth:g.flowBreadth,activationRate:g.activationRate,activationValidCount:g.activationValidCount,flow1Pct:g.flow1Pct??g.themeFlow1Pct,flow5Pct:g.flow5Pct??g.themeFlow5Pct,flow20Pct:g.flow20Pct??g.themeFlow20Pct,concentrationQuality:g.concentrationQuality,priceBreadth:g.priceBreadth,upBreadth:g.upBreadth,factors:latestFactors,
      groupBuild:{themeFlow1Pct:roundNullable(latestRawSummary.themeFlow1Pct,3),themeFlow5Pct:roundNullable(latestRawSummary.themeFlow5Pct,3),themeFlow10Pct:roundNullable(latestRawSummary.themeFlow10Pct,3),themeFlow20Pct:roundNullable(latestRawSummary.themeFlow20Pct,3),flowBreadth:latestRawSummary.flowBreadth,concentrationQuality:latestRawSummary.concentrationQuality,institutionalX:latestRawSummary.institutionalX,creditCorrection:latestRawSummary.creditCorrection,legacyX:latestRawSummary.legacyX,themeReturn1Pct:roundNullable(latestRawSummary.themeReturn1Pct,3),themeReturn3Pct:roundNullable(latestRawSummary.themeReturn3Pct,3),themeReturn5Pct:roundNullable(latestRawSummary.themeReturn5Pct,3),themeReturn20Pct:roundNullable(latestRawSummary.themeReturn20Pct,3),yMedian:latestRawSummary.yMedian,yMean:latestRawSummary.yMean,priceBreadth:latestRawSummary.priceBreadth,upBreadth:latestRawSummary.upBreadth,reliability:latestRawSummary.reliability,businessWeights:IMPORTANCE_WEIGHT}},
    projection,calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount},companies,
    methodology:{impact:'公司 X 貢獻以移除該公司後重新計算題材 robust X 的差表示；單一公司權重受流動性平方根與題材內 cap 限制。Y 貢獻仍是移除後的 5 日價格報酬差。',factor:'X 先逐股計算近20日法人淨買賣超／成交值，20D 真實正負決定左右；距離以該股先前 5D 法人流量波動做 causal robust scaling。5D／1D法人只代表短期速度／加速度。投票改為每家公司一票：當日漲幅 > +0.2% 計1票，其餘0票，完全不使用法人與權值股權重。Y＝題材近5日實際價格漲跌幅。',projection:'Future Path 影響力為法人 > 價格發動率 > 相似歷史；資料完整度不改方向，只控制預測是否成立與颱風圈寬度。A/B 機率不再乘 reliability，也移除方向 sign-enforce。'}};
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
      activity_breadth numeric,flow_breadth numeric,flow_concentration_quality numeric,price_breadth numeric,up_breadth numeric,strong_count integer,flow_valid_count integer,x_available boolean,
      leaders jsonb,feature_version text,path_model_version text,engine_version text NOT NULL,build_version text,updated_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY (trade_date,tag_id)
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
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS flow_valid_count integer`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS x_available boolean`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS flow_1_pct numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS flow_5_pct numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS flow_20_pct numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS activation_rate numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS activation_valid_count integer`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS data_completeness_pct numeric`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS feature_version text`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS path_model_version text`,
    `ALTER TABLE market_business_xy_daily ADD COLUMN IF NOT EXISTS build_version text`,
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
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_feature_date_idx ON market_business_xy_daily (feature_version,trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_snapshot_asof_idx ON market_business_xy_snapshot (engine_version,as_of DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_member_tag_idx ON market_business_xy_member (engine_version,tag_id)`);
  // .33 already used the same X20/Y5/+0.2% feature schema. Re-label those compact rows in-DB
  // instead of downloading/rebuilding them. Path-model changes must never invalidate reusable features.
  await sql.query(`UPDATE market_business_xy_daily SET feature_version=$1 WHERE feature_version IS NULL AND engine_version=$2 AND build_version=$3`,[FEATURE_VERSION,LEGACY_V33_ENGINE_VERSION,LEGACY_V33_BUILD_VERSION]).catch(()=>{});
  await sql.query(`
    INSERT INTO market_business_xy_member (engine_version,tag_id,stock_code,market,importance,weight,updated_at)
    SELECT $1,tag_id,stock_code,market,importance,weight,NOW() FROM market_business_xy_member WHERE engine_version=$2
    ON CONFLICT (engine_version,tag_id,stock_code,market) DO UPDATE SET importance=EXCLUDED.importance,weight=EXCLUDED.weight,updated_at=NOW()
  `,[FEATURE_VERSION,LEGACY_V33_ENGINE_VERSION]).catch(()=>{});
  schemaReady=true;
}

function clearFundflowCaches(){memoryCache.clear();browserMemoryCache.clear();detailMemoryCache.clear();}
function jsonPayload(v){if(!v)return null;if(typeof v==='string'){try{return JSON.parse(v)}catch{return null}}return typeof v==='object'?v:null;}
function compactProjection(p){
  if(!p||typeof p!=='object')return null;
  const point=x=>({horizon:Number(x?.horizon)||0,x:round(x?.x,4),y:round(x?.y,4),dx:round(x?.dx,4),dy:round(x?.dy,4),sampleN:Number(x?.sampleN||0),lowX:round(x?.lowX,4),highX:round(x?.highX,4),lowY:round(x?.lowY,4),highY:round(x?.highY,4)});
  const scenario=s=>({id:s?.id||'',rank:Number(s?.rank||0),direction:s?.direction||'',tendency:s?.tendency||'',confidence:round(s?.confidence,1),routeShare:round(s?.routeShare,1),sampleN:Number(s?.sampleN||0),points:(s?.points||[]).map(point)});
  const scenarios=(p.scenarios||[]).slice(0,2).map(scenario),primary=scenarios[0]||null,secondary=scenarios[1]||null;
  return {mode:p.mode||'institutional-activation-history-top2',state:p.state||'',stateLabel:p.stateLabel||'',tendency:p.tendency||primary?.tendency||'',direction:p.direction||primary?.direction||'',confidence:round(p.confidence??primary?.confidence,1),dataCompletenessPct:round(p.dataCompletenessPct,1),influence:p.influence||PATH_INFLUENCE,historyDays:Number(p.historyDays||0),maturityPct:round(p.maturityPct,1),points:(p.points||primary?.points||[]).map(point),scenarios,primary,secondary,pathGap:round(p.pathGap,1),chaosLevel:p.chaosLevel||'',top2Share:round(p.top2Share,1),residualPct:round(p.residualPct,1)};
}
function compactOverviewGroup(g,days){
  const xAvailable=Boolean(g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0),xyEligible=Boolean(g.xyEligible&&xAvailable);
  return {tagId:g.tagId,name:g.name,parentName:g.parentName||'',scope:g.scope,memberCount:Number(g.memberCount||0),validCount:Number(g.validCount||0),flowValidCount:Number(g.flowValidCount||0),xAvailable,xyEligible,coveragePct:round(g.coveragePct,1),reliability:round(g.reliability,1),x:xAvailable?round(g.x,4):null,y:round(g.y,4),rawX:xAvailable?round(g.rawX,4):null,rawY:round(g.rawY??g.y,4),xPercentile:xAvailable?round(g.selfRelativeXPercentile??Math.abs(g.x),1):null,xHistoryDays:Number(g.xHistoryDays||0),quadrant:xAvailable?g.quadrant:'',status:xyEligible?g.status:'',statusLabel:xyEligible?g.statusLabel:'待法人資料',phaseState:xyEligible?g.phaseState:'',phaseLabel:xyEligible?g.phaseLabel:'待法人資料',phaseConfidence:xyEligible?round(g.phaseConfidence,1):null,confirmation:xAvailable?round(g.confirmation,1):null,activationRate:round(g.activationRate??g.flowBreadth,1),dataCompleteness:round(g.dataCompleteness??g.reliability,1),flow1Pct:roundNullable(g.flow1Pct??g.themeFlow1Pct,4),flow5Pct:roundNullable(g.flow5Pct??g.themeFlow5Pct,4),flow20Pct:roundNullable(g.flow20Pct??g.rawX,4),overheating:round(g.overheating,1),dx1:xyEligible?round(g.dx1,4):null,dy1:xyEligible?round(g.dy1,4):null,dx3:xyEligible?round(g.dx3,4):null,dy3:xyEligible?round(g.dy3,4):null,ddx1:xyEligible?round(g.ddx1,4):null,ddy1:xyEligible?round(g.ddy1,4):null,rightPersistence:xyEligible?round(g.rightPersistence,1):null,potentialScore:xyEligible?round(g.potentialScore,1):0,mainlineScore:xyEligible?round(g.mainlineScore,1):0,coolingScore:xyEligible?round(g.coolingScore,1):0,rotationScore:xyEligible?round(g.rotationScore,1):0,leaders:(g.leaders||[]).slice(0,3).map(x=>({code:String(x?.code||''),name:x?.name||''})),projection:xyEligible?compactProjection(g.projection):null,trajectory:(g.trajectory||[]).slice(-days).map(p=>({date:p.date,x:p.xAvailable===false?null:round(p.x,4),y:round(p.y,4),xAvailable:p.xAvailable!==false}))};
}
function compactPick(g){return {tagId:g.tagId,name:g.name,x:round(g.x,4),y:round(g.y,4),phaseState:g.phaseState,phaseLabel:g.phaseLabel,potentialScore:round(g.potentialScore,1),mainlineScore:round(g.mainlineScore,1),coolingScore:round(g.coolingScore,1),rotationScore:round(g.rotationScore,1),projection:g.projection?{direction:g.projection.direction||'',confidence:round(g.projection.confidence,1),pathGap:round(g.projection.pathGap,1),chaosLevel:g.projection.chaosLevel||''}:null};}
function scopeCounts(groups){const out={'technology-fine':0,'traditional-coarse':0,'electronics-product':0,'other':0};for(const g of groups)out[g.scope]=(out[g.scope]||0)+1;return out;}
function buildPreparedOverview(fullGroups,allDates,calibration,days){
  const bounded=Math.max(5,Math.min(15,Number(days)||10)),groups=(fullGroups||[]).map(g=>({...g,trajectory:(g.trajectory||[]).slice(-bounded)})),businessEligible=g=>g.validCount>=2&&g.trajectory.length>=2,eligible=g=>businessEligible(g)&&g.xyEligible!==false&&g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0;
  const rising=groups.filter(g=>eligible(g)&&['germination','potential'].includes(g.phaseState)&&g.projection?.points?.find(p=>p.horizon===5)?.dy>0).sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,10);
  const mainline=groups.filter(g=>eligible(g)&&g.phaseState==='mainline').sort((a,b)=>b.mainlineScore-a.mainlineScore).slice(0,10);
  const cooling=groups.filter(g=>eligible(g)&&['overheating','cooling'].includes(g.phaseState)).sort((a,b)=>b.coolingScore-a.coolingScore).slice(0,10);
  const rightMoving=groups.filter(g=>eligible(g)&&g.dx3>8).sort((a,b)=>b.rotationScore-a.rotationScore).slice(0,10);
  return {ok:true,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,asOf:allDates.at(-1),trajectoryDates:allDates.slice(-bounded),trajectoryDays:Math.min(bounded,allDates.length),preparedSnapshot:true,
    axes:{x:'近20日法人資金位置',y:'近5日題材價格漲跌幅',center:0,xUnit:'robust-score',yUnit:'%',xWindow:20,yWindow:5,momentumWindow:5,xLookback:STOCK_FLOW_LOOKBACK_DAYS},
    methodology:{stockX:'每檔股票 raw X＝近20日三大法人淨買賣超金額／近20日成交值；20D 真實正負決定左右，距離用該股當日以前 5D 法人流量波動做 causal robust scaling。5D／1D 法人只當速度／加速度。',stockY:'Y 只描述題材成分公司近5日實際報酬的業務關聯加權平均；價格是主要獲利方向，不加入法人、信用、breadth 或可靠度修正。',group:'題材 X 仍以業務關聯度×流動性×資料可靠度 capped 聚合，避免單一大型股壟斷 X；投票層則完全等權，一家公司一票，當日漲幅 > +0.2% 計1票，其餘0票。',phase:'X20 是中期資金位置；5D／1D法人描述短期資金速度；Activation 描述族群價格共振；Y5 是短期價格位置；E 與 Chip Quality 保持獨立。',projection:'Future Path 依 法人50% > Activation30% > 相似歷史20% 形成方向分布；A/B 顯示該分布的 Top-2。資料完整度不參與方向，只控制最低預測門檻與不確定圈。',caution:'X 是 robust 資金強度分數而非百分比；raw X 是20D法人流量比例。Activation 只表示成分股發動廣度，不代表因果歸因。'},
    calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount,warmup:calibration.historyDays<30},
    counts:{groups:groups.length,businessEligible:groups.filter(businessEligible).length,withXY:groups.filter(eligible).length,pendingX:groups.filter(g=>businessEligible(g)&&!eligible(g)).length,byScope:scopeCounts(groups),rising:rising.length,mainline:mainline.length,cooling:cooling.length},
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
  `,[JSON.stringify(payload),FEATURE_VERSION]);
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
function isCurrentPreparedPayload(payload,engineVersion=ENGINE_VERSION){
  return Boolean(payload&&String(payload.engineVersion||engineVersion)===ENGINE_VERSION&&String(payload.featureVersion||'')===FEATURE_VERSION&&String(payload.pathModelVersion||'')===PATH_MODEL_VERSION&&String(payload.snapshotSchemaVersion||'')===SNAPSHOT_SCHEMA_VERSION);
}
async function readPreparedSnapshot(sql,kind,days){
  const rows=await sql.query(`SELECT engine_version,payload,as_of,updated_at FROM market_business_xy_snapshot WHERE engine_version=$1 AND snapshot_kind=$2 AND trajectory_days=$3 LIMIT 1`,[ENGINE_VERSION,kind,days]);
  const payload=jsonPayload(rows?.[0]?.payload);return isCurrentPreparedPayload(payload,rows?.[0]?.engine_version)?payload:null;
}
async function readLatestPreparedSnapshotAnyEngine(sql,kind,days){
  const rows=await sql.query(`SELECT engine_version,payload,as_of,updated_at FROM market_business_xy_snapshot WHERE snapshot_kind=$1 AND trajectory_days=$2 ORDER BY updated_at DESC LIMIT 6`,[kind,days]);
  for(const row of rows||[]){
    const payload=jsonPayload(row?.payload);if(!payload)continue;
    const staleEngineVersion=String(row?.engine_version||payload.engineVersion||''),schemaVersion=String(payload.snapshotSchemaVersion||'');
    const current=isCurrentPreparedPayload(payload,staleEngineVersion);
    return {...payload,enginePending:!current,targetEngineVersion:ENGINE_VERSION,staleEngineVersion,snapshotSchemaPending:schemaVersion!==SNAPSHOT_SCHEMA_VERSION,targetSnapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,staleSnapshotSchemaVersion:schemaVersion||'legacy'};
  }
  return null;
}
async function loadEngineInputs(sql,trajectoryDays){
  // Full-market feature materialization deliberately requests only the columns needed by
  // X20/Y5/Activation. Credit remains lazy/topic-detail only; keeping it out of this query
  // cuts Neon outbound substantially without changing XY or Future Path inputs.
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
  const sourceDays=Math.max(INCREMENTAL_SOURCE_DAYS,Math.min(FEATURE_HISTORY_SOURCE_DAYS,Number(trajectoryDays)||INCREMENTAL_SOURCE_DAYS));
  const dateRows=await sql.query(`
    WITH activity_dates AS (
      SELECT trade_date FROM market_activity_daily
      WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value > 0 AND return_5_pct IS NOT NULL
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    ), inst_dates AS (
      SELECT trade_date FROM institutional_trading_daily
      WHERE market IN ('上市','上櫃')
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    )
    SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date)
    ORDER BY a.trade_date DESC LIMIT $1
  `,[sourceDays]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates,activityRows:[],sourceDays};
  const activityRows=await sql.query(`
    SELECT a.trade_date,a.stock_code,a.stock_name,a.market,a.trade_value,a.change_pct,a.value_ratio_20,a.value_trend_5_15,a.positive_days_5,a.return_3_pct,a.return_5_pct,a.return_20_pct,
      h.close_price,h.trade_volume,
      i.foreign_net AS institutional_foreign_net,i.trust_net AS institutional_trust_net,i.dealer_net AS institutional_dealer_net,i.total_net AS institutional_total_net
    FROM market_activity_daily a
    LEFT JOIN market_daily_history h ON h.trade_date=a.trade_date AND h.stock_code=a.stock_code AND h.market=a.market
    LEFT JOIN institutional_trading_daily i ON i.trade_date=a.trade_date AND i.stock_code=a.stock_code AND i.market=a.market
    WHERE a.trade_value IS NOT NULL AND a.trade_value > 0 AND a.return_5_pct IS NOT NULL
      AND a.trade_date >= $1::date AND a.trade_date <= $2::date AND a.market IN ('上市','上櫃')
    ORDER BY a.stock_code,a.trade_date
  `,[dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:activityRows.filter(x=>dates.includes(isoDate(x.trade_date))),sourceDays};
}
async function resolveMemberEngine(sql,tagId=''){
  const clean=String(tagId||'').trim();
  const current=await sql.query(`SELECT EXISTS(SELECT 1 FROM market_business_xy_member WHERE engine_version=$1 ${clean?"AND tag_id=$2":""} LIMIT 1) AS ready`,clean?[FEATURE_VERSION,clean]:[FEATURE_VERSION]);
  if(current?.[0]?.ready)return FEATURE_VERSION;
  const rows=clean
    ?await sql.query(`SELECT engine_version FROM market_business_xy_member WHERE tag_id=$1 ORDER BY updated_at DESC LIMIT 1`,[clean])
    :await sql.query(`SELECT engine_version FROM market_business_xy_member ORDER BY updated_at DESC LIMIT 1`);
  return String(rows?.[0]?.engine_version||'');
}
async function loadTagEngineInputs(sql,tagId,trajectoryDays){
  const cleanTag=String(tagId||'').trim();if(!cleanTag)return {profiles:[],dates:[],activityRows:[]};
  // Read paths never rebuild the full member index. If v7 has not been warmed manually yet,
  // reuse the newest prior-engine member list for this one topic only.
  const memberEngine=await resolveMemberEngine(sql,cleanTag);if(!memberEngine)return {profiles:[],dates:[],activityRows:[]};
  const profiles=await sql.query(`
    SELECT DISTINCT p.stock_code,p.stock_name,p.market,p.industry_code,p.industry,p.auto_business_tags,p.auto_market_topics,p.main_business,p.business_enrich_status,p.business_enrich_version,p.business_enrich_checked_at
    FROM market_company_profile p JOIN market_business_xy_member m ON m.stock_code=p.stock_code AND m.market=p.market
    WHERE m.engine_version=$1 AND m.tag_id=$2 ORDER BY p.stock_code
  `,[memberEngine,cleanTag]);
  if(!profiles.length)return {profiles,dates:[],activityRows:[]};
  const dateRows=await sql.query(`
    WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value > 0 AND return_5_pct IS NOT NULL GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2)
    SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) ORDER BY a.trade_date DESC LIMIT $1
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
    WHERE a.trade_value IS NOT NULL AND a.trade_value > 0 AND a.return_5_pct IS NOT NULL AND a.trade_date >= $3::date AND a.trade_date <= $4::date AND a.market IN ('上市','上櫃')
    ORDER BY a.stock_code,a.trade_date
  `,[memberEngine,cleanTag,dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:enrichFlowFeatures(activityRows.filter(x=>dates.includes(isoDate(x.trade_date)))),memberEngine};
}
function compactDailyFeatureRow(date,row){
  return {trade_date:date,tag_id:row.tagId,tag_name:row.name,parent_name:row.parentName||null,scope:row.scope,member_count:row.memberCount,valid_count:row.validCount,coverage_pct:row.coveragePct,reliability_pct:row.reliability,x_score:row.xAvailable===false?null:row.x,y_score:row.y,raw_x_score:row.xAvailable===false?null:row.rawX,raw_y_score:row.rawY,institutional_x_score:row.xAvailable===false?null:row.institutionalX,credit_correction:row.creditCorrection,legacy_x_score:row.legacyX,confirmation_score:row.confirmation,overheating_score:row.overheating,phase_state:row.phaseState,phase_label:row.phaseLabel,phase_confidence:row.phaseConfidence,activity_breadth:row.activityBreadth,flow_breadth:row.flowBreadth,flow_concentration_quality:row.concentrationQuality,price_breadth:row.priceBreadth,up_breadth:row.upBreadth,strong_count:row.strongCount,flow_valid_count:Number(row.flowValidCount||0),x_available:Boolean(row.xAvailable!==false&&Number(row.flowValidCount||0)>0),flow_1_pct:row.themeFlow1Pct,flow_5_pct:row.themeFlow5Pct,flow_20_pct:row.themeFlow20Pct,activation_rate:row.activationRate,activation_valid_count:Number(row.activationValidCount||0),data_completeness_pct:row.dataCompleteness,leaders:row.leaders,feature_version:FEATURE_VERSION,path_model_version:null,engine_version:ENGINE_VERSION,build_version:DAILY_BUILD_VERSION};
}
async function persistCompactDailyFeatures(sql,payload){
  if(!payload?.length)return 0;
  await sql.query(`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(trade_date date,tag_id text,tag_name text,parent_name text,scope text,member_count integer,valid_count integer,coverage_pct numeric,reliability_pct numeric,x_score numeric,y_score numeric,raw_x_score numeric,raw_y_score numeric,institutional_x_score numeric,credit_correction numeric,legacy_x_score numeric,confirmation_score numeric,overheating_score numeric,phase_state text,phase_label text,phase_confidence numeric,activity_breadth numeric,flow_breadth numeric,flow_concentration_quality numeric,price_breadth numeric,up_breadth numeric,strong_count integer,flow_valid_count integer,x_available boolean,flow_1_pct numeric,flow_5_pct numeric,flow_20_pct numeric,activation_rate numeric,activation_valid_count integer,data_completeness_pct numeric,leaders jsonb,feature_version text,path_model_version text,engine_version text,build_version text)),
    refreshed_dates AS (SELECT DISTINCT trade_date FROM incoming),
    deleted AS (DELETE FROM market_business_xy_daily b WHERE b.feature_version=$2 AND b.trade_date IN (SELECT trade_date FROM refreshed_dates) AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.trade_date=b.trade_date AND i.tag_id=b.tag_id) RETURNING 1)
    INSERT INTO market_business_xy_daily (trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,data_completeness_pct,leaders,feature_version,path_model_version,engine_version,build_version,updated_at)
    SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,data_completeness_pct,leaders,feature_version,path_model_version,engine_version,build_version,NOW() FROM incoming
    ON CONFLICT (trade_date,tag_id) DO UPDATE SET tag_name=EXCLUDED.tag_name,parent_name=EXCLUDED.parent_name,scope=EXCLUDED.scope,member_count=EXCLUDED.member_count,valid_count=EXCLUDED.valid_count,coverage_pct=EXCLUDED.coverage_pct,reliability_pct=EXCLUDED.reliability_pct,x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,raw_x_score=EXCLUDED.raw_x_score,raw_y_score=EXCLUDED.raw_y_score,institutional_x_score=EXCLUDED.institutional_x_score,credit_correction=EXCLUDED.credit_correction,legacy_x_score=EXCLUDED.legacy_x_score,confirmation_score=EXCLUDED.confirmation_score,overheating_score=EXCLUDED.overheating_score,phase_state=EXCLUDED.phase_state,phase_label=EXCLUDED.phase_label,phase_confidence=EXCLUDED.phase_confidence,activity_breadth=EXCLUDED.activity_breadth,flow_breadth=EXCLUDED.flow_breadth,flow_concentration_quality=EXCLUDED.flow_concentration_quality,price_breadth=EXCLUDED.price_breadth,up_breadth=EXCLUDED.up_breadth,strong_count=EXCLUDED.strong_count,flow_valid_count=EXCLUDED.flow_valid_count,x_available=EXCLUDED.x_available,flow_1_pct=EXCLUDED.flow_1_pct,flow_5_pct=EXCLUDED.flow_5_pct,flow_20_pct=EXCLUDED.flow_20_pct,activation_rate=EXCLUDED.activation_rate,activation_valid_count=EXCLUDED.activation_valid_count,data_completeness_pct=EXCLUDED.data_completeness_pct,leaders=EXCLUDED.leaders,feature_version=EXCLUDED.feature_version,path_model_version=EXCLUDED.path_model_version,engine_version=EXCLUDED.engine_version,build_version=EXCLUDED.build_version,updated_at=NOW()
  `,[JSON.stringify(payload),FEATURE_VERSION]);
  return payload.length;
}
async function readCompactFeatureHistoryStatus(sql,{targetDays=FEATURE_HISTORY_TARGET_DAYS,horizon=5}={}){
  const target=Math.max(25,Math.min(120,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS)),h=Math.max(3,Math.min(10,Number(horizon)||5));
  const rows=await sql.query(`
    WITH dates AS (
      SELECT trade_date,
        COUNT(*)::int AS rows,
        COUNT(*) FILTER (WHERE x_available=true AND x_score IS NOT NULL)::int AS x_rows
      FROM market_business_xy_daily WHERE feature_version=$1
      GROUP BY trade_date ORDER BY trade_date
    ), usable AS (SELECT trade_date FROM dates WHERE x_rows>0), ranked AS (
      SELECT trade_date,ROW_NUMBER() OVER (ORDER BY trade_date) AS rn,COUNT(*) OVER () AS n FROM usable
    )
    SELECT (SELECT COUNT(*)::int FROM dates) AS compact_days,
      (SELECT COUNT(*)::int FROM usable) AS x_usable_days,
      (SELECT COUNT(*)::int FROM ranked WHERE rn+$2<=n) AS horizon_anchor_days,
      (SELECT MIN(trade_date)::text FROM dates) AS min_date,
      (SELECT MAX(trade_date)::text FROM dates) AS max_date,
      (SELECT COUNT(*)::int FROM market_business_xy_daily WHERE feature_version=$1) AS compact_rows
  `,[FEATURE_VERSION,h]).catch(()=>[]);
  const r=rows?.[0]||{};
  return {featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,targetDays:target,horizon:h,compactDays:Number(r.compact_days||0),xUsableDays:Number(r.x_usable_days||0),horizonAnchorDays:Number(r.horizon_anchor_days||0),compactRows:Number(r.compact_rows||0),minDate:isoDate(r.min_date)||null,maxDate:isoDate(r.max_date)||null,historyReady:Number(r.compact_days||0)>=target&&Number(r.horizon_anchor_days||0)>0};
}
async function refreshBusinessFlowDaily({trajectoryDays=INCREMENTAL_SOURCE_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  // Steady-state update: read only the bounded X20 source window, calculate the newest date,
  // append/replace that compact topic date, then rebuild tiny prepared snapshots from compact history.
  const input=await loadEngineInputs(sql,Math.min(INCREMENTAL_SOURCE_DAYS,Number(trajectoryDays)||INCREMENTAL_SOURCE_DAYS));
  if(!input.dates.length)return {ok:false,reason:'no-ready-activity-dates',dates:0,rows:0};
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:INCREMENTAL_SOURCE_DAYS}),latestDate=computed.dates.at(-1),payload=[];
  for(const row of computed.aggregated.get(latestDate)||[])payload.push(compactDailyFeatureRow(latestDate,row));
  if(!payload.length)return {ok:false,reason:'no-business-groups',dates:computed.dates.length,rows:0};
  await persistCompactDailyFeatures(sql,payload);await persistBusinessMembers(sql,computed.profileMaps);clearFundflowCaches();const prepared=await rebuildPreparedFromStored(sql);
  return {ok:true,mode:'latest-date-compact-incremental',sourceWindowDays:INCREMENTAL_SOURCE_DAYS,writeMode:'latest-date-only',featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,engineVersion:ENGINE_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,datesRead:computed.dates.length,datesWritten:1,rows:payload.length,latestTradeDate:latestDate,profileRows:input.profiles.length,activityRows:input.activityRows.length,preparedSnapshots:PREPARED_SNAPSHOT_DAYS,calibration:{historyDays:computed.calibration.historyDays,maturityPct:computed.calibration.maturityPct,sampleCount:computed.calibration.sampleCount}};
}
async function backfillCompactFeatureHistory({targetDays=FEATURE_HISTORY_TARGET_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  const target=Math.max(25,Math.min(FEATURE_HISTORY_SOURCE_DAYS,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS)),before=await readCompactFeatureHistoryStatus(sql,{targetDays:target});
  // One-time/resumable DB-only materialization. The raw source is bounded to 60 common days and
  // only minimal X20/Y5/Activation columns are read. Completed compact dates are reused on retries.
  if(before.compactDays>=target&&before.horizonAnchorDays>0)return {ok:true,skipped:true,reason:'compact-feature-history-already-ready',noUpstreamFetch:true,before,after:before,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION};
  const input=await loadEngineInputs(sql,target);if(!input.dates.length)return {ok:false,reason:'no-ready-common-dates',noUpstreamFetch:true,before};
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:target});
  const existingRows=await sql.query(`SELECT DISTINCT trade_date::text AS d FROM market_business_xy_daily WHERE feature_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date`,[FEATURE_VERSION,computed.dates[0],computed.dates.at(-1)]).catch(()=>[]),existing=new Set(existingRows.map(r=>isoDate(r.d)).filter(Boolean));
  let writeDates=computed.dates.filter(d=>!existing.has(d));
  // If all dates exist but the history is structurally unusable (e.g. interrupted old build), refresh
  // the bounded window once under the same feature version rather than creating a new engine history.
  if(!writeDates.length&&!before.historyReady)writeDates=[...computed.dates];
  let rowsWritten=0,datesWritten=0;
  for(let i=0;i<writeDates.length;i+=8){
    const slice=writeDates.slice(i,i+8),payload=[];
    for(const date of slice)for(const row of computed.aggregated.get(date)||[])payload.push(compactDailyFeatureRow(date,row));
    if(!payload.length)continue;
    await persistCompactDailyFeatures(sql,payload);rowsWritten+=payload.length;datesWritten+=slice.length;
  }
  await persistBusinessMembers(sql,computed.profileMaps);clearFundflowCaches();await rebuildPreparedFromStored(sql);
  const after=await readCompactFeatureHistoryStatus(sql,{targetDays:target});
  return {ok:true,skipped:false,mode:'compact-history-materialize-resumable',noUpstreamFetch:true,targetDays:target,sourceWindowDays:computed.dates.length,datesWritten,rows:rowsWritten,reusedDates:Math.max(0,computed.dates.length-datesWritten),featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,before,after};
}
async function needsRefresh(sql){
  await ensureBusinessFlowSchema(sql);
  const rows=await sql.query(`
    WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value > 0 AND return_5_pct IS NOT NULL GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2),
    common_dates AS (SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) ORDER BY a.trade_date DESC LIMIT 1)
    SELECT (SELECT MAX(trade_date) FROM common_dates) AS source_date,
      (SELECT MAX(trade_date) FROM market_business_xy_daily WHERE feature_version=$1) AS feature_date,
      (SELECT COUNT(*)::int FROM market_business_xy_daily WHERE feature_version=$1) AS feature_rows
  `,[FEATURE_VERSION]);
  const r=rows[0]||{};return !Number(r.feature_rows||0)||isoDate(r.feature_date)!==isoDate(r.source_date);
}
function hydrateStoredRows(rows,dates){
  const byDate=new Map(dates.map(d=>[d,[]]));for(const r of rows){const d=isoDate(r.trade_date);if(!byDate.has(d))continue;byDate.get(d).push({tradeDate:d,tagId:r.tag_id,name:r.tag_name,parentName:r.parent_name||'',scope:r.scope,memberCount:Number(r.member_count||0),validCount:Number(r.valid_count||0),coveragePct:num(r.coverage_pct)||0,reliability:num(r.reliability_pct)||0,xAvailable:Boolean(r.x_available!==false&&num(r.x_score)!==null&&Number(r.flow_valid_count||0)>0),flowValidCount:Number(r.flow_valid_count||0),x:num(r.x_score)??0,y:num(r.y_score)??0,rawX:num(r.raw_x_score)??0,rawY:num(r.raw_y_score)??num(r.y_score)??0,selfRelativeXPercentile:num(r.x_score)===null?null:Math.abs(num(r.x_score)),xHistoryDays:SELF_RELATIVE_LOOKBACK_DAYS,institutionalX:num(r.institutional_x_score),creditCorrection:num(r.credit_correction)??0,legacyX:num(r.legacy_x_score)??50,confirmation:num(r.confirmation_score)??0,overheating:num(r.overheating_score)||0,phaseState:r.phase_state||'',phaseLabel:r.phase_label||'',phaseConfidence:num(r.phase_confidence)??50,activityBreadth:num(r.activity_breadth)||0,flowBreadth:num(r.flow_breadth)??num(r.activity_breadth)??0,concentrationQuality:num(r.flow_concentration_quality)??50,priceBreadth:num(r.price_breadth)||0,upBreadth:num(r.up_breadth)||0,strongCount:Number(r.strong_count||0),flow1Pct:num(r.flow_1_pct),flow5Pct:num(r.flow_5_pct),flow20Pct:num(r.flow_20_pct)??num(r.raw_x_score),activationRate:num(r.activation_rate)??num(r.flow_breadth)??0,activationValidCount:Number(r.activation_valid_count||0),dataCompleteness:num(r.data_completeness_pct)??num(r.reliability_pct)??0,leaders:Array.isArray(r.leaders)?r.leaders:[]});}
  return attachTrajectories(byDate,dates,{smooth:false});
}
async function rebuildPreparedFromStored(sql){
  const dateRows=await sql.query(`SELECT DISTINCT trade_date FROM market_business_xy_daily WHERE feature_version=$1 ORDER BY trade_date DESC LIMIT $2`,[FEATURE_VERSION,ENGINE_HISTORY_DAYS]);
  const allDates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!allDates.length)return null;
  const rows=await sql.query(`SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,data_completeness_pct,leaders FROM market_business_xy_daily WHERE feature_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date ORDER BY trade_date,tag_id`,[FEATURE_VERSION,allDates[0],allDates.at(-1)]);
  const fullGroups=hydrateStoredRows(rows,allDates),calibration=buildTransitionCalibration(fullGroups);decorateProjections(fullGroups,calibration);
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
  await persistBusinessMembers(sql,buildProfileTagMap(profiles));clearFundflowCaches();return persistPreparedSnapshots(sql,{fullGroups,allDates,calibration,profiles});
}

async function readCurrentPreparedState(sql){
  await ensureBusinessFlowSchema(sql);
  const rows=await sql.query(`
    SELECT snapshot_kind,trajectory_days,as_of,updated_at,payload
    FROM market_business_xy_snapshot
    WHERE engine_version=$1 AND snapshot_kind IN ('overview','browser') AND trajectory_days = ANY($2::int[])
    ORDER BY snapshot_kind,trajectory_days
  `,[ENGINE_VERSION,PREPARED_SNAPSHOT_DAYS]);
  const currentRows=(rows||[]).filter(r=>isCurrentPreparedPayload(jsonPayload(r.payload),ENGINE_VERSION));
  const have=new Set(currentRows.map(r=>`${r.snapshot_kind}:${Number(r.trajectory_days)}`));
  const expected=[];for(const kind of ['overview','browser'])for(const days of PREPARED_SNAPSHOT_DAYS)expected.push(`${kind}:${days}`);
  const missing=expected.filter(k=>!have.has(k));
  const staleSchemaRows=(rows||[]).filter(r=>!isCurrentPreparedPayload(jsonPayload(r.payload),ENGINE_VERSION)).length;
  return {ready:missing.length===0,have:[...have].sort(),missing,staleSchemaRows,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,asOf:currentRows.map(r=>isoDate(r.as_of)).filter(Boolean).sort().at(-1)||null,updatedAt:currentRows.map(r=>r.updated_at).filter(Boolean).sort().at(-1)||null};
}
async function warmCurrentEngineFromStoredDb({sql=getSql(),force=false}={}){
  await ensureBusinessFlowSchema(sql);
  const before=await readCurrentPreparedState(sql),stale=await needsRefresh(sql);
  if(before.ready&&!force&&!stale)return {ok:true,skipped:true,reason:'current-engine-snapshots-already-latest',engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,noUpstreamFetch:true,before,after:before};
  let mode='prepared-from-compact-history',result=null;
  if(stale){result=await refreshBusinessFlowDaily({sql});mode=result?.mode||'latest-date-compact-incremental';}
  else {result=await rebuildPreparedFromStored(sql);if(!result){result=await refreshBusinessFlowDaily({sql});mode=result?.mode||'latest-date-compact-incremental';}}
  const after=await readCurrentPreparedState(sql);
  return {ok:Boolean(after.ready),skipped:false,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,noUpstreamFetch:true,mode,before,after,result};
}
async function getFundflowSnapshot({days=10,force=false}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now(),hit=memoryCache.get(bounded);
  // A serverless instance may have cached the temporary v5/old-schema fallback before a manual warm.
  // Never serve that fallback from process memory after v7 has been written by another instance.
  if(!force&&hit&&now-hit.savedAt<5*60*1000&&isCurrentPreparedPayload(hit.value))return hit.value;
  if(hit&&!isCurrentPreparedPayload(hit.value))memoryCache.delete(bounded);
  // Even an explicit refresh is read-only here: bypass memory/CDN and read the prepared row,
  // but never rebuild the engine from a public fundflow request. Settings manual warm owns writes.
  const prepared=await readPreparedSnapshot(sql,'overview',bounded);if(prepared){memoryCache.set(bounded,{savedAt:now,value:prepared});return prepared;}
  // Legacy fallback is deliberately NOT stored in process memory. That guarantees a later request
  // can see a newly-created v7 snapshot immediately, even when it lands on an older warm function.
  const fallback=await readLatestPreparedSnapshotAnyEngine(sql,'overview',bounded);if(fallback)return fallback;
  throw new Error('XY 新引擎尚待手動建立 snapshot');
}
async function getFundflowBusinessBrowser({days=10,force=false}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now(),hit=browserMemoryCache.get(bounded);
  if(!force&&hit&&now-hit.savedAt<10*60*1000&&isCurrentPreparedPayload(hit.value))return hit.value;
  if(hit&&!isCurrentPreparedPayload(hit.value))browserMemoryCache.delete(bounded);
  const prepared=await readPreparedSnapshot(sql,'browser',bounded);if(prepared){browserMemoryCache.set(bounded,{savedAt:now,value:prepared});return prepared;}
  // Browser entry is also snapshot-only; never rebuild company coverage/member maps on a user read.
  // As with overview, do not process-cache a temporary legacy fallback.
  const fallback=await readLatestPreparedSnapshotAnyEngine(sql,'browser',bounded);if(fallback)return fallback;
  throw new Error('業務瀏覽器 snapshot 尚未手動建立');
}
async function getFundflowDetail({tagId,days=10}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),cleanTag=String(tagId||'').trim();if(!cleanTag)throw new Error('缺少業務 tag');
  const snapshot=await getFundflowSnapshot({days:bounded,force:false}),snapshotPending=Boolean(snapshot.enginePending||snapshot.snapshotSchemaPending),cacheKey=`${cleanTag}|${bounded}|${snapshot.engineVersion||''}|${snapshot.snapshotSchemaVersion||''}|${snapshotPending?'pending':'ready'}|${snapshot.asOf||''}`,now=Date.now(),hit=detailMemoryCache.get(cacheKey);if(hit&&now-hit.savedAt<10*60*1000)return hit.value;
  const input=await loadTagEngineInputs(sql,cleanTag,bounded);if(!input.dates.length||!input.profiles.length)throw new Error('此業務尚無可用 XY 明細');
  const detail=computeTagDetail(input.profiles,input.activityRows,cleanTag,{maxDates:bounded}),g=(snapshot.groups||[]).find(x=>x.tagId===cleanTag),sameEngine=!snapshotPending&&String(snapshot.engineVersion||'')===ENGINE_VERSION;if(g&&sameEngine){detail.latest={...detail.latest,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,confirmation:g.confirmation,overheating:g.overheating,dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1};detail.projection=g.projection||detail.projection;detail.calibration=snapshot.calibration||detail.calibration;}detail.lazyLoaded=true;detail.snapshotSchemaVersion=SNAPSHOT_SCHEMA_VERSION;detail.dailyBuildVersion=DAILY_BUILD_VERSION;detail.snapshotPending=snapshotPending;if(!snapshotPending)detailMemoryCache.set(cacheKey,{savedAt:now,value:detail});return detail;
}


// ---------- v2.6.5.34 evidence gate -------------------------------------------------
// This audit deliberately reads compact, already-materialized DB layers instead of rebuilding
// the full stock engine. It is used from Settings to answer three questions with evidence:
// (1) which topics/companies are missing institutional history, (2) whether X/Y invariants hold
// on benchmark themes, and (3) what the Future Path model actually achieved in causal walk-forward.
async function loadPersistedBusinessGroupsForAudit(sql,{maxDates=80}={}){
  await ensureBusinessFlowSchema(sql);
  const dateRows=await sql.query(`
    SELECT trade_date::text AS d FROM (
      SELECT DISTINCT trade_date FROM market_business_xy_daily
      WHERE feature_version=$1
      ORDER BY trade_date DESC LIMIT $2
    ) q ORDER BY d
  `,[FEATURE_VERSION,Math.max(20,Math.min(120,Number(maxDates)||80))]);
  const dates=dateRows.map(r=>isoDate(r.d)).filter(Boolean);if(!dates.length)return {dates:[],groups:[]};
  const rows=await sql.query(`
    SELECT trade_date::text AS trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,
      coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,institutional_x_score,
      credit_correction,legacy_x_score,confirmation_score,overheating_score,phase_state,phase_label,
      phase_confidence,activity_breadth,flow_breadth,flow_concentration_quality,price_breadth,up_breadth,
      strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,data_completeness_pct
    FROM market_business_xy_daily
    WHERE feature_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date
    ORDER BY trade_date,tag_id
  `,[FEATURE_VERSION,dates[0],dates.at(-1)]);
  const byDate=new Map(dates.map(d=>[d,[]]));
  for(const r of rows||[]){
    const d=isoDate(r.trade_date);if(!byDate.has(d))continue;
    const x=num(r.x_score),xAvailable=Boolean(r.x_available!==false&&x!==null&&Number(r.flow_valid_count||0)>0);
    byDate.get(d).push({
      tradeDate:d,tagId:String(r.tag_id||''),name:r.tag_name||'',parentName:r.parent_name||'',scope:r.scope||'',
      memberCount:Number(r.member_count||0),validCount:Number(r.valid_count||0),flowValidCount:Number(r.flow_valid_count||0),
      coveragePct:num(r.coverage_pct)??0,reliability:num(r.reliability_pct)??0,xAvailable,x:xAvailable?x:null,
      y:num(r.y_score)??0,rawX:xAvailable?num(r.raw_x_score):null,rawY:num(r.raw_y_score)??num(r.y_score)??0,
      institutionalX:xAvailable?num(r.institutional_x_score):null,creditCorrection:num(r.credit_correction)??0,
      legacyX:num(r.legacy_x_score)??50,confirmation:xAvailable?(num(r.confirmation_score)??0):0,
      overheating:num(r.overheating_score)??0,phaseState:xAvailable?(r.phase_state||'transition'):'',phaseLabel:r.phase_label||'',
      phaseConfidence:xAvailable?(num(r.phase_confidence)??0):0,activityBreadth:num(r.activity_breadth)??0,
      flowBreadth:num(r.flow_breadth)??0,concentrationQuality:num(r.flow_concentration_quality)??0,
      priceBreadth:num(r.price_breadth)??0,upBreadth:num(r.up_breadth)??0,strongCount:Number(r.strong_count||0),flow1Pct:num(r.flow_1_pct),flow5Pct:num(r.flow_5_pct),flow20Pct:num(r.flow_20_pct)??num(r.raw_x_score),activationRate:num(r.activation_rate)??num(r.flow_breadth)??0,activationValidCount:Number(r.activation_valid_count||0),dataCompleteness:num(r.data_completeness_pct)??num(r.reliability_pct)??0
    });
  }
  return {dates,groups:attachTrajectories(byDate,dates,{smooth:false})};
}

function walkForwardPathAudit(groups,{horizon=5,minHistoryDays=1}={}){
  const h=Math.max(3,Math.min(10,Number(horizon)||5)),allGroups=groups||[];
  const dates=[...new Set(allGroups.flatMap(g=>(g.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null).map(p=>p.date)))].sort();
  const sourceByTag=new Map(allGroups.map(g=>[g.tagId,g]));
  const out={horizon:h,predictions:0,top1Hits:0,top2Hits:0,quadrantHits:0,confidence60N:0,confidence60Hits:0,routeShare60N:0,routeShare60Hits:0,byState:{},examples:[]},predictedAnchors=new Set();
  for(const anchor of dates){
    const truncated=[];
    for(const g of allGroups){
      const t=(g.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null&&p.date<=anchor);
      const latest=t.at(-1);if(!latest||latest.date!==anchor||t.length<2)continue;
      truncated.push({...g,...latest,x:latest.x,y:latest.y,rawX:latest.rawX,phaseState:latest.phaseState||'transition',phaseConfidence:latest.phaseConfidence,confirmation:latest.confirmation,overheating:latest.overheating,dx1:latest.dx1,dy1:latest.dy1,dx3:latest.dx3,dy3:latest.dy3,ddx1:latest.ddx1,ddy1:latest.ddy1,trajectory:t});
    }
    if(!truncated.length)continue;
    const calibration=buildTransitionCalibration(truncated);if(Number(calibration.historyDays||0)<minHistoryDays)continue;
    for(const g of truncated){
      const source=sourceByTag.get(g.tagId),valid=(source?.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null),i=valid.findIndex(p=>p.date===anchor);
      if(i<0||i+h>=valid.length)continue;
      const future=valid[i+h],projection=projectGroup(g,calibration),primary=projection?.primary,secondary=projection?.secondary;if(!primary)continue;
      const actual=directionLabel((num(future.x)??0)-(num(g.x)??0),(num(future.y)??0)-(num(g.y)??0)),pred=primary.direction||'盤整',pred2=secondary?.direction||'';
      const top1=pred===actual,top2=top1||pred2===actual,p5=(primary.points||[]).find(p=>Number(p.horizon)===h)||(primary.points||[]).at(-1),qHit=p5?quadrant(p5.x,p5.y)===quadrant(future.x,future.y):false;
      out.predictions++;predictedAnchors.add(anchor);if(top1)out.top1Hits++;if(top2)out.top2Hits++;if(qHit)out.quadrantHits++;
      if(Number(primary.confidence||0)>=60){out.confidence60N++;if(top1)out.confidence60Hits++;}
      if(Number(primary.routeShare||0)>=60){out.routeShare60N++;if(top1)out.routeShare60Hits++;}
      const state=g.phaseState||'transition',b=out.byState[state]||(out.byState[state]={n:0,top1Hits:0,top2Hits:0});b.n++;if(top1)b.top1Hits++;if(top2)b.top2Hits++;
      if(out.examples.length<12)out.examples.push({date:anchor,tagId:g.tagId,name:g.name||g.tagId,state,predicted:pred,secondary:pred2,actual,confidence:round(primary.confidence,1),routeShare:round(primary.routeShare,1),top1Hit:top1,top2Hit:top2});
    }
  }
  const pctHit=(n,d)=>d?round(n/d*100,1):null;
  const byState={};for(const [k,v] of Object.entries(out.byState))byState[k]={n:v.n,top1HitPct:pctHit(v.top1Hits,v.n),top2HitPct:pctHit(v.top2Hits,v.n)};
  return {horizon:h,usableDates:dates.length,anchorDates:predictedAnchors.size,predictions:out.predictions,top1HitPct:pctHit(out.top1Hits,out.predictions),top2HitPct:pctHit(out.top2Hits,out.predictions),targetQuadrantHitPct:pctHit(out.quadrantHits,out.predictions),confidence60:{n:out.confidence60N,top1HitPct:pctHit(out.confidence60Hits,out.confidence60N)},routeShare60:{n:out.routeShare60N,top1HitPct:pctHit(out.routeShare60Hits,out.routeShare60N)},target60Reached:out.predictions>=30&&pctHit(out.top1Hits,out.predictions)>=60,byState,examples:out.examples};
}

async function loadBenchmarkInputs(sql,tagIds,{maxDates=80}={}){
  const ids=[...new Set((tagIds||[]).map(x=>String(x||'').trim()).filter(Boolean))];if(!ids.length)return {profiles:[],dates:[],activityRows:[]};
  const profiles=await sql.query(`
    SELECT DISTINCT p.stock_code,p.stock_name,p.market,p.industry_code,p.industry,p.auto_business_tags,p.auto_market_topics,p.main_business,p.business_enrich_status,p.business_enrich_version,p.business_enrich_checked_at
    FROM market_company_profile p
    JOIN market_business_xy_member m ON m.stock_code=p.stock_code AND m.market=p.market
    WHERE m.engine_version=$1 AND m.tag_id = ANY($2::text[])
    ORDER BY p.stock_code
  `,[FEATURE_VERSION,ids]);
  if(!profiles.length)return {profiles,dates:[],activityRows:[]};
  const dateRows=await sql.query(`
    WITH activity_dates AS (
      SELECT trade_date FROM market_activity_daily
      WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value>0 AND return_5_pct IS NOT NULL
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    ), inst_dates AS (
      SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃')
      GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
    )
    SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date)
    ORDER BY a.trade_date DESC LIMIT $1
  `,[Math.max(25,Math.min(100,Number(maxDates)||80))]);
  const dates=dateRows.map(r=>isoDate(r.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates:[],activityRows:[]};
  const activityRows=await sql.query(`
    SELECT a.trade_date,a.stock_code,a.stock_name,a.market,a.trade_value,a.change_pct,a.value_ratio_20,a.value_trend_5_15,a.up_value_share_5,a.positive_days_5,a.return_3_pct,a.return_5_pct,a.return_20_pct,
      h.close_price,h.trade_volume,
      i.foreign_net AS institutional_foreign_net,i.trust_net AS institutional_trust_net,i.dealer_net AS institutional_dealer_net,i.total_net AS institutional_total_net,
      c.margin_prev_balance,c.margin_balance,c.short_prev_balance,c.short_balance,c.sbl_prev_balance,c.sbl_balance
    FROM market_activity_daily a
    LEFT JOIN market_daily_history h ON h.trade_date=a.trade_date AND h.stock_code=a.stock_code AND h.market=a.market
    LEFT JOIN institutional_trading_daily i ON i.trade_date=a.trade_date AND i.stock_code=a.stock_code AND i.market=a.market
    LEFT JOIN credit_trading_daily c ON c.trade_date=a.trade_date AND c.stock_code=a.stock_code AND c.market=a.market
    WHERE a.trade_value IS NOT NULL AND a.trade_value>0 AND a.return_5_pct IS NOT NULL
      AND a.trade_date >= $1::date AND a.trade_date <= $2::date
      AND EXISTS (SELECT 1 FROM market_business_xy_member m WHERE m.engine_version=$3 AND m.tag_id = ANY($4::text[]) AND m.stock_code=a.stock_code AND m.market=a.market)
    ORDER BY a.stock_code,a.trade_date
  `,[dates[0],dates.at(-1),FEATURE_VERSION,ids]);
  return {profiles,dates,activityRows};
}

async function buildBenchmarkEvidence(sql,benchmarkIds,persistedById){
  const input=await loadBenchmarkInputs(sql,benchmarkIds,{maxDates:80});
  const out=[];
  for(const id of benchmarkIds){
    const persisted=persistedById.get(id)||null;
    try{
      const detail=computeTagDetail(input.profiles,input.activityRows,id,{maxDates:10}),x=num(detail?.latest?.x),rawX=num(detail?.latest?.rawX),y=num(detail?.latest?.y),px=num(persisted?.x_score),pr=num(persisted?.raw_x_score),py=num(persisted?.y_score);
      const signPass=x!==null&&rawX!==null&&sign(x)===sign(rawX),snapshotMatch=px!==null&&pr!==null&&py!==null&&Math.abs(x-px)<=.06&&Math.abs(rawX-pr)<=.015&&Math.abs(y-py)<=.015;
      out.push({tagId:id,name:detail.name||persisted?.tag_name||id,available:true,x:roundNullable(x,2),rawX:roundNullable(rawX,4),y:roundNullable(y,4),flowValidCount:Number(persisted?.flow_valid_count||0),signLockPass:signPass,yFinite:y!==null,snapshotMatch,
        persisted:{x:roundNullable(px,2),rawX:roundNullable(pr,4),y:roundNullable(py,4)},
        companies:(detail.companies||[]).map(c=>({code:c.code,name:c.name,importance:c.importance,weight:c.weight,stockX:c.stockX,rawFlow20:c.instFlow20Pct,rawFlow5:c.instFlow5Pct,impactX:c.impactX,stockFlowHistoryDays:c.stockFlowHistoryDays})).slice(0,24)});
    }catch(e){
      const x=num(persisted?.x_score),rawX=num(persisted?.raw_x_score),y=num(persisted?.y_score);
      out.push({tagId:id,name:persisted?.tag_name||id,available:Boolean(persisted),x:roundNullable(x,2),rawX:roundNullable(rawX,4),y:roundNullable(y,4),flowValidCount:Number(persisted?.flow_valid_count||0),signLockPass:x!==null&&rawX!==null&&sign(x)===sign(rawX),yFinite:y!==null,snapshotMatch:false,error:String(e?.message||e),companies:[]});
    }
  }
  return out;
}

async function readTopicInstitutionalCoverageAudit(sql,{targetDays=FEATURE_HISTORY_TARGET_DAYS}={}){
  const target=Math.max(25,Math.min(60,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS));
  const rows=await sql.query(`
    WITH ranked_dates AS (
      SELECT market,trade_date,ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) rn
      FROM (SELECT DISTINCT market,trade_date FROM market_daily_history WHERE market IN ('上市','上櫃')) d
    ), cal AS (SELECT market,trade_date FROM ranked_dates WHERE rn <= $1),
    latest AS (SELECT market,MAX(trade_date) AS trade_date FROM cal GROUP BY market),
    members AS (
      SELECT DISTINCT tag_id,stock_code,market FROM market_business_xy_member WHERE engine_version=$2
    ), stock_stats AS (
      SELECT m.tag_id,m.stock_code,m.market,COUNT(c.trade_date)::int AS expected_days,
        COUNT(i.trade_date) FILTER (WHERE i.total_net IS NOT NULL)::int AS inst_days,
        COUNT(i.trade_date) FILTER (WHERE i.total_net IS NOT NULL AND i.trade_date=l.trade_date)::int AS latest_rows
      FROM members m JOIN cal c ON c.market=m.market JOIN latest l ON l.market=m.market
      LEFT JOIN institutional_trading_daily i ON i.market=m.market AND i.stock_code=m.stock_code AND i.trade_date=c.trade_date
      GROUP BY m.tag_id,m.stock_code,m.market
    ), topic AS (
      SELECT tag_id,COUNT(*)::int AS members,
        COUNT(*) FILTER (WHERE inst_days>=LEAST(expected_days,5))::int AS flow_ready_members,
        COUNT(*) FILTER (WHERE inst_days>=LEAST(expected_days,20))::int AS mature_members,
        COUNT(*) FILTER (WHERE latest_rows>0)::int AS latest_covered_members,
        ROUND(AVG(inst_days)::numeric,1) AS avg_inst_days,
        MIN(inst_days)::int AS min_inst_days
      FROM stock_stats GROUP BY tag_id
    )
    SELECT * FROM topic ORDER BY flow_ready_members::numeric/NULLIF(members,0),members DESC,tag_id
  `,[target,FEATURE_VERSION]).catch(()=>[]);
  const missingCompanies=await sql.query(`
    WITH ranked_dates AS (
      SELECT market,trade_date,ROW_NUMBER() OVER (PARTITION BY market ORDER BY trade_date DESC) rn
      FROM (SELECT DISTINCT market,trade_date FROM market_daily_history WHERE market IN ('上市','上櫃')) d
    ), cal AS (SELECT market,trade_date FROM ranked_dates WHERE rn <= $1),
    stocks AS (SELECT DISTINCT stock_code,market FROM market_business_xy_member WHERE engine_version=$2),
    stats AS (
      SELECT s.stock_code,s.market,COUNT(c.trade_date)::int expected_days,COUNT(i.trade_date) FILTER (WHERE i.total_net IS NOT NULL)::int inst_days
      FROM stocks s JOIN cal c ON c.market=s.market
      LEFT JOIN institutional_trading_daily i ON i.market=s.market AND i.stock_code=s.stock_code AND i.trade_date=c.trade_date
      GROUP BY s.stock_code,s.market
    )
    SELECT st.stock_code,p.stock_name,st.market,st.expected_days,st.inst_days,(st.expected_days-st.inst_days)::int AS missing_days
    FROM stats st LEFT JOIN market_company_profile p ON p.stock_code=st.stock_code AND p.market=st.market
    WHERE st.inst_days<LEAST(st.expected_days,20)
    ORDER BY missing_days DESC,st.market,st.stock_code LIMIT 80
  `,[target,FEATURE_VERSION]).catch(()=>[]);
  return {targetDays:target,topics:rows.map(r=>({tagId:r.tag_id,members:Number(r.members||0),flowReadyMembers:Number(r.flow_ready_members||0),matureMembers:Number(r.mature_members||0),latestCoveredMembers:Number(r.latest_covered_members||0),avgInstDays:Number(r.avg_inst_days||0),minInstDays:Number(r.min_inst_days||0)})),missingCompanies:missingCompanies.map(r=>({code:String(r.stock_code||''),name:r.stock_name||'',market:r.market||'',expectedDays:Number(r.expected_days||0),instDays:Number(r.inst_days||0),missingDays:Number(r.missing_days||0)}))};
}

async function readFundflowValidationAudit({sql=getSql(),targetDays=FEATURE_HISTORY_TARGET_DAYS,maxDates=120}={}){
  await ensureBusinessFlowSchema(sql);
  const boundedTarget=Math.max(25,Math.min(60,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS));
  const [state,overview,browser,coverageTwse,coverageTpex,topicCoverage,persisted,compactHistory,storage]=await Promise.all([
    readCurrentPreparedState(sql),
    readPreparedSnapshot(sql,'overview',10),
    readPreparedSnapshot(sql,'browser',10),
    institutionalCoverageByDate('上市',Math.max(60,boundedTarget)).catch(()=>[]),
    institutionalCoverageByDate('上櫃',Math.max(60,boundedTarget)).catch(()=>[]),
    readTopicInstitutionalCoverageAudit(sql,{targetDays:boundedTarget}),
    loadPersistedBusinessGroupsForAudit(sql,{maxDates}),
    readCompactFeatureHistoryStatus(sql,{targetDays:boundedTarget,horizon:5}),
    require('./db').readDatabaseSizeAudit(sql).catch(e=>({error:String(e?.message||e),tables:[]}))
  ]);
  const groups=overview?.groups||[],businessUniverse=Number(overview?.counts?.businessEligible??groups.filter(g=>Number(g.validCount)>=2&&Number.isFinite(Number(g.y))).length),withXY=Number(overview?.counts?.withXY??groups.filter(g=>g.xyEligible!==false&&g.xAvailable!==false&&num(g.x)!==null).length),pendingX=Math.max(0,businessUniverse-withXY);
  const latestDate=isoDate(overview?.asOf)||persisted.dates.at(-1)||null;
  const benchmarkIds=['foplp','mcu','semiconductor_equipment','abf_substrate'];
  const latestRows=latestDate?await sql.query(`SELECT tag_id,tag_name,x_score,y_score,raw_x_score,flow_valid_count,x_available FROM market_business_xy_daily WHERE feature_version=$1 AND trade_date=$2::date AND x_available=true ORDER BY raw_x_score NULLS LAST`,[FEATURE_VERSION,latestDate]).catch(()=>[]):[];
  const lowest=(latestRows||[]).filter(r=>num(r.raw_x_score)!==null).sort((a,b)=>(num(a.raw_x_score)??0)-(num(b.raw_x_score)??0))[0];if(lowest?.tag_id&&!benchmarkIds.includes(lowest.tag_id))benchmarkIds.push(lowest.tag_id);
  const byId=new Map((latestRows||[]).map(r=>[String(r.tag_id),r]));
  const benchmarks=await buildBenchmarkEvidence(sql,benchmarkIds,byId);
  const path=walkForwardPathAudit(persisted.groups,{horizon:5,minHistoryDays:1});
  const recentComplete=(arr)=>arr.slice(0,boundedTarget).filter(x=>x.complete).length;
  const institutional={targetDays:boundedTarget,markets:{'上市':{completeDays:recentComplete(coverageTwse),days:coverageTwse.slice(0,boundedTarget)},'上櫃':{completeDays:recentComplete(coverageTpex),days:coverageTpex.slice(0,boundedTarget)}}};
  const businessUniverseBaseline=161,withXYBaseline=33,taxonomyBaseline=213,taxonomyDefinitions=Number(browser?.counts?.totalDefinitions||0),xyCoveragePct=businessUniverse?round(withXY/businessUniverse*100,1):0;
  const regression={
    snapshotCurrent:Boolean(state.ready&&overview&&browser&&String(overview.engineVersion||'')===ENGINE_VERSION&&String(overview.featureVersion||'')===FEATURE_VERSION&&String(overview.pathModelVersion||'')===PATH_MODEL_VERSION&&String(overview.snapshotSchemaVersion||'')===SNAPSHOT_SCHEMA_VERSION&&String(browser.engineVersion||'')===ENGINE_VERSION&&String(browser.snapshotSchemaVersion||'')===SNAPSHOT_SCHEMA_VERSION),
    businessUniverse,businessUniverseBaseline,businessUniverseDelta:businessUniverse-businessUniverseBaseline,
    withXY,withXYBaseline,withXYDelta:withXY-withXYBaseline,pendingX,xyCoveragePct,
    taxonomyDefinitions,taxonomyBaseline,taxonomyDelta:taxonomyDefinitions-taxonomyBaseline,
    universeFloorPass:businessUniverse>=Math.floor(businessUniverseBaseline*.80),xyCountRegressionPass:withXY>=withXYBaseline,taxonomyPass:taxonomyDefinitions>=taxonomyBaseline,
    benchmarkSignLockPass:benchmarks.filter(x=>x.available).every(x=>x.signLockPass),benchmarkSnapshotMatchPass:benchmarks.filter(x=>x.available&&!x.error).every(x=>x.snapshotMatch),benchmarkCoveragePass:benchmarks.slice(0,4).filter(x=>x.available).length>=3
  };
  const dataGate=recentComplete(coverageTwse)>=boundedTarget&&recentComplete(coverageTpex)>=boundedTarget;
  const releaseGate={snapshotCurrent:regression.snapshotCurrent,universeStable:regression.universeFloorPass&&regression.taxonomyPass,xyCountNoRegression:regression.xyCountRegressionPass,xyCoverage70:xyCoveragePct>=70,benchmarkXY:regression.benchmarkSignLockPass&&regression.benchmarkSnapshotMatchPass&&regression.benchmarkCoveragePass,institutional60D:dataGate,compactHistoryReady:Boolean(compactHistory.historyReady&&compactHistory.horizonAnchorDays>0),pathMeasured:path.predictions>=30,pathTop1AtLeast60:Boolean(path.target60Reached)};
  releaseGate.readyToFinalize=Object.values(releaseGate).every(Boolean);
  return {ok:true,generatedAt:new Date().toISOString(),engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,latestDate,state,regression,institutional,compactHistory,storage,topicCoverage,benchmarks,path,releaseGate};
}

module.exports={FEATURE_VERSION,PATH_MODEL_VERSION,ENGINE_VERSION,DAILY_BUILD_VERSION,SNAPSHOT_SCHEMA_VERSION,DEFAULT_TRAJECTORY_DAYS,ENGINE_HISTORY_DAYS,STOCK_FLOW_POSITION_DAYS,STOCK_FLOW_MOMENTUM_DAYS,STOCK_FLOW_LOOKBACK_DAYS,STOCK_FLOW_MIN_HISTORY_DAYS,STOCK_FLOW_SCALE_FLOOR_PCT,INCREMENTAL_SOURCE_DAYS,FEATURE_HISTORY_TARGET_DAYS,FEATURE_HISTORY_SOURCE_DAYS,TOPIC_SINGLE_STOCK_CAP,ACTIVATION_THRESHOLD_PCT,PATH_INFLUENCE,PATH_MIN_COMPLETENESS_PCT,VOTE_NEUTRAL_SCORE,SELF_RELATIVE_LOOKBACK_DAYS,SELF_RELATIVE_MIN_HISTORY_DAYS,PREPARED_SNAPSHOT_DAYS,PHASES,NON_CORE_EXPOSURE_BUDGET,stockFlowScale,continuousStockFlowScore,capWeightShares,applyCompanyExposureBudget,percentileRanks,percentileRanksNullable,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries,aggregateTagDate,computeBusinessFlow,computeTagDetail,quadrant,buildTransitionCalibration,projectGroup,ensureBusinessFlowSchema,refreshBusinessFlowDaily,backfillCompactFeatureHistory,readCompactFeatureHistoryStatus,getFundflowSnapshot,getFundflowDetail,getFundflowBusinessBrowser,buildBusinessBrowserCatalog,buildPreparedOverview,compactOverviewGroup,loadTagEngineInputs,rebuildPreparedFromStored,readCurrentPreparedState,warmCurrentEngineFromStoredDb,walkForwardPathAudit,loadPersistedBusinessGroupsForAudit,loadBenchmarkInputs,buildBenchmarkEvidence,readTopicInstitutionalCoverageAudit,readFundflowValidationAudit};
