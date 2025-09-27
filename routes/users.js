const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getCollection, ObjectId } = require('../services/mongo');
const { encryptString, decryptString } = require('../lib/crypto');
const { hashPassword, verifyPassword, generateTotpSecret, verifyTotp } = require('../lib/security');

const JWT_SECRET = process.env.JWT_SECRET || 'warehouse-hq-secret';
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'whq_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 30);
const SESSION_SAME_SITE = process.env.SESSION_SAMESITE || 'Lax';
const SESSION_SECURE = String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true';
const PROFILE_ROLES = ['freelancer', 'employee', 'owner'];
const DEFAULT_PROFILE_ROLE = PROFILE_ROLES[0];
const MAX_PROFILE_HEADLINE = 120;
const MAX_PROFILE_SERVICE_AREA = 120;
const MAX_PROFILE_BIO = 1000;
const MAX_PROFILE_PHOTO_BYTES = Number(process.env.PROFILE_PHOTO_MAX_BYTES || 250000);

function cookieShouldBeSecure(){
  if (SESSION_SECURE) return true;
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  return env === 'production';
}

function parseCookies(header = ''){
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [name, ...rest] = part.trim().split('=');
    if (!name) return acc;
    const value = rest.join('=');
    acc[name] = decodeURIComponent(value || '');
    return acc;
  }, {});
}

function getSessionTokenFromRequest(req){
  const cookies = parseCookies(req.headers?.cookie || '');
  const token = cookies[SESSION_COOKIE];
  return token ? token : null;
}

