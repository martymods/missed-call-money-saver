const express = require('express');
const { normalizeOrigins, createCorsMiddleware } = require('../lib/originUtils');
const {
  getMenuOverrides,
  getStores,
} = require('../data/dannyswok');
const {
  buildMenuOverridesResponse,
  buildStoreResponse,
} = require('../lib/dannyswokResponses');

function createDannysWokMenuRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);
  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.get('/', (_req, res) => {
    const overrides = getMenuOverrides();
    const stores = getStores();
    res.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      overrides,
      stores,
      menu: { overrides, stores },
      data: { overrides, stores },
      meta: {
        overrides: overrides.length,
        stores: stores.length,
      },
    });
  });

  router.get('/overrides', (_req, res) => {
    const overrides = getMenuOverrides();
    res.json(buildMenuOverridesResponse(overrides));
  });

  router.get('/stores', (_req, res) => {
    const stores = getStores();
    res.json(buildStoreResponse(stores));
  });

  return router;
}

module.exports = createDannysWokMenuRouter;
