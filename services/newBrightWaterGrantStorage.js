const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const fetch = global.fetch || require('node-fetch');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || '';
const R2_ENDPOINT = (process.env.R2_ENDPOINT || '').replace(/\/$/, '') || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');

const HAS_R2 = Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_ENDPOINT);

const BASE_PREFIX = 'new-bright-water-grant';
const APPLICATION_PREFIX = `${BASE_PREFIX}/applications`;
const UPLOAD_PREFIX = `${BASE_PREFIX}/uploads`;
const INDEX_KEY = `${APPLICATION_PREFIX}/index.json`;

const LOCAL_ROOT = path.join(__dirname, '..', 'data', 'new-bright-water-grant');
const LOCAL_UPLOAD_ROOT = path.join(LOCAL_ROOT, 'uploads');
fs.mkdirSync(LOCAL_UPLOAD_ROOT, { recursive: true });

function sanitizeFileName(name = '') {
  return String(name || 'attachment')
    .trim()
    .replace(/[\s]+/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 80) || 'attachment';
}

function encodeKey(key = '') {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = crypto.createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

async function r2Fetch({ method, key, body = null, contentType = null }) {
  if (!HAS_R2) {
    throw new Error('R2 storage is not configured');
  }

  const encodedKey = encodeKey(key);
  const url = `${R2_ENDPOINT}/${R2_BUCKET}/${encodedKey}`;
  const targetUrl = new URL(url);
  const host = targetUrl.host;

  const now = new Date();
  const iso = now.toISOString();
  const dateStamp = iso.slice(0, 10).replace(/-/g, '');
  const amzDate = `${dateStamp}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
  const region = 'auto';
  const service = 's3';

  const payloadBuffer = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
  const payloadHash = hash(payloadBuffer);

  const headersForSig = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (contentType) {
    headersForSig['content-type'] = contentType;
  }

  const sortedHeaderKeys = Object.keys(headersForSig)
    .map(keyName => keyName.toLowerCase())
    .sort();

  const normalizedHeaders = {};
  for (const keyName of sortedHeaderKeys) {
    normalizedHeaders[keyName] = String(headersForSig[keyName]).trim().replace(/\s+/g, ' ');
  }

  const canonicalHeaders = sortedHeaderKeys.map(name => `${name}:${normalizedHeaders[name]}`).join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    `/${R2_BUCKET}/${encodedKey}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const hashedCanonicalRequest = hash(canonicalRequest);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  const signingKey = getSignatureKey(R2_SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const requestHeaders = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };

  if (contentType) {
    requestHeaders['content-type'] = contentType;
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: payloadBuffer.length ? payloadBuffer : undefined,
  });

  return response;
}

async function putToR2(key, body, contentType) {
  const response = await r2Fetch({ method: 'PUT', key, body, contentType });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`R2 put failed (${response.status}): ${text}`);
  }
}

