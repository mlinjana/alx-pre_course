import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSaIdNumber } from '../src/services/clients.js';
import { encryptField, decryptField, blindIndex, hashPassword, verifyPassword } from '../src/db/crypto.js';

test('a valid South African ID number is accepted and yields a birth date', () => {
  const result = validateSaIdNumber('9202204720083');
  assert.equal(result.valid, true);
  assert.equal(result.dateOfBirth, '1992-02-20');
});

test('a wrong check digit is caught before it costs a bureau enquiry', () => {
  // Every digit but the last is the same as the valid number above. Without the
  // Luhn test this would sail through and pull a stranger's credit profile.
  const result = validateSaIdNumber('9202204720084');
  assert.equal(result.valid, false);
  assert.match(result.reason, /check-digit/);
});

test('malformed ID numbers are rejected with a usable reason', () => {
  assert.match(validateSaIdNumber('123').reason, /13 digits/);
  assert.match(validateSaIdNumber('9213204720083').reason, /month/);
  assert.match(validateSaIdNumber('9202404720083').reason, /day/);
  assert.equal(validateSaIdNumber('').valid, false);
});

test('spacing and punctuation in an ID number are tolerated', () => {
  assert.equal(validateSaIdNumber('920220 4720 083').valid, true);
});

test('an encrypted field round-trips', () => {
  const original = '9202204720083';
  const stored = encryptField(original);
  assert.notEqual(stored, original, 'the ID number must not be stored in the clear');
  assert.equal(decryptField(stored), original);
});

test('the same value encrypts differently each time', () => {
  // A deterministic ciphertext would let anyone with the database tell which
  // two clients share a value, without holding the key.
  assert.notEqual(encryptField('9202204720083'), encryptField('9202204720083'));
});

test('a tampered ciphertext is rejected rather than silently mangled', () => {
  const stored = encryptField('9202204720083');
  const parts = stored.split('.');
  parts[3] = Buffer.from('tampered value here').toString('base64url');
  assert.throws(() => decryptField(parts.join('.')));
  assert.throws(() => decryptField('garbage'));
});

test('empty values encrypt to null rather than to ciphertext', () => {
  assert.equal(encryptField(''), null);
  assert.equal(encryptField(null), null);
  assert.equal(decryptField(null), null);
});

test('the blind index finds a client by ID number without decrypting', () => {
  // Deterministic so it can be looked up, and it ignores the formatting the
  // number was typed in.
  assert.equal(blindIndex('9202204720083'), blindIndex('920220 4720 083'));
  assert.notEqual(blindIndex('9202204720083'), blindIndex('9202204720084'));
});

test('passwords verify only against the right password', () => {
  const { hash, salt } = hashPassword('a-long-enough-passphrase');
  assert.equal(verifyPassword('a-long-enough-passphrase', hash, salt), true);
  assert.equal(verifyPassword('the-wrong-passphrase', hash, salt), false);
});

test('the same password hashes differently for different users', () => {
  const a = hashPassword('same password for both');
  const b = hashPassword('same password for both');
  assert.notEqual(a.hash, b.hash, 'a per-user salt must be in play');
});
