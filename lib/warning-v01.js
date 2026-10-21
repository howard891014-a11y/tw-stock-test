'use strict';

/**
 * StockZone Warning V0.1 — research-only, not the original W3-D.1.1 formula.
 * Run ONLY on ascending dated rows, containing columns:
 * date, taiex, advance_ratio, breadth5,
 * institutional_value_twd, financing_value_twd, z_flow20, off_regime.
 * `off_regime` is supplied externally by an immutable main W3 ON/OFF model.
 * All model decisions use same-day or earlier values; future prices only in assessSignals().
 */
const AVG = a => a.reduce((s,x) => s+x, 0)/a.length;
const STD_POP = a => { const m=AVG(a); return Math.sqrt(AVG(a.map(v => (v-m)**2))); };
const toNum = v => v === null || v === undefined ? NaN : Number(v);
const PCT = (a,b) => 100*(a/b-1);

function computeWarningV01(rows) {
  const out = [];
  for (let i=0; i<rows.length; i++) {
    const r=rows[i], result={date:r.date, eligible:false, raw_warning:false,
      warning:false, off_covered:false, path:null, factors:null};
    out.push(result);
    if (i<20) continue;
    const win = rows.slice(i-20,i+1);
    const required = win.map(q=>[q.institutional_value_twd,q.financing_value_twd,q.taiex])
      .flat().concat([r.advance_ratio,r.breadth5,r.z_flow20]);
    if (required.some(v=>!Number.isFinite(toNum(v)))) continue;
    const F = win.map(q=>toNum(q.institutional_value_twd));
    const sd20=STD_POP(F.slice(0,20));
    if (sd20<=0) continue;
    const F5=AVG(F.slice(-5));
    const F5previous=AVG(F.slice(-10,-5));
    const delta5Z=(F5-F5previous)/sd20;
    const financing10=PCT(toNum(r.financing_value_twd),
      toNum(rows[i-10].financing_value_twd));
    const gapHigh10=PCT(toNum(r.taiex),
      Math.max(...rows.slice(i-9,i+1).map(q=>toNum(q.taiex))));
    const dailyReturn=PCT(toNum(r.taiex),toNum(rows[i-1].taiex));
    const advance=toNum(r.advance_ratio),breadth5=toNum(r.breadth5),flowZ=toNum(r.z_flow20);

    // Route A: warning near a high, when both market participation and funds weaken.
    const early=(breadth5<45 && advance<50 && financing10>5 &&
      delta5Z<=-0.50 && gapHigh10>=-1);
    // Route B: faster downside risk, such as heavy institutional selling and leveraged positioning.
    const fast=(flowZ<=-2 && financing10>=12 && dailyReturn<=-1 && gapHigh10>=-2.5);
    result.eligible=true;
    result.raw_warning=early || fast;
    result.off_covered=result.raw_warning && r.off_regime==='RiskOff';
    result.warning=result.raw_warning && !result.off_covered;
    result.path=early && fast?'early+fast':early?'early':fast?'fast':null;
    result.factors={breadth5,advance,financing10,delta5Z,gapHigh10,dailyReturn,flowZ};
  }
  return out;
}

function assessSignals(rows, signals, horizon=10) {
  return signals.filter(r=>r.raw_warning).map(r=>{
    const i=rows.findIndex(q=>q.date===r.date);
    const tail=rows.slice(i+1,i+horizon+1);
    const observed=tail.length===horizon && tail.every(q=>Number.isFinite(toNum(q.taiex)));
    const min=observed?Math.min(...tail.map(q=>toNum(q.taiex))):null;
    return {...r, next10_min_decline_pct:observed?PCT(min,toNum(rows[i].taiex)):null};
  });
}

module.exports={computeWarningV01,assessSignals};
