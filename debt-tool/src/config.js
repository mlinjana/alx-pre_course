import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),

  // Where the SQLite file lives. Keep it off any web-served path.
  databaseFile: process.env.DATABASE_FILE || path.join(ROOT, 'data', 'mfg-debt-tool.db'),

  // Used to sign session cookies and to derive the field-encryption key.
  // A random value in development means sessions drop on restart, which is fine;
  // in production a missing secret is fatal (see assertProductionConfig).
  secret: process.env.APP_SECRET || crypto.randomBytes(32).toString('hex'),

  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 8),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),

  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads'),
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 15 * 1024 * 1024),

  // How long a bureau snapshot is considered current before the UI nudges for a refresh.
  snapshotStaleDays: int(process.env.SNAPSHOT_STALE_DAYS, 30),

  bureau: {
    // Which provider to use when staff do not specify one.
    default: process.env.BUREAU_DEFAULT || 'mock',

    // Set BUREAU_ALLOW_MOCK=false in production once real credentials are in place,
    // so a misconfiguration fails loudly instead of silently serving fake debt data.
    allowMock: bool(process.env.BUREAU_ALLOW_MOCK, true),

    timeoutMs: int(process.env.BUREAU_TIMEOUT_MS, 20000),

    transunion: {
      baseUrl: process.env.TRANSUNION_BASE_URL || '',
      clientId: process.env.TRANSUNION_CLIENT_ID || '',
      clientSecret: process.env.TRANSUNION_CLIENT_SECRET || '',
      subscriberCode: process.env.TRANSUNION_SUBSCRIBER_CODE || '',
      industry: process.env.TRANSUNION_INDUSTRY_CODE || 'DC',
    },
    experian: {
      baseUrl: process.env.EXPERIAN_BASE_URL || '',
      username: process.env.EXPERIAN_USERNAME || '',
      password: process.env.EXPERIAN_PASSWORD || '',
      subscriberCode: process.env.EXPERIAN_SUBSCRIBER_CODE || '',
    },
    xds: {
      baseUrl: process.env.XDS_BASE_URL || '',
      username: process.env.XDS_USERNAME || '',
      password: process.env.XDS_PASSWORD || '',
      productCode: process.env.XDS_PRODUCT_CODE || 'ConsumerCreditReport',
    },
  },
};

/**
 * Field-level encryption key for ID numbers and account numbers at rest.
 * Derived from APP_SECRET so operators manage one secret, not two.
 */
export const encryptionKey = crypto.hkdfSync(
  'sha256',
  Buffer.from(config.secret, 'utf8'),
  Buffer.from('mfg-debt-tool-field-encryption'),
  Buffer.from('aes-256-gcm'),
  32,
);

/**
 * Refuses to boot a production instance that is missing the settings which keep
 * client credit data private. Called from server.js before listening.
 */
export function assertProductionConfig() {
  if (config.env !== 'production') return;
  const problems = [];
  if (!process.env.APP_SECRET) problems.push('APP_SECRET must be set (a random 32+ byte hex string).');
  if (process.env.APP_SECRET && process.env.APP_SECRET.length < 32) problems.push('APP_SECRET is too short; use at least 32 characters.');
  if (!config.cookieSecure) problems.push('COOKIE_SECURE must be true so session cookies are HTTPS-only.');
  if (config.bureau.allowMock) problems.push('BUREAU_ALLOW_MOCK must be false in production so simulated data can never be mistaken for a real bureau pull.');
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
