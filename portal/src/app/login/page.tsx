import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SsoButtons } from "@/components/sso-buttons";
import { enabledProviders } from "@/lib/env";
import { getViewer, homeFor } from "@/lib/viewer";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const NOTICES: Record<string, string> = {
  idle: "You were logged out after 30 minutes without activity. This keeps client information safe.",
};
const ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Log in, or ask for a new link.",
  provider: "That sign-in didn't finish. Try again, or use your email.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; error?: string }> }) {
  const { reason, error } = await searchParams;
  const v = await getViewer();
  if (v) redirect(homeFor(v));

  return (
    <>
      <Brand />
      <div className="suwrap">
        <div className="eyebrow">Welcome back</div>
        <h1>
          Log <u>in.</u>
        </h1>
        {reason && NOTICES[reason] && <div className="okbox" role="status">{NOTICES[reason]}</div>}
        {error && ERRORS[error] && <div className="suerr" role="alert">{ERRORS[error]}</div>}
        <div className="stack" style={{ marginTop: 14 }}>
          <SsoButtons flags={enabledProviders()} next="/" />
          <LoginForm />
          <p className="note">
            <Link href="/forgot">Forgot your password?</Link> · New here? <Link href="/join">Create an account</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
