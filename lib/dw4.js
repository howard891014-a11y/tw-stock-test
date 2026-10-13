// StockZone price-target research candidate — 2026-10-13.
// X predicts 20D rolling-position displacement (including expiring flows).
// Y predicts future accumulated log price return, NOT a change of trailing Y5.
// No legacy dW4 accuracy percentage is reused for this new target.
function getSql(){return require('./db').getSql();}
const {numeric:n,logReturn,simpleReturn,addLogReturns,retiringFlow,buildTopicPricePath,dateOf}=require('./price-path');
const {fitSignCalibration,directionProbability}=require('./dw4-probability');

const DW4_VERSION='dw4-price-prob-v26711-2026-10-13';
const BAND_CANDIDATE={status:'provisional',multiplier:1.25,meanReversion:0.75,volatilityWindow:10,volatilityFloor:0.5,unit:'log-percent',validatedOutOfSample:false};
const OOS_CONFIDENCE=Object.freeze({}); // Old Y5-displacement hit rates are invalid for price-return labels.
const HORIZONS=[5,10,15,20], HORIZON=5, X_UNIT=150, Y_UNIT=.9, X_ALPHA=10, Y_ALPHA=3;
const DIRECTIONS=['向右','右上','向上','左上','向左','左下','向下','右下'];
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
function regime(v){if(v==='RiskOn')return 1;if(v==='Normal')return 0;if(v==='RiskOff')return -1;return null;}
function direction(dx,dy){if(n(dx)===null||n(dy)===null)return null;if(dx===0&&dy===0)return '原地';const a=Math.atan2(dy/Y_UNIT,dx/X_UNIT),i=((Math.floor((a+Math.PI/8)/(Math.PI/4))%8)+8)%8;return DIRECTIONS[i];}
function solve(a,b){const m=a.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let k=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[k][i]))k=j;[m[i],m[k]]=[m[k],m[i]];if(Math.abs(m[i][i])<1e-12)return null;const q=m[i][i];for(let j=i;j<=N;j++)m[i][j]/=q;for(let r=0;r<N;r++)if(r!==i){const f=m[r][i];for(let j=i;j<=N;j++)m[r][j]-=f*m[i][j];}}return m.map(r=>r[N]);}
function ridgeFit(rows,keys,target,alpha){const clean=rows.filter(r=>n(r[target])!==null&&keys.every(k=>n(r[k])!==null));if(clean.length<Math.max(20,keys.length*5))return null;const means=keys.map(k=>clean.reduce((s,r)=>s+n(r[k]),0)/clean.length),sds=keys.map((k,j)=>{const v=Math.sqrt(clean.reduce((s,r)=>s+(n(r[k])-means[j])**2,0)/Math.max(1,clean.length-1));return v>1e-9?v:1;});const p=keys.length+1,A=Array.from({length:p},()=>Array(p).fill(0)),B=Array(p).fill(0);for(const r of clean){const x=[1,...keys.map((k,j)=>(n(r[k])-means[j])/sds[j])],y=n(r[target]);for(let i=0;i<p;i++){B[i]+=x[i]*y;for(let j=0;j<p;j++)A[i][j]+=x[i]*x[j];}}for(let i=1;i<p;i++)A[i][i]+=alpha;const beta=solve(A,B);return beta?{keys,means,sds,beta,n:clean.length,alpha}:null;}
function predict(model,row){if(!model)return null;let y=model.beta[0];for(let j=0;j<model.keys.length;j++){const v=n(row[model.keys[j]]);if(v===null)return null;y+=model.beta[j+1]*(v-model.means[j])/model.sds[j];}return y;}
// Independent research overlay: does not replace the frozen ridge forecast or its direction.
function provisionalYBand(history){
  const valid=(history||[]).map(r=>n(r.y_score)).filter(v=>v!==null&&v>-100);
  if(valid.length<10)return null;
  const values=valid.slice(-10).map(v=>100*Math.log1p(v/100));
  const last=values[9],mean=values.reduce((a,b)=>a+b,0)/10;
  const variance=values.reduce((a,b)=>a+(b-mean)**2,0)/9;
  const vol=Math.max(Math.sqrt(variance),BAND_CANDIDATE.volatilityFloor);
  const center=last-BAND_CANDIDATE.meanReversion*(last-mean);
  const halfWidth=BAND_CANDIDATE.multiplier*vol;
  const toY=z=>100*Math.expm1(z/100);
  return {status:'provisional',centerY:toY(center),lowerY:toY(center-halfWidth),upperY:toY(center+halfWidth),halfWidthLog:halfWidth,volatilityLog:vol,observations:10,multiplier:1.25};
}
// Visualization-only X uncertainty. Global q80 values are research estimates from
// matured all-industry historical examples, NOT confidence guarantees for ridge centers.
const X_BAND_SCALE=0.40;
const X_BAND_Q80={5:3.652,10:4.802,15:5.322,20:5.687};
function provisionalXBand(history,horizon){
  const xs=(history||[]).map(r=>n(r.x_score)).filter(v=>v!==null);
  if(xs.length<11||!X_BAND_Q80[horizon])return null;
  const recent=xs.slice(-11),diffs=recent.slice(1).map((v,i)=>v-recent[i]);
  const mean=diffs.reduce((a,b)=>a+b,0)/diffs.length;
  const sd=Math.sqrt(diffs.reduce((a,b)=>a+(b-mean)**2,0)/(diffs.length-1));
  const k=1+(horizon-5)/60;
  return {status:'provisional',halfWidth:X_BAND_SCALE*k*X_BAND_Q80[horizon]*Math.max(.5,sd),volatility:Math.max(.5,sd),q80:X_BAND_Q80[horizon],scale:X_BAND_SCALE,horizon};
}
const X_FEATURES=['x_score','flow_5_pct','retiring_flow_ratio'];
const X_FALLBACK_FEATURES=['x_score','flow_5_pct']; // Sparse historic 1D flow: never impute expiring flow as zero.
const Y_BASE_FEATURES=['y_score','return_1_pct','ret_m2'];
const Y_FEATURES=['y_score','return_1_pct','ret_m2','x_score','flow_5_pct','dy3_turn','vol_10','regime'];
const Y_NO_W3_FEATURES=Y_FEATURES.filter(k=>k!=='regime');
function priceMomentumAndVol(a,i){
  if(i<9)return {dy3_turn:null,vol_10:null};
  const logs=a.slice(i-9,i+1).map(r=>logReturn(r.return_1_pct));
  if(logs.some(v=>v===null))return {dy3_turn:null,vol_10:null};
  const now=logs.slice(-3).reduce((s,v)=>s+v,0),prior=logs.slice(-6,-3).reduce((s,v)=>s+v,0);
  const mean=logs.reduce((s,v)=>s+v,0)/logs.length;
  const vol=Math.sqrt(logs.reduce((s,v)=>s+(v-mean)**2,0)/(logs.length-1));
  return {dy3_turn:now-prior,vol_10:vol};
}
function featuresAt(a,i,horizon,w3ByDate=new Map()){
  const r=a[i];return {...r,...priceMomentumAndVol(a,i),trade_date:iso(r.trade_date),ret_m2:i>=2?n(a[i-2].return_1_pct):null,
    regime:regime(w3ByDate.get(iso(r.trade_date))),retiring_flow_ratio:retiringFlow(a,i,horizon)};
}
function buildExamples(rows,horizon=HORIZON,w3ByDate=new Map()){
  const tradingDates=[...new Set(rows.map(r=>iso(r.trade_date)))].sort(),dateIndex=new Map(tradingDates.map((d,i)=>[d,i]));
  const byTag=new Map();for(const r of rows){const k=String(r.tag_id);if(!byTag.has(k))byTag.set(k,[]);byTag.get(k).push({...r,trade_date:iso(r.trade_date)});}
  const out=[];for(const a of byTag.values()){
    a.sort((x,y)=>x.trade_date.localeCompare(y.trade_date));
    for(let i=0;i<a.length;i++){
      const r=a[i],f=a[i+horizon],at=dateIndex.get(r.trade_date);
      if(!f||at===undefined||at+horizon>=tradingDates.length||f.trade_date!==tradingDates[at+horizon]||i<19||a[i-19].trade_date!==tradingDates[at-19])continue;
      const rx=n(r.x_score),fx=n(f.x_score),log=addLogReturns(a.slice(i+1,i+1+horizon).map(x=>x.return_1_pct));
      if(rx===null||fx===null||log===null)continue;
      const row=featuresAt(a,i,horizon,w3ByDate);
      out.push({...row,target_date:f.trade_date,target_dx:fx-rx,target_price_log:log});
    }
  }return out;
}

