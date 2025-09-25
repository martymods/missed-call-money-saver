const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getCollection } = require('../services/mongo');

const STORAGE_DIR = path.join(__dirname, '..', 'data', 'design-submissions');
const INLINE_CHAR_LIMIT = Number(process.env.DESIGN_INLINE_CHAR_LIMIT || 250000);
const MAX_STRING_LENGTH = Number(process.env.DESIGN_FIELD_CHAR_LIMIT || 4000);

const MIME_EXT_MAP = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

function ensureStorageDir(){
  if (!fs.existsSync(STORAGE_DIR)){
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function guessExtension(mime, fallbackName){
  if (mime && MIME_EXT_MAP[mime]){
    return MIME_EXT_MAP[mime];
  }
  if (fallbackName && fallbackName.includes('.')){
    const raw = fallbackName.split('.').pop();
    if (raw){
      const safe = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (safe) return safe;
    }
  }
  return 'bin';
}

function decodeDataPayload(raw){
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dataUrlMatch = /^data:([^;,]+)?((?:;[^,]+)*)?,(.*)$/s.exec(trimmed);
  if (dataUrlMatch){
    const mime = dataUrlMatch[1] || 'application/octet-stream';
    const extras = dataUrlMatch[2] || '';
    const payload = dataUrlMatch[3] || '';
    const isBase64 = extras.split(';').map(p => p.trim()).includes('base64');
    try {
      const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
      return { buffer, mime, encoding: isBase64 ? 'base64' : 'utf8' };
    } catch (err){
      return null;
    }
  }

  try {
    const buffer = Buffer.from(trimmed, 'base64');
    return { buffer, mime: null, encoding: 'base64' };
  } catch (err){
    return null;
  }
}

function sanitizeValue(value, depth = 0){
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'string'){
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const limit = depth <= 1 ? MAX_STRING_LENGTH : Math.min(MAX_STRING_LENGTH, 1200);
    return trimmed.slice(0, limit);
  }

  if (typeof value === 'number' || typeof value === 'boolean'){
    return value;
  }

  if (Array.isArray(value)){
    const result = [];
    for (const entry of value){
      const sanitized = sanitizeValue(entry, depth + 1);
      if (sanitized !== undefined){
        result.push(sanitized);
      }
      if (result.length >= 100 && depth > 1){
        break;
      }
    }
    return result.length ? result : undefined;
  }

  if (typeof value === 'object'){
    const result = {};
    for (const [key, val] of Object.entries(value)){
      if (typeof key !== 'string') continue;
      if (['data', 'base64', 'binary', 'file', 'blob'].includes(key)) continue;
      const sanitized = sanitizeValue(val, depth + 1);
      if (sanitized !== undefined){
        result[key] = sanitized;
      }
    }
    return Object.keys(result).length ? result : undefined;
  }

  return undefined;
}

async function persistAssets(assets = [], submissionId){
  if (!Array.isArray(assets) || assets.length === 0){
    return [];
  }

  const stored = [];

  for (let i = 0; i < assets.length; i += 1){
    const asset = assets[i];
    if (!asset || typeof asset !== 'object') continue;

    const id = typeof asset.id === 'string' && asset.id.trim() ? asset.id.trim() : crypto.randomUUID();
    const rawName = typeof asset.name === 'string' && asset.name.trim() ? asset.name.trim() : `asset-${i + 1}`;
    const safeName = rawName.slice(0, 140);
    const type = typeof asset.type === 'string' && asset.type.trim() ? asset.type.trim() : (typeof asset.mime === 'string' ? asset.mime.trim() : null);

    const record = {
      id,
      name: safeName,
      type: type || null,
      storage: 'metadata',
    };

    if (typeof asset.description === 'string' && asset.description.trim()){
      record.description = asset.description.trim().slice(0, 2000);
    }
    if (typeof asset.role === 'string' && asset.role.trim()){
      record.role = asset.role.trim().slice(0, 500);
    }
    if (typeof asset.variant === 'string' && asset.variant.trim()){
      record.variant = asset.variant.trim().slice(0, 500);
    }

    const payload = typeof asset.data === 'string' && asset.data
      ? asset.data
      : (typeof asset.base64 === 'string' && asset.base64 ? asset.base64 : null);

    if (typeof asset.url === 'string' && asset.url.trim()){
      record.url = asset.url.trim();
      record.storage = 'url';
    }

    if (payload){
      const decoded = decodeDataPayload(payload);
      if (decoded && decoded.buffer){
        ensureStorageDir();
        const mime = decoded.mime || type || 'application/octet-stream';
        const ext = guessExtension(mime, safeName);
        const filename = `${submissionId}-${id}.${ext}`;
        await fs.promises.writeFile(path.join(STORAGE_DIR, filename), decoded.buffer);
        record.storage = 'file';
        record.file = filename;
        record.bytes = decoded.buffer.length;
        record.mime = mime;
        record.encoding = decoded.encoding;
        record.hash = crypto.createHash('sha256').update(decoded.buffer).digest('hex');
        record.preview = payload.slice(0, 120);
      } else {
        const truncated = payload.length > INLINE_CHAR_LIMIT;
        const storedPayload = truncated ? payload.slice(0, INLINE_CHAR_LIMIT) : payload;
        record.storage = 'inline';
        record.data = storedPayload;
        record.truncated = truncated;
        record.bytes = Buffer.byteLength(storedPayload, 'utf8');
        record.preview = storedPayload.slice(0, 120);
      }
    }

    if (Number.isFinite(asset.size)){
      record.reportedSize = Number(asset.size);
    }

    stored.push(record);
  }

  return stored;
}

function summarizeAssets(assets){
  return assets.map(asset => ({
    id: asset.id,
    name: asset.name,
    storage: asset.storage,
    bytes: asset.bytes || asset.reportedSize || null,
    mime: asset.mime || asset.type || null,
  }));
}

function getApproximateBytes(req, payload){
  const headerSize = Number(req.headers['content-length']);
  if (Number.isFinite(headerSize) && headerSize > 0){
    return headerSize;
  }
  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch (err){
    return null;
  }
}

function extractIp(req){
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length){
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || null;
}

function createDesignRouter(){
  const router = express.Router();

  router.post('/submissions', async (req, res) => {
    try {
      const payload = req.body || {};
      const submissionId = crypto.randomUUID();
      const attachments = Array.isArray(payload.assets) ? payload.assets
        : Array.isArray(payload.attachments) ? payload.attachments
        : [];

      const storedAssets = await persistAssets(attachments, submissionId);

      const { assets, attachments: atts, files, ...rest } = payload;
      const sanitizedDetails = sanitizeValue(rest) || {};

      const col = await getCollection('designSubmissions');
      const now = new Date().toISOString();
      const metrics = {
        assetCount: storedAssets.length,
        requestBytes: getApproximateBytes(req, payload),
      };

      await col.insertOne({
        submissionId,
        status: 'received',
        createdAt: now,
        updatedAt: now,
        details: sanitizedDetails,
        assets: storedAssets,
        metrics,
        context: {
          ip: extractIp(req),
          userAgent: req.headers['user-agent'] || null,
        },
      });

      res.json({
        ok: true,
        submissionId,
        status: 'received',
        metrics,
        assets: summarizeAssets(storedAssets),
        message: 'Design proposal received. Our catalog team will reach out after review.',
      });
    } catch (err){
      console.error('Design submission error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = createDesignRouter;