async function getFromR2(key) {
  try {
    const response = await r2Fetch({ method: 'GET', key });
    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`R2 get failed (${response.status}): ${text}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error?.message?.includes('404')) {
      return null;
    }
    throw error;
  }
}

async function getStreamFromR2(key) {
  const response = await r2Fetch({ method: 'GET', key });
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`R2 get stream failed (${response.status}): ${text}`);
  }

  return {
    stream: response.body,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    contentLength: response.headers.get('content-length') || undefined,
  };
}

async function loadIndex() {
  if (HAS_R2) {
    const buffer = await getFromR2(INDEX_KEY);
    if (!buffer) return [];
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      return [];
    }
  }

  try {
    const raw = await fsp.readFile(path.join(LOCAL_ROOT, 'index.json'), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ERR_MODULE_NOT_FOUND')) {
      return [];
    }
    throw error;
  }
}

async function saveIndex(entries) {
  const payload = Buffer.from(JSON.stringify(entries, null, 2));
  if (HAS_R2) {
    await putToR2(INDEX_KEY, payload, 'application/json');
    return;
  }

  await fsp.writeFile(path.join(LOCAL_ROOT, 'index.json'), payload);
}

function buildIndexSummary(record) {
  return {
    id: record.id,
    submittedAt: record.submittedAt,
    firstName: record.applicant?.['first-name'] || '',
    lastName: record.applicant?.['last-name'] || '',
    email: record.applicant?.email || '',
    businessType: record.applicant?.['business-type'] || '',
    revenue: record.applicant?.revenue || '',
    status: record.status || 'pending_fee',
  };
}

async function saveApplicationRecord(record) {
  if (!record || !record.id) {
    throw new Error('Invalid record payload');
  }

  const serialized = Buffer.from(JSON.stringify(record, null, 2));
  if (HAS_R2) {
    await putToR2(`${APPLICATION_PREFIX}/${record.id}.json`, serialized, 'application/json');
  } else {
    await fsp.mkdir(LOCAL_ROOT, { recursive: true });
    await fsp.writeFile(path.join(LOCAL_ROOT, `${record.id}.json`), serialized);
  }

  const index = await loadIndex();
  const filtered = index.filter(entry => entry.id !== record.id);
  filtered.push(buildIndexSummary(record));
  filtered.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  await saveIndex(filtered);
}

async function getApplicationById(id) {
  if (!id) return null;

  if (HAS_R2) {
    const buffer = await getFromR2(`${APPLICATION_PREFIX}/${id}.json`);
    if (!buffer) return null;
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      return null;
    }
  }

  try {
    const raw = await fsp.readFile(path.join(LOCAL_ROOT, `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function listApplications() {
  const index = await loadIndex();
  const applications = [];
  for (const entry of index) {
    const record = await getApplicationById(entry.id).catch(() => null);
    if (record) {
      applications.push(record);
    }
  }
  applications.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  return applications;
}

async function storeUploadedFile({ applicationId, fileId, buffer, contentType, originalName }) {
  const safeName = sanitizeFileName(originalName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const storageKey = `${UPLOAD_PREFIX}/${applicationId}/${fileId}-${timestamp}-${safeName}`;
  const payload = buffer || Buffer.alloc(0);

  if (HAS_R2) {
    await putToR2(storageKey, payload, contentType || 'application/octet-stream');
  } else {
    const localPath = path.join(LOCAL_UPLOAD_ROOT, applicationId);
    await fsp.mkdir(localPath, { recursive: true });
    await fsp.writeFile(path.join(localPath, `${fileId}-${timestamp}-${safeName}`), payload);
  }

  return {
    id: fileId,
    fileName: originalName || safeName,
    mimeType: contentType || 'application/octet-stream',
    size: payload.length,
    storageKey,
    uploadedAt: new Date().toISOString(),
  };
}

async function getFileStream(applicationId, fileId) {
  const record = await getApplicationById(applicationId);
  if (!record) return null;
  const fileMeta = (record.files || []).find(file => file.id === fileId);
  if (!fileMeta) return null;

  if (HAS_R2) {
    const streamPayload = await getStreamFromR2(fileMeta.storageKey);
    if (!streamPayload) return null;
    return {
      stream: streamPayload.stream,
      contentType: streamPayload.contentType,
      contentLength: streamPayload.contentLength,
      fileName: fileMeta.fileName,
    };
  }

  const relative = fileMeta.storageKey.replace(`${UPLOAD_PREFIX}/`, '');
  const parts = relative.split('/').filter(Boolean);
  const filePath = path.join(LOCAL_UPLOAD_ROOT, ...parts);
  try {
    const stats = await fsp.stat(filePath);
    return {
      stream: fs.createReadStream(filePath),
      contentType: fileMeta.mimeType || 'application/octet-stream',
      contentLength: String(stats.size),
      fileName: fileMeta.fileName,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

module.exports = {
  HAS_R2,
  saveApplicationRecord,
  getApplicationById,
  listApplications,
  storeUploadedFile,
  getFileStream,
};
