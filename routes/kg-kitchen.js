// routes/kg-kitchen.js
const express = require('express');
const fetch = require('node-fetch');

// Telegram config + label maps
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// 🔥 Grill Points R2 storage
const R2_POINTS_URL = process.env.KG_R2_POINTS_URL || '';

// In-memory Grill Points cache, keyed by IP.
// We keep this as truth, and R2 (if configured) is just a mirror.
const grillPointsState = {
  byIp: {},            // { [ip]: { ip, points, lifetime, history[] } }
  lastLoadedFromR2: 0, // timestamp when we last synced from R2
};


function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    req.socket?.remoteAddress ||
    req.ip
  );
}

async function loadAllGrillPoints() {
  // Always start from in-memory state
  const state = grillPointsState;

  if (!R2_POINTS_URL) {
    return state;
  }

  try {
    const resp = await fetch(R2_POINTS_URL, { method: 'GET' });
    if (!resp.ok) {
      console.warn('[KG GrillPoints] R2 GET failed:', resp.status);
      return state;
    }

    const json = await resp.json().catch(() => ({}));

    if (json && typeof json === 'object') {
      // Support either { byIp: { ... } } or old-style { "1.2.3.4": {...} }
      if (json.byIp && typeof json.byIp === 'object') {
        state.byIp = json.byIp;
      } else {
        state.byIp = json;
      }
      state.lastLoadedFromR2 = Date.now();
    }
  } catch (err) {
    console.error('[KG GrillPoints] loadAllGrillPoints error:', err);
  }

  return state;
}

async function saveAllGrillPoints() {
  if (!R2_POINTS_URL) return false;

  try {
    const body = JSON.stringify(
      { byIp: grillPointsState.byIp },
      null,
      2
    );

    const resp = await fetch(R2_POINTS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[KG GrillPoints] R2 PUT failed:', resp.status, text);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[KG GrillPoints] saveAllGrillPoints error:', err);
    return false;
  }
}

function ensurePointsRecord(all, ip) {
  if (!all.byIp) all.byIp = {};
  const key = ip || 'unknown';

  if (!all.byIp[key]) {
    all.byIp[key] = {
      ip: key,
      points: 0,
      lifetime: 0,
      history: [],
    };
  }

  const rec = all.byIp[key];
  rec.ip = key;
  rec.points = Number(rec.points || 0);
  rec.lifetime = Number(rec.lifetime || 0);
  if (!Array.isArray(rec.history)) rec.history = [];
  return rec;
}

async function addPointsForIp(ip, delta, event = 'purchase', meta = {}) {
  const n = Number(delta) || 0;
  if (!ip || !n) {
    return { rec: null, stored: false };
  }

  const all = await loadAllGrillPoints();
  const rec = ensurePointsRecord(all, ip);

  rec.points += n;
  if (n > 0) rec.lifetime += n;

  rec.history.push({
    ts: Date.now(),
    event,
    delta: n,
    points: rec.points,
    lifetime: rec.lifetime,
    meta,
  });

  const stored = await saveAllGrillPoints();
  return { rec, stored };
}

async function setPointsForIp(ip, points, lifetime, event = 'frontend_update') {
  if (!ip) return { rec: null, stored: false };

  const all = await loadAllGrillPoints();
  const rec = ensurePointsRecord(all, ip);

  if (typeof points === 'number') {
    rec.points = points;
  }
  if (typeof lifetime === 'number') {
    rec.lifetime = lifetime;
  }

  rec.history.push({
    ts: Date.now(),
    event,
    delta: null,
    points: rec.points,
    lifetime: rec.lifetime,
  });

  const stored = await saveAllGrillPoints();
  return { rec, stored };
}



async function setPointsForIp(ip, points, lifetime, event = 'frontend_update') {
  if (!ip) return null;
  const all = await loadAllGrillPoints();
  const rec = ensurePointsRecord(all, ip);

  rec.points = Number(points || 0);
  rec.lifetime = Number(lifetime ?? rec.points);
  rec.history.push({
    ts: Date.now(),
    event,
    delta: null,
    points: rec.points,
    lifetime: rec.lifetime,
  });

  await saveAllGrillPoints(all);
  return rec;
}


