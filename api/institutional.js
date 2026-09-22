// StockZone v2.6.2.6
// Official institutional-flow route: TWSE T86 + TPEx daily institutional report.
// Values are normalized to shares. The route deliberately fails open on individual
// historical dates so one unavailable trading day does not break the whole card.

const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TPEX_DAILY = "https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade";
const TPEX_DAILY_LEGACY = "https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php";
const TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
const TPEX_ACTIVE_BROKER = "https://www.tpex.org.tw/openapi/v1/tpex_active_broker_volume";

// 使用者提供的券商觀察表：同一券商／分點可同時屬於多個交易型態。
// 這是觀察標籤，不代表該券商每一筆交易都屬於該型態。
const BROKER_WATCH_GROUPS = {
  daytrade: [
    "新加坡瑞銀","摩根大通","美林","元大","元富","台新","亞東","新光","群益","元大-中壢",
    "永全-八德","兆豐-南門","凱基-大里","凱基-台北","凱基-屏東","凱基-員林","凱基-站前","富邦-嘉義","華南-中正","聯邦-富強"
  ],
  overnight: [
    "美商高盛","港商野村","新加坡瑞銀","摩根大通","元大","元富","元大-土城永寧","元大-太平","元大-成功","元大-竹科",
    "元大-虎尾","元大-鹿港","元大-新竹","元大-彰化","日盛-忠孝","永豐金-虎尾","永豐金-桃園","兆豐-中港","兆豐-北高雄","兆豐-虎尾",
    "兆豐-南京","兆豐-復興","凱基-士林","凱基-台北","凱基-市政","凱基-板橋","凱基-屏東","富邦-台中","富邦-台南","富邦-虎尾",
    "富邦-建國","統一-仁愛","統一-松江","統一-南京","華南-竹北","華南-長虹","華南-嘉義","群益-內湖","群益-海山","群益-館前"
  ],
  short: [
    "新加坡瑞銀","摩根大通","玉山","康和","台企銀-嘉義","台新-台中","台新-建北","台新-高雄","玉山-台南","兆豐-大安",
    "兆豐-忠孝","合庫-台中","國泰-博愛","國票-長城","凱基-市政","凱基-桃園","富邦-建國","富邦-員林","統一-敦南"
  ],
  swing: [
    "台灣匯立","台灣摩根","港商野村","瑞士信貸","摩根大通","元富","台新","宏遠","國泰綜合","富邦","華南永昌","新光","群益","福邦","中國信託",
    "元大-敦化","日盛-龍潭","台企銀-桃園","台新-高雄","兆豐-忠孝","兆豐-復興","國票-和平","國票-長城","凱基-大安","凱基-中港","富邦-南屯","統一-敦南"
  ]
};
const BROKER_TAG_LABELS = { daytrade: "當沖", overnight: "隔日沖", short: "短線", swing: "波段" };

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

function recentWeekdays(max = 27) {
  const out = [];
  const d = taipeiTodayUtc();
  for (let i = 0; out.length < max && i < 45; i++) {
    const x = new Date(d.getTime() - i * 86400000);
    const day = x.getUTCDay();
    if (day !== 0 && day !== 6) out.push(x);
  }
  return out;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "StockZone/2.6.2.6",
        Referer: String(url).includes("tpex.org.tw") ? "https://www.tpex.org.tw/" : "https://www.twse.com.tw/",
      },
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const text = await r.text();
    if (!text.trim()) return null;
    try { return JSON.parse(text); }
    catch { throw new Error("official payload is not JSON"); }
  } finally {
    clearTimeout(timer);
  }
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


function normalizeBrokerName(v) {
  let s = String(v || "").trim().replace(/[臺]/g, "台").replace(/[－–—]/g, "-").replace(/[　\s]+/g, "");
  s = s.replace(/股份有限公司$/, "").replace(/證券股份/g, "").replace(/證券/g, "");
  s = s.replace(/新加坡瑞銀瑞銀/g, "新加坡瑞銀");
  const exactAliases = {
    "高盛": "美商高盛", "高盛證券": "美商高盛", "野村": "港商野村", "野村證券": "港商野村",
    "瑞銀": "新加坡瑞銀", "瑞信": "瑞士信貸", "瑞士信貸證券": "瑞士信貸",
    "台灣匯立證券": "台灣匯立", "國泰綜合證券": "國泰綜合", "中國信託綜合": "中國信託",
    "中國信託證券": "中國信託", "中信": "中國信託"
  };
  return exactAliases[s] || s;
}

function brokerMatchKey(v) {
  return normalizeBrokerName(v).replace(/[-‐‑‒–—_]/g, "").replace(/[()（）]/g, "").toLowerCase();
}

const BROKER_WATCH_INDEX = (() => {
  const map = new Map();
  for (const [tag, names] of Object.entries(BROKER_WATCH_GROUPS)) {
    for (const raw of names) {
      const display = normalizeBrokerName(raw), key = brokerMatchKey(display);
      if (!key) continue;
      const row = map.get(key) || { display, tags: [] };
      if (!row.tags.includes(tag)) row.tags.push(tag);
      map.set(key, row);
    }
  }
  return map;
})();

