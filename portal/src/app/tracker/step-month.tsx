"use client";

import { rand } from "@/lib/format";
import { GROUPS, type GroupKey, type TBudget, type TItem } from "@/lib/tracker/model";
import { saveBudget } from "./actions";
import type { StepProps } from "./tracker";

export function StepMonth({ data, setData, schedule, calc }: StepProps) {
  function commit(budget: TBudget, now = false) {
    setData({ ...data, budget });
    schedule("budget", () => saveBudget({ takeHome: budget.takeHome, gross: budget.gross, items: budget.items }), now);
  }
  const b = data.budget;
  const setItem = (id: string, patch: Partial<TItem>) => commit({ ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const addItem = (grp: GroupKey) => {
    const id = crypto.randomUUID();
    commit({ ...b, items: [...b.items, { id, grp, label: "", amount: "" }] }, true);
    setTimeout(() => document.getElementById(`item-${id}`)?.focus(), 0);
  };
  const removeItem = (id: string) => commit({ ...b, items: b.items.filter((i) => i.id !== id) }, true);

  return (
    <>
      <div className="section">
        <div className="grid2">
          <label className="f">
            Take-home pay (R a month, after deductions)
            <input className="num" inputMode="decimal" value={b.takeHome} onChange={(e) => commit({ ...b, takeHome: e.target.value })} placeholder="What lands in your account" />
          </label>
          <label className="f">
            Pay before deductions (R a month)
            <input className="num" inputMode="decimal" value={b.gross} onChange={(e) => commit({ ...b, gross: e.target.value })} placeholder="Top of your payslip" />
          </label>
        </div>
        <p className="note">Pay before deductions is used for your debt load, the way Chapter 9 works it out.</p>
      </div>

      <div className="section">
        <div className="grid2">
          {GROUPS.map(([k, label, hint]) => (
            <div className={`card group tag-${k}`} key={k}>
              <div className="group-head">
                <h3>{label}</h3>
                <span className="sum">{rand(calc.groups[k])}</span>
              </div>
              <div className="note" style={{ fontSize: 13 }}>
                {hint}
              </div>
              <div className="log">
                {b.items
                  .filter((i) => i.grp === k)
                  .map((it) => (
                    <div className="irow" key={it.id}>
                      <input
                        id={`item-${it.id}`}
                        className="lbl"
                        aria-label={`${label} item`}
                        value={it.label}
                        onChange={(e) => setItem(it.id, { label: e.target.value })}
                        placeholder="What is it?"
                      />
                      <input
                        className="num"
                        inputMode="decimal"
                        aria-label={`${it.label || label} amount`}
                        value={it.amount}
                        onChange={(e) => setItem(it.id, { amount: e.target.value })}
                        placeholder="R"
                      />
                      <button className="x" onClick={() => removeItem(it.id)} aria-label={`Remove ${it.label || "item"}`}>
                        ×
                      </button>
                    </div>
                  ))}
              </div>
              <div>
                <button className="btn ghost small" onClick={() => addItem(k)}>
                  + Add item
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <div className="group-head">
            <h3>Minimum debt payments</h3>
            <span className="sum">{rand(calc.totals.minimums)}</span>
          </div>
          <div className="note" style={{ fontSize: 13 }}>
            From Step 1, including any accounts you aren&apos;t paying right now. An unpaid account is not a saving.
          </div>
        </div>
      </div>
    </>
  );
}
