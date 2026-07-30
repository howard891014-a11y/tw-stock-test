const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json,text/plain,*/*"
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchYahoo(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1m&range=5d&includePrePost=false&events=div%2Csplits`;

  const response = await fetch(url, { headers: HEADERS });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const result = json?.chart?.result?.[0];

  if (!result?.meta) {
    return null;
  }

  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];

  let last = toNumber(meta.regularMarketPrice);
  let lastTime = toNumber(meta.regularMarketTime);

  if (last === null) {
    for (let i = closes.length - 1; i >= 0; i--) {
      const close = toNumber(closes[i]);
      if (close !== null) {
        last = close;
        lastTime = timestamps[i] || lastTime;
        break;
      }
    }
  }

  if (last === null) {
    return null;
  }

  const previousClose = toNumber(meta.chartPreviousClose ?? meta.previousClose);
  const change =
    previousClose !== null ? last - previousClose : null;
  const changePct =
    previousClose && change !== null
      ? (change / previousClose) * 100
      : null;

  return {
    source: "Yahoo Finance",
    symbol,
    code: symbol.split(".")[0],
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    market: symbol.endsWith(".TWO") ? "上櫃" : "上市",
    last,
    previousClose,
    change,
    changePct,
    high: toNumber(meta.regularMarketDayHigh),
    low: toNumber(meta.regularMarketDayLow),
    open: toNumber(meta.regularMarketOpen),
    quoteTime: lastTime
      ? new Date(lastTime * 1000).toISOString()
      : new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const code = String(req.query.code || "").trim();

  if (!/^\d{4,6}$/.test(code)) {
    return res.status(400).json({
      ok: false,
      error: "股票代碼格式錯誤"
    });
  }

  try {
    let result = await fetchYahoo(`${code}.TW`);

    if (!result) {
      result = await fetchYahoo(`${code}.TWO`);
    }

    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "Yahoo 查無此股票"
      });
    }

    return res.status(200).json({
      ok: true,
      ...result,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: "Yahoo 行情暫時無法取得",
      detail: error.message
    });
  }
};
