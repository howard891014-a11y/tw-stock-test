// StockZone v2.6.5.10
// Official institutional-flow route: TWSE T86 + TPEx daily institutional report.
// Values are normalized to shares. The route deliberately fails open on individual
// historical dates so one unavailable trading day does not break the whole card.

const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TPEX_DAILY = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade";
const TPEX_DAILY_LEGACY = "https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php";
const TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
const { readCreditTradingForStock, buildCreditSignal } = require("../lib/credit-trading");
const { readInstitutionalForStock, institutionalHistoryIsFresh, upsertInstitutionalRows } = require("../lib/institutional-history");

function cleanCode(v) {
  return String(v || "").replace(/\.(TW|TWO)$/i, "").trim();
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(x) ? x : null;
}

function fmtYmd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function ymdIso(ymd) {
  const s = String(ymd || "").replace(/\D/g, "");
  if (s.length !== 8) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function rocDate(d) {
  return `${d.getUTCFullYear() - 1911}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

function rocToIso(v) {
  const raw = String(v || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (/^\d{7}$/.test(digits)) return `${Number(digits.slice(0, 3)) + 1911}-${digits.slice(3, 5)}-${digits.slice(5, 7)}`;
  const m = raw.match(/(\d{2,3})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return "";
  return `${Number(m[1]) + 1911}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
}

function taipeiTodayUtc() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value])
  );
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

function recentWeekdays(max = 32, anchor = taipeiTodayUtc()) {
  const out = [];
  const d = anchor instanceof Date ? anchor : taipeiTodayUtc();
  for (let i = 0; out.length < max && i < 55; i++) {
    const x = new Date(d.getTime() - i * 86400000);
    const day = x.getUTCDay();
    if (day !== 0 && day !== 6) out.push(x);
  }
  return out;
}

function isoToUtcDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchJson(url, timeoutMs = 4500, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "StockZone/2.6.5.10",
          Referer: String(url).includes("tpex.org.tw") ? "https://www.tpex.org.tw/" : "https://www.twse.com.tw/",
        },
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const text = await r.text();
      if (!text.trim()) throw new Error("official payload is empty");
      try { return JSON.parse(text); }
      catch { throw new Error("official payload is not JSON"); }
    } catch (e) {
      lastError = e;
      if (attempt + 1 < attempts) await sleep(140 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("official request failed");
}

function fieldIndex(fields, names) {
  const norm = (s) => String(s || "").replace(/[\s　]/g, "").replace(/[（]/g, "(").replace(/[）]/g, ")").trim();
  const wanted = new Set(names.map(norm));
  return (fields || []).findIndex((x) => wanted.has(norm(x)));
}

function valueAt(row, idx) {
  return idx >= 0 ? n(row?.[idx]) : null;
}

function parseTwse(payload, code, requestedYmd) {
  if (!payload || String(payload.stat || "").toUpperCase() !== "OK" || !Array.isArray(payload.data)) return null;
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const codeIdx = fieldIndex(fields, ["證券代號"]);
  const nameIdx = fieldIndex(fields, ["證券名稱"]);
  const foreignIdx = fieldIndex(fields, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數（不含外資自營商）"]);
  const foreignDealerIdx = fieldIndex(fields, ["外資自營商買賣超股數"]);
  const trustIdx = fieldIndex(fields, ["投信買賣超股數"]);
  const dealerIdx = fieldIndex(fields, ["自營商買賣超股數"]);
  const dealerPropIdx = fieldIndex(fields, ["自營商買賣超股數(自行買賣)", "自營商買賣超股數（自行買賣）"]);
  const dealerHedgeIdx = fieldIndex(fields, ["自營商買賣超股數(避險)", "自營商買賣超股數（避險）"]);
  const totalIdx = fieldIndex(fields, ["三大法人買賣超股數"]);
  const row = payload.data.find((r) => String(r?.[codeIdx >= 0 ? codeIdx : 0] || "").trim() === code);
  if (!row) return null;
  const foreign = valueAt(row, foreignIdx >= 0 ? foreignIdx : 4);
  const trust = valueAt(row, trustIdx >= 0 ? trustIdx : 10);
  const dealer = valueAt(row, dealerIdx >= 0 ? dealerIdx : 11);
  if (foreign === null || trust === null || dealer === null) return null;
  const totalRaw = valueAt(row, totalIdx >= 0 ? totalIdx : 18);
  return {
    date: ymdIso(payload.date || requestedYmd),
    code,
    name: String(row?.[nameIdx >= 0 ? nameIdx : 1] || "").trim(),
    foreign,
    foreignDealer: valueAt(row, foreignDealerIdx >= 0 ? foreignDealerIdx : 7),
    trust,
    dealer,
    dealerProprietary: valueAt(row, dealerPropIdx >= 0 ? dealerPropIdx : 14),
    dealerHedge: valueAt(row, dealerHedgeIdx >= 0 ? dealerHedgeIdx : 17),
    total: totalRaw === null ? foreign + trust + dealer : totalRaw,
    source: "TWSE T86",
  };
}

function parseTpexModern(payload, code, requestedRocDate) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  const rows = Array.isArray(table?.data) ? table.data : [];
  if (!rows.length) return null;
  const responseDate = String(table?.date || payload?.date || requestedRocDate || "").trim();
  if (requestedRocDate && responseDate && responseDate !== requestedRocDate) return null;
  const row = rows.find((r) => String(r?.[0] || "").replace(/^=|"/g, "").trim() === code);
  if (!row || row.length < 24) return null;
  // Preserve the same semantics as TWSE T86: 外資 excludes foreign-dealer flow.
  const foreign = n(row[4]);
  const trust = n(row[13]);
  const dealer = n(row[22]);
  if (foreign === null || trust === null || dealer === null) return null;
  const totalRaw = n(row[23]);
  return {
    date: rocToIso(responseDate || requestedRocDate),
    code,
    name: String(row[1] || "").trim(),
    foreign,
    foreignDealer: n(row[7]),
    trust,
    dealer,
    dealerProprietary: n(row[16]),
    dealerHedge: n(row[19]),
    total: totalRaw === null ? foreign + trust + dealer : totalRaw,
    source: "TPEx 三大法人日報",
  };
}

function parseTpexLegacy(payload, code) {
  const rows = Array.isArray(payload?.aaData) ? payload.aaData : [];
  if (!rows.length) return null;
  const row = rows.find((r) => String(r?.[0] || "").trim() === code);
  if (!row) return null;
  const foreign = n(row[4]);
  const trust = n(row[13]);
  const dealer = n(row[22]);
  if (foreign === null || trust === null || dealer === null) return null;
  const totalRaw = n(row[23]);
  return {
    date: rocToIso(payload.reportDate),
    code,
    name: String(row[1] || "").trim(),
    foreign,
    foreignDealer: n(row[7]),
    trust,
    dealer,
    dealerProprietary: n(row[16]),
    dealerHedge: n(row[19]),
    total: totalRaw === null ? foreign + trust + dealer : totalRaw,
    source: "TPEx 三大法人日報",
  };
}

function parseTpexOpenApi(payload, code) {
  if (!Array.isArray(payload)) return null;
  const row = payload.find((r) => String(r?.SecuritiesCompanyCode || "").trim() === code);
  if (!row) return null;
  const foreign = n(row["Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference"]);
  const trust = n(row["SecuritiesInvestmentTrustCompanies-Difference"]);
  const dealer = n(row["Dealers-Difference"]);
  if (foreign === null || trust === null || dealer === null) return null;
  const totalRaw = n(row.TotalDifference);
  return {
    date: rocToIso(row.Date),
    code,
    name: String(row.CompanyName || "").trim(),
    foreign,
    foreignDealer: n(row["ForeignDealers-Difference"]),
    trust,
    dealer,
    dealerProprietary: n(row["Dealers(Proprietary)-Difference"]),
    dealerHedge: n(row["Dealers(Hedging)-Difference"]),
    total: totalRaw === null ? foreign + trust + dealer : totalRaw,
    source: "TPEx OpenAPI",
  };
}

async function fetchTwseDay(code, d) {
  const ymd = fmtYmd(d);
  const url = `${TWSE_T86}?response=json&date=${ymd}&selectType=ALLBUT0999`;
  try { return parseTwse(await fetchJson(url), code, ymd); }
  catch (e) { console.warn(`[institutional] TWSE ${ymd} failed`, e?.message || e); return null; }
}

async function fetchTwseLatest(code) {
  // No date parameter = TWSE latest published T86 snapshot.  Use it as the
  // freshness anchor so a transient failure on one historical date cannot make
  // one stock appear to be several sessions behind another stock.
  const url = `${TWSE_T86}?response=json&selectType=ALLBUT0999`;
  try { return parseTwse(await fetchJson(url, 4500, 3), code, ""); }
  catch (e) { console.warn("[institutional] TWSE latest snapshot failed", e?.message || e); return null; }
}

async function fetchTpexDay(code, d) {
  const requestedRocDate = rocDate(d);
  const modern = new URLSearchParams({ type: "Daily", sect: "EW", date: requestedRocDate, id: "", response: "json" });
  try {
    const row = parseTpexModern(await fetchJson(`${TPEX_DAILY}?${modern.toString()}`), code, requestedRocDate);
    if (row) return row;
  } catch (e) {
    console.warn(`[institutional] TPEx modern ${requestedRocDate} failed`, e?.message || e);
  }
  // Compatibility fallback for dates/environments where the legacy endpoint still responds.
  const legacy = new URLSearchParams({ l: "zh-tw", o: "json", se: "EW", t: "D", d: requestedRocDate, s: "0,asc" });
  try { return parseTpexLegacy(await fetchJson(`${TPEX_DAILY_LEGACY}?${legacy.toString()}`), code); }
  catch (e) { console.warn(`[institutional] TPEx legacy ${requestedRocDate} failed`, e?.message || e); return null; }
}

async function fetchTpexLatest(code) {
  try { return parseTpexOpenApi(await fetchJson(TPEX_OPENAPI, 4500, 3), code); }
  catch (e) { console.warn("[institutional] TPEx OpenAPI fallback failed", e?.message || e); return null; }
}

function marketOrder(market) {
  const m = String(market || "").toLowerCase();
  if (/上櫃|otc|tpex|two/.test(m)) return ["TPEX"];
  if (/上市|twse|sii/.test(m)) return ["TWSE"];
  return ["TWSE", "TPEX"];
}

async function collectHistory(exchange, code, cache) {
  // Always start from the exchange's latest published snapshot.  Previously the
  // route only used TPEx OpenAPI when *all* historical requests failed, so a
  // partial failure could leave one stock at 9/16 while another was already at
  // 9/21.  The latest snapshot is now authoritative for asOfDate.
  const latest = exchange === "TWSE" ? await fetchTwseLatest(code) : await fetchTpexLatest(code);
  const rows = [];
  if (latest?.date) rows.push(latest);

  const anchor = isoToUtcDate(latest?.date) || taipeiTodayUtc();
  const candidates = recentWeekdays(34, anchor).filter((d) => !latest?.date || fmtYmd(d) !== String(latest.date).replace(/\D/g, ""));
  const fetchOne = async (d) => {
    const key = `${exchange}:${fmtYmd(d)}:${code}`;
    if (!cache.has(key)) cache.set(key, exchange === "TWSE" ? fetchTwseDay(code, d) : fetchTpexDay(code, d));
    return cache.get(key);
  };

  // Small batches are deliberate.  T86/TPEx are whole-market reports; large
  // bursts are more likely to be throttled and used to create random date gaps.
  const batchSize = exchange === "TPEX" ? 3 : 4;
  for (let i = 0; i < candidates.length && rows.length < 20; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const got = await Promise.all(batch.map(fetchOne));
    for (const row of got) {
      if (row?.date && !rows.some((x) => x.date === row.date)) rows.push(row);
    }
  }

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { rows: rows.slice(0, 20), freshnessVerified: !!latest?.date, latestDate: latest?.date || "" };
}

function sumRows(rows, count) {
  const used = rows.slice(0, count);
  const sum = (key) => used.reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0);
  return {
    daysUsed: used.length,
    complete: used.length >= count,
    foreign: sum("foreign"),
    trust: sum("trust"),
    dealer: sum("dealer"),
    dealerProprietary: sum("dealerProprietary"),
    dealerHedge: sum("dealerHedge"),
    total: sum("total"),
  };
}

function streak(rows, key) {
  if (!rows.length) return { direction: "none", days: 0, value: 0 };
  const first = Number(rows[0]?.[key]) || 0;
  const direction = first > 0 ? "buy" : first < 0 ? "sell" : "flat";
  if (direction === "flat") return { direction, days: 1, value: 0 };
  let days = 0, value = 0;
  for (const r of rows) {
    const v = Number(r?.[key]) || 0;
    if ((direction === "buy" && v > 0) || (direction === "sell" && v < 0)) { days++; value += v; }
    else break;
  }
  return { direction, days, value };
}

function directionScore(periods, key) {
  const spec = [[1, .35], [5, .30], [10, .20], [20, .15]];
  let score = 0, weight = 0;
  for (const [days, w] of spec) {
    const p = periods[String(days)];
    if (!p || !p.complete) continue;
    const v = Number(p[key]) || 0;
    score += (v > 0 ? 1 : v < 0 ? -1 : 0) * w;
    weight += w;
  }
  return weight ? score / weight : 0;
}

function buildSignal(periods, streaks) {
  const foreign = directionScore(periods, "foreign");
  const trust = directionScore(periods, "trust");
  const dealer = directionScore(periods, "dealer");
  const score = foreign * .45 + trust * .40 + dealer * .15;
  let label = "中性";
  if (score >= .45) label = "法人偏多";
  else if (score >= .16) label = "中性偏多";
  else if (score <= -.45) label = "法人偏空";
  else if (score <= -.16) label = "中性偏空";

  // 法人強度描述的是「方向一致性＋連續性」，不是把買賣超股數硬做跨股票比較。
  // 這樣可以安全提供給後續玩法／共振使用，也不會讓大型股因絕對股數較大而天然拿高分。
  const actorRows = [["foreign", foreign, .45], ["trust", trust, .40], ["dealer", dealer, .15]];
  const direction = score > .03 ? 1 : score < -.03 ? -1 : 0;
  const activeActors = actorRows.filter(([, actor]) => Math.abs(actor) >= .05);
  const alignedWeight = direction ? activeActors.reduce((sum, [, actor, weight]) => sum + (Math.sign(actor) === direction ? weight : 0), 0) : 0;
  const activeWeight = activeActors.reduce((sum, [, , weight]) => sum + weight, 0) || 1;
  const agreement = direction ? alignedWeight / activeWeight : 0;
  const streakConsistency = direction ? actorRows.reduce((sum, [key, , weight]) => {
    const s = streaks[key];
    const sameDirection = (direction > 0 && s?.direction === "buy") || (direction < 0 && s?.direction === "sell");
    return sum + (sameDirection ? Math.min(Number(s?.days) || 0, 5) / 5 * weight : 0);
  }, 0) : 0;
  const completePeriods = ["1", "5", "10", "20"].filter((days) => periods[days]?.complete).length;
  const coverage = completePeriods / 4;
  const rawStrength = Math.abs(score) * 70 + agreement * 18 + streakConsistency * 12;
  const strength = Math.round(Math.max(0, Math.min(100, rawStrength * (.72 + coverage * .28))));

  const reasons = [];
  const p5 = periods["5"];
  if (p5?.complete) {
    for (const [key, name] of [["foreign", "外資"], ["trust", "投信"], ["dealer", "自營商"]]) {
      const v = Number(p5[key]) || 0;
      reasons.push(`${name}5日${v > 0 ? "買超" : v < 0 ? "賣超" : "持平"}`);
    }
  } else if (periods["1"]?.complete) {
    const p1 = periods["1"];
    for (const [key, name] of [["foreign", "外資"], ["trust", "投信"], ["dealer", "自營商"]]) {
      const v = Number(p1[key]) || 0;
      reasons.push(`${name}今日${v > 0 ? "買超" : v < 0 ? "賣超" : "持平"}`);
    }
  }
  const streakReason = [["foreign", "外資"], ["trust", "投信"]]
    .map(([key, name]) => {
      const s = streaks[key];
      return s?.days >= 2 && s.direction !== "flat" ? `${name}連${s.days}${s.direction === "buy" ? "買" : "賣"}` : "";
    }).filter(Boolean);
  reasons.unshift(...streakReason);
  return {
    label,
    score: Math.round(score * 100),
    strength,
    strengthBasis: "direction_consistency",
    coveragePct: Math.round(coverage * 100),
    reasons: reasons.slice(0, 4),
    actorScores: { foreign, trust, dealer },
  };
}

function buildPayload(exchange, code, rows, freshness = {}) {
  const periods = { "1": sumRows(rows, 1), "5": sumRows(rows, 5), "10": sumRows(rows, 10), "20": sumRows(rows, 20) };
  const streaks = {
    foreign: streak(rows, "foreign"),
    trust: streak(rows, "trust"),
    dealer: streak(rows, "dealer"),
    total: streak(rows, "total"),
  };
  return {
    ok: true,
    code,
    name: rows[0]?.name || "",
    market: exchange === "TWSE" ? "上市" : "上櫃",
    exchange,
    source: exchange === "TWSE" ? "TWSE 官方 T86" : "TPEx 官方三大法人日報",
    sourceUrl: exchange === "TWSE" ? "https://www.twse.com.tw/rwd/zh/fund/T86?response=html&selectType=ALLBUT0999" : "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/3itrade/day.html",
    unit: "shares",
    asOfDate: rows[0]?.date || "",
    historyCount: rows.length,
    history: rows,
    periods,
    streaks,
    signal: buildSignal(periods, streaks),
    freshnessVerified: !!freshness.freshnessVerified,
    latestPublishedDate: freshness.latestDate || rows[0]?.date || "",
    fetchedAt: new Date().toISOString(),
    storage: freshness.persisted ? "db" : "official_live_fallback",
  };
}

module.exports = async function handler(req, res) {
  const code = cleanCode(req.query?.q || req.query?.code || "");
  const market = String(req.query?.market || "");
  if (!/^\d{4,6}[A-Z]?$/.test(code)) {
    res.status(400).json({ ok: false, error: "invalid stock code" });
    return;
  }

  try {
    const cache = new Map();
    let selected = null;
    let history = [];
    let freshness = { freshnessVerified: false, latestDate: "", persisted: false };
    for (const exchange of marketOrder(market)) {
      const marketName = exchange === "TWSE" ? "上市" : "上櫃";
      // v2.6.5.10: persisted institutional history is the primary path.  A live
      // official fallback remains only for bootstrap/stale recovery, and any good
      // fallback rows are immediately written back so the next lookup is DB-only.
      try {
        const stored = await readInstitutionalForStock(code, marketName, 20);
        const storedFresh = stored.length >= 20 && await institutionalHistoryIsFresh(stored, marketName);
        if (storedFresh) {
          selected = exchange;
          history = stored;
          freshness = { freshnessVerified: true, latestDate: stored[0]?.date || "", persisted: true };
          break;
        }
      } catch (dbReadError) {
        console.warn(`[institutional] persisted ${marketName} read unavailable`, dbReadError?.message || dbReadError);
      }

      const result = await collectHistory(exchange, code, cache);
      if (result.rows.length) {
        selected = exchange;
        history = result.rows.map((row) => ({ ...row, market: marketName }));
        freshness = { ...result, persisted: false };
        try { await upsertInstitutionalRows(history); }
        catch (dbWriteError) { console.warn(`[institutional] persisted ${marketName} write unavailable`, dbWriteError?.message || dbWriteError); }
        break;
      }
    }
    if (!selected || !history.length) {
      res.status(404).json({ ok: false, error: "official institutional data not found", code });
      return;
    }
    res.setHeader("Cache-Control", freshness.freshnessVerified ? "s-maxage=300, stale-while-revalidate=60" : "no-store");
    const payload = buildPayload(selected, code, history, freshness);
    // Credit trading is an independent persisted layer. Never let a DB/schema/upstream
    // problem break the existing official institutional card.
    try {
      const creditTrading = await readCreditTradingForStock(code, payload.market);
      creditTrading.signal = buildCreditSignal(creditTrading, payload);
      payload.creditTrading = creditTrading;
    } catch (creditError) {
      console.warn("[institutional] credit layer unavailable", creditError?.message || creditError);
      payload.creditTrading = { available: false, historyCount: 0, periods: {}, history: [], signal: { label: "資料暫缺", tone: "neutral", reasons: [] } };
    }
    res.status(200).json(payload);
  } catch (e) {
    console.error("[institutional] route failed", e);
    res.status(502).json({ ok: false, error: "official institutional source failed", detail: String(e?.message || e) });
  }
};
