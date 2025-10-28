const express = require('express');
const { normalizeOrigins, createCorsMiddleware } = require('../lib/originUtils');
const {
  getMenuOverrides,
  getStores,
  getAnalyticsProfiles,
  getOrders,
} = require('../data/dannyswok');
const {
  buildMenuOverridesResponse,
  buildStoreResponse,
  buildProfilesResponse,
  buildOrdersResponse,
} = require('../lib/dannyswokResponses');

function parseLimit(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function applyLimit(list, limit) {
  if (!Array.isArray(list)) return [];
  if (!limit || limit >= list.length) return list;
  return list.slice(0, limit);
}

function createDannysWokAdminRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);
  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.get('/', (req, res) => {
    const overrides = getMenuOverrides();
    const stores = getStores();
    const profiles = getAnalyticsProfiles();
    const orders = getOrders();
    const limit = parseLimit(req.query.limit);
    const limitedProfiles = applyLimit(profiles, limit);
    const limitedOrders = applyLimit(orders, limit);

    res.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      overrides,
      stores,
      profiles: limitedProfiles,
      orders: limitedOrders,
      limit: limit || null,
      meta: {
        overrides: overrides.length,
        stores: stores.length,
        profiles: profiles.length,
        orders: orders.length,
      },
    });
  });

  router.get('/menu/overrides', (_req, res) => {
    const overrides = getMenuOverrides();
    res.json(buildMenuOverridesResponse(overrides));
  });

  router.get('/stores', (_req, res) => {
    const stores = getStores();
    res.json(buildStoreResponse(stores));
  });

  router.get('/analytics/profiles', (req, res) => {
    const limit = parseLimit(req.query.limit);
    const profiles = getAnalyticsProfiles();
    const limited = applyLimit(profiles, limit);
    const response = buildProfilesResponse(limited, profiles.length, limit);
    if (Number.isInteger(response.total)) {
      res.set('X-Total-Count', String(response.total));
      res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    }
    res.json(response);
  });

  router.get('/orders', (req, res) => {
    const limit = parseLimit(req.query.limit);
    const orders = getOrders();
    const limited = applyLimit(orders, limit);
    const response = buildOrdersResponse(limited, orders.length, limit);
    if (Number.isInteger(response.total)) {
      res.set('X-Total-Count', String(response.total));
      res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    }
    res.json(response);
  });

  return router;
}

module.exports = createDannysWokAdminRouter;