function calibrateDirectionConfidence(train,horizon,xKeys=X_FEATURES,yKeys=Y_BASE_FEATURES){
  const dates=[...new Set(train.map(r=>r.trade_date))].sort();
  if(dates.length<12)return {overall:null,byDirection:{},n:0,maeX:null,maeY:null};
  const starts=[Math.floor(dates.length*.45),Math.floor(dates.length*.62),Math.floor(dates.length*.79)].filter((v,i,a)=>v>0&&v<dates.length&&a.indexOf(v)===i);
  const stats={all:{n:0,hit:0,ax:0,ay:0}},by={};
  for(let fi=0;fi<starts.length;fi++){
    const lo=starts[fi],hi=fi+1<starts.length?starts[fi+1]:dates.length,from=dates[lo],to=dates[hi-1];
    const fitRows=train.filter(r=>r.target_date<from),testRows=train.filter(r=>r.trade_date>=from&&r.trade_date<=to);
    const xm=ridgeFit(fitRows,xKeys,'target_dx',X_ALPHA),ym=ridgeFit(fitRows,yKeys,'target_price_log',Y_ALPHA);if(!xm||!ym)continue;
    for(const r of testRows){const dx=predict(xm,r),dy=predict(ym,r);if(dx===null||dy===null)continue;const pd=direction(dx,dy),actual=direction(r.target_dx,r.target_price_log),hit=pd===actual?1:0,ax=Math.abs(n(r.target_dx)-dx),ay=Math.abs(n(r.target_price_log)-dy);stats.all.n++;stats.all.hit+=hit;stats.all.ax+=ax;stats.all.ay+=ay;if(!by[pd])by[pd]={n:0,hit:0};by[pd].n++;by[pd].hit+=hit;}
  }
  const overall=stats.all.n?stats.all.hit/stats.all.n:null,byDirection={};for(const [k,v] of Object.entries(by))byDirection[k]={n:v.n,rate:v.n>=20?v.hit/v.n:overall};
  return {overall,byDirection,n:stats.all.n,maeX:stats.all.n?stats.all.ax/stats.all.n:null,maeY:stats.all.n?stats.all.ay/stats.all.n:null,horizon};
}