function brokerWatchInfo(v) {
  const normalized = normalizeBrokerName(v), key = brokerMatchKey(normalized), hit = BROKER_WATCH_INDEX.get(key);
  return hit ? { name: hit.display || normalized, tags: [...hit.tags] } : { name: normalized, tags: [] };
}

function objectField(row, exact = [], patterns = []) {
  if (!row || typeof row !== "object") return undefined;
  const entries = Object.entries(row);
  const norm = (s) => String(s || "").replace(/[\s　_\-()（）]/g, "").toLowerCase();
  const wanted = new Set(exact.map(norm));
  for (const [k, v] of entries) if (wanted.has(norm(k))) return v;
  for (const [k, v] of entries) if (patterns.some((re) => re.test(String(k)))) return v;
  return undefined;
}

function activeBrokerStockMatches(row, code) {
  const direct = objectField(row,
    ["股票代號","證券代號","股票名稱及代號","SecuritiesCode","StockCode","CompanyCode","SecuritiesCompanyCode"],
    [/股票.*代號/i,/證券.*代號/i,/stock.*code/i,/securit.*code/i,/company.*code/i]
  );
  const test = (v) => {
    const s = String(v || "").trim();
    return s === code || new RegExp(`(^|[^0-9A-Z])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9A-Z]|$)`, "i").test(s);
  };
  if (test(direct)) return true;
  return Object.values(row || {}).some(test);
}

function parseTpexActiveBrokerVolume(payload, code) {
  if (!Array.isArray(payload)) return { stockRows: [], matches: [], stockRank: null, date: "" };
  const stockRows = payload.filter((row) => row && typeof row === "object" && activeBrokerStockMatches(row, code));
  let stockRank = null, date = "";
  const matches = [];
  for (const row of stockRows) {
    const rankRaw = objectField(row,["股票排行","StockRank","SecuritiesRank"],[/股票.*排行/i,/stock.*rank/i,/securit.*rank/i]);
    const dateRaw = objectField(row,["資料日期","Date","DataDate"],[/資料日期/i,/^date$/i,/data.*date/i]);
    if (stockRank === null && n(rankRaw) !== null) stockRank = n(rankRaw);
    if (!date && dateRaw != null) { const ds=String(dateRaw).replace(/\D/g,""); date = /^20\d{6}$/.test(ds) ? ymdIso(ds) : (rocToIso(dateRaw) || ymdIso(dateRaw) || String(dateRaw).trim()); }

    let brokerRaw = objectField(row,
      ["證商名稱","券商名稱","BrokerName","SecuritiesFirmName","SecuritiesCompanyName","DealerName"],
      [/證商.*名稱/i,/券商.*名稱/i,/broker.*name/i,/securit.*(?:firm|broker|company).*name/i,/dealer.*name/i]
    );
    if (!brokerRaw) {
      for (const v of Object.values(row)) {
        const info = brokerWatchInfo(v);
        if (info.tags.length) { brokerRaw = v; break; }
      }
    }
    if (!brokerRaw) continue;
    const watch = brokerWatchInfo(brokerRaw);
    if (!watch.tags.length) continue;
    const buy = n(objectField(row,["總買量","買進量","TotalBuy","BuyVolume","TotalBuyVolume"],[/總買量/i,/買進.*量/i,/total.*buy/i,/buy.*volume/i]));
    const sell = n(objectField(row,["總賣量","賣出量","TotalSell","SellVolume","TotalSellVolume"],[/總賣量/i,/賣出.*量/i,/total.*sell/i,/sell.*volume/i]));
    const brokerRank = n(objectField(row,["證商排行","券商排行","BrokerRank"],[/證商.*排行/i,/券商.*排行/i,/broker.*rank/i]));
    matches.push({
      broker: watch.name,
      sourceBroker: String(brokerRaw).trim(),
      tags: watch.tags,
      tagLabels: watch.tags.map((x) => BROKER_TAG_LABELS[x]),
      buy,
      sell,
      net: buy !== null && sell !== null ? buy - sell : null,
      brokerRank,
    });
  }
  matches.sort((a, b) => {
    const av = a.net === null ? ((a.buy || 0) + (a.sell || 0)) : Math.abs(a.net);
    const bv = b.net === null ? ((b.buy || 0) + (b.sell || 0)) : Math.abs(b.net);
    return bv - av || (a.brokerRank || 999) - (b.brokerRank || 999);
  });
  return { stockRows, matches, stockRank, date };
}

function brokerVolumeText(v) {
  if (!Number.isFinite(Number(v))) return "";
  const x = Number(v), sign = x > 0 ? "+" : "";
  return `${sign}${x.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}張`;
}

function brokerGroupText(matches, tag, max = 2) {
  const rows = (matches || []).filter((x) => x.tags?.includes(tag)).slice(0, max);
  if (!rows.length) return "觀察名單未出現";
  return rows.map((x) => `${x.broker}${x.net === null ? "" : ` ${brokerVolumeText(x.net)}`}`).join("｜");
}

