import crypto from 'node:crypto';
import { BureauProvider } from './provider.js';
import { normaliseAccount, scoreBand } from './normalise.js';

/**
 * Simulated bureau, for development, training consultants, and demonstrating the
 * tool before live credentials exist.
 *
 * Output is deterministic per ID number: the same client always produces the same
 * debt profile, so a demo can be rehearsed and a test can assert on real numbers.
 * Everything it produces is flagged is_simulated on the snapshot and shown to
 * staff with a "SIMULATED" badge — nobody should ever mistake this for a real pull.
 */
export class MockProvider extends BureauProvider {
  static id = 'mock';
  static label = 'Simulated bureau (development only)';
  static isSimulated = true;

  isConfigured() {
    return true;
  }

  configurationHint() {
    return 'Always available. Produces realistic but fictional data.';
  }

  async fetchCreditProfile(subject) {
    const rand = seededRandom(subject.idNumber || subject.reference || 'mfg');
    const accountCount = 4 + Math.floor(rand() * 6);
    const accounts = [];

    for (let i = 0; i < accountCount; i += 1) {
      const template = CREDITOR_POOL[Math.floor(rand() * CREDITOR_POOL.length)];
      const balance = Math.round(template.balanceRange[0] + rand() * (template.balanceRange[1] - template.balanceRange[0]));
      const inArrears = rand() < 0.45;
      const monthsInArrears = inArrears ? 1 + Math.floor(rand() * 5) : 0;
      const instalment = Math.max(15000, Math.round(balance * template.instalmentFactor));

      accounts.push({
        subscriberName: template.name,
        accountNumber: String(Math.floor(rand() * 9e11) + 1e11),
        accountType: template.type,
        accountStatus: monthsInArrears >= 4 ? 'Legal — handed over' : monthsInArrears > 0 ? 'Open — in arrears' : 'Open — up to date',
        dateOpened: randomPastDate(rand, 8),
        currentBalance: (balance / 100).toFixed(2),
        openingBalance: ((balance * (1.15 + rand() * 0.6)) / 100).toFixed(2),
        instalmentAmount: (instalment / 100).toFixed(2),
        overdueAmount: (monthsInArrears * instalment / 100).toFixed(2),
        creditLimit: template.revolving ? ((balance * (1.1 + rand() * 0.5)) / 100).toFixed(2) : undefined,
        monthsInArrears,
        interestRate: (template.rateRange[0] + rand() * (template.rateRange[1] - template.rateRange[0])).toFixed(2),
        lastPaymentDate: randomPastDate(rand, 1),
        lastUpdated: randomPastDate(rand, 0.1),
      });
    }

    const score = 480 + Math.floor(rand() * 280);

    return {
      _simulated: true,
      enquiryReference: `SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      consumer: {
        idNumber: subject.idNumber,
        firstName: subject.firstName,
        surname: subject.lastName,
      },
      score: { value: score, band: scoreBand(score) },
      accounts,
      enquiries: Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        enquiryDate: randomPastDate(rand, 1),
        subscriberName: CREDITOR_POOL[Math.floor(rand() * CREDITOR_POOL.length)].name,
        enquiryReason: 'Credit application',
      })),
      publicRecords: rand() < 0.25
        ? [{
            recordType: 'Default judgment',
            recordDate: randomPastDate(rand, 3),
            amount: (Math.round(200000 + rand() * 4000000) / 100).toFixed(2),
            court: 'Magistrate Court',
            caseNumber: `${Math.floor(rand() * 90000) + 10000}/2${String(Math.floor(rand() * 5)).padStart(3, '0')}`,
          }]
        : [],
    };
  }

  normalise(raw) {
    return {
      reference: raw.enquiryReference ?? null,
      creditScore: raw.score?.value ?? null,
      scoreBand: raw.score?.band ?? null,
      accounts: (raw.accounts || []).map((row) => normaliseAccount({
        creditorName: row.subscriberName,
        accountNumber: row.accountNumber,
        accountType: row.accountType,
        status: row.accountStatus,
        openedDate: row.dateOpened,
        currentBalance: row.currentBalance,
        originalAmount: row.openingBalance,
        monthlyInstalment: row.instalmentAmount,
        arrearsAmount: row.overdueAmount,
        creditLimit: row.creditLimit,
        monthsInArrears: row.monthsInArrears,
        interestRate: row.interestRate,
        lastPaymentDate: row.lastPaymentDate,
        lastUpdated: row.lastUpdated,
      })),
      enquiries: (raw.enquiries || []).map((row) => ({
        date: row.enquiryDate,
        subscriber: row.subscriberName,
        reason: row.enquiryReason,
      })),
      publicRecords: (raw.publicRecords || []).map((row) => ({
        type: row.recordType,
        date: row.recordDate,
        amountCents: Math.round(Number(row.amount) * 100),
        court: row.court,
        caseNumber: row.caseNumber,
      })),
    };
  }
}

// Balances below are in cents. The mix reflects a typical South African
// over-indebted profile: a vehicle, a couple of store cards, and unsecured loans.
const CREDITOR_POOL = [
  { name: 'Absa Bank Ltd', type: 'Vehicle finance', balanceRange: [8000000, 32000000], instalmentFactor: 0.022, rateRange: [9.5, 15.5] },
  { name: 'Standard Bank', type: 'Credit card', balanceRange: [1500000, 8500000], instalmentFactor: 0.05, rateRange: [18, 24.5], revolving: true },
  { name: 'Nedbank', type: 'Personal loan', balanceRange: [2000000, 12000000], instalmentFactor: 0.045, rateRange: [17, 27.5] },
  { name: 'Capitec Bank', type: 'Personal loan', balanceRange: [1000000, 9000000], instalmentFactor: 0.05, rateRange: [16, 27.75] },
  { name: 'FNB', type: 'Overdraft', balanceRange: [500000, 4500000], instalmentFactor: 0.06, rateRange: [15, 22], revolving: true },
  { name: 'Truworths', type: 'Store card', balanceRange: [150000, 1800000], instalmentFactor: 0.09, rateRange: [20, 24.5], revolving: true },
  { name: 'Mr Price', type: 'Store card', balanceRange: [80000, 900000], instalmentFactor: 0.1, rateRange: [20, 24.5], revolving: true },
  { name: 'Edgars', type: 'Retail account', balanceRange: [100000, 1200000], instalmentFactor: 0.09, rateRange: [20, 24.5], revolving: true },
  { name: 'African Bank', type: 'Personal loan', balanceRange: [1500000, 11000000], instalmentFactor: 0.048, rateRange: [21, 27.75] },
  { name: 'Vodacom', type: 'Cellphone contract', balanceRange: [50000, 600000], instalmentFactor: 0.14, rateRange: [0, 0] },
  { name: 'MTN', type: 'Cellphone contract', balanceRange: [40000, 550000], instalmentFactor: 0.14, rateRange: [0, 0] },
  { name: 'Wonga', type: 'Short-term loan', balanceRange: [100000, 800000], instalmentFactor: 0.25, rateRange: [25, 60] },
  { name: 'SA Home Loans', type: 'Home loan', balanceRange: [45000000, 180000000], instalmentFactor: 0.011, rateRange: [10, 13.5] },
];

/** xorshift seeded from the ID number, so a client's simulated profile never changes. */
function seededRandom(seed) {
  let state = Number(BigInt(`0x${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8)}`)) || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xFFFFFFFF;
  };
}

function randomPastDate(rand, maxYearsAgo) {
  const daysAgo = Math.floor(rand() * maxYearsAgo * 365);
  const date = new Date(Date.now() - daysAgo * 86400000);
  return date.toISOString().slice(0, 10);
}
