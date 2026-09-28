import type { Metadata } from "next";
import Link from "next/link";
import { Brand, LogoutButton } from "@/components/brand";
import { IdleTimer } from "@/components/idle-timer";
import { FlashArea } from "@/components/flash";
import { staffIdleTimeoutMs } from "@/lib/env";
import { AUTH_METHOD_LABEL, STAGES } from "@/lib/domain/constants";
import {
  capacityColour,
  daysWaiting,
  leastBusyCoach,
  loadLabel,
  waitingColour,
  waitingLabel,
  type CoachLoad,
} from "@/lib/domain/assignment";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/viewer";
import { ActionForm } from "./action-form";
import {
  addCoachDirectly,
  approveApplication,
  assignClient,
  declineApplication,
  markCertified,
  setCapacity,
  setCoachActive,
} from "./actions";

export const metadata: Metadata = { title: "Owner" };

type Person = { full_name: string | null; email: string; whatsapp: string | null };
const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

export default async function OwnerPage() {
  const v = await requireStaff("owner", "/owner");
  const supabase = await createClient();

  const [clientsRes, coachesRes, assignRes, appsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, status, need, heard_from, auth_method, stage_start, consent, created_at, profiles(full_name, email, whatsapp)")
      .order("created_at", { ascending: true }),
    supabase
      .from("coaches")
      .select("id, status, capacity, invite_sent_at, created_at, profiles(full_name, email, whatsapp)")
      .order("created_at", { ascending: true }),
    supabase.from("assignments").select("client_id, coach_id").is("ended_at", null),
    supabase.from("coach_applications").select("*").eq("status", "pending").order("created_at", { ascending: true }),
  ]);

  const failed = [clientsRes, coachesRes, assignRes, appsRes].some((r) => r.error);
  const clients = (clientsRes.data || []).map((c) => ({ ...c, person: one(c.profiles as Person | Person[] | null) }));
  const assignments = assignRes.data || [];
  const coachOf = new Map(assignments.map((a) => [a.client_id, a.coach_id]));
  const loadOf = (id: string) => assignments.filter((a) => a.coach_id === id).length;
  const coaches = (coachesRes.data || []).map((c) => {
    const person = one(c.profiles as Person | Person[] | null);
    return { ...c, person, name: person?.full_name || person?.email || "Coach", load: loadOf(c.id) };
  });
  const loads: CoachLoad[] = coaches.map((c) => ({ id: c.id, name: c.name, status: c.status, capacity: c.capacity, clients: c.load }));
  const certified = loads.filter((c) => c.status === "certified");
  const suggested = leastBusyCoach(loads);
  const waiting = clients.filter((c) => c.status === "waiting");
  const active = clients.filter((c) => c.status === "active");
  const apps = appsRes.data || [];
  const openPlaces = certified.reduce((a, c) => a + Math.max(0, c.capacity - c.clients), 0);
  const now = new Date();
  const nameOf = (id: string | undefined) => coaches.find((c) => c.id === id)?.name || "—";

  return (
    <>
      <IdleTimer timeoutMs={staffIdleTimeoutMs()} />
      <FlashArea />
      <Brand
        right={
          <div className="row">
            {v.coach && (
              <Link className="btn ghost small" href="/coach">
                My clients
              </Link>
            )}
            <LogoutButton />
          </div>
        }
      />
      <div className="stack" style={{ marginTop: 20 }}>
        <div>
          <div className="eyebrow">Owner view · only you see this</div>
          <h1>
            MFG at a <u>glance</u>
          </h1>
        </div>
        {failed && <div className="suerr">Some information didn&apos;t load. Refresh the page.</div>}

        <div className="kpis">
          <Flap k="Waiting room" v={waiting.length} s={waiting.length ? "Need a coach" : "Everyone matched"} tone={waiting.length ? "amber" : "green"} />
          <Flap k="Coaches" v={coaches.length} s={`${openPlaces} open places`} />
          <Flap k="Active clients" v={active.length} s={`${active.filter((c) => c.consent).length} sharing numbers`} />
        </div>

        {/* ---------------------------------------------------------- waiting room */}
        <section className="card ticks" style={waiting.length ? { borderColor: "rgba(240,168,87,.45)" } : undefined} aria-labelledby="wr">
          <h2 id="wr">Waiting room ({waiting.length})</h2>
          <p className="note">Every new sign-up lands here. Only you assign a coach. The dropdown shows each coach&apos;s load.</p>
          {waiting.length === 0 ? (
            <p className="note">Nobody waiting. Every client has a coach.</p>
          ) : (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>New client</th>
                    <th>Waiting</th>
                    <th>Needs help with</th>
                    <th>Stage</th>
                    <th>Assign to</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((c) => {
                    const d = daysWaiting(new Date(c.created_at), now);
                    const name = c.person?.full_name || c.person?.email || "New client";
                    return (
                      <tr key={c.id}>
                        <td>
                          <b>{name}</b>
                          <div className="note">
                            via {c.heard_from} · {AUTH_METHOD_LABEL[c.auth_method] || c.auth_method}
                            {c.consent ? " · sharing on" : " · not sharing yet"}
                          </div>
                        </td>
                        <td>
                          <span className={`chip ${waitingColour(d)}`}>{waitingLabel(d)}</span>
                        </td>
                        <td>{c.need}</td>
                        <td className="note">
                          {c.stage_start} · {STAGES[c.stage_start - 1].name}
                        </td>
                        <td>
                          <CoachPicker clientId={c.id} name={name} coaches={certified} selected={suggested?.id} submitLabel="Assign" />
                          {suggested ? (
                            <div className="note">Suggested: least busy</div>
                          ) : (
                            <div className="note" style={{ color: "var(--red)" }}>
                              {certified.length ? "All coaches are full" : "No certified coaches yet"}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- applications */}
        <section className="card ticks" style={apps.length ? { borderColor: "rgba(240,168,87,.45)" } : undefined} aria-labelledby="ap">
          <h2 id="ap">Coach applications ({apps.length})</h2>
          <p className="note">
            People who applied to coach with MFG. Approving someone starts their training. They can take clients once you mark
            them certified.
          </p>
          {apps.length === 0 && <p className="note">No applications waiting.</p>}
          {apps.map((a) => (
            <div className="appcard" key={a.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b>{a.full_name}</b> <span className="note">· {a.province} · applied {fmtDate(a.created_at)}</span>
                </div>
                <div className="row">
                  <ActionForm action={approveApplication}>
                    <input type="hidden" name="application" value={a.id} />
                    <button className="btn gold small" type="submit">
                      Approve for training
                    </button>
                  </ActionForm>
                  <ActionForm action={declineApplication} confirm={`Decline ${a.full_name}'s application? They will get an email.`}>
                    <input type="hidden" name="application" value={a.id} />
                    <button className="btn ghost small" type="submit">
                      Decline
                    </button>
                  </ActionForm>
                </div>
              </div>
              <div className="appgrid">
                <span className="note">Experience</span>
                <span>{a.experience}</span>
                <span className="note">Read the book</span>
                <span>{a.read_book}</span>
                <span className="note">Clients they could take</span>
                <span>{a.capacity}</span>
                {a.qualifications && (
                  <>
                    <span className="note">Qualifications</span>
                    <span>{a.qualifications}</span>
                  </>
                )}
                <span className="note">Why MFG</span>
                <span style={{ whiteSpace: "pre-wrap" }}>{a.why}</span>
                <span className="note">Contact</span>
                <span>
                  {a.email} · {a.whatsapp}
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* ---------------------------------------------------------- coaches */}
        <section className="card" aria-labelledby="co">
          <h2 id="co">Coaches ({coaches.length})</h2>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Coach</th>
                  <th>Status</th>
                  <th>Login</th>
                  <th className="n">Clients</th>
                  <th>Capacity</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {coaches.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {c.person?.whatsapp && <div className="note">{c.person.whatsapp}</div>}
                    </td>
                    <td>
                      <div className="row">
                        {c.status === "certified" && <span className="chip green">Certified</span>}
                        {c.status === "training" && <span className="chip amber">In training</span>}
                        {c.status === "inactive" && <span className="chip grey">Paused</span>}
                        {c.status === "training" && (
                          <ActionForm action={markCertified}>
                            <input type="hidden" name="coach" value={c.id} />
                            <button className="btn ghost small" type="submit">
                              Mark certified
                            </button>
                          </ActionForm>
                        )}
                        <ActionForm
                          action={setCoachActive}
                          confirm={c.status === "inactive" ? undefined : `Pause ${c.name}? They will stop seeing all their clients until you switch them back on.`}
                        >
                          <input type="hidden" name="coach" value={c.id} />
                          <input type="hidden" name="pause" value={c.status === "inactive" ? "0" : "1"} />
                          <button className="btn ghost small" type="submit">
                            {c.status === "inactive" ? "Switch back on" : "Pause"}
                          </button>
                        </ActionForm>
                      </div>
                    </td>
                    <td className="note">
                      {c.person?.email}
                      {c.id === v.userId && " · you"}
                      {c.invite_sent_at && <> <span className="chip amber">Invite sent</span></>}
                    </td>
                    <td className="n">{c.load}</td>
                    <td>
                      <ActionForm action={setCapacity}>
                        <input type="hidden" name="coach" value={c.id} />
                        <span className={`chip ${capacityColour(c.load, c.capacity)}`}>
                          {c.load}/{c.capacity}
                        </span>
                        <label className="f" style={{ flexDirection: "row", alignItems: "center" }}>
                          <span className="sr-only">Capacity for {c.name}</span>
                          <input name="capacity" defaultValue={c.capacity} inputMode="numeric" size={3} style={{ width: 56 }} />
                        </label>
                        <button className="btn ghost small" type="submit">
                          Save
                        </button>
                      </ActionForm>
                    </td>
                    <td className="note">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="add">
            <summary>Add a coach directly</summary>
            <p className="note">Creates a certified coach and emails them a login invite. To coach yourself, use your own email.</p>
            <ActionForm action={addCoachDirectly} className="stack">
              <div className="two">
                <label className="f">
                  Full name
                  <input name="name" autoComplete="off" />
                </label>
                <label className="f">
                  Email (their login)
                  <input name="email" type="email" autoComplete="off" />
                </label>
              </div>
              <div className="two">
                <label className="f">
                  WhatsApp number
                  <input name="whatsapp" inputMode="tel" autoComplete="off" />
                </label>
                <label className="f">
                  Capacity (most clients at once)
                  <input name="capacity" inputMode="numeric" placeholder="e.g. 5" />
                </label>
              </div>
              <button className="btn gold" type="submit" style={{ alignSelf: "flex-start" }}>
                Add coach and send invite
              </button>
            </ActionForm>
          </details>
        </section>

        {/* ---------------------------------------------------------- all clients */}
        <section className="card" aria-labelledby="ac">
          <h2 id="ac">All clients ({active.length})</h2>
          <p className="note">Move a client to another coach from here. Stage, momentum and flags arrive with the Tracker and dashboard.</p>
          {active.length === 0 ? (
            <p className="note">No active clients yet.</p>
          ) : (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Coach</th>
                    <th>Sharing</th>
                    <th>Starting stage</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((c) => {
                    const name = c.person?.full_name || c.person?.email || "Client";
                    const current = coachOf.get(c.id);
                    return (
                      <tr key={c.id}>
                        <td>{name}</td>
                        <td>
                          <div className="note">Now: {nameOf(current)}</div>
                          <CoachPicker clientId={c.id} name={name} coaches={certified} selected={current} submitLabel="Move" />
                        </td>
                        <td>{c.consent ? <span className="chip green">On</span> : <span className="chip grey">Off</span>}</td>
                        <td className="note">
                          {c.stage_start} · {STAGES[c.stage_start - 1].name}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Flap({ k, v, s, tone }: { k: string; v: number | string; s: string; tone?: "red" | "amber" | "green" }) {
  return (
    <div className={`flap ${tone || ""}`}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span className="s">{s}</span>
    </div>
  );
}

function CoachPicker({
  clientId,
  name,
  coaches,
  selected,
  submitLabel,
}: {
  clientId: string;
  name: string;
  coaches: CoachLoad[];
  selected?: string;
  submitLabel: string;
}) {
  if (coaches.length === 0) return null;
  return (
    <ActionForm action={assignClient}>
      <input type="hidden" name="client" value={clientId} />
      <select name="coach" aria-label={`Coach for ${name}`} defaultValue={selected ?? ""}>
        {!selected && <option value="">Choose a coach</option>}
        {coaches.map((c) => (
          <option key={c.id} value={c.id}>
            {loadLabel(c)}
            {c.clients >= c.capacity ? " full" : ""}
          </option>
        ))}
      </select>
      <button className="btn gold small" type="submit">
        {submitLabel}
      </button>
    </ActionForm>
  );
}
