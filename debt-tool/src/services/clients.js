import { getDb, transaction } from '../db/index.js';
import { encryptField, decryptField, blindIndex, normaliseIdNumber } from '../db/crypto.js';

/**
 * Validates a South African ID number: 13 digits, a readable date of birth,
 * and a correct Luhn check digit. Returns { valid, reason, dateOfBirth }.
 *
 * Catching a mistyped ID here matters: an enquiry against the wrong number pulls
 * a stranger's credit profile, which is both a wasted bureau fee and a POPIA breach.
 */
export function validateSaIdNumber(input) {
  const digits = normaliseIdNumber(input);
  if (digits.length !== 13) return { valid: false, reason: 'A South African ID number must be 13 digits.' };

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (mm < 1 || mm > 12) return { valid: false, reason: 'The month in the ID number is not valid.' };
  if (dd < 1 || dd > 31) return { valid: false, reason: 'The day in the ID number is not valid.' };

  // Two-digit year: anything landing in the future must belong to the last century.
  const currentYear = new Date().getFullYear();
  const century = 2000 + yy <= currentYear ? 2000 : 1900;
  const year = century + yy;
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) {
    return { valid: false, reason: 'The date of birth in the ID number is not a real date.' };
  }

  if (!luhnValid(digits)) return { valid: false, reason: 'The ID number failed its check-digit test — please re-type it.' };

  return { valid: true, reason: null, dateOfBirth: dob.toISOString().slice(0, 10) };
}

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function createClient(input, { actorId = null } = {}, database = getDb()) {
  const idNumber = normaliseIdNumber(input.idNumber);
  const check = validateSaIdNumber(idNumber);
  if (!check.valid) throw new ValidationError(check.reason);

  const hash = blindIndex(idNumber);
  const existing = database.prepare('SELECT id, reference FROM clients WHERE id_number_hash = ?').get(hash);
  if (existing) {
    throw new ValidationError(`That ID number is already on file as ${existing.reference}.`);
  }

  return transaction((db) => {
    const reference = input.reference?.trim() || nextReference(db);
    const result = db.prepare(`
      INSERT INTO clients (
        reference, first_name, last_name, id_number_enc, id_number_hash, id_number_last4,
        date_of_birth, email, phone, employment_status, marital_status, dependants, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reference,
      input.firstName.trim(),
      input.lastName.trim(),
      encryptField(idNumber),
      hash,
      idNumber.slice(-4),
      input.dateOfBirth || check.dateOfBirth,
      input.email?.trim() || null,
      input.phone?.trim() || null,
      input.employmentStatus || null,
      input.maritalStatus || null,
      Number(input.dependants) || 0,
      input.notes?.trim() || null,
      actorId,
    );
    return getClientById(Number(result.lastInsertRowid), db);
  }, database);
}

export function updateClient(id, input, database = getDb()) {
  database.prepare(`
    UPDATE clients SET
      first_name = ?, last_name = ?, email = ?, phone = ?,
      employment_status = ?, marital_status = ?, dependants = ?, status = ?, notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.firstName.trim(),
    input.lastName.trim(),
    input.email?.trim() || null,
    input.phone?.trim() || null,
    input.employmentStatus || null,
    input.maritalStatus || null,
    Number(input.dependants) || 0,
    input.status || 'active',
    input.notes?.trim() || null,
    id,
  );
  return getClientById(id, database);
}

export function getClientById(id, database = getDb()) {
  return database.prepare('SELECT * FROM clients WHERE id = ?').get(id) ?? null;
}

export function findClientByIdNumber(idNumber, database = getDb()) {
  return database.prepare('SELECT * FROM clients WHERE id_number_hash = ?').get(blindIndex(idNumber)) ?? null;
}

/**
 * Returns the client's ID number in the clear. Only the bureau enquiry path
 * calls this — it is deliberately a separate function so that every place the
 * plaintext is used is easy to find in a review.
 */
export function revealIdNumber(client) {
  return decryptField(client.id_number_enc);
}

export function searchClients({ query = '', status = null, limit = 50, offset = 0 } = {}, database = getDb()) {
  const where = [];
  const params = [];

  const trimmed = String(query || '').trim();
  if (trimmed) {
    // A 13-digit search is an ID number lookup; anything else is a name or reference.
    const digits = normaliseIdNumber(trimmed);
    if (digits.length === 13) {
      where.push('id_number_hash = ?');
      params.push(blindIndex(digits));
    } else {
      where.push('(first_name LIKE ? OR last_name LIKE ? OR reference LIKE ? OR email LIKE ? OR (first_name || \' \' || last_name) LIKE ?)');
      const like = `%${trimmed}%`;
      params.push(like, like, like, like, like);
    }
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = database.prepare(`
    SELECT c.*,
      (SELECT COALESCE(SUM(a.current_balance_cents), 0)
         FROM credit_accounts a
        WHERE a.client_id = c.id
          AND a.is_excluded = 0
          AND a.status IN ('open','legal','under_debt_review','unknown')
          AND a.snapshot_id = (
            SELECT s.id FROM bureau_snapshots s
             WHERE s.client_id = c.id AND s.status = 'success'
             ORDER BY s.requested_at DESC, s.id DESC LIMIT 1
          )
      ) AS total_owed_cents,
      (SELECT s.requested_at FROM bureau_snapshots s
         WHERE s.client_id = c.id AND s.status = 'success'
         ORDER BY s.requested_at DESC, s.id DESC LIMIT 1) AS last_pull_at
    FROM clients c
    ${clause}
    ORDER BY c.last_name, c.first_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = database.prepare(`SELECT COUNT(*) AS n FROM clients c ${clause}`).get(...params)?.n ?? 0;

  return { rows, total };
}

/** Next file reference, e.g. MFG-2026-0043. Resets its counter each calendar year. */
function nextReference(database) {
  const year = new Date().getFullYear();
  const prefix = `MFG-${year}-`;
  const row = database.prepare(
    'SELECT reference FROM clients WHERE reference LIKE ? ORDER BY reference DESC LIMIT 1',
  ).get(`${prefix}%`);
  const last = row ? Number.parseInt(row.reference.slice(prefix.length), 10) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}
