"use client";

import { useMemo, useRef, useState } from "react";
import { attackOrders, debtTotals, monthNumbers, parseAmount } from "@/lib/calc/tracker";
import { groupTotals, toCalcDebt, type Institution, type TrackerData } from "@/lib/tracker/model";
import { useAutosave } from "./use-autosave";
import { StepDebts } from "./step-debts";
import { StepMonth } from "./step-month";
import { StepNumbers } from "./step-numbers";
import { StepAttack } from "./step-attack";
import { StepProgress } from "./step-progress";

export const STEPS = [
  {
    short: "My debts",
    eyebrow: "Step 1 · Rungs 1 and 2 · Face the full truth",
    title: ["Every debt.", "Exactly."],
    hand: "Not roughly. Exactly.",
    lead: "Write down every debt: cards, store accounts, loans, micro loans, \"pay later\", and money you owe family. If you don't know a rate or balance yet, leave it blank. We'll mark it UNKNOWN instead of guessing.",
  },
  {
    short: "My month",
    eyebrow: "Step 2 · Rung 3 · Stop the bleeding",
    title: ["What comes in.", "What goes out."],
    hand: "Every rand gets a job.",
    lead: "Use your last three bank statements. Sort your costs into the four groups from the book: Critical, Important, Reduce and Eliminate. Your minimum debt payments come in automatically from Step 1.",
  },
  {
    short: "My numbers",
    eyebrow: "Step 3 · Chapter 9 · See where you stand",
    title: ["Your numbers,", "on the board."],
    hand: "A truth you can see clearly is a problem you can solve.",
    lead: "Your debt load, your monthly gap, and the Five Red Lines. This is your starting point, not your character.",
  },
  {
    short: "My attack",
    eyebrow: "Step 4 · Rungs 4 and 5 · Choose your attack",
    title: ["One debt at a time.", "In order."],
    hand: "The best one is the one you'll stick to.",
    lead: "Pay the minimum on every debt. Every extra rand goes to one target until it dies, then its whole payment rolls onto the next.",
  },
  {
    short: "My progress",
    eyebrow: "Step 5 · Make it visible",
    title: ["Watch the number", "shrink."],
    hand: "Every month, the number is smaller.",
    lead: "Log your total once a month. When you're ready, download your summary.",
  },
] as const;

export function Tracker({
  initial,
  institutions,
  clientName,
  initialStep,
}: {
  initial: TrackerData;
  institutions: Institution[];
  clientName: string;
  initialStep: number;
}) {
  const [data, setData] = useState<TrackerData>(initial);
  const [step, setStep] = useState(initialStep);
  const { status, schedule, flush } = useAutosave();
  const mainRef = useRef<HTMLDivElement>(null);

  async function go(n: number) {
    const next = Math.min(5, Math.max(1, n));
    await flush();
    setStep(next);
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(next));
    window.history.replaceState(null, "", url);
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  const calc = useMemo(() => computeCalc(data, institutions), [data, institutions]);

  const s = STEPS[step - 1];
  const common = { data, setData, schedule, institutions, calc };

  return (
    <div className="tracker">
      <div className="layout">
        <nav className="ladder" aria-label="Tracker steps">
          <ol>
            {STEPS.map((x, i) => (
              <li key={x.short}>
                <button
                  className={`rung ${i + 1 === step ? "on" : ""} ${i + 1 < step ? "done" : ""}`}
                  onClick={() => go(i + 1)}
                  aria-current={i + 1 === step ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${x.short}`}
                >
                  <span className="bar" />
                  <span className="lbl">
                    {i + 1} · {x.short}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="stepnow">
            Step {step} of 5 · {s.short}
          </div>
        </nav>

        <div ref={mainRef} tabIndex={-1} style={{ outline: "none", minWidth: 0 }}>
          <div className={`savebar ${status.state}`} role="status" aria-live="polite">
            {status.state === "saving" ? "Saving…" : status.state === "error" ? status.message : "Saved to your account"}
          </div>
          <div className="eyebrow" style={{ marginTop: 10 }}>
            {s.eyebrow}
          </div>
          <h1>
            {s.title[0]} <u>{s.title[1]}</u>
          </h1>
          <p className="lead">{s.lead}</p>
          <div className="hand">{s.hand}</div>

          {step === 1 && <StepDebts {...common} />}
          {step === 2 && <StepMonth {...common} />}
          {step === 3 && <StepNumbers {...common} />}
          {step === 4 && <StepAttack {...common} />}
          {step === 5 && <StepProgress {...common} flush={flush} clientName={clientName} />}

          <div className="nav">
            {step > 1 ? (
              <button className="btn ghost" onClick={() => go(step - 1)}>
                ← Back
              </button>
            ) : (
              <span />
            )}
            {step < 5 && (
              <button className="btn gold" onClick={() => go(step + 1)}>
                Next: {STEPS[step].short} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Everything the steps show, worked out from what's on screen. */
export function computeCalc(data: TrackerData, institutions: Institution[]) {
  const debts = data.debts.map((d) => toCalcDebt(d, institutions));
  const totals = debtTotals(debts);
  const groups = groupTotals(data.budget.items);
  const takeHome = parseAmount(data.budget.takeHome);
  const gross = parseAmount(data.budget.gross);
  return {
    debts,
    totals,
    groups,
    takeHome,
    gross,
    numbers: monthNumbers(takeHome, gross, groups, totals.minimums),
    orders: attackOrders(debts),
  };
}
export type Calc = ReturnType<typeof computeCalc>;

export type StepProps = {
  data: TrackerData;
  setData: React.Dispatch<React.SetStateAction<TrackerData>>;
  schedule: ReturnType<typeof useAutosave>["schedule"];
  institutions: Institution[];
  calc: Calc;
};
