import { ACCOUNT_TYPES } from '../bureaus/normalise.js';
import { sumCents, ratio } from '../lib/money.js';

/**
 * Turns a client's accounts into the picture a consultant actually reads:
 * what is owed in total, to whom, of what kind, and how far behind they are.
 *
 * Accounts flagged is_excluded are reported separately rather than dropped —
 * a consultant excluding a disputed account still needs to see it on the file.
 */
export function summariseDebt(allAccounts = []) {
  const accounts = allAccounts.filter((a) => !a.is_excluded);
  const excluded = allAccounts.filter((a) => a.is_excluded);

  // Written-off and closed accounts do not form part of what the client is
  // currently paying, but written-off debt is still legally owed and still
  // collectable, so it is counted separately rather than ignored.
  const active = accounts.filter((a) => ['open', 'legal', 'under_debt_review', 'unknown'].includes(a.status));
  const writtenOff = accounts.filter((a) => a.status === 'written_off');
  const closed = accounts.filter((a) => a.status === 'closed');

  const totalOwedCents = sumCents(active, 'current_balance_cents');
  const totalInstalmentCents = sumCents(active, 'monthly_instalment_cents');
  const totalArrearsCents = sumCents(active, 'arrears_amount_cents');
  const writtenOffCents = sumCents(writtenOff, 'current_balance_cents');

  const accountsInArrears = active.filter((a) => Number(a.arrears_amount_cents) > 0 || Number(a.months_in_arrears) > 0);
  const worstArrearsMonths = active.reduce((worst, a) => Math.max(worst, Number(a.months_in_arrears) || 0), 0);

  return {
    totalOwedCents,
    totalInstalmentCents,
    totalArrearsCents,
    writtenOffCents,
    // What the client is exposed to in total, including debt a creditor has
    // written off internally but can still pursue.
    totalExposureCents: totalOwedCents + writtenOffCents,

    accountCount: active.length,
    closedCount: closed.length,
    writtenOffCount: writtenOff.length,
    excludedCount: excluded.length,

    accountsInArrearsCount: accountsInArrears.length,
    worstArrearsMonths,
    arrearsShare: ratio(totalArrearsCents, totalOwedCents),

    averageInterestRate: weightedAverageRate(active),
    largestAccount: [...active].sort((a, b) => b.current_balance_cents - a.current_balance_cents)[0] ?? null,

    byCreditor: groupByCreditor(active),
    byType: groupByType(active),
    byCategory: groupByCategory(active),

    activeAccounts: active,
    writtenOffAccounts: writtenOff,
    closedAccounts: closed,
    excludedAccounts: excluded,
  };
}

/** One row per creditor, biggest balance first — the "who do I owe" table. */
export function groupByCreditor(accounts) {
  const map = new Map();
  for (const account of accounts) {
    const key = account.creditor_normalised || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        key,
        creditorName: account.creditor_name,
        accountCount: 0,
        balanceCents: 0,
        instalmentCents: 0,
        arrearsCents: 0,
        worstArrearsMonths: 0,
        accounts: [],
      });
    }
    const row = map.get(key);
    row.accountCount += 1;
    row.balanceCents += Number(account.current_balance_cents) || 0;
    row.instalmentCents += Number(account.monthly_instalment_cents) || 0;
    row.arrearsCents += Number(account.arrears_amount_cents) || 0;
    row.worstArrearsMonths = Math.max(row.worstArrearsMonths, Number(account.months_in_arrears) || 0);
    row.accounts.push(account);
  }
  return [...map.values()].sort((a, b) => b.balanceCents - a.balanceCents);
}

/** One row per account type, for the breakdown chart. */
export function groupByType(accounts) {
  const map = new Map();
  for (const account of accounts) {
    const type = account.account_type || 'other';
    if (!map.has(type)) {
      map.set(type, {
        type,
        label: ACCOUNT_TYPES[type]?.label ?? 'Other',
        category: ACCOUNT_TYPES[type]?.category ?? 'unsecured',
        accountCount: 0,
        balanceCents: 0,
        instalmentCents: 0,
        arrearsCents: 0,
      });
    }
    const row = map.get(type);
    row.accountCount += 1;
    row.balanceCents += Number(account.current_balance_cents) || 0;
    row.instalmentCents += Number(account.monthly_instalment_cents) || 0;
    row.arrearsCents += Number(account.arrears_amount_cents) || 0;
  }
  return [...map.values()].sort((a, b) => b.balanceCents - a.balanceCents);
}

/**
 * Secured vs unsecured vs revolving vs service. This split drives the restructure:
 * secured debt (the house, the car) is protected differently under the NCA to
 * unsecured debt, which is what a debt-review proposal mainly reschedules.
 */
export function groupByCategory(accounts) {
  const map = new Map();
  for (const account of accounts) {
    const category = ACCOUNT_TYPES[account.account_type]?.category ?? 'unsecured';
    if (!map.has(category)) {
      map.set(category, { category, accountCount: 0, balanceCents: 0, instalmentCents: 0, arrearsCents: 0 });
    }
    const row = map.get(category);
    row.accountCount += 1;
    row.balanceCents += Number(account.current_balance_cents) || 0;
    row.instalmentCents += Number(account.monthly_instalment_cents) || 0;
    row.arrearsCents += Number(account.arrears_amount_cents) || 0;
  }
  return [...map.values()].sort((a, b) => b.balanceCents - a.balanceCents);
}

/** Interest rate weighted by balance — the rate that actually matters to the client. */
function weightedAverageRate(accounts) {
  let weightedSum = 0;
  let weight = 0;
  for (const account of accounts) {
    const rate = Number(account.interest_rate_annual);
    const balance = Number(account.current_balance_cents) || 0;
    if (Number.isFinite(rate) && rate > 0 && balance > 0) {
      weightedSum += rate * balance;
      weight += balance;
    }
  }
  return weight > 0 ? weightedSum / weight : null;
}
