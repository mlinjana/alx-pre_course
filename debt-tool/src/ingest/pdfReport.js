import { PDFParse } from 'pdf-parse';
import { normaliseAccount } from '../bureaus/normalise.js';
import { parseRandsToCents } from '../lib/money.js';

/**
 * Extracts credit accounts from a bureau report PDF that a client has downloaded
 * themselves (every South African is entitled to one free report a year).
 *
 * A word on reliability: PDF layout parsing is inherently brittle. Bureaus change
 * their templates without notice, and a text-extraction pass loses the column
 * structure that makes a table readable. This module is therefore built to
 * *propose* rows for a consultant to confirm, never to commit silently — see the
 * review step in routes/ingest.js. Every row carries a confidence value and the
 * source line it came from, so a consultant can see what was read and correct it.
 */
export async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text ?? '', pageCount: result.pages?.length ?? 0 };
  } finally {
    await parser.destroy();
  }
}

/** Guesses which bureau produced a report from its text. */
export function detectBureau(text) {
  const sample = String(text).slice(0, 8000).toLowerCase();
  if (/transunion|trans union/.test(sample)) return 'transunion';
  if (/experian/.test(sample)) return 'experian';
  if (/\bxds\b|xpert decision/.test(sample)) return 'xds';
  if (/compuscan|\bcpb\b/.test(sample)) return 'compuscan';
  return 'unknown';
}

/**
 * Parses an already-extracted report. Split from extractTextFromPdf so the
 * parsing logic is testable against text fixtures without needing real PDFs.
 */
export function parseReportText(text) {
  const bureau = detectBureau(text);
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const accounts = [];
  const seen = new Set();

  for (const line of lines) {
    const parsed = parseAccountLine(line);
    if (!parsed) continue;
    // The same account often appears in both a summary and a detail section.
    const key = `${parsed.account.creditorNormalised}|${parsed.account.currentBalanceCents}|${parsed.account.accountNumberMasked ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(parsed);
  }

  return {
    bureau,
    creditScore: extractScore(text),
    accountCount: accounts.length,
    accounts,
    // Surfaced in the review screen so a consultant can tell "nothing found"
    // from "found nothing worth showing".
    linesScanned: lines.length,
  };
}

/**
 * Reads one line of a report table into a candidate account.
 *
 * Bureau PDFs flatten to lines that look roughly like:
 *   "ABSA BANK  Vehicle Finance  1234567890  2019/03/15  R 189 450.22  R 4 210.00  R 8 420.00  2"
 * Column order varies, so the strategy is: find the creditor at the start, pull
 * every money-shaped token, and assign them by position and magnitude.
 */
export function parseAccountLine(line) {
  if (line.length < 15 || line.length > 400) return null;

  // Skip obvious headers, totals and page furniture.
  if (/^(page|total|summary|account type|creditor|subscriber|balance|generated|report|date of|consumer|name|surname|id number)\b/i.test(line)) {
    return null;
  }

  const amounts = [...line.matchAll(/R?\s?\d{1,3}(?:[ ,.]\d{3})*(?:[.,]\d{2})\b/g)]
    .map((m) => ({ raw: m[0], cents: parseRandsToCents(m[0]), index: m.index }))
    .filter((a) => a.cents !== null && a.cents >= 0);

  // A real account row carries at least a balance and one other figure.
  if (amounts.length < 2) return null;

  const creditorMatch = line.match(/^([A-Za-z][A-Za-z0-9&'’.\- ]{2,40}?)(?=\s{1,}(?:[A-Z][a-z]|\d|R\s?\d))/);
  const creditorName = (creditorMatch?.[1] ?? line.slice(0, 30)).trim();
  if (!/[A-Za-z]{3}/.test(creditorName)) return null;

  const accountNumberMatch = line.match(/\b(\d{8,20})\b/);
  const dateMatch = line.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/);

  // The largest amount on the row is almost always the outstanding balance;
  // the smallest is almost always the monthly instalment. Arrears, when present,
  // sits between them. This heuristic is why a human confirms the result.
  const sorted = [...amounts].sort((a, b) => b.cents - a.cents);
  const balance = sorted[0];
  const instalment = sorted[sorted.length - 1];
  const arrears = sorted.length >= 3 ? sorted[1] : null;

  const typeMatch = line.match(/\b(home\s*loan|mortgage|bond|vehicle\s*finance|instal?ment\s*sale|credit\s*card|store\s*card|retail|personal\s*loan|revolving|overdraft|student\s*loan|cell(?:phone)?|telecom|short[\s-]*term|micro\s*loan|insurance|municipal)\b/i);
  const statusMatch = line.match(/\b(written\s*off|handed\s*over|legal|closed|settled|paid\s*up|up\s*to\s*date|in\s*arrears|current|active|open|debt\s*review)\b/i);
  const monthsMatch = line.match(/\b(\d{1,2})\s*(?:months?\s*)?(?:in\s*)?arrears\b/i);

  const account = normaliseAccount({
    creditorName,
    accountNumber: accountNumberMatch?.[1] ?? null,
    accountType: typeMatch?.[1] ?? null,
    status: statusMatch?.[1] ?? null,
    openedDate: dateMatch?.[1] ?? null,
    currentBalance: balance.raw,
    monthlyInstalment: instalment === balance ? null : instalment.raw,
    arrearsAmount: arrears?.raw ?? null,
    monthsInArrears: monthsMatch?.[1] ?? 0,
  });

  return {
    account,
    confidence: scoreConfidence({ amounts, typeMatch, accountNumberMatch, dateMatch, creditorName }),
    sourceLine: line,
  };
}

/**
 * How much of the row we actually recognised, 0–1. Shown in the review screen so
 * a consultant knows which rows to check first rather than reading all of them.
 */
function scoreConfidence({ amounts, typeMatch, accountNumberMatch, dateMatch, creditorName }) {
  let score = 0.3;
  if (amounts.length >= 3) score += 0.2;
  if (typeMatch) score += 0.2;
  if (accountNumberMatch) score += 0.15;
  if (dateMatch) score += 0.1;
  if (creditorName.length >= 5 && creditorName.length <= 30) score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}

function extractScore(text) {
  const patterns = [
    /credit\s*score[^0-9]{0,20}(\d{3})\b/i,
    /score[:\s]{1,5}(\d{3})\b/i,
    /\b(\d{3})\s*(?:out of|\/)\s*(?:999|850)\b/i,
  ];
  for (const pattern of patterns) {
    const match = String(text).match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (value >= 300 && value <= 999) return value;
    }
  }
  return null;
}

/** Convenience wrapper: buffer in, review-ready parse out. */
export async function parseReportPdf(buffer) {
  const { text, pageCount } = await extractTextFromPdf(buffer);
  return { ...parseReportText(text), pageCount };
}
