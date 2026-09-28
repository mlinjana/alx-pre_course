// Phase 3 "done when": turning consent off blocks the coach (tested with real logins and JWTs).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { totp } from "./totp";

const URL = process.env.SUPABASE_URL!;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const PASSWORD = "Test-password-123";
const run = Date.now().toString(36);
const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

async function person(who: string, name: string, owner = false) {
  const email = `${who}.${run}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  await admin.from("profiles").upsert({ id: data.user.id, email, full_name: name, is_owner: owner });
  const db = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (s.error) throw s.error;
  return { id: data.user.id, db };
}
async function twoStep(db: SupabaseClient) {
  const e = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: `f-${Math.random()}` });
  if (e.error) throw e.error;
  const v = await db.auth.mfa.challengeAndVerify({ factorId: e.data.id, code: totp(e.data.totp.secret) });
  if (v.error) throw v.error;
}

let owner: Awaited<ReturnType<typeof person>>, coach: Awaited<ReturnType<typeof person>>, client: Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  [owner, coach, client] = await Promise.all([person("own3", "Owner Three", true), person("coach3", "Coach Three"), person("client3", "Client Three")]);
  await client.db.from("clients").insert({ id: client.id, need: "Getting out of debt", heard_from: "Other", auth_method: "email", stage_start: 1, consent: true });
  await client.db.from("debts").insert({ client_id: client.id, debt_type: "Credit card", balance: 5000, rate: 20, minimum: 250 });
  await client.db.from("monthly_updates").insert({ client_id: client.id, month: "2026-09-01", total: 5000, stage: 2, rung: 5, climb: 433 });
  await twoStep(owner.db);
  await admin.from("coaches").insert({ id: coach.id, status: "certified", capacity: 3 });
  const a = await owner.db.rpc("assign_client", { p_client: client.id, p_coach: coach.id });
  if (a.error) throw a.error;
  await twoStep(coach.db);
}, 60_000);

const coachSees = async () => ({
  debts: (await coach.db.from("debts").select("id").eq("client_id", client.id)).data!.length,
  updates: (await coach.db.from("monthly_updates").select("month").eq("client_id", client.id)).data!.length,
  name: (await coach.db.from("profiles").select("full_name").eq("id", client.id)).data!.length,
});

describe("consent switch (§8, §11.1)", () => {
  it("with sharing on, the assigned coach sees the numbers", async () => {
    expect(await coachSees()).toEqual({ debts: 1, updates: 1, name: 1 });
  });

  it("switching it off blocks the coach at once, but they still see the name", async () => {
    const { error } = await client.db.from("clients").update({ consent: false }).eq("id", client.id);
    expect(error).toBeNull();
    expect(await coachSees()).toEqual({ debts: 0, updates: 0, name: 1 });
  });

  it("the change is recorded with a time", async () => {
    const { data } = await client.db.from("consent_events").select("consent, at").eq("client_id", client.id).order("at");
    expect(data!.map((e) => e.consent)).toEqual([true, false]);
  });

  it("switching it back on restores access", async () => {
    await client.db.from("clients").update({ consent: true }).eq("id", client.id);
    expect(await coachSees()).toEqual({ debts: 1, updates: 1, name: 1 });
  });

  it("the client can't change their payday reminder record or anyone else's consent", async () => {
    const r = await client.db.from("clients").update({ payday_reminded_for: "2026-01-01" }).eq("id", client.id);
    expect(r.error).not.toBeNull();
    const other = await client.db.from("clients").update({ consent: false }).eq("id", coach.id).select("id");
    expect(other.data).toEqual([]);
  });
});
