const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { getFaithMetrics } = require('../services/faithMetrics');

const DATA_DIR = path.join(__dirname, '..', 'data', 'giving');
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'giving');
const ORGS_FILE = path.join(DATA_DIR, 'organizations.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');
const COMMUNITY_FILE = path.join(DATA_DIR, 'community-campaigns.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

async function readJson(filePath, fallback) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    if (!content) return fallback;
    return JSON.parse(content);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  const payload = JSON.stringify(value, null, 2);
  await fsp.writeFile(filePath, payload, 'utf8');
}

function sanitizeString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ['true', '1', 'yes', 'on'].includes(normalized);
  }
  return Boolean(value);
}

function normalizeCurrency(value) {
  if (!value) return 'usd';
  return String(value).trim().toLowerCase() || 'usd';
}

function resolveImageExtension(mime) {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    throw new Error('Invalid image payload.');
  }
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Unsupported image format.');
  }
  const [, mime, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  return { mime, buffer };
}

async function saveImageFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const { mime, buffer } = decodeDataUrl(dataUrl);
  if (buffer.length > 1.5 * 1024 * 1024) {
    throw new Error('Compressed image exceeds 1.5MB.');
  }
  const ext = resolveImageExtension(mime);
  const fileName = `${Date.now()}_${crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex')}.${ext}`;
  const fullPath = path.join(UPLOAD_DIR, fileName);
  await fsp.writeFile(fullPath, buffer);
  return `/uploads/giving/${fileName}`;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

async function appendRecord(filePath, record) {
  const list = await readJson(filePath, []);
  list.push(record);
  await writeJson(filePath, list);
  return record;
}

