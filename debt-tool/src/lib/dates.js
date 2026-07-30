/**
 * Date helpers.
 *
 * SQLite has no date type: `datetime('now')` produces the string
 * "YYYY-MM-DD HH:MM:SS" in UTC, and every comparison against it is a *string*
 * comparison. An ISO-8601 value written straight from JavaScript
 * ("2026-07-30T20:14:03.771Z") sorts *after* that format because "T" > " ",
 * which silently breaks `granted_at <= datetime('now')` — a consent recorded a
 * moment ago reads as not yet in force.
 *
 * Everything written to a datetime column therefore goes through toSqlDateTime,
 * and everything read back into JavaScript goes through fromSqlDateTime.
 */

/** Converts a Date or date-ish string to SQLite's "YYYY-MM-DD HH:MM:SS" in UTC. */
export function toSqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Converts a date-only string ("2026-08-15") to the last second of that day.
 * A user setting an expiry of 15 August means "valid through the 15th", not
 * "expired the instant the 15th began".
 */
export function endOfDaySql(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 23:59:59`;
  return toSqlDateTime(text);
}

/** Parses a value out of a datetime column back into a Date. Returns null if unreadable. */
export function fromSqlDateTime(value) {
  if (!value) return null;
  const text = String(value).trim();

  // Already carries a zone or a T separator — trust it as-is.
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Date only: midnight UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // SQLite's own format, which is always UTC.
  const parsed = new Date(`${text.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formats a stored timestamp for staff, in South African time. */
export function formatDate(value, { withTime = false } = {}) {
  const date = fromSqlDateTime(value);
  if (!date) return value ? String(value) : '—';
  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Africa/Johannesburg',
  }).format(date);
}

/** Whole days between a stored timestamp and now. Null when unreadable. */
export function daysSince(value) {
  const date = fromSqlDateTime(value);
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400_000);
}
