// StockZone v2.6.7.5 — read-only production dW4 readiness diagnostics.
// Checks predictions against the active 203-tag membership map; does not infer accuracy.
const HORIZONS=[5,10,15,20];
const DIRECTIONS=new Set(require('./dw4').DIRECTIONS);
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const iso=v=>String(v||'').slice(0,10);
function summarizeDw4Audit(model, members, expectedDate=null){
  const active=new Map((members||[]).map(r=>[String(r.tag_id||r.tagId||''),Number(r.members??r.n??0)]));
  const eligible=[...active].filter(([,n])=>n>=3).map(([tag])=>tag),eligibleSet=new Set(eligible);
  const horizonResults={};
  for(const h of HORIZONS){
    const entry=model?.horizonResults?.[h]||model?.horizonResults?.[String(h)]||null;
    const predictions=Array.isArray(entry?.predictions)?entry.predictions:[];
    const seen=new Set();let valid=0,invalid=0,extra=0,below3=0,duplicates=0;
    for(const r of predictions){
      const tag=String(r?.tagId||'');
      if(!active.has(tag)){extra++;continue;}
      if(!eligibleSet.has(tag)){below3++;continue;}
      if(seen.has(tag)){duplicates++;continue;}
      seen.add(tag);
      if(finite(r?.predDx)&&finite(r?.predDy)&&DIRECTIONS.has(r?.direction)&&Number(r?.horizon)===h&&iso(r?.predictionDate)===iso(model?.predictionDate))valid++;
      else invalid++;
    }
    const coverage=eligible.length?Math.round(valid/eligible.length*1000)/10:0;
    const trainingX=Number(entry?.training?.x||0),trainingY=Number(entry?.training?.y||0);
    const ready=Boolean(entry?.ok&&trainingX>=20&&trainingY>=20&&eligible.length&&coverage>=90&&invalid===0&&duplicates===0);
    horizonResults[h]={ready,available:Boolean(entry?.ok),predictions:predictions.length,validEligible:valid,eligibleCount:eligible.length,coveragePct:coverage,unmatchedHistoryTags:extra,below3Tags:below3,invalid,duplicates,trainingX,trainingY,historicalFoldN:Number(entry?.calibration?.n||0),historicalDirectionHitPct:finite(entry?.calibration?.overall)?Number(entry.calibration.overall):null,error:entry?.error||null};
  }
  const modelDate=iso(model?.predictionDate),expected=iso(expectedDate)||null,dateAligned=expected?modelDate===expected:Boolean(modelDate);
  const allReady=Boolean(model?.ok&&dateAligned&&HORIZONS.every(h=>horizonResults[h].ready));
  return {ok:allReady,modelReady:Boolean(model?.ok),modelVersion:model?.modelVersion||'',predictionDate:modelDate,expectedDate:expected,dateAligned,activeTags:active.size,eligibleTags:eligible.length,minTechnicalCoveragePct:90,horizons:HORIZONS,horizonResults,readOnly:true,note:'本驗收判定資料可用性；歷史方向命中率如有顯示，來自 dW4 當次歷史分段校準，並非實盤或未來績效保證。舊 Path Top1/Top2 不參與驗收。'};
}
module.exports={summarizeDw4Audit};
