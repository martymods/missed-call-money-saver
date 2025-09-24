const express = require('express');
const jwt = require('jsonwebtoken');
const { getCollection, ObjectId } = require('../services/mongo');
const { encryptString, decryptString } = require('../lib/crypto');
const { hashPassword, verifyPassword, generateTotpSecret, verifyTotp } = require('../lib/security');

const JWT_SECRET = process.env.JWT_SECRET || 'warehouse-hq-secret';

function sanitizeUser(user){
  if (!user) return null;
  return {
    id: user._id?.toString?.() || user._id,
    email: user.email,
    name: user.name || '',
    totpEnabled: !!(user.totp && user.totp.enabled),
    brandTheme: user.brandTheme || null,
    createdAt: user.createdAt,
  };
}

async function authenticate(req, res, next){
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')){
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    const users = await getCollection('users');
    const user = await users.findOne({ _id: new ObjectId(payload.sub) });
    if (!user){
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = user;
    req.token = token;
    next();
  } catch (err){
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function createToken(user){
  return jwt.sign({ sub: user._id?.toString?.() || user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function createRouter(){
  const router = express.Router();

  router.post('/register', async (req, res) => {
    try {
      const { email, password, name = '', enableTotp = false, brandTheme = null } = req.body || {};
      if (!email || !password){
        return res.status(400).json({ error: 'missing_fields' });
      }
      const users = await getCollection('users');
      const existing = await users.findOne({ email: email.toLowerCase() });
      if (existing){
        return res.status(409).json({ error: 'email_exists' });
      }
      const doc = {
        email: email.toLowerCase(),
        password: hashPassword(password),
        name: String(name || '').trim(),
        brandTheme: brandTheme || null,
        createdAt: new Date().toISOString(),
        totp: { enabled: false },
      };
      let totpProvisioning = null;
      if (enableTotp){
        const { secret, otpauth } = generateTotpSecret(`Warehouse HQ (${email})`);
        doc.totp = {
          enabled: true,
          secret: encryptString(secret),
          otpauth: encryptString(otpauth),
          updatedAt: new Date().toISOString(),
        };
        totpProvisioning = { secret, otpauth };
      }
      const result = await users.insertOne(doc);
      const savedUser = { ...doc, _id: result.insertedId };
      const token = createToken(savedUser);
      res.json({ ok: true, token, user: sanitizeUser(savedUser), totp: totpProvisioning });
    } catch (err){
      console.error('Register error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { email, password, totpToken } = req.body || {};
      if (!email || !password){
        return res.status(400).json({ error: 'missing_fields' });
      }
      const users = await getCollection('users');
      const user = await users.findOne({ email: email.toLowerCase() });
      if (!user){
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      const ok = verifyPassword(password, user.password);
      if (!ok){
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      if (user.totp && user.totp.enabled){
        if (!totpToken){
          return res.status(401).json({ error: 'totp_required' });
        }
        const secret = decryptString(user.totp.secret || '');
        const valid = verifyTotp(secret, totpToken, 1);
        if (!valid){
          return res.status(401).json({ error: 'totp_invalid' });
        }
      }
      const token = createToken(user);
      res.json({ ok: true, token, user: sanitizeUser(user) });
    } catch (err){
      console.error('Login error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ ok: true, user: sanitizeUser(req.user) });
  });

  router.post('/totp/enable', authenticate, async (req, res) => {
    try {
      const { label = 'Warehouse HQ' } = req.body || {};
      const { secret, otpauth } = generateTotpSecret(label, 'Warehouse HQ');
      const users = await getCollection('users');
      await users.updateOne({ _id: req.user._id }, {
        $set: {
          totp: {
            enabled: true,
            secret: encryptString(secret),
            otpauth: encryptString(otpauth),
            updatedAt: new Date().toISOString(),
          },
        },
      });
      res.json({ ok: true, secret, otpauth });
    } catch (err){
      console.error('Enable TOTP error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/totp/disable', authenticate, async (req, res) => {
    try {
      const users = await getCollection('users');
      await users.updateOne({ _id: req.user._id }, {
        $set: {
          totp: { enabled: false },
        },
      });
      res.json({ ok: true });
    } catch (err){
      console.error('Disable TOTP error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/brand', authenticate, async (req, res) => {
    try {
      const { brandTheme = null } = req.body || {};
      const users = await getCollection('users');
      await users.updateOne({ _id: req.user._id }, { $set: { brandTheme } });
      res.json({ ok: true });
    } catch (err){
      console.error('Brand update error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = {
  createUserRouter: createRouter,
  authenticate,
};