const express = require('express');
const { authenticate } = require('./users');
const { fetchShopifyData } = require('../services/shopify');
const { findIntegrationByService, parseIntegrationCredentials } = require('../lib/integrations');
const { recordAuditLog } = require('../services/auditLog');
const { getDemoShopifySync } = require('../services/demoShopify');
const { shouldBootstrapDemo } = require('../lib/bootstrapDemo');

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
  const sources = [
    credentials.accessToken,
    credentials.token,
    credentials.apiKey,
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    process.env.SHOPIFY_ACCESS_TOKEN,
    process.env.SHOPIFY_API_TOKEN,
    process.env.SHOPIFY_API_KEY,
  ];

  for (const value of sources){
    if (typeof value === 'string' && value.trim()){
      return value.trim();
    }
  }

  return '';
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

      if (shouldBootstrapDemo && (integration.status === 'demo_seeded' || !shop || !accessToken)){
        const demo = getDemoShopifySync();
        await recordAuditLog({
          type: 'shopify_sync_demo',
          userId: req.user._id?.toString?.() || req.user._id,
          integrationId: integration._id?.toString?.() || integration._id,
          shop: demo.shop,
          counts: demo.meta?.counts || {},
        });
        return res.json(demo);
      }

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
