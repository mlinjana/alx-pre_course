import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb } from '../src/db/index.js';
import {
  recordConsent, revokeConsent, hasBureauConsent, assertBureauConsent, ConsentError,
} from '../src/services/consent.js';
import { toSqlDateTime } from '../src/lib/dates.js';

/** A throwaway database with one client, for exercising the consent gate. */
function setup() {
  const db = openMemoryDb();
  db.prepare(`
    INSERT INTO clients (id, reference, first_name, last_name, id_number_enc, id_number_hash, id_number_last4)
    VALUES (1, 'MFG-TEST-0001', 'Test', 'Client', 'enc', 'hash', '0083')
  `).run();
  return db;
}

test('a client with no consent cannot have their credit profile pulled', () => {
  const db = setup();
  assert.equal(hasBureauConsent(1, db), false);
  assert.throws(() => assertBureauConsent(1, db), ConsentError);
});

test('consent recorded now takes effect immediately', () => {
  // The regression this protects: an ISO timestamp compared against SQLite's
  // datetime('now') sorted wrongly, so freshly captured consent read as
  // not-yet-valid and blocked the enquiry the consultant had just authorised.
  const db = setup();
  recordConsent({ clientId: 1, consentType: 'bureau_enquiry', method: 'written' }, db);
  assert.equal(hasBureauConsent(1, db), true);
  assert.doesNotThrow(() => assertBureauConsent(1, db));
});

test('revoked consent stops further enquiries', () => {
  const db = setup();
  const consent = recordConsent({ clientId: 1, consentType: 'bureau_enquiry', method: 'electronic' }, db);
  assert.equal(hasBureauConsent(1, db), true);

  revokeConsent(consent.id, db);
  assert.equal(hasBureauConsent(1, db), false);
  assert.throws(() => assertBureauConsent(1, db), ConsentError);
});

test('expired consent stops further enquiries', () => {
  const db = setup();
  recordConsent({
    clientId: 1,
    consentType: 'bureau_enquiry',
    method: 'written',
    grantedAt: toSqlDateTime(new Date(Date.now() - 400 * 86400_000)),
    expiresAt: '2020-01-01',
  }, db);
  assert.equal(hasBureauConsent(1, db), false);
});

test('consent lasts through the whole of its expiry day', () => {
  const db = setup();
  const today = new Date().toISOString().slice(0, 10);
  recordConsent({ clientId: 1, consentType: 'bureau_enquiry', method: 'written', expiresAt: today }, db);
  assert.equal(hasBureauConsent(1, db), true, 'consent expiring today is still valid today');
});

test('consent for something else does not authorise a bureau enquiry', () => {
  // Agreeing to marketing is not agreeing to a credit search.
  const db = setup();
  recordConsent({ clientId: 1, consentType: 'marketing', method: 'electronic' }, db);
  assert.equal(hasBureauConsent(1, db), false);
});

test('the most recent consent wins after a revoke and re-grant', () => {
  const db = setup();
  const first = recordConsent({ clientId: 1, consentType: 'bureau_enquiry', method: 'written' }, db);
  revokeConsent(first.id, db);
  recordConsent({ clientId: 1, consentType: 'bureau_enquiry', method: 'in_person' }, db);
  assert.equal(hasBureauConsent(1, db), true);
});
