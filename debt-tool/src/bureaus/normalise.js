import { parseRandsToCents } from '../lib/money.js';

/**
 * The canonical account types this tool reasons about. Each bureau uses its own
 * codes; every adapter maps into this list so the analytics layer never has to
 * know which bureau a row came from.
 */
export const ACCOUNT_TYPES = Object.freeze({
  home_loan: { label: 'Home loan', category: 'secured', securedAsset: true },
  vehicle_finance: { label: 'Vehicle finance', category: 'secured', securedAsset: true },
  personal_loan: { label: 'Personal loan', category: 'unsecured', securedAsset: false },
  credit_card: { label: 'Credit card', category: 'revolving', securedAsset: false },
  store_card: { label: 'Store / retail account', category: 'revolving', securedAsset: false },
  overdraft: { label: 'Bank overdraft', category: 'revolving', securedAsset: false },
  revolving_credit: { label: 'Revolving credit', category: 'revolving', securedAsset: false },
  short_term_loan: { label: 'Short-term / payday loan', category: 'unsecured', securedAsset: false },
  student_loan: { label: 'Student loan', category: 'unsecured', securedAsset: false },
  telecom: { label: 'Cellphone / telecoms', category: 'service', securedAsset: false },
  municipal: { label: 'Municipal account', category: 'service', securedAsset: false },
  insurance: { label: 'Insurance premium', category: 'service', securedAsset: false },
  other: { label: 'Other', category: 'unsecured', securedAsset: false },
});

export const ACCOUNT_STATUSES = Object.freeze([
  'open', 'closed', 'written_off', 'legal', 'under_debt_review', 'unknown',
]);

// Free-text descriptions bureaus and PDF reports use for each canonical type.
// Ordered longest-first at match time so "revolving credit" is not swallowed by "credit".
const TYPE_PATTERNS = [
  [/home\s*loan|mortgage|bond|hl\b/i, 'home_loan'],
  [/vehicle|vaf\b|instal?ment\s*sale|hire\s*purchase|car\s*finance|motor/i, 'vehicle_finance'],
  [/revolving/i, 'revolving_credit'],
  [/credit\s*card|creditcard|cc\b|visa|mastercard/i, 'credit_card'],
  [/store\s*card|retail|clothing|furniture|account\s*card/i, 'store_card'],
  [/overdraft|od\b|current\s*account/i, 'overdraft'],
  [/payday|short[\s-]*term|micro\s*loan|one\s*month/i, 'short_term_loan'],
  [/student|study\s*loan|education/i, 'student_loan'],
  [/personal\s*loan|term\s*loan|unsecured\s*loan|loan/i, 'personal_loan'],
  [/cell|mobile|telkom|vodacom|mtn|telecom|airtime|contract\s*phone/i, 'telecom'],
  [/municipal|rates|water|electricity|council/i, 'municipal'],
  [/insurance|premium|funeral\s*cover|assurance/i, 'insurance'],
];

const STATUS_PATTERNS = [
  [/written\s*off|write[\s-]*off|bad\s*debt|charged?\s*off/i, 'written_off'],
  [/legal|handed\s*over|judgment|judgement|summons|attorney/i, 'legal'],
  [/debt\s*review|under\s*review|debt\s*counsell?ing|section\s*86/i, 'under_debt_review'],
  [/closed|settled|paid\s*up|paid\s*in\s*full|terminated/i, 'closed'],
  [/open|active|current|up\s*to\s*date|in\s*good\s*standing/i, 'open'],
];

/** Maps any bureau's account-type description onto a canonical type key. */
export function normaliseAccountType(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 'other';
  if (Object.hasOwn(ACCOUNT_TYPES, text)) return text;
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'other';
}

/** Maps any bureau's status description onto a canonical status. */
export function normaliseStatus(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 'unknown';
  if (ACCOUNT_STATUSES.includes(text)) return text;
  for (const [pattern, status] of STATUS_PATTERNS) {
    if (pattern.test(text)) return status;
  }
  return 'unknown';
}

/**
 * Normalises a creditor name for grouping. Two rows reading "ABSA BANK LTD" and
 * "Absa Bank Limited" are the same creditor on a client's file and must total together.
 */
export function normaliseCreditor(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\b(pty|proprietary|ltd|limited|inc|incorporated|sa|rsa|bank of|group|holdings)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ') || 'unknown';
}

