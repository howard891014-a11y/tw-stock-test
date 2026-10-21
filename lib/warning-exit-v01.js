'use strict';

/**
 * StockZone Warning Exit V0.1 — an INDEPENDENT warning exit formula.
 *
 * Input is an ascending dated array, with at least:
 *   date, taiex, advance_ratio, breadth5, institutional_value_twd, off_regime
 *
 * Prerequisite: warning_active already TRUE from an independently-produced
 * entry signal. This module does NOT use entry score, entry factors, or
 * whether the entry conditions are still true. It does not change ON/OFF.
 *
 * One day of warning means after that day's closing calculation; a release
 * on a subsequent close makes the warning invisible on that release date.
 */

const finite = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const numeric = v => finite(v) ? Number(v) : NaN;
const mean = v => v.reduce((s, x) => s + x, 0) / v.length;

/** Evaluates EXIT ONLY when warning is already active. */
function computeWarningExitV01(rows, index, warningActive, startIndex) {
  const r = rows?.[index];
  const none = { evaluated:false, exit:false, reason:null, factors:null };
  if (!warningActive || !r || !Number.isInteger(index) ||
      !Number.isInteger(startIndex) || index <= startIndex || index < 1) {
    return none;
  }
  const prior = rows[index - 1];
  if (![r.taiex, prior.taiex, r.advance_ratio, r.breadth5,
        r.institutional_value_twd].every(finite)) {
    return none;  // Missing essential observations must not cause false release.
  }
  const close = numeric(r.taiex);
  const prevClose = numeric(prior.taiex);
  if (close <= 0 || prevClose <= 0) return none;

  const ret1 = 100 * (close / prevClose - 1);
  const adv = numeric(r.advance_ratio);
  const br = numeric(r.breadth5);
  const flow = numeric(r.institutional_value_twd);

  // Exit route A: a strong one-day rebound with broad market participation
  // and positive institutional flow. Does NOT require the warning entry
  // conditions to disappear, nor any fixed days-in-warning timeout.
  const strongRebound = ret1 >= 1.8 && adv >= 65 && flow > 0;

  // Exit route B: gradual, broad-based repair. Independent evidence for exit
  // even when there is no single +1.8% rebound.
  let ma5 = NaN;
  if (index >= 4 && rows.slice(index - 4, index + 1).every(x => finite(x.taiex))) {
    ma5 = mean(rows.slice(index - 4, index + 1).map(x => numeric(x.taiex)));
  }
  const broadRepair = Number.isFinite(ma5) && close >= ma5 &&
    br >= 45 && adv >= 65 && flow > 0 && ret1 >= 0.6;

  const exit = strongRebound || broadRepair;
  return {
    evaluated:true,
    exit,
    reason:strongRebound ? 'strong_rebound' : broadRepair ? 'broad_repair' : null,
    factors:{ret1, advance_ratio:adv, breadth5:br,
      institutional_value_twd:flow, ma5, strongRebound, broadRepair},
  };
}

/**
 * Orchestration only: combine two *independent* modules.
 * - `entryResults` comes from unchanged warning-v01.js, aligned to `rows`.
 * - when inactive, only entryResults[i].raw_warning may start a warning.
 * - when active, only computeWarningExitV01 may end that warning.
 * - OFF only masks presentation; it NEVER changes the warning formula.
 * - exit has priority over any same-day fresh entry (no oscillation).
 * - no look-ahead: uses same-day close and prior market data only.
 */
function runWarningLifecycleV01(rows, entryResults) {
  if (!Array.isArray(rows) || !Array.isArray(entryResults) ||
      rows.length !== entryResults.length) {
    throw new Error('rows and entryResults must be aligned arrays');
  }
  let active = false;
  let startIndex = -1;
  let startPrice = NaN;
  const daily = [], episodes = [];
  let episode = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], input = entryResults[i];
    if (String(row.date) !== String(input.date)) {
      throw new Error(`Date mismatch at index ${i}`);
    }

    const wasActive = active;
    const exitEval = computeWarningExitV01(rows, i, active, startIndex);
    let event = null;

    if (wasActive && exitEval.exit) {
      active = false;
      event = 'exit';
      episode.exit_date = row.date;
      episode.exit_reason = exitEval.reason;
      episode.active_days = i - startIndex; // start inclusive, exit exclusive
      episode.exit_close = numeric(row.taiex);
      episode.exit_vs_entry_pct = 100 * (episode.exit_close / startPrice - 1);
      episode = null;
      startIndex = -1;
      startPrice = NaN;
    } else if (!wasActive && input.raw_warning === true) {
      active = true;
      startIndex = i;
      startPrice = numeric(row.taiex);
      event = 'enter';
      episode = {start_date:row.date, entry_close:startPrice,
        entry_path:input.path, exit_date:null, exit_reason:null,
        active_days:null, exit_close:null, exit_vs_entry_pct:null};
      episodes.push(episode);
    }

    const masked = active && row.off_regime === 'RiskOff';
    daily.push({
      date:row.date,
      warning_active:active,
      visible_warning:active && !masked,
      off_covered:masked,
      off_regime:row.off_regime,
      event,
      exit_reason:event==='exit' ? exitEval.reason : null,
      raw_entry_signal:input.raw_warning === true,
    });
  }
  // Open episodes are represented by null exit_date / active_days.
  return {daily, episodes};
}

module.exports = {computeWarningExitV01,runWarningLifecycleV01};
