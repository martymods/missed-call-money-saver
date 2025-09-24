const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function hashPassword(password){
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512');
  return `${salt.toString('base64')}:${derived.toString('base64')}`;
}

function verifyPassword(password, stored){
  if (!stored) return false;
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512');
  return crypto.timingSafeEqual(derived, expected);
}

function randomBase32(length = 32){
  let output = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++){
    output += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return output;
}

function base32ToBuffer(base32){
  let bits = '';
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  for (const char of clean){
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8){
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpSecret(label = 'Warehouse HQ', issuer = 'Warehouse HQ'){
  const secret = randomBase32(32);
  const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
  return { secret, otpauth };
}

function totpCode(secret, timestamp = Date.now(), step = 30, digits = 6, offset = 0){
  const counter = Math.floor(timestamp / 1000 / step) + offset;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const key = base32ToBuffer(secret);
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const pos = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[pos] & 0x7f) << 24) |
    ((hmac[pos + 1] & 0xff) << 16) |
    ((hmac[pos + 2] & 0xff) << 8) |
    (hmac[pos + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

function verifyTotp(secret, token, window = 1){
  if (!secret || !token) return false;
  const normalized = String(token).replace(/\s+/g, '');
  for (let offset = -window; offset <= window; offset++){
    if (totpCode(secret, Date.now(), 30, 6, offset) === normalized){
      return true;
    }
  }
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotp,
};