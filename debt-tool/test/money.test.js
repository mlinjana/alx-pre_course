import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRandsToCents, sumCents, ratio } from '../src/lib/money.js';

test('parseRandsToCents reads the formats that actually appear on statements', () => {
  assert.equal(parseRandsToCents('R 12 345.67'), 1234567);
  assert.equal(parseRandsToCents('R12,345.67'), 1234567);
  assert.equal(parseRandsToCents('12 345,67'), 1234567);   // South African convention
  assert.equal(parseRandsToCents('12.345,67'), 1234567);   // European convention
  assert.equal(parseRandsToCents('1234567'), 123456700);
  assert.equal(parseRandsToCents('0.00'), 0);
  assert.equal(parseRandsToCents(189450.22), 18945022);
});

test('parseRandsToCents treats a thousands separator as a thousands separator', () => {
  // "12,345" is twelve thousand rand, not twelve rand and change.
  assert.equal(parseRandsToCents('12,345'), 1234500);
  assert.equal(parseRandsToCents('1.500'), 150000);
  // But two trailing digits mean cents.
  assert.equal(parseRandsToCents('12,34'), 1234);
});

test('parseRandsToCents reads negatives, including accounting brackets', () => {
  assert.equal(parseRandsToCents('-500.00'), -50000);
  assert.equal(parseRandsToCents('(500.00)'), -50000);
});

test('parseRandsToCents returns null rather than guessing at unreadable input', () => {
  // Callers need to tell "the bureau sent zero" from "the bureau sent nothing".
  assert.equal(parseRandsToCents(''), null);
  assert.equal(parseRandsToCents('n/a'), null);
  assert.equal(parseRandsToCents(null), null);
  assert.equal(parseRandsToCents(undefined), null);
  assert.equal(parseRandsToCents('R'), null);
});

test('sumCents tolerates missing values', () => {
  const rows = [{ b: 100 }, { b: null }, {}, { b: 250 }];
  assert.equal(sumCents(rows, 'b'), 350);
});

test('ratio returns null instead of dividing by zero', () => {
  assert.equal(ratio(500, 0), null);
  assert.equal(ratio(500, 1000), 0.5);
});
