// routes/kg-kitchen.js
const express = require('express');

module.exports = function createKgKitchenRouter({ stripePk, allowedOrigins = [] } = {}) {
  const router = express.Router();

  // simple CORS for your static site(s)
  router.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const isAllowed = !allowedOrigins.length || allowedOrigins.includes(origin);
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  // Front-end safe config (Stripe publishable key only)
  router.get('/config', (_req, res) => {
    res.json({
      stripePk: String(stripePk || ''),
    });
  });

  // Optional: lightweight analytics endpoint your front-end can POST to
  router.post('/analytics', express.json({ limit: '64kb' }), (req, res) => {
    try {
      // keep it simple for now; you can persist to DB later
      console.log('[KG Analytics]', {
        at: new Date().toISOString(),
        path: req.body?.path || '',
        event: req.body?.event || '',
        data: req.body?.data || {},
      });
    } catch (_) {}
    res.json({ ok: true });
  });

  return router;
};
