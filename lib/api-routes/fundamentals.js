// StockZone v2.6.1.25
// Fundamental-only route. This file intentionally does not import or modify disposal logic.

const TWSE_BASE = "https://openapi.twse.com.tw/v1/opendata";
const TPEX_BASE = "https://www.tpex.org.tw/openapi/v1";
const MOPS_CSV_BASE = "https://mopsfin.twse.com.tw/opendata";

const INCOME_TYPES = [
  ["ci", "一般業", true],
  ["basi", "金融業", false],
  ["bd", "證券期貨業", false],
  ["fh", "金控業", false],
  ["ins", "保險業", false],
  ["mim", "異業", false],
];

function cleanCode(v) {
  return String(v || "").replace(/\.(TW|TWO)$/i, "").trim();
}

function scalar(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, "").replace(/％/g, "%").trim();
  if (!s || s === "-" || s === "--" || s === "N/A" || s === "不適用") return null;
  const n = Number(s.endsWith("%") ? s.slice(0, -1) : s);
  return Number.isFinite(n) ? n : null;
}

function normalizeFieldKey(v) {
  return String(v || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\s　]/g, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/％/g, "%")
    .trim();
}

function first(row, keys) {
  if (!row || typeof row !== "object") return null;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
  }
  const wanted = new Set(keys.map(normalizeFieldKey));
  for (const [rk, rv] of Object.entries(row)) {
    if (!wanted.has(normalizeFieldKey(rk))) continue;
    if (rv !== null && rv !== undefined && String(rv).trim() !== "") return rv;
  }
  return null;
}

function num(row, keys) {
  return scalar(first(row, keys));
}

function codeOf(row) {
  return cleanCode(first(row, ["公司代號", "公司代碼", "公司代號 ", "Code", "code", "CompanyCode", "SecuritiesCompanyCode", "SecuritiesCode", "stock_id", "symbol"]));
}

function rowPeriodStamp(row) {
  const yRaw = scalar(first(row, ["年度", "year", "Year"]));
  const qRaw = scalar(first(row, ["季別", "quarter", "Quarter"]));
  if (yRaw !== null && qRaw !== null) {
    const y = yRaw < 1911 ? yRaw + 1911 : yRaw;
    return y * 10 + qRaw;
  }
  const ym = String(first(row, ["資料年月", "年月", "period"]) || "").replace(/\D/g, "");
  if (/^\d{5}$/.test(ym)) return (Number(ym.slice(0, 3)) + 1911) * 100 + Number(ym.slice(3));
  if (/^\d{6}$/.test(ym)) return Number(ym.slice(0, 4)) * 100 + Number(ym.slice(4));
  return -Infinity;
}

function findCode(rows, code) {
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter((r) => codeOf(r) === code);
  if (!matches.length) return null;
  return matches.sort((a, b) => rowPeriodStamp(b) - rowPeriodStamp(a))[0] || null;
}

function rocYearToAd(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1911 ? n + 1911 : n;
}
function statementYearQuarter(row) {
  const period = periodText(row);
  const match = String(period).match(/(\d{4})\s*[Qq]([1-4])/);
  const year = rocYearToAd(first(row, ["年度", "year", "Year"])) ?? (match ? Number(match[1]) : null);
  const quarter = scalar(first(row, ["季別", "quarter", "Quarter"])) ?? (match ? Number(match[2]) : null);
  return {year, quarterNo:quarter};
}

