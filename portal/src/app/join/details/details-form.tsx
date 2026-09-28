"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { HEARD_FROM, NEEDS, QUESTIONS } from "@/lib/domain/constants";
import { checkAboutYou, checkWhereYouAre } from "@/lib/domain/signup";
import { FormError, SubmitButton } from "@/components/form-bits";
import { completeSignup, type DetailsState } from "./actions";

// Screens 2 and 3 of the client sign-up (§4). One form, shown in two steps.
export function DetailsForm({ providerLabel, defaultName }: { providerLabel: string | null; defaultName: string }) {
  const [state, action] = useActionState<DetailsState, FormData>(completeSignup, {});
  const [step, setStep] = useState<2 | 3>(2);
  const [localError, setLocalError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A server-side error sends the person back to the step that needs fixing.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    setLocalError(null);
    if (state.step) setStep(state.step);
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function next() {
    const fd = new FormData(formRef.current!);
    const problem = checkAboutYou({
      name: String(fd.get("name") ?? ""),
      whatsapp: String(fd.get("whatsapp") ?? ""),
      need: String(fd.get("need") ?? ""),
      heard: String(fd.get("heard") ?? ""),
    });
    setLocalError(problem);
    if (!problem) setStep(3);
  }

  const error = localError ?? (state.step === step ? state.error : undefined);
  const val = state.values || {};
  // Screen 3 is checked here first, so a missing answer never clears the form.
  function beforeSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => String(fd.get(k) ?? "");
    const problem = checkWhereYouAre({ q1: g("q1"), q2: g("q2"), q3: g("q3"), q4: g("q4") }, fd.get("terms") === "on");
    if (problem) {
      e.preventDefault();
      setLocalError(problem);
    }
  }

  return (
    // key: after a server error the form remounts with what the person typed (React resets forms after an action).
    <form ref={formRef} action={action} onSubmit={beforeSubmit} className="stack" noValidate key={state.values ? JSON.stringify(state.values) : "new"}>
      <div className="suprog" aria-label={`Step ${step} of 3`}>
        <span className="on" />
        <span className="on" />
        <span className={step === 3 ? "on" : ""} />
        <em>{step} of 3</em>
      </div>

      {/* Step 2 stays in the form (hidden) on step 3, so all answers are sent together. */}
      <div className="stack" hidden={step !== 2}>
        <div className="eyebrow">About you</div>
        <h1 ref={step === 2 ? headingRef : undefined} tabIndex={-1}>
          Who&apos;s <u>climbing?</u>
        </h1>
        {providerLabel && <p className="note">Signed in with {providerLabel}. Just a few details.</p>}
        <label className="f">
          First name and surname
          <input name="name" autoComplete="name" defaultValue={val.name ?? defaultName} />
        </label>
        <label className="f">
          WhatsApp number
          <input name="whatsapp" inputMode="tel" autoComplete="tel" placeholder="e.g. 082 000 0000" defaultValue={val.whatsapp} />
          <span className="note">Your coach will contact you here.</span>
        </label>
        <fieldset className="pick">
          <legend>What do you need help with?</legend>
          {NEEDS.map((n) => (
            <label key={n}>
              <input type="radio" name="need" value={n} defaultChecked={val.need === n} />
              <span>{n}</span>
            </label>
          ))}
        </fieldset>
        <label className="f">
          How did you hear about MFG?
          <select name="heard" defaultValue={val.heard ?? ""}>
            <option value="">Choose one</option>
            {HEARD_FROM.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        {step === 2 && <FormError message={error} />}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn gold" type="button" onClick={next}>
            Next →
          </button>
        </div>
      </div>

      <div className="stack" hidden={step !== 3}>
        <div className="eyebrow">Where you are now</div>
        <h1 ref={step === 3 ? headingRef : undefined} tabIndex={-1}>
          Four quick <u>questions.</u>
        </h1>
        <p className="note">This helps us match you with the right coach. There are no wrong answers, and nobody is judged here.</p>
        {QUESTIONS.map((q) => (
          <fieldset className="pick" key={q.key}>
            <legend>{q.text}</legend>
            <div className="row">
              {q.options.map((o) => (
                <label className="pill" key={o}>
                  <input type="radio" name={q.key} value={o} defaultChecked={val[q.key] === o} />
                  <span>{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="card">
          <label className="switch">
            <input type="checkbox" name="consent" defaultChecked={state.values ? val.consent === "on" : true} role="switch" />
            <span>
              <b>Share my numbers with the MFG coach assigned to me.</b>
              <br />
              <span className="note">You can switch this off any time in your account.</span>
            </span>
          </label>
        </div>
        <label className="f" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", fontSize: 14, color: "var(--cream)" }}>
          <input type="checkbox" name="terms" defaultChecked={val.terms === "on"} style={{ marginTop: 4, accentColor: "var(--gold)" }} />
          <span>
            I agree to the <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.
          </span>
        </label>
        {step === 3 && <FormError message={error} />}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="btn ghost" type="button" onClick={() => { setLocalError(null); setStep(2); }}>
            ← Back
          </button>
          <SubmitButton pendingText="Joining…">Join MFG</SubmitButton>
        </div>
      </div>
    </form>
  );
}
