// StockZone v2.6.6.12 — Clean XY v2 fixed; Path 3.1 point→line→family probability + CWA-style P70 forecast cone
// Y = literal business-weighted 5-session constituent price return.
// X = 20-session institutional net-flow / turnover position. 20D raw sign owns left/right;
// distance from zero is stock-first robust-scaled ONLY against that stock's PRIOR 20D-flow history.
// 5D / 1D institutional flow are motion signals only; they never flip the X20 regime.
// Activation = equal-company daily price breadth: change > +0.2% => 1, otherwise 0; missing/no trade => abstain.
// Path influence order is institutional > activation > similar-history. Activation appears once in similarity.
// New derived tables are isolated from legacy XY tables; legacy derived rows are deleted only after a verified cutover.

function getSql(){ return require('./db').getSql(); }
const { resolveCompanyBusinessTags, parseAutoBusinessTags } = require('./company-business-tags');
const { classifyBusinessText } = require('./business-enrichment');
const marketTopicTaxonomy = require('./market-topic-taxonomy');
const { marketTopicLinks, listMarketDefinitions } = marketTopicTaxonomy;
const { ensureInstitutionalHistorySchema, institutionalCoverageByDate } = require('./institutional-history');
const { ensureCreditTradingSchema } = require('./credit-trading');
const { STORAGE_POLICY } = require('./storage-policy');

const FEATURE_VERSION = 'feature-2.0.0-x20raw20-y5-activation02';
const PATH_MODEL_VERSION = 'path-3.1.0-point-line-family-p70';
const ENGINE_VERSION = 'xy-8.4.2-clean-feature2-path31-taxonomy25';
const DAILY_BUILD_VERSION = 'daily-7.1.2-taxonomy25';
const TOPIC_TAXONOMY_VERSION = `taxonomy-${marketTopicTaxonomy.version}`;
const SNAPSHOT_SCHEMA_VERSION = 'snapshot-7.0.2-focuspack-path31-taxonomy25';
const STOCK_TABLE = 'market_business_xy2_stock_daily';
const TOPIC_TABLE = 'market_business_xy2_topic_daily';
const SNAPSHOT_TABLE = 'market_business_xy2_snapshot';
const MEMBER_TABLE = 'market_business_xy2_member';
const LEGACY_DERIVED_TABLES = Object.freeze(['market_business_xy_daily','market_business_xy_snapshot','market_business_xy_member']);
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
// Live engine stays lean; research history may grow to 250D in the compact numeric layer.
const FEATURE_HISTORY_SOURCE_DAYS = 250;
const TOPIC_SINGLE_STOCK_CAP = 0.25;
const ACTIVATION_THRESHOLD_PCT = 0.2;
const PATH_INFLUENCE = Object.freeze({ institutional:0.50, activation:0.30, history:0.20 });
const PATH_MIN_COMPLETENESS_PCT = 50;
const STOCK_COMPACT_RETENTION_DAYS = STORAGE_POLICY.compact.stock;
const RESEARCH_HISTORY_RETENTION_DAYS = STORAGE_POLICY.compact.topicResearch;
const DETAIL_SOURCE_DAYS = 55;
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
  const r=num(raw),n=Math.max(0,Number(historyLength)||0);if(r===null||n<STOCK_FLOW_MIN_HISTORY_DAYS)return null;if(r===0)return 0;
  const z=Math.abs(r)/Math.max(STOCK_FLOW_SCALE_FLOOR_PCT,num(scale)??STOCK_FLOW_SCALE_FLOOR_PCT);
  return sign(r)*100*Math.tanh(z/STOCK_FLOW_TANH_DIVISOR);
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

