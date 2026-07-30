import crypto from 'node:crypto';
import { getDb } from './index.js';
import { createUser } from '../services/users.js';

/**
 * Creates the first administrator if — and only if — no users exist yet.
 *
 * This exists for hosted deployments, where the operator may have no shell to
 * run `npm run seed` in. The generated password is printed once to the startup
 * log, which on every hosting platform is readable from the dashboard.
 *
 * The guard is the whole safety story: the moment one user exists, this does
 * nothing, so it cannot resurrect an account someone deliberately disabled or
 * hand out a fresh password on every restart. The account is created with
 * must_reset set, so whoever signs in first is made to change it.
 */
export function ensureBootstrapAdmin(database = getDb()) {
  const { n } = database.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return null;

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@mlinjana.co.za';
  const supplied = process.env.SEED_ADMIN_PASSWORD;
  const password = supplied || crypto.randomBytes(12).toString('base64url');

  const user = createUser({
    email,
    fullName: process.env.SEED_ADMIN_NAME || 'MFG Administrator',
    role: 'admin',
    password,
    // A password chosen by the operator is theirs to keep; a generated one is
    // sitting in a log file and must be replaced at first sign-in.
    mustReset: !supplied,
  }, database);

  console.log('\n────────────────────────────────────────────────────────');
  console.log('  No staff accounts existed, so an administrator was created:');
  console.log(`    Email:    ${email}`);
  if (supplied) {
    console.log('    Password: (the SEED_ADMIN_PASSWORD you configured)');
  } else {
    console.log(`    Password: ${password}`);
    console.log('');
    console.log('  This password is now in this log. Sign in, change it, and');
    console.log('  treat the log as sensitive until you have.');
  }
  console.log('────────────────────────────────────────────────────────\n');

  return user;
}
