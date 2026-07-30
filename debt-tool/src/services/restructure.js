import { ACCOUNT_TYPES } from '../bureaus/normalise.js';

/**
 * Builds a proposed debt restructure — the "here is what your repayments could
 * look like" model a consultant walks a client through.
 *
 * The approach mirrors how a s86 debt-review proposal is put together:
 *
 *   1. Take the income available for debt after living expenses.
 *   2. Deduct the debt counsellor's monthly fee.
 *   3. Keep secured accounts (home loan, vehicle finance) at their contractual
 *      instalment where affordable, so the client does not lose the asset.
 *   4. Distribute what remains across the other accounts pro-rata to balance.
 *   5. Amortise each account at a concession interest rate to get a term.
 *
 * This is a modelling tool. The binding restructure is whatever creditors accept
 * or a magistrate orders — the output here is labelled as a proposal throughout.
 */
export function proposeRestructure({
  accounts = [],
  availableForDebtCents = 0,
  monthlyFeeCents = 0,
  concessionRateAnnual = 0.05,
  protectSecured = true,
  maxTermMonths = 60,
} = {}) {
  const eligible = accounts.filter(
    (a) => !a.is_excluded
      && ['open', 'legal', 'under_debt_review', 'unknown'].includes(a.status)
      && Number(a.current_balance_cents) > 0,
  );

  const distributable = Math.max(0, Number(availableForDebtCents) - Number(monthlyFeeCents));

  const secured = protectSecured
    ? eligible.filter((a) => ACCOUNT_TYPES[a.account_type]?.securedAsset)
    : [];
  const unsecured = eligible.filter((a) => !secured.includes(a));

  const securedInstalmentCents = secured.reduce((sum, a) => sum + Number(a.monthly_instalment_cents || 0), 0);

  // If protected instalments alone exceed what is available, the asset cannot be
  // protected on this income. Say so rather than silently producing a plan that
  // leaves nothing for anyone else.
  const securedAffordable = securedInstalmentCents <= distributable;
  const afterSecuredCents = securedAffordable
    ? distributable - securedInstalmentCents
    : distributable;

  const poolAccounts = securedAffordable ? unsecured : eligible;
  const poolBalanceCents = poolAccounts.reduce((sum, a) => sum + Number(a.current_balance_cents || 0), 0);

  const lines = [];

  if (securedAffordable) {
    for (const account of secured) {
      lines.push(buildLine({
        account,
        proposedInstalmentCents: Number(account.monthly_instalment_cents || 0),
        concessionRateAnnual: Number(account.interest_rate_annual ?? concessionRateAnnual),
        treatment: 'protected',
      }));
    }
  }

  // Pro-rata by balance. Remainder cents are handed to the largest balance so the
  // proposed instalments sum exactly to the pool — creditors reconcile to the cent.
  const shares = poolAccounts.map((account) => {
    const share = poolBalanceCents > 0
      ? (Number(account.current_balance_cents) / poolBalanceCents) * afterSecuredCents
      : 0;
    return { account, exact: share, floor: Math.floor(share) };
  });
  const distributed = shares.reduce((sum, s) => sum + s.floor, 0);
  let remainder = Math.max(0, Math.round(afterSecuredCents) - distributed);
  shares.sort((a, b) => Number(b.account.current_balance_cents) - Number(a.account.current_balance_cents));
  for (const share of shares) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    lines.push(buildLine({
      account: share.account,
      proposedInstalmentCents: share.floor + extra,
      concessionRateAnnual,
      treatment: 'restructured',
    }));
  }

  const currentInstalmentCents = eligible.reduce((sum, a) => sum + Number(a.monthly_instalment_cents || 0), 0);
  const proposedInstalmentCents = lines.reduce((sum, l) => sum + l.proposedInstalmentCents, 0);
  const totalBalanceCents = eligible.reduce((sum, a) => sum + Number(a.current_balance_cents || 0), 0);

  const clearing = lines.filter((l) => l.termMonths !== null);
  const nonClearing = lines.filter((l) => l.termMonths === null);
  const longestTermMonths = clearing.reduce((max, l) => Math.max(max, l.termMonths), 0);

  return {
    feasible: nonClearing.length === 0 && distributable > 0,
    distributableCents: distributable,
    monthlyFeeCents: Number(monthlyFeeCents),
    securedProtected: securedAffordable && secured.length > 0,
    securedAffordable,
    securedInstalmentCents,
    totalBalanceCents,
    currentInstalmentCents,
    proposedInstalmentCents,
    monthlyReliefCents: currentInstalmentCents - proposedInstalmentCents,
    longestTermMonths: longestTermMonths || null,
    exceedsMaxTerm: longestTermMonths > maxTermMonths,
    maxTermMonths,
    totalRepayableCents: lines.reduce((sum, l) => sum + (l.totalRepayableCents ?? 0), 0),
    totalInterestCents: lines.reduce((sum, l) => sum + (l.totalInterestCents ?? 0), 0),
    concessionRateAnnual,
    lines,
    nonClearingLines: nonClearing,
    warnings: buildWarnings({ distributable, securedAffordable, secured, nonClearing, longestTermMonths, maxTermMonths }),
  };
}

