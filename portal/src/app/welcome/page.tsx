import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { STAGES } from "@/lib/domain/constants";
import { firstName } from "@/lib/domain/signup";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const v = await requireViewer();
  if (!v.client) redirect("/");
  const stage = STAGES[v.client.stage_start - 1];

  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="suwrap">
        <div className="eyebrow">You&apos;re in</div>
        <h1>
          Welcome, {firstName(v.profile?.full_name)}. <u>You&apos;ve started.</u>
        </h1>
        <div className="card ticks">
          <div className="eyebrow">Your starting stage</div>
          <div className="stname">
            {stage.n} · {stage.name}
          </div>
          <p style={{ margin: "8px 0 0" }}>{stage.say}</p>
          <p className="note" style={{ marginTop: 8 }}>
            This is a starting point, not a label. Your debt is not your character. It is your circumstance.
          </p>
        </div>
        <div className="card">
          <h3>What happens now</h3>
          <ol className="steps">
            <li>
              <b>You&apos;re in the waiting room.</b> MFG will match you with a coach and send their name to your WhatsApp.
            </li>
            <li>
              <b>Start your Debt Ladder Tracker now.</b>
              {!v.client.consent && " Your coach will see it once you switch on sharing."}
            </li>
            <li>
              <b>Your first call starts from your numbers.</b>
            </li>
          </ol>
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn gold" href="/tracker">
              Start my Debt Ladder Tracker
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
