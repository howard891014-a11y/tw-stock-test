// StockZone: official MOPS historical quarterly EPS supplement (read-only; no database).
// MOPS individual-company income statements generally publish standalone Q1–Q3
// EPS in the first data column (and YTD in a third column for Q2/Q3). Q4 is
// annual cumulative EPS and must be differenced against Q3 YTD.
// Never subtract Q1 from an already standalone Q2 EPS.
'use strict';

const MOPS_HOSTS = ['https://mopsov.twse.com.tw', 'https://mops.twse.com.tw'];
const TIMEOUT_MS = 7000;

function num(v) {
  const s = String(v ?? '').replace(/[\s\u00a0,]/g, '').replace(/−/g, '-').trim();
  if (!s || /^(?:-|--|—|N\/A|不適用|無)$/i.test(s)) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function decode(text) {
  return String(text || '').replace(/&(?:nbsp|#160|#xA0);/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)));
}
function visible(html) {
  return decode(String(html || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/[\s\u00a0　]+/g, ' ').trim();
}
function extractEpsValues(html) {
  if (!html || typeof html !== 'string') return null;
  // Only the EPS row is valid. No loose text search; an unrelated number must not become EPS.
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(x => visible(x[1]));
    if (cells.length < 2) continue;
    for (let i = 0; i < cells.length - 1; i++) {
      const label = cells[i].replace(/[\s　（）()]/g, '');
      if (!/^(?:基本每股盈餘|基本每股盈餘合計|基本每股盈餘總計|基本每股盈餘淨額)(?:元)?$/.test(label)) continue;
      const raw = cells.slice(i+1).map(num);
      if(raw[0]===null)return null; // Never shift a prior-year EPS into this-year column.
      const values=raw.filter(Number.isFinite);
      return values.length ? values : null;
    }
  }
  return null;
}
function extractReportEps(html, quarter) {
  const v=extractEpsValues(html);
  if(!v) return null;
  if(quarter===1) return {quarter:v[0],ytd:v[0],columns:v.length};
  if(quarter===2 || quarter===3) {
    // Column order on current MOPS statement: quarter, last year's same quarter,
    // current YTD, last year's YTD. If unavailable, REFUSE to guess the period.
    if(v.length<4)return null;
    return {quarter:v[0],ytd:v[2],columns:v.length};
  }
  if(quarter===4) return {quarter:null,ytd:v[0],columns:v.length};
  return null;
}
// Kept only for older parser validation; first EPS value is NOT always YTD.
function extractCumulativeEps(html) {return extractEpsValues(html)?.[0]??null;}

function reportPeriod(s) {
  const m = String(s || '').match(/^(20\d{2})\s*[-/]?\s*[Qq]\s*([1-4])$/);
  return m ? {year: Number(m[1]), quarter: Number(m[2])} : null;
}
function quarterKey(y, q) { return `${y}Q${q}`; }
function priorQuarter(y, q) { return q > 1 ? {year:y, quarter:q-1} : {year:y-1, quarter:4}; }
function lastNQuarters(year, quarter, n=8) {
  const out=[];
  for(let i=0; i<n; i++) {out.push({year,quarter}); const p=priorQuarter(year,quarter);year=p.year;quarter=p.quarter;}
  return out;
}
async function fetchMopsHtml(code, year, quarter, host=MOPS_HOSTS[0]) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      encodeURIComponent:'1',step:'1',firstin:'1',off:'1',
      queryName:'co_id',inpuType:'co_id',TYPEK:'all',isnew:'false',
      co_id:String(code),year:String(year-1911),season:String(quarter).padStart(2,'0')
    });
    const r = await fetch(`${host}/mops/web/ajax_t164sb04`,{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
        Accept:'text/html,*/*','User-Agent':'Mozilla/5.0 (compatible; StockZone-Fundamentals/1.0)'},
      body:params.toString(),signal:ac.signal,redirect:'follow'
    });
    if(!r.ok) throw new Error(`MOPS HTTP ${r.status}`);
    const html=await r.text();
    if(html.length>3_000_000)throw new Error('MOPS report size exceeds limit');
    const value=extractReportEps(html,quarter);
    if(!value)throw new Error('MOPS EPS columns absent or report not released');
    return value;
  } finally {clearTimeout(timer);}
}
async function officialQuarterReport(code, year, quarter) {
  let last;
  for (const host of MOPS_HOSTS) {
    try {return await fetchMopsHtml(code,year,quarter,host);}
    catch(e) {last=e;}
  }
  throw last || new Error('MOPS unavailable');
}
function numericEpsByKey(rows) {
  const map=new Map();
  for(const r of rows||[]) {
    const p=reportPeriod(r.period); const v=num(r.eps);
    if(p&&v!==null) map.set(quarterKey(p.year,p.quarter),v);
  }
  return map;
}
function epsPairReady(rows, target) {
  if(!target)return false;
  const map=numericEpsByKey(rows);
  return map.has(quarterKey(target.year,target.quarter)) && map.has(quarterKey(target.year-1,target.quarter));
}
async function supplementMissingEps({code,period,rows=[]}) {
  const target=reportPeriod(period);
  if(!/^\d{4,6}$/.test(String(code||''))||!target)return {rows:[],attempted:false,reason:'invalid report period'};
  const known=numericEpsByKey(rows);
  const periods=lastNQuarters(target.year,target.quarter,8);
  const need=periods.filter(p=>!known.has(quarterKey(p.year,p.quarter)));
  if(!need.length)return {rows:[],attempted:false,reason:'no missing quarter'};

  // Probe one report first; if MOPS is blocked, do NOT hammer it with eight concurrent requests.
  const reports=new Map();
  let probe;
  try {
    probe=await officialQuarterReport(code,target.year,target.quarter);
    reports.set(quarterKey(target.year,target.quarter),probe);
  }catch(e){return {rows:[],attempted:true,reason:'MOPS unavailable or latest report absent',error:String(e?.message||e)};}

  // Standalone Q2/Q3 come directly from the current-quarter column.
  // Q4 is a full-year cumulative figure; obtain the prior Q3 YTD before deriving Q4.
  const request=new Map();
  for (const p of need) {
    request.set(quarterKey(p.year,p.quarter),p);
    if(p.quarter===4)request.set(quarterKey(p.year,3),{year:p.year,quarter:3});
  }
  request.delete(quarterKey(target.year,target.quarter));
  const jobs=[...request.values()];
  for(let i=0;i<jobs.length;i+=3) {
    await Promise.all(jobs.slice(i,i+3).map(async p=>{
      try {reports.set(quarterKey(p.year,p.quarter),await officialQuarterReport(code,p.year,p.quarter));}
      catch(_) {} // Not yet listed, not filed or temporarily blocked. Never invent a value.
    }));
  }
  const supplement=[];
  for(const p of need) {
    const key=quarterKey(p.year,p.quarter),report=reports.get(key);
    if(!report)continue;
    const prevQ3=p.quarter===4?reports.get(quarterKey(p.year,3))?.ytd:null;
    const quarterly=p.quarter===4?(Number.isFinite(prevQ3)?report.ytd-prevQ3:null):report.quarter;
    if(!Number.isFinite(quarterly))continue;
    supplement.push({period:`${p.year} Q${p.quarter}`,year:p.year,quarterNo:p.quarter,
      eps:Number(quarterly.toFixed(4)),epsSource:'MOPS official company income statement (single-quarter EPS)',
      sourceType:'official-historical'});
  }
  return {rows:supplement,attempted:true,reason:supplement.length?'official historical EPS filled':'official quarters missing',
    requested:jobs.length+1,filled:supplement.length};
}
module.exports={extractCumulativeEps,extractReportEps,reportPeriod,quarterKey,priorQuarter,numericEpsByKey,epsPairReady,supplementMissingEps};
