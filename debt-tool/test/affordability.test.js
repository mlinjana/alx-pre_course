import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAffordability, isOverIndebted, minimumLivingExpenses, riskLevel,
} from '../src/services/affordability.js';

const profile = (overrides = {}) => ({
  gross_monthly_income_cents: 3200000,
  net_monthly_income_cents: 2450000,
  other_income_cents: 0,
  expenses_json: JSON.stringify({ housing: 750000, groceries: 420000, transport: 260000 }),
  ...overrides,
});

const debt = (overrides = {}) => ({
  totalOwedCents: 16000000,
  totalInstalmentCents: 1000000,
  accountsInArrearsCount: 0,
  worstArrearsMonths: 0,
  ...overrides,
});

test('the assessment produces the figures a s86 file needs', () => {
  const result = assessAffordability({ profile: profile(), debtSummary: debt() });

  assert.equal(result.netIncomeCents, 2450000);
  assert.equal(result.declaredExpensesCents, 1430000);
  assert.equal(result.availableForDebtCents, 1020000);
  assert.equal(result.surplusCents, 20000);
  assert.ok(Math.abs(result.instalmentToIncome - (1000000 / 2450000)) < 1e-9);
});

test('other income counts toward what the client can pay', () => {
  const result = assessAffordability({
    profile: profile({ other_income_cents: 300000 }),
    debtSummary: debt(),
  });
  assert.equal(result.netIncomeCents, 2750000);
});

test('a shortfall is reported as negative, not clamped to zero', () => {
  // Clamping here would hide exactly the clients who most need a restructure.
  const result = assessAffordability({
    profile: profile(),
    debtSummary: debt({ totalInstalmentCents: 1500000 }),
  });
  assert.equal(result.surplusCents, -480000);
  assert.equal(result.overIndebted, true);
  assert.equal(result.riskLevel, 'critical');
});

test('over-indebtedness explains itself rather than returning a bare flag', () => {
  const verdict = isOverIndebted({
    surplusCents: -100000, instalmentToIncome: 0.62, arrearsCount: 4, worstArrearsMonths: 5,
  });
  assert.equal(verdict.result, true);
  assert.equal(verdict.reasons.length, 4);
});

test('a comfortable client is not flagged', () => {
  const verdict = isOverIndebted({
    surplusCents: 800000, instalmentToIncome: 0.18, arrearsCount: 0, worstArrearsMonths: 0,
  });
  assert.equal(verdict.result, false);
  assert.deepEqual(verdict.reasons, []);
});

test('deep arrears flag a client even when the arithmetic looks affordable', () => {
  // Someone can show a surplus on paper and still be four months behind.
  const verdict = isOverIndebted({
    surplusCents: 500000, instalmentToIncome: 0.3, arrearsCount: 1, worstArrearsMonths: 4,
  });
  assert.equal(verdict.result, true);
});

test('no income captured yields no false verdict', () => {
  const result = assessAffordability({ profile: null, debtSummary: debt() });
  assert.equal(result.hasIncomeData, false);
  assert.equal(result.netIncomeCents, 0);
  assert.equal(result.debtToIncome, null);
  assert.equal(result.instalmentToIncome, null);
});

test('minimum living expenses rise with income across the bands', () => {
  assert.equal(minimumLivingExpenses(0), 0);
  const low = minimumLivingExpenses(500000);
  const mid = minimumLivingExpenses(1000000);
  const high = minimumLivingExpenses(3000000);
  assert.ok(low < mid && mid < high);
});

test('expenses below the guideline are flagged as probably under-reported', () => {
  const result = assessAffordability({
    profile: profile({ expenses_json: JSON.stringify({ groceries: 50000 }) }),
    debtSummary: debt(),
  });
  assert.equal(result.expensesBelowGuideline, true);
});

test('unknown expense categories are dropped rather than rendered', () => {
  const result = assessAffordability({
    profile: profile({ expenses_json: JSON.stringify({ housing: 500000, '<script>': 999999 }) }),
    debtSummary: debt(),
  });
  assert.deepEqual(Object.keys(result.expenses), ['housing']);
  assert.equal(result.declaredExpensesCents, 500000);
});

test('malformed expense JSON does not break the assessment', () => {
  const result = assessAffordability({
    profile: profile({ expenses_json: 'not json at all' }),
    debtSummary: debt(),
  });
  assert.equal(result.declaredExpensesCents, 0);
});

test('risk levels move with strain', () => {
  assert.equal(riskLevel({ surplusCents: -1, instalmentToIncome: 0.3, worstArrearsMonths: 0 }), 'critical');
  assert.equal(riskLevel({ surplusCents: 100, instalmentToIncome: 0.45, worstArrearsMonths: 0 }), 'elevated');
  assert.equal(riskLevel({ surplusCents: 100, instalmentToIncome: 0.3, worstArrearsMonths: 0 }), 'moderate');
  assert.equal(riskLevel({ surplusCents: 100, instalmentToIncome: 0.1, worstArrearsMonths: 0 }), 'stable');
});
