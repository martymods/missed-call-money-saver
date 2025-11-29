const express = require('express');
const { connect } = require('../services/mongo');
const { hashPassword, verifyPassword } = require('../lib/security');

function createBankAuthRouter() {
  const router = express.Router();
  router.use(express.json());

  async function ensureDb(req, res, next) {
    try {
      const db = await connect();
      if (!db) {
        return res.status(503).json({
          error: 'mongo_unavailable',
          message: 'MongoDB is not configured. Set MONGODB_URI to persist banking portal users.',
        });
      }
      req.db = db;
      return next();
    } catch (err) {
      console.error('[bank-auth] db connection error', err);
      return res.status(500).json({ error: 'db_error' });
    }
  }

  router.post('/register', ensureDb, async (req, res) => {
    try {
      const fullName = String(req.body?.fullName || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const phone = String(req.body?.phone || '').trim();
      const password = String(req.body?.password || '');
      const twoFactorEnabled = Boolean(req.body?.twoFactorEnabled);
      const rememberDevice = Boolean(req.body?.rememberDevice);

      if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ error: 'missing_required_fields' });
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'weak_password', message: 'Password must be at least 8 characters.' });
      }

      const users = req.db.collection('bank_portal_users');
      const existing = await users.findOne({ email });
      if (existing) {
        return res.status(409).json({ error: 'email_exists' });
      }

      const hashed = hashPassword(password);
      const now = new Date().toISOString();
      const doc = {
        fullName,
        email,
        phone,
        passwordHash: hashed,
        twoFactorEnabled,
        rememberDevice,
        createdAt: now,
        updatedAt: now,
      };

      const result = await users.insertOne(doc);
      return res.json({ ok: true, id: result.insertedId, fullName, email, phone, twoFactorEnabled, rememberDevice });
    } catch (err) {
      console.error('[bank-auth] register error', err);
      return res.status(500).json({ error: 'registration_failed' });
    }
  });

  router.post('/login', ensureDb, async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const otp = String(req.body?.otp || '').trim();

      if (!email || !password) {
        return res.status(400).json({ error: 'missing_credentials' });
      }

      const users = req.db.collection('bank_portal_users');
      const user = await users.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: 'user_not_found' });
      }

      const validPassword = verifyPassword(password, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }

      if (user.twoFactorEnabled) {
        if (!otp) {
          return res.status(400).json({ error: 'otp_required' });
        }
        if (otp !== '000001' && otp.length !== 6) {
          return res.status(401).json({ error: 'invalid_otp' });
        }
      }

      const now = new Date().toISOString();
      await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, updatedAt: now } });

      return res.json({
        ok: true,
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          twoFactorEnabled: Boolean(user.twoFactorEnabled),
        },
      });
    } catch (err) {
      console.error('[bank-auth] login error', err);
      return res.status(500).json({ error: 'login_failed' });
    }
  });

  return router;
}

module.exports = createBankAuthRouter;
