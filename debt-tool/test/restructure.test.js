import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeRestructure, amortisationTerm } from '../src/services/restructure.js';

const account = (overrides = {}) => ({
  id: Math.random(),
  creditor_name: 'Test Bank',
  account_type: 'personal_loan',
  status: 'open',
  current_balance_cents: 0,
  monthly_instalment_cents: 0,
  interest_rate_annual: 0.22,
  is_excluded: 0,
  ...overrides,
});

test('the proposal distributes exactly what is available, to the cent', () => {
  // Creditors reconcile to the cent. A rounding remainder that quietly vanishes
  // means the distribution never balances against the payment received.
  const result = proposeRestructure({
    accounts: [
      account({ current_balance_cents: 10000000 }),
      account({ current_balance_cents: 3333300 }),
      account({ current_balance_cents: 1111100 }),
    ],
    availableForDebtCents: 500000,
  });

  assert.equal(result.proposedInstalmentCents, 500000);
});

test('the fee comes off the top before creditors are paid', () => {
  const result = proposeRestructure({
    accounts: [account({ current_balance_cents: 10000000 })],
    availableForDebtCents: 500000,
    monthlyFeeCents: 80000,
  });
  assert.equal(result.distributableCents, 420000);
  assert.equal(result.proposedInstalmentCents, 420000);
});

test('creditors are paid pro-rata to what they are owed', () => {
  const result = proposeRestructure({
    accounts: [
      account({ creditor_name: 'Big', current_balance_cents: 7500000 }),
      account({ creditor_name: 'Small', current_balance_cents: 2500000 }),
    ],
    availableForDebtCents: 400000,
  });

  const big = result.lines.find((l) => l.creditorName === 'Big');
  const small = result.lines.find((l) => l.creditorName === 'Small');
  assert.equal(big.proposedInstalmentCents, 300000);
  assert.equal(small.proposedInstalmentCents, 100000);
});

test('secured accounts keep their contractual instalment so the asset is not lost', () => {
  const result = proposeRestructure({
    accounts: [
      account({ creditor_name: 'Car', account_type: 'vehicle_finance', current_balance_cents: 20000000, monthly_instalment_cents: 420000, interest_rate_annual: 0.115 }),
      account({ creditor_name: 'Card', account_type: 'credit_card', current_balance_cents: 5000000, monthly_instalment_cents: 250000 }),
    ],
    availableForDebtCents: 600000,
  });

  const car = result.lines.find((l) => l.creditorName === 'Car');
  const card = result.lines.find((l) => l.creditorName === 'Card');

  assert.equal(result.securedProtected, true);
  assert.equal(car.treatment, 'protected');
  assert.equal(car.proposedInstalmentCents, 420000);
  // The unsecured account gets what is left.
  assert.equal(card.proposedInstalmentCents, 180000);
});

test('when the asset cannot be protected the tool says so instead of pretending', () => {
  const result = proposeRestructure({
    accounts: [
      account({ creditor_name: 'Car', account_type: 'vehicle_finance', current_balance_cents: 20000000, monthly_instalment_cents: 800000 }),
      account({ creditor_name: 'Card', account_type: 'credit_card', current_balance_cents: 5000000, monthly_instalment_cents: 250000 }),
    ],
    availableForDebtCents: 300000,
  });

  assert.equal(result.securedAffordable, false);
  assert.equal(result.securedProtected, false);
  assert.ok(result.warnings.some((w) => /cannot be protected/i.test(w)));
  // Everything is then treated pro-rata rather than the vehicle eating the pot.
  assert.equal(result.lines.every((l) => l.treatment === 'restructured'), true);
});

test('an instalment that never clears the debt is flagged, not silently accepted', () => {
  // R100/month against R100 000 at 22% does not cover the interest. Reporting a
  // term here would tell a client they will be debt-free when they never will be.
  const result = proposeRestructure({
    accounts: [account({ current_balance_cents: 10000000, interest_rate_annual: 0.22 })],
    availableForDebtCents: 10000,
    concessionRateAnnual: 0.22,
  });

  assert.equal(result.feasible, false);
  assert.equal(result.lines[0].termMonths, null);
  assert.ok(result.warnings.some((w) => /never be settled/i.test(w)));
});

test('no available income produces a warning rather than a plan', () => {
  const result = proposeRestructure({
    accounts: [account({ current_balance_cents: 10000000 })],
    availableForDebtCents: 0,
  });
  assert.equal(result.feasible, false);
  assert.equal(result.proposedInstalmentCents, 0);
  assert.ok(result.warnings.some((w) => /no income available/i.test(w)));
});

test('closed, written-off and excluded accounts stay out of the proposal', () => {
  const result = proposeRestructure({
    accounts: [
      account({ current_balance_cents: 10000000 }),
      account({ current_balance_cents: 5000000, status: 'closed' }),
      account({ current_balance_cents: 5000000, is_excluded: 1 }),
      account({ current_balance_cents: 0 }),
    ],
    availableForDebtCents: 400000,
  });
  assert.equal(result.lines.length, 1);
  assert.equal(result.totalBalanceCents, 10000000);
});

test('a plan running past the guideline term is called out', () => {
  const result = proposeRestructure({
    accounts: [account({ current_balance_cents: 30000000 })],
    availableForDebtCents: 400000,
    concessionRateAnnual: 0.05,
    maxTermMonths: 60,
  });
  assert.equal(result.exceedsMaxTerm, true);
  assert.ok(result.warnings.some((w) => /beyond the 60-month guideline/i.test(w)));
});

test('amortisation matches the standard annuity formula', () => {
  // R100 000 at 12% a year needs R2 224.4477 a month to clear in 60. Rounded up
  // to a payable R2 224.45, it clears in 60.
  assert.equal(amortisationTerm({ principalCents: 10000000, paymentCents: 222445, annualRate: 0.12 }), 60);
});

test('a payment a fraction short of the exact instalment needs one more month', () => {
  // Rounding the instalment down leaves a sliver outstanding after 60 payments,
  // and the term is rounded up because a client cannot make 60.0002 payments.
  assert.equal(amortisationTerm({ principalCents: 10000000, paymentCents: 222444, annualRate: 0.12 }), 61);
});

test('a zero-interest debt clears by simple division', () => {
  assert.equal(amortisationTerm({ principalCents: 100000, paymentCents: 10000, annualRate: 0 }), 10);
});

test('amortisation returns null, not Infinity, when the payment never clears', () => {
  assert.equal(amortisationTerm({ principalCents: 10000000, paymentCents: 100, annualRate: 0.22 }), null);
  assert.equal(amortisationTerm({ principalCents: 10000000, paymentCents: 0, annualRate: 0.22 }), null);
});

test('a settled balance needs no term', () => {
  assert.equal(amortisationTerm({ principalCents: 0, paymentCents: 10000, annualRate: 0.2 }), 0);
});
