"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { updatePassword, type FormState } from "@/app/auth-actions";
import { Brand } from "@/components/brand";
import { FormError, SubmitButton } from "@/components/form-bits";

function Inner() {
  const welcome = useSearchParams().get("welcome") === "1";
  const [state, action] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <div className="suwrap">
      <div className="eyebrow">{welcome ? "Welcome to MFG" : "New password"}</div>
      <h1>
        {welcome ? (
          <>
            Choose your <u>password.</u>
          </>
        ) : (
          <>
            Choose a new <u>password.</u>
          </>
        )}
      </h1>
      <form action={action} className="stack" noValidate>
        <label className="f">
          Password (8 or more characters)
          <input type="password" name="password" autoComplete="new-password" minLength={8} required />
        </label>
        <FormError message={state.error} />
        <SubmitButton>Save my password</SubmitButton>
      </form>
    </div>
  );
}

export default function UpdatePasswordPage() {
  return (
    <>
      <Brand />
      <Suspense>
        <Inner />
      </Suspense>
    </>
  );
}
