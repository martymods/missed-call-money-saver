
const express = require('express');
const { getCollection, ObjectId } = require('../services/mongo');
const { authenticate } = require('./users');
const { encryptString } = require('../lib/crypto');
const { parseIntegrationCredentials, findIntegrationById } = require('../lib/integrations');

const CATALOG = [
  { id: 'google-workspace', name: 'Google Workspace', category: 'Productivity', oneClick: true, scopes: ['Gmail', 'Sheets', 'Calendar'], docs: 'https://developers.google.com/workspace', icon: '/image/apiLogos/Google_Workspace.png' },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'Productivity', oneClick: true, scopes: ['Outlook', 'Teams', 'SharePoint'], docs: 'https://learn.microsoft.com/graph/', icon: '/image/apiLogos/microsoft_365.png' },
  { id: 'slack', name: 'Slack', category: 'Messaging', oneClick: true, scopes: ['Channels', 'Slash Commands'], docs: 'https://api.slack.com/', icon: '/image/apiLogos/slack.png' },
  { id: 'twilio', name: 'Twilio', category: 'Telephony', oneClick: false, scopes: ['Voice', 'SMS'], docs: 'https://www.twilio.com/docs/', icon: '/image/apiLogos/twilio_Symbol.png' },
  { id: 'shopify', name: 'Shopify', category: 'Commerce', oneClick: true, scopes: ['Orders', 'Inventory', 'Fulfillment'], docs: 'https://shopify.dev/', icon: '/image/apiLogos/shopify.png' },
  { id: 'amazon-seller', name: 'Amazon Seller Central', category: 'Marketplace', oneClick: true, scopes: ['Orders', 'Catalog'], docs: 'https://developer.amazonservices.com/', icon: '/image/apiLogos/amazon_Seller_Central.png' },
  { id: 'ebay', name: 'eBay', category: 'Marketplace', oneClick: true, scopes: ['Orders', 'Inventory'], docs: 'https://developer.ebay.com/', icon: '/image/apiLogos/eBay.png' },
  { id: 'faire', name: 'Faire Wholesale', category: 'Marketplace', oneClick: false, scopes: ['Orders', 'Inventory'], docs: 'https://docs.faire.com/', icon: '/image/apiLogos/faire_Wholesale.png' },
  { id: 'quickbooks', name: 'QuickBooks Online', category: 'Accounting', oneClick: true, scopes: ['Invoices', 'Customers'], docs: 'https://developer.intuit.com/', icon: '/image/apiLogos/quickBooks_Online.png' },
  { id: 'xero', name: 'Xero', category: 'Accounting', oneClick: true, scopes: ['Bills', 'Banking'], docs: 'https://developer.xero.com/', icon: '/image/apiLogos/xero.png' },
  { id: 'netsuite', name: 'NetSuite', category: 'ERP', oneClick: false, scopes: ['Records', 'Fulfillment'], docs: 'https://www.netsuite.com/', icon: '/image/apiLogos/netSuite.png' },
  { id: 'zapier', name: 'Zapier', category: 'Automation', oneClick: true, scopes: ['Triggers', 'Actions'], docs: 'https://platform.zapier.com/', icon: '/image/apiLogos/zapier.png' },
  { id: 'make', name: 'Make (Integromat)', category: 'Automation', oneClick: true, scopes: ['Scenarios'], docs: 'https://www.make.com/en/integrations', icon: '/image/apiLogos/make.png' },
  { id: 'servicetitan', name: 'ServiceTitan', category: 'Field Service', oneClick: false, scopes: ['Jobs', 'Dispatch'], docs: 'https://developer.servicetitan.io/', icon: '/image/apiLogos/serviceTitan.png' },
  { id: 'salesforce', name: 'Salesforce', category: 'CRM', oneClick: true, scopes: ['Objects', 'Events'], docs: 'https://developer.salesforce.com/', icon: '/image/apiLogos/salesforce.png' },
  { id: 'hubspot', name: 'HubSpot', category: 'CRM', oneClick: true, scopes: ['Contacts', 'Tickets'], docs: 'https://developers.hubspot.com/', icon: '/image/apiLogos/hubSpot.png' },
  { id: 'zendesk', name: 'Zendesk', category: 'Support', oneClick: true, scopes: ['Tickets', 'Users'], docs: 'https://developer.zendesk.com/', icon: '/image/apiLogos/Zendesk.png' },
  { id: 'airtable', name: 'Airtable', category: 'Databases', oneClick: true, scopes: ['Bases', 'Automations'], docs: 'https://airtable.com/developers', icon: '/image/apiLogos/airtable.png' },
  { id: 'box', name: 'Box', category: 'Content', oneClick: true, scopes: ['Files', 'Events'], docs: 'https://developer.box.com/', icon: '/image/apiLogos/box.png' },
  { id: 'dropbox', name: 'Dropbox', category: 'Content', oneClick: true, scopes: ['Files'], docs: 'https://www.dropbox.com/developers', icon: '/image/apiLogos/dropbox.png' },
];

