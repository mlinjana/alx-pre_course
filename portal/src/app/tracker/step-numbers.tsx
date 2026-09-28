"use client";

import { MATHS_BROKEN, loadBand } from "@/lib/calc/tracker";
import { pct, rand } from "@/lib/format";
import { RED_LINE_QUESTIONS, type RedLineKey, type TRedLines } from "@/lib/tracker/model";
import { saveRedLines } from "./actions";
import type { StepProps } from "./tracker";

export function StepNumbers({ data, setData, schedule, calc }: StepProps) {
  const { debtLoad, gapNow, gapAfterCuts } = calc.numbers;
  const band = loadBand(debtLoad);
  const rl1 = debtLoad !== null && debtLoad > 50;
  const hasHighRate = calc.debts.some((d) => (d.rate ?? 0) >= 20);
  const attorneys = data.debts.some((d) => d.status === "attorneys");
  const unknown = calc.totals.unknown;

  function answer(k: RedLineKey, v: boolean) {
    const redLines: TRedLines = { ...data.redLines, [k]: v };
    setData({ ...data, redLines });
    schedule("redLines", () => saveRedLines(redLines), true);
  }

  return (
    <>
      <div className="section">
        <div className="board">
          <Flap k="Total debt" v={rand(calc.totals.total)} s={`${data.debts.length} creditors`} />
          <Flap
            k="Debt load"
            v={debtLoad === null ? "ADD PAY" : pct(debtLoad)}
            s={debtLoad === null ? "Add pay before deductions in Step 2" : "Minimums ÷ pay before deductions"}
            tone={band ? band.tone : "amber"}
          />
          <Flap
            k="Gap this month"
            v={gapNow === null ? "ADD PAY" : rand(gapNow, true)}
            s={gapNow === null ? "Add take-home pay in Step 2" : gapNow < 0 ? "Short every month" : "Left over"}
            tone={gapNow === null ? "amber" : gapNow < 0 ? "red" : "green"}
          />
          <Flap
            k="Gap after cuts"
            v={gapAfterCuts === null ? "—" : rand(gapAfterCuts, true)}
            s="If Reduce and Eliminate go to zero"
            tone={gapAfterCuts === null ? undefined : gapAfterCuts < 0 ? "red" : "green"}
          />
        </div>
      </div>

      <div className="section" aria-live="polite">
        {band && (
          <div className={`alert ${band.tone}`}>
            <b>Debt load {pct(debtLoad)}</b>
            {band.text}
          </div>
        )}
        {gapAfterCuts !== null && gapAfterCuts < 0 ? (
          <div className="alert red">
            <b>The maths is broken, not you</b>
            {MATHS_BROKEN}
          </div>
        ) : gapNow !== null && gapNow < 0 ? (
          <div className="alert amber">
            <b>The gap closes if you cut</b>Your Reduce and Eliminate lists are where this month&apos;s shortfall is hiding. Start
            with Eliminate tonight.
          </div>
        ) : null}
        {attorneys && (
          <div className="alert red">
            <b>An account is with attorneys</b>Get legal advice before you negotiate that account.
          </div>
        )}
        {unknown > 0 && (
          <div className="alert amber">
            <b>
              {unknown} debt{unknown > 1 ? "s have" : " has"} unknowns
            </b>
            Your numbers are only as true as your list. Fill in the blanks from your statements.
          </div>
        )}
      </div>

      <div className="section">
        <h2>The Five Red Lines</h2>
        <p className="note">From Chapter 9. If any of these is true, it&apos;s an alarm, not a suggestion.</p>
        <div className="redlines">
          <div className={`rl ${rl1 ? "flash" : ""}`}>
            <span className="n">1</span>
            <span>
              More than half your pay is promised to debt
              <span className="note" style={{ display: "block", fontSize: 13 }}>
                Worked out from your debt load
              </span>
            </span>
            <span className={`chip ${debtLoad === null ? "unk" : rl1 ? "bad" : "ok"}`}>{debtLoad === null ? "Add pay" : rl1 ? "Flashing" : "Clear"}</span>
          </div>
          {RED_LINE_QUESTIONS.map(([k, q], i) => (
            <div className={`rl ${data.redLines[k] === true ? "flash" : ""}`} key={k}>
              <span className="n">{i + 2}</span>
              <span>
                {q}
                {k === "minOnlyHigh" && hasHighRate && (
                  <span className="note" style={{ display: "block", fontSize: 13 }}>
                    You have at least one debt at 20% or more.
                  </span>
                )}
              </span>
              <span className="yn" role="group" aria-label={q}>
                <button aria-pressed={data.redLines[k] === true} onClick={() => answer(k, true)}>
                  Yes
                </button>
                <button aria-pressed={data.redLines[k] === false} onClick={() => answer(k, false)}>
                  No
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Flap({ k, v, s, tone }: { k: string; v: string; s: string; tone?: "red" | "amber" | "green" }) {
  return (
    <div className={`flap ${tone || ""}`}>
      <span className="k">{k}</span>
      <span className="v" key={v}>
        {v}
      </span>
      <span className="s">{s}</span>
    </div>
  );
}
