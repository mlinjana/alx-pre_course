import type { Metadata } from "next";
import Link from "next/link";
import { Brand, LogoutButton } from "@/components/brand";
import { IdleTimer } from "@/components/idle-timer";
import { staffIdleTimeoutMs } from "@/lib/env";
import { firstName } from "@/lib/domain/signup";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/viewer";

export const metadata: Metadata = { title: "Coach" };

// Phase 1 coach area: status, and the list of assigned clients. The full coach portal (§9) comes in Phase 4.
export default async function CoachPage() {
  const v = await requireStaff("coach", "/coach");
  const status = v.coach!.status;
  const supabase = await createClient();

  const { data: rows } =
    status === "certified"
      ? await supabase.from("assignments").select("client_id, assigned_at").is("ended_at", null).order("assigned_at")
      : { data: [] };
  const ids = (rows || []).map((r) => r.client_id);
  const [{ data: people }, { data: clients }] = ids.length
    ? await Promise.all([
        supabase.from("profiles").select("id, full_name, whatsapp").in("id", ids),
        supabase.from("clients").select("id, consent").in("id", ids),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <>
      <IdleTimer timeoutMs={staffIdleTimeoutMs()} />
      <Brand
        right={
          <div className="row">
            {v.profile?.is_owner && (
              <Link className="btn ghost small" href="/owner">
                Owner view
              </Link>
            )}
            <LogoutButton />
          </div>
        }
      />
      <div className="stack" style={{ marginTop: 20, maxWidth: 760 }}>
        <div className="eyebrow">Coach</div>
        <h1>
          Hello, {firstName(v.profile?.full_name)}. <u>Your clients.</u>
        </h1>

        {status === "training" && (
          <div className="card ticks">
            <h3>You&apos;re in training</h3>
            <p style={{ margin: "8px 0 0" }}>
              Read the book, learn the Coach Manual, observe sessions, co-deliver with a lead coach, then pass six role-plays.
              Once MFG marks you certified, clients can be matched to you and they appear here.
            </p>
          </div>
        )}
        {status === "inactive" && (
          <div className="card">
            <h3>Your coaching is paused</h3>
            <p className="note">MFG has paused your coach account. Contact MFG if you think this is a mistake.</p>
          </div>
        )}
        {status === "certified" && (
          <div className="card">
            <h2>My clients ({ids.length})</h2>
            {ids.length === 0 ? (
              <p className="note">No clients yet. MFG will match clients to you.</p>
            ) : (
              <div className="tbl">
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>WhatsApp</th>
                      <th>Numbers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ids.map((id) => {
                      const p = people?.find((x) => x.id === id);
                      const c = clients?.find((x) => x.id === id);
                      return (
                        <tr key={id}>
                          <td>{p?.full_name || "Client"}</td>
                          <td className="note">{p?.whatsapp || "—"}</td>
                          <td>
                            {c?.consent ? (
                              <span className="chip green">Sharing</span>
                            ) : (
                              <span className="chip grey">{firstName(p?.full_name) || "They"} hasn&apos;t shared yet</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="note">Programme weeks, briefs, notes and referrals arrive in the next coach update.</p>
          </div>
        )}
      </div>
    </>
  );
}
