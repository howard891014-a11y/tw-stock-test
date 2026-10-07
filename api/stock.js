// StockZone v2.6.6.18
// Consolidated stock-detail API router. Keeps low-frequency stock routes out of
// Vercel's top-level /api function budget without changing their handlers.
const handlers = {
  disposal: require('../lib/api-routes/disposal'),
  fundamentals: require('../lib/api-routes/fundamentals'),
  valuation: require('../lib/api-routes/valuation'),
  targets: require('../lib/api-routes/targets'),
  institutional: require('../lib/api-routes/institutional'),
};

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '').trim().toLowerCase();
  const target = handlers[action];
  if (!target) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ ok: false, error: 'unknown stock api action' });
  }
  return target(req, res);
};
