"use client";

import { useActionState } from "react";
import { signUpWithEmail, type FormState } from "@/app/auth-actions";
import { FormError, SubmitButton } from "@/components/form-bits";

export function SignUpForm({ asCoach }: { asCoach: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(signUpWithEmail, {});

  if (state.sent) {
    return (
      <div className="card ticks" role="status">
        <h3>Check your email</h3>
        <p style={{ margin: "8px 0 0" }}>
          We sent a link to <b>{state.email}</b>. Open it on this phone or computer to confirm your email and carry on.
        </p>
        <p className="note">Nothing there after a few minutes? Check your spam folder.</p>
      </div>
    );
  }

  return (
    <form action={action} className="stack" noValidate>
      {asCoach && <input type="hidden" name="as" value="coach" />}
      <label className="f">
        Email
        <input type="email" name="email" defaultValue={state.email} autoComplete="email" placeholder="you@example.com" required />
      </label>
      <label className="f">
        Create a password (8 or more characters)
        <input type="password" name="password" autoComplete="new-password" minLength={8} required />
      </label>
      <FormError message={state.error} />
      <SubmitButton>Next →</SubmitButton>
    </form>
  );
}
