const express = require('express');
const { normalizeOrigins, createCorsMiddleware } = require('../lib/originUtils');
const { getOrders } = require('../data/dannyswok');
const { buildOrdersResponse } = require('../lib/dannyswokResponses');
const { parseLimit, applyLimit } = require('../lib/dannyswokAdminUtils');

function createDannysWokOrdersRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);

  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.get('/', (req, res) => {
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

module.exports = createDannysWokOrdersRouter;
