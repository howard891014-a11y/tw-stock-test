// StockZone v2.6.2.24 — Business Fund-Flow XY Engine v1
// X = capital activity / accumulation pressure (price-light by design)
// Y = market price strength / confirmation
// Coordinates are percentile-normalized across the whole listed+OTC company universe,
// then aggregated by vote-eligible business tag with breadth and small-sample shrinkage.

function getSql(){ return require('./db').getSql(); }
const { resolveCompanyBusinessTags } = require('./company-business-tags');
const { getTag } = require('./business-tags');

const ENGINE_VERSION = 'xy-1.0.0';
const DEFAULT_TRAJECTORY_DAYS = 15;
const IMPORTANCE_WEIGHT = Object.freeze({ core:1, important:0.85, related:0.65 });
let schemaReady = false;
let memoryCache = null;

function num(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function clamp(v,lo=0,hi=100){return Math.max(lo,Math.min(hi,v));}
function round(v,d=1){const p=10**d;return Math.round((Number(v)||0)*p)/p;}
function isoDate(v){
  if(!v)return '';
  if(typeof v==='string')return v.slice(0,10);
  if(v instanceof Date && Number.isFinite(v.getTime()))return v.toISOString().slice(0,10);
  return String(v).slice(0,10);
}
function importanceWeight(v){return IMPORTANCE_WEIGHT[String(v||'related')]||0.65;}

function percentileRanks(values){
  const usable=values.map((v,i)=>({v:num(v),i})).filter(x=>x.v!==null).sort((a,b)=>a.v-b.v);
  const out=new Array(values.length).fill(50);
  const n=usable.length;
  if(!n)return out;
  if(n===1){out[usable[0].i]=50;return out;}
  let p=0;
  while(p<n){
    let q=p+1;
    while(q<n&&usable[q].v===usable[p].v)q++;
    const mid=(p+q-1)/2;
    const score=mid/(n-1)*100;
    for(let k=p;k<q;k++)out[usable[k].i]=score;
    p=q;
  }
  return out;
}

function weightedMean(items,key){
  let sum=0,w=0;
  for(const item of items){const v=num(item[key]),ww=num(item.weight);if(v===null||ww===null||ww<=0)continue;sum+=v*ww;w+=ww;}
  return w?sum/w:null;
}
function weightedMedian(items,key){
  const arr=items.map(x=>({v:num(x[key]),w:num(x.weight)})).filter(x=>x.v!==null&&x.w!==null&&x.w>0).sort((a,b)=>a.v-b.v);
  const total=arr.reduce((s,x)=>s+x.w,0);if(!total)return null;
  let c=0;for(const x of arr){c+=x.w;if(c>=total/2)return x.v;}return arr.at(-1)?.v??null;
}
function weightedShare(items,predicate){
  let yes=0,total=0;
  for(const item of items){const w=num(item.weight);if(w===null||w<=0)continue;total+=w;if(predicate(item))yes+=w;}
  return total?yes/total*100:null;
}

function scoreStocksForDate(rows){
  const r=rows.map(x=>({...x}));
  const fields=['value_ratio_20','value_trend_5_15','up_value_share_5','change_pct','return_5_pct','return_20_pct'];
  const ranks={};
  for(const field of fields)ranks[field]=percentileRanks(r.map(x=>x[field]));
  return r.map((x,i)=>{
    const persistence=clamp((num(x.positive_days_5)??2.5)/5*100);
    const X=.35*ranks.value_ratio_20[i]+.30*ranks.value_trend_5_15[i]+.20*ranks.up_value_share_5[i]+.15*persistence;
    const Y=.25*ranks.change_pct[i]+.35*ranks.return_5_pct[i]+.20*ranks.return_20_pct[i]+.20*persistence;
    return {...x,stockX:clamp(X),stockY:clamp(Y)};
  });
}

function classifyScope(link){
  if(link?.technology)return link?.resolution==='fallback'?'technology-fallback':'technology-fine';
  return 'traditional-coarse';
}
function buildProfileTagMap(profiles){
  const byCode=new Map(),tagMeta=new Map();
  for(const p of profiles||[]){
    const code=String(p.stock_code||p.symbol||'').trim();if(!code)continue;
    const resolved=resolveCompanyBusinessTags({
      stock_code:code,stock_name:p.stock_name,name:p.stock_name,market:p.market,
      industry_code:p.industry_code,industry:p.industry
    });
    const links=resolved.tags.map(link=>{
      const meta=getTag(link.id);
      const out={...link,weight:importanceWeight(link.importance),scope:classifyScope(link),parentName:meta?.parent?getTag(meta.parent)?.name||'':''};
      if(!tagMeta.has(link.id))tagMeta.set(link.id,{tagId:link.id,name:link.name,parent:link.parent,parentName:out.parentName,scope:out.scope,resolution:link.resolution,technology:Boolean(link.technology)});
      return out;
    });
    byCode.set(code,{...p,code,resolved,links});
  }
  const denominator=new Map();
  for(const profile of byCode.values())for(const link of profile.links){
    const cur=denominator.get(link.id)||{memberCount:0,totalWeight:0};cur.memberCount++;cur.totalWeight+=link.weight;denominator.set(link.id,cur);
  }
  return {byCode,tagMeta,denominator};
}

function aggregateTagDate(scoredRows,profileMaps,date){
  const groups=new Map();
  for(const row of scoredRows){
    const code=String(row.stock_code||'').trim(),profile=profileMaps.byCode.get(code);if(!profile)continue;
    for(const link of profile.links){
      let g=groups.get(link.id);
      if(!g){g={tagId:link.id,items:[]};groups.set(link.id,g);}
      g.items.push({...row,weight:link.weight,importance:link.importance,companyName:profile.stock_name||row.stock_name||'',market:profile.market||row.market||''});
    }
  }
  const out=[];
  for(const [tagId,g] of groups){
    const meta=profileMaps.tagMeta.get(tagId);if(!meta)continue;
    const denom=profileMaps.denominator.get(tagId)||{memberCount:g.items.length,totalWeight:g.items.reduce((s,x)=>s+x.weight,0)};
    const validCount=g.items.length,memberCount=denom.memberCount||validCount;
    if(!validCount)continue;
    const coveragePct=memberCount?validCount/memberCount*100:0;
    const xMedian=weightedMedian(g.items,'stockX')??50,xMean=weightedMean(g.items,'stockX')??50;
    const yMedian=weightedMedian(g.items,'stockY')??50,yMean=weightedMean(g.items,'stockY')??50;
    const activityBreadth=weightedShare(g.items,x=>x.stockX>=60)??0;
    const priceBreadth=weightedShare(g.items,x=>x.stockY>=60)??0;
    const upBreadth=weightedShare(g.items,x=>(num(x.change_pct)??0)>0)??0;
    const baseX=.55*xMedian+.25*xMean+.20*activityBreadth;
    const baseY=.50*yMedian+.25*yMean+.15*priceBreadth+.10*upBreadth;
    const sampleReliability=Math.min(1,Math.sqrt(validCount/5));
    const coverageReliability=Math.min(1,coveragePct/80);
    const reliability=sampleReliability*coverageReliability;
    const x=clamp(50+(baseX-50)*reliability),y=clamp(50+(baseY-50)*reliability);
    const leaders=g.items.slice().sort((a,b)=>(b.stockX+b.stockY)-(a.stockX+a.stockY)).slice(0,5).map(a=>({
      code:String(a.stock_code),name:a.companyName||a.stock_name||'',market:a.market,
      x:round(a.stockX),y:round(a.stockY),changePct:round(num(a.change_pct)||0,2),return5Pct:round(num(a.return_5_pct)||0,2),
      valueRatio20:round(num(a.value_ratio_20)||0,2),importance:a.importance
    }));
    out.push({
      tradeDate:date,...meta,memberCount,validCount,coveragePct:round(coveragePct),reliability:round(reliability*100),
      x:round(x,2),y:round(y,2),activityBreadth:round(activityBreadth),priceBreadth:round(priceBreadth),upBreadth:round(upBreadth),
      strongCount:g.items.filter(a=>a.stockX>=60||a.stockY>=60).length,leaders
    });
  }
  return out;
}

function quadrant(x,y){
  if(x>=55&&y<50)return 'potential';
  if(x>=55&&y>=55)return 'mainline';
  if(x<50&&y>=55)return 'price-led';
  if(x<50&&y<50)return 'cold';
  return 'transition';
}
function movementStatus(latest,trajectory){
  const p3=trajectory[Math.max(0,trajectory.length-4)]||trajectory[0]||latest;
  const dx3=latest.x-p3.x,dy3=latest.y-p3.y;
  const q=quadrant(latest.x,latest.y);
  if(q==='potential'&&dx3>=3)return {key:'potential-rising',label:'潛伏升溫'};
  if(q==='potential')return {key:'potential',label:'資金潛伏'};
  if(q==='mainline'&&dx3>=2&&dy3>=2)return {key:'mainline-accelerating',label:'主線加速'};
  if(q==='mainline'&&dx3<=-3)return {key:'mainline-fading',label:'高檔退潮'};
  if(q==='mainline')return {key:'mainline',label:'主線確認'};
  if(q==='price-led')return {key:'price-led',label:'價格領先'};
  if(q==='cold'&&dx3>=4)return {key:'early-rotation',label:'冷區右移'};
  if(q==='cold')return {key:'cold',label:'冷區'};
  return dx3>=3?{key:'rotating-right',label:'資金右移'}:dy3>=3?{key:'strengthening',label:'價格轉強'}:{key:'transition',label:'轉換區'};
}

function attachTrajectories(rowsByDate,dates){
  const byTag=new Map();
  for(const date of dates){
    for(const row of rowsByDate.get(date)||[]){
      if(!byTag.has(row.tagId))byTag.set(row.tagId,[]);
      byTag.get(row.tagId).push(row);
    }
  }
  const groups=[];
  for(const [tagId,trajectory] of byTag){
    trajectory.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));
    const latest=trajectory.at(-1);if(!latest)continue;
    const prev=trajectory.at(-2)||latest,p3=trajectory[Math.max(0,trajectory.length-4)]||trajectory[0]||latest;
    const dx1=latest.x-prev.x,dy1=latest.y-prev.y,dx3=latest.x-p3.x,dy3=latest.y-p3.y;
    const q=quadrant(latest.x,latest.y),status=movementStatus(latest,trajectory);
    let rightMoves=0,totalMoves=0;
    for(let i=Math.max(1,trajectory.length-5);i<trajectory.length;i++){totalMoves++;if(trajectory[i].x>trajectory[i-1].x)rightMoves++;}
    const rightPersistence=totalMoves?rightMoves/totalMoves*100:0;
    const potentialScore=q==='potential'?latest.x*.6+clamp(50+dx3*4)*.25+clamp(100-Math.abs(latest.y-45)*3)*.15:0;
    const mainlineScore=q==='mainline'?latest.x*.45+latest.y*.45+clamp(50+(dx3+dy3)*2)*.10:0;
    const rotationScore=latest.x*.35+latest.y*.20+clamp(50+dx3*4)*.30+rightPersistence*.15;
    groups.push({
      ...latest,quadrant:q,status:status.key,statusLabel:status.label,
      dx1:round(dx1),dy1:round(dy1),dx3:round(dx3),dy3:round(dy3),rightPersistence:round(rightPersistence),
      potentialScore:round(potentialScore),mainlineScore:round(mainlineScore),rotationScore:round(rotationScore),
      trajectory:trajectory.map(p=>({date:p.tradeDate,x:round(p.x,2),y:round(p.y,2),activityBreadth:p.activityBreadth,priceBreadth:p.priceBreadth,validCount:p.validCount}))
    });
  }
  return groups;
}

