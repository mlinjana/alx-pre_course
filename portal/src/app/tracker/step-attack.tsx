"use client";

import { parseAmount, payoff, simulatePlan, type Debt, type Payoff } from "@/lib/calc/tracker";
import { monthsText, rand } from "@/lib/format";
import type { TAttack } from "@/lib/tracker/model";
import { saveAttack } from "./actions";
import type { StepProps } from "./tracker";

export function StepAttack({ data, setData, schedule, calc }: StepProps) {
  const { byRate, byBalance, lineUp } = calc.orders;
  const a = data.attack;
  const extra = parseAmount(a.extra) ?? 0;
  const order = a.method === "avalanche" ? byRate : byBalance;
  const target = order[0];

  function commit(attack: TAttack, now = false) {
    setData({ ...data, attack });
    schedule("attack", () => saveAttack(attack), now);
  }

  const plans = { avalanche: simulatePlan(byRate, extra), snowball: simulatePlan(byBalance, extra) };

  return (
    <>
      <div className="section">
        <div className="compare">
          <div className="card">
            <h2>Avalanche</h2>
            <p className="note">Highest interest rate first. Costs the least interest.</p>
            <OrderList debts={byRate} show="rate" />
          </div>
          <div className="card">
            <h2>Snowball</h2>
            <p className="note">Smallest balance first. Quick wins keep you going.</p>
            <OrderList debts={byBalance} show="balance" />
          </div>
        </div>
        {byRate.length > 0 &&
          (lineUp ? (
            <div className="alert green">
              <b>They line up</b>Both methods point at the same debt first. You get the quick win and the cheapest route at once.
            </div>
          ) : (
            <div className="alert amber">
              <b>They point at different debts</b>Know yourself. The perfect strategy you abandon in month four is worth less than
              the imperfect one you follow to the end.
            </div>
          ))}
        {byRate.some((d) => d.rate === null) && (
          <p className="note">Debts with an unknown rate sit at the bottom of the Avalanche list until you add the rate.</p>
        )}
      </div>

      <div className="section">
        <h2>My choice</h2>
        <div className="seg" role="group" aria-label="Method">
          {(["avalanche", "snowball"] as const).map((m) => (
            <button key={m} aria-pressed={a.method === m} onClick={() => commit({ ...a, method: m }, true)}>
              {m === "avalanche" ? "Avalanche" : "Snowball"}
            </button>
          ))}
        </div>
        <label className="f" style={{ maxWidth: 320 }}>
          Extra I can add each month (R), on top of minimums
          <input className="num" inputMode="decimal" value={a.extra} onChange={(e) => commit({ ...a, extra: e.target.value })} placeholder="Even R100 counts" />
        </label>

        <div className="card ticks" aria-live="polite">
          {!target ? (
            <p className="note" style={{ margin: 0 }}>
              Add your debts in Step 1 first.
            </p>
          ) : (
            <TargetCard target={target} extra={extra} />
          )}
        </div>

        {target &&
          (plans.avalanche && plans.snowball ? (
            <>
              <p className="note" style={{ margin: "6px 0" }}>
                Your whole plan, with every freed-up payment rolled forward. Estimates only: they assume rates and payments stay
                the same.
              </p>
              <div className="sim">
                <PlanCell k="Debt-free · Avalanche" p={plans.avalanche} />
                <PlanCell k="Debt-free · Snowball" p={plans.snowball} />
              </div>
            </>
          ) : (
            <p className="note">Add every rate and minimum in Step 1 to see your full debt-free date for both methods.</p>
          ))}
      </div>
    </>
  );
}

function OrderList({ debts, show }: { debts: Debt[]; show: "rate" | "balance" }) {
  if (!debts.length) return <p className="note">Nothing to rank yet.</p>;
  return (
    <ol className="order">
      {debts.map((d) => (
        <li key={d.id}>
          <span>{d.label}</span>
          <span>{show === "rate" ? (d.rate === null ? "rate ?" : `${d.rate}%`) : rand(d.balance)}</span>
        </li>
      ))}
    </ol>
  );
}

function TargetCard({ target, extra }: { target: Debt; extra: number }) {
  const pay = (target.minimum ?? 0) + extra;
  const p = payoff(target.balance, target.rate, target.minimum === null ? null : pay);
  return (
    <>
      <div className="eyebrow">Target #1</div>
      <div className="target">
        <span className="name">{target.label}</span>
        <span className="chip gold">
          {rand(target.balance)}
          {target.rate !== null ? ` · ${target.rate}%` : ""}
        </span>
      </div>
      <p className="note" style={{ marginTop: 8 }}>
        {target.rate === null || target.minimum === null ? (
          "Add this debt's rate and minimum in Step 1 to see when it clears."
        ) : p && "never" in p ? (
          `At ${rand(pay)} a month this debt never clears. The payment must be bigger than the interest.`
        ) : p ? (
          <>
            At {rand(pay)} a month, it&apos;s gone in about{" "}
            <strong style={{ fontFamily: "var(--mono)", color: "var(--cream)" }}>{monthsText(p.months)}</strong>. Then its whole
            payment rolls onto the next debt.
          </>
        ) : null}
      </p>
      {target.status === "review" && <p className="note">This debt is under debt review. Extra payments go through your counsellor and PDA only.</p>}
      {target.status === "attorneys" && <p className="note">This debt is with attorneys. Get legal advice before paying extra or negotiating.</p>}
    </>
  );
}

function PlanCell({ k, p }: { k: string; p: Payoff }) {
  return (
    <div>
      <div className="k">{k}</div>
      {"never" in p ? (
        <div className="v" style={{ color: "var(--red)" }}>
          Never clears
        </div>
      ) : (
        <>
          <div className="v">{monthsText(p.months)}</div>
          <div className="note" style={{ fontSize: 13 }}>
            {rand(p.interest)} total interest
          </div>
        </>
      )}
    </div>
  );
}
