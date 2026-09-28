"use client";

import { useActionState } from "react";
import { signInWithEmail, type FormState } from "@/app/auth-actions";
import { FormError, SubmitButton } from "@/components/form-bits";

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(signInWithEmail, {});
  return (
    <form action={action} className="stack" noValidate>
      <label className="f">
        Email
        <input type="email" name="email" defaultValue={state.email} autoComplete="email" required />
      </label>
      <label className="f">
        Password
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      <FormError message={state.error} />
      <SubmitButton>Log in</SubmitButton>
    </form>
  );
}
