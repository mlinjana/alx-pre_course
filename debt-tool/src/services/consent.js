import { getDb } from '../db/index.js';
import { toSqlDateTime, endOfDaySql } from '../lib/dates.js';

/**
 * Consent gating.
 *
 * Running a credit bureau enquiry on someone without their consent is unlawful
 * under both the NCA and POPIA. The rule is enforced here, in one place, and
 * every enquiry path calls assertBureauConsent() before touching a provider —
 * so consent cannot be skipped by adding a new route that forgets to check.
 */
export class ConsentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConsentError';
    this.statusCode = 403;
  }
}

export function recordConsent({
  clientId,
  consentType = 'bureau_enquiry',
  method,
  grantedAt = new Date(),
  expiresAt = null,
  evidenceRef = null,
  capturedBy = null,
}, database = getDb()) {
  // Both timestamps must land in SQLite's own format, or the string comparisons
  // in activeConsent() below will not do what they read like they do.
  const result = database.prepare(`
    INSERT INTO consents (client_id, consent_type, granted_at, expires_at, method, evidence_ref, captured_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    clientId,
    consentType,
    toSqlDateTime(grantedAt),
    expiresAt ? endOfDaySql(expiresAt) : null,
    method,
    evidenceRef,
    capturedBy,
  );
  return getConsentById(Number(result.lastInsertRowid), database);
}

export function getConsentById(id, database = getDb()) {
  return database.prepare('SELECT * FROM consents WHERE id = ?').get(id) ?? null;
}

export function revokeConsent(consentId, database = getDb()) {
  database.prepare("UPDATE consents SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(consentId);
}

export function listConsents(clientId, database = getDb()) {
  return database.prepare(`
    SELECT c.*, u.full_name AS captured_by_name
    FROM consents c LEFT JOIN users u ON u.id = c.captured_by
    WHERE c.client_id = ? ORDER BY c.granted_at DESC
  `).all(clientId);
}

/**
 * The live consent of a given type, or null. "Live" means granted, not revoked,
 * and not past its expiry date.
 */
export function activeConsent(clientId, consentType = 'bureau_enquiry', database = getDb()) {
  return database.prepare(`
    SELECT * FROM consents
    WHERE client_id = ?
      AND consent_type = ?
      AND revoked_at IS NULL
      AND granted_at <= datetime('now')
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY granted_at DESC
    LIMIT 1
  `).get(clientId, consentType) ?? null;
}

export function hasBureauConsent(clientId, database = getDb()) {
  return activeConsent(clientId, 'bureau_enquiry', database) !== null;
}

/** Throws unless the client has live consent for a bureau enquiry. */
export function assertBureauConsent(clientId, database = getDb()) {
  const consent = activeConsent(clientId, 'bureau_enquiry', database);
  if (!consent) {
    throw new ConsentError(
      'No active consent on file for a credit bureau enquiry. Capture the client\'s signed consent before pulling their credit profile.',
    );
  }
  return consent;
}

export const CONSENT_METHODS = Object.freeze({
  written: 'Signed written mandate',
  electronic: 'Electronic signature / online form',
  voice_recorded: 'Recorded telephone consent',
  in_person: 'In-person, witnessed',
});
