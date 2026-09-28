// Shared helpers for the browser tests (local Supabase + Mailpit).
export const APP = process.env.APP_URL || "http://localhost:3000";
export const MAIL = process.env.MAILPIT_URL || "http://127.0.0.1:54324";
export const PASSWORD = "Test-password-123";

let step = 0;
export const ok = (msg) => console.log(`ok   ${++step}. ${msg}`);
export const count = () => step;
export function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

export async function confirmLink(to) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
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

/** Sign up a new client and finish screens 2 and 3. Ends on /welcome. */
export async function newClient(page, email, name, answers = { q1: "Just", q2: "No", q3: "Yes", q4: "No" }) {
  await page.goto(`${APP}/join`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button:has-text("Next →")');
  await page.getByText("Check your email").waitFor();
  await page.goto(await confirmLink(email));
  await page.waitForURL(`${APP}/join/details`);
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="whatsapp"]', "082 000 0000");
  await page.check('input[name="need"][value="Getting out of debt"]');
  await page.selectOption('select[name="heard"]', "LinkedIn");
  await page.click('button:has-text("Next →")');
  for (const [k, v] of Object.entries(answers)) await page.check(`input[name="${k}"][value="${v}"]`);
  await page.check('input[name="terms"]');
  await page.click('button:has-text("Join MFG")');
  await page.waitForURL(`${APP}/welcome`);
}

export async function logIn(page, email) {
  await page.goto(`${APP}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button:has-text("Log in")');
}