function computeBusinessFlow(profiles,activityRows,{maxDates=DEFAULT_TRAJECTORY_DAYS}={}){
  const dates=[...new Set((activityRows||[]).map(r=>isoDate(r.trade_date)).filter(Boolean))].sort().slice(-maxDates);
  const dateSet=new Set(dates),profileMaps=buildProfileTagMap(profiles||[]),byDateRows=new Map(dates.map(d=>[d,[]]));
  for(const row of activityRows||[]){const d=isoDate(row.trade_date);if(dateSet.has(d))byDateRows.get(d).push(row);}
  const aggregated=new Map();
  for(const date of dates){const scored=scoreStocksForDate(byDateRows.get(date)||[]);aggregated.set(date,aggregateTagDate(scored,profileMaps,date));}
  const groups=attachTrajectories(aggregated,dates);
  return {dates,groups,profileMaps,aggregated};
}

async function ensureBusinessFlowSchema(sql=getSql()){
  if(schemaReady)return;
  await sql.query(`
    CREATE TABLE IF NOT EXISTS market_business_xy_daily (
      trade_date date NOT NULL,
      tag_id text NOT NULL,
      tag_name text NOT NULL,
      parent_name text,
      scope text NOT NULL,
      member_count integer NOT NULL,
      valid_count integer NOT NULL,
      coverage_pct numeric,
      reliability_pct numeric,
      x_score numeric,
      y_score numeric,
      activity_breadth numeric,
      price_breadth numeric,
      up_breadth numeric,
      strong_count integer,
      leaders jsonb,
      engine_version text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date,tag_id)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_date_idx ON market_business_xy_daily (trade_date DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS market_business_xy_daily_scope_date_idx ON market_business_xy_daily (scope,trade_date DESC)`);
  schemaReady=true;
}

