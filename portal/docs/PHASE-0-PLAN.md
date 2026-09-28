# Phase 0 plan · MFG Portal

*28 September 2026 · For Chuma's approval before Phase 1*

## 1. Where the code lives

For now the portal is in **`portal/`** inside the existing `mlinjana/alx-pre_course` repository, next to the website. Vercel can deploy it as a **separate project** from that folder: when you import the repo, you set **Root Directory** to `portal` (per Vercel's monorepo docs). This matches §2's "its own project".

*Question 1:* would you rather have a new repository, for example `mfg-portal`? It is easy to move now and harder later.

## 2. Architecture

| Part | Plan |
| --- | --- |
| App | Next.js (App Router), TypeScript and Tailwind, in `portal/`. |
| Supabase in Next.js | `@supabase/ssr`: `createBrowserClient` in the browser and `createServerClient` on the server. |
| Protecting pages | A request proxy refreshes the session. Pages are protected with `supabase.auth.getClaims()`, never `getSession()` on the server (per the Supabase Next.js guide). |
| Security | All data access goes through the signed-in user's session, so **RLS decides**. The secret key is used only in a few server-only places: setting the owner flag from `OWNER_EMAILS`, sending coach invites, "Add a coach directly", and account deletion. |
| Calculations | One pure TypeScript module, `lib/calc/`, holds every §7–§9 formula: true cost, debt load, gaps, Red Lines, avalanche, snowball, plan simulation, stage, rung, Climb score, Momentum, flags and the brief. Each formula has unit tests, including hand-checked figures from the prototype's test clients (for example Sipho: R5,024 ÷ R16,000 × 100 = 31.4%). |
| Accounts | `profiles` is generic, so the Academy can reuse it. Client and coach details sit in `clients` and `coaches`. |
| Emails | Auth emails (verification, reset, invites) through Supabase with the provider's SMTP. App emails (assigned, payday, struggling, declined coach) through the provider's API. **No debt figures in any email** (§11.2). |
| Payday reminders | A daily Vercel Cron job, protected by `CRON_SECRET`. |
| PDF | jsPDF, client-side, as in the prototype. |
| Installable | Web app manifest and icons. |

## 3. What the official docs say, and what it changes

| Topic | Docs say | Effect on the plan |
| --- | --- | --- |
| TOTP two-step login | Supabase Auth supports TOTP. A session with a second factor is `aal2`, and RLS can check `auth.jwt()->>'aal' = 'aal2'`. | The owner and coach checks require `aal2` in the database. **So TOTP enrolment for owner and coach must move from Phase 6 to Phase 1.** Without it you can't approve or assign in Phase 1. (Question 2) |
| 30-minute idle log-out | Supabase's own inactivity timeout is **Pro plan and up only**, and applies to every user in the project. | I'll build the 30-minute idle sign-out in the app for coach and owner only, so clients aren't affected. It doesn't need the Pro plan. |
| LinkedIn | The provider is `linkedin_oidc`. The old `linkedin` provider is deprecated. | Use `linkedin_oidc` in Phase 7. |
| Auth emails | The built-in Supabase email sender allows **2 emails an hour**. The limit can be changed with custom SMTP. | Custom SMTP from the chosen provider is needed before real sign-ups (Phase 1 testing can use the built-in sender). |
| Auth rate limits | Supabase rate-limits sign-up, sign-in, recovery, OTP and verify. Most limits can be configured. | Covers §11.2 for auth. File uploads get an app-level limit in Phase 5. |
| Private files | Signed links come from `createSignedUrl(path, expiresInSeconds)`. | Paid-up letters open only through short-lived signed links. |
| Vercel monorepo | One repo can feed several Vercel projects, each with its own **Root Directory**. | Supports keeping `portal/` in this repo. |

Items I have **not yet checked** in the docs, and will check at the start of the phase that needs them:
- the exact Next.js version and file name for the request proxy (the Supabase guide says `proxy.ts` in Next.js 16+, `middleware.ts` before)
- Supabase's region list
- Vercel's commercial-use terms (I understand the Hobby plan is for non-commercial use, but please verify this on Vercel's pricing page)
- Apple and Facebook provider setup
- the Storage policy helper functions

## 4. Database (draft)

Full SQL: `supabase/migrations/20260928000000_initial_schema.sql`. Access rules: `docs/RLS-PLAN.md`.

The tables follow §11.3, with these changes:
- **`clients` is split from `profiles`**, to keep profiles generic for the Academy.
- **`consent_events` is added,** so every consent change is kept with its time, not only the latest.
- **`budget_items` is added.** Each budget group is an editable list (as in the prototype), so it needs its own rows.
- **Stage, rung, Climb score and gap after cuts are saved on each `monthly_updates` row.** That gives the month-by-month history for "movement" messages and the "Moved back a stage" flag.
- **`ef_months` stores "none" as 0 and "less than 1" as 0.5.**
- **The sign-up answers are not stored** (§4 default). A `store_signup_answers` setting is ready if you decide otherwise.
- **The owner is marked by `profiles.is_owner`, set from `OWNER_EMAILS` at sign-in.** Postgres can't read Vercel's environment variables, so the database needs its own copy of the flag.

