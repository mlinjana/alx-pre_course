// Phase 1 end-to-end: the §14 "done when" scenario, in a real browser against the real app
// and a local Supabase (emails are caught by Mailpit).
//
//   npx supabase start && npm run build && npm start      (with .env.local pointing at local Supabase,
//                                                           OWNER_EMAILS=owner.e2e@example.test)
//   node tests/e2e/phase1.e2e.mjs
//
// Env: APP_URL (default http://localhost:3000), MAILPIT_URL (default http://127.0.0.1:54324),
//      CHROMIUM (default /opt/pw-browsers/chromium), SHOTS (folder for screenshots, optional).
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { totp } from "./totp.mjs";

const APP = process.env.APP_URL || "http://localhost:3000";
const MAIL = process.env.MAILPIT_URL || "http://127.0.0.1:54324";
const SHOTS = process.env.SHOTS;
const run = Date.now().toString(36);
const PASSWORD = "Test-password-123";
const clientEmail = `client.${run}@example.test`;
const coachEmail = `coach.${run}@example.test`;
const ownerEmail = "owner.e2e@example.test";
// Unique names per run, so earlier runs' data never confuses this one.
const clientName = `Sipho Khumalo${run}`;
const coachName = `Lindiwe Sithole${run}`;

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let step = 0;
const ok = (msg) => console.log(`ok   ${++step}. ${msg}`);
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png`, fullPage: true });
function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function confirmLink(to) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = await res.json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
      const m = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML || "");
      assert(m, `confirmation link in email to ${to}`);
      return m[1].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`FAIL: no email arrived for ${to}`);
}

async function signUp(page, email, asCoach) {
  await page.goto(`${APP}/join${asCoach ? "?as=coach" : ""}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button:has-text("Next →")');
  await page.getByText("Check your email").waitFor();
  await page.goto(await confirmLink(email));
}

