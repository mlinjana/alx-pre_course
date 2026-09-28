import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { SsoButtons } from "@/components/sso-buttons";
import { enabledProviders } from "@/lib/env";
import { getViewer, homeFor } from "@/lib/viewer";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Join" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const asCoach = (await searchParams).as === "coach";
  const v = await getViewer();
  if (v) redirect(asCoach && !v.client && !v.coach ? "/apply" : homeFor(v));

  return (
    <>
      <Brand />
      <div className="suwrap">
        <div className="seg" role="group" aria-label="I want to" style={{ alignSelf: "flex-start" }}>
          <Link href="/join" className="btn" aria-pressed={!asCoach} style={segStyle(!asCoach)}>
            I want help with my money
          </Link>
          <Link href="/join?as=coach" className="btn" aria-pressed={asCoach} style={segStyle(asCoach)}>
            I want to coach with MFG
          </Link>
        </div>

        {asCoach ? (
          <>
            <div className="eyebrow">Coach with MFG</div>
            <h1>
              Help people <u>climb.</u>
            </h1>
            <p className="note">
              First create your login. Then you fill in the application. MFG coaches teach the method in{" "}
              <i>The Debt Millionaire</i>, and every coach is approved and trained before taking clients.
            </p>
          </>
        ) : (
          <>
            <div className="suprog" aria-label="Step 1 of 3">
              <span className="on" />
              <span />
              <span />
              <em>1 of 3</em>
            </div>
            <div className="eyebrow">Mlinjana Financial Group</div>
            <h1>
              Start your <u>climb.</u>
            </h1>
            <p className="note">Free to join. Your numbers stay private until you choose to share them with your coach.</p>
          </>
        )}

        <div className="stack" style={{ marginTop: 14 }}>
          <SsoButtons flags={enabledProviders()} next={asCoach ? "/apply" : "/join/details"} />
          <SignUpForm asCoach={asCoach} />
          <p className="note">
            Already have an account? <Link href="/login">Log in</Link>.
          </p>
        </div>
      </div>
    </>
  );
}

function segStyle(on: boolean): React.CSSProperties {
  return on ? { background: "var(--gold)", color: "var(--deep)", borderRadius: 0 } : { color: "var(--muted)", borderRadius: 0 };
}
