const express = require('express');
const { normalizeOrigins, createCorsMiddleware } = require('../lib/originUtils');
const {
  getRewardSettings,
  updateRewardSettings,
  getRewardAutomation,
  updateRewardAutomation,
  getRewardProfile,
  recordFortuneResult,
  updateRewardStreak,
  getRecentWinners,
  addWinner,
  listRewardEvents,
  updateRewardEvents,
  getRewardSummary,
} = require('../services/dannyswokRewardsStore');

function createDannysWokRewardsRouter({ allowedOrigins = [] } = {}) {
  const router = express.Router();
  const origins = normalizeOrigins(allowedOrigins);
  const corsMiddleware = createCorsMiddleware(origins);
  if (corsMiddleware) {
    router.use(corsMiddleware);
  }

  router.use(express.json({ limit: '1mb' }));

  router.get('/settings', async (_req, res, next) => {
    try {
      const [settings, automation, summary] = await Promise.all([
        getRewardSettings(),
        getRewardAutomation(),
        getRewardSummary(),
      ]);
      res.json({ ok: true, settings, automation, summary });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', async (req, res, next) => {
    try {
      const updated = await updateRewardSettings(req.body || {});
      res.json({ ok: true, settings: updated });
    } catch (err) {
      next(err);
    }
  });

  router.get('/automation', async (_req, res, next) => {
    try {
      const automation = await getRewardAutomation();
      res.json({ ok: true, automation });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/automation', async (req, res, next) => {
    try {
      const automation = await updateRewardAutomation(req.body || {});
      res.json({ ok: true, automation });
    } catch (err) {
      next(err);
    }
  });

  router.get('/summary', async (_req, res, next) => {
    try {
      const summary = await getRewardSummary();
      res.json({ ok: true, summary });
    } catch (err) {
      next(err);
    }
  });

  router.get('/profiles/:userId', async (req, res, next) => {
    try {
      const profile = await getRewardProfile(req.params.userId);
      res.json({ ok: true, profile });
    } catch (err) {
      next(err);
    }
  });

  router.post('/profiles/:userId/fortune', async (req, res, next) => {
    try {
      const profile = await recordFortuneResult(req.params.userId, req.body || {});
      res.json({ ok: true, profile });
    } catch (err) {
      next(err);
    }
  });

  router.post('/profiles/:userId/streak', async (req, res, next) => {
    try {
      const profile = await updateRewardStreak(req.params.userId, req.body || {});
      res.json({ ok: true, profile });
    } catch (err) {
      next(err);
    }
  });

  router.get('/winners', async (_req, res, next) => {
    try {
      const winners = await getRecentWinners();
      res.json({ ok: true, winners });
    } catch (err) {
      next(err);
    }
  });

  router.post('/winners', async (req, res, next) => {
    try {
      const winners = await addWinner(req.body || {});
      res.json({ ok: true, winners });
    } catch (err) {
      next(err);
    }
  });

  router.get('/events', async (_req, res, next) => {
    try {
      const events = await listRewardEvents();
      res.json({ ok: true, events });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/events', async (req, res, next) => {
    try {
      const events = await updateRewardEvents(req.body || {});
      res.json({ ok: true, events });
    } catch (err) {
      next(err);
    }
  });

  router.use((err, _req, res, _next) => {
    console.error('[dannyswok-rewards] handler error', err);
    res.status(500).json({ ok: false, error: err?.message || 'Unknown error' });
  });

  return router;
}

module.exports = createDannysWokRewardsRouter;
