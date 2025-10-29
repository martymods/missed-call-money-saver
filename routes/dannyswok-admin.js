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
const { parseLimit, applyLimit } = require('../lib/dannyswokAdminUtils');
const {
  getRewardSettings,
  getRewardAutomation,
  getRewardSummary,
  getRecentWinners,
  listRewardEvents,
} = require('../services/dannyswokRewardsStore');

function createDannysWokAdminRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);
  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.get('/', async (req, res, next) => {
    try {
      const overrides = getMenuOverrides();
      const stores = getStores();
      const profiles = getAnalyticsProfiles();
      const orders = getOrders();
      const limit = parseLimit(req.query.limit);
      const limitedProfiles = applyLimit(profiles, limit);
      const limitedOrders = applyLimit(orders, limit);
      const [rewardSettings, rewardAutomation, rewardSummary, recentWinners, rewardEvents] = await Promise.all([
        getRewardSettings(),
        getRewardAutomation(),
        getRewardSummary(),
        getRecentWinners(),
        listRewardEvents(),
      ]);

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
        rewards: {
          settings: rewardSettings,
          automation: rewardAutomation,
          summary: rewardSummary,
          winners: recentWinners,
          events: rewardEvents,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/menu/overrides', (_req, res) => {
    const overrides = getMenuOverrides();
    res.json(buildMenuOverridesResponse(overrides));
  });

  router.get('/rewards', async (_req, res, next) => {
    try {
      const [settings, automation, summary, winners, events] = await Promise.all([
        getRewardSettings(),
        getRewardAutomation(),
        getRewardSummary(),
        getRecentWinners(),
        listRewardEvents(),
      ]);
      res.json({
        ok: true,
        fetchedAt: new Date().toISOString(),
        settings,
        automation,
        summary,
        winners,
        events,
      });
    } catch (err) {
      next(err);
    }
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

  router.use((err, _req, res, _next) => {
    console.error('[dannyswok-admin] handler error', err);
    res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
  });

  return router;
}

module.exports = createDannysWokAdminRouter;
