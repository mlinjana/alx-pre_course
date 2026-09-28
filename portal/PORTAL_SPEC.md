# MFG PORTAL — BUILD SPECIFICATION
*Version 1 · 28 September 2026 · Owner: Chuma Afika Mlinjana, Mlinjana Financial Group*

---

## 1. What we're building

The MFG Portal is one secure web app at **portal.mlinjanafinancialgroup.com** with three roles.

**Clients:**
- sign up
- track their debts with the Debt Ladder Tracker
- see their stage and progress
- work with their assigned coach

**Coaches:**
- apply
- are approved and certified by the owner
- manage their assigned clients: programme weeks, pre-session briefs, notes, referrals

**The owner (Chuma):**
- assigns every client to a coach
- approves coaches
- sees everything, including the coach league table (visible only to him)

The method comes from Chuma's book, *The Debt Millionaire*:
- **the Debt Ladder:** 5 rungs
- **the five stages:** Survival, Stability, Security, Independence, Freedom
- **the 12-week Debt Ladder Programme** from the MFG Coach Manual

**Design reference:** `design-reference/mfg-coach-portal.html` and `design-reference/debt-ladder-tracker.html` are working prototypes with fictional data. They define the screens, wording and behaviour. The real app must match them, but store everything securely server-side.

---

## 2. Tech stack

Use this stack unless the docs make it impossible. If so, explain.

| Need | Use |
| --- | --- |
| App | Next.js (App Router), TypeScript, Tailwind CSS |
| Auth, database, file storage | Supabase: Auth, Postgres with Row Level Security on **every** table, and a **private** Storage bucket |
| Hosting | Vercel, as its own project, on the subdomain `portal.mlinjanafinancialgroup.com` |
| Email | A transactional email provider for invites, verification and password reset. Suggest one and confirm with Chuma. |
| PDF | Client-side PDF generation for the Tracker summary (the prototype uses jsPDF) |
| Charts | Simple SVG, as in the prototypes, drawn to scale |

The **Academy** (a separate project, later) will share this Supabase project, so one account works for both. Keep auth and user profiles generic enough for that.

---

## 3. Roles and access, in plain words

| Role | Can see | Can do |
| --- | --- | --- |
| **Client** | Only their own data | Sign up, use the Tracker, update monthly, share with their coach (consent on or off), log calls and settlements, press "I'm struggling", give feedback |
| **Coach (certified)** | Only clients assigned to them **who have consent on** | Advance programme weeks, prepare briefs, write after-call notes, log referrals |
| **Coach (in training)** | Their own profile only | Nothing client-facing until certified |
| **Owner** | Everything | Approve, certify and add coaches; assign and move clients; see all dashboards |

- The owner is identified by email in the environment variable `OWNER_EMAILS` (comma-separated).
- Chuma is also a coach, so the owner account can have clients assigned too.

---

## 4. Client sign-up (3 screens, then welcome)

**Screen 1 · Create account.** Buttons:
- **Continue with Google**
- **Continue with Apple**
- **Facebook**
- **LinkedIn**

Or **email + password**: at least 8 characters, email verification required, and "forgot password".

- Each provider is switched on by an environment flag, so launch can start with email + Google.
- Header: "Start your climb." Subtext: "Free to join. Your numbers stay private until you choose to share them with your coach."

**Screen 2 · About you** (all required):
- First name and surname (at least two words)
- WhatsApp number (at least 9 digits), with "Your coach will contact you here."
- What they need help with (radio): Getting out of debt · Questions about debt review · Staying out of debt · Building wealth
- How they heard about MFG (select): MFG website · LinkedIn · TikTok · Facebook · The Debt Millionaire book · The book launch · A friend or family member · Other

**Screen 3 · Where you are now.** "Four quick questions. There are no wrong answers, and nobody is judged here."
1. Does your monthly pay cover rent, food, transport AND all your minimum debt payments? (Yes, easily / Just / No)
2. Are you borrowing to pay other debts? (Yes / No)
3. Do you still have bad debt: credit cards, store accounts, personal loans or micro loans? (Yes / No)
4. Do you have savings for at least 3 months of essential costs? (Yes / No)