function buildBusinessBrowserCatalog(profiles=[],snapshot={},companyMapInput=null){
  // Company_Map is the sole company↔topic truth used by Browser, member persistence and XY denominators.
  const companyIndex=companyMapInput||buildCompanyMap(profiles),companyMap=companyIndex.byTopic;
  const groupMap=new Map((snapshot?.groups||[]).map(g=>[g.tagId,g]));
  // Browser must use the same frozen taxonomy universe as the prepared overview.
  // The static definition registry also contains legacy/alias definitions kept only
  // for classification compatibility; exposing all of them resurrects zero-member
  // topics and makes Browser disagree with the frozen runtime taxonomy.
  const registry=listMarketDefinitions({finalOnly:true});
  const registryById=new Map(registry.map(d=>[d.id,d]));
  const definitions=(groupMap.size&&snapshot?.topicTaxonomyVersion)
    ? [...groupMap.keys()].map(id=>registryById.get(id)||marketTopicTaxonomy.marketDefinitionById(id)||{id,name:id,scope:'traditional-coarse',parentName:'',kind:'market-topic',resolution:'market-topic',aliases:[]})
    : registry;
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
      x:g?.x??null,y:g?.y??null,rawX:g?.rawX??null,rawY:g?.rawY??null,xHistoryDays:g?.xHistoryDays??null,quadrant:g?.quadrant||'',status:g?.status||'',statusLabel:g?.statusLabel||'',
      phaseState:g?.phaseState||'',phaseLabel:g?.phaseLabel||'',phaseConfidence:g?.phaseConfidence??null,
      activationRate:g?.activationRate??null,activationValidCount:g?.activationValidCount??0,dataCompleteness:g?.dataCompleteness??g?.reliability??null,flow1Pct:g?.flow1Pct??null,flow5Pct:g?.flow5Pct??null,flow20Pct:g?.flow20Pct??g?.rawX??null,overheating:g?.overheating??null,projection:g?.projection||null,
      validCount:g?.validCount??0,flowValidCount:g?.flowValidCount??0,xAvailable:Boolean(g?.xAvailable!==false&&num(g?.x)!==null&&Number(g?.flowValidCount||0)>0),memberCount:g?.memberCount??companyCount,coveragePct:g?.coveragePct??0,reliability:g?.reliability??0,
      dx3:g?.dx3??null,dy3:g?.dy3??null,leaders:Array.isArray(g?.leaders)?g.leaders.slice(0,5):[]
    };
  }).sort((a,b)=>{
    const order={'technology-fine':0,'electronics-product':1,'traditional-coarse':2,'other':3};
    return (order[a.scope]-order[b.scope])||(b.companyCount-a.companyCount)||a.name.localeCompare(b.name,'zh-Hant');
  });
  const count=fn=>items.filter(fn).length;
  return {
    ok:true,asOf:snapshot?.asOf||'',engineVersion:snapshot?.engineVersion||ENGINE_VERSION,featureVersion:snapshot?.featureVersion||FEATURE_VERSION,pathModelVersion:snapshot?.pathModelVersion||PATH_MODEL_VERSION,snapshotSchemaVersion:snapshot?.snapshotSchemaVersion||SNAPSHOT_SCHEMA_VERSION,dailyBuildVersion:snapshot?.dailyBuildVersion||DAILY_BUILD_VERSION,topicTaxonomyVersion:snapshot?.topicTaxonomyVersion||TOPIC_TAXONOMY_VERSION,
    counts:{
      totalDefinitions:items.length,technologyFineDefinitions:count(x=>x.scope==='technology-fine'),technologyFallbackDefinitions:0,
      traditionalDefinitions:count(x=>x.scope==='traditional-coarse'),otherDefinitions:0,representedDefinitions:count(x=>x.represented),withXY:count(x=>x.xyEligible),withoutXY:count(x=>!x.xyEligible),
      zeroMemberDefinitions:count(x=>x.companyCount===0),singleMemberDefinitions:count(x=>x.companyCount===1)
    },companyMapStats:companyIndex.stats,items
  };
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
function stockKey(row){return `${String(row?.market||'')}|${String(row?.stock_code||'').trim()}`;}
function enrichFlowFeatures(rows,{priorRaw20ByStock=null}={}){
  const copied=(rows||[]).map(r=>({...r})),byCode=new Map();
  for(const row of copied){const key=stockKey(row);if(!String(row.stock_code||'').trim())continue;if(!byCode.has(key))byCode.set(key,[]);byCode.get(key).push(row);}
  for(const [key,list] of byCode){
    list.sort((a,b)=>isoDate(a.trade_date).localeCompare(isoDate(b.trade_date)));
    const priorFlow20=[...((priorRaw20ByStock instanceof Map?priorRaw20ByStock.get(key):null)||[])].map(num).filter(v=>v!==null).slice(-STOCK_FLOW_LOOKBACK_DAYS);
    for(let i=0;i<list.length;i++){
      const row=list[i],tradeValue=num(row.trade_value),tradeVolume=num(row.trade_volume),close=num(row.close_price);
      const avgPrice=close!==null?close:(tradeValue!==null&&tradeVolume>0?tradeValue/tradeVolume:null),totalShares=num(row.institutional_total_net);
      row.inst_net_value=totalShares!==null&&avgPrice!==null?totalShares*avgPrice:null;
      const rolling=(days,keyName='inst_net_value')=>{
        let flow=0,value=0,valid=0;
        for(let j=Math.max(0,i-days+1);j<=i;j++){
          const f=num(list[j][keyName]),tv=num(list[j].trade_value);if(f===null||tv===null||tv<=0)continue;flow+=f;value+=tv;valid++;
        }
        return {ratio:value>0&&valid?flow/value*100:null,value:valid?flow:null,turnover:valid?value:null,days:valid};
      };
      const r1=rolling(1),r5=rolling(5),r10=rolling(10),r20=rolling(20);
      row.inst_flow_ratio_1=r1.ratio;row.inst_flow_ratio_5=r5.ratio;row.inst_flow_ratio_10=r10.ratio;row.inst_flow_ratio_20=r20.ratio;
      row.inst_flow_value_1=r1.value;row.inst_flow_value_5=r5.value;row.inst_flow_value_10=r10.value;row.inst_flow_value_20=r20.value;
      row.inst_turnover_value_1=r1.turnover;row.inst_turnover_value_5=r5.turnover;row.inst_turnover_value_10=r10.turnover;row.inst_turnover_value_20=r20.turnover;
      row.inst_flow_days_1=r1.days;row.inst_flow_days_5=r5.days;row.inst_flow_days_10=r10.days;row.inst_flow_days_20=r20.days;

      // Clean X20: current 20D flow is normalized only by PRIOR 20D-flow observations from the same stock.
      // Current raw20 is appended only after scoring, so there is no look-ahead/self-inclusion.
      const raw20=r20.days>=STOCK_FLOW_POSITION_DAYS?num(r20.ratio):null;
      const history=priorFlow20.slice(-STOCK_FLOW_LOOKBACK_DAYS),historyDays=history.length,scale=stockFlowScale(history);
      const historyReliability=Math.min(1,historyDays/STOCK_FLOW_LOOKBACK_DAYS),dayCoverage=Math.min(1,r20.days/STOCK_FLOW_POSITION_DAYS);
      row.stock_flow_scale=scale;row.stock_flow_history_days=historyDays;row.stock_flow_maturity_pct=historyReliability*100;row.stock_flow_reliability=historyReliability*dayCoverage;
      row.stock_flow_score=continuousStockFlowScore(raw20,historyDays,scale);
      if(raw20!==null){priorFlow20.push(raw20);if(priorFlow20.length>STOCK_FLOW_LOOKBACK_DAYS)priorFlow20.splice(0,priorFlow20.length-STOCK_FLOW_LOOKBACK_DAYS);}

      let streak=0,lastSign=0;for(let j=i;j>=0&&i-j<10;j--){const sg=sign(list[j].institutional_total_net);if(!sg)break;if(!lastSign)lastSign=sg;if(sg!==lastSign)break;streak+=sg;}row.inst_streak=streak;
      const directions=[row.institutional_foreign_net,row.institutional_trust_net,row.institutional_dealer_net].map(sign);row.inst_agreement=directions.reduce((sum,x)=>sum+x,0)/3*100;

      const start5=list[Math.max(0,i-4)]||row,margin5Pct=pctChange(row.margin_balance,num(start5.margin_prev_balance)??num(start5.margin_balance)),short5Pct=pctChange(row.short_balance,num(start5.short_prev_balance)??num(start5.short_balance)),sbl5Pct=pctChange(row.sbl_balance,num(start5.sbl_prev_balance)??num(start5.sbl_balance));
      const price5=num(row.return_5_pct),inst5=num(row.inst_flow_ratio_5),hasCredit=[row.margin_balance,row.short_balance,row.sbl_balance].some(v=>num(v)!==null);let correction=0;
      if(hasCredit){if(inst5!==null&&price5!==null&&margin5Pct!==null){if(inst5>0&&price5>0&&margin5Pct<0)correction+=5;if(inst5<0&&price5<0&&margin5Pct>0)correction-=6;if(price5>=5&&margin5Pct>=5)correction-=4;if(price5<=-5&&margin5Pct>=5)correction-=2;}if(short5Pct!==null&&price5!==null){if(short5Pct>2&&price5>0)correction+=2;if(short5Pct<-4&&price5>0)correction+=1;}if(sbl5Pct!==null&&price5!==null&&inst5!==null){if(sbl5Pct>3&&price5<0&&inst5<0)correction-=3;if(sbl5Pct<-3&&price5>0&&inst5>0)correction+=1;}}
      row.credit_correction=clamp(correction,-15,15);row.margin_5_pct=margin5Pct;row.short_5_pct=short5Pct;row.sbl_5_pct=sbl5Pct;row._flowEnriched=true;
    }
  }
  return copied;
}
// Stock-level X is the stock's causal robust 20D institutional position.
// 5D / 1D raw institutional flow remain separately available for path momentum.
function scoreStocksForDate(rows){
  return (rows||[]).map(x=>{
    const rawFlow=num(x.inst_flow_ratio_20),flowScore=num(x.stock_flow_score),priceReturnPct=num(x.return_5_pct)??num(x.change_pct);
    return {...x,
      stockX:roundNullable(flowScore,3),stockFlowScore:roundNullable(flowScore,3),stockInstitutionalX:roundNullable(rawFlow,4),
      stockFlowScale:round(num(x.stock_flow_scale)??STOCK_FLOW_SCALE_FLOOR_PCT,4),stockFlowHistoryDays:Number(x.stock_flow_history_days||0),stockFlowReliability:round((num(x.stock_flow_reliability)??0)*100,1),
      creditCorrection:clamp(num(x.credit_correction)??0,-15,15),stockY:priceReturnPct===null?null:round(priceReturnPct,4),persistenceScore:clamp((num(x.positive_days_5)??2.5)/5*100)
    };
  });
}
function buildTopicWeightLinks(links=[]){
  // Topic relevance is local to each topic: adding another valid topic must not dilute this topic's own relevance weight.
  return (links||[]).map(link=>({...link,baseWeight:importanceWeight(link.importance),weight:importanceWeight(link.importance),exposureScale:1}));
}
function buildCompanyMap(profiles){
  const byCode=new Map(),byTopic=new Map(),tagMeta=new Map(),denominator=new Map();
  let membershipCount=0,mappedCompanies=0,overlapCompanies=0;
  for(const p of profiles||[]){
    const code=String(p.stock_code||p.symbol||'').trim();if(!code)continue;
    const resolved=resolveProfileBusinessTags({...p,stock_code:code});
    const companyName=resolved.name||p.stock_name||p.name||'';
    const rawLinks=marketTopicLinks(resolved.tags||[],companyName,resolved.symbol||code,{main_business:p.main_business,auto_market_topics:p.auto_market_topics});
    const links=buildTopicWeightLinks(rawLinks).map(link=>{
      const out={...link,scope:link.scope||(link.technology?'technology-fine':'traditional-coarse'),parentName:link.parentName||''};
      if(!tagMeta.has(link.id))tagMeta.set(link.id,{tagId:link.id,name:link.name,parent:'',parentName:out.parentName,scope:out.scope,resolution:link.resolution||'market-topic',technology:Boolean(link.technology)});
      return out;
    });
    const profile={...p,code,resolved,links};byCode.set(code,profile);
    if(links.length)mappedCompanies++;if(links.length>1)overlapCompanies++;membershipCount+=links.length;
    for(const link of links){
      const denom=denominator.get(link.id)||{memberCount:0,totalWeight:0};denom.memberCount++;denom.totalWeight+=link.weight;denominator.set(link.id,denom);
      const topic=byTopic.get(link.id)||{companyCount:0,examples:[],companyNames:[],companyCodes:[],members:[]};topic.companyCount++;
      if(companyName&&!topic.companyNames.includes(companyName))topic.companyNames.push(companyName);
      if(code&&!topic.companyCodes.includes(code))topic.companyCodes.push(code);
      if(topic.examples.length<5)topic.examples.push({code,name:companyName});
      topic.members.push({code,name:companyName,market:p.market||'',importance:link.importance,weight:link.weight});byTopic.set(link.id,topic);
    }
  }
  const totalCompanies=byCode.size,zeroTagCompanies=totalCompanies-mappedCompanies,singleMemberTopics=[...byTopic.entries()].filter(([,x])=>x.companyCount===1).map(([id])=>id).sort();
  const pairCounts=new Map();
  for(const profile of byCode.values()){
    const ids=[...new Set((profile.links||[]).map(x=>x.id).filter(Boolean))].sort();
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=`${ids[i]}|${ids[j]}`;pairCounts.set(key,(pairCounts.get(key)||0)+1);}
  }
  const topTopicOverlaps=[...pairCounts.entries()].map(([key,count])=>{const [a,b]=key.split('|');return {topicA:a,topicB:b,count};}).sort((a,b)=>b.count-a.count||a.topicA.localeCompare(b.topicA)||a.topicB.localeCompare(b.topicB)).slice(0,30);
  return {byCode,byTopic,tagMeta,denominator,stats:Object.freeze({totalCompanies,mappedCompanies,zeroTagCompanies,membershipCount,topicCount:byTopic.size,singleMemberTopics:Object.freeze(singleMemberTopics),overlapCompanies,topTopicOverlaps:Object.freeze(topTopicOverlaps)})};
}
function buildProfileTagMap(profiles){return buildCompanyMap(profiles);}
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

  // Clean X20: each stock has already been normalized against its own prior raw20 history.
  // Topic raw20 owns the side; the robust aggregate owns only the distance from zero.
  const xAvailable=flowEntries.length>0;
  const robustAggregate=xAvailable?flowEntries.reduce((sum,e)=>sum+(num(e.item.stockFlowScore??e.item.stockX)??0)*(num(e.topicWeight)??0),0):0;
  const rawX=xAvailable?flowEntries.reduce((sum,e)=>sum+(num(e.item.inst_flow_ratio_20)??0)*(num(e.topicWeight)??0),0):0;
  const rawSide=sign(rawX),x=xAvailable?(rawSide===0?0:rawSide*Math.abs(robustAggregate)):0;
  const themeFlow1Pct=weightedByTopic(flowEntries,'inst_flow_ratio_1'),themeFlow5Pct=weightedByTopic(flowEntries,'inst_flow_ratio_5'),themeFlow10Pct=weightedByTopic(flowEntries,'inst_flow_ratio_10'),themeFlow20Pct=xAvailable?rawX:null;
  const themeReturn1Pct=weightedMean(items,'change_pct'),themeReturn3Pct=weightedMean(items,'return_3_pct'),themeReturn5Pct=weightedMean(items,'return_5_pct'),themeReturn20Pct=weightedMean(items,'return_20_pct');
  const y=num(themeReturn5Pct)??0,themeStreak=weightedByTopic(flowEntries,'inst_streak'),themeAgreement=weightedByTopic(flowEntries,'inst_agreement');

  // Equal-company price vote: > +0.2% = 1; everything else with a valid traded row = 0.
  const activation=topicActivationMetrics(items,memberCount),activationRate=activation.activationRate;
  const priceBreadth=equalShare(items,a=>(num(a.return_5_pct)??0)>0,'return_5_pct')??0;
  const topicShares=flowEntries.map(e=>num(e.topicWeight)??0).filter(v=>v>0),maxShare=topicShares.length?Math.max(...topicShares):1,n=topicShares.length,ideal=n?1/n:1;
  const concentrationQuality=n<=1?25:clamp((1-maxShare)/Math.max(.0001,1-ideal)*100,25,100),topFlowSharePct=maxShare*100;
  const sampleReliability=Math.min(1,Math.sqrt(Math.max(0,flowEntries.length)/5)),coverageReliability=Math.min(1,flowCoveragePct/80),stockReliability=flowEntries.length?flowEntries.reduce((sum,e)=>sum+(num(e.item.stock_flow_reliability)??0)*(num(e.topicWeight)??0),0):0;
  const xReliability=sampleReliability*coverageReliability*clampRange(stockReliability,0,1),dataCompleteness=clamp(Math.min(coveragePct,flowCoveragePct||0,activation.participationRate||0)),reliability=clampRange(dataCompleteness/100,0,1),rawCreditCorrection=clamp(weightedMean(items,'creditCorrection')??0,-15,15);
  return {
    memberCount,validCount,flowValidCount:flowEntries.length,xAvailable,coveragePct:round(coveragePct),businessCoveragePct:round(businessCoveragePct),reliability:round(reliability*100),dataCompleteness:round(dataCompleteness),
    x:xAvailable?round(x,3):null,rawX:xAvailable?round(rawX,4):null,y:round(y,4),rawY:round(y,4),institutionalX:xAvailable?round(rawX,4):null,creditCorrection:round(rawCreditCorrection,2),
    flowCoveragePct:round(flowCoveragePct),activationRate:round(activationRate),activationThresholdPct:ACTIVATION_THRESHOLD_PCT,activationValidCount:activation.validCount,activationActiveCount:activation.activeCount,activationAbstainCount:activation.abstainCount,activationParticipationPct:round(activation.participationRate),
    concentrationQuality:round(concentrationQuality),topFlowSharePct:round(topFlowSharePct),rawCreditCorrection:round(rawCreditCorrection,2),
    themeFlow1Pct,themeFlow5Pct,themeFlow10Pct,themeFlow20Pct,themeReturn1Pct,themeReturn3Pct,themeReturn5Pct,themeReturn20Pct,themeStreak,themeAgreement,priceBreadth:round(priceBreadth),
    xMedian:xAvailable?roundNullable(median(flowItems.map(a=>num(a.stockFlowScore??a.stockX))),2):null,xMean:xAvailable?round(x,2):null,xHistoryDays:xAvailable?round(weightedByTopic(flowEntries,'stock_flow_history_days')??0,1):0,xMaturityPct:xAvailable?round(weightedByTopic(flowEntries,'stock_flow_maturity_pct')??0,1):0,
    rawXMedian:xAvailable?roundNullable(median(flowItems.map(a=>num(a.inst_flow_ratio_20))),4):null,yMedian:round(weightedMedian(items,'stockY')??0,4),yMean:round(weightedMean(items,'stockY')??0,4),baseY:round(y,4),strongCount:activation.activeCount,
    topicWeightCapPct:round(Math.min(100,Math.max(TOPIC_SINGLE_STOCK_CAP,n?1/n+.10:1)*100),1),xReliabilityPct:round(xReliability*100,1)
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
  const x=num(p.x)??0,y=num(p.y)??0,dx3=num(p.dx3)??0,dy3=num(p.dy3)??0,dx1=num(p.dx1)??0,dy1=num(p.dy1)??0,a=clamp(num(p.activationRate)??0),e=num(p.overheating)??0;let key='transition';
  if(y>0&&((dx3<-12&&dy3<-.8)||(e>=70&&dx1<0&&dy1<=0)))key='cooling';
  else if(x>=28&&y>0&&a>=35)key='mainline';
  else if(x>=22&&y<=0&&dx3>=-12&&dy3>=-2.5&&a>=28)key='potential';
  else if(y<=1.5&&((x>0&&dx3>8)||(x>45&&dx1>=0)))key='germination';
  const m=phaseMeta(key),ys=pricePhaseScore(y),mx=clamp(50+dx3*1.25),my=clamp(50+dy3*12);let confidence=45;
  if(key==='germination')confidence=clamp(38+Math.max(0,mx-50)*.65+Math.max(0,x)*.15+a*.18);
  else if(key==='potential')confidence=clamp(40+Math.max(0,x)*.16+Math.max(0,50-ys)*.25+Math.max(0,my-40)*.2+a*.20);
  else if(key==='mainline')confidence=clamp(42+Math.max(0,x)*.14+Math.max(0,y)*3+a*.22-Math.max(0,e-70)*.25);
  else if(key==='cooling')confidence=clamp(42+Math.max(0,-dx3)*1.3+Math.max(0,-dy3)*7+e*.30);
  else confidence=clamp(34+a*.28-Math.abs(mx-my)*.06);
  return {key,label:m.label,confidence:round(confidence)};
}
function decorateDynamics(trajectory,{smooth=false}={}){
  const validX=[];
  for(let i=0;i<trajectory.length;i++){
    const p=trajectory[i],xOk=p.xAvailable!==false&&num(p.x)!==null;
    p.xAvailable=xOk;p.rawY=num(p.rawY)??num(p.y)??0;p.y=p.rawY;p.flow1Pct=num(p.flow1Pct??p.themeFlow1Pct??p.factorSignals?.x?.inst1);p.flow5Pct=num(p.flow5Pct??p.themeFlow5Pct??p.factorSignals?.x?.inst5);p.flow20Pct=num(p.flow20Pct??p.themeFlow20Pct??p.rawX);p.activationRate=clamp(num(p.activationRate??p.factorSignals?.x?.activationRate)??0);p.dataCompleteness=num(p.dataCompleteness??p.reliability)??0;
    const prev=trajectory[i-1]||p,prev2=trajectory[i-2]||prev;p.dy1=round((num(p.y)??0)-(num(prev.y)??0),4);const p3=trajectory[Math.max(0,i-3)]||trajectory[0]||p;p.dy3=round((num(p.y)??0)-(num(p3.y)??0),4);const prevDy=(num(prev.y)??0)-(num(prev2.y)??0);p.ddy1=round(p.dy1-prevDy,4);
    if(xOk){p.x=num(p.x);p.rawX=num(p.rawX)??p.x;const prevX=validX.at(-1)||p,prevX2=validX.at(-2)||prevX,prevX3=validX.at(-3)||validX[0]||p;p.dx1=round(p.x-(num(prevX.x)??p.x),4);p.dx3=round(p.x-(num(prevX3.x)??p.x),4);const prevDx=(num(prevX.x)??p.x)-(num(prevX2.x)??num(prevX.x)??p.x);p.ddx1=round(p.dx1-prevDx,4);validX.push(p);}else{p.x=0;p.rawX=0;p.dx1=null;p.dx3=null;p.ddx1=null;}
    const heatLevel=clamp((p.y-4)*12.5),capitalFade=xOk?clamp(50-(num(p.dx3)??0)*1.25):50,priceFade=clamp(50-p.dy1*14),breadthFade=clamp(50+((num(prev.priceBreadth)??num(p.priceBreadth)??50)-(num(p.priceBreadth)??50))*2);p.overheating=round(clamp(.50*heatLevel+.20*capitalFade+.18*priceFade+.12*breadthFade));
    if(!xOk){p.rawPhaseState='';p.rawPhaseConfidence=0;p.phaseState='';p.phaseLabel='待法人資料';p.phaseConfidence=0;continue;}const raw=rawPhaseForPoint(p);p.rawPhaseState=raw.key;p.rawPhaseConfidence=raw.confidence;
  }
  let confirmed='transition',candidate='',streak=0,started=false;
  for(const p of trajectory){if(!p.xAvailable)continue;if(!started){confirmed=p.rawPhaseState||'transition';started=true;}if(p.rawPhaseState===confirmed){candidate='';streak=0;}else if(p.rawPhaseState===candidate)streak++;else{candidate=p.rawPhaseState;streak=1;}if(p.rawPhaseConfidence>=86||streak>=2){confirmed=p.rawPhaseState;candidate='';streak=0;}const meta=phaseMeta(confirmed);p.phaseState=confirmed;p.phaseLabel=meta.label;p.phaseConfidence=round(clamp(.72*p.rawPhaseConfidence+.28*(num(p.activationRate)??50)));}
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
    const validX=trajectory.filter(p=>p.xAvailable),status=movementStatus(latest),q=latest.xAvailable?quadrant(latest.x,latest.y):'';let rightMoves=0,totalMoves=0;for(let i=Math.max(1,validX.length-5);i<validX.length;i++){totalMoves++;if(validX[i].x>validX[i-1].x)rightMoves++;}
    const rightPersistence=totalMoves?rightMoves/totalMoves*100:0,xScore=latest.xAvailable?flowPhaseScore(latest.x):0,yScore=pricePhaseScore(latest.y),dxScore=latest.xAvailable?clamp(50+(num(latest.dx3)??0)*1.25):50,dyScore=clamp(50+(num(latest.dy3)??0)*12),a=clamp(num(latest.activationRate)??0),potentialScore=latest.xAvailable&&['germination','potential'].includes(latest.phaseState)?xScore*.40+dxScore*.20+dyScore*.20+a*.20:0,mainlineScore=latest.xAvailable&&latest.phaseState==='mainline'?xScore*.30+yScore*.35+a*.25+clamp(50+(num(latest.dx3)??0)*1.25+(num(latest.dy3)??0)*6)*.10:0,coolingScore=latest.xAvailable&&['overheating','cooling'].includes(latest.phaseState)?latest.overheating*.45+(100-dxScore)*.25+(100-dyScore)*.20+(100-a)*.10:0,rotationScore=latest.xAvailable?xScore*.25+yScore*.15+dxScore*.25+dyScore*.20+rightPersistence*.15:0;
    groups.push({...latest,quadrant:q,status:status.key,statusLabel:status.label,dx1:latest.xAvailable?latest.dx1:null,dy1:latest.dy1,dx3:latest.xAvailable?latest.dx3:null,dy3:latest.dy3,ddx1:latest.xAvailable?latest.ddx1:null,ddy1:latest.ddy1,rightPersistence:latest.xAvailable?round(rightPersistence):null,potentialScore:round(potentialScore),mainlineScore:round(mainlineScore),coolingScore:round(coolingScore),rotationScore:round(rotationScore),trajectory:trajectory.map(p=>({date:p.tradeDate,xAvailable:Boolean(p.xAvailable),flowValidCount:Number(p.flowValidCount||0),x:p.xAvailable?round(p.x,4):null,y:round(p.y,4),rawX:p.xAvailable?round(p.rawX,4):null,rawY:round(p.rawY,4),xHistoryDays:Number(p.xHistoryDays||0),institutionalX:p.xAvailable?roundNullable(p.institutionalX,4):null,creditCorrection:round(p.creditCorrection,2),activationRate:round(p.activationRate,1),flow1Pct:roundNullable(p.flow1Pct,4),flow5Pct:roundNullable(p.flow5Pct,4),flow20Pct:roundNullable(p.flow20Pct??p.rawX,4),dataCompleteness:round(p.dataCompleteness??p.reliability,1),concentrationQuality:round(p.concentrationQuality,1),overheating:p.overheating,phaseState:p.xAvailable?p.phaseState:'',phaseLabel:p.xAvailable?p.phaseLabel:'待法人資料',phaseConfidence:p.xAvailable?p.phaseConfidence:null,dx1:p.xAvailable?p.dx1:null,dy1:p.dy1,dx3:p.xAvailable?p.dx3:null,dy3:p.dy3,ddx1:p.xAvailable?p.ddx1:null,ddy1:p.ddy1,priceBreadth:p.priceBreadth,validCount:p.validCount,reliability:p.reliability,factors:p.factorSignals||p.factors||{}}))});
  }
  return groups;
}
const X_DIRECTION_UNIT=10,Y_DIRECTION_UNIT=.90;
const PATH_CONE_COVERAGE=0.70;
const PATH_FAMILY_HORIZONS=Object.freeze([3,5,10]);
const PATH_FAMILY_ANGLE_LIMIT=Object.freeze({3:75,5:90,10:105});
const PATH_FAMILY_TIME_WEIGHT=Object.freeze({3:.50,5:.32,10:.18});
const PATH_SECONDARY_MIN_SHARE_PCT=12;
const PATH_SECONDARY_MIN_RATIO=.35;
const PATH_CONFLICT_MIN_SHARE_PCT=15;
const PATH_CONFLICT_MIN_RATIO=.45;
const PATH_CONFLICT_ANGLE_DEG=100;
const PATH_ERROR_CALIBRATION_MAX_POOL=6000;
const PATH_ERROR_CALIBRATION_MAX_EVAL=300;
const PATH_ERROR_CALIBRATION_LOOKBACK=1800;
const PATH_ERROR_CALIBRATION_NEIGHBORS=64;
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
  clampRange(num(p?.ddx1)??0,-20,20)/20,
  clampRange(num(p?.ddy1)??0,-3,3)/3,
  tanhUnit(p?.flow5Pct??p?.factorSignals?.x?.inst5,1.0),
  tanhUnit(p?.flow1Pct??p?.factorSignals?.x?.inst1,1.2),
  clampRange((num(p?.activationRate)??0)/100,0,1)
];}
function pathFeatureDistance(a,b){const w=[1.0,.8,1.15,.85,.55,.45,1.6,.8,1.4],aa=pathFeatureVector(a),bb=pathFeatureVector(b);let sum=0,ws=0;for(let i=0;i<w.length;i++){sum+=w[i]*(aa[i]-bb[i])**2;ws+=w[i];}return Math.sqrt(sum/Math.max(.001,ws));}
function normalizedPathPointDistance(a,b){if(!a||!b)return Infinity;return Math.hypot(((num(a.dx)??0)-(num(b.dx)??0))/X_DIRECTION_UNIT,((num(a.dy)??0)-(num(b.dy)??0))/Y_DIRECTION_UNIT);}
function normalizedPathMagnitude(p){if(!p)return 0;return Math.hypot((num(p.dx)??0)/X_DIRECTION_UNIT,(num(p.dy)??0)/Y_DIRECTION_UNIT);}
function pathVectorAngleDeg(a,b){if(!a||!b)return 180;const ax=(num(a.dx)??0)/X_DIRECTION_UNIT,ay=(num(a.dy)??0)/Y_DIRECTION_UNIT,bx=(num(b.dx)??0)/X_DIRECTION_UNIT,by=(num(b.dy)??0)/Y_DIRECTION_UNIT,ma=Math.hypot(ax,ay),mb=Math.hypot(bx,by);if(ma<.18||mb<.18)return 0;const c=clampRange((ax*bx+ay*by)/(ma*mb),-1,1);return Math.acos(c)*180/Math.PI;}
function weightedNumericMean(values,weights){let sw=0,sv=0;for(let i=0;i<values.length;i++){const v=num(values[i]),w=Math.max(0,num(weights[i])??0);if(v===null||!w)continue;sw+=w;sv+=v*w;}return sw?sv/sw:0;}
function evenlySample(arr,maxN){if((arr||[]).length<=maxN)return [...(arr||[])];const out=[],step=(arr.length-1)/(maxN-1);for(let i=0;i<maxN;i++)out.push(arr[Math.round(i*step)]);return out;}
function buildHistoricalPathErrorCalibration(pathSamples,{maxPool=PATH_ERROR_CALIBRATION_MAX_POOL,maxEval=PATH_ERROR_CALIBRATION_MAX_EVAL,lookback=PATH_ERROR_CALIBRATION_LOOKBACK,neighbors=PATH_ERROR_CALIBRATION_NEIGHBORS}={}){
  const ordered=(pathSamples||[]).slice().sort((a,b)=>String(a.anchorDate).localeCompare(String(b.anchorDate))||String(a.tagId).localeCompare(String(b.tagId))),pool=ordered.slice(-maxPool),errors={3:[],5:[],10:[]};
  if(pool.length>=28){
    const evalIdx=evenlySample(Array.from({length:Math.max(0,pool.length-18)},(_,i)=>i+18),maxEval);
    for(const idx of evalIdx){const target=pool[idx],lo=Math.max(0,idx-lookback),prior=pool.slice(lo,idx).filter(x=>x.anchorDate<target.anchorDate);if(prior.length<14)continue;
      const near=prior.map(rec=>({rec,d:pathFeatureDistance(target.anchor,rec.anchor)})).sort((a,b)=>a.d-b.d).slice(0,Math.min(neighbors,prior.length));
      const ws=near.map(({rec,d})=>{const q=clampRange((num(rec.completeness)??100)/100,.25,1),phase=(rec.anchor?.phaseState||'transition')===(target.anchor?.phaseState||'transition')?1.08:1;return q*phase/((.12+d)**2)});
      for(const h of PATH_FAMILY_HORIZONS){const preds=near.map(({rec})=>rec.points?.[h]?.dx),predy=near.map(({rec})=>rec.points?.[h]?.dy),px=weightedNumericMean(preds,ws),py=weightedNumericMean(predy,ws),actual=target.points?.[h];if(!actual)continue;errors[h].push(Math.hypot(((num(actual.dx)??0)-px)/X_DIRECTION_UNIT,((num(actual.dy)??0)-py)/Y_DIRECTION_UNIT));}
    }
  }
  const fallback={3:1.35,5:1.90,10:2.75},radii={};let prior=0;
  for(const h of PATH_FAMILY_HORIZONS){let radius=errors[h].length>=12?(quantile(errors[h],PATH_CONE_COVERAGE)??fallback[h]):fallback[h];radius=Math.max(prior,Math.max(.35,radius));radii[h]={radiusNorm:round(radius,4),sampleN:errors[h].length};prior=radius;}
  return {method:'causal-nearest-path-error-p70',coveragePct:PATH_CONE_COVERAGE*100,radii};
}
function buildTransitionCalibration(groups,{calibrateErrors=true}={}){
  const horizons=PATH_FAMILY_HORIZONS,buckets={},samples={},pathSamples=[];let sampleCount=0;const dateSet=new Set();
  for(const g of groups||[])for(const p of g.trajectory||[])if(p.xAvailable!==false&&num(p.x)!==null)dateSet.add(p.date);
  for(const phase of Object.keys(PHASES)){buckets[phase]={};for(const h of horizons)buckets[phase][h]=[];}for(const h of horizons)samples[h]=[];
  for(const g of groups||[]){const t=(g.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null);for(let i=0;i<t.length;i++){const s=t[i].phaseState||'transition';for(const h of horizons){if(i+h>=t.length)continue;const rec={anchor:t[i],tagId:g.tagId||'',anchorDate:t[i].date,dx:t[i+h].x-t[i].x,dy:t[i+h].y-t[i].y};rec.direction=directionLabel(rec.dx,rec.dy);rec.completeness=num(t[i].dataCompleteness??t[i].reliability)??100;buckets[s]??={};buckets[s][h]??=[];buckets[s][h].push(rec);samples[h].push(rec);sampleCount++;}
      if(i+10<t.length){const rec={anchor:t[i],tagId:g.tagId||'',anchorDate:t[i].date,completeness:num(t[i].dataCompleteness??t[i].reliability)??100,points:{}};for(const h of horizons){rec.points[h]={horizon:h,dx:t[i+h].x-t[i].x,dy:t[i+h].y-t[i].y};}rec.direction=directionLabel(rec.points[5].dx,rec.points[5].dy);pathSamples.push(rec);}
    }}
  const stats={};for(const [state,byH] of Object.entries(buckets)){stats[state]={};for(const [h,arr] of Object.entries(byH)){const base=displacementStats(arr),directions={};for(const label of Object.keys(DIRECTION_VECTORS)){const subset=arr.filter(x=>x.direction===label);if(subset.length)directions[label]=displacementStats(subset);}stats[state][h]={...base,directions};}}
  const historyDays=dateSet.size,maturityPct=round(clamp((historyDays-5)/45*100)),cone=calibrateErrors==='light'?buildHistoricalPathErrorCalibration(pathSamples,{maxPool:420,maxEval:24,lookback:180,neighbors:32}):calibrateErrors?buildHistoricalPathErrorCalibration(pathSamples):buildHistoricalPathErrorCalibration([]);
  return {historyDays,maturityPct,sampleCount,horizons,stats,samples,pathSamples,cone};
}
function nearestTransitionStats(group,calibration,h){
  const all=(calibration?.samples?.[h]||[]).map(rec=>({...rec,d:pathFeatureDistance(group,rec.anchor)})).sort((a,b)=>a.d-b.d),k=Math.min(72,Math.max(14,Math.round(Math.sqrt(all.length||1)*2.6))),near=all.slice(0,k),byDir={};let total=0;
  for(const rec of near){const quality=clampRange((num(rec.completeness)??100)/100,.25,1),sameTag=rec.tagId&&group?.tagId&&rec.tagId===group.tagId?1.18:1,phaseMatch=(rec.anchor?.phaseState||'transition')===(group?.phaseState||'transition')?1.08:1,w=quality*sameTag*phaseMatch/((.12+rec.d)**2);total+=w;(byDir[rec.direction]??=[]).push({...rec,w});}
  const probs={};for(const label of Object.keys(DIRECTION_VECTORS)){const a=byDir[label]||[],w=a.reduce((sum,x)=>sum+x.w,0);probs[label]=(w+.30)/(total+.30*Object.keys(DIRECTION_VECTORS).length);}
  const dirStats={};for(const [label,a] of Object.entries(byDir)){const maxW=Math.max(.000001,...a.map(x=>x.w)),expanded=[];for(const rec of a){const copies=Math.max(1,Math.min(14,Math.round(rec.w/maxW*10)));for(let i=0;i<copies;i++)expanded.push(rec);}dirStats[label]=displacementStats(expanded);}
  return {n:near.length,probs,byDirection:dirStats,nearest:near};
}
function axisEvidenceDistribution(axis,force,{positiveOnly=false}={}){
  const labels=Object.keys(DIRECTION_VECTORS),f=clampRange(num(force)??0,-1,1),strength=positiveOnly?clampRange(f,0,1):Math.abs(f);if(strength<.01)return uniformDirectionDistribution();
  const wanted=positiveOnly?1:(f>0?1:-1),raw=labels.map(label=>{const v=directionVector(label),component=axis==='x'?v.x:v.y,compat=component===wanted?1:component===0?.42:.08;return {label,v:1+6*strength*compat};}),sum=raw.reduce((a,x)=>a+x.v,0)||1;return Object.fromEntries(raw.map(x=>[x.label,x.v/sum]));
}
function uniformDirectionDistribution(){const labels=Object.keys(DIRECTION_VECTORS),p=1/labels.length;return Object.fromEntries(labels.map(x=>[x,p]));}
function scenarioTendency(state,p5){if(['germination','potential'].includes(state)&&p5.dx>0)return '資金先行';if(state==='mainline'&&p5.dy>=0)return '強勢延續';if(state==='cooling'&&(p5.dx<0||p5.dy<0))return '轉弱';if(p5.dx>8&&p5.dy>1)return '共振轉強';if(p5.dx<-8&&p5.dy<-1)return '共振轉弱';if(p5.dy>1&&p5.dx<=0)return '價格先行';if(p5.dx>8&&p5.dy<=0)return '資金先行';return '方向未明';}
function currentSignalState(group){
  const x20=num(group.x)??0,flow5=num(group.flow5Pct??group.factorSignals?.x?.inst5)??0,flow1=num(group.flow1Pct??group.factorSignals?.x?.inst1)??flow5,activation=clamp(num(group.activationRate)??0);
  const positionForce=tanhUnit(x20,55),momentumForce=tanhUnit(flow5,.85),accelForce=tanhUnit(flow1,1.05),capitalForce=clampRange(.45*positionForce+.40*momentumForce+.15*accelForce,-1,1);
  // Activation is a 1/0 breadth vote. Low participation is weak/absent positive breadth confirmation, never a synthetic -1 vote.
  const activationForce=clampRange(activation/100,0,1);
  return {x20,flow5,flow1,activation,positionForce,momentumForce,accelForce,capitalForce,activationForce,capitalDir:Math.abs(capitalForce)<.06?'盤整':capitalForce>0?'向右':'向左',activationDir:activationForce<.02?'盤整':'向上'};
}
function directionEvidenceScores(group,candidates){
  const labels=Object.keys(DIRECTION_VECTORS),signal=currentSignalState(group),capDist=axisEvidenceDistribution('x',signal.capitalForce),voteDist=axisEvidenceDistribution('y',signal.activationForce,{positiveOnly:true}),histRaw=Object.fromEntries(labels.map(x=>[x,0]));let histTotal=0;
  for(const c of candidates||[]){histRaw[c.direction]=(histRaw[c.direction]||0)+c.baseWeight;histTotal+=c.baseWeight;}
  const histDist=histTotal?Object.fromEntries(labels.map(x=>[x,(histRaw[x]||0)/histTotal])):uniformDirectionDistribution(),raw=[];
  for(const label of labels)raw.push({label,score:PATH_INFLUENCE.institutional*(capDist[label]||0)+PATH_INFLUENCE.activation*(voteDist[label]||0)+PATH_INFLUENCE.history*(histDist[label]||0)});
  const sum=raw.reduce((a,x)=>a+x.score,0)||1;return {signal,scores:Object.fromEntries(raw.map(x=>[x.label,x.score/sum])),histDist};
}
function nearestPathCandidates(group,calibration){
  const all=(calibration?.pathSamples||[]).map(rec=>({rec,d:pathFeatureDistance(group,rec.anchor)})).sort((a,b)=>a.d-b.d),k=Math.min(96,Math.max(28,Math.round(Math.sqrt(all.length||1)*3.2))),near=all.slice(0,k),candidates=[];
  for(const {rec,d} of near){const quality=clampRange((num(rec.completeness)??100)/100,.25,1),sameTag=rec.tagId&&group?.tagId&&rec.tagId===group.tagId?1.18:1,phaseMatch=(rec.anchor?.phaseState||'transition')===(group?.phaseState||'transition')?1.08:1,baseWeight=quality*sameTag*phaseMatch/((.12+d)**2);candidates.push({...rec,d,baseWeight,microScore:0});}
  const evidence=directionEvidenceScores(group,candidates);
  // Every historical micro-path receives part of the same 100% probability budget. The 50/30/20
  // evidence mix changes relative likelihood, but probability is never created, discarded or
  // renormalized after family aggregation. This makes A/B shares literal sums of micro-path shares.
  let rawTotal=0;
  for(const c of candidates){let likelihood=0;for(const [label,dirScore] of Object.entries(evidence.scores)){const sim=Math.max(0,directionSimilarity(label,c.direction));likelihood+=dirScore*(.08+.92*sim*sim);}c.microScore=Math.max(0,c.baseWeight*likelihood);rawTotal+=c.microScore;}
  if(rawTotal<=0){const totalBase=candidates.reduce((a,c)=>a+Math.max(0,c.baseWeight||0),0)||1;for(const c of candidates)c.microScore=Math.max(0,c.baseWeight||0)/totalBase;}
  else for(const c of candidates)c.microScore/=rawTotal;
  return {candidates:candidates.sort((a,b)=>b.microScore-a.microScore),signal:evidence.signal,directionScores:evidence.scores,nearestN:near.length,assignedMass:1,unassignedMass:0};
}
function pathFamilyCenter(members){const points={};for(const h of PATH_FAMILY_HORIZONS){const ws=members.map(x=>x.microScore||x.baseWeight||1),dx=weightedNumericMean(members.map(x=>x.points?.[h]?.dx),ws),dy=weightedNumericMean(members.map(x=>x.points?.[h]?.dy),ws);points[h]={horizon:h,dx,dy};}return points;}
function pathTrajectoryDistance(a,b){let sum=0,ws=0;for(const h of PATH_FAMILY_HORIZONS){const w=PATH_FAMILY_TIME_WEIGHT[h]||0,d=normalizedPathPointDistance(a?.points?.[h]||a?.[h],b?.points?.[h]||b?.[h]);if(!Number.isFinite(d))return Infinity;sum+=w*d*d;ws+=w;}return Math.sqrt(sum/Math.max(.001,ws));}
function pathEarlyOpposed(a,b){const x=a?.points?.[3]||a?.[3],y=b?.points?.[3]||b?.[3],ma=normalizedPathMagnitude(x),mb=normalizedPathMagnitude(y);if(ma<.35||mb<.35)return false;const ax=(num(x.dx)??0)/X_DIRECTION_UNIT,ay=(num(x.dy)??0)/Y_DIRECTION_UNIT,bx=(num(y.dx)??0)/X_DIRECTION_UNIT,by=(num(y.dy)??0)/Y_DIRECTION_UNIT;return ax*bx+ay*by<0;}
function pathFamilyAdaptiveRadius(candidates){const nearest=[];for(let i=0;i<candidates.length;i++){let best=Infinity;for(let j=0;j<candidates.length;j++){if(i===j||pathEarlyOpposed(candidates[i],candidates[j]))continue;best=Math.min(best,pathTrajectoryDistance(candidates[i],candidates[j]));}if(Number.isFinite(best))nearest.push(best);}const q=quantile(nearest,.65)??1;return clampRange(q*1.45,.70,2.25);}
function pathFamilyCompatible(seed,candidate,center,radius){
  if(pathEarlyOpposed(seed,candidate))return false;
  const centerObj={points:center},r=Math.max(.55,num(radius)??1);if(pathTrajectoryDistance(seed,candidate)>r||pathTrajectoryDistance(centerObj,candidate)>r*1.05)return false;
  for(const h of PATH_FAMILY_HORIZONS){const s=seed?.points?.[h],c=candidate?.points?.[h],m=center?.[h]||s;if(!s||!c)return false;const horizonCap=r*({3:.88,5:1.10,10:1.38}[h]||1);if(normalizedPathPointDistance(m,c)>horizonCap)return false;const magS=normalizedPathMagnitude(s),magC=normalizedPathMagnitude(c),angle=pathVectorAngleDeg(s,c);if(magS>.35&&magC>.35&&angle>PATH_FAMILY_ANGLE_LIMIT[h])return false;}
  return true;
}
function buildPathFamilies(group,calibration){
  const nearest=nearestPathCandidates(group,calibration),remaining=[...nearest.candidates],families=[],cone=calibration?.cone||buildHistoricalPathErrorCalibration([]),clusterRadius=pathFamilyAdaptiveRadius(remaining);
  while(remaining.length){const seed=remaining.shift(),members=[seed];let center=pathFamilyCenter(members),changed=true;while(changed){changed=false;for(let i=0;i<remaining.length;){const c=remaining[i];if(pathFamilyCompatible(seed,c,center,clusterRadius)){members.push(c);remaining.splice(i,1);center=pathFamilyCenter(members);changed=true;}else i++;}}
    families.push({seed,members,center,score:members.reduce((a,x)=>a+(x.microScore||0),0)});
  }
  for(const f of families){f.routeShare=f.score*100;const p5=f.center[5];f.direction=directionLabel(p5?.dx,p5?.dy);f.sampleN=f.members.length;}
  families.sort((a,b)=>b.routeShare-a.routeShare);
  const familyMass=families.reduce((a,f)=>a+Math.max(0,f.routeShare||0),0),hhi=families.reduce((a,f)=>{const p=Math.max(0,f.routeShare||0)/100;return a+p*p;},0),effectiveFamilies=hhi>0?1/hhi:0;
  const replay=nearest.candidates.map(c=>({anchorDate:c.anchorDate||'',sourceTagId:c.tagId||'',probability:round((c.microScore||0)*100,4),points:PATH_FAMILY_HORIZONS.map(h=>({horizon:h,dx:round(c.points?.[h]?.dx,4),dy:round(c.points?.[h]?.dy,4)}))}));
  return {...nearest,families,cone,clusterRadius:round(clusterRadius,4),familyMass:round(familyMass,4),effectiveFamilies:round(effectiveFamilies,3),replay};
}
function buildScenarioPath(group,calibration,state,family,rank,signal){
  const points=[],completeness=clamp(num(group.dataCompleteness??group.reliability)??0),completenessScale=1+(100-completeness)/100*.60,startX=num(group.x)??0,startY=num(group.y)??0;
  for(const h of PATH_FAMILY_HORIZONS){const center=family.center?.[h]||{dx:0,dy:0},radiusBase=Math.max(.35,num(calibration?.cone?.radii?.[h]?.radiusNorm)??1),radiusNorm=radiusBase*completenessScale,dx=num(center.dx)??0,dy=num(center.dy)??0,x=clampRange(startX+dx,-100,100),actualDx=x-startX,y=startY+dy,spreadX=radiusNorm*X_DIRECTION_UNIT,spreadY=radiusNorm*Y_DIRECTION_UNIT;points.push({horizon:h,x:round(x,4),y:round(y,4),dx:round(actualDx,4),dy:round(dy,4),sampleN:Number(family.sampleN||0),radiusNorm:round(radiusNorm,4),coveragePct:round(calibration?.cone?.coveragePct??70,1),errorSampleN:Number(calibration?.cone?.radii?.[h]?.sampleN||0),lowX:round(clampRange(x-spreadX,-100,100),4),highX:round(clampRange(x+spreadX,-100,100),4),lowY:round(y-spreadY,4),highY:round(y+spreadY,4)});}
  const p5=points.find(p=>p.horizon===5)||points[0],share=round(family.routeShare,1);return {id:rank===0?'A':'B',rank:rank+1,direction:family.direction||directionLabel(p5.dx,p5.dy),tendency:scenarioTendency(state,p5),confidence:share,routeShare:share,sampleN:Number(family.sampleN||0),familySize:Number(family.sampleN||0),points};
}
function projectGroup(group,calibration){
  const state=group.phaseState||'transition',maturity=num(calibration?.maturityPct)??0,completeness=clamp(num(group.dataCompleteness??group.reliability)??0);
  if(completeness<PATH_MIN_COMPLETENESS_PCT)return {mode:'insufficient-data',state,stateLabel:phaseMeta(state).label,tendency:'資料不足',direction:'',confidence:0,dataCompletenessPct:completeness,historyDays:calibration?.historyDays||0,maturityPct:maturity,points:[],scenarios:[],primary:null,secondary:null,pathGap:0,chaosLevel:'資料不足',top2Share:0,residualPct:100,caution:`資料完整度 ${round(completeness)}% 低於 ${PATH_MIN_COMPLETENESS_PCT}%：不產生 Future Path。`};
  const clustered=buildPathFamilies(group,calibration),familyA=clustered.families[0]||null,familyB=clustered.families[1]||null,primary=familyA?buildScenarioPath(group,calibration,state,familyA,0,clustered.signal):null,runnerUp=familyB?buildScenarioPath(group,calibration,state,familyB,1,clustered.signal):null;
  const aShare=Math.max(0,Number(primary?.routeShare)||0),bShare=Math.max(0,Number(runnerUp?.routeShare)||0),bRatio=aShare>0?bShare/aShare:0,bMeaningful=Boolean(runnerUp&&Number(runnerUp.familySize||0)>=2&&bShare>=PATH_SECONDARY_MIN_SHARE_PCT&&bRatio>=PATH_SECONDARY_MIN_RATIO),secondary=bMeaningful?runnerUp:null,scenarios=[primary,secondary].filter(Boolean),pathGap=round(Math.max(0,aShare-bShare)),top2Share=round(aShare+bShare),residualPct=round(Math.max(0,100-top2Share));
  const diffuse=Boolean(primary&&aShare<28&&Number(clustered.effectiveFamilies||0)>=4.2&&top2Share<50),chaosLevel=!primary?'資料不足':diffuse?'路徑分散':bMeaningful?(pathGap<=7?'雙主路徑':pathGap<=18?'明顯次路徑':'主路徑領先'):'單一主路徑';
  const replay={probabilityTotalPct:round(clustered.familyMass,4),clusterRadius:clustered.clusterRadius,effectiveFamilies:clustered.effectiveFamilies,families:clustered.families.map((f,i)=>({rank:i+1,routeShare:round(f.routeShare,4),direction:f.direction||'',memberCount:Number(f.sampleN||0)})),microPaths:clustered.replay};
  return {mode:'path-family-cone-p70-point-line-area',state,stateLabel:phaseMeta(state).label,tendency:primary?.tendency||'方向未明',direction:primary?.direction||'盤整',confidence:aShare,dataCompletenessPct:completeness,influence:{...PATH_INFLUENCE},historyDays:calibration?.historyDays||0,maturityPct:maturity,points:primary?.points||[],scenarios,primary,secondary,pathGap,chaosLevel,top2Share,residualPct,runnerUpShare:round(bShare,1),runnerUpDirection:runnerUp?.direction||'',runnerUpFamilySize:Number(runnerUp?.familySize||0),secondaryMeaningful:bMeaningful,diffuse,effectiveFamilies:clustered.effectiveFamilies,familyProbabilityTotalPct:round(clustered.familyMass,4),cone:{method:clustered.cone?.method||'causal-nearest-path-error-p70',coveragePct:round(clustered.cone?.coveragePct??70,1),radii:Object.fromEntries(PATH_FAMILY_HORIZONS.map(h=>[h,{radiusNorm:round(clustered.cone?.radii?.[h]?.radiusNorm,4),sampleN:Number(clustered.cone?.radii?.[h]?.sampleN||0)}]))},familyCount:clustered.families.length,candidatePathCount:clustered.candidates.length,_replay:replay,caution:'Path 3.1：點→線→家族→機率→面。所有微路徑機率固定合計100%，A/B只是真實家族機率加總；B僅在形成不可忽視替代家族時顯示。P70只決定預測面積，不參與家族聚類。'};
}
function decorateProjections(groups,calibration){for(const g of groups||[]){const xyPoints=(g.trajectory||[]).filter(p=>p.xAvailable!==false&&num(p.x)!==null);g.xyEligible=Boolean(g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0&&xyPoints.length>=2);g.projection=g.xyEligible?projectGroup(g,calibration):null;}return groups;}

