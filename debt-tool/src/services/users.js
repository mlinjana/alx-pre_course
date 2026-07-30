import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken } from '../db/crypto.js';
import { toSqlDateTime, fromSqlDateTime } from '../lib/dates.js';
import { config } from '../config.js';

export const ROLES = Object.freeze({
  admin: { label: 'Administrator', rank: 3 },
  consultant: { label: 'Debt consultant', rank: 2 },
  readonly: { label: 'Read only', rank: 1 },
});

export function createUser({ email, fullName, role = 'consultant', password, mustReset = false }, database = getDb()) {
  if (!Object.hasOwn(ROLES, role)) throw new Error(`Unknown role: ${role}`);
  const { hash, salt } = hashPassword(password);
  const result = database.prepare(`
    INSERT INTO users (email, full_name, role, password_hash, password_salt, must_reset)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(email).trim().toLowerCase(), fullName, role, hash, salt, mustReset ? 1 : 0);
  return getUserById(Number(result.lastInsertRowid), database);
}

export function getUserById(id, database = getDb()) {
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function getUserByEmail(email, database = getDb()) {
  return database.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase()) ?? null;
}

export function listUsers(database = getDb()) {
  return database.prepare('SELECT id, email, full_name, role, is_active, last_login_at, created_at FROM users ORDER BY full_name').all();
}

export function setPassword(userId, password, database = getDb()) {
  const { hash, salt } = hashPassword(password);
  database.prepare(`
    UPDATE users SET password_hash = ?, password_salt = ?, must_reset = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(hash, salt, userId);
}

/**
 * Verifies credentials. Returns null for a wrong password, an unknown email, or
 * a deactivated account — the caller shows one message for all three so the
 * login form cannot be used to enumerate who works here.
 */
export function authenticate(email, password, database = getDb()) {
  const user = getUserByEmail(email, database);
  if (!user) {
    // Hash anyway so a missing account does not answer noticeably faster than a
    // wrong password.
    hashPassword(String(password));
    return null;
  }
  if (!user.is_active) return null;
  if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
  return user;
}

export function startSession(userId, { ip = null, userAgent = null } = {}, database = getDb()) {
  const { token, tokenHash } = newSessionToken();
  // SQLite's own format, so purgeExpiredSessions' `expires_at < datetime('now')`
  // compares like-for-like.
  const expiresAt = toSqlDateTime(new Date(Date.now() + config.sessionTtlHours * 3600_000));
  database.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, ip, userAgent);
  database.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  return { token, expiresAt };
}

/** Resolves a session cookie to a user, clearing it out if expired. */
export function resolveSession(token, database = getDb()) {
  if (!token) return null;
  const row = database.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!row) return null;
  const expiry = fromSqlDateTime(row.expires_at);
  if (!expiry || expiry.getTime() < Date.now()) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  const user = getUserById(row.user_id, database);
  if (!user || !user.is_active) return null;
  return user;
}

export function endSession(token, database = getDb()) {
  if (!token) return;
  database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function purgeExpiredSessions(database = getDb()) {
  database.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

export function hasRole(user, minimum) {
  const userRank = ROLES[user?.role]?.rank ?? 0;
  const needed = ROLES[minimum]?.rank ?? Infinity;
  return userRank >= needed;
}
