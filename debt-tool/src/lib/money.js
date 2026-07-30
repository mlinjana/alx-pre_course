/**
 * Money helpers. Everything inside the application is integer cents; rands only
 * appear at the edges (form input and rendered output).
 */

const zar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const zarCompact = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats integer cents as "R12 345,67". */
export function formatCents(cents, { compact = false } = {}) {
  const value = Number(cents || 0) / 100;
  return (compact ? zarCompact : zar).format(value);
}

/**
 * Parses a user-entered or bureau-supplied rand amount into integer cents.
 * Handles "R 12 345.67", "12,345.67", "12 345,67" and bare numbers.
 * Returns null for anything it cannot read, so callers can tell "zero" from "absent".
 */
export function parseRandsToCents(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }

  let text = String(input).trim();
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  text = text.replace(/[()]/g, '').replace(/^-/, '');
  text = text.replace(/[R\s ]/gi, '');
  if (!text) return null;

  // Work out which separator is the decimal point. South African statements mix
  // both conventions, so decide by position rather than assuming one.
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let decimalSep = null;
  if (lastComma > -1 && lastDot > -1) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator only when it is followed by 1-2 digits.
    decimalSep = /,\d{1,2}$/.test(text) ? ',' : null;
  } else if (lastDot > -1) {
    decimalSep = /\.\d{1,2}$/.test(text) ? '.' : null;
  }

  let normalised;
  if (decimalSep) {
    const idx = text.lastIndexOf(decimalSep);
    const whole = text.slice(0, idx).replace(/[.,]/g, '');
    const frac = text.slice(idx + 1).replace(/[.,]/g, '');
    normalised = `${whole || '0'}.${frac}`;
  } else {
    normalised = text.replace(/[.,]/g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  const cents = Math.round(Number(normalised) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Sums a list of objects by a cents-valued key, tolerating nulls. */
export function sumCents(items, key) {
  return items.reduce((total, item) => total + Number(item?.[key] || 0), 0);
}

/** Percentage of a of b, guarding against division by zero. Returns null when undefined. */
export function ratio(a, b) {
  const denominator = Number(b || 0);
  if (denominator === 0) return null;
  return Number(a || 0) / denominator;
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}
