"use client";

import { useActionState } from "react";
import { COACH_PROTOCOL, EXPERIENCE, PROVINCES, READ_BOOK } from "@/lib/domain/constants";
import { FormError, SubmitButton } from "@/components/form-bits";
import { submitApplication, type ApplyState } from "./actions";

export function ApplyForm({ email, defaultName }: { email: string; defaultName: string }) {
  const [state, action] = useActionState<ApplyState, FormData>(submitApplication, {});
  const v = state.values || {};
  // key forces the inputs to take the returned values after an error
  const k = state.error || "fresh";

  return (
    <form action={action} className="stack" style={{ marginTop: 14 }} noValidate key={k}>
      <div className="two">
        <label className="f">
          Full name
          <input name="name" autoComplete="name" defaultValue={v.name ?? defaultName} />
        </label>
        <label className="f">
          Email (your future login)
          <input type="email" value={email} readOnly aria-readonly />
          <span className="field-hint">This is the account you&apos;re logged in with.</span>
        </label>
      </div>
      <div className="two">
        <label className="f">
          WhatsApp number
          <input name="whatsapp" inputMode="tel" autoComplete="tel" defaultValue={v.whatsapp} />
        </label>
        <label className="f">
          Province
          <select name="province" defaultValue={v.province ?? ""}>
            <option value="">Choose one</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="f">
        Coaching or money experience
        <select name="experience" defaultValue={v.experience ?? ""}>
          <option value="">Choose one</option>
          {EXPERIENCE.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <div className="two">
        <label className="f">
          Have you read The Debt Millionaire?
          <select name="readBook" defaultValue={v.readBook ?? ""}>
            <option value="">Choose one</option>
            {READ_BOOK.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="f">
          How many clients could you take at once?
          <input name="capacity" inputMode="numeric" placeholder="e.g. 5" defaultValue={v.capacity} />
        </label>
      </div>
      <label className="f">
        Why do you want to coach with MFG?
        <textarea name="why" placeholder="A few sentences in your own words" defaultValue={v.why} />
      </label>
      <label className="f">
        Qualifications (optional)
        <input name="qualifications" placeholder="e.g. NQF5 management, financial planning course" defaultValue={v.qualifications} />
      </label>
      <div className="card">
        <label className="f" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", fontSize: 14, color: "var(--cream)" }}>
          <input type="checkbox" name="agreed" defaultChecked={v.agreed} style={{ marginTop: 4, accentColor: "var(--gold)" }} />
          <span>{COACH_PROTOCOL}</span>
        </label>
      </div>
      <FormError message={state.error} />
      <SubmitButton pendingText="Sending…">Send my application</SubmitButton>
    </form>
  );
}
