import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { safeNext } from "@/lib/safe-next";
import { homeFor, isStaff, requireViewer } from "@/lib/viewer";
import { MfaClient } from "./mfa-client";

export const metadata: Metadata = { title: "Two-step login" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const v = await requireViewer();
  if (!isStaff(v)) redirect(homeFor(v));
  const next = safeNext((await searchParams).next, v.profile?.is_owner ? "/owner" : "/coach");
  if (v.aal === "aal2") redirect(next);

  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="suwrap">
        <div className="eyebrow">Two-step login</div>
        <h1>
          One more <u>step.</u>
        </h1>
        <p className="note">
          You can see client information, so MFG asks for a code from your phone each time you log in. It keeps
          clients&apos; numbers safe even if someone learns your password.
        </p>
        <MfaClient next={next} />
      </div>
    </>
  );
}
