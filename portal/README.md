# MFG Portal

Secure web app for Mlinjana Financial Group clients, coaches and the owner.
It will live at **portal.mlinjanafinancialgroup.com**.

**Status:** Phase 1 built and tested locally (see `docs/PHASE-1-REPORT.md`). Waiting for Chuma's check.

| File | What it is |
| --- | --- |
| `PORTAL_SPEC.md` | The build specification |
| `CLAUDE.md` | Working rules for the build |
| `design-reference/` | Working prototypes with fictional data |
| `docs/PHASE-0-PLAN.md` | The plan, what the docs changed, and open questions |
| `docs/RLS-PLAN.md` | Who can see and do what, and how it's tested |
| `supabase/migrations/` | Database schema and Row Level Security (draft) |
| `supabase/seed.sql` | Institution lists from §7.1 |
| `supabase/tests/` | Access-rule tests (`bash supabase/tests/run-local.sh`) |
| `.env.example` | Every environment variable, one line each |
| `docs/SETUP.md` | Step-by-step set-up of Supabase, Google, Resend and Vercel |
| `src/` | The Next.js app |
| `tests/` | Integration (real Supabase) and end-to-end (real browser) tests |

## Run it locally

```bash
npm install
npx supabase start          # local Supabase in Docker; prints its URL and keys
cp .env.example .env.local  # fill in the local URL and keys; OWNER_EMAILS=you@example.test
npm run dev                 # http://localhost:3000 · emails appear at http://127.0.0.1:54324
```

Tests: `npm test` (rules) · `npm run test:db` (access rules on plain Postgres) · `npm run test:integration` and `npm run test:e2e` (need local Supabase; see the top of each file).

*Education, not financial advice. MFG teaches money skills. We do not give financial advice or sell financial products.*
