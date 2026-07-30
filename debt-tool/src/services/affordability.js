import { ratio } from '../lib/money.js';

/**
 * Minimum living expense guidance, in cents per month.
 *
 * These mirror the structure of the NCR's affordability guidelines (a fixed
 * base plus a share of income above a threshold). The published figures are
 * revised periodically — the values here are the practice's working defaults
 * and must be reviewed against the current NCR notice before they are relied
 * on in a s86 application. Override via MINIMUM_EXPENSE_BASE_CENTS if needed.
 */
export const LIVING_EXPENSE_BANDS = [
  { maxIncomeCents: 80000, baseCents: 0, marginalRate: 1.0 },
  { maxIncomeCents: 640000, baseCents: 80000, marginalRate: 0.0669 },
  { maxIncomeCents: 1200000, baseCents: 117480, marginalRate: 0.0888 },
  { maxIncomeCents: 2500000, baseCents: 167192, marginalRate: 0.0879 },
  { maxIncomeCents: Infinity, baseCents: 281462, marginalRate: 0.0687 },
];

/**
 * Assesses whether the client can service what they owe.
 *
 * Takes the debt summary from summariseDebt() and the client's captured income
 * and expenses, and returns the numbers a consultant states on a s86 assessment:
 * disposable income, debt-to-income, instalment-to-income, and whether the
 * client meets the NCA's test for over-indebtedness.
 */
export function assessAffordability({ profile, debtSummary }) {
  const netIncomeCents = Number(profile?.net_monthly_income_cents || 0)
    + Number(profile?.other_income_cents || 0);
  const grossIncomeCents = Number(profile?.gross_monthly_income_cents || 0);

  const expenses = parseExpenses(profile?.expenses_json);
  const declaredExpensesCents = Object.values(expenses).reduce((sum, v) => sum + Number(v || 0), 0);
  const minimumExpensesCents = minimumLivingExpenses(netIncomeCents);

  const totalInstalmentCents = Number(debtSummary?.totalInstalmentCents || 0);
  const totalOwedCents = Number(debtSummary?.totalOwedCents || 0);

  // Disposable income after living costs but before debt repayments — this is
  // the pot a restructure has to distribute among creditors.
  const availableForDebtCents = netIncomeCents - declaredExpensesCents;

  // What is actually left once current instalments are paid. Negative means the
  // client is funding repayments from somewhere other than income, which is the
  // signal that a restructure is needed.
  const surplusCents = availableForDebtCents - totalInstalmentCents;

  const debtToIncome = ratio(totalOwedCents, netIncomeCents * 12);
  const instalmentToIncome = ratio(totalInstalmentCents, netIncomeCents);
  const expenseToIncome = ratio(declaredExpensesCents, netIncomeCents);

  const overIndebted = isOverIndebted({
    surplusCents,
    instalmentToIncome,
    arrearsCount: Number(debtSummary?.accountsInArrearsCount || 0),
    worstArrearsMonths: Number(debtSummary?.worstArrearsMonths || 0),
  });

  return {
    netIncomeCents,
    grossIncomeCents,
    expenses,
    declaredExpensesCents,
    minimumExpensesCents,
    // Flags a declared expense figure below the guideline minimum, which usually
    // means the client under-reported rather than that they live on less.
    expensesBelowGuideline: declaredExpensesCents > 0 && declaredExpensesCents < minimumExpensesCents,
    totalInstalmentCents,
    availableForDebtCents,
    surplusCents,
    debtToIncome,
    instalmentToIncome,
    expenseToIncome,
    overIndebted: overIndebted.result,
    overIndebtedReasons: overIndebted.reasons,
    riskLevel: riskLevel({ surplusCents, instalmentToIncome, worstArrearsMonths: Number(debtSummary?.worstArrearsMonths || 0) }),
    hasIncomeData: netIncomeCents > 0,
  };
}

/**
 * NCA s79 asks whether the consumer is or will be unable to satisfy all their
 * obligations in a timely manner. There is no statutory formula, so this encodes
 * the practical tests a debt counsellor applies and returns its reasoning rather
 * than a bare boolean — the consultant, not the tool, makes the determination.
 */
export function isOverIndebted({ surplusCents, instalmentToIncome, arrearsCount, worstArrearsMonths }) {
  const reasons = [];

  if (surplusCents < 0) {
    reasons.push('Monthly instalments exceed the income left after living expenses.');
  }
  if (instalmentToIncome !== null && instalmentToIncome > 0.5) {
    reasons.push('More than half of net income is committed to debt repayments.');
  }
  if (worstArrearsMonths >= 3) {
    reasons.push(`At least one account is ${worstArrearsMonths} months in arrears.`);
  }
  if (arrearsCount >= 3) {
    reasons.push(`${arrearsCount} accounts are currently in arrears.`);
  }

  return { result: reasons.length > 0, reasons };
}

/** Traffic light for the dashboard header. */
export function riskLevel({ surplusCents, instalmentToIncome, worstArrearsMonths }) {
  if (surplusCents < 0 || worstArrearsMonths >= 3) return 'critical';
  if ((instalmentToIncome !== null && instalmentToIncome > 0.4) || worstArrearsMonths > 0) return 'elevated';
  if (instalmentToIncome !== null && instalmentToIncome > 0.25) return 'moderate';
  return 'stable';
}

/** Minimum monthly living expenses for a given net income, per the bands above. */
export function minimumLivingExpenses(netIncomeCents) {
  const income = Number(netIncomeCents || 0);
  if (income <= 0) return 0;

  let lowerBound = 0;
  for (const band of LIVING_EXPENSE_BANDS) {
    if (income <= band.maxIncomeCents) {
      return Math.round(band.baseCents + (income - lowerBound) * band.marginalRate);
    }
    lowerBound = band.maxIncomeCents;
  }
  return 0;
}

export const EXPENSE_CATEGORIES = Object.freeze({
  housing: 'Housing / rent / bond',
  utilities: 'Water, electricity & rates',
  groceries: 'Groceries & household',
  transport: 'Transport & fuel',
  education: 'Education & childcare',
  medical: 'Medical & insurance',
  communication: 'Airtime & data',
  maintenance: 'Maintenance / support paid',
  other: 'Other living expenses',
});

function parseExpenses(json) {
  if (!json) return {};
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (!parsed || typeof parsed !== 'object') return {};
    // Keep only known categories so a stale row cannot inject arbitrary keys into the UI.
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => Object.hasOwn(EXPENSE_CATEGORIES, key)),
    );
  } catch {
    return {};
  }
}
