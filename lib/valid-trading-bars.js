// v2.6.8.26 — Yahoo daily-chart session guard (no database writes).
// Yahoo can emit a holiday/placeholder candle with an OHLC close and volume 0.
// An equity with no reported traded shares is not a valid session for indicators.
function finitePositive(value){
  if(value===null||value===undefined||value==='')return false;
  const n=Number(value);return Number.isFinite(n)&&n>0;
}
export function validTradingBars(rows,{requireVolume=true}={}){
  const seen=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    const d=String(row?.date??'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d))continue;
    if(![row.open,row.high,row.low,row.close].every(finitePositive))continue;
    const o=Number(row.open),h=Number(row.high),l=Number(row.low),c=Number(row.close);
    if(h<Math.max(o,c,l)||l>Math.min(o,c,h))continue;
    // Missing / NaN / 0 volume are not evidence of a traded equity session.
    if(requireVolume&&!finitePositive(row.volume))continue;
    // Same-day duplicate records: use the last valid observation, never a phantom.
    seen.set(d,row);
  }
  return [...seen.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
