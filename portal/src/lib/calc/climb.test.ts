import { describe, expect, it } from "vitest";
import { climbScore, isPayday, lastPayday, movement, ordinal, paydayDue, rungOf, stageChecks, stageOf, type StageInput } from "./climb";

const base: StageInput = { gapAfterCuts: 500, newCredit: false, borrowing: false, totalDebt: 20000, efMonths: 0, assetIncome: 0 };

describe("stage (§8)", () => {
  it("stage 1 until pay covers essentials and minimums, with no new credit and no borrowing", () => {
    expect(stageOf({ ...base, gapAfterCuts: -1 })).toBe(1);
    expect(stageOf({ ...base, newCredit: true })).toBe(1);
    expect(stageOf({ ...base, borrowing: true })).toBe(1);
    expect(stageOf({ ...base, gapAfterCuts: 0 })).toBe(2); // ≥ 0 counts
  });
  it("stage 3 needs total debt 0 AND 3 months of emergency fund", () => {
    expect(stageOf({ ...base, totalDebt: 0, efMonths: 2 })).toBe(2);
    expect(stageOf({ ...base, totalDebt: 1, efMonths: 6 })).toBe(2);
    expect(stageOf({ ...base, totalDebt: 0, efMonths: 3 })).toBe(3);
  });
  it("stage 4 needs asset income; stage 5 can't be reached yet", () => {
    expect(stageOf({ ...base, totalDebt: 0, efMonths: 3, assetIncome: 1 })).toBe(4);
    expect(stageOf({ ...base, totalDebt: 0, efMonths: 6, assetIncome: 1_000_000 })).toBe(4);
  });
  it("stages are worked out every month, so they can go down", () => {
    // A stage 3 client who takes new credit this month is back in stage 1.
    expect(stageOf({ ...base, totalDebt: 0, efMonths: 3, newCredit: true })).toBe(1);
  });
  it("asset income without stage 2 and 3 doesn't skip stages", () => {
    expect(stageOf({ ...base, assetIncome: 5000 })).toBe(2);
  });
  it("no stage without the gap after cuts", () => {
    expect(stageOf({ ...base, gapAfterCuts: null })).toBeNull();
  });
  it("next-stage checklist ticks what's already true", () => {
    const c = stageChecks({ ...base, gapAfterCuts: -10, newCredit: false, borrowing: true });
    expect(c[1].map((x) => x.ok)).toEqual([false, true, false]);
    expect(c[4][0].ok).toBe(false);
  });
});

describe("rungs and Climb score (§8)", () => {
  it("rungs from debt load", () => {
    expect([60, 50, 45, 40, 39.9, 35, 34.9, 25, 24.9, 0].map(rungOf)).toEqual([1, 2, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(rungOf(null)).toBeNull();
  });
  it("Climb score runs from 100 to 988", () => {
    expect(climbScore(1, 1)).toBe(100);
    expect(climbScore(5, 5)).toBe(988);
    expect(climbScore(2, 3)).toBe(100 + (5 + 2) * 37); // 359
    expect(climbScore(1, 5)).toBe(248);
    expect(climbScore(2, 1)).toBe(285); // next rung up after (1, 5)
  });
});

describe("movement messages (§8)", () => {
  it("up a stage", () => {
    expect(movement({ stage: 2, rung: 1 }, { stage: 1, rung: 5 })).toEqual({
      kind: "upStage",
      scoreChange: 37,
      text: "New stage: Stability. You earned this.",
    });
  });
  it("down a stage, kindly", () => {
    expect(movement({ stage: 1, rung: 4 }, { stage: 2, rung: 4 })?.text).toBe(
      "Your numbers moved you back to Survival this month. That's information, not a verdict. Your coach will help you find what changed.",
    );
  });
  it("rungs and holding steady", () => {
    expect(movement({ stage: 2, rung: 4 }, { stage: 2, rung: 3 })?.text).toBe("You moved up a rung this month. Keep going.");
    expect(movement({ stage: 2, rung: 3 }, { stage: 2, rung: 4 })?.text).toBe(
      "Down a rung this month. Hard months happen on every climb. Let's look at it together.",
    );
    expect(movement({ stage: 2, rung: 3 }, { stage: 2, rung: 3 })).toMatchObject({ kind: "same", scoreChange: 0, text: "Holding steady. Consistency is how the climb works." });
  });
  it("no message in the first month", () => {
    expect(movement({ stage: 1, rung: 1 }, null)).toBeNull();
  });
});

describe("payday check-in (§8)", () => {
  it("most recent payday on or before today", () => {
    expect(lastPayday(25, "2026-09-28")).toBe("2026-09-25");
    expect(lastPayday(25, "2026-09-25")).toBe("2026-09-25");
    expect(lastPayday(25, "2026-09-24")).toBe("2026-08-25");
    expect(lastPayday(25, "2026-01-10")).toBe("2025-12-25");
  });
  it("paydays beyond the month's end fall on its last day", () => {
    expect(lastPayday(31, "2026-04-30")).toBe("2026-04-30");
    expect(lastPayday(31, "2026-03-15")).toBe("2026-02-28");
    expect(lastPayday(30, "2028-02-29")).toBe("2028-02-29"); // leap year
  });
  it("due when the last update is before the last payday", () => {
    expect(paydayDue("2026-09-20", 25, "2026-09-28")).toBe(true);
    expect(paydayDue("2026-09-25", 25, "2026-09-28")).toBe(false);
    expect(paydayDue(null, 25, "2026-09-28")).toBe(true);
    expect(paydayDue("2026-09-20", 25, "2026-09-24")).toBe(false); // August payday already covered
  });
  it("knows when today is payday", () => {
    expect(isPayday(25, "2026-09-25")).toBe(true);
    expect(isPayday(31, "2026-09-30")).toBe(true);
    expect(isPayday(25, "2026-09-26")).toBe(false);
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "25th", "31st"]);
  });
});
