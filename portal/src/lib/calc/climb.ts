// Client dashboard rules (PORTAL_SPEC.md §8): stage, rung, Climb score, movement, payday.
import { STAGES } from "@/lib/domain/constants";
import { loadBand } from "./tracker";

export type StageInput = {
  gapAfterCuts: number | null; // from the Tracker's month
  newCredit: boolean;
  borrowing: boolean;
  totalDebt: number;
  efMonths: number; // 0, 0.5, 1, 2, 3, 4, 6
  assetIncome: number;
};

export type Check = { text: string; ok: boolean };

/**
 * Stage from this month's numbers, recalculated every month, up or down:
 * 1 → 2: gap after cuts ≥ 0 AND no new credit this month AND not borrowing to pay debts
 * 2 → 3: all bad debt paid off (total debt = 0) AND emergency fund ≥ 3 months
 * 3 → 4: something they own pays them every month (asset income > 0)
 * 4 → 5: not reachable yet (the fields come later).
 * Null when the gap after cuts isn't known: we don't guess a stage.
 */
export function stageOf(x: StageInput): 1 | 2 | 3 | 4 | null {
  if (x.gapAfterCuts === null) return null;
  const checks = stageChecks(x);
  if (!checks[1].every((c) => c.ok)) return 1;
  if (!checks[2].every((c) => c.ok)) return 2;
  if (!checks[3].every((c) => c.ok)) return 3;
  return 4;
}

/** What each stage needs to move to the next one (the "next-stage checklist"). */
export function stageChecks(x: StageInput): Record<1 | 2 | 3 | 4, Check[]> {
  return {
    1: [
      { text: "Pay covers essentials plus minimum payments", ok: x.gapAfterCuts !== null && x.gapAfterCuts >= 0 },
      { text: "No new credit this month", ok: !x.newCredit },
      { text: "Not borrowing to pay debts", ok: !x.borrowing },
    ],
    2: [
      { text: "All bad debt paid off", ok: x.totalDebt === 0 },
      { text: "Emergency fund: 3 months of essentials", ok: x.efMonths >= 3 },
    ],
    3: [{ text: "Something you own pays you every month", ok: x.assetIncome > 0 }],
    4: [{ text: "What you own pays for how you live", ok: false }],
  };
}

/** Rung 1–5 from debt load (§8). Null when pay before deductions is missing. */
export function rungOf(debtLoad: number | null): 1 | 2 | 3 | 4 | 5 | null {
  return loadBand(debtLoad)?.rung ?? null;
}

/** Climb score = 100 + ((stage − 1) × 5 + (rung − 1)) × 37. From 100 to 988. */
export function climbScore(stage: number, rung: number): number {
  return 100 + ((stage - 1) * 5 + (rung - 1)) * 37;
}

export type Position = { stage: number; rung: number };
export type Movement = { kind: "upStage" | "downStage" | "up" | "down" | "same"; text: string; scoreChange: number };

/** Honest movement every month, with kind words (§8). */
export function movement(now: Position, prev: Position | null): Movement | null {
  if (!prev) return null;
  const scoreChange = climbScore(now.stage, now.rung) - climbScore(prev.stage, prev.rung);
  const name = STAGES[now.stage - 1].name;
  if (now.stage > prev.stage) return { kind: "upStage", scoreChange, text: `New stage: ${name}. You earned this.` };
  if (now.stage < prev.stage)
    return {
      kind: "downStage",
      scoreChange,
      text: `Your numbers moved you back to ${name} this month. That's information, not a verdict. Your coach will help you find what changed.`,
    };
  if (now.rung > prev.rung) return { kind: "up", scoreChange, text: "You moved up a rung this month. Keep going." };
  if (now.rung < prev.rung) return { kind: "down", scoreChange, text: "Down a rung this month. Hard months happen on every climb. Let's look at it together." };
  return { kind: "same", scoreChange, text: "Holding steady. Consistency is how the climb works." };
}

// ------------------------------------------------------------------ payday

/** Today's date in South Africa as YYYY-MM-DD. */
export function saDate(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1–12

/**
 * The most recent payday on or before today. A payday of 31 falls on the last day of
 * shorter months (30 April, 28 or 29 February).
 */
export function lastPayday(payday: number, today: string): string {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const inMonth = (yy: number, mm: number) => Math.min(payday, daysIn(yy, mm));
  if (inMonth(y, m) > d) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(inMonth(y, m)).padStart(2, "0")}`;
}

/** True when the last update was before the most recent payday (or there's been none). */
export function paydayDue(lastUpdate: string | null, payday: number, today: string): boolean {
  return !lastUpdate || lastUpdate < lastPayday(payday, today);
}

export function isPayday(payday: number, today: string): boolean {
  return lastPayday(payday, today) === today;
}

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th"}`;
}

// ------------------------------------------------------------------ programme (§9.1)

export const WEEKS: { title: string; rung: string; gate: string }[] = [
  { title: "The kitchen table", rung: "Rung 1", gate: "Every creditor listed; each unknown has a plan to get the figure" },
  { title: "The whole picture", rung: "Rung 1", gate: "Shortfall, debt load, Red Lines, stage and gap type recorded" },
  { title: "The true cost", rung: "Rung 2", gate: "Every debt has a known rate (or a plan to get it); most expensive named" },
  { title: "No new bad debt", rung: "Rung 3", gate: "No new credit since Week 4; Eliminate list cancelled; separate account open" },
  { title: "The anchor decision", rung: "Rung 3", gate: "A dated decision, or a written reason for keeping the asset" },
  { title: "Choose your attack", rung: "Rung 4", gate: "Target #1 named; first extra payment made or dated; chart up" },
  { title: "Find more money", rung: "Rung 5", gate: "Fire-power figure written; first transfer made" },
  { title: "Phone before they phone", rung: "Negotiate", gate: "At least one call made or booked; arrangements in writing" },
  { title: "Settlements", rung: "Negotiate", gate: "Settlement record filled for one account, or \"none qualify\" noted" },
  { title: "The invisible middle", rung: "Hold the line", gate: "Bad-month plan written; chart updated twice since Week 6" },
  { title: "Protect the climb", rung: "Hold the line", gate: "Emergency fund (Pot 1) opened with a first deposit; credit report reviewed" },
  { title: "Graduation", rung: "Hold the line", gate: "Graduation criteria met; 90-day plan written" },
];

export const EF_OPTIONS: [number, string][] = [
  [0, "None yet"],
  [0.5, "Less than a month"],
  [1, "1 month"],
  [2, "2 months"],
  [3, "3 months"],
  [4, "4 months"],
  [6, "6 months"],
];
