import { BureauProvider, bureauFetch, parseJsonBody } from './provider.js';
import { normaliseAccount, normaliseDate, scoreBand } from './normalise.js';
import { parseRandsToCents } from '../lib/money.js';
import { trimSlash, firstValue, firstArray, toInt } from './transunion.js';

/**
 * XDS (Xpert Decision Systems) — Consumer Credit Report.
 *
 * XDS is commonly the cheapest per-enquiry option for a small debt-counselling
 * practice, which is why it is included alongside the two large bureaus.
 *
 * Required environment:
 *   XDS_BASE_URL
 *   XDS_USERNAME
 *   XDS_PASSWORD
 *   XDS_PRODUCT_CODE   defaults to ConsumerCreditReport
 */
export class XdsProvider extends BureauProvider {
  static id = 'xds';
  static label = 'XDS';
  static isSimulated = false;

  isConfigured() {
    const { baseUrl, username, password } = this.settings;
    return Boolean(baseUrl && username && password);
  }

  configurationHint() {
    return 'Set XDS_BASE_URL, XDS_USERNAME and XDS_PASSWORD.';
  }

  async fetchCreditProfile(subject) {
    const { body } = await bureauFetch(`${trimSlash(this.settings.baseUrl)}/api/v1/enquiry`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        Username: this.settings.username,
        Password: this.settings.password,
        ProductCode: this.settings.productCode || 'ConsumerCreditReport',
        EnquiryReason: 'DebtCounselling',
        ClientReference: subject.reference,
        IdentityNumber: subject.idNumber,
        Forename: subject.firstName,
        Surname: subject.lastName,
      }),
    });
    return parseJsonBody(body, this.id);
  }

  normalise(raw) {
    const report = raw?.EnquiryResult ?? raw?.Result ?? raw?.data ?? raw ?? {};
    const accountRows = firstArray(report, ['Accounts', 'TradeLines', 'CreditAccounts', 'accounts']);
    const score = firstValue(report, ['Score.Value', 'CreditScore', 'Score', 'score']);

    return {
      reference: firstValue(report, ['EnquiryReference', 'ReferenceNumber', 'Reference']) ?? null,
      creditScore: toInt(score),
      scoreBand: firstValue(report, ['Score.Description', 'ScoreBand']) ?? scoreBand(score),
      accounts: accountRows.map((row) => normaliseAccount({
        creditorName: firstValue(row, ['SubscriberName', 'CreditorName', 'CompanyName', 'creditorName']),
        accountNumber: firstValue(row, ['AccountNumber', 'AccountNo', 'accountNumber']),
        accountType: firstValue(row, ['AccountTypeDescription', 'AccountType', 'ProductType', 'accountType']),
        status: firstValue(row, ['StatusDescription', 'AccountStatus', 'Status', 'status']),
        openedDate: firstValue(row, ['DateOpened', 'OpenDate', 'openedDate']),
        currentBalance: firstValue(row, ['CurrentBalance', 'Balance', 'OutstandingBalance', 'currentBalance']),
        originalAmount: firstValue(row, ['OpeningBalance', 'OriginalAmount']),
        monthlyInstalment: firstValue(row, ['InstalmentAmount', 'MonthlyInstalment', 'Instalment']),
        arrearsAmount: firstValue(row, ['ArrearsAmount', 'OverdueAmount', 'AmountInArrears']),
        creditLimit: firstValue(row, ['CreditLimit', 'Limit']),
        monthsInArrears: firstValue(row, ['MonthsInArrears', 'ArrearsMonths']),
        interestRate: firstValue(row, ['InterestRate']),
        lastPaymentDate: firstValue(row, ['LastPaymentDate']),
        lastUpdated: firstValue(row, ['LastUpdated', 'StatusDate', 'DateReported']),
      })),
      enquiries: firstArray(report, ['Enquiries', 'EnquiryHistory']).map((row) => ({
        date: normaliseDate(firstValue(row, ['EnquiryDate', 'Date'])),
        subscriber: firstValue(row, ['SubscriberName', 'EnquirerName']) ?? 'Unknown',
        reason: firstValue(row, ['EnquiryReason', 'Reason']) ?? null,
      })),
      publicRecords: firstArray(report, ['Judgements', 'Judgments', 'PublicRecords', 'Defaults']).map((row) => ({
        type: firstValue(row, ['Type', 'RecordType', 'Description']) ?? 'Public record',
        date: normaliseDate(firstValue(row, ['Date', 'JudgementDate'])),
        amountCents: parseRandsToCents(firstValue(row, ['Amount', 'JudgementAmount'])),
        court: firstValue(row, ['Court', 'CourtName']) ?? null,
        caseNumber: firstValue(row, ['CaseNumber', 'CaseNo']) ?? null,
      })),
    };
  }
}
