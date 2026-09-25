// StockZone v2.6.5.0 — Blind-Coverage Market-Topic Fund-Flow XY Engine v2.2.0 + Phase Transition Engine v1
// B: X is price-free capital activity; Y is price strength; 3-session EMA reduces daily noise.
// C: confirmation C, overheating E, velocity/acceleration, phase state + empirical transition calibration.
// E': actual XY history stays solid; uncertainty fan is shown only after selection.

function getSql(){ return require('./db').getSql(); }
const { resolveCompanyBusinessTags, parseAutoBusinessTags } = require('./company-business-tags');
const { classifyBusinessText } = require('./business-enrichment');
const { marketTopicLinks, listMarketDefinitions } = require('./market-topic-taxonomy');

const ENGINE_VERSION = 'xy-2.2.2-blind-market-topic-phase-1.0';
const DEFAULT_TRAJECTORY_DAYS = 15;
const ENGINE_HISTORY_DAYS = 60;
const IMPORTANCE_WEIGHT = Object.freeze({ core:1, important:0.85, related:0.65 });
const PHASES = Object.freeze({
  cold:{key:'cold',label:'冷區',order:0},
  germination:{key:'germination',label:'資金萌芽',order:1},
  potential:{key:'potential',label:'潛伏準備攀升',order:2},
  mainline:{key:'mainline',label:'主升確認',order:3},
  overheating:{key:'overheating',label:'高檔過熱',order:4},
  cooling:{key:'cooling',label:'冷卻退潮',order:5},
  transition:{key:'transition',label:'轉換／混沌',order:null},
});
let schemaReady = false;
let memoryCache = null;

