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

function sanitizePhone(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function toPositiveInt(value, fallback = 1) {
  const num = Number(value);
  if (Number.isInteger(num) && num > 0) {
    return num;
  }
  return fallback;
}

function parseMoney(value, { assumeCents = false, allowZero = false, allowNegative = false } = {}) {
  if (value === null || value === undefined) {
    return null;
  }

  const multiplier = assumeCents ? 1 : 100;
  let normalized;

  if (typeof value === 'number') {
    normalized = value;
  } else if (typeof value === 'string') {
    const stripped = value.replace(/[^0-9+\-\.]/g, '');
    if (!stripped) return null;
    normalized = Number(stripped);
  } else {
    normalized = Number(value);
  }

  if (!Number.isFinite(normalized)) {
    return null;
  }

  const cents = Math.round(normalized * multiplier);
  if (!allowNegative && cents < 0) {
    return null;
  }
  if (!allowZero && cents === 0) {
    return null;
  }

  return cents;
}

const UNIT_CENT_KEYS = [
  'priceCents',
  'unitPriceCents',
  'unitAmount',
  'unit_amount',
  'cents',
];

const UNIT_DOLLAR_KEYS = [
  'price',
  'unitPrice',
  'unit_price',
];

const TOTAL_CENT_KEYS = [
  'totalCents',
  'subtotalCents',
  'amountCents',
];

const TOTAL_DOLLAR_KEYS = [
  'total',
  'subtotal',
  'amount',
  'value',
];

const QTY_KEYS = [
  'quantity',
  'qty',
  'count',
  'units',
];

function normalizeAggregateAmount(cents, quantity) {
  if (cents === null) {
    return null;
  }

  const qty = toPositiveInt(quantity, 1);
  if (qty <= 1) {
    return cents;
  }

  if (cents % qty === 0) {
    return cents / qty;
  }

  const divided = Math.round(cents / qty);
  return divided > 0 ? divided : cents;
}

function extractCentsFromItem(item, quantity = 1) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  for (const key of UNIT_CENT_KEYS) {
    const cents = parseMoney(item[key], { assumeCents: true });
    if (cents !== null) {
      return cents;
    }
  }

  for (const key of UNIT_DOLLAR_KEYS) {
    const cents = parseMoney(item[key], { assumeCents: false });
    if (cents !== null) {
      return cents;
    }
  }

  for (const key of TOTAL_CENT_KEYS) {
    const cents = parseMoney(item[key], { assumeCents: true });
    if (cents !== null) {
      return normalizeAggregateAmount(cents, quantity);
    }
  }

  for (const key of TOTAL_DOLLAR_KEYS) {
    const cents = parseMoney(item[key], { assumeCents: false });
    if (cents !== null) {
      return normalizeAggregateAmount(cents, quantity);
    }
  }

  return null;
}

function extractQuantityFromItem(item) {
  if (!item || typeof item !== 'object') {
    return 1;
  }

  for (const key of QTY_KEYS) {
    if (key in item) {
      return toPositiveInt(item[key], 1);
    }
  }

  return 1;
}

function sanitizeItemName(value) {
  if (typeof value !== 'string') {
    return 'Item';
  }
  const trimmed = value.trim();
  return trimmed || 'Item';
}

function extractItems(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (Array.isArray(payload.cart)) {
    return payload.cart;
  }

  if (Array.isArray(payload.lineItems)) {
    return payload.lineItems;
  }

  if (Array.isArray(payload.orderItems)) {
    return payload.orderItems;
  }

  if (Array.isArray(payload.products)) {
    return payload.products;
  }

  if (Array.isArray(payload.menuItems)) {
    return payload.menuItems;
  }

  const nestedCollections = [
    payload.cart?.items,
    payload.order?.items,
    payload.order?.lineItems,
    payload.checkout?.items,
  ];

  for (const collection of nestedCollections) {
    if (Array.isArray(collection)) {
      return collection.slice();
    }
  }

  return [];
}

