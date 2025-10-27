const express = require('express');

function normalizeOrigins(origins) {
  if (!origins) return [];
  if (Array.isArray(origins)) {
    return origins.map(origin => (typeof origin === 'string' ? origin.trim() : '')).filter(Boolean);
  }
  if (typeof origins === 'string') {
    return origins.split(',').map(origin => origin.trim()).filter(Boolean);
  }
  return [];
}

function createCorsMiddleware(allowedOrigins) {
  const origins = normalizeOrigins(allowedOrigins);
  if (origins.length === 0) {
    return null;
  }

  return function corsMiddleware(req, res, next) {
    const requestOrigin = req.headers.origin;
    if (!requestOrigin || origins.includes(requestOrigin)) {
      if (requestOrigin) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      const requestedHeaders = req.headers['access-control-request-headers'];
      res.setHeader('Access-Control-Allow-Headers', requestedHeaders || 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      next();
      return;
    }

    res.status(403).json({ error: 'cors_not_allowed' });
  };
}

function sanitizeCurrency(value, fallback = 'usd') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized || fallback;
}

function sanitizeDescription(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const metadata = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    const normalizedKey = String(key).trim();
    if (!normalizedKey) continue;
    if (value === null || value === undefined) continue;
    metadata[normalizedKey] = typeof value === 'string' ? value : String(value);
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function sanitizeEmail(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function createDannysWokPayRouter({ stripe, allowedOrigins = [], menuOrigin = null } = {}) {
  const router = express.Router();
  const normalizedOrigins = normalizeOrigins(allowedOrigins);

  const corsMiddleware = createCorsMiddleware(normalizedOrigins);
  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.get('/config', (_req, res) => {
    const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
    res.json({
      stripePublishableKey,
      stripePk: stripePublishableKey,
      menuOrigin: menuOrigin || null,
      allowedOrigins: normalizedOrigins,
    });
  });

  router.post('/create-payment-intent', async (req, res) => {
    if (!stripe || typeof stripe.paymentIntents?.create !== 'function') {
      return res.status(503).json({ error: 'stripe_unavailable' });
    }

    const amountRaw = req.body?.amount;
    const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }

    if (!Number.isInteger(amount)) {
      return res.status(400).json({ error: 'amount_must_be_integer' });
    }

    const currency = sanitizeCurrency(req.body?.currency);
    const description = sanitizeDescription(req.body?.description);
    const receiptEmail = sanitizeEmail(req.body?.receiptEmail || req.body?.email);
    const metadata = sanitizeMetadata(req.body?.metadata);

    try {
      const intent = await stripe.paymentIntents.create({
        amount,
        currency,
        automatic_payment_methods: { enabled: true },
        description,
        receipt_email: receiptEmail,
        metadata,
      });

      res.json({
        id: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status,
      });
    } catch (error) {
      console.error('Failed to create Danny\'s Wok payment intent', error);
      const statusCode = error?.statusCode || error?.status || 500;
      res.status(statusCode).json({
        error: 'stripe_error',
        message: error?.message || 'Unable to create payment intent',
      });
    }
  });

  return router;
}

module.exports = createDannysWokPayRouter;
