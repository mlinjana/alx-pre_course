// Phase 1 integration test against a REAL Supabase (local: `npx supabase start`).
// Uses real logins, real JWTs and real two-step codes, through the same API the app uses.
// Run: npm run test:integration   (needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { totp } from "./totp";

const URL = process.env.SUPABASE_URL!;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "Test-password-123";
const run = Date.now().toString(36);
const email = (who: string) => `${who}.${run}@example.test`;

const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const fresh = () => createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });

type Person = { id: string; db: SupabaseClient };

async function makeUser(who: string, opts: { owner?: boolean; name: string }): Promise<Person> {
  const { data, error } = await admin.auth.admin.createUser({ email: email(who), password: PASSWORD, email_confirm: true });
  if (error) throw error;
  // What syncAccount() does after sign-in:
  await admin.from("profiles").upsert({ id: data.user.id, email: email(who), is_owner: !!opts.owner });
  const db = fresh();
  const signIn = await db.auth.signInWithPassword({ email: email(who), password: PASSWORD });
  if (signIn.error) throw signIn.error;
  await db.from("profiles").update({ full_name: opts.name }).eq("id", data.user.id);
  return { id: data.user.id, db };
}

/** Enrol an authenticator and step the session up to aal2, like the /mfa page does. */
async function twoStep(p: Person) {
  const enrol = await p.db.auth.mfa.enroll({ factorType: "totp", friendlyName: `app-${run}-${p.id.slice(0, 4)}` });
  if (enrol.error) throw enrol.error;
  const verify = await p.db.auth.mfa.challengeAndVerify({ factorId: enrol.data.id, code: totp(enrol.data.totp.secret) });
  if (verify.error) throw verify.error;
  const { data } = await p.db.auth.getClaims();
  expect(data?.claims.aal).toBe("aal2");
}

let owner: Person, coachA: Person, coachB: Person, client1: Person, client2: Person, applicant: Person;

beforeAll(async () => {
  [owner, coachA, coachB, client1, client2, applicant] = await Promise.all([
    makeUser("owner", { owner: true, name: "Test Owner" }),
    makeUser("coacha", { name: "Nomsa Dlamini" }),
    makeUser("coachb", { name: "Kagiso Phiri" }),
    makeUser("client1", { name: "Sipho Khumalo" }),
    makeUser("client2", { name: "Palesa Mokoena" }),
    makeUser("applicant", { name: "Lindiwe Sithole" }),
  ]);
}, 60_000);

describe("Phase 1 with real logins", () => {
  it("clients sign up through RLS and land in the waiting room", async () => {
    for (const [c, stage] of [[client1, 1], [client2, 2]] as const) {
      const { error } = await c.db.from("clients").insert({
        id: c.id, need: "Getting out of debt", heard_from: "LinkedIn", auth_method: "email", stage_start: stage, consent: true,
      });
      expect(error).toBeNull();
    }
    const { data } = await client1.db.from("clients").select("status, consent_at");
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe("waiting");
    expect(data![0].consent_at).toBeTruthy();
  });

  it("a client can't sign someone else up, or make themselves owner", async () => {
    const { error } = await client1.db.from("clients").insert({
      id: client2.id, need: "Building wealth", heard_from: "Other", auth_method: "email", stage_start: 3,
    });
    expect(error).not.toBeNull();
    const promote = await client1.db.from("profiles").update({ is_owner: true }).eq("id", client1.id);
    expect(promote.error).not.toBeNull();
  });

  it("anyone signed in can apply to coach; only the owner reads applications", async () => {
    const { error } = await applicant.db.from("coach_applications").insert({
      full_name: "Lindiwe Sithole", email: email("applicant"), whatsapp: "072 000 0000", province: "Gauteng",
      experience: "Professional coach or mentor", read_book: "Part of it", capacity: 3,
      why: "I want to help people in my community climb out of debt.", agreed_protocol: true,
    });
    expect(error).toBeNull();
    expect((await applicant.db.from("coach_applications").select("id")).data).toEqual([]);
    expect((await applicant.db.rpc("my_application_status")).data).toBe("pending");
  });

  it("the owner can't act without two-step login", async () => {
    const { data } = await owner.db.from("coach_applications").select("id");
    expect(data).toEqual([]);
    const assign = await owner.db.rpc("assign_client", { p_client: client1.id, p_coach: coachA.id });
    expect(assign.error?.message).toMatch(/Only the owner/);
  });

  it("with two-step login the owner approves, certifies and assigns", async () => {
    await twoStep(owner);
    const apps = await owner.db.from("coach_applications").select("*").eq("applicant_id", applicant.id);
    expect(apps.data).toHaveLength(1);

    // Approve for training, then certify
    const approve = await owner.db.from("coaches").insert({ id: applicant.id, status: "training", capacity: 3, application_id: apps.data![0].id });
    expect(approve.error).toBeNull();
    const notYet = await owner.db.rpc("assign_client", { p_client: client1.id, p_coach: applicant.id });
    expect(notYet.error?.message).toMatch(/certified/);

    // Add coaches A (capacity 1) and B directly
    const add = await owner.db.from("coaches").insert([
      { id: coachA.id, status: "certified", capacity: 1 },
      { id: coachB.id, status: "certified", capacity: 5 },
    ]);
    expect(add.error).toBeNull();

    expect((await owner.db.rpc("assign_client", { p_client: client1.id, p_coach: coachA.id })).error).toBeNull();
    const full = await owner.db.rpc("assign_client", { p_client: client2.id, p_coach: coachA.id });
    expect(full.error?.message).toBe("Nomsa Dlamini is full. Pick another coach or raise their capacity.");
    expect((await owner.db.rpc("assign_client", { p_client: client2.id, p_coach: coachB.id })).error).toBeNull();

    const status = await owner.db.from("clients").select("status").in("id", [client1.id, client2.id]);
    expect(status.data!.every((r) => r.status === "active")).toBe(true);
  });

  it("coaches need two-step login, then see only their own clients", async () => {
    expect((await coachA.db.from("clients").select("id")).data).toEqual([]);
    await twoStep(coachA);
    const mine = await coachA.db.from("clients").select("id");
    expect(mine.data!.map((r) => r.id)).toEqual([client1.id]);
    const names = await coachA.db.from("profiles").select("full_name").eq("id", client2.id);
    expect(names.data).toEqual([]);
    const assign = await coachA.db.rpc("assign_client", { p_client: client2.id, p_coach: coachA.id });
    expect(assign.error).not.toBeNull();
  });

  it("the client sees their coach's name", async () => {
    const a = await client1.db.from("assignments").select("coach_id").is("ended_at", null).single();
    const p = await client1.db.from("profiles").select("full_name").eq("id", a.data!.coach_id).single();
    expect(p.data!.full_name).toBe("Nomsa Dlamini");
  });

  it("moving a client respects capacity and hands over access", async () => {
    // Move client1 from A to B
    expect((await owner.db.rpc("assign_client", { p_client: client1.id, p_coach: coachB.id })).error).toBeNull();
    expect((await coachA.db.from("clients").select("id")).data).toEqual([]);
    // A has space again
    expect((await owner.db.rpc("assign_client", { p_client: client2.id, p_coach: coachA.id })).error).toBeNull();
  });
});
