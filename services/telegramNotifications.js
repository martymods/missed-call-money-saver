const { isTelegramConfigured, sendTelegramMessage } = require('./telegram');

function formatCurrency(amountCents, currency = 'usd') {
  const amountNumber = Number(amountCents);
  const safeCurrency = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD';
  if (!Number.isFinite(amountNumber)) {
    return safeCurrency;
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountNumber / 100);
  } catch (error) {
    const dollars = (amountNumber / 100).toFixed(2);
    return `${safeCurrency} ${dollars}`;
  }
}

function formatAddress(address) {
  if (!address) {
    return null;
  }

  if (typeof address === 'string') {
    return address;
  }

  const parts = [
    address.name,
    address.line1 || address.address1,
    address.line2 || address.address2,
    address.city,
    address.state,
    address.postal_code || address.zip || address.postcode,
    address.country,
  ].filter(Boolean);

  if (parts.length) {
    return parts.join(', ');
  }

  return null;
}

function truncate(str, length = 400) {
  const value = String(str || '').trim();
  if (!value) {
    return null;
  }
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1)}…`;
}

async function safeSend(message) {
  if (!isTelegramConfigured()) {
    return false;
  }

  try {
    await sendTelegramMessage(message);
    return true;
  } catch (error) {
    console.error('Telegram notification failed', error?.response || error);
    return false;
  }
}

function buildLineItemsSummary(lineItems) {
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return null;
  }

  const lines = lineItems.map((item) => {
    const quantity = Number(item.quantity || 1);
    const product = item.price_data?.product_data || {};
    const name = truncate(product.name || product.description || 'Item', 60);
    const unitAmount = Number(item.price_data?.unit_amount);
    const currency = item.price_data?.currency;
    const total = Number.isFinite(unitAmount) ? formatCurrency(unitAmount * quantity, currency) : null;
    const unit = Number.isFinite(unitAmount) ? formatCurrency(unitAmount, currency) : null;
    if (total && unit && quantity > 1) {
      return `• ${name} x${quantity} (${total} total)`;
    }
    if (unit) {
      return `• ${name} — ${unit}`;
    }
    return `• ${name}${quantity > 1 ? ` x${quantity}` : ''}`;
  });

  if (!lines.length) {
    return null;
  }

  return lines.join('\n');
}

function buildMetadataSummary(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const keys = [
    'order_type',
    'instructions',
    'customer_name',
    'customer_phone',
    'customer_email',
    'delivery_address',
    'tip_cents',
    'delivery_cents',
    'service_fee_cents',
    'discount_cents',
    'subtotal_cents',
  ];

  const lines = [];

  for (const key of keys) {
    if (!metadata[key]) {
      continue;
    }
    if (key.endsWith('_cents')) {
      const amount = Number(metadata[key]);
      if (Number.isFinite(amount)) {
        const label = key.replace(/_cents$/, '').replace(/_/g, ' ');
        lines.push(`${capitalize(label)}: ${formatCurrency(amount, metadata.currency || 'usd')}`);
        continue;
      }
    }
    const label = key.replace(/_/g, ' ');
    lines.push(`${capitalize(label)}: ${truncate(metadata[key], 200)}`);
  }

  if (!lines.length) {
    return null;
  }

  return lines.join('\n');
}

function capitalize(str) {
  if (!str) {
    return str;
  }
  return String(str)
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function notifyPaymentIntentCreated({ intent, params }) {
  const amountCents = params?.amount ?? intent?.amount;
  const currency = params?.currency || intent?.currency || 'usd';
  const description = truncate(params?.description || intent?.description, 200);
  const email = params?.receipt_email || intent?.receipt_email;
  const metadata = { ...(intent?.metadata || {}), ...(params?.metadata || {}) };

  const lines = ['💳 Payment intent created'];

  if (Number.isFinite(Number(amountCents))) {
    lines.push(`Amount: ${formatCurrency(amountCents, currency)} (${currency.toUpperCase()})`);
  } else {
    lines.push(`Currency: ${(currency || 'usd').toUpperCase()}`);
  }

  if (description) {
    lines.push(`Description: ${description}`);
  }

  if (email) {
    lines.push(`Receipt email: ${email}`);
  }

  const metaSummary = buildMetadataSummary({ ...metadata, currency });
  if (metaSummary) {
    lines.push(metaSummary);
  }

  const address = formatAddress(metadata?.delivery_address || metadata?.shipping_address);
  if (address) {
    lines.push(`Delivery: ${address}`);
  }

  const message = lines.join('\n');
  return safeSend(message);
}

async function notifyCheckoutSessionCreated({ session, params }) {
  const currency = params?.currency || params?.line_items?.[0]?.price_data?.currency || session?.currency || 'usd';
  const metadata = { ...(params?.metadata || {}), ...(session?.metadata || {}) };
  const amountSubtotal = params?.line_items?.reduce((total, item) => {
    const unit = Number(item?.price_data?.unit_amount);
    const quantity = Number(item?.quantity || 1);
    if (!Number.isFinite(unit) || !Number.isFinite(quantity)) {
      return total;
    }
    return total + unit * quantity;
  }, 0);

  const extraCents = [
    Number(metadata.tip_cents),
    Number(metadata.delivery_cents),
    Number(metadata.service_fee_cents),
    Number(metadata.discount_cents) * -1 || 0,
  ].filter((n) => Number.isFinite(n));

  const computedTotal = Number.isFinite(amountSubtotal)
    ? amountSubtotal + extraCents.reduce((acc, n) => acc + n, 0)
    : null;

  const lines = ['🧾 Checkout session created'];

  if (Number.isFinite(computedTotal)) {
    lines.push(`Total: ${formatCurrency(computedTotal, currency)} (${currency.toUpperCase()})`);
  } else if (session?.amount_total) {
    lines.push(`Total: ${formatCurrency(session.amount_total, session.currency || currency)} (${(session.currency || currency).toUpperCase()})`);
  } else {
    lines.push(`Currency: ${(currency || 'usd').toUpperCase()}`);
  }

  const itemsSummary = buildLineItemsSummary(params?.line_items || []);
  if (itemsSummary) {
    lines.push(itemsSummary);
  }

  const metaSummary = buildMetadataSummary({ ...metadata, currency });
  if (metaSummary) {
    lines.push(metaSummary);
  }

  const shippingAddress = formatAddress(params?.shipping_address || metadata?.delivery_address);
  if (shippingAddress) {
    lines.push(`Delivery: ${shippingAddress}`);
  }

  const customerEmail = params?.customer_email || metadata?.customer_email;
  if (customerEmail) {
    lines.push(`Customer email: ${customerEmail}`);
  }

  const message = lines.join('\n');
  return safeSend(message);
}

module.exports = {
  notifyPaymentIntentCreated,
  notifyCheckoutSessionCreated,
  safeSend,
};