function formatCookieValue(value, maxAgeSeconds){
  const parts = [`${SESSION_COOKIE}=${value}`];
  if (typeof maxAgeSeconds === 'number'){
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push(`SameSite=${SESSION_SAME_SITE}`);
  if (cookieShouldBeSecure()) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(res, token){
  const encoded = encodeURIComponent(token);
  res.setHeader('Set-Cookie', formatCookieValue(encoded, SESSION_TTL_MS / 1000));
}

function clearSessionCookie(res){
  res.setHeader('Set-Cookie', formatCookieValue('', 0));
}

function hashSessionToken(token){
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateSessionToken(){
  return crypto.randomBytes(48)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function clientIp(req){
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded){
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

function toBoolean(value){
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function cleanText(value, maxLength){
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!maxLength || trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
}

function normalizeRole(role){
  if (!role) return DEFAULT_PROFILE_ROLE;
  const normalized = String(role).trim().toLowerCase();
  return PROFILE_ROLES.includes(normalized) ? normalized : DEFAULT_PROFILE_ROLE;
}

function extractProfilePayload(source = {}){
  const profile = source && typeof source.profile === 'object' ? source.profile : {};
  const fallback = key => profile[key] ?? source[key];
  return {
    role: normalizeRole(fallback('role')),
    headline: cleanText(fallback('headline') ?? fallback('profileHeadline') ?? '', MAX_PROFILE_HEADLINE),
    serviceArea: cleanText(fallback('serviceArea') ?? fallback('profileServiceArea') ?? '', MAX_PROFILE_SERVICE_AREA),
    bio: cleanText(fallback('bio') ?? fallback('profileBio') ?? '', MAX_PROFILE_BIO),
  };
}

function normalizePhotoPayload(input){
  if (!input || typeof input !== 'object') return null;
  let { data, mimeType } = input;
  if (typeof data === 'string' && data.startsWith('data:')){
    const match = data.match(/^data:([^;]+);base64,(.*)$/);
    if (match){
      mimeType = match[1];
      data = match[2];
    }
  }
  if (!data || !mimeType){
    return null;
  }
  const safeMime = String(mimeType || '').toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(safeMime)){
    return null;
  }
  const trimmed = typeof data === 'string' ? data.trim() : '';
  if (!trimmed){
    return null;
  }
  let buffer;
  try {
    buffer = Buffer.from(trimmed, 'base64');
  } catch (err){
    return null;
  }
  if (!buffer.length){
    return null;
  }
  if (buffer.length > MAX_PROFILE_PHOTO_BYTES){
    const error = new Error('photo_too_large');
    error.code = 'photo_too_large';
    throw error;
  }
  return {
    data: trimmed,
    mimeType: safeMime,
    size: buffer.length,
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeProfile(profile){
  const safeProfile = {
    role: normalizeRole(profile?.role),
    headline: cleanText(profile?.headline || '', MAX_PROFILE_HEADLINE),
    serviceArea: cleanText(profile?.serviceArea || '', MAX_PROFILE_SERVICE_AREA),
    bio: cleanText(profile?.bio || '', MAX_PROFILE_BIO),
    photo: null,
  };
  if (profile?.photo && profile.photo.data && profile.photo.mimeType){
    try {
      const url = `data:${profile.photo.mimeType};base64,${profile.photo.data}`;
      safeProfile.photo = {
        url,
        mimeType: profile.photo.mimeType,
        size: profile.photo.size || Buffer.from(profile.photo.data, 'base64').length,
        updatedAt: profile.photo.updatedAt || null,
      };
    } catch (err){
      safeProfile.photo = null;
    }
  }
  return safeProfile;
}

async function createSession(user, req){
  const sessions = await getCollection('sessions');
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const doc = {
    _id: tokenHash,
    tokenHash,
    userId: user._id,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    userAgent: req.headers?.['user-agent'] || '',
    ip: clientIp(req),
  };
  await sessions.insertOne(doc);
  return { token, doc };
}

async function deleteSessionByToken(token){
  if (!token) return;
  const sessions = await getCollection('sessions');
  await sessions.deleteOne({ _id: hashSessionToken(token) });
}

async function findSessionByToken(token){
  if (!token) return null;
  const sessions = await getCollection('sessions');
  const tokenHash = hashSessionToken(token);
  const session = await sessions.findOne({ _id: tokenHash });
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()){
    await sessions.deleteOne({ _id: tokenHash });
    return null;
  }
  return session;
}

async function refreshSession(session){
  try {
    const sessions = await getCollection('sessions');
    const now = new Date();
    const updates = {
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };
    await sessions.updateOne({ _id: session._id || session.tokenHash }, { $set: updates });
  } catch (err){
    console.error('Session refresh failed', err);
  }
}

function normalizeUserIdForQuery(userId){
  if (!userId) return userId;
  if (typeof userId === 'string' || typeof userId === 'number'){
    try {
      return new ObjectId(userId);
    } catch (err){
      return userId;
    }
  }
  return userId;
}

async function attachSession(res, user, req){
  try {
    const existingToken = getSessionTokenFromRequest(req);
    if (existingToken){
      await deleteSessionByToken(existingToken);
    }
    const { token } = await createSession(user, req);
    setSessionCookie(res, token);
  } catch (err){
    console.error('Session create failed', err);
    clearSessionCookie(res);
  }
}
function sanitizeUser(user){
  if (!user) return null;
  return {
    id: user._id?.toString?.() || user._id,
    email: user.email,
    name: cleanText(user.name || '', 120),
    totpEnabled: !!(user.totp && user.totp.enabled),
    brandTheme: user.brandTheme || null,
    createdAt: user.createdAt,
    profile: sanitizeProfile(user.profile || {}),
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
      const {
        email: rawEmail,
        password,
        name = '',
        enableTotp = false,
        brandTheme = null,
      } = req.body || {};
      const email = String(rawEmail || '').trim().toLowerCase();
      if (!email || !password){
        return res.status(400).json({ error: 'missing_fields' });
      }
      const users = await getCollection('users');
      const existing = await users.findOne({ email });
      if (existing){
        return res.status(409).json({ error: 'email_exists' });
      }
      const profilePayload = extractProfilePayload(req.body || {});
      let photoPayload = null;
      try {
        photoPayload = normalizePhotoPayload(req.body?.profilePhoto);
      } catch (photoErr){
        if (photoErr?.code === 'photo_too_large'){
          return res.status(413).json({ error: 'photo_too_large' });
        }
        return res.status(400).json({ error: 'invalid_photo' });
      }
      const doc = {
        email,
        password: hashPassword(password),
        name: cleanText(name || '', 120),
        brandTheme: brandTheme || null,
        createdAt: new Date().toISOString(),
        totp: { enabled: false },
        profile: { ...profilePayload, photo: photoPayload },
      };
      let totpProvisioning = null;
      if (toBoolean(enableTotp)){
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
      await attachSession(res, savedUser, req);
      res.json({ ok: true, token, user: sanitizeUser(savedUser), totp: totpProvisioning });
    } catch (err){
      console.error('Register error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const { email: rawEmail, password, totpToken } = req.body || {};
      const email = String(rawEmail || '').trim().toLowerCase();
      if (!email || !password){
        return res.status(400).json({ error: 'missing_fields' });
      }
      const users = await getCollection('users');
      const user = await users.findOne({ email });
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
      await attachSession(res, user, req);
      res.json({ ok: true, token, user: sanitizeUser(user) });
    } catch (err){
      console.error('Login error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/session', async (req, res) => {
    try {
      const sessionToken = getSessionTokenFromRequest(req);
      if (!sessionToken){
        clearSessionCookie(res);
        return res.status(204).end();
      }
      const session = await findSessionByToken(sessionToken);
      if (!session){
        clearSessionCookie(res);
        return res.status(204).end();
      }
      const users = await getCollection('users');
      const user = await users.findOne({ _id: normalizeUserIdForQuery(session.userId) });
      if (!user){
        await deleteSessionByToken(sessionToken);
        clearSessionCookie(res);
        return res.status(204).end();
      }
      await refreshSession(session);
      setSessionCookie(res, sessionToken);
      const token = createToken(user);
      res.json({ ok: true, token, user: sanitizeUser(user) });
    } catch (err){
      console.error('Session lookup error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const sessionToken = getSessionTokenFromRequest(req);
      if (sessionToken){
        await deleteSessionByToken(sessionToken);
      }
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (err){
      console.error('Logout error', err);
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

  router.post('/profile', authenticate, async (req, res) => {
    try {
      const { name = '' } = req.body || {};
      const profilePayload = extractProfilePayload(req.body || {});
      let photoPayload = null;
      try {
        photoPayload = normalizePhotoPayload(req.body?.profilePhoto);
      } catch (photoErr){
        if (photoErr?.code === 'photo_too_large'){
          return res.status(413).json({ error: 'photo_too_large' });
        }
        return res.status(400).json({ error: 'invalid_photo' });
      }
      const removePhoto = toBoolean(req.body?.removePhoto);
      const users = await getCollection('users');
      const existingProfile = req.user.profile && typeof req.user.profile === 'object' ? req.user.profile : {};
      const updatedProfile = { ...existingProfile, ...profilePayload };
      if (photoPayload){
        updatedProfile.photo = photoPayload;
      } else if (removePhoto){
        updatedProfile.photo = null;
      }
      const updates = {
        name: cleanText(name || '', 120),
        profile: updatedProfile,
        updatedAt: new Date().toISOString(),
      };
      await users.updateOne({ _id: req.user._id }, { $set: updates });
      const freshUser = { ...req.user, ...updates };
      res.json({ ok: true, user: sanitizeUser(freshUser) });
    } catch (err){
      if (err?.code === 'photo_too_large'){
        return res.status(413).json({ error: 'photo_too_large' });
      }
      console.error('Profile update error', err);
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