function createMockLink(baseUrl, campaignName) {
  const safeBase = baseUrl || 'https://checkout.stripe.com';
  const slug = sanitizeString(campaignName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'donation';
  const id = `plink_mock_${crypto.randomUUID?.() || crypto.randomBytes(6).toString('hex')}`;
  const url = `${safeBase}/pay/${slug}-${id}`;
  return { id, url, provider: 'mock' };
}

function createGivingRouter({ stripe, hasStripe = false, getAppBaseUrl }) {
  const router = express.Router();

  router.get('/organizations', async (_req, res, next) => {
    try {
      const organizations = await readJson(ORGS_FILE, []);
      res.json({ organizations });
    } catch (error) {
      next(error);
    }
  });

  router.post('/organizations', async (req, res, next) => {
    try {
      const name = sanitizeString(req.body?.name);
      const region = sanitizeString(req.body?.region);
      const religion = sanitizeString(req.body?.religion).toLowerCase();
      if (!name) {
        return res.status(400).json({ error: 'organization_name_required' });
      }
      if (!region) {
        return res.status(400).json({ error: 'organization_region_required' });
      }
      if (!religion) {
        return res.status(400).json({ error: 'organization_religion_required' });
      }
      const organization = {
        _id: req.body?._id || `org_${crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex')}`,
        name,
        region,
        religion,
        locales: ensureArray(req.body?.locales).map(sanitizeString).filter(Boolean),
        timezone: sanitizeString(req.body?.timezone) || undefined,
        stripeAccountId: sanitizeString(req.body?.stripeAccountId) || undefined,
        createdAt: new Date().toISOString(),
      };

      await appendRecord(ORGS_FILE, organization);
      res.json({ organization });
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns', async (req, res, next) => {
    try {
      const campaigns = await readJson(CAMPAIGNS_FILE, []);
      const orgId = sanitizeString(req.query?.orgId);
      const filtered = orgId ? campaigns.filter(campaign => campaign.orgId === orgId) : campaigns;
      res.json({ campaigns: filtered });
    } catch (error) {
      next(error);
    }
  });

  router.post('/campaigns', async (req, res, next) => {
    try {
      const orgId = sanitizeString(req.body?.orgId);
      const name = sanitizeString(req.body?.name);
      if (!orgId) {
        return res.status(400).json({ error: 'campaign_org_required' });
      }
      if (!name) {
        return res.status(400).json({ error: 'campaign_name_required' });
      }
      const campaign = {
        _id: req.body?._id || `camp_${crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex')}`,
        orgId,
        name,
        code: sanitizeString(req.body?.code) || undefined,
        donationTypes: ensureArray(req.body?.donationTypes).map(sanitizeString).filter(Boolean),
        createdAt: new Date().toISOString(),
      };
      await appendRecord(CAMPAIGNS_FILE, campaign);
      res.json({ campaign });
    } catch (error) {
      next(error);
    }
  });

  router.get('/community-campaigns', async (_req, res, next) => {
    try {
      const campaigns = await readJson(COMMUNITY_FILE, []);
      campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json({ campaigns });
    } catch (error) {
      next(error);
    }
  });

  async function createFlexiblePaymentLink(req, { campaignName, description, currency, metadata = {} }) {
    const baseUrl = typeof getAppBaseUrl === 'function' ? getAppBaseUrl(req) : '';
    if (!hasStripe) {
      return createMockLink(baseUrl, campaignName);
    }

    try {
      if (stripe?.paymentLinks?.create) {
        const paymentLink = await stripe.paymentLinks.create({
          line_items: [
            {
              price_data: {
                currency: currency || 'usd',
                product_data: {
                  name: campaignName,
                  description: description?.slice?.(0, 200) || undefined,
                },
                custom_unit_amount: {
                  enabled: true,
                  minimum: 100,
                },
              },
              quantity: 1,
            },
          ],
          after_completion: {
            type: 'redirect',
            redirect: {
              url: `${baseUrl || 'https://www.delcotechdivision.com'}/thank-you.html`,
            },
          },
          allow_promotion_codes: true,
          metadata,
        });
        return { id: paymentLink.id, url: paymentLink.url, provider: 'stripe' };
      }
    } catch (error) {
      console.error('[Giving] Unable to create Stripe payment link', {
        error: error?.message || error,
      });
    }

    return createMockLink(baseUrl, campaignName);
  }

  router.post('/community-campaigns', async (req, res, next) => {
    try {
      const profileName = sanitizeString(req.body?.profileName);
      const religion = sanitizeString(req.body?.religion).toLowerCase();
      const region = sanitizeString(req.body?.region);
      const campaignName = sanitizeString(req.body?.campaignName);
      const description = sanitizeString(req.body?.description);
      const goalAmount = Number(req.body?.goalAmount || 0);
      const currency = normalizeCurrency(req.body?.currency || 'usd');
      if (!profileName) {
        return res.status(400).json({ error: 'profile_name_required' });
      }
      if (!religion) {
        return res.status(400).json({ error: 'religion_required' });
      }
      if (!region) {
        return res.status(400).json({ error: 'region_required' });
      }
      if (!campaignName) {
        return res.status(400).json({ error: 'campaign_name_required' });
      }
      if (!description) {
        return res.status(400).json({ error: 'campaign_description_required' });
      }
      if (!Number.isFinite(goalAmount) || goalAmount <= 0) {
        return res.status(400).json({ error: 'goal_amount_invalid' });
      }

      const imageUrl = await saveImageFromDataUrl(req.body?.image || req.body?.profileImage || null);
      const paymentLink = await createFlexiblePaymentLink(req, {
        campaignName,
        description,
        currency,
        metadata: {
          profileName,
          religion,
          region,
          goalAmount,
          communityCampaign: 'true',
          contactEmail: sanitizeString(req.body?.contactEmail) || undefined,
        },
      });

      const campaign = {
        id: req.body?.id || `community_${crypto.randomUUID?.() || crypto.randomBytes(10).toString('hex')}`,
        profileName,
        religion,
        region,
        campaignName,
        description,
        goalAmount,
        amountRaised: Number(req.body?.amountRaised || 0),
        allowEarlyWithdrawal: parseBoolean(req.body?.allowEarlyWithdrawal),
        currency,
        imageUrl,
        paymentLink,
        status: 'active',
        contactEmail: sanitizeString(req.body?.contactEmail) || undefined,
        createdAt: new Date().toISOString(),
      };

      await appendRecord(COMMUNITY_FILE, campaign);
      res.json({ campaign });
    } catch (error) {
      next(error);
    }
  });

  async function createCheckoutSession(req, payload) {
    const baseUrl = typeof getAppBaseUrl === 'function' ? getAppBaseUrl(req) : '';
    const safeBase = baseUrl || 'https://www.delcotechdivision.com';

    if (!hasStripe) {
      const mock = createMockLink(safeBase, payload.campaignName || 'donation');
      return { ...mock, meta: { mode: 'mock' } };
    }

    const amount = Number(payload.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Invalid amount.');
    }

    const interval = payload.interval && payload.interval !== 'one_time' ? payload.interval : null;
    const mode = interval ? 'subscription' : 'payment';
    const recurring = interval ? { interval } : undefined;

    const sessionParams = {
      mode,
      customer_email: payload.donor?.email || undefined,
      success_url: `${safeBase}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${safeBase}/multifaith-giving-platform.html#give`,
      allow_promotion_codes: Boolean(payload.allowPromo),
      metadata: {
        orgId: payload.orgId || undefined,
        campaignId: payload.campaignId || undefined,
        campaignName: payload.campaignName || undefined,
        orgName: payload.orgName || undefined,
        region: payload.region || undefined,
        religion: payload.religion || undefined,
        donationType: payload.donationType || undefined,
        donorName: payload.donor?.name || undefined,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: normalizeCurrency(payload.currency || 'usd'),
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: payload.campaignName || 'Faith community donation',
              description: payload.description?.slice?.(0, 200) || undefined,
            },
            recurring,
          },
        },
      ],
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    const meta = {
      mode,
      currency: session.currency || normalizeCurrency(payload.currency || 'usd')
    };
    if (session.subscription) {
      meta.subscription = session.subscription;
    }
    return { id: session.id, url: session.url, meta };
  }

  router.post('/payment-link', async (req, res, next) => {
    try {
      const payload = req.body || {};
      const link = await createCheckoutSession(req, payload);
      res.json({ url: link.url, id: link.id, meta: link.meta });
    } catch (error) {
      if (error?.type === 'StripeInvalidRequestError') {
        return res.status(400).json({ error: 'stripe_invalid_request', message: error.message });
      }
      if (error?.statusCode) {
        return res.status(error.statusCode).json({ error: 'stripe_error', message: error.message });
      }
      next(error);
    }
  });

  router.get('/faith-metrics', async (req, res) => {
    const forceRefresh = req.query?.refresh === '1';
    try {
      const metrics = await getFaithMetrics({ forceRefresh });
      res.json(metrics);
    } catch (error) {
      console.error('[Giving] Unable to load faith metrics', {
        error: error?.message || error
      });
      res.status(503).json({ error: 'faith_metrics_unavailable' });
    }
  });

  router.use((error, _req, res, _next) => {
    console.error('[Giving] API error', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error', message: error?.message || 'Unexpected error' });
    }
  });

  return router;
}

module.exports = createGivingRouter;