async function loadEngineInputs(sql,trajectoryDays){
  const profiles=await sql.query(`SELECT stock_code,stock_name,market,industry_code,industry FROM market_company_profile ORDER BY stock_code`);
  const dateRows=await sql.query(`
    SELECT trade_date
    FROM market_activity_daily
    WHERE activity_ready IS TRUE AND market IN ('上市','上櫃')
    GROUP BY trade_date
    HAVING COUNT(DISTINCT market)=2
    ORDER BY trade_date DESC
    LIMIT $1
  `,[trajectoryDays]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();
  if(!dates.length)return {profiles,dates,activityRows:[]};
  const activityRows=await sql.query(`
    SELECT trade_date,stock_code,stock_name,market,trade_value,change_pct,value_ratio_20,value_trend_5_15,
           up_value_share_5,positive_days_5,return_5_pct,return_20_pct
    FROM market_activity_daily
    WHERE activity_ready IS TRUE AND trade_date >= $1::date AND trade_date <= $2::date
      AND market IN ('上市','上櫃')
    ORDER BY trade_date,stock_code
  `,[dates[0],dates.at(-1)]);
  return {profiles,dates,activityRows:activityRows.filter(x=>dates.includes(isoDate(x.trade_date)))};
}

async function refreshBusinessFlowDaily({trajectoryDays=DEFAULT_TRAJECTORY_DAYS,sql=getSql()}={}){
  await ensureBusinessFlowSchema(sql);
  const input=await loadEngineInputs(sql,trajectoryDays);
  if(!input.dates.length)return {ok:false,reason:'no-ready-activity-dates',dates:0,rows:0};
  const computed=computeBusinessFlow(input.profiles,input.activityRows,{maxDates:trajectoryDays});
  const payload=[];
  for(const date of computed.dates)for(const row of computed.aggregated.get(date)||[])payload.push({
    trade_date:date,tag_id:row.tagId,tag_name:row.name,parent_name:row.parentName||null,scope:row.scope,
    member_count:row.memberCount,valid_count:row.validCount,coverage_pct:row.coveragePct,reliability_pct:row.reliability,
    x_score:row.x,y_score:row.y,activity_breadth:row.activityBreadth,price_breadth:row.priceBreadth,up_breadth:row.upBreadth,
    strong_count:row.strongCount,leaders:row.leaders,engine_version:ENGINE_VERSION
  });
  if(!payload.length)return {ok:false,reason:'no-business-groups',dates:computed.dates.length,rows:0};
  await sql.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        trade_date date,tag_id text,tag_name text,parent_name text,scope text,member_count integer,valid_count integer,
        coverage_pct numeric,reliability_pct numeric,x_score numeric,y_score numeric,activity_breadth numeric,price_breadth numeric,
        up_breadth numeric,strong_count integer,leaders jsonb,engine_version text
      )
    ), refreshed_dates AS (SELECT DISTINCT trade_date FROM incoming), deleted AS (
      DELETE FROM market_business_xy_daily b
      WHERE b.trade_date IN (SELECT trade_date FROM refreshed_dates)
        AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.trade_date=b.trade_date AND i.tag_id=b.tag_id)
      RETURNING 1
    )
    INSERT INTO market_business_xy_daily
      (trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,
       activity_breadth,price_breadth,up_breadth,strong_count,leaders,engine_version,updated_at)
    SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,
           activity_breadth,price_breadth,up_breadth,strong_count,leaders,engine_version,NOW()
    FROM incoming
    ON CONFLICT (trade_date,tag_id) DO UPDATE SET
      tag_name=EXCLUDED.tag_name,parent_name=EXCLUDED.parent_name,scope=EXCLUDED.scope,member_count=EXCLUDED.member_count,
      valid_count=EXCLUDED.valid_count,coverage_pct=EXCLUDED.coverage_pct,reliability_pct=EXCLUDED.reliability_pct,
      x_score=EXCLUDED.x_score,y_score=EXCLUDED.y_score,activity_breadth=EXCLUDED.activity_breadth,
      price_breadth=EXCLUDED.price_breadth,up_breadth=EXCLUDED.up_breadth,strong_count=EXCLUDED.strong_count,
      leaders=EXCLUDED.leaders,engine_version=EXCLUDED.engine_version,updated_at=NOW()
  `,[JSON.stringify(payload)]);
  memoryCache=null;
  return {ok:true,engineVersion:ENGINE_VERSION,dates:computed.dates.length,rows:payload.length,latestTradeDate:computed.dates.at(-1),profileRows:input.profiles.length,activityRows:input.activityRows.length};
}

async function needsRefresh(sql){
  await ensureBusinessFlowSchema(sql);
  const rows=await sql.query(`
    SELECT
      (SELECT MAX(trade_date) FROM (
        SELECT trade_date FROM market_activity_daily
        WHERE activity_ready IS TRUE AND market IN ('上市','上櫃')
        GROUP BY trade_date HAVING COUNT(DISTINCT market)=2
      ) d) AS activity_date,
      (SELECT MAX(trade_date) FROM market_business_xy_daily WHERE engine_version=$1) AS xy_date,
      (SELECT COUNT(*)::int FROM market_business_xy_daily WHERE engine_version=$1) AS xy_rows
  `,[ENGINE_VERSION]);
  const r=rows[0]||{};
  return !Number(r.xy_rows||0)||isoDate(r.xy_date)!==isoDate(r.activity_date);
}

function hydrateStoredRows(rows,dates){
  const byDate=new Map(dates.map(d=>[d,[]]));
  for(const r of rows){
    const d=isoDate(r.trade_date);if(!byDate.has(d))continue;
    byDate.get(d).push({
      tradeDate:d,tagId:r.tag_id,name:r.tag_name,parentName:r.parent_name||'',scope:r.scope,memberCount:Number(r.member_count||0),
      validCount:Number(r.valid_count||0),coveragePct:num(r.coverage_pct)||0,reliability:num(r.reliability_pct)||0,
      x:num(r.x_score)||50,y:num(r.y_score)||50,activityBreadth:num(r.activity_breadth)||0,priceBreadth:num(r.price_breadth)||0,
      upBreadth:num(r.up_breadth)||0,strongCount:Number(r.strong_count||0),leaders:Array.isArray(r.leaders)?r.leaders:[]
    });
  }
  return attachTrajectories(byDate,dates);
}

function scopeCounts(groups){
  const out={'technology-fine':0,'technology-fallback':0,'traditional-coarse':0};
  for(const g of groups)out[g.scope]=(out[g.scope]||0)+1;return out;
}

async function getFundflowSnapshot({days=10,force=false}={}){
  const sql=getSql();await ensureBusinessFlowSchema(sql);
  const bounded=Math.max(5,Math.min(15,Number(days)||10));
  const now=Date.now();
  if(!force&&memoryCache&&memoryCache.days===bounded&&now-memoryCache.savedAt<120000)return memoryCache.value;
  if(force||await needsRefresh(sql))await refreshBusinessFlowDaily({trajectoryDays:DEFAULT_TRAJECTORY_DAYS,sql});
  const dateRows=await sql.query(`SELECT DISTINCT trade_date FROM market_business_xy_daily WHERE engine_version=$1 ORDER BY trade_date DESC LIMIT $2`,[ENGINE_VERSION,bounded]);
  const dates=dateRows.map(x=>isoDate(x.trade_date)).filter(Boolean).sort();
  if(!dates.length)throw new Error('XY 尚無可用 activity_ready 交易日');
  const rows=await sql.query(`
    SELECT trade_date,tag_id,tag_name,parent_name,scope,member_count,valid_count,coverage_pct,reliability_pct,x_score,y_score,
           activity_breadth,price_breadth,up_breadth,strong_count,leaders
    FROM market_business_xy_daily
    WHERE engine_version=$1 AND trade_date >= $2::date AND trade_date <= $3::date
    ORDER BY trade_date,tag_id
  `,[ENGINE_VERSION,dates[0],dates.at(-1)]);
  const groups=hydrateStoredRows(rows,dates);
  const eligible=g=>g.validCount>=2&&g.trajectory.length>=2;
  const potential=groups.filter(g=>eligible(g)&&g.quadrant==='potential').sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,10);
  const mainline=groups.filter(g=>eligible(g)&&g.quadrant==='mainline').sort((a,b)=>b.mainlineScore-a.mainlineScore).slice(0,10);
  const rightMoving=groups.filter(g=>eligible(g)&&g.dx3>1).sort((a,b)=>b.rotationScore-a.rotationScore).slice(0,10);
  const retreat=groups.filter(g=>eligible(g)&&(g.dx3<-2||g.status==='mainline-fading')).sort((a,b)=>a.dx3-b.dx3).slice(0,10);
  const value={
    ok:true,engineVersion:ENGINE_VERSION,asOf:dates.at(-1),trajectoryDates:dates,trajectoryDays:dates.length,
    axes:{x:'資金活動／潛伏程度',y:'市場價格強度',center:50,potentialX:55,mainline:55},
    methodology:{
      stockX:'35% 20日成交值異常＋30% 5/15日成交值趨勢＋20% 上漲成交占比＋15% 近5日上漲持續性；前三項採全市場百分位',
      stockY:'25% 當日漲跌＋35% 5日報酬＋20% 20日報酬＋20% 近5日上漲持續性；報酬採全市場百分位',
      group:'業務座標採加權中位數／平均＋族群廣度，並對小樣本向 50 中性值收縮；core > important > related',
      caution:'X 是資金活動／推動度，不是券商分點或逐筆成交推算的「淨流入」。'
    },
    counts:{groups:groups.length,byScope:scopeCounts(groups),potential:potential.length,mainline:mainline.length},
    picks:{potential,mainline,rightMoving,retreat},groups
  };
  memoryCache={days:bounded,savedAt:now,value};return value;
}

module.exports={
  ENGINE_VERSION,DEFAULT_TRAJECTORY_DAYS,percentileRanks,scoreStocksForDate,computeBusinessFlow,quadrant,
  ensureBusinessFlowSchema,refreshBusinessFlowDaily,getFundflowSnapshot
};