function aggregateExtraAmounts(payload) {
  const result = {
    taxCents: null,
    tipCents: null,
    deliveryCents: null,
    serviceFeeCents: null,
    expressCents: null,
    discountCents: null,
  };

  const sources = [payload?.totals, payload?.fees, payload];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    if (result.taxCents === null) {
      result.taxCents = parseMoney(source.taxCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.tax, { allowZero: true });
      if (result.taxCents === null) {
        result.taxCents = parseMoney(source.estimatedTaxCents, { assumeCents: true, allowZero: true })
          ?? parseMoney(source.estimatedTax, { allowZero: true })
          ?? parseMoney(source.taxTotal, { allowZero: true });
      }
    }
    if (result.tipCents === null) {
      result.tipCents = parseMoney(source.tipCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.tip, { allowZero: true });
      if (result.tipCents === null) {
        result.tipCents = parseMoney(source.gratuityCents, { assumeCents: true, allowZero: true })
          ?? parseMoney(source.gratuity, { allowZero: true });
      }
    }
    if (result.deliveryCents === null) {
      result.deliveryCents = parseMoney(source.deliveryCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.deliveryFeeCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.deliveryFee, { allowZero: true })
        ?? parseMoney(source.delivery, { allowZero: true });
    }
    if (result.serviceFeeCents === null) {
      result.serviceFeeCents = parseMoney(source.serviceFeeCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.serviceFee, { allowZero: true })
        ?? parseMoney(source.fees, { allowZero: true })
        ?? parseMoney(source.service, { allowZero: true });
    }
    if (result.expressCents === null) {
      result.expressCents = parseMoney(source.expressCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.expressFeeCents, { assumeCents: true, allowZero: true })
        ?? parseMoney(source.expressFee, { allowZero: true })
        ?? parseMoney(source.expressDeliveryFee, { allowZero: true })
        ?? parseMoney(source.expressDelivery, { allowZero: true })
        ?? parseMoney(source.express, { allowZero: true })
        ?? parseMoney(source.rushDeliveryFee, { allowZero: true })
        ?? parseMoney(source.rushFee, { allowZero: true })
        ?? parseMoney(source.rush, { allowZero: true });
    }
    if (result.discountCents === null) {
      result.discountCents = parseMoney(source.discountCents, { assumeCents: true, allowZero: true, allowNegative: true })
        ?? parseMoney(source.discount, { allowZero: true, allowNegative: true });
    }
  }

  return result;
}

function calculateSubtotalCentsFromItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  let subtotal = 0;

  for (const rawItem of items) {
    const quantity = extractQuantityFromItem(rawItem);
    const unitAmount = extractCentsFromItem(rawItem, quantity);
    if (!Number.isInteger(unitAmount) || unitAmount <= 0) {
      continue;
    }

    subtotal += unitAmount * Math.max(1, quantity);
  }

  return subtotal;
}

function extractSubtotalCents(payload) {
  const sources = [payload?.totals, payload];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    const subtotal = parseMoney(source.subtotalCents, { assumeCents: true, allowZero: true })
      ?? parseMoney(source.subtotal_amount_cents, { assumeCents: true, allowZero: true })
      ?? parseMoney(source.subtotal, { allowZero: true })
      ?? parseMoney(source.itemsTotal, { allowZero: true })
      ?? parseMoney(source.items_total, { allowZero: true })
      ?? parseMoney(source.orderSubtotal, { allowZero: true })
      ?? parseMoney(source.amountBeforeFees, { allowZero: true });

    if (subtotal !== null) {
      return subtotal;
    }
  }

  return null;
}

function extractTotalCents(payload) {
  const sources = [payload?.totals, payload];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;

    const total = parseMoney(source.totalCents, { assumeCents: true, allowZero: true })
      ?? parseMoney(source.amountCents, { assumeCents: true, allowZero: true })
      ?? parseMoney(source.total, { allowZero: true })
      ?? parseMoney(source.totalAmount, { allowZero: true })
      ?? parseMoney(source.total_amount, { allowZero: true })
      ?? parseMoney(source.totalDue, { allowZero: true })
      ?? parseMoney(source.amountDue, { allowZero: true })
      ?? parseMoney(source.amount_due, { allowZero: true })
      ?? parseMoney(source.grandTotal, { allowZero: true })
      ?? parseMoney(source.balanceDue, { allowZero: true });

    if (total !== null) {
      return total;
    }
  }

  const amountRaw = payload?.amount;
  const numericAmount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
  if (Number.isInteger(numericAmount) && numericAmount > 0) {
    return numericAmount;
  }

  const amountCentsRaw = payload?.amountCents;
  const numericAmountCents = typeof amountCentsRaw === 'number' ? amountCentsRaw : Number(amountCentsRaw);
  if (Number.isInteger(numericAmountCents) && numericAmountCents > 0) {
    return numericAmountCents;
  }

  return null;
}

