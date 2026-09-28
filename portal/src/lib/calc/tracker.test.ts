import { describe, expect, it } from "vitest";
import {
  attackOrders,
  debtTotals,
  initials,
  loadBand,
  monthNumbers,
  otherNameProblem,
  parseAmount,
  payoff,
  simulatePlan,
  type Debt,
} from "./tracker";

const debt = (id: string, balance: number | null, rate: number | null, minimum: number | null, extra: Partial<Debt> = {}): Debt => ({
  id,
  type: "Credit card",
  label: id,
  balance,
  rate,
  minimum,
  status: "current",
  ...extra,
});

/** Standard loan formula: months to clear B at rate r a month paying P = ceil(−ln(1 − rB/P) ÷ ln(1 + r)). */
const closedFormMonths = (B: number, annual: number, P: number) => {
  const r = annual / 1200;
  return Math.ceil(-Math.log(1 - (r * B) / P) / Math.log(1 + r));
};

describe("true cost at the minimum (§7.1)", () => {
  it("zero interest: R1,000 at R100 a month is 10 months, no interest", () => {
    expect(payoff(1000, 0, 100)).toEqual({ months: 10, interest: 0 });
  });

  it("matches the standard loan formula", () => {
    for (const [B, rate, P] of [
      [1200, 12, 100],
      [10000, 24, 201],
      [48300, 19.5, 3600], // Capitec personal loan from the prototype
      [7500, 21, 450],
    ]) {
      const p = payoff(B, rate, P);
      if (!p || "never" in p) throw new Error("expected a payoff");
      const n = closedFormMonths(B, rate, P);
      expect(p.months).toBe(n);
      // Interest = everything paid − the balance; the last payment is partial.
      expect(p.interest).toBeGreaterThan((n - 1) * P - B);
      expect(p.interest).toBeLessThanOrEqual(n * P - B + 0.01);
    }
  });

  it("1 month at 1%: R1,000 paid with R2,000 → 1 month, R10 interest", () => {
    const p = payoff(1000, 12, 2000);
    expect(p).toEqual({ months: 1, interest: 10 });
  });

  it("never clears when the minimum ≤ balance × monthly rate", () => {
    // R10,000 at 24% a year: R200 interest a month.
    expect(payoff(10000, 24, 200)).toEqual({ never: true });
    expect(payoff(10000, 24, 150)).toEqual({ never: true });
    expect("never" in payoff(10000, 24, 201)!).toBe(false);
  });

  it("never estimates: any unknown figure → no answer", () => {
    expect(payoff(null, 20, 100)).toBeNull();
    expect(payoff(1000, null, 100)).toBeNull();
    expect(payoff(1000, 20, null)).toBeNull();
  });

  it("caps at 1,200 months", () => {
    // R100,000 at 12% (R1,000 interest a month). Loan formula: ln(P ÷ (P − 1,000)) ÷ ln(1.01) months.
    // Paying R1,000.01 → about 1,158 months (under the cap); R1,000.001 → about 1,389 (over it).
    expect(payoff(100000, 12, 1000.01)).toMatchObject({ months: closedFormMonths(100000, 12, 1000.01) });
    expect(closedFormMonths(100000, 12, 1000.001)).toBeGreaterThan(1200);
    expect(payoff(100000, 12, 1000.001)).toEqual({ never: true });
  });
});

describe("totals (§7.1, §7.2)", () => {
  it("adds balances and minimums, counting unknown figures as nothing, and counts unknowns", () => {
    const t = debtTotals([debt("a", 1000, 20, 100), debt("b", null, 20, 50), debt("c", 500, null, null, { status: "arrears" })]);
    expect(t.total).toBe(1500);
    expect(t.minimums).toBe(150);
    expect(t.unknown).toBe(2);
  });
  it("a debt with no lender name counts as unknown", () => {
    expect(debtTotals([debt("a", 1, 1, 1, { nameMissing: true })]).unknown).toBe(1);
  });
});

