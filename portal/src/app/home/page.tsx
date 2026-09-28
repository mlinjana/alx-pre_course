import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { DebtChart } from "@/components/debt-chart";
import { WEEKS, movement, ordinal, paydayDue, saDate, stageChecks, type Position } from "@/lib/calc/climb";
import { STAGES } from "@/lib/domain/constants";
import { firstName } from "@/lib/domain/signup";
import { shortName } from "@/lib/domain/assignment";
import { loadDashboard, type MonthlyUpdate } from "@/lib/dashboard/load";
import { currentMonth, longDate, pct, rand } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { ConsentSwitch, Homework, MonthlyUpdateForm } from "./client-bits";

export const metadata: Metadata = { title: "My climb" };

// Client dashboard (§8).
export default async function ClientHome() {
  const v = await requireViewer();
  if (!v.client) redirect("/");
  const supabase = await createClient();
  const d = await loadDashboard(supabase, v.userId);
  const coach = d.coachName ? shortName(d.coachName) : null;
  const today = saDate(new Date());
  const due = coach && paydayDue(d.lastUpdate, d.client.payday, today);
  const last = d.history.at(-1);
  const up = d.latest;

  return (
    <>
      <Brand
        right={
          <div className="row">
            <Link className="btn ghost small" href="/tracker">
              My Tracker
            </Link>
            <LogoutButton />
          </div>
        }
      />
      <div className="stack" style={{ marginTop: 20, maxWidth: 760 }}>
        <div>
          <div className="eyebrow">My account</div>
          <h1>
            Hi {firstName(v.profile?.full_name)}. <u>Keep climbing.</u>
          </h1>
          <p className="note">
            Your coach:{" "}
            <b style={{ color: "var(--cream)" }}>
              {coach ?? "You're in the waiting room. MFG will match you with a coach and send their name to your WhatsApp."}
            </b>
          </p>
        </div>

        {due && (
          <div className="card payday">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="eyebrow">Payday check-in</div>
                <b>
                  It&apos;s past your payday on the {ordinal(d.client.payday)}. Update your numbers so {coach} sees where you are.
                </b>
              </div>
              <a className="btn gold small" href="#update">
                Update now
              </a>
            </div>
          </div>
        )}

        {coach && (
          <div className="card">
            <div className="eyebrow">My programme</div>
            <div className="wkt">
              Week {d.week} of 12 · {WEEKS[d.week - 1].title}
            </div>
            <div className="wkbar" aria-label={`Week ${d.week} of 12`}>
              {WEEKS.map((w, i) => (
                <span key={w.title} className={i + 1 < d.week ? "past" : i + 1 === d.week ? "now" : ""} />
              ))}
            </div>
          </div>
        )}

        {up ? (
          <StageCard latest={up} previous={d.previous} />
        ) : (
          <div className="card">
            <div className="eyebrow">Your stage</div>
            <div className="stname">
              {d.client.stage_start} · {STAGES[d.client.stage_start - 1].name}
            </div>
            <p className="note">
              Your starting stage. Your stage, rung and Climb score update from your first monthly update below.
            </p>
          </div>
        )}

        <ConsentSwitch initial={d.client.consent} hasCoach={Boolean(coach)} />

        {d.note && (
          <div className="card ticks">
            <div className="eyebrow">
              From {coach ?? "your coach"} · {longDate(new Date(d.note.call_date))}
            </div>
            {d.note.message && (
              <p className="hand" style={{ margin: "8px 0" }}>
                &ldquo;{d.note.message}&rdquo;
              </p>
            )}
            {d.note.covered && <p className="note">We covered: {d.note.covered}</p>}
            {d.note.homework.length > 0 && (
              <>
                <h3 style={{ marginTop: 8 }}>My homework</h3>
                <Homework items={d.note.homework} />
              </>
            )}
            {d.note.next_session && (
              <p className="note" style={{ marginTop: 8 }}>
                Next session: <b style={{ color: "var(--cream)" }}>{longDate(new Date(d.note.next_session))}</b>
              </p>
            )}
          </div>
        )}

        <div className="card" id="update">
          <h3>Update this month</h3>
          <MonthlyUpdateForm
            takeHomeKnown={d.prefill.takeHomeKnown}
            prefill={
              // This month already saved? Show what was saved. Otherwise start from the Tracker.
              last && last.month === currentMonth() && last.stage !== null
                ? {
                    total: String(Number(last.total)),
                    openAccounts: String(last.open_accounts ?? ""),
                    minimums: String(Number(last.minimums ?? 0)),
                    gross: String(Number(last.gross ?? "")),
                    newCredit: last.new_credit ? "yes" : "no",
                    borrowing: last.borrowing ? "yes" : "no",
                    payday: String(d.client.payday),
                    ef: String(Number(last.ef_months ?? 0)),
                    assetIncome: last.asset_income ? String(Number(last.asset_income)) : "",
                  }
                : {
                    total: String(Math.round(d.prefill.total)),
                    openAccounts: String(d.prefill.openAccounts),
                    minimums: String(Math.round(d.prefill.minimums)),
                    gross: d.prefill.gross !== null ? String(d.prefill.gross) : last?.gross ? String(last.gross) : "",
                    newCredit: "",
                    borrowing: d.prefill.borrowing === true ? "yes" : d.prefill.borrowing === false ? "no" : "",
                    payday: String(d.client.payday),
                    ef: String(Number(last?.ef_months ?? 0)),
                    assetIncome: last?.asset_income ? String(Number(last.asset_income)) : "",
                  }
            }
          />
        </div>

        {d.history.length > 0 && (
          <div className="card">
            <h3>My progress</h3>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <DebtChart points={d.history.map((u) => ({ month: u.month, total: Number(u.total) }))} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function StageCard({ latest, previous }: { latest: MonthlyUpdate; previous: MonthlyUpdate | null }) {
  const stage = latest.stage!;
  const rung = latest.rung!;
  const S0 = STAGES[stage - 1];
  const prev: Position | null = previous ? { stage: previous.stage!, rung: previous.rung! } : null;
  const mv = movement({ stage, rung }, prev);
  const tone = !mv ? "" : mv.kind.startsWith("up") ? "green" : mv.kind === "same" ? "grey" : "amber";
  const load = latest.minimums !== null && latest.gross ? (Number(latest.minimums) / Number(latest.gross)) * 100 : null;
  const checks = stageChecks({
    gapAfterCuts: latest.gap_after_cuts === null ? null : Number(latest.gap_after_cuts),
    newCredit: Boolean(latest.new_credit),
    borrowing: Boolean(latest.borrowing),
    totalDebt: Number(latest.total),
    efMonths: Number(latest.ef_months ?? 0),
    assetIncome: Number(latest.asset_income ?? 0),
  })[stage as 1 | 2 | 3 | 4];

  return (
    <div className="card ticks">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="eyebrow">Your stage</div>
          <div className="stname">
            {S0.n} · {S0.name}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="rungs" aria-label={`Rung ${rung} of 5`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <i key={i} className={i <= rung ? "on" : ""} />
              ))}
            </span>
            <span className="note">
              rung {rung} of 5 · debt load {pct(load)}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right", marginLeft: "auto" }}>
          <div className="eyebrow" style={{ color: "var(--muted)" }}>
            Climb score
          </div>
          <div className="climb">{latest.climb}</div>
          {mv && (
            <div className="note">
              {mv.scoreChange > 0 ? "+" : mv.scoreChange < 0 ? "−" : "±"}
              {Math.abs(mv.scoreChange)} since last month
            </div>
          )}
        </div>
      </div>
      <div className="ladder5">
        {STAGES.map((x) => (
          <span key={x.n} className={x.n < stage ? "past" : x.n === stage ? "now" : ""}>
            {x.name}
          </span>
        ))}
      </div>
      <p style={{ margin: "10px 0 0" }}>{S0.say}</p>
      {mv && (
        <div className={`chip ${tone}`} style={{ marginTop: 10, whiteSpace: "normal", textTransform: "none", letterSpacing: 0, fontFamily: "var(--body)", fontSize: 13 }}>
          {mv.text}
        </div>
      )}
      {stage < 5 && (
        <>
          <h3 style={{ marginTop: 14 }}>Next stage: {STAGES[stage].name}</h3>
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? "ok" : ""}>
                {c.ok ? "✓" : "○"} {c.text}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="note" style={{ marginTop: 10 }}>
        Rungs follow your debt load, the share of your pay that goes to debt (Chapter 9). Your stage follows the five stages in
        Chapter 13. Both update every month, up or down. This is where you are, not who you are.
      </p>
      <p className="note">Total debt this month: {rand(Number(latest.total))}</p>
    </div>
  );
}