**Starting stage from these answers:**
- Q1 = "No" or Q2 = "Yes" → Stage 1 · Survival
- Otherwise, Q3 = "Yes" → Stage 2 · Stability
- Otherwise → Stage 3 · Security

Store the stage. Keep the answers only if Chuma confirms (default: don't store them).

Also on Screen 3:
- A switch, **on by default**: "Share my numbers with the MFG coach assigned to me. You can switch this off any time in your account." Record consent with a timestamp.
- A required tick box: "I agree to the Terms and Privacy Policy." Link to `/terms` and `/privacy`. These are placeholder pages marked **[TO BE WRITTEN AND CHECKED BY AN ATTORNEY]**.

**Welcome screen:**
- Their starting stage, with that stage's message (§8)
- "This is a starting point, not a label. Your debt is not your character. It is your circumstance."
- What happens now:
  1. You're in the waiting room. MFG will match you with a coach and send their name to your WhatsApp.
  2. Start your Debt Ladder Tracker now.
  3. Your first call starts from your numbers.
- Button: **Start my Debt Ladder Tracker**

**Every validation error says exactly what to fix,** for example: "Add your WhatsApp number so your coach can reach you."

---

## 5. Coach applications, training and certification

**Application form** (from the sign-up page's "I want to coach with MFG" tab). All fields required except qualifications:
- full name
- email (their future login)
- WhatsApp
- province: the 9 provinces, plus "Outside South Africa"
- experience:
  - None yet, but I've lived it
  - Informal: I help friends and family with budgets
  - Professional coach or mentor
  - I work in financial services
- Have you read *The Debt Millionaire*? (Yes, all of it / Part of it / Not yet)
- How many clients could you take at once?
- Why do you want to coach with MFG? (at least 20 characters)
- Qualifications (optional)
- A required tick box: "I understand MFG coaches teach and hold clients accountable. We never sell or recommend financial products, never handle client money, never contact creditors for clients, and always follow the referral protocol."

**Statuses:** `applied` → `training` (owner approves) → `certified` (owner marks certified) → `inactive` (owner can pause).

- On approval, send the login invite email.
- **Only certified coaches can be assigned clients.**
- The owner can also "Add a coach directly": name, email, WhatsApp, capacity. That creates a certified coach and sends the invite.
- Each coach has a **capacity** (maximum clients).
- Declined applicants get a kind email. Chuma will provide the wording: `[CHUMA TO PROVIDE]`.

---

## 6. Waiting room and assignment (owner only)

- **Every new client lands in the waiting room** with:
  - name
  - days waiting (green today, amber 1–2 days, red 3+)
  - what they need help with
  - starting stage
  - where they heard about MFG
  - sign-in method
  - whether sharing is on
- **Only the owner assigns.** The coach dropdown shows each certified coach's load ("Kagiso P. · 3/8") and pre-selects the **least busy certified coach with space** (lowest clients ÷ capacity).
- **Assignment to a full coach is blocked**, with the message: "[Coach] is full. Pick another coach or raise their capacity."
- **On assignment, notify the client.** Email is required. WhatsApp is optional later, through a WhatsApp Business provider Chuma approves.
- **The owner can move a client** to another coach from the all-clients table (same capacity rule).
- **Coaches cannot add or invite clients.**

---

## 7. The Debt Ladder Tracker (client) and the calculations

Five steps, one per screen, with a ladder progress indicator. This replaces the prototype's browser storage: **everything is saved to the client's account.**

### 7.1 Step 1 · My debts (Rungs 1 and 2)

**Each debt has:**
- type
- institution
- balance (R)
- interest rate (% a year)
- minimum (R a month)
- status: Up to date · Behind on payments · With attorneys · Under debt review

**Types:**
- Credit card
- Store account
- Personal loan
- Micro / short-term loan
- Vehicle finance
- Home loan
- Overdraft
- Pay later
- Cellphone contract
- Informal lender (mashonisa)
- Money owed to family
- Other

**Institution picker.** Tiles with a monogram badge in MFG style: the initials in gold on navy. **Do not use company logos** unless Chuma provides licensed files. Only these real institutions appear, per type, plus an **Other** tile:

| Type | Institutions |
| --- | --- |
| Credit card | Absa, African Bank, Capitec, Discovery Bank, FNB, Investec, Nedbank, Standard Bank, Woolworths, RCS |
| Store account | Edgars, Truworths, Identity, TFG (Foschini, Markham, Sportscene, Totalsports), Mr Price, Woolworths, Ackermans, Lewis, Beares, Best Home and Electric, RCS |
| Personal loan | Absa, African Bank, Capitec, FNB, Nedbank, Standard Bank, DirectAxis, FinChoice, Sanlam, Old Mutual Finance, Bayport, RCS, WesBank, Wonga |
| Micro / short-term loan | Wonga, FinChoice, Finbond, African Bank, Capitec |
| Vehicle finance | WesBank, Absa Vehicle and Asset Finance, Standard Bank Vehicle and Asset Finance, MFC (Nedbank), Toyota Financial Services, BMW Financial Services, Mercedes-Benz Financial Services |
| Home loan | Absa, FNB, Nedbank, Standard Bank, Investec, SA Home Loans |
| Overdraft | Absa, African Bank, Capitec, Discovery Bank, FNB, Investec, Nedbank, Standard Bank, TymeBank, Old Mutual, Bidvest Bank, Access Bank, Bank Zero, Ubank, GBS Mutual Bank, Finbond |
| Pay later | Payflex, PayJustNow, MoreTyme (TymeBank), Happy Pay, Float, Mobicred |
| Cellphone contract | Vodacom, MTN, Telkom, Cell C, Rain |

- **Store the lists in a database table** the owner can edit (add, remove, rename), not hard-coded. Seed them with the lists above.
- **Other:** a required text field, "Name exactly as it appears on your statement or SMS."
  - Reject names under 3 characters, names with no letters, and generic words (loan, loans, bank, banks, card, credit, credit card, store, shop, account, store account, debt, unknown, n/a, none, other, test, asdf, qwerty, money, lender, company, cash). The message: *"'store' isn't a lender's name. Use the exact name on your statement or SMS."*
  - Every accepted "Other" is marked **"Coach to confirm against statement"** until a coach ticks it as confirmed.
- **Money owed to family:** "Who do you owe? (e.g. my uncle)". No institution.
- **Informal lender (mashonisa):** no name needed. Show: "Informal lenders often charge far more than the law allows. List it anyway: your coach needs the full truth. If you feel threatened, tell your coach."
- **Unknown figures:** a missing balance, rate or minimum shows **UNKNOWN**, with "Get it from your statement. We won't guess." **Never estimate.**
- **True cost at the minimum payment** (only when balance, rate and minimum are all known). Monthly rate r = rate ÷ 100 ÷ 12. Each month: interest = balance × r, then balance = balance + interest − minimum. Count the months and total interest until the balance reaches 0 (cap at 1,200 months). If minimum ≤ balance × r, show **"Never clears. This minimum doesn't even cover the interest."**
- **Status notes:** "With attorneys" → "Get legal advice before you negotiate this one." "Under debt review" → "Extra payments go through your debt counsellor and PDA only."
- **Show the total owed and total minimums, dated.**

### 7.2 Step 2 · My month (Rung 3)

- Take-home pay, and pay before deductions.
- Four editable groups:
  - **Critical:** rent, electricity and water, groceries, transport to work
  - **Important:** insurance and funeral cover, medical aid, school fees
  - **Reduce:** clothing, eating out and takeaways, entertainment, extra data and airtime
  - **Eliminate:** subscriptions you barely use
- Minimum debt payments come in from Step 1, **including accounts not being paid**.

### 7.3 Step 3 · My numbers (Chapter 9)

**Formulas:**
- **Debt load** = total minimums ÷ pay before deductions × 100
- **Gap this month** = take-home − (Critical + Important + Reduce + Eliminate + minimums)
- **Gap after cuts** = take-home − (Critical + Important + minimums)

**Debt load bands and messages:**

| Debt load | Message |
| --- | --- |
| Above 50% | "Red Line 1: more than half your pay is promised to debt." |
| 40–50% | "The book notes banks generally stop approving bonds around 40–45%." |
| 35–40% | "Above the wealth-builder's target of 35%." |
| 25–35% | "Inside the target: below 35%." |
| Below 25% | "Below 25%: where the best opportunities open." |

**The Five Red Lines:**
1. More than half of pay goes to debt (automatic, from debt load)
2. Borrowing to pay debts (yes/no)
3. Three or more missed payments in 6 months (yes/no)
4. No emergency fund or savings (yes/no)
5. Only minimum payments on debt at 20% or more (yes/no)

**If gap after cuts < 0:** "The maths is broken, not you. Even after cutting Reduce and Eliminate, your pay can't cover essentials plus minimum payments. Chapter 5 says this is the sign to speak to an NCR-registered debt counsellor. Your MFG coach can help you prepare for that conversation."

### 7.4 Step 4 · My attack (Rungs 4 and 5)

- **Avalanche:** rank by rate, highest first, with unknown rates last. **Snowball:** rank by balance, smallest first. Show both side by side.
- **If both put the same debt first:** "They line up."
- **If not:** "Know yourself. The perfect strategy you abandon in month four is worth less than the imperfect one you follow to the end."
- The client chooses a method and an extra amount each month.
- **Target #1:** show when it clears at minimum + extra.
- **Full plan simulation** (only when every rate and minimum is known):
  - The monthly budget is the sum of all minimums plus the extra.
  - Each month: add interest to every debt; pay each debt's minimum (never more than its balance); send whatever is left to the debts in the chosen order.
  - Show the months to debt-free and the total interest, for both methods.
  - Caption: "Estimates only: they assume rates and payments stay the same."

### 7.5 Step 5 · My progress

- A monthly log of the total debt, shown as a bar chart. The latest bar is gold, and the chart shows the change since the first month.
- A **"Download my summary (PDF)"** button, branded, including everything above. The footer reads: "Education, not financial advice. Mlinjana Financial Group teaches money skills; we do not give financial advice or sell financial products."

---

## 8. Client dashboard

**Stage card** (both client and coach see it):

| Stage | Message to the client |
| --- | --- |
| 1 · Survival | "This is the hardest stage, and you're facing it. That takes courage. The job right now: stop the bleeding." |
| 2 · Stability | "The hole has stopped getting deeper. Now we climb, one debt at a time." |
| 3 · Security | "Bad debt is behind you. Now we protect what you've built." |
| 4 · Independence | "Your money has started working for you." |
| 5 · Freedom | "What you own pays for how you live." |

**Stage rules**, recalculated at every monthly update:
- **Stage 1 → 2:** gap after cuts ≥ 0 AND no new credit this month AND not borrowing to pay debts
- **Stage 2 → 3:** all bad debt paid off (total debt = 0) AND emergency fund ≥ 3 months of essentials
- **Stage 3 → 4:** something they own pays them every month (asset income > 0)
- **Stage 4 → 5:** asset income covers living costs (fields for this come later; for now Stage 5 can't be reached)

**Rungs** (5 per stage) come from debt load: above 50% = 1, 40–50% = 2, 35–40% = 3, 25–35% = 4, below 25% = 5.

**Climb score** = 100 + ((stage − 1) × 5 + (rung − 1)) × 37. That runs from 100 to 988.

**Movement is honest every month, up or down,** with these messages:
- up a stage: "New stage: [name]. You earned this."
- down a stage: "Your numbers moved you back to [name] this month. That's information, not a verdict. Your coach will help you find what changed."
- up a rung: "You moved up a rung this month. Keep going."
- down a rung: "Down a rung this month. Hard months happen on every climb. Let's look at it together."
- same: "Holding steady. Consistency is how the climb works."

**Also on the dashboard:**
- **Next-stage checklist,** with the rules above as ticks.
- **Explanation:** "Rungs follow your debt load… Your stage follows the five stages in Chapter 13… This is where you are, not who you are."
- **Payday check-in.** The client sets their payday (day 1–31, default 25). If their last update is before the most recent payday, show "It's past your payday on the [25th]. Update your numbers so [Coach] sees where you are." Send the same reminder by email on payday (and WhatsApp later).
- **Programme card:** "Week N of 12 · [title]", with a 12-segment bar.
- **"I'm struggling this month" button.** It opens:
  - "A hard month is part of every climb"
  - the four bad-month steps: phone the creditor **before** the due date and ask "What relief options are available on my account?"; don't borrow to cover it; protect rent, food and transport first, then minimums, then the attack; tell your coach today
  - a button, "Tell [Coach] I'm struggling"
  - the safety line: "If you feel unsafe or have thoughts of harming yourself, please talk to someone now: a trusted person, your doctor, or a crisis line."

  The crisis numbers are **[VERIFIED SOUTH AFRICAN HELPLINE NUMBERS TO BE PROVIDED BY CHUMA — LAUNCH BLOCKER]**. Sending the request flags the client red for the coach and in the owner's urgent flags, and emails the coach.
- **Coach feedback:** the latest after-call note (message, what we covered, homework checklist, next session).
- **Consent switch** for sharing with the coach.
- **Creditor calls and settlements:**
  - **Call log:** date, creditor (from their debts), reference number, what I offered, what they agreed, "They sent it in writing" (yes/no).
  - **Settlement steps, in this order:** (1) "I have the agreement in writing" (must be ticked before step 2), (2) "I've paid exactly as agreed", (3) upload the paid-up letter (image or PDF, to private storage).
  - **Step 3 closes the account:** remove the debt, reduce open accounts, and show an **"Account closed"** card with the institution name and no amounts ("One less creditor with your number").
  - A settlement amount must be lower than the balance.
  - Caption: "Chapter 5: get every arrangement in writing. No letter, no payment."
- **Feedback check-ins at Weeks 4, 8 and 12,** one each:
  - "Did you ever feel judged by your coach?" (No / A little / Yes)
  - "Do you understand your numbers better than when you started?" (Yes / A little / No)
  - "Did your coach ever recommend a financial product, lender or insurer?" (No / Yes)
  - an optional comment
- **Monthly update:**
  - total debt
  - accounts still open
  - minimums this month
  - pay before deductions
  - new credit this month (yes/no)
  - borrowed to pay a debt (yes/no)
  - payday
  - emergency savings in months: none, less than 1, 1, 2, 3, 4 or 6

  In the real app, most of this comes from the Tracker automatically.

---

## 9. Coach portal

**Client list** with two tabs: **Needs attention** (sorted with red first) and **All by momentum**. Each row shows name, Momentum score, a bar, stage and rung, total and % reduced, and flag chips.

**Momentum score** (0–100, Balanced weights, stored in an owner-editable settings table):
- **40 × min(1, % of debt reduced since start ÷ 50%).** Full marks at 50% reduced.
- **20 × accounts closed ÷ accounts at start.**
- **25 × months with an update, out of the last 3 calendar months ÷ 3.**
- **15 if no new credit this month, else 0.**

**Needs-attention flags:**

| Flag | Rule | Colour |
| --- | --- | --- |
| Asked for help | Client pressed "I'm struggling" (clears when the coach marks it handled) | Red · **urgent** |
| Went quiet | No update in more than 30 days | Amber |
| Debt went up | Latest total > previous total | Red |
| New credit taken | This month | Red |
| Red Line | Any Red Line flashing | Red |
| Maths broken after cuts | Gap after cuts < 0 | Red · **urgent** |
| Account with attorneys | Any debt status "With attorneys" | Red · **urgent** |
| Debt review: check status | Any debt "Under debt review" | Amber |
| Payday update due | No update since last payday (and not already "went quiet") | Amber |
| Referral open | Any referral not marked followed up | Amber |
| Moved back a stage / Down a rung | Compared with last month | Amber |

**Client detail:**
1. Header with Momentum score and flags. Urgent cards: the referral check (maths broken) and the legal check (attorneys).
2. **Programme card:** "Week N of 12 · [title] · [rung] · Gate: [text]", with "Gate passed → Week N+1", "Back a week", and "Prepare pre-session brief". The weeks and gates are in §9.1.
3. **Pre-session brief** (§9.2), shown only to the coach and the owner.
4. Stage card; board (total now, change, debt load, gap after cuts); total debt by month chart; Momentum breakdown; debts table (name, balance, rate, status, and the "Coach to confirm" tick for "Other" names).
5. The client's calls and settlements (read-only).
6. **Referrals:** a log with date, "referred to" (NCR-registered debt counsellor / Attorney / FSCA-licensed financial advisor / Registered tax practitioner / Professional support (counselling, health)), reason, and a "Mark followed up" button.
7. Client feedback received.
8. **After-call note:** call date, next session, what we covered, homework (one per line; becomes the client's checklist), and a message to the client. The coach sees previous notes with homework ticks.

**Locked states:**
- "[Name] hasn't shared yet" (consent off)
- "Waiting for their first update" (no data)

### 9.1 Weeks and gates (from the Coach Manual)

| Week | Title | Rung | Gate |
| --- | --- | --- | --- |
| 1 | The kitchen table | Rung 1 | Every creditor listed; each unknown has a plan to get the figure |
| 2 | The whole picture | Rung 1 | Shortfall, debt load, Red Lines, stage and gap type recorded |
| 3 | The true cost | Rung 2 | Every debt has a known rate (or a plan to get it); most expensive named |
| 4 | No new bad debt | Rung 3 | No new credit since Week 4; Eliminate list cancelled; separate account open |
| 5 | The anchor decision | Rung 3 | A dated decision, or a written reason for keeping the asset |
| 6 | Choose your attack | Rung 4 | Target #1 named; first extra payment made or dated; chart up |
| 7 | Find more money | Rung 5 | Fire-power figure written; first transfer made |
| 8 | Phone before they phone | Negotiate | At least one call made or booked; arrangements in writing |
| 9 | Settlements | Negotiate | Settlement record filled for one account, or "none qualify" noted |
| 10 | The invisible middle | Hold the line | Bad-month plan written; chart updated twice since Week 6 |
| 11 | Protect the climb | Hold the line | Emergency fund (Pot 1) opened with a first deposit; credit report reviewed |
| 12 | Graduation | Hold the line | Graduation criteria met; 90-day plan written |

### 9.2 Pre-session brief (the Mlinjana Diagnostic, generated by rules, no AI)

It is headed "For you only. Never send to the client." It has 8 parts:

1. **Arithmetic check.** Sum the debt balances and compare with the latest logged total. Sum the debt minimums and compare with the minimums the client reported. Show the debt load working in full ("R5,024 ÷ R16,000 × 100 = 31.4%"). Flag any mismatch with ⚠ and the difference.
2. **Debts by interest rate and by balance:** two tables showing name, balance, rate (UNKNOWN if missing) and minimum.
3. **Gap type (suggested; the coach confirms):**
   - **Crisis:** gap after cuts < 0, or borrowing to pay debts
   - otherwise **Structural:** any single debt's minimum ≥ 20% of pay before deductions ("One commitment, [name], takes X% of pay on its own.")
   - otherwise **Behavioural**
4. **The number most likely to surprise them:** monthly interest = the sum of balance × rate ÷ 100 ÷ 12 over debts with a known rate. "About R[X] of their R[minimums] in monthly minimums is interest. That money doesn't reduce what they owe."
5. **What looks hidden:**
   - accounts behind on payments ("an unpaid account hides the real shortfall")
   - unconfirmed lender names
   - missing rates

   If none: "Nothing obvious. Still ask about family loans, informal lenders and pay-later accounts, which clients often leave out."
6. **Questions to ask** (3–5, first matching rules first):
   - struggling pressed → "You pressed 'I'm struggling' this week. What happened, and what do you need most right now?"
   - new credit → "What was the new credit for, and what would have happened without it?"
   - arrears → "Which payment slipped first, and what was happening that month?"
   - attorneys → "What letters have you received about the account with attorneys? Please bring them."
   - debt review → "Can you send your debt counsellor's details and your latest PDA statement?"
   - missing rate → "Can you find the interest rate on the statement or app for the accounts we're missing?"
   - quiet → "What made it hard to update last month?"
   - always add → "Which debt keeps you up at night, and why that one?" and "What's one thing that went right with money since we last spoke?"
7. **Where to spend the session:** the current week, its title, rung and gate.
8. **Triage before coaching:** all red flags, with "Check the referral protocol in the Coach Manual."

---

## 10. Owner view

- **KPIs:** waiting room count, coaches (and open places), active clients (and how many are sharing), average momentum, urgent flags.
- **Clients by stage:** a bar chart of sharing clients across the 5 stages.
- **Waiting room** (§6), with the assignment controls.
- **Coach applications:** full details, with **Approve for training** and **Decline**.
- **Coaches table:** status (Certified / In training + "Mark certified"), login email (plus "invite sent"), clients, capacity (green, amber at 80% or more, red when full), date added. Also "Add a coach directly".
- **Referral log:** all referrals across MFG, newest first, with open ones highlighted.
- **Client feedback per coach:** responses, "understand better" count, "felt judged" count (anything but "No"; amber), "product recommended" count (red).
- **Coach league table (OWNER ONLY):** coaches ranked by their clients' average momentum, with clients, % debt reduced and clients flagged.
- **Urgent flags:** asked for help, maths broken, account with attorneys.
- **All clients:** coach (move control), stage and rung, momentum, % reduced, flag count.
- **Settings:** Momentum weights; the institution lists (§7.1); crisis helpline numbers; email wording.

---

## 11. Data, security and privacy

### 11.1 Row Level Security (must be enforced in Postgres and tested)

- **A client reads and writes only their own rows.**
- **A coach reads a client's data only if:**
  - the client is assigned to that coach, AND
  - the client's consent is on, AND
  - the coach's status is `certified`.

  Coaches write only notes, referrals, week changes, "Other" confirmations and brief views for those clients.
- **The owner reads and writes everything.**
- **Coach applications** can be created by anyone signed in, and read only by the owner.
- **When a client switches consent off,** coach access stops immediately. Historic notes stay visible to the owner only.

### 11.2 Other security

- **Two-step login (TOTP)** is required for coach and owner accounts, if Supabase supports it; check the docs.
- **Audit log:** who viewed or changed which client's data, and when. The owner can read it.
- **Sessions:** automatic log-out after 30 minutes of inactivity for coach and owner.
- **Private storage** for paid-up letters and uploads. Access is only through short-lived signed links. Show nothing publicly.
- **Rate limits** on sign-in, sign-up, password reset and file uploads.
- **Client data rights:** "Download my data" (JSON) and "Delete my account" in the client account. Deletion rules and retention periods are `[CHUMA + ATTORNEY TO CONFIRM]`.
- **Never send financial data** to analytics, email marketing tools or any third party. Emails must not contain debt figures.
- **Data location:** choose the Supabase region with Chuma. POPIA rules on moving data across borders apply. `[ATTORNEY TO CONFIRM]`

### 11.3 Suggested tables (adjust if you need to)

- `profiles` (id, role, name, whatsapp, payday, stage_start, consent, consent_at, need, heard_from, auth_method)
- `coaches` (profile_id, status, capacity, province, experience, …)
- `coach_applications`
- `assignments` (client_id, coach_id, assigned_at, assigned_by)
- `debts` (client_id, type, institution_id or other_name, other_confirmed, balance, rate, minimum, status, closed_at)
- `institutions` (type, name, active)
- `month_budget` (client_id, month, take_home, gross, group items)
- `monthly_updates` (client_id, month, total, open_accounts, minimums, gross, new_credit, borrowing, ef_months)
- `red_lines`
- `attack_plan`
- `programme` (client_id, week, updated_by, updated_at)
- `notes` (+ `homework` items with done flags)
- `referrals`
- `calls`
- `settlements` (+ letter file path)
- `feedback` (client_id, week_milestone, answers)
- `help_requests` (client_id, created_at, handled_at, handled_by)
- `audit_log`
- `settings`

---

## 12. Wording and tone (non-negotiable)

- **Warm, plain, never judging.** Use the book's lines where the prototypes do: "Your debt is not your character. It is your circumstance." "Not roughly. Exactly." "No letter, no payment."
- **Never shame a setback.** Movement is honest, but the words are kind (§8).
- **Every page footer:** "Education, not financial advice. MFG teaches money skills. We do not give financial advice or sell financial products."
- **No product, lender, insurer or investment recommendations anywhere.** Institution lists exist only to record what a client owes.
- **The crisis helpline numbers are a launch blocker.** The app must not go live to real clients until Chuma has entered verified numbers in Settings.

---

## 13. Design

**Colours:**

| Name | Hex |
| --- | --- |
| Navy | #0D1526 |
| Deep | #04070C |
| Panel | #111B2F |
| Gold | #E3B341 |
| Soft gold | #F2D188 |
| Cream | #F5F0E4 |
| Muted | #A7AFC0 |
| Red | #E4705F |
| Green | #6CC389 |
| Amber | #F0A857 |

**Fonts (Google Fonts):**
- Oswald: headings, uppercase labels
- Space Grotesk: body text
- Space Mono: numbers
- Caveat: one handwritten line per screen at most

**Signature details:**
- a gold underline on the key word of headings
- small gold corner ticks on key cards
- "departure-board" tiles for key numbers
- ladder and rung progress bars

**Quality:**
- mobile-first
- works on slow connections
- WCAG AA contrast
- keyboard accessible
- respects reduced motion

It can be installed on the phone's home screen (a web app manifest and icons). Taglines: "Restructure. Rebuild. Rise." and "Your Money. Your Future. Your Plan."

---

## 14. Build phases (stop after each)

| Phase | Build | Done when |
| --- | --- | --- |
| 0 | Plan, repo, Supabase schema draft, RLS plan, `.env.example`, Vercel project | Chuma approves the plan |
| 1 | Auth (email + Google first), client sign-up (§4), coach applications (§5), owner role, waiting room and assignment (§6) | Chuma signs up as a test client, applies as a test coach, approves and certifies them, and assigns the client |
| 2 | Debt Ladder Tracker (§7), saved to the account, with the PDF | A test client completes all 5 steps and downloads the PDF; the data is still there after logging out and back in |
| 3 | Client dashboard (§8): stage, rungs, Climb score, monthly update, payday check-in, consent | Stage and score change correctly when the test numbers change; turning consent off blocks the coach (tested) |
| 4 | Coach portal (§9): list, flags, Momentum, detail, programme weeks, brief, notes, referrals | The brief's arithmetic matches hand calculations for 3 test clients; a coach cannot see another coach's client (tested) |
| 5 | Calls, settlements with uploads, account-closed card, "I'm struggling", feedback | The settlement order is enforced; the help request reaches coach and owner; the upload is private (tested) |
| 6 | Owner view (§10), settings, audit log, two-step login, data export and delete | Everything in §10 works; the audit log records views |
| 7 | Apple, Facebook and LinkedIn sign-in; emails; accessibility and speed pass; full test run; deploy to portal.mlinjanafinancialgroup.com | Chuma completes the go-live checklist (below) |

---

## 15. Go-live checklist (for Chuma)

- [ ] Supabase project created (region chosen with the attorney's input)
- [ ] Vercel project on a plan that allows commercial use (check Vercel's current terms)
- [ ] `portal.mlinjanafinancialgroup.com` added in Vercel Domains
- [ ] Google, Apple (paid developer account), Facebook and LinkedIn sign-in apps set up
- [ ] Email sending set up, with the domain verified
- [ ] Verified crisis helpline numbers entered **(launch blocker)**
- [ ] Privacy policy, terms and consent wording written by an attorney; POPIA Information Officer registration checked
- [ ] Institution lists reviewed
- [ ] Declined-coach and client-assigned email wording provided
- [ ] Tested end to end with fictional data, then a pilot with 2–3 real clients who agree in writing