describe("my numbers (§7.3)", () => {
  const groups = { critical: 4000, important: 1000, reduce: 800, eliminate: 200 };
  it("debt load = minimums ÷ pay before deductions × 100 (the brief's example: R5,024 ÷ R16,000 = 31.4%)", () => {
    expect(monthNumbers(12000, 16000, groups, 5024).debtLoad).toBeCloseTo(31.4, 10);
  });
  it("gap this month and gap after cuts", () => {
    const n = monthNumbers(10000, 13000, groups, 3000);
    expect(n.gapNow).toBe(10000 - (4000 + 1000 + 800 + 200 + 3000)); // 1,000
    expect(n.gapAfterCuts).toBe(10000 - (4000 + 1000 + 3000)); // 2,000
  });
  it("missing pay → no answer", () => {
    const n = monthNumbers(null, null, groups, 3000);
    expect(n).toEqual({ debtLoad: null, gapNow: null, gapAfterCuts: null });
    expect(monthNumbers(1, 0, groups, 3000).debtLoad).toBeNull();
  });
  it("debt-load bands and messages", () => {
    expect(loadBand(52.6)).toMatchObject({ tone: "red", rung: 1, text: "Red Line 1: more than half your pay is promised to debt." });
    expect(loadBand(50)).toMatchObject({ rung: 2 });
    expect(loadBand(44.2)).toMatchObject({ rung: 2, text: "The book notes banks generally stop approving bonds around 40–45%." });
    expect(loadBand(40)).toMatchObject({ rung: 2 });
    expect(loadBand(38)).toMatchObject({ rung: 3, text: "Above the wealth-builder's target of 35%." });
    expect(loadBand(35)).toMatchObject({ rung: 3 }); // 35 is not "below 35%"
    expect(loadBand(34.9)).toMatchObject({ rung: 4, text: "Inside the target: below 35%." });
    expect(loadBand(31.4)).toMatchObject({ rung: 4 });
    expect(loadBand(25)).toMatchObject({ rung: 4 }); // 25 is not "below 25%"
    expect(loadBand(24.9)).toMatchObject({ rung: 5, text: "Below 25%: where the best opportunities open." });
    expect(loadBand(0)).toMatchObject({ rung: 5 });
    expect(loadBand(null)).toBeNull();
  });
});

describe("my attack (§7.4)", () => {
  const a = debt("store", 7500, 21, 450);
  const b = debt("card", 14800, 21.75, 974);
  const c = debt("loan", 48300, null, 3600);
  const paidOff = debt("done", 0, 30, 0);

  it("Avalanche: highest rate first, unknown rates last; Snowball: smallest balance first", () => {
    const o = attackOrders([c, a, b, paidOff]);
    expect(o.byRate.map((d) => d.id)).toEqual(["card", "store", "loan"]);
    expect(o.byBalance.map((d) => d.id)).toEqual(["store", "card", "loan"]);
    expect(o.lineUp).toBe(false);
  });
  it("they line up when both put the same debt first", () => {
    expect(attackOrders([debt("micro", 3100, 60, 1100), debt("wool", 14000, 18, 1600)]).lineUp).toBe(true);
  });

  it("full plan with no interest, worked by hand", () => {
    // Budget = 10 + 10 + extra 30 = 50 a month.
    // M1: mins → A 90, B 190; 30 left → A 60.   M2: A 50, B 180; → A 20.
    // M3: A 10, B 170; 30 left → A 0, then 20 → B 150.   M4: B 140; 40 left → B 100.
    // M5: B 90 → 50.   M6: B 40 → 0.  Six months, R300 paid = R50 × 6.
    const plan = simulatePlan([debt("A", 100, 0, 10), debt("B", 200, 0, 10)], 30);
    expect(plan).toEqual({ months: 6, interest: 0 });
  });
  it("one debt with extra matches the true-cost formula at minimum + extra", () => {
    const plan = simulatePlan([debt("x", 7500, 21, 450)], 150);
    expect(plan).toEqual(payoff(7500, 21, 600));
  });
  it("needs every rate and minimum", () => {
    expect(simulatePlan([a, c], 100)).toBeNull();
  });
  it("Avalanche never costs more interest than Snowball on the same budget", () => {
    const ds = [debt("s", 6200, 60, 2300), debt("m", 18900, 21.75, 1900), debt("l", 18100, 27.5, 1988)];
    const o = attackOrders(ds);
    const av = simulatePlan(o.byRate, 500)!;
    const sn = simulatePlan(o.byBalance, 500)!;
    if ("never" in av || "never" in sn) throw new Error("should clear");
    expect(av.interest).toBeLessThanOrEqual(sn.interest + 0.01);
  });
});

describe("'Other' lender names (§7.1)", () => {
  it("rejects short, number-only and generic names with the spec's message", () => {
    expect(otherNameProblem("ab")).not.toBeNull();
    expect(otherNameProblem("12345")).toBe("Use the lender's name, not a number.");
    expect(otherNameProblem("store")).toBe("'store' isn't a lender's name. Use the exact name on your statement or SMS.");
    for (const g of ["Loans", "credit card", "N/A", "unknown", "qwerty", "Store Account", "cash", "xxx"]) {
      expect(otherNameProblem(g)).not.toBeNull();
    }
  });
  it("accepts real-looking names", () => {
    for (const n of ["Ubuntu Lending Co", "Mr Dlamini", "ABC Furnishers", "Nkosi Cash Loans"]) {
      expect(otherNameProblem(n)).toBeNull();
    }
  });
});

describe("helpers", () => {
  it("monogram initials", () => {
    expect(initials("Standard Bank")).toBe("SB");
    expect(initials("Capitec")).toBe("CA");
    expect(initials("TFG (Foschini, Markham, Sportscene, Totalsports)")).toBe("TF");
    expect(initials("Mercedes-Benz Financial Services")).toBe("MB");
  });
  it("reads amounts the way people type them", () => {
    expect(parseAmount("R 12,500.50")).toBe(12500.5);
    expect(parseAmount("12 500")).toBe(12500);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});
