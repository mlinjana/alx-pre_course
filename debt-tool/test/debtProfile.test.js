import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseDebt, groupByCreditor } from '../src/services/debtProfile.js';

/** Builds a database-shaped account row with sensible defaults. */
function account(overrides = {}) {
  return {
    id: Math.random(),
    creditor_name: 'Test Bank',
    creditor_normalised: 'test',
    account_type: 'personal_loan',
    status: 'open',
    current_balance_cents: 0,
    monthly_instalment_cents: 0,
    arrears_amount_cents: 0,
    months_in_arrears: 0,
    interest_rate_annual: null,
    is_excluded: 0,
    ...overrides,
  };
}

test('totals cover balance, instalments and arrears across active accounts', () => {
  const summary = summariseDebt([
    account({ current_balance_cents: 10000000, monthly_instalment_cents: 250000, arrears_amount_cents: 500000, months_in_arrears: 2 }),
    account({ current_balance_cents: 5000000, monthly_instalment_cents: 150000 }),
  ]);

  assert.equal(summary.totalOwedCents, 15000000);
  assert.equal(summary.totalInstalmentCents, 400000);
  assert.equal(summary.totalArrearsCents, 500000);
  assert.equal(summary.accountCount, 2);
  assert.equal(summary.accountsInArrearsCount, 1);
  assert.equal(summary.worstArrearsMonths, 2);
});

test('closed accounts drop out of the total but written-off debt is kept in view', () => {
  // A written-off account is still legally owed and still collectable; hiding it
  // would understate what the client is actually exposed to.
  const summary = summariseDebt([
    account({ current_balance_cents: 10000000 }),
    account({ current_balance_cents: 9900000, status: 'closed' }),
    account({ current_balance_cents: 2000000, status: 'written_off' }),
  ]);

  assert.equal(summary.totalOwedCents, 10000000);
  assert.equal(summary.writtenOffCents, 2000000);
  assert.equal(summary.totalExposureCents, 12000000);
  assert.equal(summary.closedCount, 1);
  assert.equal(summary.writtenOffCount, 1);
});

test('excluded accounts leave the totals but stay on the file', () => {
  const summary = summariseDebt([
    account({ current_balance_cents: 10000000 }),
    account({ current_balance_cents: 3000000, is_excluded: 1 }),
  ]);

  assert.equal(summary.totalOwedCents, 10000000);
  assert.equal(summary.excludedCount, 1);
  assert.equal(summary.excludedAccounts.length, 1);
});

test('accounts in legal handover still count as owed', () => {
  const summary = summariseDebt([account({ current_balance_cents: 4000000, status: 'legal' })]);
  assert.equal(summary.totalOwedCents, 4000000);
});

test('the same creditor spelled differently totals as one', () => {
  const rows = groupByCreditor([
    account({ creditor_name: 'ABSA BANK LTD', creditor_normalised: 'absa', current_balance_cents: 5000000 }),
    account({ creditor_name: 'Absa Bank Limited', creditor_normalised: 'absa', current_balance_cents: 3000000 }),
    account({ creditor_name: 'Capitec', creditor_normalised: 'capitec', current_balance_cents: 9000000 }),
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].creditorName, 'Capitec');       // sorted by balance
  assert.equal(rows[1].balanceCents, 8000000);
  assert.equal(rows[1].accountCount, 2);
});

test('the average interest rate is weighted by balance', () => {
  // A R900k bond at 10% and a R100k card at 20% average to 11%, not 15%.
  const summary = summariseDebt([
    account({ current_balance_cents: 90000000, interest_rate_annual: 0.10 }),
    account({ current_balance_cents: 10000000, interest_rate_annual: 0.20 }),
  ]);
  assert.ok(Math.abs(summary.averageInterestRate - 0.11) < 1e-9);
});

test('secured and unsecured debt are separated', () => {
  const summary = summariseDebt([
    account({ account_type: 'home_loan', current_balance_cents: 90000000 }),
    account({ account_type: 'vehicle_finance', current_balance_cents: 20000000 }),
    account({ account_type: 'credit_card', current_balance_cents: 5000000 }),
    account({ account_type: 'personal_loan', current_balance_cents: 3000000 }),
  ]);

  const secured = summary.byCategory.find((c) => c.category === 'secured');
  assert.equal(secured.balanceCents, 110000000);
  assert.equal(secured.accountCount, 2);
});

test('an empty profile produces zeroes, not NaN', () => {
  const summary = summariseDebt([]);
  assert.equal(summary.totalOwedCents, 0);
  assert.equal(summary.accountCount, 0);
  assert.equal(summary.averageInterestRate, null);
  assert.equal(summary.arrearsShare, null);
  assert.equal(summary.largestAccount, null);
});
