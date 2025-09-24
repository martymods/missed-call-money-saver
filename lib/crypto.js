const crypto = require('crypto');

const RAW_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || '';
let cachedKey = null;

function getKey(){
  if (!RAW_KEY) return null;
  if (!cachedKey){
    cachedKey = crypto.createHash('sha256').update(RAW_KEY).digest();
  }
  return cachedKey;
}

function encryptString(plain=''){
  if (typeof plain !== 'string') plain = JSON.stringify(plain);
  if (!plain) return '';
  const key = getKey();
  if (!key){
    return Buffer.from(String(plain), 'utf8').toString('base64');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptString(token=''){
  if (!token) return '';
  const key = getKey();
  if (!key){
    try {
      return Buffer.from(String(token), 'base64').toString('utf8');
    } catch (err){
      return '';
    }
  }
  try {
    const [ivB64, tagB64, dataB64] = token.split('.');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err){
    return '';
  }
}

module.exports = { encryptString, decryptString };