function num(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function clamp(v,lo=0,hi=100){return Math.max(lo,Math.min(hi,Number(v)||0));}
function round(v,d=1){const p=10**d;return Math.round((Number(v)||0)*p)/p;}
function isoDate(v){
  if(!v)return '';
  if(typeof v==='string')return v.slice(0,10);
  if(v instanceof Date && Number.isFinite(v.getTime()))return v.toISOString().slice(0,10);
  return String(v).slice(0,10);
}
function importanceWeight(v){return IMPORTANCE_WEIGHT[String(v||'related')]||0.65;}
function median(values){
  const a=(values||[]).map(num).filter(v=>v!==null).sort((x,y)=>x-y);if(!a.length)return null;
  const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function quantile(values,q){
  const a=(values||[]).map(num).filter(v=>v!==null).sort((x,y)=>x-y);if(!a.length)return null;if(a.length===1)return a[0];
  const p=Math.max(0,Math.min(1,q))*(a.length-1),lo=Math.floor(p),hi=Math.ceil(p),t=p-lo;return a[lo]*(1-t)+a[hi]*t;
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
      x:g?.x??null,y:g?.y??null,rawX:g?.rawX??null,rawY:g?.rawY??null,quadrant:g?.quadrant||'',status:g?.status||'',statusLabel:g?.statusLabel||'',
      phaseState:g?.phaseState||'',phaseLabel:g?.phaseLabel||'',phaseConfidence:g?.phaseConfidence??null,
      confirmation:g?.confirmation??null,overheating:g?.overheating??null,projection:g?.projection||null,
      validCount:g?.validCount??0,memberCount:g?.memberCount??companyCount,coveragePct:g?.coveragePct??0,reliability:g?.reliability??0,
      dx3:g?.dx3??null,dy3:g?.dy3??null,leaders:Array.isArray(g?.leaders)?g.leaders.slice(0,5):[]
    };
  }).sort((a,b)=>{
    const order={'technology-fine':0,'traditional-coarse':1,'other':2};
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
function weightedMean(items,key){let sum=0,w=0;for(const item of items){const v=num(item[key]),ww=num(item.weight);if(v===null||ww===null||ww<=0)continue;sum+=v*ww;w+=ww;}return w?sum/w:null;}
function weightedMedian(items,key){
  const arr=items.map(x=>({v:num(x[key]),w:num(x.weight)})).filter(x=>x.v!==null&&x.w!==null&&x.w>0).sort((a,b)=>a.v-b.v);
  const total=arr.reduce((s,x)=>s+x.w,0);if(!total)return null;let c=0;for(const x of arr){c+=x.w;if(c>=total/2)return x.v;}return arr.at(-1)?.v??null;
}
function weightedShare(items,predicate){let yes=0,total=0;for(const item of items){const w=num(item.weight);if(w===null||w<=0)continue;total+=w;if(predicate(item))yes+=w;}return total?yes/total*100:null;}

// B — X is intentionally price-free. Price direction/persistence lives only on Y.
function scoreStocksForDate(rows){
  const r=rows.map(x=>({...x}));
  const fields=['value_ratio_20','value_trend_5_15','change_pct','return_3_pct','return_5_pct','return_20_pct'];
  const ranks={};for(const field of fields)ranks[field]=percentileRanks(r.map(x=>x[field]));
  return r.map((x,i)=>{
    const persistence=clamp((num(x.positive_days_5)??2.5)/5*100);
    const rankValueRatio20=ranks.value_ratio_20[i],rankValueTrend515=ranks.value_trend_5_15[i];
    const rankChangePct=ranks.change_pct[i],rankReturn3Pct=ranks.return_3_pct[i],rankReturn5Pct=ranks.return_5_pct[i],rankReturn20Pct=ranks.return_20_pct[i];
    const X=.55*rankValueRatio20+.45*rankValueTrend515;
    const Y=.10*rankChangePct+.25*rankReturn3Pct+.30*rankReturn5Pct+.20*rankReturn20Pct+.15*persistence;
    return {...x,stockX:clamp(X),stockY:clamp(Y),rankValueRatio20,rankValueTrend515,rankChangePct,rankReturn3Pct,rankReturn5Pct,rankReturn20Pct,persistenceScore:persistence};
  });
}

function buildProfileTagMap(profiles){
  const byCode=new Map(),tagMeta=new Map();
  for(const p of profiles||[]){
    const code=String(p.stock_code||p.symbol||'').trim();if(!code)continue;
    const resolved=resolveProfileBusinessTags({...p,stock_code:code});
    const links=marketTopicLinks(resolved.tags||[],resolved.name||p.stock_name||p.name||'',resolved.symbol||code,{main_business:p.main_business,auto_market_topics:p.auto_market_topics}).map(link=>{
      const out={...link,weight:importanceWeight(link.importance),scope:link.scope|| (link.technology?'technology-fine':'traditional-coarse'),parentName:link.parentName||''};
      if(!tagMeta.has(link.id))tagMeta.set(link.id,{tagId:link.id,name:link.name,parent:'',parentName:out.parentName,scope:out.scope,resolution:link.resolution||'market-topic',technology:Boolean(link.technology)});
      return out;
    });
    byCode.set(code,{...p,code,resolved,links});
  }
  const denominator=new Map();for(const profile of byCode.values())for(const link of profile.links){const cur=denominator.get(link.id)||{memberCount:0,totalWeight:0};cur.memberCount++;cur.totalWeight+=link.weight;denominator.set(link.id,cur);}
  return {byCode,tagMeta,denominator};
}
function tagItem(row,profile,link){return {...row,weight:link.weight,importance:link.importance,companyName:profile.stock_name||row.stock_name||'',market:profile.market||row.market||''};}

function summarizeTagItems(items,denom){
  const validCount=items.length,memberCount=Number(denom?.memberCount||validCount||0);if(!validCount)return null;
  const coveragePct=memberCount?validCount/memberCount*100:0;
  const xMedian=weightedMedian(items,'stockX')??50,xMean=weightedMean(items,'stockX')??50,yMedian=weightedMedian(items,'stockY')??50,yMean=weightedMean(items,'stockY')??50;
  const activityBreadth=weightedShare(items,x=>x.stockX>=60)??0,priceBreadth=weightedShare(items,x=>x.stockY>=60)??0,upBreadth=weightedShare(items,x=>(num(x.change_pct)??0)>0)??0;
  const baseX=.45*xMedian+.25*xMean+.30*activityBreadth;
  const baseY=.45*yMedian+.25*yMean+.20*priceBreadth+.10*upBreadth;
  const sampleReliability=Math.min(1,Math.sqrt(validCount/5)),coverageReliability=Math.min(1,coveragePct/80),reliability=sampleReliability*coverageReliability;
  const x=clamp(50+(baseX-50)*reliability),y=clamp(50+(baseY-50)*reliability);
  const breadths=[activityBreadth,priceBreadth,upBreadth],breadthAgreement=100-(Math.max(...breadths)-Math.min(...breadths));
  const confirmation=clamp(.55*(activityBreadth+priceBreadth+upBreadth)/3+.25*breadthAgreement+.20*(reliability*100));
  const factorSignals={
    x:{valueRatio20:round(weightedMean(items,'rankValueRatio20')??50),valueTrend515:round(weightedMean(items,'rankValueTrend515')??50)},
    y:{changePct:round(weightedMean(items,'rankChangePct')??50),return3Pct:round(weightedMean(items,'rankReturn3Pct')??50),return5Pct:round(weightedMean(items,'rankReturn5Pct')??50),return20Pct:round(weightedMean(items,'rankReturn20Pct')??50),persistence5:round(weightedMean(items,'persistenceScore')??50)}
  };
  return {memberCount,validCount,coveragePct:round(coveragePct),reliability:round(reliability*100),x:round(x,2),y:round(y,2),rawX:round(x,2),rawY:round(y,2),
    confirmation:round(confirmation),activityBreadth:round(activityBreadth),priceBreadth:round(priceBreadth),upBreadth:round(upBreadth),
    xMedian:round(xMedian,2),xMean:round(xMean,2),yMedian:round(yMedian,2),yMean:round(yMean,2),baseX:round(baseX,2),baseY:round(baseY,2),
    strongCount:items.filter(a=>a.stockX>=60||a.stockY>=60).length,factorSignals};
}
function collectTagItems(scoredRows,profileMaps,tagId){
  const items=[];for(const row of scoredRows){const code=String(row.stock_code||'').trim(),profile=profileMaps.byCode.get(code);if(!profile)continue;for(const link of profile.links){if(tagId&&link.id!==tagId)continue;items.push({tagId:link.id,item:tagItem(row,profile,link)});}}return items;
}
function aggregateTagDate(scoredRows,profileMaps,date){
  const groups=new Map();for(const pair of collectTagItems(scoredRows,profileMaps)){if(!groups.has(pair.tagId))groups.set(pair.tagId,[]);groups.get(pair.tagId).push(pair.item);}
  const out=[];for(const [tagId,items] of groups){const meta=profileMaps.tagMeta.get(tagId);if(!meta)continue;const denom=profileMaps.denominator.get(tagId)||{memberCount:items.length,totalWeight:items.reduce((s,x)=>s+x.weight,0)},summary=summarizeTagItems(items,denom);if(!summary)continue;
    const leaders=items.slice().sort((a,b)=>(b.stockX+b.stockY)-(a.stockX+a.stockY)).slice(0,5).map(a=>({code:String(a.stock_code),name:a.companyName||a.stock_name||'',market:a.market,x:round(a.stockX),y:round(a.stockY),changePct:round(num(a.change_pct)||0,2),return5Pct:round(num(a.return_5_pct)||0,2),valueRatio20:round(num(a.value_ratio_20)||0,2),importance:a.importance}));
    out.push({tradeDate:date,...meta,...summary,leaders});
  }return out;
}

function quadrant(x,y){if(x>=55&&y<50)return 'potential';if(x>=55&&y>=55)return 'mainline';if(x<50&&y>=55)return 'price-led';if(x<50&&y<50)return 'cold';return 'transition';}
function emaNext(prev,value,alpha=.5){const v=num(value);if(v===null)return prev??50;if(prev===null||prev===undefined)return v;return alpha*v+(1-alpha)*prev;}
function rawPhaseForPoint(p){
  const x=num(p.x)??50,y=num(p.y)??50,dx3=num(p.dx3)??0,dy3=num(p.dy3)??0,dx1=num(p.dx1)??0,dy1=num(p.dy1)??0,c=num(p.confirmation)??50,e=num(p.overheating)??0;
  let key='transition';
  if(y>=58&&((dx3<=-4&&dy3<0)||(e>=70&&dx1<0&&dy1<=0)))key='cooling';
  else if(y>=70&&e>=55)key='overheating';
  else if(x>=55&&y>=55&&c>=35)key='mainline';
  else if(x>=57&&y<58&&dx3>=-1&&dy3>=-8&&c>=30)key='potential';
  else if(y<58&&((x>=48&&dx3>2)||(x>=55&&dx1>0)))key='germination';
  else if(x<48&&y<50)key='cold';
  const m=phaseMeta(key);
  let confidence=45;
  if(key==='cold')confidence=clamp(45+(50-x)*1.2+(50-y)*.8);
  else if(key==='germination')confidence=clamp(45+Math.max(0,dx3)*4+Math.max(0,x-48)*1.3+c*.15);
  else if(key==='potential')confidence=clamp(48+Math.max(0,x-57)*1.2+Math.max(0,dy3+4)*1.4+c*.18-Math.max(0,y-58));
  else if(key==='mainline')confidence=clamp(48+(x-55)*.8+(y-55)*.8+c*.18-Math.max(0,e-65)*.3);
  else if(key==='overheating')confidence=clamp(45+(y-70)*1.2+e*.35);
  else if(key==='cooling')confidence=clamp(48+Math.max(0,-dx3)*3+Math.max(0,-dy3)*2+e*.25);
  else confidence=clamp(35+c*.2-Math.abs(dx3-dy3)*.4);
  return {key,label:m.label,confidence:round(confidence)};
}
function decorateDynamics(trajectory,{smooth=true}={}){
  let emaX=null,emaY=null;
  for(let i=0;i<trajectory.length;i++){
    const p=trajectory[i];
    p.rawX=num(p.rawX)??num(p.x)??50;p.rawY=num(p.rawY)??num(p.y)??50;
    if(smooth){emaX=emaNext(emaX,p.rawX,.5);emaY=emaNext(emaY,p.rawY,.5);p.x=round(emaX,2);p.y=round(emaY,2);}else{emaX=num(p.x)??50;emaY=num(p.y)??50;}
    const prev=trajectory[i-1]||p,p3=trajectory[Math.max(0,i-3)]||trajectory[0]||p,prev2=trajectory[i-2]||prev;
    p.dx1=round((num(p.x)??50)-(num(prev.x)??50),2);p.dy1=round((num(p.y)??50)-(num(prev.y)??50),2);
    p.dx3=round((num(p.x)??50)-(num(p3.x)??50),2);p.dy3=round((num(p.y)??50)-(num(p3.y)??50),2);
    const prevDx=(num(prev.x)??50)-(num(prev2.x)??50),prevDy=(num(prev.y)??50)-(num(prev2.y)??50);
    p.ddx1=round(p.dx1-prevDx,2);p.ddy1=round(p.dy1-prevDy,2);
    const heatLevel=clamp(((num(p.y)??50)-60)*2.5),capitalFade=clamp(50-p.dx3*5),priceFade=clamp(50-p.dy1*4);
    const breadthFade=clamp(50+((num(prev.priceBreadth)??num(p.priceBreadth)??50)-(num(p.priceBreadth)??50))*2);
    p.overheating=round(clamp(.55*heatLevel+.20*capitalFade+.15*priceFade+.10*breadthFade));
    p.confirmation=round(num(p.confirmation)??50);
    const raw=rawPhaseForPoint(p);p.rawPhaseState=raw.key;p.rawPhaseConfidence=raw.confidence;
  }
  // Two-session state stickiness; a very high-confidence reading may switch immediately.
  let confirmed=trajectory[0]?.rawPhaseState||'transition',candidate='',streak=0;
  for(const p of trajectory){
    if(p.rawPhaseState===confirmed){candidate='';streak=0;}
    else if(p.rawPhaseState===candidate)streak++;else{candidate=p.rawPhaseState;streak=1;}
    if(p.rawPhaseConfidence>=86||streak>=2){confirmed=p.rawPhaseState;candidate='';streak=0;}
    const meta=phaseMeta(confirmed);p.phaseState=confirmed;p.phaseLabel=meta.label;
    p.phaseConfidence=round(clamp(.72*p.rawPhaseConfidence+.28*(num(p.confirmation)??50)));
  }
  return trajectory;
}
function movementStatus(latest){
  const s=latest.phaseState||'transition';
  const labels={cold:'冷區',germination:'資金萌芽',potential:'潛伏準備攀升',mainline:'主升確認',overheating:'高檔過熱',cooling:'冷卻退潮',transition:'轉換／混沌'};
  return {key:s,label:labels[s]||'轉換／混沌'};
}
function attachTrajectories(rowsByDate,dates,{smooth=true}={}){
  const byTag=new Map();for(const date of dates)for(const row of rowsByDate.get(date)||[]){if(!byTag.has(row.tagId))byTag.set(row.tagId,[]);byTag.get(row.tagId).push(row);}
  const groups=[];
  for(const [tagId,trajectory] of byTag){
    trajectory.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));decorateDynamics(trajectory,{smooth});const latest=trajectory.at(-1);if(!latest)continue;
    const status=movementStatus(latest),q=quadrant(latest.x,latest.y);let rightMoves=0,totalMoves=0;
    for(let i=Math.max(1,trajectory.length-5);i<trajectory.length;i++){totalMoves++;if(trajectory[i].x>trajectory[i-1].x)rightMoves++;}
    const rightPersistence=totalMoves?rightMoves/totalMoves*100:0;
    const potentialScore=['germination','potential'].includes(latest.phaseState)?latest.x*.40+clamp(50+latest.dx3*4)*.20+clamp(50+latest.dy3*3)*.20+latest.confirmation*.20:0;
    const mainlineScore=latest.phaseState==='mainline'?latest.x*.30+latest.y*.35+latest.confirmation*.25+clamp(50+(latest.dx3+latest.dy3)*2)*.10:0;
    const coolingScore=['overheating','cooling'].includes(latest.phaseState)?latest.overheating*.45+clamp(50-latest.dx3*4)*.25+clamp(50-latest.dy3*3)*.20+(100-latest.confirmation)*.10:0;
    const rotationScore=latest.x*.25+latest.y*.15+clamp(50+latest.dx3*4)*.25+clamp(50+latest.dy3*3)*.20+rightPersistence*.15;
    groups.push({...latest,quadrant:q,status:status.key,statusLabel:status.label,dx1:latest.dx1,dy1:latest.dy1,dx3:latest.dx3,dy3:latest.dy3,ddx1:latest.ddx1,ddy1:latest.ddy1,
      rightPersistence:round(rightPersistence),potentialScore:round(potentialScore),mainlineScore:round(mainlineScore),coolingScore:round(coolingScore),rotationScore:round(rotationScore),
      trajectory:trajectory.map(p=>({date:p.tradeDate,x:round(p.x,2),y:round(p.y,2),rawX:round(p.rawX,2),rawY:round(p.rawY,2),confirmation:p.confirmation,overheating:p.overheating,
        phaseState:p.phaseState,phaseLabel:p.phaseLabel,phaseConfidence:p.phaseConfidence,dx1:p.dx1,dy1:p.dy1,dx3:p.dx3,dy3:p.dy3,ddx1:p.ddx1,ddy1:p.ddy1,
        activityBreadth:p.activityBreadth,priceBreadth:p.priceBreadth,upBreadth:p.upBreadth,validCount:p.validCount,reliability:p.reliability,factors:p.factorSignals||p.factors||{}}))});
  }return groups;
}