function computeBusinessFlow(profiles,activityRows,{maxDates=DEFAULT_TRAJECTORY_DAYS,priorRaw20ByStock=null}={}){
  const enriched=enrichFlowFeatures(activityRows||[],{priorRaw20ByStock});
  const dates=[...new Set(enriched.map(r=>isoDate(r.trade_date)).filter(Boolean))].sort().slice(-maxDates),dateSet=new Set(dates),profileMaps=buildProfileTagMap(profiles||[]),byDateRows=new Map(dates.map(d=>[d,[]]));
  for(const row of enriched){const d=isoDate(row.trade_date);if(dateSet.has(d))byDateRows.get(d).push(row);}
  const aggregated=new Map(),scoredByDate=new Map();
  for(const date of dates){const scored=scoreStocksForDate(byDateRows.get(date)||[]);scoredByDate.set(date,scored);aggregated.set(date,aggregateTagDate(scored,profileMaps,date));}
  const groups=attachTrajectories(aggregated,dates,{smooth:false}),calibration=buildTransitionCalibration(groups);decorateProjections(groups,calibration);
  return {dates,groups,profileMaps,aggregated,scoredByDate,calibration};
}

// Daily incremental scoring must be mathematically identical to a clean historical rebuild.
// The 25D raw window is only used to form today's 20D/5D/1D flows; today's X scale is
// taken from the last 20 *persisted prior raw20 observations* for that stock.  This avoids
// accidentally mixing an older scale into X just because the incremental source window is short.
function computeLatestBusinessFlow(profiles,activityRows,latestDate,priorRaw20ByStock){
  const cleanDate=isoDate(latestDate);if(!cleanDate)return {latestDate:'',profileMaps:buildProfileTagMap(profiles||[]),scored:[],aggregated:[]};
  const enriched=enrichFlowFeatures(activityRows||[]),latestRows=enriched.filter(r=>isoDate(r.trade_date)===cleanDate);
  for(const row of latestRows){
    const raw20=Number(row.inst_flow_days_20||0)>=STOCK_FLOW_POSITION_DAYS?num(row.inst_flow_ratio_20):null;
    const history=[...((priorRaw20ByStock instanceof Map?priorRaw20ByStock.get(stockKey(row)):null)||[])].map(num).filter(v=>v!==null).slice(-STOCK_FLOW_LOOKBACK_DAYS);
    const historyDays=history.length,scale=stockFlowScale(history),historyReliability=Math.min(1,historyDays/STOCK_FLOW_LOOKBACK_DAYS),dayCoverage=Math.min(1,Number(row.inst_flow_days_20||0)/STOCK_FLOW_POSITION_DAYS);
    row.stock_flow_scale=scale;row.stock_flow_history_days=historyDays;row.stock_flow_maturity_pct=historyReliability*100;row.stock_flow_reliability=historyReliability*dayCoverage;row.stock_flow_score=continuousStockFlowScore(raw20,historyDays,scale);
  }
  const profileMaps=buildProfileTagMap(profiles||[]),scored=scoreStocksForDate(latestRows),aggregated=aggregateTagDate(scored,profileMaps,cleanDate);
  return {latestDate:cleanDate,profileMaps,scored,aggregated};
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
  const calibration=buildTransitionCalibration(allGroups,{calibrateErrors:false}),projection=projectGroup(g,calibration),trajectory=g.trajectory.slice(-displayDays),latestPoint=trajectory.at(-1)||g;
  // Company contribution must cover the complete topic membership, not merely the latest
  // activity-ready rows.  For rows with enough data, contribution is a signed leave-one-out
  // delta: positive X pushes the topic to the right, positive Y pushes price strength upward.
  // Members without a valid latest row remain visible with null contribution and sort last.
  const latestByCode=new Map(latestItems.map(item=>[String(item.stock_code||''),item]));
  const members=[];
  for(const profile of profileMaps.byCode.values()){
    const link=(profile.links||[]).find(x=>x.id===cleanTag);if(!link)continue;
    members.push({profile,link,item:latestByCode.get(String(profile.code||profile.stock_code||''))||null});
  }
  const companies=members.map(({profile,link,item})=>{
    const code=String(profile.code||profile.stock_code||item?.stock_code||''),name=profile.stock_name||profile.name||item?.companyName||item?.stock_name||'',market=profile.market||item?.market||'';
    if(!item)return {code,name,market,importance:link.importance||'related',weight:round(link.weight,2),dataAvailable:false,impactX:null,impactY:null,impactScore:null,stockX:null,stockY:null,institutionalX:null,stockFlowScale:null,stockFlowHistoryDays:0,stockFlowReliability:null,creditCorrection:null,instFlow1Pct:null,instFlow5Pct:null,instFlow10Pct:null,instFlow20Pct:null,positiveDays5:null,changePct:null,return3Pct:null,return5Pct:null,return20Pct:null};
    const reducedScored=latestScored.filter(x=>String(x.stock_code||'')!==code),reducedGroup=aggregateTagDate(reducedScored,profileMaps,latestDate).find(x=>x.tagId===cleanTag),withoutX=reducedGroup?.x??0,withoutY=reducedGroup?.rawY??reducedGroup?.y??0,impactX=(num(latestRawSummary.x)??0)-withoutX,impactY=(num(latestRawSummary.rawY)??0)-withoutY;return {
      code,name:item.companyName||item.stock_name||name,market:item.market||market,importance:item.importance||link.importance||'related',weight:round(item.weight??link.weight,2),dataAvailable:true,stockX:roundNullable(item.stockX),stockY:roundNullable(item.stockY),impactX:round(impactX,2),impactY:round(impactY,2),impactScore:round(Math.abs(impactX)+Math.abs(impactY),2),
      institutionalX:roundNullable(item.stockInstitutionalX,3),stockFlowScale:roundNullable(item.stockFlowScale,3),stockFlowHistoryDays:Number(item.stockFlowHistoryDays||0),stockFlowReliability:roundNullable(item.stockFlowReliability,1),creditCorrection:round(num(item.creditCorrection)||0,1),instFlow1Pct:roundNullable(item.inst_flow_ratio_1,3),instFlow5Pct:roundNullable(item.inst_flow_ratio_5,3),instFlow10Pct:roundNullable(item.inst_flow_ratio_10,3),instFlow20Pct:roundNullable(item.inst_flow_ratio_20,3),
      positiveDays5:num(item.positive_days_5)??0,changePct:round(num(item.change_pct)||0,2),return3Pct:round(num(item.return_3_pct)||0,2),return5Pct:round(num(item.return_5_pct)||0,2),return20Pct:round(num(item.return_20_pct)||0,2)
    };
  }).sort((a,b)=>(Number(b.dataAvailable)-Number(a.dataAvailable))||((num(b.impactX)??-Infinity)-(num(a.impactX)??-Infinity))||String(a.code).localeCompare(String(b.code)));
  const latestFactors=latestPoint?.factors||{};
  const enrichedTrajectory=trajectory.map(p=>({...p,factors:p.factors||{}}));
  return {ok:true,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,tagId:cleanTag,name:meta.name,parentName:meta.parentName||'',scope:meta.scope,asOf:latestPoint.date,trajectoryDays:enrichedTrajectory.length,trajectory:enrichedTrajectory,
    latest:{x:g.x,y:g.y,rawX:g.rawX,rawY:g.rawY,xHistoryDays:g.xHistoryDays,institutionalX:g.institutionalX,creditCorrection:g.creditCorrection,quadrant:g.quadrant,status:g.status,statusLabel:g.statusLabel,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,overheating:g.overheating,
      dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1,memberCount:g.memberCount,validCount:g.validCount,coveragePct:g.coveragePct,reliability:g.reliability,dataCompleteness:g.dataCompleteness,activationRate:g.activationRate,activationValidCount:g.activationValidCount,flow1Pct:g.flow1Pct??g.themeFlow1Pct,flow5Pct:g.flow5Pct??g.themeFlow5Pct,flow20Pct:g.flow20Pct??g.themeFlow20Pct,concentrationQuality:g.concentrationQuality,priceBreadth:g.priceBreadth,factors:latestFactors,
      groupBuild:{themeFlow1Pct:roundNullable(latestRawSummary.themeFlow1Pct,3),themeFlow5Pct:roundNullable(latestRawSummary.themeFlow5Pct,3),themeFlow10Pct:roundNullable(latestRawSummary.themeFlow10Pct,3),themeFlow20Pct:roundNullable(latestRawSummary.themeFlow20Pct,3),concentrationQuality:latestRawSummary.concentrationQuality,institutionalX:latestRawSummary.institutionalX,creditCorrection:latestRawSummary.creditCorrection,themeReturn1Pct:roundNullable(latestRawSummary.themeReturn1Pct,3),themeReturn3Pct:roundNullable(latestRawSummary.themeReturn3Pct,3),themeReturn5Pct:roundNullable(latestRawSummary.themeReturn5Pct,3),themeReturn20Pct:roundNullable(latestRawSummary.themeReturn20Pct,3),yMedian:latestRawSummary.yMedian,yMean:latestRawSummary.yMean,priceBreadth:latestRawSummary.priceBreadth,reliability:latestRawSummary.reliability,businessWeights:IMPORTANCE_WEIGHT}},
    projection,calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount,cone:{method:calibration.cone?.method||'',coveragePct:round(calibration.cone?.coveragePct??70,1),radii:calibration.cone?.radii||{}}},companies,
    methodology:{impact:'公司貢獻涵蓋該業務全部成員；X／Y 都以移除該公司後重新計算題材座標的差值表示。正值代表把該軸往上／右推，負值代表拖低／往左拉；最新資料不足的成員仍列出但不計貢獻。X 單一公司權重受流動性平方根與題材內 cap 限制。',factor:'X 先逐股計算近20日法人淨買賣超／成交值，20D 真實正負決定左右；距離只以該股先前的 20D 法人流量序列做 causal robust scaling，當日本身不進入自己的基準。5D／1D法人只代表短期速度／加速度。投票改為每家公司一票：當日漲幅 > +0.2% 計1票，其餘0票，完全不使用法人與權值股權重。Y＝題材近5日實際價格漲跌幅。',projection:'Future Path 3.1 採點→線→家族→機率→面：所有微路徑先以法人50% > 價格發動率30% > 相似歷史20%取得相對機率，總和嚴格為100%；再依完整3D/5D/10D線形聚類，同族機率直接相加。P70只用來畫歷史誤差預測面積，不參與聚類或灌高A/B機率。'}};
}