function periodText(row) {
  if (!row) return "";
  const y = rocYearToAd(first(row, ["年度", "year", "Year"]));
  const q = Number(first(row, ["季別", "quarter", "Quarter"]));
  if (Number.isFinite(y) && q >= 1 && q <= 4) return `${y} Q${q}`;
  const ym = String(first(row, ["資料年月", "年月", "period"]) || "").trim();
  if (/^\d{5}$/.test(ym)) return `${Number(ym.slice(0, 3)) + 1911}-${ym.slice(3)}`;
  if (/^\d{6}$/.test(ym)) return `${ym.slice(0, 4)}-${ym.slice(4)}`;
  return ym;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "StockZone/2.6.1.22",
      },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const ct = String(r.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html")) throw new Error("official API redirected to HTML");
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("official payload is not an array");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== '\r') field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((x) => String(x || "").replace(/^\uFEFF/, "").trim());
  return rows.filter((r) => r.some((v) => String(v || "").trim() !== "")).map((r) => {
    const out = {};
    headers.forEach((h, i) => { if (h) out[h] = r[i] ?? ""; });
    return out;
  });
}

async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/csv,text/plain,*/*",
        "User-Agent": "StockZone/2.6.1.22",
      },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const text = await r.text();
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("official CSV is empty");
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOfficialRows(jsonUrl, csvUrl) {
  try {
    const rows = await fetchJson(jsonUrl);
    if (rows.length) return rows;
  } catch (e) {
    console.warn(`[fundamentals] JSON fallback to CSV: ${jsonUrl}`, e?.message || e);
  }
  if (!csvUrl) return [];
  return await fetchCsv(csvUrl);
}

async function fetchOfficialMatch(source, code) {
  const jsonUrl = source?.json;
  const csvUrl = source?.csv;
  if (jsonUrl) {
    try {
      const rows = await fetchJson(jsonUrl);
      const found = findCode(rows, code);
      if (found) return found;
      console.warn(`[fundamentals] code ${code} not matched in JSON, trying CSV: ${jsonUrl}`);
    } catch (e) {
      console.warn(`[fundamentals] JSON failed, trying CSV: ${jsonUrl}`, e?.message || e);
    }
  }
  if (csvUrl) {
    try {
      const rows = await fetchCsv(csvUrl);
      return findCode(rows, code);
    } catch (e) {
      console.warn(`[fundamentals] CSV failed: ${csvUrl}`, e?.message || e);
    }
  }
  return null;
}

function marketOrder(market) {
  const m = String(market || "").toLowerCase();
  if (/上櫃|otc|tpex|two/.test(m)) return ["TPEX", "TWSE"];
  if (/上市|twse|sii/.test(m)) return ["TWSE", "TPEX"];
  return ["TWSE", "TPEX"];
}

function urlsFor(exchange) {
  if (exchange === "TWSE") {
    return {
      revenue: { json: `${TWSE_BASE}/t187ap05_L`, csv: `${MOPS_CSV_BASE}/t187ap05_L.csv` },
      margin: { json: `${TWSE_BASE}/t187ap17_L`, csv: `${MOPS_CSV_BASE}/t187ap17_L.csv` },
      income: INCOME_TYPES.map(([type]) => [type, { json: `${TWSE_BASE}/t187ap06_L_${type}`, csv: `${MOPS_CSV_BASE}/t187ap06_L_${type}.csv` }]),
    };
  }
  return {
    revenue: { json: `${TPEX_BASE}/mopsfin_t187ap05_O`, csv: `${MOPS_CSV_BASE}/t187ap05_O.csv` },
    margin: { json: `${TPEX_BASE}/mopsfin_187ap17_O`, csv: `${MOPS_CSV_BASE}/t187ap17_O.csv` },
    income: INCOME_TYPES.map(([type]) => [type, { json: `${TPEX_BASE}/mopsfin_t187ap06_O_${type}`, csv: `${MOPS_CSV_BASE}/t187ap06_O_${type}.csv` }]),
  };
}

async function resolveExchange(exchange, code) {
  const urls = urlsFor(exchange);
  const [revenueResult, marginResult] = await Promise.allSettled([
    fetchOfficialMatch(urls.revenue, code),
    fetchOfficialMatch(urls.margin, code),
  ]);

  const revenueRow = revenueResult.status === "fulfilled" ? revenueResult.value : null;
  const marginRow = marginResult.status === "fulfilled" ? marginResult.value : null;

  // Only download income-statement families after this exchange actually contains the company.
  if (!revenueRow && !marginRow) return null;

  let incomeRow = null;
  let incomeType = null;
  // Most listed/OTC companies are general industry. Try that feed first; only fan out to
  // financial / securities / holding / insurance / mixed feeds when necessary.
  const generalIncome = urls.income.find(([type]) => type === "ci");
  if (generalIncome) {
    try {
      incomeRow = await fetchOfficialMatch(generalIncome[1], code);
      if (incomeRow) incomeType = "ci";
    } catch (_) {}
  }
  if (!incomeRow) {
    const rest = urls.income.filter(([type]) => type !== "ci");
    const incomeResults = await Promise.allSettled(rest.map(([, source]) => fetchOfficialMatch(source, code)));
    for (let i = 0; i < incomeResults.length; i++) {
      const r = incomeResults[i];
      if (r.status !== "fulfilled") continue;
      const found = r.value;
      if (found) {
        incomeRow = found;
        incomeType = rest[i][0];
        break;
      }
    }
  }

  const typeMeta = INCOME_TYPES.find(([t]) => t === incomeType) || [incomeType || "unknown", "一般業", true];
  return { exchange, revenueRow, marginRow, incomeRow, incomeType, typeMeta };
}

const HISTORICAL_MARGIN_URL = "https://mopsov.twse.com.tw/mops/web/ajax_t163sb06";
const historicalMarginCache = new Map();

const {brotliDecompressSync} = require("node:zlib");
// MOPS 2025 Q2 official cumulative gross/operating margins, 0.1 percentage-point precision.
// 7-byte records: 1-byte market (0=TWSE, 1=TPEx), uint16 stock code,
// signed int16 gross*10, signed int16 operating*10. Only the specified period is used.
const HISTORICAL_MOPS_2025_Q2_BROTLI = 
  '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';
let historicalMops2025Q2 = null;
function officialMops2025Q2(stockCode, market) {
  if (historicalMops2025Q2 === null) {
    const data = brotliDecompressSync(Buffer.from(HISTORICAL_MOPS_2025_Q2_BROTLI,"base64"));
    if (data.length % 7 !== 0) throw Error("Invalid 2025 Q2 official margin snapshot");
    const values = new Map();
    for (let i=0; i<data.length; i+=7) {
      const key=`${data.readUInt8(i)===1?"otc":"sii"}:${data.readUInt16BE(i+1)}`;
      values.set(key,{grossMargin:data.readInt16BE(i+3)/10,operatingMargin:data.readInt16BE(i+5)/10});
    }
    historicalMops2025Q2 = values;
  }
  return historicalMops2025Q2.get(`${market}:${String(stockCode)}`) || null;
}


function parseHistoricalMarginTable(html) {
  const body = String(html || "");
  if (!body.includes("公司代號") || !body.includes("毛利率") || !body.includes("營業利益率")) return new Map();
  const records = new Map();
  const clean = s => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim();
  for (const match of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(x => clean(x[1]));
    if (cells.length < 5 || !/^\d{4,6}$/.test(cells[0])) continue;
    const gross = scalar(cells[3]), operating = scalar(cells[4]);
    if (gross === null && operating === null) continue;
    records.set(cells[0], {grossMargin: gross, operatingMargin: operating});
  }
  return records;
}

async function previousYearMarginStatement(exchange, statement, code) {
  if (statement?.marginApplicable === false) return null;
  const year = Number(statement?.year), quarter = Number(statement?.quarterNo);
  if (!(year >= 2000 && quarter >= 1 && quarter <= 4)) return null;
  const earlierYear = year - 1, market = exchange === "TPEX" ? "otc" : "sii";
  // Vercel serverless cannot reliably reach mopsov.twse.com.tw. Prefer a verified
  // official 2025Q2 whole-market snapshot only when the periods match exactly.
  if (earlierYear === 2025 && quarter === 2) {
    const snapshot = officialMops2025Q2(code, market);
    if (snapshot) return {period:"2025 Q2",year:2025,quarterNo:2,
      marginSource:"official",sourceType:"official",grossMargin:snapshot.grossMargin,
      operatingMargin:snapshot.operatingMargin,
      source:"MOPS官方2025 Q2同季累計營益快照（0.1百分點）"};
  }
  const key = `${market}:${earlierYear}Q${quarter}`;
  let cached = historicalMarginCache.get(key);
  if (!cached || cached.until < Date.now()) {
    const form = new URLSearchParams({encodeURIComponent:"1",step:"1",firstin:"1",off:"1",TYPEK:market,year:String(earlierYear-1911),season:String(quarter)});
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    let rows = new Map();
    try {
      const response = await fetch(HISTORICAL_MARGIN_URL, {method:"POST",body:form,signal:controller.signal,redirect:"follow",
        headers:{"Content-Type":"application/x-www-form-urlencoded; charset=utf-8","User-Agent":"StockZone/2.7.0.30"}});
      if (!response.ok) throw Error(`MOPS previous-year HTTP ${response.status}`);
      rows = parseHistoricalMarginTable(await response.text());
    } catch (error) {
      console.warn("[fundamentals] MOPS previous-year margin unavailable", key, String(error?.message || error));
    } finally { clearTimeout(timer); }
    // Cache the market/period table once, rather than fetching the entire market for every stock.
    cached = {rows,until:Date.now() + (rows.size ? 6*3600000 : 10*60000)};
    if (historicalMarginCache.size >= 8) historicalMarginCache.delete(historicalMarginCache.keys().next().value);
    historicalMarginCache.set(key,cached);
  }
  const margin = cached.rows.get(String(code));
  if (!margin) return null;
  return {period:`${earlierYear} Q${quarter}`,year:earlierYear,quarterNo:quarter,
    marginSource:"official",sourceType:"official",grossMargin:margin.grossMargin,operatingMargin:margin.operatingMargin,
    source:"MOPS歷史同季累計營益分析"};
}

function buildMonthly(row) {
  if (!row) return null;
  return {
    period: periodText(row),
    revenue: num(row, ["營業收入-當月營收", "當月營收", "本月營收"]),
    previousMonthRevenue: num(row, ["營業收入-上月營收", "上月營收"]),
    lastYearRevenue: num(row, ["營業收入-去年當月營收", "去年當月營收", "去年同月營收"]),
    momPct: num(row, ["營業收入-上月比較增減(%)", "上月比較增減(%)", "MoM(%)"]),
    yoyPct: num(row, ["營業收入-去年同月增減(%)", "去年同月增減(%)", "YoY(%)"]),
    cumulativeRevenue: num(row, ["累計營業收入-當月累計營收", "當月累計營收", "累計營收"]),
    cumulativeLastYearRevenue: num(row, ["累計營業收入-去年累計營收", "去年累計營收"]),
    cumulativeYoyPct: num(row, ["累計營業收入-前期比較增減(%)", "前期比較增減(%)", "累計YoY(%)"]),
    sourceType: "official",
  };
}

function buildStatement(match) {
  const margin = match.marginRow || {};
  const income = match.incomeRow || {};
  const [, label, marginApplicable] = match.typeMeta;

  const grossMargin = num(margin, [
    "毛利率(%)(營業毛利)/(營業收入)",
    "毛利率(%)",
    "毛利率",
  ]);
  let operatingMargin = num(margin, [
    "營業利益率(%)(營業利益)/(營業收入)",
    "營業利益率(%)",
    "營益率(%)",
    "營業利益率",
    "營益率",
  ]);
  const incomeRevenue = num(income, ["營業收入", "收入", "收益"]);
  const incomeGross = num(income, ["營業毛利（毛損）淨額", "營業毛利（毛損）", "營業毛利(毛損)淨額", "營業毛利"]);
  const incomeOperating = num(income, ["營業利益（損失）", "營業利益(損失)", "營業利益", "營業淨利"]);
  let resolvedGrossMargin = grossMargin;
  if (resolvedGrossMargin === null && incomeRevenue !== null && incomeRevenue !== 0 && incomeGross !== null) resolvedGrossMargin = incomeGross / incomeRevenue * 100;
  if (operatingMargin === null && incomeRevenue !== null && incomeRevenue !== 0 && incomeOperating !== null) operatingMargin = incomeOperating / incomeRevenue * 100;

  return {
    period: periodText(match.marginRow || match.incomeRow),
    ...statementYearQuarter(match.marginRow || match.incomeRow),
    eps: num(income, ["基本每股盈餘（元）", "基本每股盈餘(元)", "基本每股盈餘", "每股盈餘", "EPS"]),
    revenue: incomeRevenue,
    grossProfit: incomeGross,
    operatingIncome: incomeOperating,
    grossMargin: resolvedGrossMargin,
    operatingMargin,
    preTaxMargin: num(margin, ["稅前純益率(%)(稅前純益)/(營業收入)", "稅前純益率(%)"]),
    netMargin: num(margin, ["稅後純益率(%)(稅後純益)/(營業收入)", "稅後純益率(%)"]),
    marginApplicable: marginApplicable !== false,
    financialTypeLabel: label,
    marginSource: "official",
    sourceType: "official",
    official: true,
  };
}

function buildPayload(match, code, previousYearStatement = null) {
  const revenueRow = match.revenueRow;
  const statement = buildStatement(match);
  const exchangeLabel = match.exchange === "TWSE" ? "上市官方" : "上櫃官方";
  const sourceParts = [];
  if (match.revenueRow) sourceParts.push(`${exchangeLabel}月營收`);
  if (match.marginRow) sourceParts.push(`${exchangeLabel}營益分析`);
  if (match.incomeRow) sourceParts.push(`${exchangeLabel}綜合損益表`);

  return {
    code,
    market: match.exchange === "TWSE" ? "上市" : "上櫃",
    company: {
      code,
      name: first(revenueRow || match.marginRow || match.incomeRow, ["公司名稱", "名稱", "name"]) || "",
      industry: first(revenueRow, ["產業別", "產業", "industry"]) || "",
    },
    profile: {
      exchange: match.exchange,
      financialType: match.incomeType || "unknown",
      financialTypeLabel: match.typeMeta[1],
    },
    officialStatement: statement,
    previousYearStatement,
    monthlyRevenue: buildMonthly(revenueRow),
    // OpenAPI financial statements are current-period snapshots. Historical quarter series is intentionally
    // left to the existing Yahoo supplement so cumulative EPS is not mistaken for single-quarter EPS.
    quarters: [],
    source: sourceParts.join("＋") || `${exchangeLabel}OpenAPI`,
    sourceType: "official",
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = async function handler(req, res) {
  const code = cleanCode(req.query?.q || req.query?.code || "");
  const market = String(req.query?.market || "");
  if (!/^\d{4,6}$/.test(code)) {
    res.status(400).json({ error: "invalid stock code" });
    return;
  }

  try {
    let match = null;
    for (const exchange of marketOrder(market)) {
      try {
        match = await resolveExchange(exchange, code);
      } catch (e) {
        // Try the other market before failing the route.
        console.warn(`[fundamentals] ${exchange} failed`, e?.message || e);
      }
      if (match) break;
    }

    if (!match) {
      res.status(404).json({ error: "official fundamental data not found", code });
      return;
    }

    const statement = buildStatement(match);
    const previousYearStatement = await previousYearMarginStatement(match.exchange, statement, code);
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=21600");
    res.status(200).json(buildPayload(match, code, previousYearStatement));
  } catch (e) {
    console.error("[fundamentals] route failed", e);
    res.status(502).json({ error: "official fundamental source failed", detail: String(e?.message || e) });
  }
};