// The test owner is reused between runs. Its two-step secret from an earlier run is unknown,
// so remove its authenticator (admin API) and let the run set up a new one.
// Needs SUPABASE_SECRET_KEY (and SUPABASE_URL if not the default) of the LOCAL Supabase.
let ownerExists = false;
{
  const admin = createClient(process.env.SUPABASE_URL || "http://127.0.0.1:54321", process.env.SUPABASE_SECRET_KEY || "", {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`FAIL: admin API (${error.message}). Set SUPABASE_SECRET_KEY.`);
  const old = data.users.find((u) => u.email === ownerEmail);
  if (old) {
    ownerExists = true;
    const factors = await admin.auth.admin.mfa.listFactors({ userId: old.id });
    for (const f of factors.data?.factors || []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: old.id });
    await admin.auth.admin.updateUserById(old.id, { password: PASSWORD });
  }
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" }); // empty the local test mailbox
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
try {
  // ------------------------------------------------------------------ client
  const client = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await client.goto(`${APP}/join`);
  await shot(client, "join");
  await client.fill('input[name="email"]', clientEmail);
  await client.fill('input[name="password"]', "short");
  await client.click('button:has-text("Next →")');
  await client.getByText("Your password needs 8 or more characters.").waitFor();
  assert((await client.inputValue('input[name="email"]')) === clientEmail, "email is kept after an error");
  ok("screen 1 says exactly what to fix, and keeps the email");

  await signUp(client, clientEmail, false);
  await client.waitForURL(`${APP}/join/details`);
  ok("client confirmed their email and reached screen 2");

  await client.click('button:has-text("Next →")');
  await client.getByText("Add your first name and surname.").waitFor();
  await client.fill('input[name="name"]', clientName);
  await client.click('button:has-text("Next →")');
  await client.getByText("Add your WhatsApp number so your coach can reach you.").waitFor();
  ok("screen 2 validation messages match the spec");

  await client.fill('input[name="whatsapp"]', "082 000 0000");
  await client.check('input[name="need"][value="Getting out of debt"]');
  await client.selectOption('select[name="heard"]', "LinkedIn");
  await shot(client, "about-you");
  await client.click('button:has-text("Next →")');
  await client.getByText("Four quick questions.").first().waitFor();
  await client.check('input[name="q1"][value="Just"]');
  await client.check('input[name="q2"][value="No"]');
  await client.check('input[name="q3"][value="Yes"]');
  await client.check('input[name="q4"][value="No"]');
  await client.click('button:has-text("Join MFG")');
  await client.getByText("Tick the box to agree to the Terms and Privacy Policy.").waitFor();
  assert(await client.isChecked('input[name="q1"][value="Just"]'), "answers are kept after an error");
  await client.check('input[name="terms"]');
  await shot(client, "where-you-are");
  await client.click('button:has-text("Join MFG")');
  await client.waitForURL(`${APP}/welcome`);
  const welcome = await client.textContent("main");
  assert(welcome.includes("2 · Stability"), "Q3 = Yes gives Stage 2");
  assert(welcome.includes("You're in the waiting room."), "welcome explains the waiting room");
  await shot(client, "welcome");
  ok("client joined: starting stage 2 · Stability, waiting room explained");

  // ------------------------------------------------------------------ coach applicant
  const coach = await (await browser.newContext()).newPage();
  await signUp(coach, coachEmail, true);
  await coach.waitForURL(`${APP}/apply`);
  await coach.fill('input[name="name"]', coachName);
  await coach.fill('input[name="whatsapp"]', "072 000 0000");
  await coach.selectOption('select[name="province"]', "Gauteng");
  await coach.selectOption('select[name="experience"]', "Professional coach or mentor");
  await coach.selectOption('select[name="readBook"]', "Yes, all of it");
  await coach.fill('input[name="capacity"]', "4");
  await coach.fill('textarea[name="why"]', "Too short");
  await coach.click('button:has-text("Send my application")');
  await coach.getByText("Tell us a little more about why you want to coach").waitFor();
  await coach.fill('textarea[name="why"]', "I cleared my own store accounts and want to help others do the same.");
  await coach.check('input[name="agreed"]');
  await coach.click('button:has-text("Send my application")');
  await coach.waitForURL(`${APP}/apply/thanks`);
  ok("coach applied and sees 'We'll be in touch'");

  // ------------------------------------------------------------------ owner
  const owner = await (await browser.newContext()).newPage();
  if (ownerExists) {
    await owner.goto(`${APP}/login`);
    await owner.fill('input[name="email"]', ownerEmail);
    await owner.fill('input[name="password"]', PASSWORD);
    await owner.click('button:has-text("Log in")');
  } else {
    await signUp(owner, ownerEmail, false);
  }
  await owner.waitForURL(/\/mfa/);
  await shot(owner, "mfa");
  const secret = (await owner.textContent("code"))?.trim();
  assert(secret, "set-up key shown for the authenticator app");
  await owner.fill('input[autocomplete="one-time-code"]', totp(secret));
  await owner.click('button:has-text("Continue")');
  await owner.waitForURL(`${APP}/owner`);
  ok("owner set up two-step login and reached the Owner view");

  const app = owner.locator(".appcard", { hasText: coachName });
  await app.getByRole("button", { name: "Approve for training" }).click();
  await owner.locator(".toast").getByText(`${coachName} is approved for training.`).waitFor();
  ok("owner approved the application (no email yet: sending not set up)");

  await owner.reload();
  const row = owner.locator("tr", { hasText: coachEmail });
  await row.getByRole("button", { name: "Mark certified" }).click();
  await owner.locator(".toast").getByText("Marked certified.", { exact: false }).waitFor();
  ok("owner certified the coach");

  await owner.reload();
  const waiting = owner.locator("section", { hasText: "Waiting room" }).locator("tr", { hasText: clientName });
  const selected = await waiting.locator("select").inputValue();
  assert(selected, "a coach is pre-selected (least busy)");
  await shot(owner, "owner-waiting-room");
  await waiting.getByRole("button", { name: "Assign" }).click();
  await owner.locator(".toast").getByText(`${clientName} is now with`, { exact: false }).waitFor();
  await shot(owner, "owner-assigned");
  ok("owner assigned the client to the least busy coach");

  // ------------------------------------------------------------------ client sees their coach
  await client.goto(`${APP}/home`);
  await client.waitForLoadState("networkidle");
  const home = await client.textContent("main");
  assert(!home.includes("Waiting room"), "client has left the waiting room");
  await shot(client, "client-home");
  ok("client's home shows their coach");

  console.log(`\nAll ${step} end-to-end checks passed.`);
} finally {
  await browser.close();
}
