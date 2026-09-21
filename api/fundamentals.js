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
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 1911 ? n + 1911 : n;
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
    year: rocYearToAd(first(match.marginRow || match.incomeRow, ["年度", "year"])),
    quarterNo: scalar(first(match.marginRow || match.incomeRow, ["季別", "quarter"])),
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

function buildPayload(match, code) {
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

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=21600");
    res.status(200).json(buildPayload(match, code));
  } catch (e) {
    console.error("[fundamentals] route failed", e);
    res.status(502).json({ error: "official fundamental source failed", detail: String(e?.message || e) });
  }
};