// Simple helper to send messages to Telegram
async function notifyTelegram(text) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.log('[KG Telegram disabled]', text);
      return;
    }

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.error('[KG Telegram] sendMessage failed:', err.message);
  }
}


const SIDE_LABELS = {
  jollof_rice: 'Jollof Rice',
  mac_cheese: 'Mac & Cheese',
  potato_wedges: 'Potato Wedges',
};

const SAUCE_LABELS = {
  none: 'No sauce',
  mild: 'Mild',
  hot: 'Hot',
};


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

  
// GET /kg/grill-points  -> current points for this IP
router.get('/grill-points', async (req, res) => {
  try {
    const ip = getClientIp(req);
    const all = await loadAllGrillPoints();
    const rec = ensurePointsRecord(all, ip);

    return res.json({
      ip,
      points: rec.points,
      lifetime: rec.lifetime,
      source: R2_POINTS_URL ? 'r2-or-memory' : 'memory-only',
    });
  } catch (err) {
    console.error('[KG GrillPoints] GET /grill-points failed', err);
    res.status(500).json({ error: 'Failed to load Grill Points' });
  }
});

// POST /kg/grill-points  -> update points for this IP
router.post('/grill-points', express.json(), async (req, res) => {
  try {
    const ip = getClientIp(req);
    const { points, lifetime, delta, event = 'frontend_update', meta = {} } = req.body || {};

    let result;
    if (typeof delta === 'number') {
      result = await addPointsForIp(ip, delta, event, meta);
    } else {
      result = await setPointsForIp(ip, points, lifetime, event);
    }

    const { rec, stored } = result || {};
    if (!rec) {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    return res.json({
      ok: true,
      ip,
      points: rec.points,
      lifetime: rec.lifetime,
      stored,
    });
  } catch (err) {
    console.error('[KG GrillPoints] POST /grill-points failed', err);
    res.status(500).json({ error: 'Failed to save Grill Points' });
  }
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
      cancelUrl,
      name,
      phone,
      address
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
  payment_method_types: [
    'card',
    'cashapp',
    'klarna',
    'afterpay_clearpay',
    'zip',
    'amazon_pay',
    // 'amazon_pay', // optional
  ],
  line_items,
  allow_promotion_codes: false,
  metadata: {
    fulfilment: fulfilment || 'pickup',
    name: name || '',
    phone: phone || '',
    address_line1: (address && address.line1) || '',
  },
  success_url:
    successUrl ||
    'https://kggrillkitchen.onrender.com/thank-you.html?session_id={CHECKOUT_SESSION_ID}',
  cancel_url:
    cancelUrl ||
    'https://kggrillkitchen.onrender.com/?checkout=canceled',
});


            // --- Telegram ping when Checkout page is opened ---
      const cartTotalCents = (cart || []).reduce(
        (sum, item) => sum + (item.unitPrice || 0) * (item.quantity || 1),
        0
      );
      const tip = tipCents || 0;
      const grandTotal = (cartTotalCents + tip) / 100;

      const lines = [];
      lines.push('*KG Grill – Checkout opened 🟡*');
      lines.push(`Total: *$${grandTotal.toFixed(2)}*`);
      if (fulfilment) lines.push(`Type: ${fulfilment}`);

      if (name) {
        lines.push(`👤 Name: ${name}`);
      }
      if (phone) {
        lines.push(`📞 Phone: ${phone}`);
      }
      if (address && address.line1) {
        lines.push(`📍 Address: ${address.line1}`);
      }

      if (Array.isArray(cart) && cart.length) {
        lines.push('');
        lines.push('*Items:*');
        for (const item of cart) {
          const price = ((item.unitPrice || 0) / 100).toFixed(2);
          const qty   = item.quantity || 1;
          lines.push(`• ${item.name || 'Item'} x${qty} – $${price}`);
        }
      }

      lines.push('');
      lines.push(`Checkout session: \`${session.id}\``);

      notifyTelegram(lines.join('\n')).catch(() => {});
      // --- end Telegram ping ---


      return res.json({ url: session.url });
    } catch (err) {
      console.error('Error creating Checkout Session', err);
      return res.status(500).json({ error: 'Failed to create Checkout Session' });
    }
  });

