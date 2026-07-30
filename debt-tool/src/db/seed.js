#!/usr/bin/env node
import { getDb, closeDb } from './index.js';
import { ensureBootstrapAdmin } from './bootstrap.js';
import { getUserByEmail } from '../services/users.js';
import { createClient, findClientByIdNumber } from '../services/clients.js';
import { recordConsent } from '../services/consent.js';
import { runBureauEnquiry } from '../services/snapshots.js';
import { config } from '../config.js';

/**
 * Creates a first administrator, and — outside production — a demonstration
 * client with a simulated credit profile so the tool can be shown working
 * before any bureau contract is in place.
 *
 * Run: npm run seed
 */
const db = getDb();

const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@mlinjana.co.za';

// Same routine the server runs on first boot, so there is one definition of
// "how the first administrator gets created" rather than two that can drift.
let admin = ensureBootstrapAdmin(db);
if (!admin) {
  console.log('Staff accounts already exist — leaving them alone.');
  // May still be null if the existing accounts use a different address; the
  // demo data below only needs somebody to attribute the records to.
  admin = getUserByEmail(adminEmail, db) ?? db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get() ?? null;
}

if (config.env !== 'production' && config.bureau.allowMock) {
  await seedDemoClient();
} else {
  console.log('Skipping demonstration data (production, or simulated bureau disabled).');
}

closeDb();

async function seedDemoClient() {
  // A valid, deliberately fictional ID number — the check digit is correct so it
  // passes validation, but the date belongs to no real record.
  const demoId = '9202204720083';

  if (findClientByIdNumber(demoId, db)) {
    console.log('Demonstration client already present — leaving it alone.');
    return;
  }

  const client = createClient({
    firstName: 'Thandiwe',
    lastName: 'Demo',
    idNumber: demoId,
    email: 'thandiwe.demo@example.co.za',
    phone: '072 000 0000',
    employmentStatus: 'permanent',
    maritalStatus: 'single',
    dependants: 2,
    notes: 'Demonstration file. All figures on this client are simulated.',
  }, { actorId: admin?.id ?? null }, db);

  recordConsent({
    clientId: client.id,
    consentType: 'bureau_enquiry',
    method: 'written',
    evidenceRef: 'Demonstration file — no real mandate exists',
    capturedBy: admin?.id ?? null,
  }, db);

  db.prepare(`
    INSERT INTO financial_profiles (
      client_id, gross_monthly_income_cents, net_monthly_income_cents, other_income_cents, expenses_json, captured_by
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    client.id,
    3200000,
    2450000,
    0,
    JSON.stringify({
      housing: 750000, utilities: 180000, groceries: 420000,
      transport: 260000, education: 150000, medical: 130000, communication: 60000,
    }),
    admin?.id ?? null,
  );

  await runBureauEnquiry({ client, providerId: 'mock', actor: admin }, db);

  console.log(`Demonstration client created: ${client.reference} (Thandiwe Demo) with a simulated profile.`);
}