const FALLBACK_VECTOR=Object.freeze({
  cold:{dx:1,dy:1},germination:{dx:5,dy:2},potential:{dx:4,dy:6},mainline:{dx:2,dy:4},overheating:{dx:-2,dy:1},cooling:{dx:-6,dy:-5},transition:{dx:0,dy:0}
});
function buildTransitionCalibration(groups){
  const horizons=[3,5,10],buckets={};let sampleCount=0;const dateSet=new Set();
  for(const g of groups||[])for(const p of g.trajectory||[])dateSet.add(p.date);
  for(const phase of Object.keys(PHASES)){buckets[phase]={};for(const h of horizons)buckets[phase][h]=[];}
  for(const g of groups||[]){const t=g.trajectory||[];for(let i=0;i<t.length;i++){const s=t[i].phaseState||'transition';for(const h of horizons){if(i+h>=t.length)continue;buckets[s]??={};buckets[s][h]??=[];buckets[s][h].push({dx:t[i+h].x-t[i].x,dy:t[i+h].y-t[i].y});sampleCount++;}}}
  const stats={};for(const [state,byH] of Object.entries(buckets)){stats[state]={};for(const [h,arr] of Object.entries(byH)){const dx=arr.map(x=>x.dx),dy=arr.map(x=>x.dy);stats[state][h]={n:arr.length,medianDx:round(median(dx)??0,2),medianDy:round(median(dy)??0,2),q20Dx:round(quantile(dx,.2)??0,2),q80Dx:round(quantile(dx,.8)??0,2),q20Dy:round(quantile(dy,.2)??0,2),q80Dy:round(quantile(dy,.8)??0,2)};}}
  const historyDays=dateSet.size,maturityPct=round(clamp((historyDays-10)/50*100));
  return {historyDays,maturityPct,sampleCount,horizons,stats};
}
function directionLabel(dx,dy){if(dx>=1.5&&dy>=1.5)return '右上';if(dx>=1.5&&dy<=-1.5)return '右下';if(dx<=-1.5&&dy>=1.5)return '左上';if(dx<=-1.5&&dy<=-1.5)return '左下';if(dx>=1.5)return '向右';if(dx<=-1.5)return '向左';if(dy>=1.5)return '向上';if(dy<=-1.5)return '向下';return '盤整';}
function projectGroup(group,calibration){
  const state=group.phaseState||'transition',fallback=FALLBACK_VECTOR[state]||FALLBACK_VECTOR.transition,points=[];
  for(const h of [3,5,10]){
    const st=calibration?.stats?.[state]?.[h]||{n:0,medianDx:0,medianDy:0,q20Dx:0,q80Dx:0,q20Dy:0,q80Dy:0};
    const histW=Math.min(.62,Number(st.n||0)/80),trendW=.24,stateW=1-histW-trendW;
    const trendDx=clamp((num(group.dx3)??0)/3*h,-24,24),trendDy=clamp((num(group.dy3)??0)/3*h,-24,24);
    const stateScale=h/3,confidenceScale=.55+.45*(num(group.phaseConfidence)??50)/100;
    let dx=(histW*(num(st.medianDx)??0)+trendW*trendDx+stateW*fallback.dx*stateScale)*confidenceScale;
    let dy=(histW*(num(st.medianDy)??0)+trendW*trendDy+stateW*fallback.dy*stateScale)*confidenceScale;
    dx=clamp(dx,-28,28);dy=clamp(dy,-28,28);
    const baseUnc=Math.max(4,12*(h/5))*(1-(num(group.phaseConfidence)??50)/140);
    const qLowX=st.n>=5?num(st.q20Dx):dx-baseUnc,qHighX=st.n>=5?num(st.q80Dx):dx+baseUnc;
    const qLowY=st.n>=5?num(st.q20Dy):dy-baseUnc,qHighY=st.n>=5?num(st.q80Dy):dy+baseUnc;
    points.push({horizon:h,x:round(clamp(group.x+dx),2),y:round(clamp(group.y+dy),2),dx:round(dx,2),dy:round(dy,2),sampleN:Number(st.n||0),
      lowX:round(clamp(group.x+(qLowX??dx-baseUnc)),2),highX:round(clamp(group.x+(qHighX??dx+baseUnc)),2),lowY:round(clamp(group.y+(qLowY??dy-baseUnc)),2),highY:round(clamp(group.y+(qHighY??dy+baseUnc)),2)});
  }
  const maturity=num(calibration?.maturityPct)??0,sampleN=points.find(p=>p.horizon===5)?.sampleN||0;
  let confidence=clamp(.35*(num(group.phaseConfidence)??50)+.25*(num(group.confirmation)??50)+.25*maturity+.15*clamp(sampleN/50*100));
  if((calibration?.historyDays||0)<30)confidence=Math.min(confidence,68);
  const p5=points.find(p=>p.horizon===5)||points[0],label=directionLabel(p5?.dx||0,p5?.dy||0);
  let tendency='方向未明';
  if(['germination','potential'].includes(state)&&p5.dx>0&&p5.dy>0)tendency='準備攀升';
  else if(state==='mainline'&&p5.dy>=0)tendency='主升延續';
  else if(state==='overheating'&&(p5.dx<0||p5.dy<0))tendency='過熱鈍化';
  else if(state==='cooling')tendency='冷卻退潮';
  else if(p5.dx>1&&p5.dy>1)tendency='同步轉強';
  else if(p5.dx<-1&&p5.dy<-1)tendency='同步轉弱';
  return {mode:'model-tendency',state,stateLabel:phaseMeta(state).label,tendency,direction:label,confidence:round(confidence),historyDays:calibration?.historyDays||0,maturityPct:maturity,points,
    caution:'扇形是依目前狀態、速度與歷史同狀態轉態統計形成的不確定範圍，不是未來股價或座標保證。'};
}
function decorateProjections(groups,calibration){for(const g of groups||[])g.projection=projectGroup(g,calibration);return groups;}