/** Masks an account number to its last four characters. */
export function maskAccountNumber(raw) {
  const text = String(raw ?? '').replace(/\s+/g, '');
  if (!text) return null;
  if (text.length <= 4) return `••••${text}`;
  return `••••${text.slice(-4)}`;
}

/** Coerces a bureau date into ISO `YYYY-MM-DD`, or null when unreadable. */
export function normaliseDate(raw) {
  if (!raw) return null;
  const text = String(raw).trim();

  let m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return isoDate(m[1], m[2], m[3]);

  // Ambiguous between DD/MM/YYYY and MM/DD/YYYY. South African bureaus use
  // day-first, so read it that way and only swap when the first field cannot be a day.
  m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const [, a, b, year] = m;
    return Number(a) > 12 || Number(b) <= 12 ? isoDate(year, b, a) : isoDate(year, a, b);
  }

  m = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return isoDate(m[1], m[2], m[3]);

  m = text.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return isoDate(m[1], m[2], '01');

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function isoDate(year, month, day) {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Reads an interest rate in any of "23.5", "23,5%", 0.235 into a decimal fraction. */
export function normaliseRate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = Number(String(raw).replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  // Anything above 1 is being quoted as a percentage; below that it is already a fraction.
  return numeric > 1 ? numeric / 100 : numeric;
}

/**
 * Takes a loosely-shaped account from any source and returns the canonical row
 * this application stores and analyses. Unknown fields are dropped rather than
 * passed through, so a bureau changing its payload cannot inject columns.
 */
export function normaliseAccount(input = {}) {
  const balance = pickCents(input.currentBalance, input.current_balance, input.balance, input.outstandingBalance);
  // Both spellings of "instalment" appear in the wild: South African bureaus use
  // one L, American-derived payloads use two. Accepting only one silently zeroed
  // the instalment, which then read as a debt with no repayment against it.
  const instalment = pickCents(
    input.monthlyInstalment, input.monthly_instalment, input.instalment,
    input.instalmentAmount, input.installmentAmount,
  );
  const arrears = pickCents(
    input.arrearsAmount, input.arrears_amount, input.arrears,
    input.amountOverdue, input.overdueAmount, input.amountInArrears,
  );
  const original = pickCents(input.originalAmount, input.original_amount, input.openingBalance);
  const limit = pickCents(input.creditLimit, input.credit_limit, input.limit);

  const monthsInArrears = Number.parseInt(
    input.monthsInArrears ?? input.months_in_arrears ?? input.monthsOverdue ?? 0, 10,
  );

  const creditorName = String(input.creditorName ?? input.creditor ?? input.subscriberName ?? 'Unknown creditor').trim()
    || 'Unknown creditor';

  return {
    creditorName,
    creditorNormalised: normaliseCreditor(creditorName),
    accountNumber: input.accountNumber ?? input.account_number ?? null,
    accountNumberMasked: maskAccountNumber(input.accountNumber ?? input.account_number),
    accountType: normaliseAccountType(input.accountType ?? input.account_type ?? input.productType),
    status: normaliseStatus(input.status ?? input.accountStatus),
    openedDate: normaliseDate(input.openedDate ?? input.opened_date ?? input.dateOpened),
    currentBalanceCents: balance ?? 0,
    originalAmountCents: original,
    monthlyInstalmentCents: instalment ?? 0,
    arrearsAmountCents: arrears ?? 0,
    creditLimitCents: limit,
    monthsInArrears: Number.isFinite(monthsInArrears) && monthsInArrears > 0 ? monthsInArrears : 0,
    interestRateAnnual: normaliseRate(input.interestRate ?? input.interest_rate ?? input.annualRate),
    lastPaymentDate: normaliseDate(input.lastPaymentDate ?? input.last_payment_date),
    bureauUpdatedAt: normaliseDate(input.lastUpdated ?? input.bureau_updated_at ?? input.statusDate),
  };
}

function pickCents(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const cents = parseRandsToCents(candidate);
    if (cents !== null) return cents;
  }
  return null;
}

/** Groups the credit score into the band consultants use when talking to clients. */
export function scoreBand(score) {
  // Number(null) and Number('') are both 0, which is finite — without this guard
  // a client whose bureau returned no score would be labelled "High risk".
  if (score === null || score === undefined || score === '') return null;
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 767) return 'Excellent';
  if (value >= 681) return 'Good';
  if (value >= 614) return 'Favourable';
  if (value >= 583) return 'Average';
  if (value >= 527) return 'Below average';
  return 'High risk';
}