// Chronological, label-matured research OOS rows: no training row may use a
// future target date >= the first forecast date in its test fold.
function walkForwardRows(train,horizon,yKeys){
  const dates=[...new Set(train.map(r=>r.trade_date))].sort();
  if(dates.length<12)return {rows:[],folds:0,mae:null,signHit:null,dates:0};
  const cuts=[.40,.55,.70,.85].map(x=>Math.floor(dates.length*x));
  const starts=[...new Set(cuts)].filter(v=>v>0&&v<dates.length);
  const out=[];let folds=0;
  for(let fi=0;fi<starts.length;fi++){
    const lo=starts[fi],hi=fi+1<starts.length?starts[fi+1]:dates.length,from=dates[lo],to=dates[hi-1];
    const past=train.filter(r=>r.target_date<from);
    const model=ridgeFit(past,yKeys,'target_price_log',Y_ALPHA);if(!model)continue;
    folds++;
    for(const r of train){if(r.trade_date<from||r.trade_date>to)continue;
      const pred=predict(model,r);if(pred===null)continue;
      out.push({date:r.trade_date,pred,real:r.target_price_log,tagId:r.tag_id});
    }
  }
  const dateCount=new Set(out.map(x=>x.date)).size;
  const mae=out.length?out.reduce((s,r)=>s+Math.abs(r.real-r.pred),0)/out.length:null;
  const signHit=out.length?out.filter(r=>(r.pred>0)===(r.real>0)).length/out.length:null;
  return {rows:out,folds,mae,signHit,dates:dateCount};
}
function selectYModel(train,horizon){
  const options=[{name:'baseline',keys:Y_BASE_FEATURES},{name:'expanded-no-w3',keys:Y_NO_W3_FEATURES},{name:'expanded-w3',keys:Y_FEATURES}];
  const candidates=options.map(v=>({...v,model:ridgeFit(train,v.keys,'target_price_log',Y_ALPHA)})).filter(v=>v.model);
  if(!candidates.length)return null;
  for(const c of candidates)c.oos=walkForwardRows(train,horizon,c.keys);
  const baseline=candidates.find(c=>c.name==='baseline');
  // Require material improvement over baseline on the SAME validation dates.
  let best=baseline||candidates[0];
  for(const c of candidates.filter(v=>v!==best)){
    if(c.oos.rows.length<100||c.oos.dates<12||!best.oos.rows.length)continue;
    const byKey=new Map(best.oos.rows.map(r=>[`${r.date}|${r.tagId}`,r]));
    const pairs=c.oos.rows.map(r=>({a:byKey.get(`${r.date}|${r.tagId}`),b:r})).filter(r=>r.a);
    const distinct=new Set(pairs.map(p=>p.b.date)).size;
    if(pairs.length<100||distinct<12)continue;
    const baseMAE=pairs.reduce((s,p)=>s+Math.abs(p.a.pred-p.a.real),0)/pairs.length;
    const candidateMAE=pairs.reduce((s,p)=>s+Math.abs(p.b.pred-p.b.real),0)/pairs.length;
    if(candidateMAE<baseMAE*.985){best=c;}
  }
  return best;
}

