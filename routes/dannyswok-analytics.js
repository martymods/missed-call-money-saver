const express = require('express');
const { normalizeOrigins, createCorsMiddleware } = require('../lib/originUtils');
const { getAnalyticsProfiles } = require('../data/dannyswok');
const { buildProfilesResponse } = require('../lib/dannyswokResponses');
const { parseLimit, applyLimit } = require('../lib/dannyswokAdminUtils');

function createDannysWokAnalyticsRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);

  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  function handleProfiles(req, res) {
    const limit = parseLimit(req.query.limit);
    const profiles = getAnalyticsProfiles();
    const limited = applyLimit(profiles, limit);
    const response = buildProfilesResponse(limited, profiles.length, limit);

    if (Number.isInteger(response.total)) {
      res.set('X-Total-Count', String(response.total));
      res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    }

    res.json(response);
  }

  router.get('/', handleProfiles);
  router.get('/profiles', handleProfiles);

  return router;
}

module.exports = createDannysWokAnalyticsRouter;