function sanitizeReturnUrl(url, fallback, allowedOrigins) {
  if (typeof url !== 'string') {
    return fallback;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed);
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0 || allowedOrigins.includes(parsed.origin)) {
      return parsed.toString();
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
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

    const payload = req.body || {};
    const items = extractItems(payload);

    const subtotalFromItems = calculateSubtotalCentsFromItems(items);
    const explicitSubtotal = extractSubtotalCents(payload);
    const computedSubtotal = Number.isInteger(subtotalFromItems) && subtotalFromItems > 0
      ? subtotalFromItems
      : (Number.isInteger(explicitSubtotal) && explicitSubtotal > 0 ? explicitSubtotal : null);

    const extras = aggregateExtraAmounts(payload);
    const feeCandidates = [
      extras.taxCents,
      extras.deliveryCents,
      extras.serviceFeeCents,
      extras.tipCents,
      extras.expressCents,
    ];

    let computedFees = 0;
    for (const fee of feeCandidates) {
      if (Number.isInteger(fee) && fee > 0) {
        computedFees += fee;
      }
    }

    let computedGrand = (computedSubtotal || 0) + computedFees;
    const discountCents = Number.isInteger(extras.discountCents) ? extras.discountCents : 0;
    if (discountCents > 0) {
      computedGrand -= discountCents;
    } else if (discountCents < 0) {
      computedGrand += discountCents;
    }

    const explicitTotal = extractTotalCents(payload);
    if ((!Number.isInteger(computedGrand) || computedGrand <= 0) && Number.isInteger(explicitTotal) && explicitTotal > 0) {
      computedGrand = explicitTotal;
    }

    const amount = Number.isInteger(computedGrand) && computedGrand > 0
      ? computedGrand
      : (Number.isInteger(explicitTotal) && explicitTotal > 0 ? explicitTotal : null);

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }

    const currency = sanitizeCurrency(payload?.currency || payload?.currencyCode);
    const description = sanitizeDescription(payload?.description || payload?.orderDescription);
    const receiptEmail = sanitizeEmail(
      payload?.receiptEmail
        || payload?.email
        || payload?.customer?.email
        || payload?.contact?.email
        || payload?.customerDetails?.email
    );

    const metadataInput = typeof payload?.metadata === 'object' && payload.metadata !== null
      ? { ...payload.metadata }
      : {};

    if (Number.isInteger(computedSubtotal) && computedSubtotal > 0) {
      metadataInput.subtotal_cents = String(computedSubtotal);
    }
    if (Number.isInteger(computedFees) && computedFees >= 0) {
      metadataInput.fees_total_cents = String(computedFees);
    }
    if (Number.isInteger(extras.taxCents) && extras.taxCents >= 0) {
      metadataInput.tax_cents = String(extras.taxCents);
    }
    if (Number.isInteger(extras.deliveryCents) && extras.deliveryCents >= 0) {
      metadataInput.delivery_cents = String(extras.deliveryCents);
    }
    if (Number.isInteger(extras.serviceFeeCents) && extras.serviceFeeCents >= 0) {
      metadataInput.service_fee_cents = String(extras.serviceFeeCents);
    }
    if (Number.isInteger(extras.tipCents) && extras.tipCents >= 0) {
      metadataInput.tip_cents = String(extras.tipCents);
    }
    if (Number.isInteger(extras.expressCents) && extras.expressCents >= 0) {
      metadataInput.express_cents = String(extras.expressCents);
    }
    if (Number.isInteger(discountCents) && discountCents !== 0) {
      metadataInput.discount_cents = String(discountCents);
    }

    const fulfillment = sanitizeDescription(payload?.fulfillment || payload?.orderType || payload?.type);
    if (fulfillment) {
      metadataInput.fulfillment = fulfillment;
    }

    const instructions = sanitizeDescription(
      payload?.instructions
        || payload?.specialInstructions
        || payload?.notes
        || payload?.delivery?.instructions
    );
    if (instructions) {
      metadataInput.instructions = instructions;
    }

    const metadata = sanitizeMetadata(metadataInput);

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

  router.post('/create-checkout-session', async (req, res) => {
    if (!stripe || typeof stripe.checkout?.sessions?.create !== 'function') {
      return res.status(503).json({ error: 'stripe_unavailable' });
    }

    const payload = req.body || {};
    const items = extractItems(payload);
    const currency = sanitizeCurrency(payload.currency || payload.currencyCode);

    const lineItems = [];
    let subtotalCents = 0;

    for (const rawItem of items) {
      const quantity = extractQuantityFromItem(rawItem);
      const amount = extractCentsFromItem(rawItem, quantity);
      if (!amount || amount <= 0) {
        continue;
      }
      const name = sanitizeItemName(rawItem?.name || rawItem?.title || rawItem?.description);
      subtotalCents += amount * quantity;
      lineItems.push({
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: name.slice(0, 80),
            description: sanitizeDescription(rawItem?.description)?.slice?.(0, 200),
          },
        },
        quantity,
      });
    }

    if (!lineItems.length) {
      return res.status(400).json({ error: 'no_line_items' });
    }

    const extras = aggregateExtraAmounts(payload);

    if (extras.taxCents && extras.taxCents > 0) {
      lineItems.push({
        price_data: {
          currency,
          unit_amount: extras.taxCents,
          product_data: { name: 'Tax' },
        },
        quantity: 1,
      });
    }

    if (extras.deliveryCents && extras.deliveryCents > 0) {
      lineItems.push({
        price_data: {
          currency,
          unit_amount: extras.deliveryCents,
          product_data: { name: 'Delivery' },
        },
        quantity: 1,
      });
    }

    if (extras.serviceFeeCents && extras.serviceFeeCents > 0) {
      lineItems.push({
        price_data: {
          currency,
          unit_amount: extras.serviceFeeCents,
          product_data: { name: 'Service Fee' },
        },
        quantity: 1,
      });
    }

    if (extras.expressCents && extras.expressCents > 0) {
      lineItems.push({
        price_data: {
          currency,
          unit_amount: extras.expressCents,
          product_data: { name: 'Express delivery' },
        },
        quantity: 1,
      });
    }

    if (extras.tipCents && extras.tipCents > 0) {
      lineItems.push({
        price_data: {
          currency,
          unit_amount: extras.tipCents,
          product_data: { name: 'Tip' },
        },
        quantity: 1,
      });
    }

    const baseOrigin = menuOrigin || normalizedOrigins[0] || 'https://www.delcotechdivision.com';
    const baseUrl = baseOrigin.replace(/\/$/, '');
    const defaultSuccess = `${baseUrl}/?paid=1&session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancel = `${baseUrl}/?canceled=1`;

    const allowedReturnOrigins = normalizedOrigins.length ? normalizedOrigins : [baseOrigin];
    const successUrl = sanitizeReturnUrl(payload.successUrl, defaultSuccess, allowedReturnOrigins);
    const cancelUrl = sanitizeReturnUrl(payload.cancelUrl, defaultCancel, allowedReturnOrigins);

    const customer = payload.customer || payload.contact || payload.customerDetails || {};
    const delivery = payload.delivery || payload.address || payload.shipping || {};

    const metadata = sanitizeMetadata({
      flow: 'dannyswok_checkout',
      order_type: sanitizeDescription(payload.orderType || payload.type),
      instructions: sanitizeDescription(payload.instructions || payload.specialInstructions || payload.notes),
      customer_name: sanitizeDescription(customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim()),
      customer_phone: sanitizePhone(customer.phone || delivery.phone),
      customer_email: sanitizeEmail(customer.email || payload.email),
      tip_cents: extras.tipCents ? String(extras.tipCents) : undefined,
      express_cents: extras.expressCents ? String(extras.expressCents) : undefined,
      delivery_cents: extras.deliveryCents ? String(extras.deliveryCents) : undefined,
      service_fee_cents: extras.serviceFeeCents ? String(extras.serviceFeeCents) : undefined,
      subtotal_cents: subtotalCents ? String(subtotalCents) : undefined,
      discount_cents: extras.discountCents ? String(extras.discountCents) : undefined,
      delivery_address: sanitizeDescription(
        delivery.fullAddress
          || [delivery.address1, delivery.address2, delivery.city, delivery.state, delivery.zip]
            .filter(Boolean)
            .join(', ')
      ),
    });

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card', 'link'],
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: Boolean(payload.allowPromo || payload.allowPromotionCodes),
        customer_email: sanitizeEmail(customer.email || payload.email),
        metadata,
      });

      res.json({ id: session.id, url: session.url });
    } catch (error) {
      console.error("Failed to create Danny's Wok checkout session", error);
      const statusCode = error?.statusCode || error?.status || 500;
      res.status(statusCode).json({
        error: 'stripe_error',
        message: error?.message || 'Unable to create checkout session',
      });
    }
  });

  return router;
}

module.exports = createDannysWokPayRouter;