async function ensureDw4Schema(sql=getSql()){await sql.query(`CREATE TABLE IF NOT EXISTS market_business_dw4_prediction (prediction_date date NOT NULL,tag_id text NOT NULL,model_version text NOT NULL,pred_dx numeric NOT NULL,pred_dy numeric NOT NULL,direction text NOT NULL,horizon integer NOT NULL DEFAULT 5,training_n_x integer NOT NULL,training_n_y integer NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(prediction_date,tag_id,model_version))`);}
async function predictDw4({sql=getSql(),date=null,persist=false,horizons=HORIZONS}={}){
  if(persist) await ensureDw4Schema(sql);
  const dr=await sql.query(`SELECT COALESCE($1::date,MAX(trade_date))::text d FROM market_business_xy2_research_daily`,[date]);
  const pd=iso(dr?.[0]?.d);if(!pd)throw new Error('dW4：沒有 research history');
  const rows=await sql.query(`SELECT trade_date,tag_id,x_score,y_score,flow_1_pct,flow_5_pct,return_1_pct FROM market_business_xy2_research_daily WHERE trade_date <= $1::date ORDER BY tag_id,trade_date`,[pd]);
  let w3Records=[];try{w3Records=await sql.query(`SELECT trade_date::text AS trade_date,regime FROM market_w3_run_daily WHERE trade_date <= $1::date ORDER BY trade_date`,[pd]);}catch(e){console.warn('dW4: W3 history not available; proceeding without W3 feature:',String(e?.message||e));}
  const w3ByDate=new Map(w3Records.map(r=>[iso(r.trade_date),r.regime]));
  const latest=new Map(),histByTag=new Map();
  for(const r of rows){const k=String(r.tag_id);if(!histByTag.has(k))histByTag.set(k,[]);histByTag.get(k).push(r);if(iso(r.trade_date)===pd)latest.set(k,r);}
  const allTradingDates=[...new Set(rows.map(r=>iso(r.trade_date)))].sort();
  const pricePaths={};for(const [tagId,a] of histByTag){pricePaths[tagId]=buildTopicPricePath(a,allTradingDates,20);}
  const requested=[...new Set((Array.isArray(horizons)?horizons:[horizons]).map(Number).filter(h=>HORIZONS.includes(h)))].sort((a,b)=>a-b);
  if(!requested.length)requested.push(HORIZON);
  const horizonResults={};
  for(const horizon of requested){
    const examples=buildExamples(rows,horizon,w3ByDate),train=examples.filter(r=>r.trade_date>='2026-06-01'&&r.target_date<pd);
    const fullXModel=ridgeFit(train,X_FEATURES,'target_dx',X_ALPHA);
    const xModel=fullXModel||ridgeFit(train,X_FALLBACK_FEATURES,'target_dx',X_ALPHA),selectedY=selectYModel(train,horizon),yModel=selectedY?.model||null;
    const xFeatureMode=fullXModel?'full-with-expiring-flow':'fallback-no-expiring-flow';
    if(!xModel||!yModel){horizonResults[horizon]={ok:false,horizon,error:'成熟訓練樣本不足',predictions:[]};continue;}
    const calibration=calibrateDirectionConfidence(train,horizon,xModel.keys,yModel.keys),yOos=selectedY.oos;
    const signCal=fitSignCalibration(yOos.rows,horizon),predictions=[];
    for(const [tagId,r] of latest){const a=histByTag.get(tagId),i=a.length-1,row=featuresAt(a,i,horizon,w3ByDate),dx=predict(xModel,row),dy=predict(yModel,row);if(dx===null||dy===null)continue;const candidateXBand=provisionalXBand(a,horizon),dir=direction(dx,dy),bucket=calibration.byDirection?.[dir],rate=Number.isFinite(bucket?.rate)?bucket.rate:calibration.overall;const prob=directionProbability(signCal,dy);predictions.push({predictionDate:pd,tagId,predDx:dx,predDy:dy,predLogReturn:dy,predReturnPct:simpleReturn(dy),direction:dir,horizon,provisionalYBand:null,provisionalXBand:candidateXBand,confidence:null,upProbability:prob.upProbability,directionProbability:prob.directionProbability,confidenceStatus:prob.confidenceStatus,confidenceDates:prob.confidenceDates||0,confidenceEffectiveBlocks:prob.confidenceEffectiveBlocks||0,researchHitRate:calibration.n>=30&&Number.isFinite(rate)?Math.round(rate*1000)/10:null,confidenceN:Number(bucket?.n||calibration.n||0),uncertaintyX:Number.isFinite(calibration.maeX)?calibration.maeX:null,uncertaintyY:Number.isFinite(calibration.maeY)?calibration.maeY:null,bandStatus:'oos-mae-exploratory',xFeatureMode});}
    if(persist&&predictions.length){const mv=`${DW4_VERSION}-h${horizon}`,payload=predictions.map(p=>({prediction_date:p.predictionDate,tag_id:p.tagId,model_version:mv,pred_dx:p.predDx,pred_dy:p.predDy,direction:p.direction,horizon,training_n_x:xModel.n,training_n_y:yModel.n}));await sql.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(prediction_date date,tag_id text,model_version text,pred_dx numeric,pred_dy numeric,direction text,horizon int,training_n_x int,training_n_y int)) INSERT INTO market_business_dw4_prediction(prediction_date,tag_id,model_version,pred_dx,pred_dy,direction,horizon,training_n_x,training_n_y) SELECT prediction_date,tag_id,model_version,pred_dx,pred_dy,direction,horizon,training_n_x,training_n_y FROM x ON CONFLICT(prediction_date,tag_id,model_version) DO NOTHING`,[JSON.stringify(payload)]);}
    horizonResults[horizon]={ok:true,horizon,xFeatureMode,xFeatures:xModel.keys,yFeatureMode:selectedY.name,yFeatures:yModel.keys,probabilityCalibration:{status:signCal.status,n:signCal.n,distinctDates:signCal.distinctDates,effectiveBlocks:signCal.effectiveBlocks,baseUpRate:signCal.baseUpRate??null},oosY:{n:yOos.rows.length,dates:yOos.dates,mae:yOos.mae,signHit:yOos.signHit},training:{x:xModel.n,y:yModel.n},calibration:{n:calibration.n,overall:calibration.overall===null?null:Math.round(calibration.overall*1000)/10,maeX:calibration.maeX,maeY:calibration.maeY},predictions};
  }
  const primary=horizonResults[HORIZON]||horizonResults[requested[0]]||{predictions:[]};
  return {ok:Object.values(horizonResults).some(x=>x.ok),modelVersion:DW4_VERSION,predictionDate:pd,horizon:HORIZON,horizons:requested,centerGate:false,bandCandidate:null,units:{x:X_UNIT,y:Y_UNIT,yTarget:'future-cumulative-log-return-percent'},alpha:{x:X_ALPHA,y:Y_ALPHA},features:{x:X_FEATURES,y:Y_FEATURES,yBaseline:Y_BASE_FEATURES,yNoW3:Y_NO_W3_FEATURES,fallbackX:X_FALLBACK_FEATURES},pricePaths,training:primary.training||null,predictions:primary.predictions||[],horizonResults};
}
module.exports={X_FEATURES,X_FALLBACK_FEATURES,Y_BASE_FEATURES,Y_NO_W3_FEATURES,Y_FEATURES,priceMomentumAndVol,walkForwardRows,selectYModel,featuresAt,DW4_VERSION,BAND_CANDIDATE,provisionalYBand,provisionalXBand,X_BAND_SCALE,X_BAND_Q80,OOS_CONFIDENCE,HORIZONS,HORIZON,X_UNIT,Y_UNIT,X_ALPHA,Y_ALPHA,DIRECTIONS,regime,direction,ridgeFit,predict,buildExamples,calibrateDirectionConfidence,ensureDw4Schema,predictDw4};