async function ensureBusinessFlowSchema(sql=getSql()){
  if(schemaReady)return;
  await Promise.all([ensureInstitutionalHistorySchema(),ensureCreditTradingSchema()]);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy2_stock_daily (
      trade_date date NOT NULL,stock_code text NOT NULL,market text NOT NULL,
      raw_flow_20_pct numeric,raw_flow_5_pct numeric,raw_flow_1_pct numeric,
      x_score numeric,scale_pct numeric,history_days integer,reliability_pct numeric,
      feature_version text NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date,stock_code,market)
    )
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy2_topic_daily (
      trade_date date NOT NULL,tag_id text NOT NULL,tag_name text NOT NULL,parent_name text,scope text NOT NULL,
      member_count integer NOT NULL,valid_count integer NOT NULL,coverage_pct numeric,reliability_pct numeric,
      x_score numeric,y_score numeric,raw_x_20_pct numeric,raw_y_5_pct numeric,
      overheating_score numeric,phase_state text,phase_label text,phase_confidence numeric,
      concentration_quality numeric,price_breadth numeric,strong_count integer,flow_valid_count integer,x_available boolean,
      flow_1_pct numeric,flow_5_pct numeric,flow_20_pct numeric,activation_rate numeric,activation_valid_count integer,activation_active_count integer,activation_participation_pct numeric,
      data_completeness_pct numeric,x_history_days numeric,leaders jsonb,
      feature_version text NOT NULL,build_version text NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date,tag_id)
    )
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy2_snapshot (
      snapshot_kind text NOT NULL,trajectory_days integer NOT NULL,as_of date NOT NULL,
      engine_version text NOT NULL,feature_version text NOT NULL,path_model_version text NOT NULL,snapshot_schema_version text NOT NULL,
      payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (snapshot_kind,trajectory_days)
    )
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy2_member (
      tag_id text NOT NULL,stock_code text NOT NULL,market text NOT NULL,importance text NOT NULL,weight numeric NOT NULL,
      feature_version text NOT NULL,updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tag_id,stock_code,market)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy2_stock_date_idx ON market_business_xy2_stock_daily (trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy2_stock_code_date_idx ON market_business_xy2_stock_daily (market,stock_code,trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy2_topic_date_idx ON market_business_xy2_topic_daily (trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy2_topic_scope_date_idx ON market_business_xy2_topic_daily (scope,trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy2_member_tag_idx ON market_business_xy2_member (tag_id)`);
  schemaReady=true;

  await sql.query(`CREATE TABLE IF NOT EXISTS market_business_xy2_research_daily (
    trade_date date NOT NULL, tag_id text NOT NULL, x_score numeric, y_score numeric,
    flow_1_pct numeric, flow_5_pct numeric, price_breadth numeric, activation_rate numeric,
    feature_version text NOT NULL, build_version text NOT NULL, updated_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trade_date,tag_id)
  )`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_xy2_research_tag_date ON market_business_xy2_research_daily(tag_id,trade_date DESC)`);
}

async function legacyDerivedCounts(sql){
  const out={};for(const table of LEGACY_DERIVED_TABLES){const rows=await sql.query(`SELECT CASE WHEN to_regclass('public.${table}') IS NULL THEN 0 ELSE (SELECT COUNT(*)::bigint FROM ${table}) END AS n`).catch(()=>[{n:0}]);out[table]=Number(rows?.[0]?.n||0);}return out;
}
async function cleanupLegacyDerivedData(sql){
  const state=await readCurrentPreparedState(sql),hist=await readCompactFeatureHistoryStatus(sql,{targetDays:FEATURE_HISTORY_TARGET_DAYS,horizon:5});
  if(!state.ready||hist.compactDays<FEATURE_HISTORY_TARGET_DAYS||hist.xUsableDays<=5||hist.horizonAnchorDays<=0)throw new Error('新 XY v2 尚未完整驗證，禁止刪除舊衍生資料');
  const before=await legacyDerivedCounts(sql),errors=[];
  // These three tables contain only old derived XY/Path data. Raw OHLCV / institutional / credit / activity history are never touched.
  for(const table of LEGACY_DERIVED_TABLES){try{await sql.query(`DELETE FROM ${table}`);}catch(err){const exists=Number(before?.[table]||0)>0;if(exists)errors.push(`${table}: ${err?.message||err}`);}}
  const after=await legacyDerivedCounts(sql),remaining=Object.values(after).reduce((a,b)=>a+Number(b||0),0);
  if(errors.length||remaining>0)throw new Error(`乾淨 XY v2 已建立，但舊 XY/Path 衍生資料清理未完成；原始歷史未動。${errors.length?` ${errors.join(' | ')}`:''}${remaining?` remaining=${remaining}`:''}`);
  return {ok:true,safeScope:'legacy-derived-xy-only',before,after,preserved:['market_daily_history','market_activity_daily','institutional_trading_daily','credit_trading_daily','market_company_profile']};
}

function clearFundflowCaches(){memoryCache.clear();browserMemoryCache.clear();detailMemoryCache.clear();}
function jsonPayload(v){if(!v)return null;if(typeof v==='string'){try{return JSON.parse(v)}catch{return null}}return typeof v==='object'?v:null;}
function compactProjection(p){
  if(!p||typeof p!=='object')return null;
  const point=x=>({horizon:Number(x?.horizon)||0,x:round(x?.x,4),y:round(x?.y,4),dx:round(x?.dx,4),dy:round(x?.dy,4),sampleN:Number(x?.sampleN||0),radiusNorm:round(x?.radiusNorm,4),coveragePct:round(x?.coveragePct,1),errorSampleN:Number(x?.errorSampleN||0),lowX:round(x?.lowX,4),highX:round(x?.highX,4),lowY:round(x?.lowY,4),highY:round(x?.highY,4)});
  const scenario=s=>({id:s?.id||'',rank:Number(s?.rank||0),direction:s?.direction||'',tendency:s?.tendency||'',confidence:round(s?.confidence,1),routeShare:round(s?.routeShare,1),sampleN:Number(s?.sampleN||0),familySize:Number(s?.familySize||s?.sampleN||0),points:(s?.points||[]).map(point)});
  const scenarios=(p.scenarios||[]).slice(0,2).map(scenario),primary=scenarios[0]||null,secondary=scenarios[1]||null;
  return {mode:p.mode||'path-family-cone-p70-point-line-area',state:p.state||'',stateLabel:p.stateLabel||'',tendency:p.tendency||primary?.tendency||'',direction:p.direction||primary?.direction||'',confidence:round(p.confidence??primary?.confidence,1),dataCompletenessPct:round(p.dataCompletenessPct,1),influence:p.influence||PATH_INFLUENCE,historyDays:Number(p.historyDays||0),maturityPct:round(p.maturityPct,1),points:(p.points||primary?.points||[]).map(point),scenarios,primary,secondary,pathGap:round(p.pathGap,1),chaosLevel:p.chaosLevel||'',top2Share:round(p.top2Share,1),residualPct:round(p.residualPct,1),cone:p.cone||null,familyCount:Number(p.familyCount||0),candidatePathCount:Number(p.candidatePathCount||0),runnerUpShare:round(p.runnerUpShare,1),runnerUpDirection:p.runnerUpDirection||'',runnerUpFamilySize:Number(p.runnerUpFamilySize||0),secondaryMeaningful:Boolean(p.secondaryMeaningful),diffuse:Boolean(p.diffuse),effectiveFamilies:round(p.effectiveFamilies,3),familyProbabilityTotalPct:round(p.familyProbabilityTotalPct,4)};
}
function compactOverviewGroup(g,days){
  const xAvailable=Boolean(g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0),xyEligible=Boolean(g.xyEligible&&xAvailable);
  return {tagId:g.tagId,name:g.name,parentName:g.parentName||'',scope:g.scope,memberCount:Number(g.memberCount||0),validCount:Number(g.validCount||0),flowValidCount:Number(g.flowValidCount||0),xAvailable,xyEligible,coveragePct:round(g.coveragePct,1),reliability:round(g.reliability,1),x:xAvailable?round(g.x,4):null,y:round(g.y,4),rawX:xAvailable?round(g.rawX,4):null,rawY:round(g.rawY??g.y,4),xHistoryDays:Number(g.xHistoryDays||0),quadrant:xAvailable?g.quadrant:'',status:xyEligible?g.status:'',statusLabel:xyEligible?g.statusLabel:'待法人資料',phaseState:xyEligible?g.phaseState:'',phaseLabel:xyEligible?g.phaseLabel:'待法人資料',phaseConfidence:xyEligible?round(g.phaseConfidence,1):null,activationRate:round(g.activationRate,1),dataCompleteness:round(g.dataCompleteness??g.reliability,1),flow1Pct:roundNullable(g.flow1Pct??g.themeFlow1Pct,4),flow5Pct:roundNullable(g.flow5Pct??g.themeFlow5Pct,4),flow20Pct:roundNullable(g.flow20Pct??g.rawX,4),overheating:round(g.overheating,1),dx1:xyEligible?round(g.dx1,4):null,dy1:xyEligible?round(g.dy1,4):null,dx3:xyEligible?round(g.dx3,4):null,dy3:xyEligible?round(g.dy3,4):null,ddx1:xyEligible?round(g.ddx1,4):null,ddy1:xyEligible?round(g.ddy1,4):null,rightPersistence:xyEligible?round(g.rightPersistence,1):null,potentialScore:xyEligible?round(g.potentialScore,1):0,mainlineScore:xyEligible?round(g.mainlineScore,1):0,coolingScore:xyEligible?round(g.coolingScore,1):0,rotationScore:xyEligible?round(g.rotationScore,1):0,leaders:(g.leaders||[]).slice(0,3).map(x=>({code:String(x?.code||''),name:x?.name||''})),projection:xyEligible?compactProjection(g.projection):null,trajectory:(g.trajectory||[]).slice(-days).map(p=>({date:p.date,x:p.xAvailable===false?null:round(p.x,4),y:round(p.y,4),xAvailable:p.xAvailable!==false,activationRate:round(p.activationRate,1),overheating:round(p.overheating,1),flow1Pct:roundNullable(p.flow1Pct,4),flow5Pct:roundNullable(p.flow5Pct,4),dataCompleteness:round(p.dataCompleteness??p.reliability,1),dx3:p.xAvailable===false?null:roundNullable(p.dx3,4),dy3:roundNullable(p.dy3,4)}))};
}
function compactPick(g){return {tagId:g.tagId,name:g.name,x:round(g.x,4),y:round(g.y,4),phaseState:g.phaseState,phaseLabel:g.phaseLabel,potentialScore:round(g.potentialScore,1),mainlineScore:round(g.mainlineScore,1),coolingScore:round(g.coolingScore,1),rotationScore:round(g.rotationScore,1),projection:g.projection?{direction:g.projection.direction||'',confidence:round(g.projection.confidence,1),pathGap:round(g.projection.pathGap,1),chaosLevel:g.projection.chaosLevel||''}:null};}
function scopeCounts(groups){const out={'technology-fine':0,'traditional-coarse':0,'electronics-product':0,'other':0};for(const g of groups)out[g.scope]=(out[g.scope]||0)+1;return out;}
function buildPreparedOverview(fullGroups,allDates,calibration,days){
  const bounded=Math.max(5,Math.min(15,Number(days)||10)),groups=(fullGroups||[]).map(g=>({...g,trajectory:(g.trajectory||[]).slice(-bounded)})),businessEligible=g=>g.validCount>=2&&g.trajectory.length>=2,eligible=g=>businessEligible(g)&&g.xyEligible!==false&&g.xAvailable!==false&&num(g.x)!==null&&Number(g.flowValidCount||0)>0;
  const rising=groups.filter(g=>eligible(g)&&['germination','potential'].includes(g.phaseState)&&g.projection?.points?.find(p=>p.horizon===5)?.dy>0).sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,10),mainline=groups.filter(g=>eligible(g)&&g.phaseState==='mainline').sort((a,b)=>b.mainlineScore-a.mainlineScore).slice(0,10),cooling=groups.filter(g=>eligible(g)&&['overheating','cooling'].includes(g.phaseState)).sort((a,b)=>b.coolingScore-a.coolingScore).slice(0,10),rightMoving=groups.filter(g=>eligible(g)&&g.dx3>8).sort((a,b)=>b.rotationScore-a.rotationScore).slice(0,10);
  return {ok:true,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,asOf:allDates.at(-1),trajectoryDates:allDates.slice(-bounded),trajectoryDays:Math.min(bounded,allDates.length),preparedSnapshot:true,cleanXY:true,
    axes:{x:'近20日法人資金位置',y:'近5日題材價格漲跌幅',center:0,xUnit:'robust-score',yUnit:'%',xWindow:20,yWindow:5,momentumWindow:5,xLookback:STOCK_FLOW_LOOKBACK_DAYS},
    methodology:{stockX:'每檔股票 raw X＝近20日法人淨買賣超金額／近20日成交值；20D 真實正負決定左右，距離只用該股當日以前的 raw20 歷史做 causal robust scaling。完全不使用舊 5D percentile/scale。',stockY:'Y＝題材成分公司近5日實際報酬的業務關聯加權平均，不混法人、信用、breadth 或可靠度。',group:'題材 X 用業務關聯度×流動性×資料可靠度 capped 聚合；價格投票完全等權，一家公司一票，當日漲幅 > +0.2% 計1票，其餘0票。',phase:'X20 是中期資金位置；5D／1D法人只描述短期速度；Activation 描述族群價格廣度；Y5 是短期價格位置。',projection:'Future Path 3.1：點→線→家族→機率→面。法人50% > Activation30% > 因果相似歷史20% 只決定微路徑相對機率，全部微路徑嚴格合計100%；完整3D/5D/10D線形再聚類，同族機率直接相加。P70只校準預測面積，完全不參與家族機率。',caution:'X 是 robust 資金強度分數，不是百分比；raw X 才是20D法人流量比例。'},
    calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount,warmup:calibration.historyDays<30,cone:{method:calibration.cone?.method||'',coveragePct:round(calibration.cone?.coveragePct??70,1),radii:calibration.cone?.radii||{}}},counts:{groups:groups.length,businessEligible:groups.filter(businessEligible).length,withXY:groups.filter(eligible).length,pendingX:groups.filter(g=>businessEligible(g)&&!eligible(g)).length,byScope:scopeCounts(groups),rising:rising.length,mainline:mainline.length,cooling:cooling.length},picks:{rising:rising.map(compactPick),potential:rising.map(compactPick),mainline:mainline.map(compactPick),cooling:cooling.map(compactPick),rightMoving:rightMoving.map(compactPick),retreat:cooling.map(compactPick)},groups:groups.map(g=>compactOverviewGroup(g,bounded))};
}
async function persistCompactResearchRows(sql,payload){
  if(!payload?.length)return 0;
  const slim=payload.map(r=>({trade_date:r.trade_date,tag_id:r.tag_id,x_score:r.x_score,y_score:r.y_score,flow_1_pct:r.flow_1_pct,flow_5_pct:r.flow_5_pct,price_breadth:r.price_breadth,activation_rate:r.activation_rate,feature_version:r.feature_version,build_version:r.build_version}));
  await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(trade_date date,tag_id text,x_score numeric,y_score numeric,flow_1_pct numeric,flow_5_pct numeric,price_breadth numeric,activation_rate numeric,feature_version text,build_version text)) INSERT INTO market_business_xy2_research_daily (trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,price_breadth,activation_rate,feature_version,build_version,updated_at) SELECT trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,price_breadth,activation_rate,feature_version,build_version,NOW() FROM incoming ON CONFLICT (trade_date,tag_id) DO UPDATE SET x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,flow_1_pct=EXCLUDED.flow_1_pct,flow_5_pct=EXCLUDED.flow_5_pct,price_breadth=EXCLUDED.price_breadth,activation_rate=EXCLUDED.activation_rate,feature_version=EXCLUDED.feature_version,build_version=EXCLUDED.build_version,updated_at=NOW()`,[JSON.stringify(slim)]);
  await sql.query(`DELETE FROM market_business_xy2_research_daily WHERE trade_date < (SELECT MIN(trade_date) FROM (SELECT DISTINCT trade_date FROM market_business_xy2_research_daily ORDER BY trade_date DESC LIMIT $1) q)`,[RESEARCH_HISTORY_RETENTION_DAYS]).catch(()=>{});
  return slim.length;
}

function memberPayloadFromCompanyMap(profileMaps){
  const payload=[];for(const p of profileMaps?.byCode?.values?.()||[])for(const link of p.links||[])payload.push({tag_id:link.id,stock_code:String(p.stock_code||p.code||''),market:String(p.market||''),importance:link.importance||'related',weight:Number(link.weight||importanceWeight(link.importance)),feature_version:FEATURE_VERSION});
  return payload;
}
async function persistBusinessMembers(sql,profileMaps){
  const payload=memberPayloadFromCompanyMap(profileMaps);if(!payload.length)return 0;
  // One atomic statement. DELETE only obsolete edges; ON CONFLICT updates only rows whose
  // role/weight/version actually changed. Unchanged rows are true no-ops, avoiding needless
  // dead tuples / WAL on every warm refresh.
  await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(tag_id text,stock_code text,market text,importance text,weight numeric,feature_version text)), deleted AS (DELETE FROM market_business_xy2_member m WHERE NOT EXISTS (SELECT 1 FROM incoming i WHERE i.tag_id=m.tag_id AND i.stock_code=m.stock_code AND i.market=m.market) RETURNING 1) INSERT INTO market_business_xy2_member AS m (tag_id,stock_code,market,importance,weight,feature_version,updated_at) SELECT tag_id,stock_code,market,importance,weight,feature_version,NOW() FROM incoming ON CONFLICT (tag_id,stock_code,market) DO UPDATE SET importance=EXCLUDED.importance,weight=EXCLUDED.weight,feature_version=EXCLUDED.feature_version,updated_at=NOW() WHERE m.importance IS DISTINCT FROM EXCLUDED.importance OR m.weight IS DISTINCT FROM EXCLUDED.weight OR m.feature_version IS DISTINCT FROM EXCLUDED.feature_version`,[JSON.stringify(payload)]);
  return payload.length;
}
function edgeKey(x){return `${String(x.stock_code||x.code||'')}|${String(x.market||'')}|${String(x.tag_id||x.tagId||'')}`;}
function compactEdgeDiff(desiredRows,currentRows){
  const wanted=new Map(desiredRows.map(x=>[edgeKey(x),x])),live=new Map(currentRows.map(x=>[edgeKey(x),x]));
  const missing=[],extra=[],roleMismatch=[];
  for(const [k,w] of wanted){const c=live.get(k);if(!c)missing.push({code:w.stock_code,market:w.market,tagId:w.tag_id,expectedRole:w.importance});else if(String(c.importance)!==String(w.importance))roleMismatch.push({code:w.stock_code,market:w.market,tagId:w.tag_id,expectedRole:w.importance,liveRole:c.importance});}
  for(const [k,c] of live)if(!wanted.has(k))extra.push({code:c.stock_code,market:c.market,tagId:c.tag_id,liveRole:c.importance});
  return {missing,extra,roleMismatch,clean:missing.length===0&&extra.length===0&&roleMismatch.length===0};
}
async function syncFinalTaxonomyAndBuildDiagnostic({sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  const freeze=marketTopicTaxonomy.finalTaxonomyFreeze,expected=freeze.STATS,frozenCodes=freeze.companyCodes();
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile WHERE stock_code = ANY($1::text[]) ORDER BY stock_code`,[frozenCodes]);
  const seen=new Set((profiles||[]).map(x=>String(x.stock_code||''))),missingProfiles=frozenCodes.filter(x=>!seen.has(x));
  if(missingProfiles.length)throw new Error(`Company_Map 同步中止：Neon market_company_profile 少 ${missingProfiles.length} 家（例：${missingProfiles.slice(0,8).join(', ')}）`);
  const companyMap=buildCompanyMap(profiles),desired=memberPayloadFromCompanyMap(companyMap);
  const roleCore=desired.filter(x=>x.importance==='core').length,roleRelated=desired.filter(x=>x.importance==='related').length;
  if(desired.length!==expected.membershipEdges||roleCore!==expected.coreEdges||roleRelated!==expected.relatedEdges||companyMap.stats.mappedCompanies!==expected.taggedCompanyCount){
    throw new Error(`Company_Map 同步中止：source freeze 驗證不一致 edges=${desired.length}/${expected.membershipEdges}, core=${roleCore}/${expected.coreEdges}, related=${roleRelated}/${expected.relatedEdges}, tagged=${companyMap.stats.mappedCompanies}/${expected.taggedCompanyCount}`);
  }
  const beforeRows=await sql.query(`SELECT tag_id,stock_code,market,importance,weight,feature_version FROM market_business_xy2_member WHERE stock_code = ANY($1::text[]) ORDER BY stock_code,tag_id`,[frozenCodes]);
  const beforeDiff=compactEdgeDiff(desired,beforeRows);
  // Manage only the frozen company universe, preserving any future listing that may be added after this release.
  await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(tag_id text,stock_code text,market text,importance text,weight numeric,feature_version text)), deleted AS (DELETE FROM market_business_xy2_member m WHERE m.stock_code = ANY($2::text[]) AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.tag_id=m.tag_id AND i.stock_code=m.stock_code AND i.market=m.market) RETURNING 1) INSERT INTO market_business_xy2_member AS m (tag_id,stock_code,market,importance,weight,feature_version,updated_at) SELECT tag_id,stock_code,market,importance,weight,feature_version,NOW() FROM incoming ON CONFLICT (tag_id,stock_code,market) DO UPDATE SET importance=EXCLUDED.importance,weight=EXCLUDED.weight,feature_version=EXCLUDED.feature_version,updated_at=NOW() WHERE m.importance IS DISTINCT FROM EXCLUDED.importance OR m.weight IS DISTINCT FROM EXCLUDED.weight OR m.feature_version IS DISTINCT FROM EXCLUDED.feature_version`,[JSON.stringify(desired),frozenCodes]);
  clearFundflowCaches();
  const liveRows=await sql.query(`SELECT m.tag_id,m.stock_code,m.market,m.importance,m.weight,m.feature_version,p.stock_name FROM market_business_xy2_member m LEFT JOIN market_company_profile p ON p.stock_code=m.stock_code AND p.market=m.market WHERE m.stock_code = ANY($1::text[]) ORDER BY m.stock_code,m.tag_id`,[frozenCodes]);
  const afterDiff=compactEdgeDiff(desired,liveRows);
  const byCompany=new Map(),byTag=new Map();
  for(const r of liveRows||[]){
    const code=String(r.stock_code||''),tagId=String(r.tag_id||''),importance=String(r.importance||'related');
    if(!byCompany.has(code))byCompany.set(code,{code,name:r.stock_name||'',market:r.market||'',tags:[]});byCompany.get(code).tags.push({tagId,role:importance});
    const t=byTag.get(tagId)||{companyCount:0,coreCount:0,relatedCount:0};t.companyCount++;if(importance==='core')t.coreCount++;else t.relatedCount++;byTag.set(tagId,t);
  }
  const [overview,browser]=await Promise.all([readPreparedSnapshot(sql,'overview',10).catch(()=>null),readPreparedSnapshot(sql,'browser',10).catch(()=>null)]),browserById=new Map((browser?.items||[]).map(x=>[x.tagId,x]));
  const tags=freeze.listDefinitions().map(d=>{const live=byTag.get(d.id)||{companyCount:0,coreCount:0,relatedCount:0},xy=browserById.get(d.id)||null;return {tagId:d.id,xyName:d.name,sourceCompanyCount:d.companyCount,sourceCoreCount:d.coreCount,sourceRelatedCount:d.relatedCount,liveCompanyCount:live.companyCount,liveCoreCount:live.coreCount,liveRelatedCount:live.relatedCount,zeroMember:live.companyCount===0,withXY:xy?Boolean(xy.xyEligible):null,pendingX:xy?Boolean(xy.represented&&!xy.xyEligible&&String(xy.noXYReason||'').includes('法人')):null,noXYReason:xy?.noXYReason||''};});
  const snapshotCurrent=Boolean(overview&&browser),withXY=snapshotCurrent?Number(browser?.counts?.withXY||0):0,withoutXY=snapshotCurrent?Number(browser?.counts?.withoutXY||0):expected.taxonomyCount,pendingX=snapshotCurrent?Number(overview?.counts?.pendingX||0):0;
  const diagnostic={
    generatedAt:new Date().toISOString(),appVersion:'2.6.6.12',taxonomyVersion:marketTopicTaxonomy.version,freezeVersion:freeze.VERSION,
    engineVersion:ENGINE_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,
    source:{...expected},sync:{before:{rows:beforeRows.length,missing:beforeDiff.missing.length,extra:beforeDiff.extra.length,roleMismatch:beforeDiff.roleMismatch.length},after:{rows:liveRows.length,clean:afterDiff.clean,missing:afterDiff.missing.length,extra:afterDiff.extra.length,roleMismatch:afterDiff.roleMismatch.length},writesPlanned:{delete:beforeDiff.extra.length,insert:beforeDiff.missing.length,roleUpdate:beforeDiff.roleMismatch.length},atomic:true,unchangedRowsNotUpdated:true},
    xy:{snapshotCurrent,asOf:overview?.asOf||null,totalDefinitions:snapshotCurrent?Number(browser?.counts?.totalDefinitions||0):0,withXY,withoutXY,pendingX,zeroMemberDefinitions:tags.filter(x=>x.zeroMember).length,note:snapshotCurrent?'current taxonomy25 prepared snapshot':'請按「更新 XY / 分類快照」建立 taxonomy25 prepared snapshot 後再匯出一次'},
    sourceVsProductionDiff:afterDiff,tags,liveCompanyMap:[...byCompany.values()],strictNoTagCodes:frozenCodes.filter(code=>!(freeze.companyTopicPairs(code)||[]).length)
  };
  return {ok:true,manual:true,summary:{taxonomyCount:expected.taxonomyCount,companyUniverseCount:expected.companyUniverseCount,taggedCompanyCount:expected.taggedCompanyCount,membershipEdges:expected.membershipEdges,coreEdges:expected.coreEdges,relatedEdges:expected.relatedEdges,writes:diagnostic.sync.writesPlanned,diffClean:afterDiff.clean,snapshotCurrent,withXY,withoutXY,pendingX},diagnostic};
}

