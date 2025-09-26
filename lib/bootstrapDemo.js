const { getCollection } = require('../services/mongo');
const { hashPassword } = require('./security');
const { encryptString } = require('./crypto');

const DEFAULT_EMAIL = process.env.DEMO_USER_EMAIL || 'captain@warehouse-hq.com';
const DEFAULT_PASSWORD = process.env.DEMO_USER_PASSWORD || 'warehouse-demo';
const DEFAULT_NAME = process.env.DEMO_USER_NAME || 'Warehouse Captain';
const DEFAULT_SHOP_DOMAIN = process.env.DEMO_SHOPIFY_SHOP || 'warehouse-hq.myshopify.com';
const DEFAULT_SHOP_TOKEN = process.env.DEMO_SHOPIFY_TOKEN || 'demo-access-token';

const shouldBootstrapDemo = process.env.DISABLE_DEMO_BOOTSTRAP !== 'true' && !process.env.MONGODB_URI;

async function ensureDemoUser(){
  const users = await getCollection('users');
  const email = DEFAULT_EMAIL.toLowerCase();
  const existing = await users.findOne({ email });
  if (existing){
    return existing;
  }
  const now = new Date().toISOString();
  const doc = {
    email,
    password: hashPassword(DEFAULT_PASSWORD),
    name: DEFAULT_NAME,
    createdAt: now,
    brandTheme: {
      accent: '#38bdf8',
      background: 'nebula',
      callSign: 'Warehouse HQ',
      emoji: '🚚',
      logoData: '',
    },
    totp: { enabled: false },
  };
  const result = await users.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function ensureDemoShopifyIntegration(user){
  const integrations = await getCollection('integrations');
  const existing = await integrations.findOne({ userId: user._id, serviceId: 'shopify' });
  if (existing){
    return existing;
  }
  const now = new Date().toISOString();
  const credentials = {
    shopDomain: DEFAULT_SHOP_DOMAIN,
    accessToken: DEFAULT_SHOP_TOKEN,
  };
  const payload = {
    userId: user._id,
    serviceId: 'shopify',
    label: 'Warehouse Shopify',
    credentials: encryptString(JSON.stringify(credentials)),
    notes: 'Demo Shopify workspace seeded by Warehouse HQ.',
    status: 'demo_seeded',
    connectedAt: now,
    updatedAt: now,
  };
  const result = await integrations.insertOne(payload);
  return { ...payload, _id: result.insertedId };
}

async function bootstrapDemoData(){
  if (!shouldBootstrapDemo){
    return null;
  }
  try {
    const user = await ensureDemoUser();
    await ensureDemoShopifyIntegration(user);
    return {
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      shopDomain: DEFAULT_SHOP_DOMAIN,
    };
  } catch (err){
    console.error('Demo bootstrap failed', err);
    return null;
  }
}

module.exports = {
  bootstrapDemoData,
  shouldBootstrapDemo,
  DEMO_DEFAULTS: {
    email: DEFAULT_EMAIL,
    password: DEFAULT_PASSWORD,
    shopDomain: DEFAULT_SHOP_DOMAIN,
  },
};