// POST /kg/telegram-notify
router.post('/telegram-notify', express.json(), async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const {
      name,
      phone,
      address,
      notes,
      items,
      subtotal,
      deliveryFee,
      fees,
      tip,     // we accept it, but intentionally do NOT print it
      total,
      amount,  // fallback total if `total` is not provided
      cart,    // fallback if old payload is still used
    } = req.body || {};

    const lines = [];

    lines.push('🔥 NEW KG GRILL KITCHEN ORDER 🔥');
    if (name)   lines.push(`👤 Name: ${name}`);
    if (phone)  lines.push(`📞 Phone: ${phone}`);

    // handle address as string or object
    let addrText = '';
    if (typeof address === 'string') {
      addrText = address.trim();
    } else if (address && (address.line1 || address.city || address.postal_code)) {
      addrText = `${address.line1 || ''} ${address.city || ''} ${address.postal_code || ''}`.trim();
    }
    if (addrText) {
      lines.push(`📍 Address: ${addrText}`);
    }

    if (notes) {
      lines.push(`📝 Notes: ${notes}`);
    }

    // Choose list of items: prefer `items`, fall back to `cart`
    const list = Array.isArray(items) && items.length ? items : (cart || []);

    if (Array.isArray(list) && list.length) {
      lines.push('');
      lines.push('🍽 Items:');

      list.forEach((item) => {
        if (!item) return;

        const qty  = item.quantity || 1;
        const main = item.name || item.id || 'Item';

        // Figure out price in cents
        let unitCents = 0;
        if (typeof item.unitPrice === 'number') {
          unitCents = item.unitPrice;
        } else if (typeof item.price === 'number') {
          unitCents = Math.round(item.price * 100);
        }

        let unitLabel = '';
        let totalLabel = '';
        if (unitCents > 0) {
          const unit = unitCents / 100;
          const rowTotal = unit * qty;
          unitLabel = `$${unit.toFixed(2)} each`;
          totalLabel = `$${rowTotal.toFixed(2)}`;
        }

        const sideKey  = item.freeSide || null;
        const sauceKey = item.sauce || null;

        const sideLabel  = sideKey  && SIDE_LABELS[sideKey]   ? SIDE_LABELS[sideKey]   : null;
        const sauceLabel = sauceKey && SAUCE_LABELS[sauceKey] ? SAUCE_LABELS[sauceKey] : null;

        const parts = [`• ${qty}× ${main}`];

        if (unitLabel && totalLabel) {
          parts.push(unitLabel);
          parts.push(totalLabel);
        }

        if (sideLabel) {
          parts.push(`Free side: ${sideLabel}`);
        }

        if (sauceLabel) {
          parts.push(`Sauce: ${sauceLabel}`);
        }

        lines.push(parts.join(' | '));
      });
    }

    lines.push('');
    lines.push('💵 Totals:');
    if (typeof subtotal === 'number')    lines.push(`Subtotal: $${(subtotal / 100).toFixed(2)}`);
    if (typeof deliveryFee === 'number') lines.push(`Delivery: $${(deliveryFee / 100).toFixed(2)}`);
    if (typeof fees === 'number')        lines.push(`Service & tax: $${(fees / 100).toFixed(2)}`);
    // IMPORTANT: we intentionally DO NOT print the tip value to keep it private
    // if (typeof tip === 'number')      lines.push(`Tip: $${(tip / 100).toFixed(2)}`);

    // Prefer explicit `total`, fall back to `amount`
    const totalCents = typeof total === 'number'
      ? total
      : (typeof amount === 'number' ? amount : null);

    if (typeof totalCents === 'number') {
      lines.push(`TOTAL CHARGED: $${(totalCents / 100).toFixed(2)}`);
    }

    // 🎁 Bonus Grill Points for completed order (per IP)
    try {
      if (R2_POINTS_URL) {
        const ip = getClientIp(req);
        const dollars = typeof totalCents === 'number' ? totalCents / 100 : 0;
        const bonus = Math.round(dollars * 5); // e.g. 5 Grill Points per $1 spent

        if (ip && bonus > 0) {
          await addPointsForIp(ip, bonus, 'order', {
            subtotal,
            deliveryFee,
            fees,
            total: totalCents,
            items: (list || []).map((item) => ({
              id: item.id || item.name,
              quantity: item.quantity || 1,
            })),
          });
        }
      }
    } catch (err) {
      console.error('[KG GrillPoints] failed to award order points', err);
    }

    const text = lines.join('\n');


    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Telegram notify failed', err);
    res.status(500).json({ ok: false });
  }
});

