import { getDb } from '../db/index.js';

/**
 * Append-only record of who did what.
 *
 * POPIA requires the practice to be able to show who accessed a data subject's
 * information and why. Every route that reads or changes client data writes here;
 * nothing in the application updates or deletes these rows.
 */
export function recordAudit({
  actor = null,
  action,
  entityType = null,
  entityId = null,
  detail = null,
  req = null,
} = {}, database = getDb()) {
  database.prepare(`
    INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, detail_json, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actor?.id ?? null,
    actor?.email ?? null,
    action,
    entityType,
    entityId === null ? null : String(entityId),
    detail ? JSON.stringify(detail) : null,
    req ? clientIp(req) : null,
    req?.get?.('user-agent') ?? null,
  );
}

export function listAudit({ limit = 200, offset = 0, entityType = null, entityId = null, actorId = null } = {}, database = getDb()) {
  const where = [];
  const params = [];
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId !== null && entityId !== undefined) { where.push('entity_id = ?'); params.push(String(entityId)); }
  if (actorId) { where.push('actor_id = ?'); params.push(actorId); }

  return database.prepare(`
    SELECT * FROM audit_log
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

export function countAudit({ entityType = null, entityId = null } = {}, database = getDb()) {
  const where = [];
  const params = [];
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId !== null && entityId !== undefined) { where.push('entity_id = ?'); params.push(String(entityId)); }
  const row = database.prepare(`
    SELECT COUNT(*) AS n FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `).get(...params);
  return row?.n ?? 0;
}

/**
 * Best-effort client IP. Trusts X-Forwarded-For only because this app is
 * expected to sit behind the practice's own reverse proxy; if it is ever
 * exposed directly, that header is attacker-controlled and this becomes
 * a log-poisoning vector rather than a security control.
 */
function clientIp(req) {
  const forwarded = req.get?.('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip ?? null;
}