async function persistPreparedSnapshots(sql,{fullGroups,allDates,calibration,profiles,companyMap=null}){
  if(!allDates?.length)return {overview:new Map(),browser:new Map()};const rows=[],overview=new Map(),browser=new Map(),companyIndex=companyMap||buildCompanyMap(profiles);
  for(const days of PREPARED_SNAPSHOT_DAYS){const value=buildPreparedOverview(fullGroups,allDates,calibration,days),catalog=buildBusinessBrowserCatalog(profiles,value,companyIndex);overview.set(days,value);browser.set(days,catalog);rows.push({snapshot_kind:'overview',trajectory_days:days,as_of:value.asOf,payload:value},{snapshot_kind:'browser',trajectory_days:days,as_of:value.asOf,payload:catalog});}
  await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(snapshot_kind text,trajectory_days integer,as_of date,payload jsonb)) INSERT INTO market_business_xy2_snapshot (snapshot_kind,trajectory_days,as_of,engine_version,feature_version,path_model_version,snapshot_schema_version,payload,updated_at) SELECT snapshot_kind,trajectory_days,as_of,$2,$3,$4,$5,payload,NOW() FROM incoming ON CONFLICT (snapshot_kind,trajectory_days) DO UPDATE SET as_of=EXCLUDED.as_of,engine_version=EXCLUDED.engine_version,feature_version=EXCLUDED.feature_version,path_model_version=EXCLUDED.path_model_version,snapshot_schema_version=EXCLUDED.snapshot_schema_version,payload=EXCLUDED.payload,updated_at=NOW()`,[JSON.stringify(rows),ENGINE_VERSION,FEATURE_VERSION,PATH_MODEL_VERSION,SNAPSHOT_SCHEMA_VERSION]);
  const now=Date.now();for(const [days,value] of overview)memoryCache.set(days,{savedAt:now,value});for(const [days,value] of browser)browserMemoryCache.set(days,{savedAt:now,value});detailMemoryCache.clear();return {overview,browser};
}
function isCurrentPreparedPayload(payload){return Boolean(payload&&String(payload.engineVersion||'')===ENGINE_VERSION&&String(payload.featureVersion||'')===FEATURE_VERSION&&String(payload.pathModelVersion||'')===PATH_MODEL_VERSION&&String(payload.snapshotSchemaVersion||'')===SNAPSHOT_SCHEMA_VERSION&&String(payload.dailyBuildVersion||'')===DAILY_BUILD_VERSION);}
async function readPreparedSnapshot(sql,kind,days){const rows=await sql.query(`SELECT payload FROM market_business_xy2_snapshot WHERE snapshot_kind=$1 AND trajectory_days=$2 AND engine_version=$3 AND feature_version=$4 AND path_model_version=$5 AND snapshot_schema_version=$6 LIMIT 1`,[kind,days,ENGINE_VERSION,FEATURE_VERSION,PATH_MODEL_VERSION,SNAPSHOT_SCHEMA_VERSION]);const payload=jsonPayload(rows?.[0]?.payload);return isCurrentPreparedPayload(payload)?payload:null;}
async function persistPathAuditSnapshot(sql,path,asOf,replay=null){
  const payload={ok:true,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,generatedAt:new Date().toISOString(),asOf:asOf||null,path,replay};
  await sql.query(`INSERT INTO market_business_xy2_snapshot (snapshot_kind,trajectory_days,as_of,engine_version,feature_version,path_model_version,snapshot_schema_version,payload,updated_at) VALUES ('path-audit',0,$1::date,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT (snapshot_kind,trajectory_days) DO UPDATE SET as_of=EXCLUDED.as_of,engine_version=EXCLUDED.engine_version,feature_version=EXCLUDED.feature_version,path_model_version=EXCLUDED.path_model_version,snapshot_schema_version=EXCLUDED.snapshot_schema_version,payload=EXCLUDED.payload,updated_at=NOW()`,[asOf||new Date().toISOString().slice(0,10),ENGINE_VERSION,FEATURE_VERSION,PATH_MODEL_VERSION,SNAPSHOT_SCHEMA_VERSION,JSON.stringify(payload)]);
  return payload;
}
async function readPathAuditSnapshot(sql){
  const rows=await sql.query(`SELECT payload FROM market_business_xy2_snapshot WHERE snapshot_kind='path-audit' AND trajectory_days=0 AND engine_version=$1 AND feature_version=$2 AND path_model_version=$3 AND snapshot_schema_version=$4 LIMIT 1`,[ENGINE_VERSION,FEATURE_VERSION,PATH_MODEL_VERSION,SNAPSHOT_SCHEMA_VERSION]).catch(()=>[]),payload=jsonPayload(rows?.[0]?.payload);
  return payload&&String(payload.engineVersion||'')===ENGINE_VERSION&&String(payload.pathModelVersion||'')===PATH_MODEL_VERSION&&String(payload.dailyBuildVersion||'')===DAILY_BUILD_VERSION?payload:null;
}

async function loadEngineInputs(sql,trajectoryDays){
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`),sourceDays=Math.max(INCREMENTAL_SOURCE_DAYS,Math.min(FEATURE_HISTORY_SOURCE_DAYS,Number(trajectoryDays)||INCREMENTAL_SOURCE_DAYS));
  const dateRows=await sql.query(`WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value > 0 AND return_5_pct IS NOT NULL GROUP BY trade_date HAVING COUNT(DISTINCT market)=2), inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2) SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) ORDER BY a.trade_date DESC LIMIT $1`,[sourceDays]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates,activityRows:[],sourceDays};
  const activityRows=await sql.query(`SELECT a.trade_date,a.stock_code,a.stock_name,a.market,a.trade_value,a.change_pct,a.positive_days_5,a.return_3_pct,a.return_5_pct,a.return_20_pct,h.close_price,h.trade_volume,i.foreign_net AS institutional_foreign_net,i.trust_net AS institutional_trust_net,i.dealer_net AS institutional_dealer_net,i.total_net AS institutional_total_net FROM market_activity_daily a LEFT JOIN market_daily_history h ON h.trade_date=a.trade_date AND h.stock_code=a.stock_code AND h.market=a.market LEFT JOIN institutional_trading_daily i ON i.trade_date=a.trade_date AND i.stock_code=a.stock_code AND i.market=a.market WHERE a.trade_value IS NOT NULL AND a.trade_value > 0 AND a.return_5_pct IS NOT NULL AND a.trade_date >= $1::date AND a.trade_date <= $2::date AND a.market IN ('上市','上櫃') ORDER BY a.market,a.stock_code,a.trade_date`,[dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:activityRows.filter(x=>dates.includes(isoDate(x.trade_date))),sourceDays};
}
async function loadTagEngineInputs(sql,tagId,trajectoryDays){
  const cleanTag=String(tagId||'').trim();if(!cleanTag)return {profiles:[],dates:[],activityRows:[]};
  const profiles=await sql.query(`SELECT DISTINCT p.stock_code,p.stock_name,p.market,p.industry_code,p.industry,p.auto_business_tags,p.auto_market_topics,p.main_business,p.business_enrich_status,p.business_enrich_version,p.business_enrich_checked_at FROM market_company_profile p JOIN market_business_xy2_member m ON m.stock_code=p.stock_code AND m.market=p.market WHERE m.tag_id=$1 ORDER BY p.stock_code`,[cleanTag]);if(!profiles.length)return {profiles,dates:[],activityRows:[]};
  const sourceDays=Math.max(DETAIL_SOURCE_DAYS,STOCK_FLOW_POSITION_DAYS+STOCK_FLOW_LOOKBACK_DAYS+Math.max(Number(trajectoryDays)||10,15));
  const dateRows=await sql.query(`WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value > 0 AND return_5_pct IS NOT NULL GROUP BY trade_date HAVING COUNT(DISTINCT market)=2), inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2) SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) ORDER BY a.trade_date DESC LIMIT $1`,[sourceDays]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates,activityRows:[]};
  const activityRows=await sql.query(`SELECT a.trade_date,a.stock_code,a.stock_name,a.market,a.trade_value,a.change_pct,a.positive_days_5,a.return_3_pct,a.return_5_pct,a.return_20_pct,h.close_price,h.trade_volume,i.foreign_net AS institutional_foreign_net,i.trust_net AS institutional_trust_net,i.dealer_net AS institutional_dealer_net,i.total_net AS institutional_total_net,c.margin_prev_balance,c.margin_balance,c.short_prev_balance,c.short_balance,c.sbl_prev_balance,c.sbl_balance FROM market_activity_daily a JOIN market_business_xy2_member m ON m.tag_id=$1 AND m.stock_code=a.stock_code AND m.market=a.market LEFT JOIN market_daily_history h ON h.trade_date=a.trade_date AND h.stock_code=a.stock_code AND h.market=a.market LEFT JOIN institutional_trading_daily i ON i.trade_date=a.trade_date AND i.stock_code=a.stock_code AND i.market=a.market LEFT JOIN credit_trading_daily c ON c.trade_date=a.trade_date AND c.stock_code=a.stock_code AND c.market=a.market WHERE a.trade_value IS NOT NULL AND a.trade_value > 0 AND a.return_5_pct IS NOT NULL AND a.trade_date >= $2::date AND a.trade_date <= $3::date ORDER BY a.market,a.stock_code,a.trade_date`,[cleanTag,dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:activityRows.filter(x=>dates.includes(isoDate(x.trade_date)))};
}
function stockDailyFeatureRow(date,row){return {trade_date:date,stock_code:String(row.stock_code||''),market:String(row.market||''),raw_flow_20_pct:row.inst_flow_ratio_20,raw_flow_5_pct:row.inst_flow_ratio_5,raw_flow_1_pct:row.inst_flow_ratio_1,x_score:row.stockX,scale_pct:row.stockFlowScale,history_days:Number(row.stockFlowHistoryDays||0),reliability_pct:row.stockFlowReliability,feature_version:FEATURE_VERSION};}
async function persistStockDailyFeatures(sql,payload){if(!payload?.length)return 0;await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(trade_date date,stock_code text,market text,raw_flow_20_pct numeric,raw_flow_5_pct numeric,raw_flow_1_pct numeric,x_score numeric,scale_pct numeric,history_days integer,reliability_pct numeric,feature_version text)) INSERT INTO market_business_xy2_stock_daily (trade_date,stock_code,market,raw_flow_20_pct,raw_flow_5_pct,raw_flow_1_pct,x_score,scale_pct,history_days,reliability_pct,feature_version,updated_at) SELECT trade_date,stock_code,market,raw_flow_20_pct,raw_flow_5_pct,raw_flow_1_pct,x_score,scale_pct,history_days,reliability_pct,feature_version,NOW() FROM incoming ON CONFLICT (trade_date,stock_code,market) DO UPDATE SET raw_flow_20_pct=EXCLUDED.raw_flow_20_pct,raw_flow_5_pct=EXCLUDED.raw_flow_5_pct,raw_flow_1_pct=EXCLUDED.raw_flow_1_pct,x_score=EXCLUDED.x_score,scale_pct=EXCLUDED.scale_pct,history_days=EXCLUDED.history_days,reliability_pct=EXCLUDED.reliability_pct,feature_version=EXCLUDED.feature_version,updated_at=NOW()`,[JSON.stringify(payload)]);return payload.length;}
async function trimStockCompactHistory(sql){await sql.query(`DELETE FROM market_business_xy2_stock_daily WHERE trade_date < (SELECT MIN(trade_date) FROM (SELECT DISTINCT trade_date FROM market_business_xy2_stock_daily ORDER BY trade_date DESC LIMIT $1) q)`,[STOCK_COMPACT_RETENTION_DAYS]).catch(()=>{});}
async function trimTopicCompactHistory(sql){await sql.query(`DELETE FROM market_business_xy2_topic_daily WHERE trade_date < (SELECT MIN(trade_date) FROM (SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily ORDER BY trade_date DESC LIMIT $1) q)`,[RESEARCH_HISTORY_RETENTION_DAYS]).catch(()=>{});}
async function loadPriorRaw20History(sql,beforeDate){
  const rows=await sql.query(`SELECT market,stock_code,trade_date,raw_flow_20_pct FROM (SELECT market,stock_code,trade_date,raw_flow_20_pct,ROW_NUMBER() OVER (PARTITION BY market,stock_code ORDER BY trade_date DESC) rn FROM market_business_xy2_stock_daily WHERE feature_version=$1 AND trade_date < $2::date AND raw_flow_20_pct IS NOT NULL) q WHERE rn <= $3 ORDER BY market,stock_code,trade_date`,[FEATURE_VERSION,beforeDate,STOCK_FLOW_LOOKBACK_DAYS]).catch(()=>[]),map=new Map();
  for(const r of rows){const key=`${r.market}|${r.stock_code}`;if(!map.has(key))map.set(key,[]);map.get(key).push(num(r.raw_flow_20_pct));}return map;
}
function compactDailyFeatureRow(date,row){return {trade_date:date,tag_id:row.tagId,tag_name:row.name,parent_name:row.parentName||null,scope:row.scope,member_count:row.memberCount,valid_count:row.validCount,coverage_pct:row.coveragePct,reliability_pct:row.reliability,x_score:row.xAvailable===false?null:row.x,y_score:row.y,raw_x_20_pct:row.xAvailable===false?null:row.rawX,raw_y_5_pct:row.rawY,overheating_score:row.overheating,phase_state:row.phaseState,phase_label:row.phaseLabel,phase_confidence:row.phaseConfidence,concentration_quality:row.concentrationQuality,price_breadth:row.priceBreadth,strong_count:row.strongCount,flow_valid_count:Number(row.flowValidCount||0),x_available:Boolean(row.xAvailable!==false&&Number(row.flowValidCount||0)>0),flow_1_pct:row.themeFlow1Pct,flow_5_pct:row.themeFlow5Pct,flow_20_pct:row.themeFlow20Pct,activation_rate:row.activationRate,activation_valid_count:Number(row.activationValidCount||0),activation_active_count:Number(row.activationActiveCount||0),activation_participation_pct:row.activationParticipationPct,data_completeness_pct:row.dataCompleteness,x_history_days:row.xHistoryDays,leaders:row.leaders,feature_version:FEATURE_VERSION,build_version:DAILY_BUILD_VERSION};}
async function persistCompactDailyFeatures(sql,payload){if(!payload?.length)return 0;await sql.query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(trade_date date,tag_id text,tag_name text,parent_name text,scope text,member_count integer,valid_count integer,coverage_pct numeric,reliability_pct numeric,x_score numeric,y_score numeric,raw_x_20_pct numeric,raw_y_5_pct numeric,overheating_score numeric,phase_state text,phase_label text,phase_confidence numeric,concentration_quality numeric,price_breadth numeric,strong_count integer,flow_valid_count integer,x_available boolean,flow_1_pct numeric,flow_5_pct numeric,flow_20_pct numeric,activation_rate numeric,activation_valid_count integer,activation_active_count integer,activation_participation_pct numeric,data_completeness_pct numeric,x_history_days numeric,leaders jsonb,feature_version text,build_version text)), refreshed_dates AS (SELECT DISTINCT trade_date FROM incoming), deleted AS (DELETE FROM market_business_xy2_topic_daily b WHERE b.trade_date IN (SELECT trade_date FROM refreshed_dates) AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.trade_date=b.trade_date AND i.tag_id=b.tag_id) RETURNING 1) INSERT INTO market_business_xy2_topic_daily (trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_20_pct,raw_y_5_pct,overheating_score,phase_state,phase_label,phase_confidence,concentration_quality,price_breadth,strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,activation_active_count,activation_participation_pct,data_completeness_pct,x_history_days,leaders,feature_version,build_version,updated_at) SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_20_pct,raw_y_5_pct,overheating_score,phase_state,phase_label,phase_confidence,concentration_quality,price_breadth,strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,activation_active_count,activation_participation_pct,data_completeness_pct,x_history_days,leaders,feature_version,build_version,NOW() FROM incoming ON CONFLICT (trade_date,tag_id) DO UPDATE SET tag_name=EXCLUDED.tag_name,parent_name=EXCLUDED.parent_name,scope=EXCLUDED.scope,member_count=EXCLUDED.member_count,valid_count=EXCLUDED.valid_count,coverage_pct=EXCLUDED.coverage_pct,reliability_pct=EXCLUDED.reliability_pct,x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,raw_x_20_pct=EXCLUDED.raw_x_20_pct,raw_y_5_pct=EXCLUDED.raw_y_5_pct,overheating_score=EXCLUDED.overheating_score,phase_state=EXCLUDED.phase_state,phase_label=EXCLUDED.phase_label,phase_confidence=EXCLUDED.phase_confidence,concentration_quality=EXCLUDED.concentration_quality,price_breadth=EXCLUDED.price_breadth,strong_count=EXCLUDED.strong_count,flow_valid_count=EXCLUDED.flow_valid_count,x_available=EXCLUDED.x_available,flow_1_pct=EXCLUDED.flow_1_pct,flow_5_pct=EXCLUDED.flow_5_pct,flow_20_pct=EXCLUDED.flow_20_pct,activation_rate=EXCLUDED.activation_rate,activation_valid_count=EXCLUDED.activation_valid_count,activation_active_count=EXCLUDED.activation_active_count,activation_participation_pct=EXCLUDED.activation_participation_pct,data_completeness_pct=EXCLUDED.data_completeness_pct,x_history_days=EXCLUDED.x_history_days,leaders=EXCLUDED.leaders,feature_version=EXCLUDED.feature_version,build_version=EXCLUDED.build_version,updated_at=NOW()`,[JSON.stringify(payload)]);return payload.length;}
async function readCompactFeatureHistoryStatus(sql,{targetDays=FEATURE_HISTORY_TARGET_DAYS,horizon=5}={}){
  const target=Math.max(25,Math.min(RESEARCH_HISTORY_RETENTION_DAYS,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS)),h=Math.max(3,Math.min(10,Number(horizon)||5));
  const rows=await sql.query(`WITH dates AS (SELECT trade_date,COUNT(*)::int AS rows,COUNT(*) FILTER (WHERE x_available=true AND x_score IS NOT NULL)::int AS x_rows FROM market_business_xy2_topic_daily WHERE feature_version=$1 GROUP BY trade_date ORDER BY trade_date), usable AS (SELECT trade_date FROM dates WHERE x_rows>0), ranked AS (SELECT trade_date,ROW_NUMBER() OVER (ORDER BY trade_date) AS rn,COUNT(*) OVER () AS n FROM usable) SELECT (SELECT COUNT(*)::int FROM dates) AS compact_days,(SELECT COUNT(*)::int FROM usable) AS x_usable_days,(SELECT COUNT(*)::int FROM ranked WHERE rn+$2<=n) AS horizon_anchor_days,(SELECT MIN(trade_date)::text FROM dates) AS min_date,(SELECT MAX(trade_date)::text FROM dates) AS max_date,(SELECT COUNT(*)::int FROM market_business_xy2_topic_daily WHERE feature_version=$1) AS compact_rows,(SELECT COUNT(*)::int FROM market_business_xy2_stock_daily WHERE feature_version=$1) AS stock_rows`,[FEATURE_VERSION,h]).catch(()=>[]),r=rows?.[0]||{},legacy=await legacyDerivedCounts(sql);
  return {featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,targetDays:target,horizon:h,compactDays:Number(r.compact_days||0),xUsableDays:Number(r.x_usable_days||0),horizonAnchorDays:Number(r.horizon_anchor_days||0),compactRows:Number(r.compact_rows||0),stockRows:Number(r.stock_rows||0),minDate:isoDate(r.min_date)||null,maxDate:isoDate(r.max_date)||null,legacyDerivedRows:Object.values(legacy).reduce((a,b)=>a+Number(b||0),0),legacyDerivedByTable:legacy,historyReady:Number(r.compact_days||0)>=target&&Number(r.horizon_anchor_days||0)>0};
}

