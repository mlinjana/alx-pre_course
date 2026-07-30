import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountLine, parseReportText, detectBureau } from '../src/ingest/pdfReport.js';

test('a typical flattened report row is read into an account', () => {
  const line = 'ABSA BANK LTD Vehicle Finance 1234567890 2019/03/15 R 189 450.22 R 4 210.00 R 8 420.00';
  const parsed = parseAccountLine(line);

  assert.ok(parsed, 'the row should be recognised');
  assert.match(parsed.account.creditorName, /ABSA/);
  assert.equal(parsed.account.accountType, 'vehicle_finance');
  assert.equal(parsed.account.currentBalanceCents, 18945022);
  assert.equal(parsed.account.monthlyInstalmentCents, 421000);
  assert.equal(parsed.account.arrearsAmountCents, 842000);
  assert.equal(parsed.account.openedDate, '2019-03-15');
  assert.ok(parsed.confidence > 0.6);
});

test('the largest figure on a row is treated as the balance', () => {
  const parsed = parseAccountLine('Capitec Bank Personal Loan 5566778899 R 850.00 R 45 200.00');
  assert.equal(parsed.account.currentBalanceCents, 4520000);
  assert.equal(parsed.account.monthlyInstalmentCents, 85000);
});

test('headers, totals and page furniture are skipped', () => {
  assert.equal(parseAccountLine('Page 3 of 12'), null);
  assert.equal(parseAccountLine('Total outstanding R 245 000.00 R 12 000.00'), null);
  assert.equal(parseAccountLine('Creditor Account Type Balance Instalment'), null);
  assert.equal(parseAccountLine('short'), null);
});

test('a row with only one figure is not treated as an account', () => {
  // One number is more likely a summary line than a tradeline; guessing here
  // would put invented accounts in front of a consultant to approve.
  assert.equal(parseAccountLine('Number of accounts 8'), null);
});

test('low-confidence rows are still returned, but flagged as such', () => {
  const parsed = parseAccountLine('Somebank 15000.00 500.00');
  assert.ok(parsed);
  assert.ok(parsed.confidence < 0.7, 'a sparse row should not read as high confidence');
  assert.equal(parsed.sourceLine, 'Somebank 15000.00 500.00');
});

test('each parsed row carries the text it came from', () => {
  // The review screen shows this so a consultant can check the reading.
  const line = 'Truworths Store Card 9988776655 2021/06/01 R 4 200.50 R 380.00 R 760.00';
  assert.equal(parseAccountLine(line).sourceLine, line);
});

test('a whole report is parsed and duplicate rows collapse', () => {
  const text = [
    'TransUnion Consumer Credit Report',
    'Credit Score: 612',
    'Creditor Account Type Balance Instalment Arrears',
    'ABSA BANK LTD Vehicle Finance 1234567890 2019/03/15 R 189 450.22 R 4 210.00 R 8 420.00',
    'Capitec Bank Personal Loan 5566778899 2022/01/10 R 45 200.00 R 2 100.00 R 0.00',
    'ABSA BANK LTD Vehicle Finance 1234567890 2019/03/15 R 189 450.22 R 4 210.00 R 8 420.00',
    'Page 2 of 4',
  ].join('\n');

  const report = parseReportText(text);
  assert.equal(report.bureau, 'transunion');
  assert.equal(report.creditScore, 612);
  assert.equal(report.accountCount, 2, 'the repeated row should appear once');
});

test('the bureau is identified from the report text', () => {
  assert.equal(detectBureau('TransUnion Consumer Report'), 'transunion');
  assert.equal(detectBureau('Experian South Africa'), 'experian');
  assert.equal(detectBureau('XDS Consumer Credit Report'), 'xds');
  assert.equal(detectBureau('Some other document'), 'unknown');
});

test('a report with no readable rows returns zero rather than throwing', () => {
  const report = parseReportText('This document contains no tabular account data at all.');
  assert.equal(report.accountCount, 0);
  assert.deepEqual(report.accounts, []);
});
