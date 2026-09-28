import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { STAGES } from "@/lib/domain/constants";
import { firstName } from "@/lib/domain/signup";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "My climb" };

// Phase 1 client home: waiting room or assigned coach. The full dashboard (§8) comes in Phase 3.
export default async function ClientHome() {
  const v = await requireViewer();
  if (!v.client) redirect("/");

  const supabase = await createClient();
  const { data: assignment } = await supabase
    .from("assignments")
    .select("coach_id, assigned_at")
    .is("ended_at", null)
    .maybeSingle();
  const { data: coach } = assignment
    ? await supabase.from("profiles").select("full_name").eq("id", assignment.coach_id).maybeSingle()
    : { data: null };
  const stage = STAGES[v.client.stage_start - 1];

  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="stack" style={{ marginTop: 20, maxWidth: 640 }}>
        <div className="eyebrow">My climb</div>
        <h1>
          Hello, {firstName(v.profile?.full_name)}. <u>Keep climbing.</u>
        </h1>
        <div className="card ticks">
          <div className="eyebrow">Your coach</div>
          {coach?.full_name ? (
            <>
              <div className="stname">{coach.full_name}</div>
              <p className="note">Your coach will contact you on WhatsApp.</p>
            </>
          ) : (
            <>
              <div className="stname">Waiting room</div>
              <p style={{ margin: "8px 0 0" }}>MFG will match you with a coach and send their name to your WhatsApp.</p>
            </>
          )}
        </div>
        <div className="card">
          <div className="eyebrow">Starting stage</div>
          <div className="stname" style={{ fontSize: 24 }}>
            {stage.n} · {stage.name}
          </div>
          <p className="note">This is where you are, not who you are.</p>
        </div>
        <div className="row">
          <Link className="btn gold" href="/tracker">
            My Debt Ladder Tracker
          </Link>
        </div>
      </div>
    </>
  );
}