async function fetchTpexBranchFlow(code) {
  try {
    const parsed = parseTpexActiveBrokerVolume(await fetchJson(TPEX_ACTIVE_BROKER, 6000), code);
    if (!parsed.stockRows.length) {
      return {
        available: false,
        status: "not_top30",
        overnightTrading: null,
        shortTermLargeFlow: null,
        waveFlow: null,
        matches: [],
        note: "今日未進 TPEx 上櫃熱門成交前30，因此沒有官方券商進出排行。",
        source: "TPEx OpenAPI 上櫃股票熱門股證券商進出排行",
      };
    }
    const overnight = brokerGroupText(parsed.matches, "overnight");
    const short = brokerGroupText(parsed.matches, "short");
    const wave = brokerGroupText(parsed.matches, "swing");
    return {
      available: true,
      status: "active",
      stockRank: parsed.stockRank,
      date: parsed.date,
      overnightTrading: overnight,
      shortTermLargeFlow: short,
      waveFlow: wave,
      matches: parsed.matches,
      note: `TPEx 熱門成交前30${parsed.stockRank ? `｜個股排行第${parsed.stockRank}` : ""}；依觀察名單比對，暫不納入法人強度與玩法權重。`,
      source: "TPEx OpenAPI 上櫃股票熱門股證券商進出排行",
    };
  } catch (e) {
    console.warn("[institutional] TPEx active broker volume failed", e?.message || e);
    return {
      available: false,
      status: "source_error",
      overnightTrading: null,
      shortTermLargeFlow: null,
      waveFlow: null,
      matches: [],
      note: "TPEx 熱門券商進出資料暫時無法取得；不影響三大法人資料。",
      source: "TPEx OpenAPI 上櫃股票熱門股證券商進出排行",
    };
  }
}

async function fetchTwseDay(code, d) {
  const ymd = fmtYmd(d);
  const url = `${TWSE_T86}?response=json&date=${ymd}&selectType=ALLBUT0999`;
  try { return parseTwse(await fetchJson(url), code, ymd); }
  catch (e) { console.warn(`[institutional] TWSE ${ymd} failed`, e?.message || e); return null; }
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
  try { return parseTpexOpenApi(await fetchJson(TPEX_OPENAPI), code); }
  catch (e) { console.warn("[institutional] TPEx OpenAPI fallback failed", e?.message || e); return null; }
}

function marketOrder(market) {
  const m = String(market || "").toLowerCase();
  if (/上櫃|otc|tpex|two/.test(m)) return ["TPEX"];
  if (/上市|twse|sii/.test(m)) return ["TWSE"];
  return ["TWSE", "TPEX"];
}

async function collectHistory(exchange, code, cache) {
  const candidates = recentWeekdays(27);
  const fetchOne = async (d) => {
    const key = `${exchange}:${fmtYmd(d)}`;
    if (!cache.has(key)) cache.set(key, exchange === "TWSE" ? fetchTwseDay(code, d) : fetchTpexDay(code, d));
    return cache.get(key);
  };
  const rows = [];
  const batchSize = exchange === "TPEX" ? 4 : 7;
  for (let i = 0; i < candidates.length && rows.length < 20; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const got = await Promise.all(batch.map(fetchOne));
    for (const row of got) if (row?.date && !rows.some((x) => x.date === row.date)) rows.push(row);
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (exchange === "TPEX" && !rows.length) {
    const latest = await fetchTpexLatest(code);
    if (latest?.date) rows.push(latest);
  }
  return rows.slice(0, 20);
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

function buildPayload(exchange, code, rows, branchFlow = null) {
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
    branchFlow: branchFlow || {
      available: false,
      status: exchange === "TWSE" ? "tpex_only" : "source_pending",
      overnightTrading: null,
      shortTermLargeFlow: null,
      waveFlow: null,
      matches: [],
      note: exchange === "TWSE"
        ? "免費官方券商進出排行目前只提供上櫃熱門成交前30；上市股暫不顯示。"
        : "TPEx 熱門券商進出資料尚未取得；不納入目前法人方向判讀。",
      source: "TPEx OpenAPI 上櫃股票熱門股證券商進出排行",
    },
    fetchedAt: new Date().toISOString(),
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
    for (const exchange of marketOrder(market)) {
      const rows = await collectHistory(exchange, code, cache);
      if (rows.length) { selected = exchange; history = rows; break; }
    }
    if (!selected || !history.length) {
      res.status(404).json({ ok: false, error: "official institutional data not found", code });
      return;
    }
    const branchFlow = selected === "TPEX"
      ? await fetchTpexBranchFlow(code)
      : {
          available: false,
          status: "tpex_only",
          overnightTrading: null,
          shortTermLargeFlow: null,
          waveFlow: null,
          matches: [],
          note: "免費官方券商進出排行目前只提供上櫃熱門成交前30；上市股暫不顯示。",
          source: "TPEx OpenAPI 上櫃股票熱門股證券商進出排行",
        };
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=7200");
    res.status(200).json(buildPayload(selected, code, history, branchFlow));
  } catch (e) {
    console.error("[institutional] route failed", e);
    res.status(502).json({ ok: false, error: "official institutional source failed", detail: String(e?.message || e) });
  }
};
