// Phase 2 end-to-end (§14): a test client completes all 5 Tracker steps and downloads the PDF;
// the data is still there after logging out and back in.
//   node tests/e2e/phase2.e2e.mjs   (app on APP_URL, local Supabase + Mailpit; see phase1.e2e.mjs)
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { APP, assert, count, logIn, newClient, ok } from "./helpers.mjs";

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const email = `tracker.${run}@example.test`;
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/p2-${String(count()).padStart(2, "0")}-${name}.png`, fullPage: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await newClient(page, email, "Thandi Nkosi");
  await page.click('a:has-text("Start my Debt Ladder Tracker")');
  await page.waitForURL(`${APP}/tracker`);
  await page.getByText("No debts listed yet.").waitFor();
  ok("a new client starts with an empty Tracker (no example debts)");

  const saved = () => page.locator(".savebar", { hasText: "Saved to your account" }).waitFor();
  const card = (n) => page.locator(".debts > .card").nth(n);

  // ------------------------------------------------------------ Step 1
  await page.click('button:has-text("+ Add a debt")');
  await card(0).locator("select").first().selectOption("Credit card");
  await card(0).getByRole("button", { name: "FNB" }).click();
  await card(0).getByLabel("Balance owed (R)").fill("14800");
  await card(0).getByLabel("Interest rate (% a year)").fill("21");
  await card(0).getByLabel("Minimum (R a month)").fill("974");
  await card(0).getByText("True cost at the minimum:").waitFor();
  ok("debt 1 (FNB credit card) shows its true cost at the minimum");

  await page.click('button:has-text("+ Add a debt")');
  await card(1).locator("select").first().selectOption("Store account");
  await card(1).getByRole("button", { name: "Other" }).click();
  await card(1).getByLabel("Name exactly as it appears on your statement or SMS").fill("store");
  await card(1).getByText("'store' isn't a lender's name. Use the exact name on your statement or SMS.").waitFor();
  await card(1).getByLabel("Name exactly as it appears on your statement or SMS").fill("Ubuntu Furnishers");
  await card(1).getByText("Coach to confirm against statement").waitFor();
  await card(1).getByLabel("Balance owed (R)").fill("7500");
  await card(1).getByLabel("Minimum (R a month)").fill("450");
  await card(1).getByText("UNKNOWN: rate").waitFor();
  await card(1).getByLabel("Interest rate (% a year)").fill("21");
  ok("'Other' name rules: 'store' refused with the spec's message, a real name marked 'Coach to confirm'; missing rate shows UNKNOWN");

  await page.click('button:has-text("+ Add a debt")');
  await card(2).locator("select").first().selectOption("Money owed to family");
  await card(2).getByLabel("Who do you owe? (e.g. my uncle)").fill("my uncle");
  await card(2).getByLabel("Balance owed (R)").fill("2000");
  await card(2).getByLabel("Interest rate (% a year)").fill("0");
  await card(2).getByLabel("Minimum (R a month)").fill("500");
  await card(2).locator("select").nth(1).selectOption("arrears");
  await saved();
  const totals = await page.locator(".total").textContent();
  assert(totals.includes("R24,300") && totals.includes("R1,924"), `totals R24,300 owed and R1,924 minimums (got: ${totals})`);
  await shot(page, "debts");
  ok("step 1 totals: R24,300 owed, R1,924 in minimums, dated");

  // ------------------------------------------------------------ Step 2
  await page.click('button:has-text("Next: My month")');
  await page.getByLabel("Take-home pay (R a month, after deductions)").fill("12000");
  await page.getByLabel("Pay before deductions (R a month)").fill("16000");
  const amount = (label, v) => page.getByLabel(`${label} amount`).fill(v);
  await amount("Rent", "4000");
  await amount("Groceries", "3000");
  await amount("Transport to work", "1000");
  await amount("Clothing", "500");
  await amount("Subscriptions you barely use", "200");
  await saved();
  ok("step 2 month saved");

  // ------------------------------------------------------------ Step 3
  await page.click('button:has-text("Next: My numbers")');
  const board = await page.locator(".board").textContent();
  // Debt load 1,924 ÷ 16,000 = 12.0%. Gap = 12,000 − (4,000+3,000+1,000+500+200+1,924) = +1,376. After cuts = 12,000 − (8,000+1,924) = +2,076.
  assert(board.includes("12.0%"), `debt load 12.0% (board: ${board})`);
  assert(board.includes("+R1,376"), "gap this month +R1,376");
  assert(board.includes("+R2,076"), "gap after cuts +R2,076");
  await page.getByText("Below 25%: where the best opportunities open.").waitFor();
  for (const q of ["Are you borrowing to pay other debts?", "Three or more missed payments in the last six months?", "Do you have NO emergency fund or savings at all?", "Are you paying only the minimum on debt charging 20% or more?"]) {
    await page.getByRole("group", { name: q }).getByRole("button", { name: "No" }).click();
  }
  await saved();
  await shot(page, "numbers");
  ok("step 3 board matches hand calculations: 12.0%, +R1,376, +R2,076; band message right");

  // ------------------------------------------------------------ Step 4
  await page.click('button:has-text("Next: My attack")');
  await page.getByText("They point at different debts").waitFor();
  await page.getByRole("button", { name: "Snowball", exact: true }).click();
  await page.getByLabel("Extra I can add each month (R), on top of minimums").fill("500");
  const target = await page.locator(".card.ticks").textContent();
  // Snowball target #1 = family R2,000 at 0%, paying R500 + R500 = R1,000 a month → 2 months.
  assert(target.includes("Family: my uncle") && target.includes("2 months"), `target #1 family debt clears in 2 months (got: ${target})`);
  await page.getByText("Debt-free · Avalanche").waitFor();
  await saved();
  await shot(page, "attack");
  ok("step 4: methods differ, Snowball chosen, Target #1 clears in 2 months, full plan shown");

  // ------------------------------------------------------------ Step 5
  await page.click('button:has-text("Next: My progress")');
  await page.getByLabel("Total debt (R)").fill("24300");
  await page.click('button:has-text("Log it")');
  await page.getByText(/Logged .*: R24,300/).waitFor();
  await page.locator("svg[aria-label^='Total debt by month']").waitFor();
  await shot(page, "progress");
  ok("step 5: month logged and the chart drawn");

  const [download] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download my summary (PDF)")')]);
  const path = `${SHOTS || "/tmp"}/summary-${run}.pdf`;
  await download.saveAs(path);
  const pdf = readFileSync(path, "latin1");
  assert(pdf.startsWith("%PDF"), "a real PDF");
  assert(/Debt-Ladder-Summary-\d{4}-\d{2}-\d{2}\.pdf/.test(download.suggestedFilename()), "dated file name");
  for (const t of ["My Debt Ladder Summary", "Ubuntu Furnishers", "Education, not financial advice."]) {
    assert(pdf.includes(t), `PDF contains "${t}"`);
  }
  ok("PDF downloaded: branded, includes the debts and the footer");

  // ------------------------------------------------------------ Log out and back in
  await page.click('button:has-text("Log out")');
  await page.waitForURL(`${APP}/login`);
  await logIn(page, email);
  await page.waitForURL(`${APP}/home`);
  await page.goto(`${APP}/tracker`);
  const debts = await page.locator(".debts").textContent();
  assert(debts.includes("FNB · Credit card") && debts.includes("Ubuntu Furnishers · Store account") && debts.includes("Family: my uncle"), "debts kept");
  assert((await card(0).getByLabel("Balance owed (R)").inputValue()) === "14800", "balance kept");
  await page.goto(`${APP}/tracker?step=2`);
  assert((await page.getByLabel("Rent amount").inputValue()) === "4000", "budget kept");
  await page.goto(`${APP}/tracker?step=4`);
  assert((await page.getByRole("button", { name: "Snowball", exact: true }).getAttribute("aria-pressed")) === "true", "method kept");
  await page.goto(`${APP}/tracker?step=5`);
  await page.getByText("R24,300").first().waitFor();
  ok("after logging out and in: debts, budget, attack plan and progress are all still there");

  console.log(`\nAll ${count()} Phase 2 end-to-end checks passed.`);
} finally {
  await browser.close();
}
