import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseAccountType, normaliseStatus, normaliseCreditor,
  normaliseDate, normaliseRate, maskAccountNumber, normaliseAccount, scoreBand,
} from '../src/bureaus/normalise.js';

test('account types map from the descriptions bureaus actually send', () => {
  assert.equal(normaliseAccountType('Vehicle Finance'), 'vehicle_finance');
  assert.equal(normaliseAccountType('Instalment Sale Agreement'), 'vehicle_finance');
  assert.equal(normaliseAccountType('Home Loan'), 'home_loan');
  assert.equal(normaliseAccountType('Mortgage Bond'), 'home_loan');
  assert.equal(normaliseAccountType('Credit Card'), 'credit_card');
  assert.equal(normaliseAccountType('Clothing Account'), 'store_card');
  assert.equal(normaliseAccountType('Cellphone Contract'), 'telecom');
  assert.equal(normaliseAccountType('Payday Loan'), 'short_term_loan');
  assert.equal(normaliseAccountType('Something Unheard Of'), 'other');
  assert.equal(normaliseAccountType(''), 'other');
});

test('"revolving credit" is not swallowed by the credit-card pattern', () => {
  // Ordering bug bait: both patterns contain "credit".
  assert.equal(normaliseAccountType('Revolving Credit Plan'), 'revolving_credit');
});

test('statuses map onto the canonical set', () => {
  assert.equal(normaliseStatus('Written Off'), 'written_off');
  assert.equal(normaliseStatus('Handed over to attorneys'), 'legal');
  assert.equal(normaliseStatus('Under Debt Review'), 'under_debt_review');
  assert.equal(normaliseStatus('Paid Up'), 'closed');
  assert.equal(normaliseStatus('Up to date'), 'open');
  assert.equal(normaliseStatus('???'), 'unknown');
});

test('the same creditor written differently groups together', () => {
  assert.equal(normaliseCreditor('ABSA BANK LTD'), normaliseCreditor('Absa Bank Limited'));
  assert.equal(normaliseCreditor('Capitec Bank (Pty) Ltd'), normaliseCreditor('CAPITEC BANK'));
  assert.equal(normaliseCreditor(''), 'unknown');
});

test('dates are read day-first, as South African bureaus write them', () => {
  assert.equal(normaliseDate('2019-03-15'), '2019-03-15');
  assert.equal(normaliseDate('2019/03/15'), '2019-03-15');
  assert.equal(normaliseDate('15/03/2019'), '2019-03-15');
  assert.equal(normaliseDate('20190315'), '2019-03-15');
  assert.equal(normaliseDate('2019-03'), '2019-03-01');
  assert.equal(normaliseDate(''), null);
});

test('an ambiguous date resolves day-first, not month-first', () => {
  // 03/04/2019 is 3 April here, not 4 March. Getting this backwards shifts an
  // account-opened date by a month and quietly changes an amortisation.
  assert.equal(normaliseDate('03/04/2019'), '2019-04-03');
});

test('rates are read as fractions whether quoted as percent or decimal', () => {
  assert.equal(normaliseRate('23.5'), 0.235);
  assert.equal(normaliseRate('23,5%'), 0.235);
  assert.equal(normaliseRate(0.235), 0.235);
  assert.equal(normaliseRate(''), null);
  assert.equal(normaliseRate('abc'), null);
});

test('account numbers are masked to their last four digits', () => {
  assert.equal(maskAccountNumber('1234567890'), '••••7890');
  assert.equal(maskAccountNumber('12'), '••••12');
  assert.equal(maskAccountNumber(''), null);
});

test('normaliseAccount produces a full canonical row from loose input', () => {
  const account = normaliseAccount({
    subscriberName: 'ABSA BANK LTD',
    accountNumber: '9876543210',
    accountType: 'Vehicle Finance',
    accountStatus: 'Open - in arrears',
    dateOpened: '15/03/2019',
    currentBalance: 'R 189 450.22',
    instalmentAmount: 'R 4 210.00',
    overdueAmount: 'R 8 420.00',
    monthsInArrears: '2',
    interestRate: '11.5',
  });

  assert.equal(account.creditorName, 'ABSA BANK LTD');
  assert.equal(account.accountType, 'vehicle_finance');
  assert.equal(account.status, 'open');
  assert.equal(account.openedDate, '2019-03-15');
  assert.equal(account.currentBalanceCents, 18945022);
  assert.equal(account.monthlyInstalmentCents, 421000);
  assert.equal(account.arrearsAmountCents, 842000);
  assert.equal(account.monthsInArrears, 2);
  assert.equal(account.interestRateAnnual, 0.115);
  assert.equal(account.accountNumberMasked, '••••3210');
});

test('normaliseAccount defaults missing money to zero, not null', () => {
  // The aggregation layer sums these; a null would poison every total.
  const account = normaliseAccount({ creditorName: 'X' });
  assert.equal(account.currentBalanceCents, 0);
  assert.equal(account.monthlyInstalmentCents, 0);
  assert.equal(account.arrearsAmountCents, 0);
  assert.equal(account.monthsInArrears, 0);
});

test('score bands follow the ranges consultants quote', () => {
  assert.equal(scoreBand(800), 'Excellent');
  assert.equal(scoreBand(700), 'Good');
  assert.equal(scoreBand(600), 'Average');
  assert.equal(scoreBand(500), 'High risk');
  assert.equal(scoreBand(null), null);
});
