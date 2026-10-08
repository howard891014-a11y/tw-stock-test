// StockZone dW4 Final — frozen 2026-10-07
// Dual ridge model: X=Flow5 (alpha 10); Y=Y level + Ret0 + Ret[-2] + Regime (alpha 3).
// Output is always one of eight angular sectors. Center gate is intentionally OFF.
function getSql(){return require('./db').getSql();}

const DW4_VERSION='dw4-final-oos-2026-10-07';
const BAND_CANDIDATE={status:'provisional',multiplier:1.25,meanReversion:0.75,volatilityWindow:10,volatilityFloor:0.5,unit:'log-percent',validatedOutOfSample:false};
const OOS_CONFIDENCE={5:73.9,10:66.1,15:62.1,20:61.8};
const HORIZONS=[5,10,15,20], HORIZON=5, X_UNIT=150, Y_UNIT=.9, X_ALPHA=10, Y_ALPHA=3;
const DIRECTIONS=['向右','右上','向上','左上','向左','左下','向下','右下'];
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
function regime(date){const d=iso(date);if(d<='2026-06-26')return 1;if(d<='2026-07-30')return -1;return 1;}
function direction(dx,dy){const a=Math.atan2((n(dy)||0)/Y_UNIT,(n(dx)||0)/X_UNIT),i=((Math.floor((a+Math.PI/8)/(Math.PI/4))%8)+8)%8;return DIRECTIONS[i];}
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
function buildExamples(rows,horizon=HORIZON){const byTag=new Map();for(const r of rows){const k=String(r.tag_id);if(!byTag.has(k))byTag.set(k,[]);byTag.get(k).push({...r,trade_date:iso(r.trade_date)});}const out=[];for(const a of byTag.values()){a.sort((x,y)=>x.trade_date.localeCompare(y.trade_date));for(let i=0;i<a.length;i++){const r=a[i],f=a[i+Number(horizon||HORIZON)];if(!f)continue;const rx=n(r.x_score),fx=n(f.x_score),ry=n(r.y_score),fy=n(f.y_score);if(rx===null||fx===null||ry===null||fy===null)continue;out.push({...r,ret_m2:i>=2?n(a[i-2].return_1_pct):null,regime:regime(r.trade_date),target_date:f.trade_date,target_dx:fx-rx,target_dy:fy-ry});}}return out;}

function calibrateDirectionConfidence(train,horizon){
  const dates=[...new Set(train.map(r=>r.trade_date))].sort();
  if(dates.length<12)return {overall:null,byDirection:{},n:0,maeX:null,maeY:null};
  const starts=[Math.floor(dates.length*.45),Math.floor(dates.length*.62),Math.floor(dates.length*.79)].filter((v,i,a)=>v>0&&v<dates.length&&a.indexOf(v)===i);
  const stats={all:{n:0,hit:0,ax:0,ay:0}},by={};
  for(let fi=0;fi<starts.length;fi++){
    const lo=starts[fi],hi=fi+1<starts.length?starts[fi+1]:dates.length,from=dates[lo],to=dates[hi-1];
    const fitRows=train.filter(r=>r.target_date<from),testRows=train.filter(r=>r.trade_date>=from&&r.trade_date<=to);
    const xm=ridgeFit(fitRows,['flow_5_pct'],'target_dx',X_ALPHA),ym=ridgeFit(fitRows,['y_score','return_1_pct','ret_m2','regime'],'target_dy',Y_ALPHA);if(!xm||!ym)continue;
    for(const r of testRows){const dx=predict(xm,r),dy=predict(ym,r);if(dx===null||dy===null)continue;const pd=direction(dx,dy),actual=direction(r.target_dx,r.target_dy),hit=pd===actual?1:0,ax=Math.abs(n(r.target_dx)-dx),ay=Math.abs(n(r.target_dy)-dy);stats.all.n++;stats.all.hit+=hit;stats.all.ax+=ax;stats.all.ay+=ay;if(!by[pd])by[pd]={n:0,hit:0};by[pd].n++;by[pd].hit+=hit;}
  }
  const overall=stats.all.n?stats.all.hit/stats.all.n:null,byDirection={};for(const [k,v] of Object.entries(by))byDirection[k]={n:v.n,rate:v.n>=20?v.hit/v.n:overall};
  return {overall,byDirection,n:stats.all.n,maeX:stats.all.n?stats.all.ax/stats.all.n:null,maeY:stats.all.n?stats.all.ay/stats.all.n:null,horizon};
}

