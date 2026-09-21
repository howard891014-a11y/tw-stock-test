// StockZone v2.6.1.21
// Fundamental-only route. This file intentionally does not import or modify disposal logic.

const TWSE_BASE = "https://openapi.twse.com.tw/v1/opendata";
const TPEX_BASE = "https://www.tpex.org.tw/openapi/v1";

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

function first(row, keys) {
  for (const k of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
  }
  return null;
}

function num(row, keys) {
  return scalar(first(row, keys));
}

function codeOf(row) {
  return cleanCode(first(row, ["公司代號", "公司代碼", "Code", "code", "stock_id", "symbol"]));
}

function findCode(rows, code) {
  return Array.isArray(rows) ? rows.find((r) => codeOf(r) === code) || null : null;
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
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "StockZone/2.6.1.21",
      },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("official payload is not an array");
    return data;
  } finally {
    clearTimeout(timer);
  }
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
      revenue: `${TWSE_BASE}/t187ap05_L`,
      margin: `${TWSE_BASE}/t187ap17_L`,
      income: INCOME_TYPES.map(([type]) => [type, `${TWSE_BASE}/t187ap06_L_${type}`]),
    };
  }
  return {
    revenue: `${TPEX_BASE}/mopsfin_t187ap05_O`,
    margin: `${TPEX_BASE}/mopsfin_187ap17_O`,
    income: INCOME_TYPES.map(([type]) => [type, `${TPEX_BASE}/mopsfin_t187ap06_O_${type}`]),
  };
}

async function resolveExchange(exchange, code) {
  const urls = urlsFor(exchange);
  const [revenueResult, marginResult] = await Promise.allSettled([
    fetchJson(urls.revenue),
    fetchJson(urls.margin),
  ]);

  const revenueRows = revenueResult.status === "fulfilled" ? revenueResult.value : [];
  const marginRows = marginResult.status === "fulfilled" ? marginResult.value : [];
  const revenueRow = findCode(revenueRows, code);
  const marginRow = findCode(marginRows, code);

  // Only download income-statement families after this exchange actually contains the company.
  if (!revenueRow && !marginRow) return null;

  let incomeRow = null;
  let incomeType = null;
  // Most listed/OTC companies are general industry. Try that feed first; only fan out to
  // financial / securities / holding / insurance / mixed feeds when necessary.
  const generalIncome = urls.income.find(([type]) => type === "ci");
  if (generalIncome) {
    try {
      incomeRow = findCode(await fetchJson(generalIncome[1]), code);
      if (incomeRow) incomeType = "ci";
    } catch (_) {}
  }
  if (!incomeRow) {
    const rest = urls.income.filter(([type]) => type !== "ci");
    const incomeResults = await Promise.allSettled(rest.map(([, url]) => fetchJson(url)));
    for (let i = 0; i < incomeResults.length; i++) {
      const r = incomeResults[i];
      if (r.status !== "fulfilled") continue;
      const found = findCode(r.value, code);
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
  const operatingMargin = num(margin, [
    "營業利益率(%)(營業利益)/(營業收入)",
    "營業利益率(%)",
    "營益率(%)",
    "營業利益率",
    "營益率",
  ]);

  return {
    period: periodText(match.marginRow || match.incomeRow),
    year: rocYearToAd(first(match.marginRow || match.incomeRow, ["年度", "year"])),
    quarterNo: scalar(first(match.marginRow || match.incomeRow, ["季別", "quarter"])),
    eps: num(income, ["基本每股盈餘（元）", "基本每股盈餘(元)", "基本每股盈餘", "每股盈餘", "EPS"]),
    revenue: num(income, ["營業收入", "收入", "收益"]),
    grossProfit: num(income, ["營業毛利（毛損）淨額", "營業毛利（毛損）", "營業毛利(毛損)淨額", "營業毛利"]),
    operatingIncome: num(income, ["營業利益（損失）", "營業利益(損失)", "營業利益", "營業淨利"]),
    grossMargin,
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
