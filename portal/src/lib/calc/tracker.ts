// Debt Ladder Tracker calculations (PORTAL_SPEC.md §7). Pure functions, no I/O.
// Every formula here has unit tests in tracker.test.ts.

export type DebtStatus = "current" | "arrears" | "attorneys" | "review";

export type Debt = {
  id: string;
  type: string;
  label: string; // "FNB · Credit card"
  balance: number | null; // R, null = UNKNOWN
  rate: number | null; // % a year, null = UNKNOWN
  minimum: number | null; // R a month, null = UNKNOWN
  status: DebtStatus;
  nameMissing?: boolean; // who it's with is not known yet
};

export type Groups = { critical: number; important: number; reduce: number; eliminate: number };

export type Payoff = { months: number; interest: number } | { never: true };

export const MAX_MONTHS = 1200;
const EPS = 0.005; // half a cent

/**
 * True cost at a fixed monthly payment (§7.1).
 * r = rate ÷ 100 ÷ 12. Each month: interest = balance × r; balance = balance + interest − payment.
 * Never clears when payment ≤ balance × r. Capped at 1,200 months.
 * Returns null when any figure is unknown: we never estimate.
 */
export function payoff(balance: number | null, rate: number | null, payment: number | null): Payoff | null {
  if (balance === null || rate === null || payment === null) return null;
  if (balance <= 0) return { months: 0, interest: 0 };
  if (payment <= 0) return { never: true };
  const r = rate / 100 / 12;
  if (payment <= balance * r) return { never: true };
  let b = balance;
  let months = 0;
  let interest = 0;
  while (b > EPS && months < MAX_MONTHS) {
    const i = b * r;
    interest += i;
    b = b + i - payment;
    months++;
  }
  if (b > EPS) return { never: true };
  return { months, interest };
}

export function isUnknown(d: Debt): boolean {
  return d.balance === null || d.rate === null || d.minimum === null || Boolean(d.nameMissing);
}

export function debtTotals(debts: Debt[]) {
  const total = debts.reduce((a, d) => a + (d.balance ?? 0), 0);
  const minimums = debts.reduce((a, d) => a + (d.minimum ?? 0), 0); // includes accounts not being paid (§7.2)
  const unknown = debts.filter(isUnknown).length;
  return { total, minimums, unknown };
}

/** §7.3 formulas. Null when the pay figure they need is missing. */
export function monthNumbers(takeHome: number | null, gross: number | null, g: Groups, minimums: number) {
  const debtLoad = gross !== null && gross > 0 ? (minimums / gross) * 100 : null;
  const gapNow = takeHome === null ? null : takeHome - (g.critical + g.important + g.reduce + g.eliminate + minimums);
  const gapAfterCuts = takeHome === null ? null : takeHome - (g.critical + g.important + minimums);
  return { debtLoad, gapNow, gapAfterCuts };
}

export type Band = { tone: "red" | "amber" | "green"; text: string; rung: 1 | 2 | 3 | 4 | 5 };

/**
 * Debt-load bands (§7.3) and the rung they give (§8). Boundaries follow the prototype:
 * above 50 · 40–50 · above 35 to below 40 · above 25 to 35 · 25 and below.
 */
export function loadBand(load: number | null): Band | null {
  if (load === null) return null;
  if (load > 50) return { tone: "red", rung: 1, text: "Red Line 1: more than half your pay is promised to debt." };
  if (load >= 40) return { tone: "amber", rung: 2, text: "The book notes banks generally stop approving bonds around 40–45%." };
  if (load > 35) return { tone: "amber", rung: 3, text: "Above the wealth-builder's target of 35%." };
  if (load > 25) return { tone: "green", rung: 4, text: "Inside the target: below 35%." };
  return { tone: "green", rung: 5, text: "Below 25%: where the best opportunities open." };
}

export const MATHS_BROKEN =
  "Even after cutting Reduce and Eliminate, your pay can't cover essentials plus minimum payments. Chapter 5 says this is the sign to speak to an NCR-registered debt counsellor. Your MFG coach can help you prepare for that conversation.";

/** Avalanche: highest rate first, unknown rates last. Snowball: smallest balance first (§7.4). */
export function attackOrders(debts: Debt[]) {
  const live = debts.filter((d) => (d.balance ?? 0) > 0);
  const byRate = [...live].sort((a, b) => {
    if (a.rate === null && b.rate === null) return 0;
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    return b.rate - a.rate;
  });
  const byBalance = [...live].sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0));
  const lineUp = byRate.length > 0 && byRate[0].id === byBalance[0].id;
  return { byRate, byBalance, lineUp };
}

/**
 * Full plan (§7.4). Budget = all minimums + extra. Each month: add interest to every debt,
 * pay each minimum (never more than its balance), then send what's left to debts in order.
 * Null unless every rate and minimum is known.
 */
export function simulatePlan(order: Debt[], extra: number): Payoff | null {
  if (order.length === 0) return { months: 0, interest: 0 };
  if (order.some((d) => d.balance === null || d.rate === null || d.minimum === null)) return null;
  const ds = order.map((d) => ({ b: d.balance!, r: d.rate! / 100 / 12, m: d.minimum! }));
  const budget = ds.reduce((a, d) => a + d.m, 0) + Math.max(0, extra);
  let months = 0;
  let interest = 0;
  while (ds.some((d) => d.b > EPS)) {
    if (months >= MAX_MONTHS) return { never: true };
    for (const d of ds) {
      if (d.b > EPS) {
        const i = d.b * d.r;
        interest += i;
        d.b += i;
      }
    }
    let left = budget;
    for (const d of ds) {
      if (d.b > EPS) {
        const p = Math.min(d.m, d.b);
        d.b -= p;
        left -= p;
      }
    }
    for (const d of ds) {
      if (left <= 0) break;
      if (d.b > EPS) {
        const p = Math.min(left, d.b);
        d.b -= p;
        left -= p;
      }
    }
    months++;
  }
  return { months, interest };
}

// -------------------------------------------------------------- "Other" lender names (§7.1)

const GENERIC = new Set([
  "loan", "loans", "bank", "banks", "card", "credit", "credit card", "store", "shop", "account",
  "store account", "debt", "unknown", "n/a", "na", "none", "other", "test", "asdf", "qwerty",
  "money", "lender", "company", "cash",
]);

/** Null when the name is acceptable; otherwise the message to show. */
export function otherNameProblem(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (t.length < 3) return "Type the lender's name exactly as it appears on your statement.";
  if (!/\p{L}/u.test(t)) return "Use the lender's name, not a number.";
  if (GENERIC.has(t.toLowerCase().replace(/\s+/g, " ")) || /^x+$/i.test(t)) {
    return `'${t}' isn't a lender's name. Use the exact name on your statement or SMS.`;
  }
  return null;
}

/** Tile badge: initials in gold on navy. "Standard Bank" → "SB", "Capitec" → "CA". */
export function initials(name: string): string {
  const w = name.replace(/\(.*\)/, "").split(/[\s-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)).toUpperCase();
}

/** "R 12,500.50" / "12 500" → 12500.5. Empty or unreadable → null (UNKNOWN). */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/[^\d.]/g, "");
  if (!t || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
