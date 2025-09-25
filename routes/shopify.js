const express = require('express');
const { authenticate } = require('./users');
const { fetchShopifyData } = require('../services/shopify');
const { findIntegrationByService, parseIntegrationCredentials } = require('../lib/integrations');
const { recordAuditLog } = require('../services/auditLog');

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

function resolveShopDomain(credentials = {}){
  const raw = (
    credentials.shopDomain ||
    credentials.shop ||
    credentials.domain ||
    credentials.storeDomain ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    ''
  );
  return normalizeShopDomain(raw);
}

function resolveAccessToken(credentials = {}){
  const token = (
    credentials.accessToken ||
    credentials.token ||
    credentials.apiKey ||
    ''
  );
  return typeof token === 'string' ? token.trim() : '';
}

function createRouter(){
  const router = express.Router();

  router.use(authenticate);

  router.get('/sync', async (req, res) => {
    try {
      const integration = await findIntegrationByService(req.user._id, 'shopify');
      if (!integration){
        return res.status(404).json({ error: 'shopify_not_connected' });
      }
      const credentials = parseIntegrationCredentials(integration.credentials);
      const shop = resolveShopDomain(credentials);
      const accessToken = resolveAccessToken(credentials);
      if (!shop || !accessToken){
        return res.status(400).json({ error: 'missing_shopify_credentials' });
      }
      const result = await fetchShopifyData({ shop, accessToken });
      await recordAuditLog({
        type: 'shopify_sync',
        userId: req.user._id?.toString?.() || req.user._id,
        integrationId: integration._id?.toString?.() || integration._id,
        shop,
        counts: result.meta?.counts || {},
      });
      res.json({
        ok: true,
        shop,
        fetchedAt: result.fetchedAt,
        data: result.data,
        meta: result.meta,
      });
    } catch (err){
      console.error('Shopify sync error', err);
      const status = err?.status || 502;
      res.status(status).json({ error: 'shopify_sync_failed', message: err?.message || 'Unable to sync Shopify' });
    }
  });

  return router;
}

module.exports = createRouter;
