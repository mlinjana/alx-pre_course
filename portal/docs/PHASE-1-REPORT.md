# Phase 1 report · MFG Portal

*28 September 2026*

## 1. What I built

| Area | What works |
| --- | --- |
| **Sign-in** | Email and password (8+ characters, email confirmation, "forgot password"), plus Google. Apple, Facebook and LinkedIn are ready behind switches and will be switched on in Phase 7. |
| **Client sign-up (§4)** | Screen 1 (create account), screens 2 and 3 (about you, four questions, consent switch on by default, terms tick), then the welcome screen with the starting stage and its message. The stage is worked out on the server. The four answers are **not** stored. Every error says exactly what to fix, and nothing typed is lost after an error. |
| **Coach application (§5)** | The "I want to coach with MFG" tab: create a login, then the full form. The applicant sees "We'll be in touch" and can't read any application, including their own; they only see its status. |
| **Owner (§5, §6)** | Two-step login, then the Owner view: |
| | • **Waiting room:** days waiting in green, amber or red; what the client needs; starting stage; where they heard about MFG; sign-in method; sharing on or off. |
| | • **Assign:** the least busy certified coach with space is pre-selected. A full coach is blocked with "[Coach] is full. Pick another coach or raise their capacity." |
| | • **Applications:** Approve for training, or Decline. |
| | • **Coaches table:** Mark certified, Pause or switch back on, change capacity (green, amber at 80%, red when full), "Invite sent". |
| | • **Add a coach directly:** creates a certified coach and emails them an invite. |
| | • **All clients:** move a client to another coach, with the same capacity rule. |
| **Coach area** | Two-step login. In training: what happens next. Certified: their clients, with "[Name] hasn't shared yet" when sharing is off. The full coach portal is Phase 4. |
| **Security** | Everything is enforced in the database by Row Level Security. Owner and coach access needs two-step login **in the database**, not only on screen. After 30 minutes of inactivity, owner and coach are logged out, both in an open tab and when they come back to a closed one. |
| **Emails** | Client-assigned, coach-approved and coach-declined emails go through Resend. They contain names and links only, never debt figures. The wording is my **draft** (see §3). |
| **Design** | The prototypes' colours, fonts, gold underlines, corner ticks and board tiles. Mobile-first. Footer on every page. |

### Tests (all passing)

| Suite | Count |
| --- | --- |
| Unit tests: stage rules, every validation message, least-busy coach, days-waiting colours, capacity colours, email templates, safe redirects | 33 |
| Database access rules, run on plain Postgres **and** on real Supabase | 49 |
| Integration, on real Supabase with real logins and real two-step codes | 8 |
| End-to-end, in a real browser (see below) | 10 |

The end-to-end test runs your Phase 1 "done when" scenario:
1. a client signs up and confirms the email
2. a coach applies
3. the owner sets up two-step login, approves and certifies the coach, and assigns the client
4. the client sees their coach

Bugs the tests caught and I fixed:
- **Screen 3 lost its answers after an error.** React clears a form once its server action finishes. The answers are now kept.
- **The owner's "approved" and "assigned" messages disappeared** along with the row they belonged to. They now show at the bottom of the screen.

## 2. How Chuma tests it

**Before you start:** do the set-up in `docs/SETUP.md` (Supabase, Google, Resend, Vercel). Then:

1. **You as owner:**
   - Open the portal and create an account with your owner email.
   - Confirm the email.
   - Set up two-step login: scan the QR code with an authenticator app, then type the code.
   - You land in the Owner view.
2. **A test client:**
   - In a private browser window, choose **I want help with my money**.
   - Use a second email address of yours.
   - Confirm it and answer the questions.
   - Check that the welcome screen shows the right stage:
     - Q1 = "No" → Survival
     - otherwise Q3 = "Yes" → Stability
     - otherwise → Security
3. **A test coach:**
   - In another private window, choose **I want to coach with MFG**.
   - Use a third email address.
   - Confirm it and fill in the application.
4. **Back in the Owner view:**
   - The client is in the waiting room, marked "Today" in green.
   - Approve the application, then press **Mark certified**.
5. **Assign:** in the waiting room the new coach is pre-selected. Press **Assign**.
   - The client should get the "Your MFG coach is…" email.
6. **Test the capacity block:**
   - Set the coach's capacity to 1 and sign up a second test client.
   - Try assigning them to that coach. You should see "[Coach] is full…".
7. **Client side:** as the test client, log in again. Your home page shows your coach's name.
8. **Coach side:**
   - As the test coach, log in and set up two-step login.
   - You see the client.
   - Then, as the client, switch sharing off. For now this is only possible at sign-up; the account switch comes in Phase 3. The coach then sees "[Name] hasn't shared yet".

## 3. What I need from you

1. **The new repository.** Create an empty private `mfg-portal` repo on GitHub and give Claude access. I'll move the portal there with its history.
2. **The accounts in `docs/SETUP.md`:** Supabase, Google sign-in, Resend with the domain verified, and Vercel.
3. **Approve or change my draft email wording.** It's in the database settings and you can edit it:
   - "Your MFG coach is {coach_name}": to the client, on assignment.
   - "You're approved for MFG coach training": to the applicant, on approval.
   - "Your application to coach with MFG": the decline email. It says, kindly, that MFG isn't taking the application further right now, and that it's not a judgement of them.
4. **The sign-up email text** in `supabase/templates/` (confirm, reset, invite). This is also my draft.

## 4. What I'm unsure of

- **WhatsApp on assignment:** the spec says WhatsApp later, through a provider you approve. For now only email is sent.
- **Deleting accounts (Phase 6):** some records point back to people. For example, "assigned by" points to you. When we build "Delete my account", each record will need a rule: keep it, or anonymise it. This needs your attorney's input on retention.
- **The coach "invite" after approval.** An approved applicant already has a login, so I send an "approved for training" email with a login link instead of a new invite. A true invite is sent only for "Add a coach directly".
- **The owner flag** takes effect when that person next signs in. If you change `OWNER_EMAILS`, the person must log out and in again.
- **Not yet tested:** hosted Supabase, Google sign-in, and real email sending through Resend. Local tests can't reach Google or Resend. They'll be checked when your accounts exist.