function buildLine({ account, proposedInstalmentCents, concessionRateAnnual, treatment }) {
  const balanceCents = Number(account.current_balance_cents || 0);
  const currentInstalmentCents = Number(account.monthly_instalment_cents || 0);
  const termMonths = amortisationTerm({
    principalCents: balanceCents,
    paymentCents: proposedInstalmentCents,
    annualRate: concessionRateAnnual,
  });

  const totalRepayableCents = termMonths === null ? null : Math.round(proposedInstalmentCents * termMonths);

  return {
    accountId: account.id,
    creditorName: account.creditor_name,
    accountType: account.account_type,
    accountTypeLabel: ACCOUNT_TYPES[account.account_type]?.label ?? 'Other',
    treatment,
    balanceCents,
    currentInstalmentCents,
    proposedInstalmentCents,
    changeCents: proposedInstalmentCents - currentInstalmentCents,
    concessionRateAnnual,
    termMonths,
    totalRepayableCents,
    totalInterestCents: totalRepayableCents === null ? null : Math.max(0, totalRepayableCents - balanceCents),
  };
}

/**
 * Months to clear `principal` paying `payment` monthly at `annualRate`.
 *
 * Returns null when the payment never clears the debt — that is, when it does
 * not cover the monthly interest. Returning null rather than Infinity forces
 * callers to handle the case, which is exactly the case a client most needs
 * flagged: an offer that would leave them paying forever.
 */
export function amortisationTerm({ principalCents, paymentCents, annualRate }) {
  const principal = Number(principalCents);
  const payment = Number(paymentCents);
  if (!(principal > 0)) return 0;
  if (!(payment > 0)) return null;

  const monthlyRate = Number(annualRate || 0) / 12;
  if (monthlyRate <= 0) return Math.ceil(principal / payment);

  const monthlyInterest = principal * monthlyRate;
  if (payment <= monthlyInterest) return null;

  const months = -Math.log(1 - (monthlyRate * principal) / payment) / Math.log(1 + monthlyRate);
  if (!Number.isFinite(months) || months <= 0) return null;
  return Math.ceil(months);
}

function buildWarnings({ distributable, securedAffordable, secured, nonClearing, longestTermMonths, maxTermMonths }) {
  const warnings = [];

  if (distributable <= 0) {
    warnings.push('There is no income available for debt after living expenses and fees. The client cannot fund any repayment plan on the figures captured — review income and expenses before proposing.');
  }
  if (!securedAffordable && secured.length > 0) {
    warnings.push('Contractual instalments on secured accounts already exceed the available income, so the asset cannot be protected at this income level. All accounts have been treated pro-rata instead.');
  }
  if (nonClearing.length > 0) {
    const names = nonClearing.map((l) => l.creditorName).join(', ');
    warnings.push(`These accounts would never be settled at the proposed instalment because it does not cover the monthly interest: ${names}. A lower concession rate or a longer plan is needed.`);
  }
  if (longestTermMonths > maxTermMonths) {
    warnings.push(`The plan runs ${longestTermMonths} months, beyond the ${maxTermMonths}-month guideline. Unsecured plans much longer than five years are unlikely to be accepted by creditors.`);
  }
  return warnings;
}
