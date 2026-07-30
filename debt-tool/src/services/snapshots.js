import { getDb, transaction } from '../db/index.js';
import { encryptField } from '../db/crypto.js';
import { getProvider } from '../bureaus/index.js';
import { assertBureauConsent } from './consent.js';
import { revealIdNumber } from './clients.js';
import { recordAudit } from './audit.js';
import { daysSince } from '../lib/dates.js';
import { config } from '../config.js';

/**
 * Runs a credit bureau enquiry and stores the result as an immutable snapshot.
 *
 * Order matters here and is deliberate:
 *   1. Consent is checked first — no consent, no enquiry, no bureau fee.
 *   2. A pending snapshot is written before the call, so an enquiry that crashes
 *      mid-flight still leaves a trace that it was attempted.
 *   3. The raw payload is stored verbatim, so a client disputing a balance can be
 *      shown exactly what the bureau said.
 */
export async function runBureauEnquiry({ client, providerId, actor, req = null }, database = getDb()) {
  assertBureauConsent(client.id, database);
  const provider = getProvider(providerId);

  const inserted = database.prepare(`
    INSERT INTO bureau_snapshots (client_id, provider, source_kind, is_simulated, status, requested_by)
    VALUES (?, ?, 'api', ?, 'pending', ?)
  `).run(client.id, provider.id, provider.isSimulated ? 1 : 0, actor?.id ?? null);
  const snapshotId = Number(inserted.lastInsertRowid);

  recordAudit({
    actor,
    action: 'bureau.enquiry.requested',
    entityType: 'client',
    entityId: client.id,
    detail: { provider: provider.id, snapshotId, simulated: provider.isSimulated },
    req,
  }, database);

  try {
    const raw = await provider.fetchCreditProfile({
      idNumber: revealIdNumber(client),
      firstName: client.first_name,
      lastName: client.last_name,
      dateOfBirth: client.date_of_birth,
      reference: client.reference,
    });

    const profile = provider.normalise(raw);

    transaction((db) => {
      db.prepare(`
        UPDATE bureau_snapshots
        SET status = 'success', reference = ?, credit_score = ?, score_band = ?,
            raw_payload = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(
        profile.reference ?? null,
        profile.creditScore ?? null,
        profile.scoreBand ?? null,
        JSON.stringify(raw),
        snapshotId,
      );
      insertAccounts(db, client.id, snapshotId, profile.accounts);
    }, database);

    recordAudit({
      actor,
      action: 'bureau.enquiry.succeeded',
      entityType: 'client',
      entityId: client.id,
      detail: { provider: provider.id, snapshotId, accountCount: profile.accounts.length },
      req,
    }, database);

    return { snapshotId, profile, simulated: provider.isSimulated };
  } catch (err) {
    database.prepare(`
      UPDATE bureau_snapshots SET status = 'failed', error_message = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(String(err.message).slice(0, 1000), snapshotId);

    recordAudit({
      actor,
      action: 'bureau.enquiry.failed',
      entityType: 'client',
      entityId: client.id,
      detail: { provider: provider.id, snapshotId, error: err.message },
      req,
    }, database);

    throw err;
  }
}

/** Writes canonical accounts against a snapshot. */
export function insertAccounts(database, clientId, snapshotId, accounts = []) {
  const stmt = database.prepare(`
    INSERT INTO credit_accounts (
      client_id, snapshot_id, creditor_name, creditor_normalised,
      account_number_enc, account_number_masked, account_type, opened_date,
      current_balance_cents, original_amount_cents, monthly_instalment_cents,
      arrears_amount_cents, credit_limit_cents, months_in_arrears,
      interest_rate_annual, status, last_payment_date, bureau_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const account of accounts) {
    stmt.run(
      clientId,
      snapshotId,
      account.creditorName,
      account.creditorNormalised,
      account.accountNumber ? encryptField(account.accountNumber) : null,
      account.accountNumberMasked ?? null,
      account.accountType,
      account.openedDate,
      account.currentBalanceCents ?? 0,
      account.originalAmountCents ?? null,
      account.monthlyInstalmentCents ?? 0,
      account.arrearsAmountCents ?? 0,
      account.creditLimitCents ?? null,
      account.monthsInArrears ?? 0,
      account.interestRateAnnual ?? null,
      account.status ?? 'unknown',
      account.lastPaymentDate ?? null,
      account.bureauUpdatedAt ?? null,
    );
  }
}

export function getSnapshot(id, database = getDb()) {
  return database.prepare('SELECT * FROM bureau_snapshots WHERE id = ?').get(id) ?? null;
}

/** The snapshot a client's dashboard shows by default: their most recent successful pull. */
export function latestSnapshot(clientId, database = getDb()) {
  return database.prepare(`
    SELECT * FROM bureau_snapshots
    WHERE client_id = ? AND status = 'success'
    ORDER BY requested_at DESC, id DESC LIMIT 1
  `).get(clientId) ?? null;
}

export function listSnapshots(clientId, database = getDb()) {
  return database.prepare(`
    SELECT s.*, u.full_name AS requested_by_name,
      (SELECT COUNT(*) FROM credit_accounts a WHERE a.snapshot_id = s.id) AS account_count,
      (SELECT COALESCE(SUM(a.current_balance_cents), 0) FROM credit_accounts a
        WHERE a.snapshot_id = s.id AND a.is_excluded = 0
          AND a.status IN ('open','legal','under_debt_review','unknown')) AS total_owed_cents
    FROM bureau_snapshots s
    LEFT JOIN users u ON u.id = s.requested_by
    WHERE s.client_id = ?
    ORDER BY s.requested_at DESC, s.id DESC
  `).all(clientId);
}

export function accountsForSnapshot(snapshotId, database = getDb()) {
  return database.prepare(
    'SELECT * FROM credit_accounts WHERE snapshot_id = ? ORDER BY current_balance_cents DESC',
  ).all(snapshotId);
}

export function setAccountExclusion(accountId, { excluded, reason = null }, database = getDb()) {
  database.prepare(
    'UPDATE credit_accounts SET is_excluded = ?, exclusion_reason = ? WHERE id = ?',
  ).run(excluded ? 1 : 0, excluded ? reason : null, accountId);
}

/** True when the snapshot is old enough that the consultant should refresh it. */
export function isStale(snapshot) {
  if (!snapshot) return true;
  const age = daysSince(snapshot.requested_at);
  // An unreadable timestamp is treated as stale: nudging for a refresh is the
  // safe failure, showing figures of unknown age as current is not.
  if (age === null) return true;
  return age > config.snapshotStaleDays;
}

export function deleteSnapshot(snapshotId, database = getDb()) {
  database.prepare('DELETE FROM bureau_snapshots WHERE id = ?').run(snapshotId);
}