async function ensureDw4Schema(sql=getSql()){await sql.query(`CREATE TABLE IF NOT EXISTS market_business_dw4_prediction (prediction_date date NOT NULL,tag_id text NOT NULL,model_version text NOT NULL,pred_dx numeric NOT NULL,pred_dy numeric NOT NULL,direction text NOT NULL,horizon integer NOT NULL DEFAULT 5,training_n_x integer NOT NULL,training_n_y integer NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(prediction_date,tag_id,model_version))`);}
async function predictDw4({sql=getSql(),date=null,persist=false,horizons=HORIZONS}={}){
  if(persist) await ensureDw4Schema(sql);
  const dr=await sql.query(`SELECT COALESCE($1::date,MAX(trade_date))::text d FROM market_business_xy2_research_daily`,[date]);
  const pd=iso(dr?.[0]?.d);if(!pd)throw new Error('dW4：沒有 research history');
  const rows=await sql.query(`SELECT trade_date,tag_id,x_score,y_score,flow_5_pct,return_1_pct FROM market_business_xy2_research_daily WHERE trade_date <= $1::date ORDER BY tag_id,trade_date`,[pd]);
  const latest=new Map(),histByTag=new Map();
  for(const r of rows){const k=String(r.tag_id);if(!histByTag.has(k))histByTag.set(k,[]);histByTag.get(k).push(r);if(iso(r.trade_date)===pd)latest.set(k,r);}
  const requested=[...new Set((Array.isArray(horizons)?horizons:[horizons]).map(Number).filter(h=>HORIZONS.includes(h)))].sort((a,b)=>a-b);
  if(!requested.length)requested.push(HORIZON);
  const horizonResults={};
  for(const horizon of requested){
    const examples=buildExamples(rows,horizon),train=examples.filter(r=>r.trade_date>='2026-06-01'&&r.target_date<pd);
    const xModel=ridgeFit(train,['flow_5_pct'],'target_dx',X_ALPHA),yModel=ridgeFit(train,['y_score','return_1_pct','ret_m2','regime'],'target_dy',Y_ALPHA);
    if(!xModel||!yModel){horizonResults[horizon]={ok:false,horizon,error:'成熟訓練樣本不足',predictions:[]};continue;}
    const calibration=calibrateDirectionConfidence(train,horizon),oosConfidence=OOS_CONFIDENCE[horizon]??null,predictions=[];
    for(const [tagId,r] of latest){const a=histByTag.get(tagId),i=a.length-1,row={...r,ret_m2:i>=2?n(a[i-2].return_1_pct):null,regime:regime(pd)},dx=predict(xModel,row),dy=predict(yModel,row);if(dx===null||dy===null)continue;const candidateBand=provisionalYBand(a),candidateXBand=provisionalXBand(a,horizon),dir=direction(dx,dy),bucket=calibration.byDirection?.[dir],rate=Number.isFinite(bucket?.rate)?bucket.rate:calibration.overall;predictions.push({predictionDate:pd,tagId,predDx:dx,predDy:dy,direction:dir,horizon,provisionalYBand:candidateBand,provisionalXBand:candidateXBand,confidence:Number.isFinite(oosConfidence)?oosConfidence:(Number.isFinite(rate)?Math.round(rate*1000)/10:null),confidenceN:Number.isFinite(oosConfidence)?2072:Number(bucket?.n||calibration.n||0),uncertaintyX:Number.isFinite(calibration.maeX)?calibration.maeX:null,uncertaintyY:Number.isFinite(calibration.maeY)?calibration.maeY:null});}
    if(persist&&predictions.length){const mv=`${DW4_VERSION}-h${horizon}`,payload=predictions.map(p=>({prediction_date:p.predictionDate,tag_id:p.tagId,model_version:mv,pred_dx:p.predDx,pred_dy:p.predDy,direction:p.direction,horizon,training_n_x:xModel.n,training_n_y:yModel.n}));await sql.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(prediction_date date,tag_id text,model_version text,pred_dx numeric,pred_dy numeric,direction text,horizon int,training_n_x int,training_n_y int)) INSERT INTO market_business_dw4_prediction(prediction_date,tag_id,model_version,pred_dx,pred_dy,direction,horizon,training_n_x,training_n_y) SELECT prediction_date,tag_id,model_version,pred_dx,pred_dy,direction,horizon,training_n_x,training_n_y FROM x ON CONFLICT(prediction_date,tag_id,model_version) DO NOTHING`,[JSON.stringify(payload)]);}
    horizonResults[horizon]={ok:true,horizon,training:{x:xModel.n,y:yModel.n},calibration:{n:calibration.n,overall:calibration.overall===null?null:Math.round(calibration.overall*1000)/10,maeX:calibration.maeX,maeY:calibration.maeY},predictions};
  }
  const primary=horizonResults[HORIZON]||horizonResults[requested[0]]||{predictions:[]};
  return {ok:Object.values(horizonResults).some(x=>x.ok),modelVersion:DW4_VERSION,predictionDate:pd,horizon:HORIZON,horizons:requested,centerGate:false,bandCandidate:BAND_CANDIDATE,units:{x:X_UNIT,y:Y_UNIT},alpha:{x:X_ALPHA,y:Y_ALPHA},features:{x:['flow_5_pct'],y:['y_score','return_1_pct','ret_m2','regime']},training:primary.training||null,predictions:primary.predictions||[],horizonResults};
}
module.exports={DW4_VERSION,BAND_CANDIDATE,provisionalYBand,provisionalXBand,X_BAND_SCALE,X_BAND_Q80,OOS_CONFIDENCE,HORIZONS,HORIZON,X_UNIT,Y_UNIT,X_ALPHA,Y_ALPHA,DIRECTIONS,regime,direction,ridgeFit,predict,buildExamples,calibrateDirectionConfidence,ensureDw4Schema,predictDw4};
