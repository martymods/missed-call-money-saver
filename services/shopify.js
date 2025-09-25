const FETCH_LIMIT = Number(process.env.SHOPIFY_FETCH_LIMIT || 50);
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04';

function normalizeShopDomain(value){
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\?.*$/, '')
    .replace(/#.*/, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function normalizeId(value){
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch (err){
    return '';
  }
}

async function shopifyRequest({ shop, accessToken, path, query = {} }){
  const domain = normalizeShopDomain(shop);
  if (!domain) {
    throw new Error('Missing shop domain');
  }
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) {
    throw new Error('Missing Shopify access token');
  }
  const url = new URL(`https://${domain}/admin/api/${API_VERSION}/${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length) url.searchParams.set(key, value.join(','));
    } else {
      url.searchParams.set(key, value);
    }
  });
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'X-Shopify-Shop-Domain': domain,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  if (!res.ok){
    const text = await res.text();
    const err = new Error(`Shopify request failed (${res.status}) for ${path}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

async function safeCall(label, fn, meta){
  try {
    return await fn();
  } catch (err){
    const status = err?.status ? ` ${err.status}` : '';
    const message = err?.message ? ` ${err.message}` : '';
    const statusLabel = status ? ` Status:${status.trim()}` : '';
    meta.warnings.push(`${label} unavailable.${statusLabel}${message}`.trim());
    if (process.env.NODE_ENV !== 'test'){ // aid debugging without failing sync
      console.warn(`Shopify ${label} fetch error`, err?.status, err?.message);
    }
    return [];
  }
}

async function fetchLocations(opts, meta){
  return safeCall('Locations', async () => {
    const json = await shopifyRequest({ ...opts, path: 'locations.json', query: { limit: FETCH_LIMIT } });
    const locations = Array.isArray(json.locations) ? json.locations : [];
    return locations.map(loc => ({
      id: normalizeId(loc.id),
      name: loc.name,
      active: !!loc.active,
      address1: loc.address1 || '',
      address2: loc.address2 || '',
      city: loc.city || '',
      province: loc.province || '',
      zip: loc.zip || '',
      country: loc.country || '',
      phone: loc.phone || '',
      legacy: !!loc.legacy,
      createdAt: loc.created_at || null,
      updatedAt: loc.updated_at || null,
    }));
  }, meta);
}

async function fetchProducts(opts, meta){
  return safeCall('Products', async () => {
    const query = {
      limit: FETCH_LIMIT,
      fields: 'id,title,handle,status,product_type,tags,created_at,updated_at,variants',
    };
    const json = await shopifyRequest({ ...opts, path: 'products.json', query });
    return Array.isArray(json.products) ? json.products : [];
  }, meta);
}

async function fetchCollections(opts, meta){
  const segments = [];
  const custom = await safeCall('Custom collections', async () => {
    const json = await shopifyRequest({ ...opts, path: 'custom_collections.json', query: { limit: FETCH_LIMIT } });
    return Array.isArray(json.custom_collections) ? json.custom_collections : [];
  }, meta);
  const smart = await safeCall('Smart collections', async () => {
    const json = await shopifyRequest({ ...opts, path: 'smart_collections.json', query: { limit: FETCH_LIMIT } });
    return Array.isArray(json.smart_collections) ? json.smart_collections : [];
  }, meta);
  segments.push(...custom, ...smart);
  return segments.map(col => ({
    id: normalizeId(col.id),
    title: col.title,
    handle: col.handle,
    updatedAt: col.updated_at || col.published_at || null,
    productsCount: Number(col.products_count || col.product_count || col.published_scope || 0) || 0,
    type: col.rules ? 'smart' : 'custom',
    sortOrder: col.sort_order || '',
  }));
}

async function fetchInventory(opts, locations, products, meta){
  const locationMap = new Map((locations || []).map(loc => [loc.id, loc]));
  const variantMap = new Map();
  (products || []).forEach(product => {
    (product.variants || []).forEach(variant => {
      const inventoryItemId = normalizeId(variant.inventory_item_id);
      variantMap.set(inventoryItemId, {
        sku: variant.sku || `VAR-${variant.id}`,
        productId: normalizeId(product.id),
        variantId: normalizeId(variant.id),
        productTitle: product.title,
        variantTitle: variant.title && variant.title !== product.title ? variant.title : '',
        productType: product.product_type || '',
        price: variant.price != null ? Number(variant.price) : null,
        barcode: variant.barcode || '',
        updatedAt: variant.updated_at || product.updated_at || product.created_at || null,
      });
    });
  });

  const allLevels = [];
  for (const loc of locations || []){
    const levels = await safeCall(`Inventory levels (${loc.name || loc.id})`, async () => {
      const json = await shopifyRequest({
        ...opts,
        path: 'inventory_levels.json',
        query: { limit: FETCH_LIMIT, location_ids: loc.id },
      });
      return Array.isArray(json.inventory_levels) ? json.inventory_levels : [];
    }, meta);
    allLevels.push(...levels);
  }

  return allLevels.map(level => {
    const variant = variantMap.get(normalizeId(level.inventory_item_id)) || {};
    const location = locationMap.get(normalizeId(level.location_id)) || {};
    const available = Number(level.available);
    return {
      inventoryItemId: normalizeId(level.inventory_item_id),
      locationId: normalizeId(level.location_id),
      locationName: location.name || '',
      available: Number.isFinite(available) ? available : 0,
      updatedAt: level.updated_at || variant.updatedAt || null,
      sku: variant.sku || `IID-${normalizeId(level.inventory_item_id)}`,
      productTitle: variant.productTitle || variant.sku || 'SKU',
      variantTitle: variant.variantTitle || '',
      productType: variant.productType || '',
      price: variant.price,
      barcode: variant.barcode || '',
      reorderPoint: available > 0 ? Math.max(1, Math.floor(available * 0.2)) : 0,
    };
  });
}

async function fetchPurchaseOrders(opts, meta){
  return safeCall('Purchase orders', async () => {
    const json = await shopifyRequest({ ...opts, path: 'purchase_orders.json', query: { limit: FETCH_LIMIT } });
    const orders = Array.isArray(json.purchase_orders) ? json.purchase_orders : [];
    return orders.map(order => ({
      id: normalizeId(order.id),
      name: order.name || order.po_number || `PO-${order.id}`,
      status: order.status || 'open',
      vendor: order.vendor || (order.supplier?.name ?? ''),
      expectedAt: order.delivery_date || order.expected_delivery_date || null,
      createdAt: order.created_at || null,
      closedAt: order.closed_at || null,
      lineCount: Array.isArray(order.line_items) ? order.line_items.length : Number(order.line_items_count) || 0,
      totalQuantity: Array.isArray(order.line_items)
        ? order.line_items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
        : Number(order.total_quantity) || 0,
    }));
  }, meta);
}

async function fetchTransfers(opts, meta){
  return safeCall('Transfers', async () => {
    const json = await shopifyRequest({ ...opts, path: 'inventory_transfers.json', query: { limit: FETCH_LIMIT } });
    const transfers = Array.isArray(json.inventory_transfers) ? json.inventory_transfers : [];
    return transfers.map(transfer => ({
      id: normalizeId(transfer.id),
      reference: transfer.reference || transfer.name || `TR-${transfer.id}`,
      status: transfer.status || 'open',
      createdAt: transfer.created_at || null,
      updatedAt: transfer.updated_at || null,
      shippedAt: transfer.sent_at || null,
      expectedArrival: transfer.expected_arrival_at || null,
      receivedAt: transfer.received_at || null,
      source: transfer.origin_address?.name || transfer.origin_address?.address1 || '',
      destination: transfer.destination_address?.name || transfer.destination_address?.address1 || '',
      lineCount: Array.isArray(transfer.line_items) ? transfer.line_items.length : Number(transfer.line_items_count) || 0,
    }));
  }, meta);
}

async function fetchGiftCards(opts, meta){
  return safeCall('Gift cards', async () => {
    const json = await shopifyRequest({ ...opts, path: 'gift_cards.json', query: { limit: FETCH_LIMIT } });
    const cards = Array.isArray(json.gift_cards) ? json.gift_cards : [];
    return cards.map(card => ({
      id: normalizeId(card.id),
      lastCharacters: card.last_characters || card.last_four_characters || '',
      balance: Number(card.balance) || 0,
      currency: card.currency || 'USD',
      createdAt: card.created_at || null,
      expiresOn: card.expires_on || null,
      disabledAt: card.disabled_at || null,
      customerEmail: card.customer ? (card.customer.email || '') : (card.customer_email || ''),
      note: card.note || '',
      templateSuffix: card.template_suffix || '',
    }));
  }, meta);
}

async function fetchShopifyData({ shop, accessToken }){
  const domain = normalizeShopDomain(shop);
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!domain) throw new Error('Missing Shopify shop domain');
  if (!token) throw new Error('Missing Shopify access token');

  const meta = { warnings: [], counts: {} };
  const opts = { shop: domain, accessToken: token };
  const fetchedAt = new Date().toISOString();

  const [locations, products] = await Promise.all([
    fetchLocations(opts, meta),
    fetchProducts(opts, meta),
  ]);

  const [collections, inventory, purchaseOrders, transfers, giftCards] = await Promise.all([
    fetchCollections(opts, meta),
    fetchInventory(opts, locations, products, meta),
    fetchPurchaseOrders(opts, meta),
    fetchTransfers(opts, meta),
    fetchGiftCards(opts, meta),
  ]);

  meta.counts = {
    locations: locations.length,
    collections: collections.length,
    inventory: inventory.length,
    purchaseOrders: purchaseOrders.length,
    transfers: transfers.length,
    giftCards: giftCards.length,
  };

  return {
    fetchedAt,
    data: {
      locations,
      collections,
      inventory,
      purchaseOrders,
      transfers,
      giftCards,
    },
    meta,
  };
}

module.exports = {
  fetchShopifyData,
};
