# MFG Portal — rules for Claude Code

You are building the **MFG Portal** for Mlinjana Financial Group (MFG), a South African debt-coaching and financial-education business founded by Chuma Afika Mlinjana, author of *The Debt Millionaire*.

**The full specification is in `PORTAL_SPEC.md`. Read it before any work, and re-read the relevant section at the start of every phase.** The working prototypes in `design-reference/` show the intended screens and behaviour. Match them, but build properly: real auth, real database, and no browser-only storage.

## How to work
1. **Build in the phases of `PORTAL_SPEC.md` §14.** Plan each phase first and show the plan. Build it, run it and test it. Then STOP and report:
   - what you built
   - how Chuma tests it, step by step
   - what you need from him
   - anything you're unsure of

   Don't start the next phase until he says "go".
2. **Check official docs before using any service** (Supabase, Vercel, Next.js, the OAuth providers, the email provider). Never guess an API, field name or config. If the docs conflict with this brief, the docs win. Say what changed.
3. **Keep secrets out of the code.** Every secret goes in environment variables, listed in `.env.example` with a one-line comment each.
4. **Enforce security in the database** with Supabase Row Level Security (§10), not only in the UI.
5. **Never invent financial content, statistics, institutions, helpline numbers or legal text.** Use exactly what the spec gives. Mark anything missing `[CHUMA TO PROVIDE]`.
6. **Plain South African English in the interface.** Short sentences, no jargon. Warm and never judging (§12).
7. **MFG never recommends a financial product, lender, insurer or investment.** Nothing in the app may do so.
8. **Write tests** for every calculation in §7 and every access rule in §10.

@AGENTS.md
