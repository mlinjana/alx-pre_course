# RLS plan · MFG Portal

Spec: `PORTAL_SPEC.md` §11.1. Draft SQL: `supabase/migrations/20260928000000_initial_schema.sql`.
Tests: `supabase/tests/rls_tests.sql`, run with `supabase/tests/run-local.sh`.

## The three gates

| Helper | True when |
| --- | --- |
| `private.mfa_ok()` | The session used two-step login (`auth.jwt()->>'aal' = 'aal2'`, from the Supabase MFA docs). |
| `private.is_owner()` | `mfa_ok()` and `profiles.is_owner`. The app sets `is_owner` from `OWNER_EMAILS` with the secret key. Users cannot write that column. |
| `private.coach_can_see(client)` | `mfa_ok()`, **and** an active assignment to this coach, **and** the client's consent is on, **and** the coach's status is `certified`. |
| `private.is_my_client(client)` | The same as above, but **without** consent. It only unlocks the client's name and WhatsApp, so the coach can see "[Name] hasn't shared yet". |

All helpers are `SECURITY DEFINER` with an empty `search_path`, so policies don't recurse through RLS.

## Who can do what

| Table | Client | Certified coach (through `coach_can_see`) | Owner |
| --- | --- | --- | --- |
| profiles | Own row; their coach's row | Assigned clients' rows (without consent) | All |
| clients | Own row: insert, and update payday and consent only | Assigned clients' rows (without consent) | All |
| debts | Own rows; cannot set `other_confirmed` | Read only. Confirms "Other" names through `confirm_other_name()` | All |
| month_budget, budget_items, red_lines, attack_plan, monthly_updates, calls, feedback | Own rows | Read only | All |
| settlements | Own rows. Order enforced by constraints. `closed_at` set only by a trigger | Read only | All |
| help_requests | Insert and read own | Read; mark handled | All |
| programme | Read | Read; change the week | All |
| notes | Read own | Read; write their own notes | All, including historic notes after consent is switched off |
| homework | Read; tick done | Read; create | All |
| referrals | **No access** (question 6 in the plan) | Read, create, mark followed up | All |
| coach_applications | Insert (as themselves); cannot read back | None | All |
| coaches | None | Own row | All |
| assignments | Own | Own active rows | All, and only through `assign_client()` |
| institutions | Read the active ones | Read the active ones | Edit |
| settings | Read the `public_read` rows (helplines) | Same | Edit |
| audit_log | None | None | Read. Rows come only from triggers and `log_view()`. |
| anon (signed out) | Nothing on any table | | |

On top of RLS:
- **Column grants** stop anyone writing columns that aren't theirs (`is_owner`, `other_confirmed`, `closed_at`, coach `status`).
- **`assign_client()`** is owner-only. It blocks coaches who aren't certified, blocks a full coach with "[Coach] is full. Pick another coach or raise their capacity.", locks the coach row so two assignments can't race past capacity, and moves the client out of the waiting room.
- **Settlement order:** `paid` needs `in_writing` first, and the letter needs `paid` first (CHECK constraints). A trigger checks the amount is below the balance and closes the debt when the letter is saved.

## Storage (private bucket `letters`) · Phase 5

- Object path: `<client_id>/<settlement_id>/<file>`.
- Policies on `storage.objects` for bucket `letters`:
  - the client may insert and read where the first folder = `auth.uid()`
  - a coach may read where `coach_can_see(first folder)`
  - the owner may read everything
- Files are only served through `createSignedUrl(path, seconds)`, with a short expiry (proposed: 60 seconds).
- I will confirm the exact helper for reading the folder name from the Supabase Storage access-control docs before writing these policies.

## Tests

| Test | What it runs against | Result (28 Sep 2026) |
| --- | --- | --- |
| `supabase/tests/rls_tests.sql`: 49 access-rule checks | Plain Postgres 16 with a stand-in auth schema (`npm run test:db`), **and** the real local Supabase database (Postgres 17) | 49/49 pass on both |
| `tests/integration/phase1.test.ts`: 8 checks | Real local Supabase, with real logins, real JWTs and real two-step codes through the API (`npm run test:integration`) | 8/8 pass |
| `tests/e2e/phase1.e2e.mjs`: 10 checks | The real app in a real browser, local Supabase and the local email catcher (`npm run test:e2e`) | 10/10 pass |

The checks cover:
- signed-out visitors see nothing
- clients see only their own rows and can't write someone else's
- clients can't make themselves owner, confirm their own "Other" name or change coach status
- coaches see only their assigned clients, only with consent on, only while certified, and only with two-step login
- switching consent off cuts the coach off immediately; the owner still sees historic notes
- only the owner assigns; the full-coach and in-training blocks work
- coach applications are owner-read-only (the applicant sees only their own status)
- the settlement order is enforced and the letter closes the account
- help requests reach the right coach only
- settings are protected
- the audit log records changes and views

**Still to do:** run the same tests against Chuma's hosted Supabase project once it exists.
