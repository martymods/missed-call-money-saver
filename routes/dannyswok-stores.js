const express = require('express');
const { normalizeOrigins, createCorsMiddleware } = require('../lib/originUtils');
const { getStores } = require('../data/dannyswok');
const { buildStoreResponse } = require('../lib/dannyswokResponses');

function createDannysWokStoresRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);

  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.get('/', (_req, res) => {
    const stores = getStores();
    res.json(buildStoreResponse(stores));
  });

  return router;
}

module.exports = createDannysWokStoresRouter;
