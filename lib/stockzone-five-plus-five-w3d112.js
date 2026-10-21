'use strict';
/**
 * W3-D.1.2 -> original five-plus-five research-policy wiring.
 * Refuses missing, stale or incomplete W3 model inputs. NEVER invents a state.
 * The frozen W3 engine itself is byte-identical to the W3-D.1.2 handoff.
 * Only an explicit input timeline and T-day stock-tag universe are accepted.
 * No live pipeline, no automatic buy/sell, no historical backfill here.
 */
const {computeW3D112}=require('./w3-d112');
const {selectFivePlusFiveDaily,forSimulationLedger}=require('./stockzone-five-plus-five');

function visibleFromFrozenRecord(record){
 if(!record||record.modelVersion!=='W3-D.1.2'||!record.valid||record.inputQuality!=='complete')
  throw Error('W3-D.1.2 T-day source is not complete and verified: no recommendations');
 if(record.regime==='RiskOff')return 'RiskOff';
 if(record.regime==='RiskOn')return record.warning?'Warning':'RiskOn';
 throw Error('Unexpected W3-D.1.2 ON/OFF regime');
}
function selectFivePlusFiveWithW3D112(asOfRawTags,marketInputs,{asOfDate,scenario='original_all'}={}){
 if(!Array.isArray(marketInputs)||!marketInputs.length)
  throw Error('W3-D.1.2 requires chronological market source inputs');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate||'')))throw Error('Valid asOfDate required');
 const model=computeW3D112(marketInputs);
 const last=model.records.at(-1);
 if(!last||last.date!==asOfDate)
  throw Error('T-day W3-D.1.2 source mismatch: refusing to use a prior-day or future-day state');
 const visible=visibleFromFrozenRecord(last);
 const ratio=last.advanceRatio;
 const selection=selectFivePlusFiveDaily(asOfRawTags,visible,ratio,{asOfDate,scenario});
 return {...selection,
  w3ModelVersion:model.version,
  w3RiskScore:last.score,
  w3InputDate:last.date,
  w3Warning:last.warning,
  w3WarningActive:last.warningActive,
  w3OffCovered:last.offCovered,
  w3InputQuality:last.inputQuality,
  w3Visible:visible,
  dataLineage:'W3-D.1.2 frozen JS + explicit as-of market inputs + T-day tagged candidates',
 };
}
function simulationRecordFromW3D112(selection){
 if(selection?.w3ModelVersion!=='W3-D.1.2')throw Error('Expected W3-D.1.2 linked selection');
 return {...forSimulationLedger(selection),w3ModelVersion:selection.w3ModelVersion,
  w3InputDate:selection.w3InputDate,w3InputQuality:selection.w3InputQuality,
  w3RiskScore:selection.w3RiskScore,w3Visible:selection.w3Visible};
}
module.exports={visibleFromFrozenRecord,selectFivePlusFiveWithW3D112,simulationRecordFromW3D112};