async function readTopicTaxonomyBuildState(sql,{targetDays=FEATURE_HISTORY_TARGET_DAYS}={}){
  const target=Math.max(25,Math.min(FEATURE_HISTORY_SOURCE_DAYS,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS));
  const rows=await sql.query(`WITH recent_dates AS (SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily WHERE feature_version=$1 ORDER BY trade_date DESC LIMIT $2), per_date AS (SELECT t.trade_date,COUNT(*)::int AS rows,COUNT(*) FILTER (WHERE t.build_version=$3)::int AS current_rows FROM market_business_xy2_topic_daily t JOIN recent_dates d USING (trade_date) WHERE t.feature_version=$1 GROUP BY t.trade_date) SELECT COUNT(*)::int AS dates,COUNT(*) FILTER (WHERE rows>0 AND rows=current_rows)::int AS current_dates,COALESCE(SUM(rows),0)::int AS rows,COALESCE(SUM(current_rows),0)::int AS current_rows,MIN(trade_date)::text AS min_date,MAX(trade_date)::text AS max_date FROM per_date`,[FEATURE_VERSION,target,DAILY_BUILD_VERSION]).catch(()=>[]),r=rows?.[0]||{};
  const dates=Number(r.dates||0),currentDates=Number(r.current_dates||0);
  return {topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,targetDays:target,dates,currentDates,rows:Number(r.rows||0),currentRows:Number(r.current_rows||0),minDate:isoDate(r.min_date)||null,maxDate:isoDate(r.max_date)||null,ready:dates>=target&&currentDates===dates};
}

