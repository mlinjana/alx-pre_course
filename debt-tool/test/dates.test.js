import test from 'node:test';
import assert from 'node:assert/strict';
import { toSqlDateTime, endOfDaySql, fromSqlDateTime, daysSince } from '../src/lib/dates.js';

test('timestamps are written in the format SQLite compares against', () => {
  // This is the whole point of the module: an ISO string sorts *after*
  // datetime('now') because "T" > " ", so `granted_at <= datetime('now')`
  // would reject a consent recorded a second ago.
  const stamp = toSqlDateTime(new Date('2026-07-30T20:14:03.771Z'));
  assert.equal(stamp, '2026-07-30 20:14:03');
  assert.ok(stamp < '2026-07-30 20:14:04');
  assert.ok(stamp > '2026-07-30 20:14:02');
});

test('an ISO string would have compared wrongly — the regression this guards', () => {
  const iso = new Date('2026-07-30T20:14:03Z').toISOString();
  const sqliteNow = '2026-07-30 20:14:04';
  assert.ok(iso > sqliteNow, 'ISO sorts after SQLite format, which is the bug');
  assert.ok(toSqlDateTime(iso) < sqliteNow, 'converted, it sorts correctly');
});

test('a date-only expiry lasts through the whole of that day', () => {
  // "Expires 15 August" means valid through the 15th, not expired at midnight.
  assert.equal(endOfDaySql('2026-08-15'), '2026-08-15 23:59:59');
});

test('reading back handles SQLite format, ISO, and date-only', () => {
  assert.equal(fromSqlDateTime('2026-07-30 20:14:03').toISOString(), '2026-07-30T20:14:03.000Z');
  assert.equal(fromSqlDateTime('2026-07-30T20:14:03Z').toISOString(), '2026-07-30T20:14:03.000Z');
  assert.equal(fromSqlDateTime('2026-07-30').toISOString(), '2026-07-30T00:00:00.000Z');
  assert.equal(fromSqlDateTime(null), null);
  assert.equal(fromSqlDateTime('not a date'), null);
});

test('a round trip through storage preserves the instant', () => {
  const original = new Date('2026-03-15T08:30:00Z');
  assert.equal(fromSqlDateTime(toSqlDateTime(original)).getTime(), original.getTime());
});

test('daysSince measures age and refuses to guess at junk', () => {
  const tenDaysAgo = toSqlDateTime(new Date(Date.now() - 10 * 86400_000));
  assert.equal(daysSince(tenDaysAgo), 10);
  assert.equal(daysSince('nonsense'), null);
});