function computeBusinessFlow(profiles,activityRows,{maxDates=DEFAULT_TRAJECTORY_DAYS}={}){
  const dates=[...new Set((activityRows||[]).map(r=>isoDate(r.trade_date)).filter(Boolean))].sort().slice(-maxDates),dateSet=new Set(dates),profileMaps=buildProfileTagMap(profiles||[]),byDateRows=new Map(dates.map(d=>[d,[]]));
  for(const row of activityRows||[]){const d=isoDate(row.trade_date);if(dateSet.has(d))byDateRows.get(d).push(row);}
  const aggregated=new Map();for(const date of dates){const scored=scoreStocksForDate(byDateRows.get(date)||[]);aggregated.set(date,aggregateTagDate(scored,profileMaps,date));}
  const groups=attachTrajectories(aggregated,dates,{smooth:true}),calibration=buildTransitionCalibration(groups);decorateProjections(groups,calibration);
  return {dates,groups,profileMaps,aggregated,calibration};
}

function computeTagDetail(profiles,activityRows,tagId,{maxDates=10}={}){
  const cleanTag=String(tagId||'').trim();if(!cleanTag)throw new Error('缺少業務 tag');
  const dates=[...new Set((activityRows||[]).map(r=>isoDate(r.trade_date)).filter(Boolean))].sort().slice(-Math.max(5,Math.min(ENGINE_HISTORY_DAYS,Number(maxDates)||10))),dateSet=new Set(dates),profileMaps=buildProfileTagMap(profiles||[]),meta=profileMaps.tagMeta.get(cleanTag);if(!meta)throw new Error('找不到業務標籤');
  const denom=profileMaps.denominator.get(cleanTag)||{memberCount:0,totalWeight:0},byDateRows=new Map(dates.map(d=>[d,[]])),rowsByDate=new Map(dates.map(d=>[d,[]]));
  for(const row of activityRows||[]){const d=isoDate(row.trade_date);if(dateSet.has(d))byDateRows.get(d).push(row);}
  let latestItems=[],latestRawSummary=null;
  for(const date of dates){const scored=scoreStocksForDate(byDateRows.get(date)||[]),items=collectTagItems(scored,profileMaps,cleanTag).map(x=>x.item),summary=summarizeTagItems(items,denom);if(!summary)continue;rowsByDate.get(date).push({tradeDate:date,...meta,...summary,leaders:[]});latestItems=items;latestRawSummary=summary;}
  const allGroups=attachTrajectories(rowsByDate,dates,{smooth:true}),g=allGroups.find(x=>x.tagId===cleanTag);if(!g||!latestRawSummary)throw new Error('此業務尚無可用 XY 明細');
  const calibration=buildTransitionCalibration(allGroups),projection=projectGroup(g,calibration),trajectory=g.trajectory.slice(-Math.max(5,Math.min(15,Number(maxDates)||10))),latestPoint=trajectory.at(-1)||g;
  const companies=latestItems.map((item,idx)=>{const reducedItems=latestItems.filter((_,i)=>i!==idx),reduced=summarizeTagItems(reducedItems,denom),withoutX=reduced?.x??50,withoutY=reduced?.y??50,impactX=latestRawSummary.x-withoutX,impactY=latestRawSummary.y-withoutY;return {
    code:String(item.stock_code||''),name:item.companyName||item.stock_name||'',market:item.market||'',importance:item.importance||'related',weight:round(item.weight,2),stockX:round(item.stockX),stockY:round(item.stockY),impactX:round(impactX,2),impactY:round(impactY,2),impactScore:round(Math.abs(impactX)+Math.abs(impactY),2),
    valueRatio20:round(num(item.value_ratio_20)||0,2),valueTrend515:round(num(item.value_trend_5_15)||0,2),positiveDays5:num(item.positive_days_5)??0,changePct:round(num(item.change_pct)||0,2),return3Pct:round(num(item.return_3_pct)||0,2),return5Pct:round(num(item.return_5_pct)||0,2),return20Pct:round(num(item.return_20_pct)||0,2)
  };}).sort((a,b)=>b.impactScore-a.impactScore||((b.stockX+b.stockY)-(a.stockX+a.stockY)));
  const latestFactors=latestPoint?.factors||{};
  const enrichedTrajectory=trajectory.map(p=>({...p,factors:p.factors||{}}));
  return {ok:true,engineVersion:ENGINE_VERSION,tagId:cleanTag,name:meta.name,parentName:meta.parentName||'',scope:meta.scope,asOf:latestPoint.date,trajectoryDays:enrichedTrajectory.length,trajectory:enrichedTrajectory,
    latest:{x:g.x,y:g.y,rawX:g.rawX,rawY:g.rawY,quadrant:g.quadrant,status:g.status,statusLabel:g.statusLabel,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,confirmation:g.confirmation,overheating:g.overheating,
      dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1,memberCount:g.memberCount,validCount:g.validCount,coveragePct:g.coveragePct,reliability:g.reliability,activityBreadth:g.activityBreadth,priceBreadth:g.priceBreadth,upBreadth:g.upBreadth,factors:latestFactors,
      groupBuild:{xMedian:latestRawSummary.xMedian,xMean:latestRawSummary.xMean,activityBreadth:latestRawSummary.activityBreadth,yMedian:latestRawSummary.yMedian,yMean:latestRawSummary.yMean,priceBreadth:latestRawSummary.priceBreadth,upBreadth:latestRawSummary.upBreadth,reliability:latestRawSummary.reliability}},
    projection,calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount},companies,
    methodology:{impact:'公司貢獻＝移除該公司後重新計算當日原始業務座標，與完整原始座標的差。',factor:'因子熱度為該業務成員的加權全市場百分位平均，50 約為中性。',projection:'扇形是狀態＋速度＋歷史同狀態轉態分布的不確定範圍，不是未來保證。'}};
}

