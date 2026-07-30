import { BureauProvider, bureauFetch, parseJsonBody } from './provider.js';
import { normaliseAccount, normaliseDate, scoreBand } from './normalise.js';
import { parseRandsToCents } from '../lib/money.js';
import { trimSlash, firstValue, firstArray, toInt } from './transunion.js';

/**
 * Experian South Africa — Consumer Credit Profile.
 *
 * Experian's SA gateway authenticates per-request with subscriber credentials
 * rather than issuing a bearer token, so there is no token cache here.
 *
 * Required environment:
 *   EXPERIAN_BASE_URL
 *   EXPERIAN_USERNAME
 *   EXPERIAN_PASSWORD
 *   EXPERIAN_SUBSCRIBER_CODE
 */
export class ExperianProvider extends BureauProvider {
  static id = 'experian';
  static label = 'Experian';
  static isSimulated = false;

  isConfigured() {
    const { baseUrl, username, password, subscriberCode } = this.settings;
    return Boolean(baseUrl && username && password && subscriberCode);
  }

  configurationHint() {
    return 'Set EXPERIAN_BASE_URL, EXPERIAN_USERNAME, EXPERIAN_PASSWORD and EXPERIAN_SUBSCRIBER_CODE.';
  }

  async fetchCreditProfile(subject) {
    const { body } = await bureauFetch(`${trimSlash(this.settings.baseUrl)}/consumer/creditprofile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${this.settings.username}:${this.settings.password}`).toString('base64')}`,
      },
      body: JSON.stringify({
        subscriberCode: this.settings.subscriberCode,
        enquiryPurpose: 'DEBT_REVIEW',
        yourReference: subject.reference,
        subject: {
          identityNumber: subject.idNumber,
          firstName: subject.firstName,
          surname: subject.lastName,
          birthDate: subject.dateOfBirth || undefined,
        },
      }),
    });
    return parseJsonBody(body, this.id);
  }

  normalise(raw) {
    const report = raw?.consumerProfile ?? raw?.response ?? raw?.data ?? raw ?? {};
    const accountRows = firstArray(report, ['accounts', 'creditAccounts', 'tradeLines', 'accountSummary.accounts']);
    const score = firstValue(report, ['creditScore.score', 'score.value', 'delphiScore', 'score']);

    return {
      reference: firstValue(report, ['enquiryId', 'reference', 'transactionId']) ?? null,
      creditScore: toInt(score),
      scoreBand: firstValue(report, ['creditScore.riskBand', 'score.band']) ?? scoreBand(score),
      accounts: accountRows.map((row) => normaliseAccount({
        creditorName: firstValue(row, ['supplierName', 'creditorName', 'subscriberName', 'companyName']),
        accountNumber: firstValue(row, ['accountNumber', 'accountRef']),
        accountType: firstValue(row, ['accountTypeDesc', 'accountType', 'productType', 'natureOfAccount']),
        status: firstValue(row, ['statusDesc', 'accountStatus', 'status']),
        openedDate: firstValue(row, ['openDate', 'dateOpened']),
        currentBalance: firstValue(row, ['currentBalance', 'balanceOutstanding', 'balance']),
        originalAmount: firstValue(row, ['openingBalance', 'originalOpeningBalance']),
        monthlyInstalment: firstValue(row, ['instalment', 'monthlyInstalment', 'repayment']),
        arrearsAmount: firstValue(row, ['arrearsAmount', 'amountOverdue', 'overdueAmount']),
        creditLimit: firstValue(row, ['creditLimit', 'facilityAmount']),
        monthsInArrears: firstValue(row, ['monthsInArrears', 'arrearsPeriod']),
        interestRate: firstValue(row, ['interestRate']),
        lastPaymentDate: firstValue(row, ['lastPaymentDate']),
        lastUpdated: firstValue(row, ['lastUpdated', 'statusDate', 'dateReported']),
      })),
      enquiries: firstArray(report, ['enquiries', 'previousEnquiries']).map((row) => ({
        date: normaliseDate(firstValue(row, ['enquiryDate', 'date'])),
        subscriber: firstValue(row, ['enquirerName', 'supplierName']) ?? 'Unknown',
        reason: firstValue(row, ['purpose', 'enquiryReason']) ?? null,
      })),
      publicRecords: firstArray(report, ['judgements', 'judgments', 'publicDomainInfo', 'defaults']).map((row) => ({
        type: firstValue(row, ['type', 'recordType', 'description']) ?? 'Public record',
        date: normaliseDate(firstValue(row, ['date', 'judgementDate', 'issueDate'])),
        amountCents: parseRandsToCents(firstValue(row, ['amount', 'judgementAmount'])),
        court: firstValue(row, ['court', 'courtName']) ?? null,
        caseNumber: firstValue(row, ['caseNumber', 'caseNo']) ?? null,
      })),
    };
  }
}
