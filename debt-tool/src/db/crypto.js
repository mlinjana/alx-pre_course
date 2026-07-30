import crypto from 'node:crypto';
import { encryptionKey, config } from '../config.js';

const ALGO = 'aes-256-gcm';

/**
 * Encrypts a value for storage at rest. Returns `v1.<iv>.<tag>.<ciphertext>`,
 * all base64url. The version prefix means a future key rotation can recognise
 * and re-wrap old rows instead of guessing at the format.
 */
export function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/**
 * Reverses encryptField. Throws if the ciphertext has been tampered with —
 * a silent fallback here would let corrupted ID numbers flow into a bureau enquiry.
 */
export function decryptField(stored) {
  if (!stored) return null;
  const [version, ivB64, tagB64, dataB64] = String(stored).split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognised encrypted field format');
  }
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Deterministic keyed hash, so we can find a client by ID number without
 * decrypting every row. Keyed (not a bare SHA) so that a leaked database does
 * not let someone confirm an ID number by hashing guesses offline without the key.
 */
export function blindIndex(value) {
  return crypto
    .createHmac('sha256', encryptionKey)
    .update(normaliseIdNumber(value))
    .digest('base64url');
}

export function normaliseIdNumber(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Hashes a password with scrypt. Returns { hash, salt } as base64url strings. */
export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'base64url');
  const hash = crypto.scryptSync(String(password), saltBuf, 64, { N: 16384, r: 8, p: 1 });
  return { hash: hash.toString('base64url'), salt: saltBuf.toString('base64url') };
}

/** Constant-time password check. */
export function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = hashPassword(password, storedSalt);
  const a = Buffer.from(hash, 'base64url');
  const b = Buffer.from(storedHash, 'base64url');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Opaque session token; only its hash is ever stored. */
export function newSessionToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHmac('sha256', config.secret).update(String(token)).digest('base64url');
}
