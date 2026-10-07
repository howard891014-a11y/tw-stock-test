// StockZone dW4 Final — frozen 2026-10-07
// Dual ridge model: X=Flow5 (alpha 10); Y=Y level + Ret0 + Ret[-2] + Regime (alpha 3).
// Output is always one of eight angular sectors. Center gate is intentionally OFF.
function getSql(){return require('./db').getSql();}

const DW4_VERSION='dw4-final-2026-10-07';
const HORIZONS=[5,10,15,20], HORIZON=5, X_UNIT=150, Y_UNIT=.9, X_ALPHA=10, Y_ALPHA=3;
const DIRECTIONS=['向右','右上','向上','左上','向左','左下','向下','右下'];
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const iso=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
function regime(date){const d=iso(date);if(d<='2026-06-26')return 1;if(d<='2026-07-30')return -1;return 1;}
function direction(dx,dy){const a=Math.atan2((n(dy)||0)/Y_UNIT,(n(dx)||0)/X_UNIT),i=((Math.floor((a+Math.PI/8)/(Math.PI/4))%8)+8)%8;return DIRECTIONS[i];}
function solve(a,b){const m=a.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let k=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[k][i]))k=j;[m[i],m[k]]=[m[k],m[i]];if(Math.abs(m[i][i])<1e-12)return null;const q=m[i][i];for(let j=i;j<=N;j++)m[i][j]/=q;for(let r=0;r<N;r++)if(r!==i){const f=m[r][i];for(let j=i;j<=N;j++)m[r][j]-=f*m[i][j];}}return m.map(r=>r[N]);}
function ridgeFit(rows,keys,target,alpha){const clean=rows.filter(r=>n(r[target])!==null&&keys.every(k=>n(r[k])!==null));if(clean.length<Math.max(20,keys.length*5))return null;const means=keys.map(k=>clean.reduce((s,r)=>s+n(r[k]),0)/clean.length),sds=keys.map((k,j)=>{const v=Math.sqrt(clean.reduce((s,r)=>s+(n(r[k])-means[j])**2,0)/Math.max(1,clean.length-1));return v>1e-9?v:1;});const p=keys.length+1,A=Array.from({length:p},()=>Array(p).fill(0)),B=Array(p).fill(0);for(const r of clean){const x=[1,...keys.map((k,j)=>(n(r[k])-means[j])/sds[j])],y=n(r[target]);for(let i=0;i<p;i++){B[i]+=x[i]*y;for(let j=0;j<p;j++)A[i][j]+=x[i]*x[j];}}for(let i=1;i<p;i++)A[i][i]+=alpha;const beta=solve(A,B);return beta?{keys,means,sds,beta,n:clean.length,alpha}:null;}
function predict(model,row){if(!model)return null;let y=model.beta[0];for(let j=0;j<model.keys.length;j++){const v=n(row[model.keys[j]]);if(v===null)return null;y+=model.beta[j+1]*(v-model.means[j])/model.sds[j];}return y;}
function buildExamples(rows,horizon=HORIZON){const byTag=new Map();for(const r of rows){const k=String(r.tag_id);if(!byTag.has(k))byTag.set(k,[]);byTag.get(k).push({...r,trade_date:iso(r.trade_date)});}const out=[];for(const a of byTag.values()){a.sort((x,y)=>x.trade_date.localeCompare(y.trade_date));for(let i=0;i<a.length;i++){const r=a[i],f=a[i+Number(horizon||HORIZON)];if(!f)continue;const rx=n(r.x_score),fx=n(f.x_score),ry=n(r.y_score),fy=n(f.y_score);if(rx===null||fx===null||ry===null||fy===null)continue;out.push({...r,ret_m2:i>=2?n(a[i-2].return_1_pct):null,regime:regime(r.trade_date),target_date:f.trade_date,target_dx:fx-rx,target_dy:fy-ry});}}return out;}
async function ensureDw4Schema(sql=getSql()){await sql.query(`CREATE TABLE IF NOT EXISTS market_business_dw4_prediction (prediction_date date NOT NULL,tag_id text NOT NULL,model_version text NOT NULL,pred_dx numeric NOT NULL,pred_dy numeric NOT NULL,direction text NOT NULL,horizon integer NOT NULL DEFAULT 5,training_n_x integer NOT NULL,training_n_y integer NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(prediction_date,tag_id,model_version))`);}
async function predictDw4({sql=getSql(),date=null,persist=false,horizons=HORIZONS}={}){
  if(persist) await ensureDw4Schema(sql);
  const dr=await sql.query(`SELECT COALESCE($1::date,MAX(trade_date))::text d FROM w_topic_daily`,[date]);
  const pd=iso(dr?.[0]?.d);if(!pd)throw new Error('dW4：沒有 research history');
  const rows=await sql.query(`SELECT trade_date,tag_id,x AS x_score,y AS y_score,theme_flow_5_pct AS flow_5_pct,theme_return_1_pct AS return_1_pct FROM w_topic_daily WHERE trade_date <= $1::date ORDER BY tag_id,trade_date`,[pd]);
  const latest=new Map(),histByTag=new Map();
  for(const r of rows){const k=String(r.tag_id);if(!histByTag.has(k))histByTag.set(k,[]);histByTag.get(k).push(r);if(iso(r.trade_date)===pd)latest.set(k,r);}
  const requested=[...new Set((Array.isArray(horizons)?horizons:[horizons]).map(Number).filter(h=>HORIZONS.includes(h)))].sort((a,b)=>a-b);
  if(!requested.length)requested.push(HORIZON);
  const horizonResults={};
  for(const horizon of requested){
    const examples=buildExamples(rows,horizon),train=examples.filter(r=>r.trade_date>='2026-06-01'&&r.target_date<pd);
    const xModel=ridgeFit(train,['flow_5_pct'],'target_dx',X_ALPHA),yModel=ridgeFit(train,['y_score','return_1_pct','ret_m2','regime'],'target_dy',Y_ALPHA);
    if(!xModel||!yModel){horizonResults[horizon]={ok:false,horizon,error:'成熟訓練樣本不足',predictions:[]};continue;}
    const predictions=[];
    for(const [tagId,r] of latest){const a=histByTag.get(tagId),i=a.length-1,row={...r,ret_m2:i>=2?n(a[i-2].return_1_pct):null,regime:regime(pd)},dx=predict(xModel,row),dy=predict(yModel,row);if(dx===null||dy===null)continue;predictions.push({predictionDate:pd,tagId,predDx:dx,predDy:dy,direction:direction(dx,dy),horizon});}
    if(persist&&predictions.length){const mv=`${DW4_VERSION}-h${horizon}`,payload=predictions.map(p=>({prediction_date:p.predictionDate,tag_id:p.tagId,model_version:mv,pred_dx:p.predDx,pred_dy:p.predDy,direction:p.direction,horizon,training_n_x:xModel.n,training_n_y:yModel.n}));await sql.query(`WITH x AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(prediction_date date,tag_id text,model_version text,pred_dx numeric,pred_dy numeric,direction text,horizon int,training_n_x int,training_n_y int)) INSERT INTO market_business_dw4_prediction(prediction_date,tag_id,model_version,pred_dx,pred_dy,direction,horizon,training_n_x,training_n_y) SELECT prediction_date,tag_id,model_version,pred_dx,pred_dy,direction,horizon,training_n_x,training_n_y FROM x ON CONFLICT(prediction_date,tag_id,model_version) DO NOTHING`,[JSON.stringify(payload)]);}
    horizonResults[horizon]={ok:true,horizon,training:{x:xModel.n,y:yModel.n},predictions};
  }
  const primary=horizonResults[HORIZON]||horizonResults[requested[0]]||{predictions:[]};
  return {ok:Object.values(horizonResults).some(x=>x.ok),modelVersion:DW4_VERSION,predictionDate:pd,horizon:HORIZON,horizons:requested,centerGate:false,units:{x:X_UNIT,y:Y_UNIT},alpha:{x:X_ALPHA,y:Y_ALPHA},features:{x:['flow_5_pct'],y:['y_score','return_1_pct','ret_m2','regime']},training:primary.training||null,predictions:primary.predictions||[],horizonResults};
}
module.exports={DW4_VERSION,HORIZONS,HORIZON,X_UNIT,Y_UNIT,X_ALPHA,Y_ALPHA,DIRECTIONS,regime,direction,ridgeFit,predict,buildExamples,ensureDw4Schema,predictDw4};
