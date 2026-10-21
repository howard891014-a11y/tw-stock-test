'use strict';
/**
 * StockZone W3-D.1.2 — FROZEN 2026-10-20.
 * Compose three independent layers:
 * 1. Main ON/OFF: original W3-D.1.1 code with 20D+5D institutional-deduction
 *    confirmation applied only to the progressive OFF trigger.
 * 2. Entry: byte-identical warning-v01.js (A/B entry routes).
 * 3. Exit: byte-identical warning-exit-v01.js (strong rebound / broad repair).
 *
 * OFF masks warning display but does NOT prevent the independent lifecycle
 * from operating. Warning NEVER changes market regime.
 * Every output uses data available at THAT trading day's close or earlier.
 */
const {computeW3D112OnOff}=require('./w3-d112-onoff');
const {computeWarningV01}=require('./warning-v01');
const {runWarningLifecycleV01}=require('./warning-exit-v01');

const numeric=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;

function computeW3D112(input){
  if(!Array.isArray(input))throw new Error('W3-D.1.2 requires an array of market days');
  // The exact ON/OFF fork validates dates and reproduces original D.1.1 inputs.
  const onoff=computeW3D112OnOff(input);
  const feed=input.map((r,i)=>{
    const state=onoff.records[i];
    return {
      date:state.date,
      taiex:numeric(r.taiex??r.close),
      advance_ratio:numeric(r.advance_ratio??r.advance),
      breadth5:numeric(r.breadth5??r.breadth_5),
      institutional_value_twd:numeric(r.institutional_value_twd??r.inst_value_twd??r.institutionalValue),
      financing_value_twd:numeric(r.financing_value_twd??r.financingMV),
      z_flow20:state.flowZ20,
      off_regime:state.regime,
    };
  });
  const entries=computeWarningV01(feed);
  const lifecycle=runWarningLifecycleV01(feed,entries);
  const records=onoff.records.map((main,i)=>{
    const life=lifecycle.daily[i],entry=entries[i];
    return {...main,modelVersion:'W3-D.1.2',
      warning:life.visible_warning,
      warningActive:life.warning_active,
      offCovered:life.off_covered,
      warningEvent:life.event,
      warningExitReason:life.exit_reason,
      warningEntryRaw:entry.raw_warning,
      warningEntryPath:entry.path,
      warningEntryEligible:entry.eligible,
      warningFactors:entry.factors};
  });
  return {
    version:'W3-D.1.2',
    frozenOn:'2026-10-20',
    mainModel:'W3-D.1.1 + 20D/5D institutional-deduction progressive-OFF gate',
    warningEntryModel:'warning-v01',warningExitModel:'warning-exit-v01',
    records,
    switches:onoff.switches,
    episodes:lifecycle.episodes,
    warnings:records.filter(x=>x.warning).map(x=>({date:x.date,score:x.score})),
    offCovered:records.filter(x=>x.offCovered).map(x=>({date:x.date})),
    lastInputDate:onoff.lastInputDate,
    validDays:onoff.validDays,
    summary:{days:records.length,validDays:onoff.validDays,
      onOffSwitches:onoff.switches.length,
      warningEpisodes:lifecycle.episodes.length,
      visibleWarningDays:records.filter(x=>x.warning).length,
      offCoveredDays:records.filter(x=>x.offCovered).length},
  };
}
module.exports={computeW3D112};