function maskCredential(credentials = {}){
  const masked = {};
  Object.entries(credentials).forEach(([key, value]) => {
    const lowerKey = String(key || '').toLowerCase();
    const shouldMask = (
      typeof value === 'string' &&
      value.length > 4 &&
      (lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('key') || lowerKey.includes('password'))
    );
    if (shouldMask){
      masked[key] = `${value.slice(0, 2)}•••${value.slice(-2)}`;
    } else {
      masked[key] = value;
    }
  });
  return masked;
}

function createRouter(){
  const router = express.Router();

  router.get('/catalog', (_req, res) => {
    res.json({ ok: true, catalog: CATALOG });
  });

  router.use(authenticate);

  router.get('/', async (req, res) => {
    try {
      const col = await getCollection('integrations');
      const rows = await col.find({ userId: req.user._id }).toArray();
      const integrations = rows.map(row => ({
        id: row._id?.toString?.() || row._id,
        serviceId: row.serviceId,
        label: row.label || '',
        status: row.status || 'connected',
        connectedAt: row.connectedAt,
        updatedAt: row.updatedAt,
        credentials: maskCredential(parseIntegrationCredentials(row.credentials)),
        notes: row.notes || '',
      }));
      res.json({ ok: true, integrations });
    } catch (err){
      console.error('List integrations error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { serviceId, credentials = {}, label = '', notes = '' } = req.body || {};
      if (!serviceId){
        return res.status(400).json({ error: 'missing_service' });
      }
      const catalogItem = CATALOG.find(item => item.id === serviceId);
      if (!catalogItem){
        return res.status(404).json({ error: 'unknown_service' });
      }
      const col = await getCollection('integrations');
      const payload = {
        userId: req.user._id,
        serviceId,
        label: label || catalogItem.name,
        credentials: encryptString(JSON.stringify(credentials)),
        notes,
        status: catalogItem.oneClick ? 'oauth_pending' : 'credentials_saved',
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = await col.insertOne(payload);
      res.json({ ok: true, id: result.insertedId?.toString?.() || result.insertedId });
    } catch (err){
      console.error('Create integration error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/:id/one-click', async (req, res) => {
    try {
      const { id } = req.params;
      const {
        accessToken = '',
        refreshToken = '',
        expiresAt = '',
        shopDomain = '',
        shop = '',
      } = req.body || {};
      const col = await getCollection('integrations');
      const filter = { _id: new ObjectId(id), userId: req.user._id };
      const integration = await findIntegrationById(id, req.user._id);
      if (!integration){
        return res.status(404).json({ error: 'not_found' });
      }
      const stored = parseIntegrationCredentials(integration.credentials);
      const merged = {
        ...stored,
        accessToken,
        refreshToken,
        expiresAt,
      };
      const normalizedShop = String(shopDomain || shop || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\s+/g, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
      if (normalizedShop){
        merged.shopDomain = normalizedShop;
        merged.shop = normalizedShop;
      }
      await col.updateOne(filter, {
        $set: {
          credentials: encryptString(JSON.stringify(merged)),
          status: 'oauth_linked',
          updatedAt: new Date().toISOString(),
        },
      });
      res.json({ ok: true });
    } catch (err){
      console.error('One-click integration error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const col = await getCollection('integrations');
      await col.deleteOne({ _id: new ObjectId(id), userId: req.user._id });
      res.json({ ok: true });
    } catch (err){
      console.error('Delete integration error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = createRouter;
