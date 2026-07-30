import { getDb } from '../db/index.js';
import { getClientById } from './clients.js';
import { latestSnapshot, listSnapshots, accountsForSnapshot, isStale } from './snapshots.js';
import { listConsents, hasBureauConsent } from './consent.js';
import { summariseDebt } from './debtProfile.js';
import { assessAffordability } from './affordability.js';
import { proposeRestructure } from './restructure.js';

/**
 * Assembles everything the client dashboard shows, in one place, so the HTML view
 * and the JSON API can never drift apart on what a client owes.
 *
 * `snapshotId` lets a consultant look at a historical pull — useful when a client
 * asks why a figure changed between appointments.
 */
export function buildClientView(clientId, { snapshotId = null, restructureOptions = {} } = {}, database = getDb()) {
  const client = getClientById(clientId, database);
  if (!client) return null;

  const snapshots = listSnapshots(clientId, database);
  const snapshot = snapshotId
    ? snapshots.find((s) => s.id === Number(snapshotId)) ?? null
    : latestSnapshot(clientId, database);

  const accounts = snapshot ? accountsForSnapshot(snapshot.id, database) : [];
  const debt = summariseDebt(accounts);

  const profile = database.prepare(`
    SELECT * FROM financial_profiles WHERE client_id = ?
    ORDER BY effective_from DESC, id DESC LIMIT 1
  `).get(clientId) ?? null;

  const affordability = assessAffordability({ profile, debtSummary: debt });

  const restructure = proposeRestructure({
    accounts: debt.activeAccounts,
    availableForDebtCents: affordability.availableForDebtCents,
    ...restructureOptions,
  });

  return {
    client,
    snapshot,
    snapshots,
    snapshotIsStale: isStale(snapshot),
    hasSnapshot: Boolean(snapshot),
    accounts,
    debt,
    profile,
    affordability,
    restructure,
    consents: listConsents(clientId, database),
    hasBureauConsent: hasBureauConsent(clientId, database),
  };
}

/** The same view, flattened for JSON consumers. */
export function serialiseClientView(view) {
  if (!view) return null;
  const { client, snapshot, debt, affordability, restructure, profile } = view;

  return {
    client: {
      id: client.id,
      reference: client.reference,
      firstName: client.first_name,
      lastName: client.last_name,
      // Never emit the full ID number over the API. The last four digits are
      // enough for staff to confirm they have the right file.
      idNumberLast4: client.id_number_last4,
      email: client.email,
      phone: client.phone,
      status: client.status,
      dependants: client.dependants,
    },
    snapshot: snapshot
      ? {
          id: snapshot.id,
          provider: snapshot.provider,
          sourceKind: snapshot.source_kind,
          isSimulated: Boolean(snapshot.is_simulated),
          requestedAt: snapshot.requested_at,
          creditScore: snapshot.credit_score,
          scoreBand: snapshot.score_band,
          isStale: view.snapshotIsStale,
        }
      : null,
    debt: {
      totalOwedCents: debt.totalOwedCents,
      totalInstalmentCents: debt.totalInstalmentCents,
      totalArrearsCents: debt.totalArrearsCents,
      writtenOffCents: debt.writtenOffCents,
      totalExposureCents: debt.totalExposureCents,
      accountCount: debt.accountCount,
      accountsInArrearsCount: debt.accountsInArrearsCount,
      worstArrearsMonths: debt.worstArrearsMonths,
      averageInterestRate: debt.averageInterestRate,
      byCreditor: debt.byCreditor.map((row) => ({
        creditorName: row.creditorName,
        accountCount: row.accountCount,
        balanceCents: row.balanceCents,
        instalmentCents: row.instalmentCents,
        arrearsCents: row.arrearsCents,
      })),
      byType: debt.byType,
      byCategory: debt.byCategory,
      accounts: debt.activeAccounts.map(serialiseAccount),
    },
    affordability: {
      netIncomeCents: affordability.netIncomeCents,
      declaredExpensesCents: affordability.declaredExpensesCents,
      minimumExpensesCents: affordability.minimumExpensesCents,
      availableForDebtCents: affordability.availableForDebtCents,
      surplusCents: affordability.surplusCents,
      debtToIncome: affordability.debtToIncome,
      instalmentToIncome: affordability.instalmentToIncome,
      overIndebted: affordability.overIndebted,
      overIndebtedReasons: affordability.overIndebtedReasons,
      riskLevel: affordability.riskLevel,
      hasIncomeData: affordability.hasIncomeData,
      capturedAt: profile?.effective_from ?? null,
    },
    restructure: {
      feasible: restructure.feasible,
      distributableCents: restructure.distributableCents,
      currentInstalmentCents: restructure.currentInstalmentCents,
      proposedInstalmentCents: restructure.proposedInstalmentCents,
      monthlyReliefCents: restructure.monthlyReliefCents,
      longestTermMonths: restructure.longestTermMonths,
      totalRepayableCents: restructure.totalRepayableCents,
      warnings: restructure.warnings,
      lines: restructure.lines,
    },
  };
}

function serialiseAccount(account) {
  return {
    id: account.id,
    creditorName: account.creditor_name,
    accountNumberMasked: account.account_number_masked,
    accountType: account.account_type,
    status: account.status,
    openedDate: account.opened_date,
    currentBalanceCents: account.current_balance_cents,
    monthlyInstalmentCents: account.monthly_instalment_cents,
    arrearsAmountCents: account.arrears_amount_cents,
    monthsInArrears: account.months_in_arrears,
    creditLimitCents: account.credit_limit_cents,
    interestRateAnnual: account.interest_rate_annual,
    isExcluded: Boolean(account.is_excluded),
  };
}
