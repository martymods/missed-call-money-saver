// routes/kg-kitchen.js
const express = require('express');

module.exports = function createKgKitchenRouter({ stripePk = '', allowedOrigins = [] } = {}) {
  const router = express.Router();

  // Lightweight CORS just for this router
  router.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  // Frontend reads this to get the Stripe publishable key
  router.get('/config', (_req, res) => {
    res.json({ publishableKey: stripePk || '' });
  });

  // Optional tiny analytics endpoint (fire-and-forget from the FE)
  router.post('/analytics', express.json(), async (req, res) => {
    try {
      const { event, data, path, timestamp } = req.body || {};
      // keep it simple; you can persist to DB or forward to Telegram later
      console.log('[KG Analytics]', { event, data, path, timestamp });
      res.json({ ok: true });
    } catch (e) {
      console.error('Analytics error', e);
      res.status(500).json({ ok: false });
    }
  });

  return router;
};
