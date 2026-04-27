// src/utils/crypto.js
// Encrypt/decrypt tenant credentials (WA tokens, etc.)

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const KEY = crypto.scryptSync(SECRET, 'asos-salt', 32);

const encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  try {
    const [ivHex, tagHex, dataHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  } catch {
    return null;
  }
};

const hashPhone = (phone) => {
  return crypto.createHash('sha256').update(phone.replace(/\D/g, '')).digest('hex');
};

module.exports = { encrypt, decrypt, hashPhone };
