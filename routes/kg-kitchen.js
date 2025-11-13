// routes/kg-kitchen.js
const express = require('express');
const fetch = require('node-fetch');

module.exports = function createKgKitchenRouter(opts = {}) {
  const router = express.Router();

  const allowed = (process.env.KG_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // CORS for the two static sites
  router.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Stripe keys
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
  const STRIPE_PUBLISHABLE = process.env.KG_STRIPE_PK || process.env.STRIPE_PUBLISHABLE_KEY || opts.stripePk || '';
  const stripe = STRIPE_SECRET ? require('stripe')(STRIPE_SECRET) : null;

  // GET /kg/config  -> publishable key for frontend fallback
  router.get('/config', (_req, res) => {
    return res.json({ publishableKey: STRIPE_PUBLISHABLE || '' });
  });

  // POST /kg/create-payment-intent  -> returns { clientSecret }
  // POST /kg/create-payment-intent  -> returns { clientSecret }
  router.post('/create-payment-intent', express.json(), async (req, res) => {
    try {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const { amount, tip = 0, fulfilment = 'pickup', name = '', phone = '', address = {}, cart = [] } = req.body || {};
      if (!amount || amount < 50) return res.status(400).json({ error: 'Invalid amount' });

      const intent = await stripe.paymentIntents.create({
        amount: Math.round(Number(amount)),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          fulfilment,
          name,
          phone,
          tip: String(tip || 0),
          items: JSON.stringify(cart).slice(0, 4500) // keep metadata under limit
        },
        ...(fulfilment === 'delivery'
          ? { shipping: { name: name || 'KG Customer', address: {
              line1: address?.line1 || '',
              city: address?.city || '',
              postal_code: address?.postal_code || '',
              country: 'US'
            } } }
          : {})
      });

      return res.json({ clientSecret: intent.client_secret });
    } catch (e) {
      console.error('PI error', e);
      return res.status(500).json({ error: 'Failed to create PI' });
    }
  });

  // POST /kg/create-checkout-session -> Stripe Checkout (Apple Pay / wallets)
  router.post('/create-checkout-session', express.json(), async (req, res) => {
    try {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });

      const {
        cart,
        fulfilment,
        tipCents,
        successUrl,
        cancelUrl
      } = req.body || {};

      if (!Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
      }

      // Build line items from the cart (amounts are already in cents)
      const line_items = cart.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
            metadata: {
              id: item.id || '',
              sauce: item.sauce || '',
              freeSide: item.freeSide || ''
            },
          },
          unit_amount: item.unitPrice, // cents
        },
        quantity: item.quantity,
      }));

      // Add a separate line for tip (if any)
      if (tipCents && tipCents > 0) {
        line_items.push({
          price_data: {
            currency: 'usd',
            product_data: { name: 'Driver tip' },
            unit_amount: tipCents,
          },
          quantity: 1,
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'], // Apple Pay/Google Pay included under "card"
        line_items,
        allow_promotion_codes: false,
        metadata: {
          fulfilment: fulfilment || 'pickup',
        },
        success_url:
          successUrl ||
          'https://kggrillkitchen.onrender.com/thank-you.html?session_id={CHECKOUT_SESSION_ID}',
        cancel_url:
          cancelUrl ||
          'https://kggrillkitchen.onrender.com/?checkout=canceled',
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error('Error creating Checkout Session', err);
      return res.status(500).json({ error: 'Failed to create Checkout Session' });
    }
  });

  // POST /kg/telegram-notify
  router.post('/telegram-notify', express.json(), async (req, res) => {

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return res.status(200).json({ ok: true, skipped: true });

    const { event = 'paid', amount = 0, name = '', phone = '', address = {}, cart = [] } = req.body || {};
    const dollars = (Number(amount) / 100).toFixed(2);

    const itemsStr = (cart || [])
      .map(i => `${i.quantity}× ${i.name} ($${(Number(i.unitPrice) / 100).toFixed(2)})`)
      .join('\n');

    const addr = `${address?.line1 || ''} ${address?.city || ''} ${address?.postal_code || ''}`.trim();

    const text = [
      '🍽️ KG Grill Kitchen',
      `Event: ${event}`,
      `Amount: $${dollars}`,
      `Name: ${name || 'N/A'}`,
      `Phone: ${phone || 'N/A'}`,
      addr ? `Address: ${addr}` : 'Address: N/A',
      'Items:',
      itemsStr || '—'
    ].join('\n');

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });

    return res.json({ ok: true });
  } catch (e) {
    console.warn('telegram error', e);
    return res.status(200).json({ ok: false });
  }
});

  // POST /kg/analytics  (lightweight; store or just log)
  router.post('/analytics', express.json(), async (req, res) => {
    try {
      // TODO: persist if desired
      console.log('kg-analytics', { path: req.body?.path, event: req.body?.event });
    } catch(_) {}
    res.json({ ok: true });
  });

  return router;
};