async function ensureBusinessFlowSchema(sql=getSql()){
  if(schemaReady)return;
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy_daily (
      trade_date date NOT NULL,tag_id text NOT NULL,tag_name text NOT NULL,parent_name text,scope text NOT NULL,
      member_count integer NOT NULL,valid_count integer NOT NULL,coverage_pct numeric,reliability_pct numeric,
      x_score numeric,y_score numeric,raw_x_score numeric,raw_y_score numeric,confirmation_score numeric,overheating_score numeric,
      phase_state text,phase_label text,phase_confidence numeric,activity_breadth numeric,price_breadth numeric,up_breadth numeric,strong_count integer,
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
  ])await sql.query(stmt);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_date_idx ON market_business_xy_daily (trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_scope_date_idx ON market_business_xy_daily (scope,trade_date DESC)`);schemaReady=true;
}
async function loadEngineInputs(sql,trajectoryDays){
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);
  const dateRows=await sql.query(`SELECT trade_date FROM market_activity_daily WHERE activity_ready IS TRUE AND market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2 ORDER BY trade_date DESC LIMIT $1`,[trajectoryDays]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!dates.length)return {profiles,dates,activityRows:[]};
  const activityRows=await sql.query(`SELECT trade_date,stock_code,stock_name,market,trade_value,change_pct,value_ratio_20,value_trend_5_15,up_value_share_5,positive_days_5,return_3_pct,return_5_pct,return_20_pct FROM market_activity_daily WHERE activity_ready IS TRUE AND trade_date >= $1::date AND trade_date <= $2::date AND market IN ('上市','上櫃') ORDER BY trade_date,stock_code`,[dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:activityRows.filter(x=>dates.includes(isoDate(x.trade_date)))};
}
async function refreshBusinessFlowDaily({trajectoryDays=ENGINE_HISTORY_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  // v2.6.2.28 B: an upgraded engine needs return_3_pct on legacy activity rows too.
  // Only trigger the heavier factor refresh when a ready row is still missing the new factor.
  const factorState=await sql.query(`SELECT EXISTS(SELECT 1 FROM market_activity_daily WHERE activity_ready IS TRUE AND return_3_pct IS NULL LIMIT 1) AS needs_return3`);
  if(factorState?.[0]?.needs_return3){
    const {refreshMarketActivityFactors}=require('./sync-common');
    await refreshMarketActivityFactors();
  }
  const input=await loadEngineInputs(sql,trajectoryDays);if(!input.dates.length)return {ok:false,reason:'no-ready-activity-dates',dates:0,rows:0};
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:trajectoryDays}),payload=[];
  for(const date of computed.dates)for(const row of computed.aggregated.get(date)||[])payload.push({trade_date:date,tag_id:row.tagId,tag_name:row.name,parent_name:row.parentName||null,scope:row.scope,member_count:row.memberCount,valid_count:row.validCount,coverage_pct:row.coveragePct,reliability_pct:row.reliability,x_score:row.x,y_score:row.y,raw_x_score:row.rawX,raw_y_score:row.rawY,confirmation_score:row.confirmation,overheating_score:row.overheating,phase_state:row.phaseState,phase_label:row.phaseLabel,phase_confidence:row.phaseConfidence,activity_breadth:row.activityBreadth,price_breadth:row.priceBreadth,up_breadth:row.upBreadth,strong_count:row.strongCount,leaders:row.leaders,engine_version:ENGINE_VERSION});
  if(!payload.length)return {ok:false,reason:'no-business-groups',dates:computed.dates.length,rows:0};
  await sql.query(`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(trade_date date,tag_id text,tag_name text,parent_name text,scope text,member_count integer,valid_count integer,coverage_pct numeric,reliability_pct numeric,x_score numeric,y_score numeric,raw_x_score numeric,raw_y_score numeric,confirmation_score numeric,overheating_score numeric,phase_state text,phase_label text,phase_confidence numeric,activity_breadth numeric,price_breadth numeric,up_breadth numeric,strong_count integer,leaders jsonb,engine_version text)),
    refreshed_dates AS (SELECT DISTINCT trade_date FROM incoming), deleted AS (DELETE FROM market_business_xy_daily b WHERE b.trade_date IN (SELECT trade_date FROM refreshed_dates) AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.trade_date=b.trade_date AND i.tag_id=b.tag_id) RETURNING 1)
    INSERT INTO market_business_xy_daily (trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,price_breadth,up_breadth,strong_count,leaders,engine_version,updated_at)
    SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,price_breadth,up_breadth,strong_count,leaders,engine_version,NOW() FROM incoming
    ON CONFLICT (trade_date,tag_id) DO UPDATE SET tag_name=EXCLUDED.tag_name,parent_name=EXCLUDED.parent_name,scope=EXCLUDED.scope,member_count=EXCLUDED.member_count,valid_count=EXCLUDED.valid_count,coverage_pct=EXCLUDED.coverage_pct,reliability_pct=EXCLUDED.reliability_pct,x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,raw_x_score=EXCLUDED.raw_x_score,raw_y_score=EXCLUDED.raw_y_score,confirmation_score=EXCLUDED.confirmation_score,overheating_score=EXCLUDED.overheating_score,phase_state=EXCLUDED.phase_state,phase_label=EXCLUDED.phase_label,phase_confidence=EXCLUDED.phase_confidence,activity_breadth=EXCLUDED.activity_breadth,price_breadth=EXCLUDED.price_breadth,up_breadth=EXCLUDED.up_breadth,strong_count=EXCLUDED.strong_count,leaders=EXCLUDED.leaders,engine_version=EXCLUDED.engine_version,updated_at=NOW()
  `,[JSON.stringify(payload)]);
  memoryCache=null;return {ok:true,engineVersion:ENGINE_VERSION,dates:computed.dates.length,rows:payload.length,latestTradeDate:computed.dates.at(-1),profileRows:input.profiles.length,activityRows:input.activityRows.length,calibration:{historyDays:computed.calibration.historyDays,maturityPct:computed.calibration.maturityPct,sampleCount:computed.calibration.sampleCount}};
}
async function needsRefresh(sql){
  await ensureBusinessFlowSchema(sql);const rows=await sql.query(`SELECT (SELECT MAX(trade_date) FROM (SELECT trade_date FROM market_activity_daily WHERE activity_ready IS TRUE AND market IN ('上市','上櫃') GROUP BY trade_date HAVING COUNT(DISTINCT market)=2) d) AS activity_date,(SELECT MAX(trade_date) FROM market_business_xy_daily WHERE engine_version=$1) AS xy_date,(SELECT COUNT(*)::int FROM market_business_xy_daily WHERE engine_version=$1) AS xy_rows`,[ENGINE_VERSION]);const r=rows[0]||{};return !Number(r.xy_rows||0)||isoDate(r.xy_date)!==isoDate(r.activity_date);
}
function hydrateStoredRows(rows,dates){
  const byDate=new Map(dates.map(d=>[d,[]]));for(const r of rows){const d=isoDate(r.trade_date);if(!byDate.has(d))continue;byDate.get(d).push({tradeDate:d,tagId:r.tag_id,name:r.tag_name,parentName:r.parent_name||'',scope:r.scope,memberCount:Number(r.member_count||0),validCount:Number(r.valid_count||0),coveragePct:num(r.coverage_pct)||0,reliability:num(r.reliability_pct)||0,x:num(r.x_score)||50,y:num(r.y_score)||50,rawX:num(r.raw_x_score)??num(r.x_score)??50,rawY:num(r.raw_y_score)??num(r.y_score)??50,confirmation:num(r.confirmation_score)||50,overheating:num(r.overheating_score)||0,phaseState:r.phase_state||'',phaseLabel:r.phase_label||'',phaseConfidence:num(r.phase_confidence)||50,activityBreadth:num(r.activity_breadth)||0,priceBreadth:num(r.price_breadth)||0,upBreadth:num(r.up_breadth)||0,strongCount:Number(r.strong_count||0),leaders:Array.isArray(r.leaders)?r.leaders:[]});}
  return attachTrajectories(byDate,dates,{smooth:false});
}
function scopeCounts(groups){const out={'technology-fine':0,'traditional-coarse':0,'other':0};for(const g of groups)out[g.scope]=(out[g.scope]||0)+1;return out;}
function trimGroup(g,days){return {...g,trajectory:(g.trajectory||[]).slice(-days)};}

async function getFundflowSnapshot({days=10,force=false}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),now=Date.now();
  if(!force&&memoryCache&&memoryCache.days===bounded&&now-memoryCache.savedAt<120000)return memoryCache.value;
  if(force||await needsRefresh(sql))await refreshBusinessFlowDaily({trajectoryDays:ENGINE_HISTORY_DAYS,sql});
  const dateRows=await sql.query(`SELECT DISTINCT trade_date FROM market_business_xy_daily WHERE engine_version=$1 ORDER BY trade_date DESC LIMIT $2`,[ENGINE_VERSION,ENGINE_HISTORY_DAYS]);
  const allDates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();if(!allDates.length)throw new Error('XY 尚無可用 activity_ready 交易日');
  const rows=await sql.query(`SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,raw_x_score,raw_y_score,confirmation_score,overheating_score,phase_state,phase_label,phase_confidence,activity_breadth,price_breadth,up_breadth,strong_count,leaders FROM market_business_xy_daily WHERE engine_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date ORDER BY trade_date,tag_id`,[ENGINE_VERSION,allDates[0],allDates.at(-1)]);
  const fullGroups=hydrateStoredRows(rows,allDates),calibration=buildTransitionCalibration(fullGroups);decorateProjections(fullGroups,calibration);const groups=fullGroups.map(g=>trimGroup(g,bounded));
  const eligible=g=>g.validCount>=2&&g.trajectory.length>=2;
  const rising=groups.filter(g=>eligible(g)&&['germination','potential'].includes(g.phaseState)&&g.projection?.points?.find(p=>p.horizon===5)?.dy>0).sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,10);
  const mainline=groups.filter(g=>eligible(g)&&g.phaseState==='mainline').sort((a,b)=>b.mainlineScore-a.mainlineScore).slice(0,10);
  const cooling=groups.filter(g=>eligible(g)&&['overheating','cooling'].includes(g.phaseState)).sort((a,b)=>b.coolingScore-a.coolingScore).slice(0,10);
  const rightMoving=groups.filter(g=>eligible(g)&&g.dx3>1).sort((a,b)=>b.rotationScore-a.rotationScore).slice(0,10);
  const value={ok:true,engineVersion:ENGINE_VERSION,asOf:allDates.at(-1),trajectoryDates:allDates.slice(-bounded),trajectoryDays:Math.min(bounded,allDates.length),
    axes:{x:'資金活動度',y:'市場價格強度',center:50,potentialX:55,mainline:55},
    methodology:{stockX:'55% 20日成交值異常＋45% 5/15日成交值趨勢；兩者採全市場百分位。X 不再混入價格方向。',stockY:'10% 當日漲跌＋25% 3日報酬＋30% 5日報酬＋20% 20日報酬＋15% 近5日上漲持續性；價格因子採全市場百分位。',group:'業務座標採加權中位數／平均＋族群廣度，小樣本向 50 收縮；座標用 3 交易日 EMA 平滑。',phase:'C＝族群同步確認度；E＝高檔過熱／衰竭度；Phase 另結合 ΔX/ΔY 與加速度並使用兩日狀態黏性。',projection:'Phase、ΔXY 與歷史同狀態轉態分布形成模型傾向；點開題材顯示不確定扇形。',caution:'X 是成交活動／參與度，不是券商分點或逐筆成交推算的「淨流入」；扇形不是未來保證。'},
    calibration:{historyDays:calibration.historyDays,maturityPct:calibration.maturityPct,sampleCount:calibration.sampleCount,warmup:calibration.historyDays<30},
    counts:{groups:groups.length,byScope:scopeCounts(groups),rising:rising.length,mainline:mainline.length,cooling:cooling.length},
    picks:{rising,potential:rising,mainline,cooling,rightMoving,retreat:cooling},groups};
  memoryCache={days:bounded,savedAt:now,value};return value;
}
async function getFundflowBusinessBrowser({days=10}={}){const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10)),snapshot=await getFundflowSnapshot({days:bounded,force:false}),profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry,auto_business_tags,auto_market_topics,main_business,business_enrich_status,business_enrich_version,business_enrich_checked_at FROM market_company_profile ORDER BY stock_code`);return buildBusinessBrowserCatalog(profiles,snapshot);}
async function getFundflowDetail({tagId,days=10}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);const bounded=Math.max(5,Math.min(15,Number(days)||10));if(await needsRefresh(sql))await refreshBusinessFlowDaily({trajectoryDays:ENGINE_HISTORY_DAYS,sql});
  const [input,snapshot]=await Promise.all([loadEngineInputs(sql,ENGINE_HISTORY_DAYS),getFundflowSnapshot({days:bounded,force:false})]);if(!input.dates.length)throw new Error('XY 尚無可用 activity_ready 交易日');
  const detail=computeTagDetail(input.profiles,input.activityRows,tagId,{maxDates:bounded}),g=(snapshot.groups||[]).find(x=>x.tagId===tagId);if(g){detail.latest={...detail.latest,phaseState:g.phaseState,phaseLabel:g.phaseLabel,phaseConfidence:g.phaseConfidence,confirmation:g.confirmation,overheating:g.overheating,dx1:g.dx1,dy1:g.dy1,dx3:g.dx3,dy3:g.dy3,ddx1:g.ddx1,ddy1:g.ddy1};detail.projection=g.projection||detail.projection;detail.calibration=snapshot.calibration||detail.calibration;}return detail;
}

module.exports={ENGINE_VERSION,DEFAULT_TRAJECTORY_DAYS,ENGINE_HISTORY_DAYS,PHASES,percentileRanks,scoreStocksForDate,computeBusinessFlow,computeTagDetail,quadrant,buildTransitionCalibration,projectGroup,ensureBusinessFlowSchema,refreshBusinessFlowDaily,getFundflowSnapshot,getFundflowDetail,getFundflowBusinessBrowser,buildBusinessBrowserCatalog};
