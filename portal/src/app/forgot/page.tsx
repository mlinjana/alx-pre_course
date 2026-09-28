"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type FormState } from "@/app/auth-actions";
import { Brand } from "@/components/brand";
import { FormError, SubmitButton } from "@/components/form-bits";

export default function ForgotPage() {
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, {});
  return (
    <>
      <Brand />
      <div className="suwrap">
        <div className="eyebrow">Forgot your password</div>
        <h1>
          Get a new <u>link.</u>
        </h1>
        {state.sent ? (
          <div className="card ticks" role="status">
            <p style={{ margin: 0 }}>
              If <b>{state.email}</b> has an MFG account, we&apos;ve sent a link to choose a new password. It works once.
            </p>
            <p className="note">Nothing there after a few minutes? Check your spam folder.</p>
          </div>
        ) : (
          <form action={action} className="stack" noValidate>
            <label className="f">
              Email
              <input type="email" name="email" defaultValue={state.email} autoComplete="email" required />
            </label>
            <FormError message={state.error} />
            <SubmitButton>Send me a link</SubmitButton>
          </form>
        )}
        <p className="note">
          <Link href="/login">Back to log in</Link>
        </p>
      </div>
    </>
  );
}
