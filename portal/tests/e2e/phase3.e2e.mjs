// Phase 3 end-to-end (§14): stage and Climb score change correctly when the numbers change.
//   node tests/e2e/phase3.e2e.mjs   (app + local Supabase; needs SUPABASE_SECRET_KEY of the LOCAL Supabase)
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { APP, assert, count, newClient, ok } from "./helpers.mjs";

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/p3-${String(count()).padStart(2, "0")}-${name}.png`, fullPage: true });
const admin = createClient(process.env.SUPABASE_URL || "http://127.0.0.1:54321", process.env.SUPABASE_SECRET_KEY || "", { auth: { persistSession: false } });
const run = Date.now().toString(36);
const email = `dash.${run}@example.test`;

// This month and last month in South Africa.
const sa = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const thisMonth = `${sa.slice(0, 7)}-01`;
const [y, m] = sa.split("-").map(Number);
const lastMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
try {
  const page = await (await browser.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
  await newClient(page, email, "Lerato Mokoena", { q1: "No", q2: "No", q3: "Yes", q4: "No" }); // starts in Survival

  // Tracker basics: one debt, take-home R12,000, pay before deductions R16,000, rent R4,000.
  await page.goto(`${APP}/tracker`);
  await page.click('button:has-text("+ Add a debt")');
  const card = page.locator(".debts > .card").first();
  await card.getByLabel("Who is it with?").selectOption({ label: "Capitec" });
  await card.getByLabel("Balance owed (R)").fill("10000");
  await card.getByLabel("Interest rate (% a year)").fill("20");
  await card.getByLabel("Minimum (R a month)").fill("1000");
  await page.click('button:has-text("Next: My month")');
  await page.getByLabel("Take-home pay (R a month, after deductions)").fill("12000");
  await page.getByLabel("Pay before deductions (R a month)").fill("16000");
  await page.getByLabel("Rent amount").fill("4000");
  await page.locator(".savebar", { hasText: "Saved to your account" }).waitFor();
  ok("tracker filled in");

  // A coach and last month's update (Stability, rung 5), set up directly in the local database.
  const { data: u } = await admin.from("profiles").select("id").eq("email", email).single();
  const coachUser = await admin.auth.admin.createUser({ email: `c.${run}@example.test`, password: "Test-password-123", email_confirm: true });
  await admin.from("profiles").upsert({ id: coachUser.data.user.id, email: `c.${run}@example.test`, full_name: "Nomsa Dlamini" });
  await admin.from("coaches").insert({ id: coachUser.data.user.id, status: "certified", capacity: 5 });
  await admin.from("assignments").insert({ client_id: u.id, coach_id: coachUser.data.user.id, assigned_by: coachUser.data.user.id });
  await admin.from("clients").update({ status: "active", payday: 1 }).eq("id", u.id);
  await admin.from("programme").insert({ client_id: u.id, week: 3 });
  // updated_at is set on insert (the trigger stamps "now" on every later update).
  await admin.from("monthly_updates").insert({ client_id: u.id, month: lastMonth, total: 11000, minimums: 1000, gross: 16000, gap_after_cuts: 7000, new_credit: false, borrowing: false, ef_months: 0, stage: 2, rung: 5, climb: 433, updated_at: `${lastMonth}T08:00:00Z` });

  await page.goto(`${APP}/home`);
  const home = await page.textContent("main");
  assert(home.includes("It's past your payday on the 1st. Update your numbers so Nomsa D. sees where you are."), "payday check-in shown");
  assert(home.includes("Week 3 of 12 · The true cost"), "programme card");
  ok("payday check-in and programme card shown");

  // Submit the monthly update, then wait until the stage card shows the expected result.
  async function update({ minimums = "1000", newCredit = "no", expect }) {
    const form = page.locator("#update form");
    await form.getByLabel("Minimum debt payments this month (R)").fill(minimums);
    await form.getByLabel("Did you take any new credit this month?").selectOption(newCredit);
    await form.getByLabel("Did you borrow to pay a debt?").selectOption("no");
    await form.getByRole("button", { name: "Save my update" }).click();
    const stageCard = page.locator(".card.ticks").first();
    await stageCard.filter({ hasText: expect }).waitFor({ timeout: 15000 }).catch(() => {});
    return stageCard.textContent();
  }

  // 1. Same position as last month. Gap after cuts = 12,000 − (4,000 + 1,000) = 7,000; load 1,000 ÷ 16,000 = 6.25% → rung 5.
  let card1 = await update({ expect: "Holding steady" });
  assert(card1.includes("2 · Stability") && card1.includes("433") && card1.includes("Holding steady. Consistency is how the climb works."), `stage 2, rung 5, 433, holding steady (got ${card1})`);
  assert(!(await page.textContent("main")).includes("past your payday"), "payday check-in gone after updating");
  await shot(page, "steady");
  ok("update 1: Stability, rung 5, Climb 433 = 100 + (5 + 4) × 37; 'Holding steady'; payday check-in cleared");

  // 2. New credit this month → back to Survival: 100 + (0 + 4) × 37 = 248, down 185.
  card1 = await update({ newCredit: "yes", expect: "1 · Survival" });
  assert(card1.includes("1 · Survival") && card1.includes("248") && card1.includes("−185 since last month"), `stage 1, 248, −185 (got ${card1})`);
  assert(card1.includes("Your numbers moved you back to Survival this month. That's information, not a verdict."), "kind down-a-stage words");
  assert(card1.includes("No new credit this month"), "next-stage checklist");
  await shot(page, "back-a-stage");
  ok("update 2: new credit → Survival, Climb 248 (−185), kind message, checklist shows what to fix");

  // 3. No new credit, minimums R7,200: load 45% → rung 2; gap 12,000 − 11,200 = 800 → Stability. 100 + (5 + 1) × 37 = 322.
  card1 = await update({ minimums: "7200", expect: "Down a rung" });
  assert(card1.includes("2 · Stability") && card1.includes("322") && card1.includes("Down a rung this month. Hard months happen on every climb."), `stage 2, rung 2, 322 (got ${card1})`);
  assert(card1.includes("debt load 45.0%"), "debt load shown");
  ok("update 3: minimums up → rung 2, Climb 322, 'Down a rung' message");

  // Consent switch persists
  await page.getByRole("switch").uncheck();
  await page.getByText("Off: your coach can't see your numbers.").waitFor();
  await page.reload();
  assert(!(await page.getByRole("switch").isChecked()), "consent off saved");
  ok("sharing switch saves (coach blocking is tested in tests/integration/phase3.test.ts)");

  const { data: saved } = await admin.from("monthly_updates").select("stage, rung, climb").eq("client_id", u.id).eq("month", thisMonth).single();
  assert(saved.stage === 2 && saved.rung === 2 && saved.climb === 322, "saved in the database");
  ok("stage, rung and score saved with the month");

  console.log(`\nAll ${count()} Phase 3 end-to-end checks passed.`);
} finally {
  await browser.close();
}
