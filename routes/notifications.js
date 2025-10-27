const express = require('express');
const { isTelegramConfigured, sendTelegramMessage } = require('../services/telegram');

function createNotificationsRouter() {
  const router = express.Router();

  router.get('/telegram/test', async (req, res) => {
    const message = req.query?.message || 'Hello from Missed Call Money Saver';

    if (!isTelegramConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'telegram_not_configured',
      });
    }

    try {
      await sendTelegramMessage(String(message));
      res.json({ ok: true });
    } catch (error) {
      console.error('Telegram test notification failed', error?.response || error);
      res.status(502).json({
        ok: false,
        error: 'telegram_delivery_failed',
      });
    }
  });

  return router;
}

module.exports = createNotificationsRouter;