// Stripe webhook for Checkout success / failure
router.post(
  '/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_KG; // set this in env
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[KG Stripe webhook] signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const total = (session.amount_total || 0) / 100;

          let text = '*KG Grill – Payment SUCCESS ✅*\n';
          text += `Total: *$${total.toFixed(2)}*\n`;
          text += `Session: \`${session.id}\`\n`;

          if (session.customer_details?.email) {
            text += `Email: ${session.customer_details.email}\n`;
          }
          if (session.customer_details?.name) {
            text += `Name: ${session.customer_details.name}\n`;
          }

          await notifyTelegram(text);
          break;
        }

        case 'payment_intent.payment_failed': {
          const intent = event.data.object;
          const total = (intent.amount || 0) / 100;
          const reason =
            intent.last_payment_error?.message || 'Unknown reason';

          let text = '*KG Grill – Payment FAILED ❌*\n';
          text += `Amount: *$${total.toFixed(2)}*\n`;
          text += `Reason: ${reason}\n`;
          text += `PaymentIntent: \`${intent.id}\``;

          await notifyTelegram(text);
          break;
        }

        case 'checkout.session.expired': {
          const session = event.data.object;
          const total = (session.amount_total || 0) / 100;

          let text = '*KG Grill – Checkout EXPIRED ⏹️*\n';
          text += `Total: *$${total.toFixed(2)}*\n`;
          text += `Session: \`${session.id}\``;

          await notifyTelegram(text);
          break;
        }

        default:
          // ignore other events
          break;
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[KG Stripe webhook] handler error:', err);
      res.status(500).send('Webhook handler error');
    }
  }
);


  // POST /kg/analytics  (richer logging of user session details)
  router.post('/analytics', express.json(), async (req, res) => {
    try {
      const {
        event = 'unknown',
        data = {},
        timestamp,
        path: clientPath
      } = req.body || {};

      // Basic request context
      const ua      = req.headers['user-agent'] || '';
      const referer = req.headers['referer'] || req.headers['referrer'] || '';
      const ip =
        (req.headers['x-forwarded-for'] || '')
          .split(',')[0]
          .trim() ||
        req.socket?.remoteAddress ||
        req.ip;

      const logPayload = {
        event,                           // e.g. "page_view"
        clientPath: clientPath || null,  // path from the browser
        timestamp,                       // ms since epoch from client
        data,                            // any extra data sent by the client
        request: {
          method: req.method,
          url: req.originalUrl,
        },
        context: {
          ip,
          userAgent: ua,
          referer,
        },
      };

      console.log('kg-analytics', logPayload);

      // TODO: here you could persist to a DB or logging service
      // e.g. await analyticsCollection.insertOne(logPayload);
    } catch (err) {
      console.error('kg-analytics error', err);
    }

    res.json({ ok: true });
  });

  return router;
};