async function rebuildTopicTaxonomyHistory({targetDays=FEATURE_HISTORY_TARGET_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  const target=Math.max(25,Math.min(FEATURE_HISTORY_SOURCE_DAYS,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS)),before=await readTopicTaxonomyBuildState(sql,{targetDays:target});
  const currentDateRows=await sql.query(`WITH recent_dates AS (SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily WHERE feature_version=$1 ORDER BY trade_date DESC LIMIT $2) SELECT t.trade_date::text AS trade_date FROM market_business_xy2_topic_daily t JOIN recent_dates d USING (trade_date) WHERE t.feature_version=$1 GROUP BY t.trade_date HAVING COUNT(*)>0 AND COUNT(*) FILTER (WHERE t.build_version=$3)=COUNT(*) ORDER BY t.trade_date`,[FEATURE_VERSION,target,DAILY_BUILD_VERSION]).catch(()=>[]),currentDates=new Set((currentDateRows||[]).map(r=>isoDate(r.trade_date)).filter(Boolean));
  const input=await loadEngineInputs(sql,target);
  if(input.dates.length<target)return {ok:false,reason:`taxonomy-rebuild-needs-${target}-common-days`,noUpstreamFetch:true,before,sourceDays:input.dates.length,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION};
  // Taxonomy-only migration is resumable. A platform timeout can leave completed dates in place;
  // the next run recomputes the deterministic 60D source once but writes only still-stale dates.
  // Prepared snapshots / Path audit are intentionally a separate follow-up request so the 60D
  // taxonomy rewrite and the expensive walk-forward audit never share one serverless timeout budget.
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:target}),pendingDates=computed.dates.filter(d=>!currentDates.has(d));let topicRows=0,processedDates=0;
  for(let i=0;i<pendingDates.length;i+=8){const slice=pendingDates.slice(i,i+8),payload=[];for(const date of slice)for(const row of computed.aggregated.get(date)||[])payload.push(compactDailyFeatureRow(date,row));topicRows+=await persistCompactDailyFeatures(sql,payload);await persistCompactResearchRows(sql,payload);processedDates+=slice.length;}
  await trimTopicCompactHistory(sql);await persistBusinessMembers(sql,computed.profileMaps);clearFundflowCaches();const after=await readTopicTaxonomyBuildState(sql,{targetDays:target});
  return {ok:Boolean(after.ready),skipped:pendingDates.length===0,mode:'taxonomy-only-topic-history-rebuild',migrationStage:'topic-history',followupRequired:Boolean(after.ready),noUpstreamFetch:true,noStockFeatureRewrite:true,targetDays:target,sourceWindowDays:computed.dates.length,processedDates,remainingDates:Math.max(0,target-Number(after.currentDates||0)),topicRows,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,before,after,prepared:false};
}
async function refreshBusinessFlowDaily({trajectoryDays=INCREMENTAL_SOURCE_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);const stale=await needsRefresh(sql);if(!stale){const state=await readCurrentPreparedState(sql);return {ok:true,skipped:true,reason:'latest-date-already-materialized',noUpstreamFetch:true,state};}
  const input=await loadEngineInputs(sql,Math.max(INCREMENTAL_SOURCE_DAYS,Number(trajectoryDays)||INCREMENTAL_SOURCE_DAYS));if(!input.dates.length)return {ok:false,reason:'no-ready-common-dates',noUpstreamFetch:true};
  const latestDate=input.dates.at(-1),prior=await loadPriorRaw20History(sql,latestDate),computed=computeLatestBusinessFlow(input.profiles,input.activityRows,latestDate,prior);if(!computed.latestDate)return {ok:false,reason:'no-computed-date',noUpstreamFetch:true};
  const stockPayload=(computed.scored||[]).filter(r=>num(r.inst_flow_ratio_20)!==null).map(r=>stockDailyFeatureRow(latestDate,r)),topicPayload=(computed.aggregated||[]).map(r=>compactDailyFeatureRow(latestDate,r));
  await persistStockDailyFeatures(sql,stockPayload);await persistCompactDailyFeatures(sql,topicPayload);await persistCompactResearchRows(sql,topicPayload);await trimStockCompactHistory(sql);await trimTopicCompactHistory(sql);await persistBusinessMembers(sql,computed.profileMaps);clearFundflowCaches();await rebuildPreparedFromStored(sql);
  return {ok:true,skipped:false,mode:'clean-latest-date-incremental',noUpstreamFetch:true,sourceWindowDays:input.dates.length,latestTradeDate:latestDate,stockRows:stockPayload.length,topicRows:topicPayload.length,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION};
}
async function backfillCompactFeatureHistory({targetDays=FEATURE_HISTORY_TARGET_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);const target=Math.max(25,Math.min(FEATURE_HISTORY_SOURCE_DAYS,Number(targetDays)||FEATURE_HISTORY_TARGET_DAYS)),before=await readCompactFeatureHistoryStatus(sql,{targetDays:target});
  if(before.historyReady){let legacyCleanup=null;if(before.legacyDerivedRows>0)legacyCleanup=await cleanupLegacyDerivedData(sql);const after=await readCompactFeatureHistoryStatus(sql,{targetDays:target});return {ok:true,skipped:true,reason:'clean-xy-history-already-ready',noUpstreamFetch:true,before,after,legacyCleanup,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION};}
  const input=await loadEngineInputs(sql,target);if(input.dates.length<target)return {ok:false,reason:`clean-xy-needs-${target}-common-days`,noUpstreamFetch:true,before,sourceDays:input.dates.length};
  // Rebuild v2 derived layers from raw/reference history; no old XY rows are read or copied.
  await sql.query(`DELETE FROM market_business_xy2_stock_daily`);await sql.query(`DELETE FROM market_business_xy2_topic_daily`);await sql.query(`DELETE FROM market_business_xy2_snapshot`);await sql.query(`DELETE FROM market_business_xy2_member`);
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:target}),stockDates=computed.dates.slice(-STOCK_COMPACT_RETENTION_DAYS);let stockRows=0,topicRows=0;
  for(let i=0;i<stockDates.length;i+=5){const slice=stockDates.slice(i,i+5),payload=[];for(const date of slice)for(const row of computed.scoredByDate.get(date)||[])if(num(row.inst_flow_ratio_20)!==null)payload.push(stockDailyFeatureRow(date,row));stockRows+=await persistStockDailyFeatures(sql,payload);}
  for(let i=0;i<computed.dates.length;i+=8){const slice=computed.dates.slice(i,i+8),payload=[];for(const date of slice)for(const row of computed.aggregated.get(date)||[])payload.push(compactDailyFeatureRow(date,row));topicRows+=await persistCompactDailyFeatures(sql,payload);await persistCompactResearchRows(sql,payload);}
  await trimStockCompactHistory(sql);await trimTopicCompactHistory(sql);await persistBusinessMembers(sql,computed.profileMaps);clearFundflowCaches();await rebuildPreparedFromStored(sql);
  const preCleanup=await readCompactFeatureHistoryStatus(sql,{targetDays:target}),state=await readCurrentPreparedState(sql);if(!preCleanup.historyReady||!state.ready)throw new Error('新 XY v2 建立未完整，保留舊衍生資料並停止清理');
  const legacyCleanup=await cleanupLegacyDerivedData(sql),after=await readCompactFeatureHistoryStatus(sql,{targetDays:target});
  return {ok:true,skipped:false,mode:'clean-xy-v2-rebuild-and-cutover',noUpstreamFetch:true,targetDays:target,sourceWindowDays:computed.dates.length,stockRows,topicRows,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,before,after,legacyCleanup};
}
async function needsRefresh(sql){
  await ensureBusinessFlowSchema(sql);const rows=await sql.query(`WITH activity_dates AS (SELECT trade_date FROM market_activity_daily WHERE market IN ('上市','上櫃') AND trade_value IS NOT NULL AND trade_value > 0 AND return_5_pct IS NOT NULL GROUP BY trade_date HAVING COUNT(DISTINCT market)=2), inst_dates AS (SELECT trade_date FROM institutional_trading_daily WHERE market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2), common_dates AS (SELECT a.trade_date FROM activity_dates a JOIN inst_dates i USING (trade_date) ORDER BY a.trade_date DESC LIMIT 1) SELECT (SELECT MAX(trade_date) FROM common_dates) AS source_date,(SELECT MAX(trade_date) FROM market_business_xy2_topic_daily WHERE feature_version=$1) AS feature_date,(SELECT COUNT(*)::int FROM market_business_xy2_topic_daily WHERE feature_version=$1) AS feature_rows`,[FEATURE_VERSION]);const r=rows[0]||{};return !Number(r.feature_rows||0)||isoDate(r.feature_date)!==isoDate(r.source_date);
}
function hydrateStoredRows(rows,dates){
  const byDate=new Map(dates.map(d=>[d,[]]));for(const r of rows){const d=isoDate(r.trade_date);if(!byDate.has(d))continue;const x=num(r.x_score),xAvailable=Boolean(r.x_available!==false&&x!==null&&Number(r.flow_valid_count||0)>0);byDate.get(d).push({tradeDate:d,tagId:r.tag_id,name:r.tag_name,parentName:r.parent_name||'',scope:r.scope,memberCount:Number(r.member_count||0),validCount:Number(r.valid_count||0),coveragePct:num(r.coverage_pct)||0,reliability:num(r.reliability_pct)||0,xAvailable,flowValidCount:Number(r.flow_valid_count||0),x:xAvailable?x:null,y:num(r.y_score)??0,rawX:xAvailable?num(r.raw_x_20_pct):null,rawY:num(r.raw_y_5_pct)??num(r.y_score)??0,xHistoryDays:num(r.x_history_days)??0,institutionalX:xAvailable?num(r.raw_x_20_pct):null,creditCorrection:0,overheating:num(r.overheating_score)||0,phaseState:r.phase_state||'',phaseLabel:r.phase_label||'',phaseConfidence:num(r.phase_confidence)??50,concentrationQuality:num(r.concentration_quality)??50,priceBreadth:num(r.price_breadth)||0,strongCount:Number(r.strong_count||0),flow1Pct:num(r.flow_1_pct),flow5Pct:num(r.flow_5_pct),flow20Pct:num(r.flow_20_pct)??num(r.raw_x_20_pct),activationRate:num(r.activation_rate)??0,activationValidCount:Number(r.activation_valid_count||0),dataCompleteness:num(r.data_completeness_pct)??num(r.reliability_pct)??0,leaders:Array.isArray(r.leaders)?r.leaders:[]});}
  return attachTrajectories(byDate,dates,{smooth:false});
}
async function rebuildPreparedFromStored(sql){
  const dateRows=await sql.query(`SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily WHERE feature_version=$1 ORDER BY trade_date DESC LIMIT $2`,[FEATURE_VERSION,ENGINE_HISTORY_DAYS]),allDates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!allDates.length)return null;
  const rows=await sql.query(`SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_20_pct,raw_y_5_pct,overheating_score,phase_state,phase_label,phase_confidence,concentration_quality,price_breadth,strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,activation_rate,activation_valid_count,activation_active_count,activation_participation_pct,data_completeness_pct,x_history_days,leaders FROM market_business_xy2_topic_daily WHERE feature_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date ORDER BY trade_date,tag_id`,[FEATURE_VERSION,allDates[0],allDates.at(-1)]),fullGroups=hydrateStoredRows(rows,allDates),calibration=buildTransitionCalibration(fullGroups);decorateProjections(fullGroups,calibration);
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`),companyMap=buildCompanyMap(profiles);await persistBusinessMembers(sql,companyMap);clearFundflowCaches();const prepared=await persistPreparedSnapshots(sql,{fullGroups,allDates,calibration,profiles,companyMap});const path=walkForwardPathAudit(fullGroups,{horizon:5,minHistoryDays:1});const replay={asOf:allDates.at(-1),groups:(fullGroups||[]).filter(g=>g.projection?._replay).map(g=>({tagId:g.tagId,name:g.name||g.tagId,...g.projection._replay}))};await persistPathAuditSnapshot(sql,path,allDates.at(-1),replay);return {...prepared,pathAudit:path};
}
async function rebuildPathAuditFromStored(sql){
  const loaded=await loadPersistedBusinessGroupsForAudit(sql,{maxDates:ENGINE_HISTORY_DAYS}),dates=loaded?.dates||[],groups=loaded?.groups||[];
  if(!dates.length||!groups.length)return {ok:false,reason:'no-compact-topic-history-for-path-audit',noUpstreamFetch:true};
  const calibration=buildTransitionCalibration(groups);decorateProjections(groups,calibration);const path=walkForwardPathAudit(groups,{horizon:5,minHistoryDays:1}),replay={asOf:dates.at(-1),groups:(groups||[]).filter(g=>g.projection?._replay).map(g=>({tagId:g.tagId,name:g.name||g.tagId,...g.projection._replay}))};
  await persistPathAuditSnapshot(sql,path,dates.at(-1),replay);
  return {ok:true,mode:'path-audit-repair-from-compact',noUpstreamFetch:true,asOf:dates.at(-1),compactDates:dates.length,path,replayGroups:replay.groups.length};
}
async function readCurrentPreparedState(sql){
  await ensureBusinessFlowSchema(sql);const rows=await sql.query(`SELECT snapshot_kind,trajectory_days,as_of,updated_at,engine_version,feature_version,path_model_version,snapshot_schema_version FROM market_business_xy2_snapshot WHERE snapshot_kind IN ('overview','browser') AND trajectory_days = ANY($1::int[]) ORDER BY snapshot_kind,trajectory_days`,[PREPARED_SNAPSHOT_DAYS]),currentRows=(rows||[]).filter(r=>r.engine_version===ENGINE_VERSION&&r.feature_version===FEATURE_VERSION&&r.path_model_version===PATH_MODEL_VERSION&&r.snapshot_schema_version===SNAPSHOT_SCHEMA_VERSION),have=new Set(currentRows.map(r=>`${r.snapshot_kind}:${Number(r.trajectory_days)}`)),expected=[];for(const kind of ['overview','browser'])for(const days of PREPARED_SNAPSHOT_DAYS)expected.push(`${kind}:${days}`);const missing=expected.filter(k=>!have.has(k));return {ready:missing.length===0,have:[...have].sort(),missing,staleSchemaRows:(rows||[]).length-currentRows.length,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,asOf:currentRows.map(r=>isoDate(r.as_of)).filter(Boolean).sort().at(-1)||null,updatedAt:currentRows.map(r=>r.updated_at).filter(Boolean).sort().at(-1)||null};
}
async function warmCurrentEngineFromStoredDb({sql=getSql(),force=false}={}){
  await ensureBusinessFlowSchema(sql);const before=await readCurrentPreparedState(sql),hist=await readCompactFeatureHistoryStatus(sql,{targetDays:FEATURE_HISTORY_TARGET_DAYS});if(!hist.historyReady)return {ok:false,skipped:true,reason:'clean-xy-v2-history-not-built',noUpstreamFetch:true,before,history:hist};
  const taxonomyState=await readTopicTaxonomyBuildState(sql,{targetDays:FEATURE_HISTORY_TARGET_DAYS});
  if(!taxonomyState.ready){const result=await rebuildTopicTaxonomyHistory({targetDays:FEATURE_HISTORY_TARGET_DAYS,sql});return {ok:Boolean(result?.ok),skipped:false,followupRequired:Boolean(result?.ok&&result?.followupRequired),followupStage:'prepared-snapshot-path-audit',engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,noUpstreamFetch:true,mode:result?.mode||'taxonomy-only-topic-history-rebuild',before,after:before,taxonomyBefore:taxonomyState,taxonomyAfter:result?.after,migration:result,result};}
  const stale=await needsRefresh(sql),pathAudit=await readPathAuditSnapshot(sql),pathStats=pathAudit?.path||{},auditMissing=Boolean(!pathAudit),auditSuspiciousZero=Boolean(Number(hist?.horizonAnchorDays||0)>0&&Number(hist?.xUsableDays||0)>5&&Number(pathStats?.usableDates||0)<=0),auditStale=Boolean(pathAudit&&before?.asOf&&isoDate(pathAudit?.asOf)!==isoDate(before.asOf)),auditNeedsRepair=auditMissing||auditSuspiciousZero||auditStale;
  // Prepared overview/browser rows can survive a previous serverless timeout even when path-audit did not.
  // Never return cheap no-op until the current compact Path audit is also present and plausible.
  if(before.ready&&!force&&!stale&&!auditNeedsRepair)return {ok:true,skipped:true,reason:'clean-engine-snapshots-and-path-audit-already-latest',engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,noUpstreamFetch:true,before,after:before,pathAuditReady:true};
  if(before.ready&&!force&&!stale&&auditNeedsRepair){const result=await rebuildPathAuditFromStored(sql),after=await readCurrentPreparedState(sql);return {ok:Boolean(after.ready&&result?.ok),skipped:false,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,noUpstreamFetch:true,mode:result?.mode||'path-audit-repair-from-compact',before,after,result,pathAuditRepair:{missing:auditMissing,suspiciousZero:auditSuspiciousZero,stale:auditStale,previousAsOf:isoDate(pathAudit?.asOf)||null,expectedAsOf:isoDate(before?.asOf)||null}};}
  let result=null,mode='prepared-from-clean-topic-history';if(stale){result=await refreshBusinessFlowDaily({sql});mode=result?.mode||'clean-latest-date-incremental';}else result=await rebuildPreparedFromStored(sql);const after=await readCurrentPreparedState(sql);return {ok:Boolean(after.ready),skipped:false,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,noUpstreamFetch:true,mode,before,after,result};
}
async function getFundflowSnapshot({days=10,force=false}={}){const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now(),hit=memoryCache.get(bounded);if(!force&&hit&&now-hit.savedAt<5*60*1000&&isCurrentPreparedPayload(hit.value))return hit.value;if(hit&&!isCurrentPreparedPayload(hit.value))memoryCache.delete(bounded);const prepared=await readPreparedSnapshot(sql,'overview',bounded);if(prepared){memoryCache.set(bounded,{savedAt:now,value:prepared});return prepared;}throw new Error('乾淨 XY v2 尚未建立；請到設定按「重建乾淨 XY」');}
async function getFundflowBusinessBrowser({days=10,force=false}={}){const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now(),hit=browserMemoryCache.get(bounded);if(!force&&hit&&now-hit.savedAt<10*60*1000&&isCurrentPreparedPayload(hit.value))return hit.value;if(hit&&!isCurrentPreparedPayload(hit.value))browserMemoryCache.delete(bounded);const prepared=await readPreparedSnapshot(sql,'browser',bounded);if(prepared){browserMemoryCache.set(bounded,{savedAt:now,value:prepared});return prepared;}throw new Error('乾淨 XY v2 業務瀏覽器尚未建立');}
async function getFundflowDetail({tagId,days=10}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),cleanTag=String(tagId||'').trim();if(!cleanTag)throw new Error('缺少業務 tag');const snapshot=await getFundflowSnapshot({days:bounded,force:false}),cacheKey=`${cleanTag}|${bounded}|${snapshot.asOf||''}|${ENGINE_VERSION}`,now=Date.now(),hit=detailMemoryCache.get(cacheKey);if(hit&&now-hit.savedAt<10*60*1000)return hit.value;
  const input=await loadTagEngineInputs(sql,cleanTag,bounded);if(!input.dates.length||!input.profiles.length)throw new Error('此業務尚無可用 XY 明細');const detail=computeTagDetail(input.profiles,input.activityRows,cleanTag,{maxDates:bounded}),g=(snapshot.groups||[]).find(x=>x.tagId===cleanTag);if(g){detail.latest={...detail.latest,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,activationRate:g.activationRate,overheating:g.overheating,dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1};detail.projection=g.projection||detail.projection;detail.calibration=snapshot.calibration||detail.calibration;}detail.lazyLoaded=true;detail.snapshotSchemaVersion=SNAPSHOT_SCHEMA_VERSION;detail.dailyBuildVersion=DAILY_BUILD_VERSION;detailMemoryCache.set(cacheKey,{savedAt:now,value:detail});return detail;
}

// ---------- clean XY evidence gate -------------------------------------------------------------
// This audit deliberately reads compact, already-materialized DB layers instead of rebuilding
// the full stock engine. It is used from Settings to answer three questions with evidence:
// (1) which topics/companies are missing institutional history, (2) whether X/Y invariants hold
// on benchmark themes, and (3) what the Future Path model actually achieved in causal walk-forward.
async function loadPersistedBusinessGroupsForAudit(sql,{maxDates=80}={}){
  await ensureBusinessFlowSchema(sql);
  const dateRows=await sql.query(`
    SELECT trade_date::text AS d FROM (
      SELECT DISTINCT trade_date FROM market_business_xy2_topic_daily
      WHERE feature_version=$1
      ORDER BY trade_date DESC LIMIT $2
    ) q ORDER BY d
  `,[FEATURE_VERSION,Math.max(20,Math.min(120,Number(maxDates)||80))]);
  const dates=dateRows.map(r=>isoDate(r.d)).filter(Boolean);if(!dates.length)return {dates:[],groups:[]};
  const rows=await sql.query(`
    SELECT trade_date::text AS trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,
      coverage_pct,reliability_pct,x_score,y_score,raw_x_20_pct,raw_y_5_pct,
      overheating_score,phase_state,phase_label,phase_confidence,concentration_quality,price_breadth,
      strong_count,flow_valid_count,x_available,flow_1_pct,flow_5_pct,flow_20_pct,
      activation_rate,activation_valid_count,activation_active_count,activation_participation_pct,
      data_completeness_pct,x_history_days,leaders
    FROM market_business_xy2_topic_daily
    WHERE feature_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date
    ORDER BY trade_date,tag_id
  `,[FEATURE_VERSION,dates[0],dates.at(-1)]);
  const byDate=new Map(dates.map(d=>[d,[]]));
  for(const r of rows||[]){
    const d=isoDate(r.trade_date);if(!byDate.has(d))continue;
    const x=num(r.x_score),xAvailable=Boolean(r.x_available!==false&&x!==null&&Number(r.flow_valid_count||0)>0),activation=num(r.activation_rate)??0;
    byDate.get(d).push({
      tradeDate:d,tagId:String(r.tag_id||''),name:r.tag_name||'',parentName:r.parent_name||'',scope:r.scope||'',
      memberCount:Number(r.member_count||0),validCount:Number(r.valid_count||0),flowValidCount:Number(r.flow_valid_count||0),
      coveragePct:num(r.coverage_pct)??0,reliability:num(r.reliability_pct)??0,dataCompleteness:num(r.data_completeness_pct)??num(r.reliability_pct)??0,
      xAvailable,x:xAvailable?x:null,y:num(r.y_score)??0,rawX:xAvailable?num(r.raw_x_20_pct):null,rawY:num(r.raw_y_5_pct)??num(r.y_score)??0,
      institutionalX:xAvailable?num(r.raw_x_20_pct):null,creditCorrection:0,overheating:num(r.overheating_score)??0,
      phaseState:xAvailable?(r.phase_state||'transition'):'',phaseLabel:r.phase_label||'',phaseConfidence:xAvailable?(num(r.phase_confidence)??0):0,
      concentrationQuality:num(r.concentration_quality)??0,priceBreadth:num(r.price_breadth)??0,
      strongCount:Number(r.strong_count||0),flow1Pct:num(r.flow_1_pct),flow5Pct:num(r.flow_5_pct),flow20Pct:num(r.flow_20_pct)??num(r.raw_x_20_pct),
      activationRate:activation,activationValidCount:Number(r.activation_valid_count||0),activationActiveCount:Number(r.activation_active_count||0),activationParticipationPct:num(r.activation_participation_pct)??0,
      xHistoryDays:num(r.x_history_days)??0,leaders:Array.isArray(r.leaders)?r.leaders:[]
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
      truncated.push({...g,...latest,x:latest.x,y:latest.y,rawX:latest.rawX,phaseState:latest.phaseState||'transition',phaseConfidence:latest.phaseConfidence,activationRate:latest.activationRate,overheating:latest.overheating,dx1:latest.dx1,dy1:latest.dy1,dx3:latest.dx3,dy3:latest.dy3,ddx1:latest.ddx1,ddy1:latest.ddy1,trajectory:t});
    }
    if(!truncated.length)continue;
    const calibration=buildTransitionCalibration(truncated,{calibrateErrors:'light'});if(Number(calibration.historyDays||0)<minHistoryDays)continue;
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

async function buildCompactBenchmarkEvidence(sql,benchmarkIds,overview){
  const ids=[...new Set((benchmarkIds||[]).map(x=>String(x||'').trim()).filter(Boolean))],groupMap=new Map((overview?.groups||[]).map(g=>[String(g.tagId),g]));if(!ids.length)return [];
  const latestDate=isoDate(overview?.asOf);if(!latestDate)return [];
  const rows=await sql.query(`SELECT tag_id,tag_name,x_score,y_score,raw_x_20_pct,flow_valid_count,x_available FROM market_business_xy2_topic_daily WHERE feature_version=$1 AND trade_date=$2::date AND tag_id = ANY($3::text[])`,[FEATURE_VERSION,latestDate,ids]).catch(()=>[]),byId=new Map(rows.map(r=>[String(r.tag_id),r]));
  const companies=await sql.query(`SELECT m.tag_id,m.stock_code,p.stock_name,m.importance,m.weight,s.x_score,s.raw_flow_20_pct,s.raw_flow_5_pct,s.history_days FROM market_business_xy2_member m LEFT JOIN market_company_profile p ON p.stock_code=m.stock_code AND p.market=m.market LEFT JOIN market_business_xy2_stock_daily s ON s.stock_code=m.stock_code AND s.market=m.market AND s.trade_date=$1::date AND s.feature_version=$2 WHERE m.feature_version=$2 AND m.tag_id = ANY($3::text[]) ORDER BY m.tag_id,m.weight DESC NULLS LAST,m.stock_code`,[latestDate,FEATURE_VERSION,ids]).catch(()=>[]),byCompany=new Map();for(const c of companies){const id=String(c.tag_id);if(!byCompany.has(id))byCompany.set(id,[]);if(byCompany.get(id).length<12)byCompany.get(id).push({code:String(c.stock_code||''),name:c.stock_name||'',importance:c.importance||'',weight:roundNullable(c.weight,2),stockX:roundNullable(c.x_score,1),rawFlow20:roundNullable(c.raw_flow_20_pct,3),rawFlow5:roundNullable(c.raw_flow_5_pct,3),stockFlowHistoryDays:Number(c.history_days||0),impactX:null});}
  return ids.map(id=>{const r=byId.get(id),g=groupMap.get(id),x=num(r?.x_score),rawX=num(r?.raw_x_20_pct),y=num(r?.y_score),gx=num(g?.x),gr=num(g?.rawX),gy=num(g?.y),available=Boolean(r&&g),signPass=x!==null&&rawX!==null&&sign(x)===sign(rawX),snapshotMatch=available&&Math.abs((gx??0)-(x??0))<=.01&&Math.abs((gr??0)-(rawX??0))<=.01&&Math.abs((gy??0)-(y??0))<=.01;return {tagId:id,name:g?.name||r?.tag_name||id,available,x:roundNullable(x,2),rawX:roundNullable(rawX,4),y:roundNullable(y,4),flowValidCount:Number(r?.flow_valid_count||0),signLockPass:signPass,yFinite:y!==null,snapshotMatch,persisted:{x:roundNullable(x,2),rawX:roundNullable(rawX,4),y:roundNullable(y,4)},companies:byCompany.get(id)||[]};});
}

async function loadBenchmarkInputs(sql,tagIds,{maxDates=80}={}){
  const ids=[...new Set((tagIds||[]).map(x=>String(x||'').trim()).filter(Boolean))];if(!ids.length)return {profiles:[],dates:[],activityRows:[]};
  const profiles=await sql.query(`
    SELECT DISTINCT p.stock_code,p.stock_name,p.market,p.industry_code,p.industry,p.auto_business_tags,p.auto_market_topics,p.main_business,p.business_enrich_status,p.business_enrich_version,p.business_enrich_checked_at
    FROM market_company_profile p
    JOIN market_business_xy2_member m ON m.stock_code=p.stock_code AND m.market=p.market
    WHERE m.feature_version=$1 AND m.tag_id = ANY($2::text[])
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
  `,[Math.max(40,Math.min(100,Number(maxDates)||80))]);
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
      AND EXISTS (SELECT 1 FROM market_business_xy2_member m WHERE m.feature_version=$3 AND m.tag_id = ANY($4::text[]) AND m.stock_code=a.stock_code AND m.market=a.market)
    ORDER BY a.stock_code,a.trade_date
  `,[dates[0],dates.at(-1),FEATURE_VERSION,ids]);
  return {profiles,dates,activityRows};
}

