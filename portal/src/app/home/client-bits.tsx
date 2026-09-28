"use client";

import { useActionState, useState } from "react";
import { EF_OPTIONS } from "@/lib/calc/climb";
import { FormError, SubmitButton } from "@/components/form-bits";
import { setConsent, submitMonthlyUpdate, tickHomework, type UpdateState } from "./actions";

export function ConsentSwitch({ initial, hasCoach }: { initial: boolean; hasCoach: boolean }) {
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  async function change(next: boolean) {
    setOn(next);
    setMsg(null);
    const r = await setConsent(next);
    if (!r.ok) {
      setOn(!next);
      setMsg("That didn't save. Check your connection and try again.");
    }
  }
  return (
    <div className="card">
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => change(e.target.checked)} />
        <span>
          <b>Share my numbers with {hasCoach ? "my coach" : "the MFG coach assigned to me"}</b>
          <br />
          <span className="note">
            {on
              ? "Your coach sees your totals, debts and progress. You can switch this off any time."
              : "Off: your coach can't see your numbers. Switch it on when you're ready."}
          </span>
        </span>
      </label>
      {msg && <div className="suerr" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

export function Homework({ items }: { items: { id: string; text: string; done: boolean }[] }) {
  const [state, setState] = useState(items);
  async function tick(id: string, done: boolean) {
    setState((s) => s.map((h) => (h.id === id ? { ...h, done } : h)));
    const r = await tickHomework(id, done);
    if (!r.ok) setState((s) => s.map((h) => (h.id === id ? { ...h, done: !done } : h)));
  }
  return (
    <ul className="hw">
      {state.map((h) => (
        <li key={h.id}>
          <label>
            <input type="checkbox" checked={h.done} onChange={(e) => tick(h.id, e.target.checked)} />
            <span className={h.done ? "done" : ""}>{h.text}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

type Prefill = { total: string; openAccounts: string; minimums: string; gross: string; newCredit: string; borrowing: string; payday: string; ef: string; assetIncome: string };

export function MonthlyUpdateForm({ prefill, takeHomeKnown }: { prefill: Prefill; takeHomeKnown: boolean }) {
  const [state, action] = useActionState<UpdateState, FormData>(submitMonthlyUpdate, {});
  const v = { ...prefill, ...(state.error ? state.values : {}) };
  return (
    <form action={action} className="stack" style={{ marginTop: 10 }} key={state.error ? JSON.stringify(state.values) : String(state.savedAt ?? "new")} noValidate>
      {!takeHomeKnown && (
        <div className="placeholder">
          First add your take-home pay in <a href="/tracker?step=2">My month</a> in your Tracker. We use it to work out your stage.
        </div>
      )}
      <div className="two">
        <label className="f">
          Total debt now (R)
          <input name="total" inputMode="decimal" defaultValue={v.total} />
        </label>
        <label className="f">
          Accounts still open
          <input name="openAccounts" inputMode="numeric" defaultValue={v.openAccounts} />
        </label>
      </div>
      <div className="two">
        <label className="f">
          Minimum debt payments this month (R)
          <input name="minimums" inputMode="decimal" defaultValue={v.minimums} />
        </label>
        <label className="f">
          Pay before deductions (R)
          <input name="gross" inputMode="decimal" defaultValue={v.gross} />
        </label>
      </div>
      <div className="two">
        <label className="f">
          Did you take any new credit this month?
          <select name="newCredit" defaultValue={v.newCredit}>
            <option value="">Choose one</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <label className="f">
          Did you borrow to pay a debt?
          <select name="borrowing" defaultValue={v.borrowing}>
            <option value="">Choose one</option>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
      </div>
      <div className="two">
        <label className="f">
          My payday (day of the month)
          <input name="payday" inputMode="numeric" defaultValue={v.payday} />
        </label>
        <label className="f">
          Emergency savings, in months of essential costs
          <select name="ef" defaultValue={v.ef}>
            {EF_OPTIONS.map(([n, l]) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="f">
        Does something you own pay you every month? If so, how much (R)? Leave empty if not.
        <input name="assetIncome" inputMode="decimal" defaultValue={v.assetIncome} placeholder="e.g. rent from a room" />
      </label>
      <FormError message={state.error} />
      {state.ok && (
        <div className="okbox" role="status">
          {state.ok}
        </div>
      )}
      <div>
        <SubmitButton pendingText="Saving…" className="btn gold small">
          Save my update
        </SubmitButton>
      </div>
      <p className="note">Filled in from your Debt Ladder Tracker. Change anything that&apos;s different this month.</p>
    </form>
  );
}