## 5. Phase 1 scope (after your "go")

Everything in §14 Phase 1, **plus TOTP for owner and coach** (see §3):
- email and Google sign-in, email verification, forgot password
- client sign-up: 3 screens and welcome
- coach application
- owner: approve, certify, decline, add a coach directly
- waiting room and assignment, with the capacity rule
- the client-assigned email
- the RLS tests re-run against the real Supabase project

## 6. What I need from you

**Accounts** (you create them; I never need your passwords):
1. A Supabase project.
   - Please choose the region with your attorney: POPIA and cross-border transfer.
   - Send me the project URL and publishable key, and put the secret key into Vercel yourself.
2. A Vercel project importing this repo with Root Directory `portal`, on a plan that allows commercial use.
3. Google OAuth client credentials, entered in Supabase → Authentication → Providers.
4. An email provider (see question 3) and DNS access to verify `mlinjanafinancialgroup.com`.
5. The owner email(s) for `OWNER_EMAILS`.

## 7. Questions for you (all answered: see §8)

1. **Repository:** keep `portal/` in this repo, or move it to a new repo?
2. **Two-step login:** may I move TOTP for owner and coaches into Phase 1? Otherwise the database will refuse owner actions until Phase 6.
3. **Email provider:** I suggest **Resend** or **Postmark**. Both offer an API and SMTP for Supabase, as far as I know; I will confirm this in their current docs before setup. Which do you prefer, or do you already use one?
4. **Consent and contact details:** with consent off, should the assigned coach still see the client's **name and WhatsApp**? The draft allows this so the coach sees "[Name] hasn't shared yet" and can reach them. Numbers stay hidden.
5. **Changing coach:** when a client moves to a new coach, may the new coach read the previous coach's notes? The draft says yes.
6. **Clients and referrals:** may clients see their own referrals? The draft says no, but "Download my data" may need to include them. Please check with your attorney.
7. **Owner's two roles:** you are both owner and coach. The owner sees all clients anyway. Is a separate coach view of "my clients" enough for you?
8. **Spec cross-reference:** `CLAUDE.md` says RLS is in §10, but it is in §11. I've treated §11 as correct.

Still waiting on you, as the spec marks them (**not** invented here):
- the declined-coach and client-assigned email wording
- deletion and retention rules
- the Terms and Privacy text (attorney)
- the data region (attorney)

## 8. Decisions that change the spec

| Date | Decision | Replaces |
| --- | --- | --- |
| 28 Sep 2026 | **New repository** `mfg-portal` (Chuma). The portal moves there with its history as soon as the repo exists and Claude has access. | §1 of this plan |
| 28 Sep 2026 | **Two-step login (TOTP) for owner and coaches moves to Phase 1** (Chuma). | §14 Phase 6 |
| 28 Sep 2026 | **Email provider: Resend** (Chuma), for app emails and as Supabase's SMTP. | §2 "suggest one" |
| 28 Sep 2026 | **Consent off:** the assigned coach still sees the client's name and WhatsApp, and nothing else (Claude's call). | Question 4 |
| 28 Sep 2026 | **Coach change:** the new coach can read earlier coaches' notes, so the client doesn't start over (Claude's call). | Question 5 |
| 28 Sep 2026 | **Referrals** are not shown on the client's dashboard, but are included in "Download my data" (Claude's call; attorney to confirm). | Question 6 |
| 28 Sep 2026 | **Owner as coach:** the owner gets the same "My clients" coach view as any coach, plus the owner view (Claude's call). | Question 7 |
| 28 Sep 2026 | **Banks and account providers are chosen from a dropdown**, not tiles (Chuma). | §7.1 "Institution picker. Tiles with a monogram badge" |
| 28 Sep 2026 | **One rule for debt-load bands and rungs:** each range includes its lower edge (35% → rung 3, 25% → rung 4), as the spec's words read (Claude's call; the prototypes disagreed). | Tracker prototype band edges |
| 28 Sep 2026 | **Crisis helpline numbers are no longer a launch blocker** (Chuma). The portal can go live without them, and Chuma will add verified numbers in Settings later. Until then, the "I'm struggling" panel shows the §8 safety line without numbers. When numbers are entered, they appear with no code change. | §8 "LAUNCH BLOCKER" note, §12 last bullet, §15 checklist item |

## 9. How to check Phase 0

1. Read this plan and `docs/RLS-PLAN.md`.
2. Optional, needs PostgreSQL 16 installed: run `bash supabase/tests/run-local.sh` in `portal/`. The last line should be **"All access-rule tests passed."**
3. Answer the questions in §7, then say **"go"** for Phase 1.