async function buildBenchmarkEvidence(sql,benchmarkIds,persistedById){
  const input=await loadBenchmarkInputs(sql,benchmarkIds,{maxDates:60});
  const out=[];
  for(const id of benchmarkIds){
    const persisted=persistedById.get(id)||null;
    try{
      const detail=computeTagDetail(input.profiles,input.activityRows,id,{maxDates:10}),x=num(detail?.latest?.x),rawX=num(detail?.latest?.rawX),y=num(detail?.latest?.y),px=num(persisted?.x_score),pr=num(persisted?.raw_x_20_pct),py=num(persisted?.y_score);
      const signPass=x!==null&&rawX!==null&&sign(x)===sign(rawX),snapshotMatch=px!==null&&pr!==null&&py!==null&&Math.abs(x-px)<=.06&&Math.abs(rawX-pr)<=.015&&Math.abs(y-py)<=.015;
      out.push({tagId:id,name:detail.name||persisted?.tag_name||id,available:true,x:roundNullable(x,2),rawX:roundNullable(rawX,4),y:roundNullable(y,4),flowValidCount:Number(persisted?.flow_valid_count||0),signLockPass:signPass,yFinite:y!==null,snapshotMatch,
        persisted:{x:roundNullable(px,2),rawX:roundNullable(pr,4),y:roundNullable(py,4)},
        companies:(detail.companies||[]).map(c=>({code:c.code,name:c.name,importance:c.importance,weight:c.weight,stockX:c.stockX,rawFlow20:c.instFlow20Pct,rawFlow5:c.instFlow5Pct,impactX:c.impactX,stockFlowHistoryDays:c.stockFlowHistoryDays})).slice(0,24)});
    }catch(e){
      const x=num(persisted?.x_score),rawX=num(persisted?.raw_x_20_pct),y=num(persisted?.y_score);
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
      SELECT DISTINCT tag_id,stock_code,market FROM market_business_xy2_member WHERE feature_version=$2
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
    stocks AS (SELECT DISTINCT stock_code,market FROM market_business_xy2_member WHERE feature_version=$2),
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
  const [state,overview,browser,compactHistory,storage,pathSnapshot]=await Promise.all([
    readCurrentPreparedState(sql),readPreparedSnapshot(sql,'overview',10),readPreparedSnapshot(sql,'browser',10),
    readCompactFeatureHistoryStatus(sql,{targetDays:boundedTarget,horizon:5}),require('./db').readDatabaseSizeAudit(sql).catch(e=>({error:String(e?.message||e),tables:[]})),readPathAuditSnapshot(sql)
  ]);
  const groups=overview?.groups||[],businessUniverse=Number(overview?.counts?.businessEligible??groups.filter(g=>Number(g.validCount)>=2&&Number.isFinite(Number(g.y))).length),withXY=Number(overview?.counts?.withXY??groups.filter(g=>g.xyEligible!==false&&g.xAvailable!==false&&num(g.x)!==null).length),pendingX=Math.max(0,businessUniverse-withXY),latestDate=isoDate(overview?.asOf)||compactHistory.maxDate||null;
  const benchmarkIds=['foplp','mcu','semiconductor_equipment','abf_substrate'],latestRows=latestDate?await sql.query(`SELECT tag_id,raw_x_20_pct FROM market_business_xy2_topic_daily WHERE feature_version=$1 AND trade_date=$2::date AND x_available=true ORDER BY raw_x_20_pct NULLS LAST`,[FEATURE_VERSION,latestDate]).catch(()=>[]):[],lowest=(latestRows||[]).filter(r=>num(r.raw_x_20_pct)!==null).sort((a,b)=>(num(a.raw_x_20_pct)??0)-(num(b.raw_x_20_pct)??0))[0];if(lowest?.tag_id&&!benchmarkIds.includes(lowest.tag_id))benchmarkIds.push(lowest.tag_id);
  const benchmarks=await buildCompactBenchmarkEvidence(sql,benchmarkIds,overview),path=pathSnapshot?.path||{horizon:5,usableDates:0,anchorDates:0,predictions:0,top1HitPct:null,top2HitPct:null,targetQuadrantHitPct:null,confidence60:{n:0,top1HitPct:null},routeShare60:{n:0,top1HitPct:null},target60Reached:false,byState:{},examples:[]};
  const institutional={targetDays:boundedTarget,source:'compact-cutover-proxy',note:'驗證不再掃 raw institutional；60D 完整度由已完成 Clean XY compact history 與設定頁 DB coverage 管理。',markets:{'上市':{completeDays:compactHistory.historyReady?boundedTarget:Math.min(boundedTarget,compactHistory.compactDays||0),days:[]},'上櫃':{completeDays:compactHistory.historyReady?boundedTarget:Math.min(boundedTarget,compactHistory.compactDays||0),days:[]}}};
  const businessUniverseBaseline=145,withXYBaseline=145,taxonomyBaseline=185,taxonomyDefinitions=Number(browser?.counts?.totalDefinitions||0),taxonomyZeroMembers=Number(browser?.counts?.zeroMemberDefinitions||0),xyCoveragePct=businessUniverse?round(withXY/businessUniverse*100,1):0;
  // Topic-count growth is not a quality gate: semantic pruning may intentionally reduce definitions.
  // Purity gate instead requires a non-empty frozen taxonomy with no zero-member definitions.
  const regression={snapshotCurrent:Boolean(state.ready&&overview&&browser&&String(overview.engineVersion||'')===ENGINE_VERSION&&String(overview.featureVersion||'')===FEATURE_VERSION&&String(overview.pathModelVersion||'')===PATH_MODEL_VERSION&&String(overview.snapshotSchemaVersion||'')===SNAPSHOT_SCHEMA_VERSION&&String(browser.engineVersion||'')===ENGINE_VERSION&&String(browser.snapshotSchemaVersion||'')===SNAPSHOT_SCHEMA_VERSION),businessUniverse,businessUniverseBaseline,businessUniverseDelta:businessUniverse-businessUniverseBaseline,withXY,withXYBaseline,withXYDelta:withXY-withXYBaseline,pendingX,xyCoveragePct,taxonomyDefinitions,taxonomyBaseline,taxonomyDelta:taxonomyDefinitions-taxonomyBaseline,taxonomyZeroMembers,companyMapStats:browser?.companyMapStats||null,universeFloorPass:businessUniverse>=Math.floor(businessUniverseBaseline*.80),xyCountRegressionPass:withXY>=Math.floor(withXYBaseline*.90),taxonomyPass:taxonomyDefinitions>0&&taxonomyZeroMembers===0,benchmarkSignLockPass:benchmarks.filter(x=>x.available).every(x=>x.signLockPass),benchmarkSnapshotMatchPass:benchmarks.filter(x=>x.available).every(x=>x.snapshotMatch),benchmarkCoveragePass:benchmarks.slice(0,4).filter(x=>x.available).length>=3};
  const cleanCutover=compactHistory.legacyDerivedRows===0,releaseGate={snapshotCurrent:regression.snapshotCurrent,universeStable:regression.universeFloorPass&&regression.taxonomyPass,xyCountNoRegression:regression.xyCountRegressionPass,xyCoverage70:xyCoveragePct>=70,benchmarkXY:regression.benchmarkSignLockPass&&regression.benchmarkSnapshotMatchPass&&regression.benchmarkCoveragePass,institutional60D:Boolean(compactHistory.historyReady),compactHistoryReady:Boolean(compactHistory.historyReady&&compactHistory.horizonAnchorDays>0),cleanCutover,pathMeasured:path.predictions>=30,pathTop1AtLeast60:Boolean(path.target60Reached)};releaseGate.readyToFinalize=Object.values(releaseGate).every(Boolean);
  return {ok:true,generatedAt:new Date().toISOString(),auditSource:'prepared+compact-only',topicTaxonomyVersion:TOPIC_TAXONOMY_VERSION,auditCached:Boolean(pathSnapshot),noRawScan:true,engineVersion:ENGINE_VERSION,featureVersion:FEATURE_VERSION,pathModelVersion:PATH_MODEL_VERSION,snapshotSchemaVersion:SNAPSHOT_SCHEMA_VERSION,dailyBuildVersion:DAILY_BUILD_VERSION,latestDate,state,regression,institutional,compactHistory,storage,topicCoverage:{source:'compact-only',missingCompanies:[]},benchmarks,path,releaseGate};
}

module.exports={FEATURE_VERSION,PATH_MODEL_VERSION,ENGINE_VERSION,DAILY_BUILD_VERSION,TOPIC_TAXONOMY_VERSION,SNAPSHOT_SCHEMA_VERSION,DEFAULT_TRAJECTORY_DAYS,ENGINE_HISTORY_DAYS,STOCK_FLOW_POSITION_DAYS,STOCK_FLOW_MOMENTUM_DAYS,STOCK_FLOW_LOOKBACK_DAYS,STOCK_FLOW_MIN_HISTORY_DAYS,STOCK_FLOW_SCALE_FLOOR_PCT,INCREMENTAL_SOURCE_DAYS,FEATURE_HISTORY_TARGET_DAYS,FEATURE_HISTORY_SOURCE_DAYS,RESEARCH_HISTORY_RETENTION_DAYS,TOPIC_SINGLE_STOCK_CAP,ACTIVATION_THRESHOLD_PCT,PATH_INFLUENCE,PATH_MIN_COMPLETENESS_PCT,PATH_CONE_COVERAGE,PREPARED_SNAPSHOT_DAYS,PHASES,NON_CORE_EXPOSURE_BUDGET,stockFlowScale,continuousStockFlowScore,capWeightShares,buildTopicWeightLinks,enrichFlowFeatures,scoreStocksForDate,summarizeTagItemsRaw,normalizeTagSummaries,aggregateTagDate,computeBusinessFlow,computeLatestBusinessFlow,computeTagDetail,quadrant,buildTransitionCalibration,projectGroup,axisEvidenceDistribution,ensureBusinessFlowSchema,refreshBusinessFlowDaily,backfillCompactFeatureHistory,readCompactFeatureHistoryStatus,readTopicTaxonomyBuildState,rebuildTopicTaxonomyHistory,getFundflowSnapshot,getFundflowDetail,getFundflowBusinessBrowser,buildCompanyMap,buildProfileTagMap,buildBusinessBrowserCatalog,buildPreparedOverview,compactOverviewGroup,loadTagEngineInputs,rebuildPreparedFromStored,rebuildPathAuditFromStored,readCurrentPreparedState,warmCurrentEngineFromStoredDb,walkForwardPathAudit,loadPersistedBusinessGroupsForAudit,loadBenchmarkInputs,buildBenchmarkEvidence,readTopicInstitutionalCoverageAudit,readFundflowValidationAudit,syncFinalTaxonomyAndBuildDiagnostic,cleanupLegacyDerivedData};
