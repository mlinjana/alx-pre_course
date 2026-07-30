import { BureauProvider, bureauFetch, parseJsonBody, BureauError } from './provider.js';
import { normaliseAccount, normaliseDate, scoreBand } from './normalise.js';
import { parseRandsToCents } from '../lib/money.js';

/**
 * TransUnion Africa — Consumer Credit Report.
 *
 * Built against TransUnion's OAuth2 client-credentials + JSON enquiry pattern.
 * TransUnion issues per-subscriber contracts and their field names vary a little
 * by product tier, so normalise() reads each value from several candidate keys
 * rather than one hard-coded path. When you receive your live specification,
 * the only place that should need editing is FIELD_PATHS below.
 *
 * Required environment:
 *   TRANSUNION_BASE_URL          e.g. https://api.transunion.co.za
 *   TRANSUNION_CLIENT_ID
 *   TRANSUNION_CLIENT_SECRET
 *   TRANSUNION_SUBSCRIBER_CODE
 *   TRANSUNION_INDUSTRY_CODE     defaults to DC (debt counselling)
 */
export class TransUnionProvider extends BureauProvider {
  static id = 'transunion';
  static label = 'TransUnion';
  static isSimulated = false;

  isConfigured() {
    const { baseUrl, clientId, clientSecret, subscriberCode } = this.settings;
    return Boolean(baseUrl && clientId && clientSecret && subscriberCode);
  }

  configurationHint() {
    return 'Set TRANSUNION_BASE_URL, TRANSUNION_CLIENT_ID, TRANSUNION_CLIENT_SECRET and TRANSUNION_SUBSCRIBER_CODE.';
  }

  /** Client-credentials token, cached until a minute before it expires. */
  async getAccessToken() {
    if (this._token && this._tokenExpiresAt > Date.now() + 60_000) {
      return this._token;
    }
    const { body } = await bureauFetch(`${trimSlash(this.settings.baseUrl)}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${this.settings.clientId}:${this.settings.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'consumer-credit-report' }).toString(),
    });
    const json = parseJsonBody(body, this.id);
    if (!json.access_token) {
      throw new BureauError('TransUnion did not return an access token', { body: body.slice(0, 500) });
    }
    this._token = json.access_token;
    this._tokenExpiresAt = Date.now() + (Number(json.expires_in || 3600) * 1000);
    return this._token;
  }

  async fetchCreditProfile(subject) {
    const token = await this.getAccessToken();
    const { body } = await bureauFetch(
      `${trimSlash(this.settings.baseUrl)}/consumer/v2/credit-report`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          subscriberCode: this.settings.subscriberCode,
          industryCode: this.settings.industry || 'DC',
          enquiryReason: 'DEBT_COUNSELLING',
          clientReference: subject.reference,
          consumer: {
            idNumber: subject.idNumber,
            forename: subject.firstName,
            surname: subject.lastName,
            dateOfBirth: subject.dateOfBirth || undefined,
          },
        }),
      },
    );
    return parseJsonBody(body, this.id);
  }

  normalise(raw) {
    const report = raw?.creditReport ?? raw?.data ?? raw ?? {};
    const accountRows = firstArray(report, ['accounts', 'tradelines', 'creditAccounts', 'accountHistory']);
    const score = firstValue(report, ['score.value', 'creditScore.score', 'scoreDetails.score', 'score']);

    return {
      reference: firstValue(report, ['enquiryReference', 'referenceNumber', 'reference']) ?? null,
      creditScore: toInt(score),
      scoreBand: firstValue(report, ['score.band', 'creditScore.band']) ?? scoreBand(score),
      accounts: accountRows.map((row) => normaliseAccount({
        creditorName: firstValue(row, ['subscriberName', 'creditorName', 'supplierName', 'accountHolder']),
        accountNumber: firstValue(row, ['accountNumber', 'accountNo', 'referenceNumber']),
        accountType: firstValue(row, ['accountTypeDescription', 'accountType', 'productDescription', 'subAccountType']),
        status: firstValue(row, ['accountStatusDescription', 'accountStatus', 'status']),
        openedDate: firstValue(row, ['dateOpened', 'openedDate', 'accountOpenDate']),
        currentBalance: firstValue(row, ['currentBalance', 'balance', 'outstandingBalance']),
        originalAmount: firstValue(row, ['openingBalance', 'originalAmount', 'creditAmount']),
        monthlyInstalment: firstValue(row, ['instalmentAmount', 'monthlyInstalment', 'repaymentAmount']),
        arrearsAmount: firstValue(row, ['overdueAmount', 'arrearsAmount', 'amountInArrears']),
        creditLimit: firstValue(row, ['creditLimit', 'limitAmount']),
        monthsInArrears: firstValue(row, ['monthsInArrears', 'paymentsInArrears', 'arrearsMonths']),
        interestRate: firstValue(row, ['interestRate', 'annualInterestRate']),
        lastPaymentDate: firstValue(row, ['lastPaymentDate', 'datePaid']),
        lastUpdated: firstValue(row, ['lastUpdatedDate', 'statusDate', 'reportedDate']),
      })),
      enquiries: firstArray(report, ['enquiries', 'enquiryHistory']).map((row) => ({
        date: normaliseDate(firstValue(row, ['enquiryDate', 'date'])),
        subscriber: firstValue(row, ['subscriberName', 'enquirerName']) ?? 'Unknown',
        reason: firstValue(row, ['enquiryReason', 'reason']) ?? null,
      })),
      publicRecords: firstArray(report, ['publicRecords', 'judgments', 'judgements', 'adverseRecords']).map((row) => ({
        type: firstValue(row, ['recordType', 'type', 'description']) ?? 'Public record',
        date: normaliseDate(firstValue(row, ['recordDate', 'date', 'judgmentDate'])),
        amountCents: parseRandsToCents(firstValue(row, ['amount', 'judgmentAmount'])),
        court: firstValue(row, ['court', 'courtName']) ?? null,
        caseNumber: firstValue(row, ['caseNumber', 'caseNo']) ?? null,
      })),
    };
  }
}

// ── Shared helpers, also used by the Experian and XDS adapters ───────────────

export function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** Reads the first candidate path that holds a usable value. Paths may be dotted. */
export function firstValue(source, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** Reads the first candidate key that holds an array, tolerating a single object. */
export function firstArray(source, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), source);
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
  }
  return [];
}

export function toInt(value) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : null;
}
