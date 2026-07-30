# Mlinjana Financial Group — Client Debt Tool

An internal staff tool that pulls a client's credit data and shows what they owe:
total debt, who it is owed to, how far behind they are, whether they can afford
the repayments, and what a restructured plan would look like.

It is a Node.js application with its own database and staff logins. The public
Mlinjana marketing site in the parent directory is untouched by it.

---

## What it does

**Pull a credit profile.** Runs an enquiry against a South African credit bureau
(TransUnion, Experian or XDS) and stores the result as a dated, immutable
snapshot. Every pull is kept, so "what did this client owe in March" stays
answerable and a disputed balance can be traced back to what the bureau actually
sent.

**Import a report the client already has.** Every South African is entitled to a
free credit report each year. If a client brings theirs, the tool reads the
accounts out of the PDF — no enquiry fee, and no extra search recorded against
their credit record. Because PDF layout parsing is unreliable, the tool proposes
rows with a confidence score and the source text, and a consultant confirms or
corrects each one before anything is saved.

**Show what they owe.** Total owed, monthly repayments, arrears, and a credit
score, then a breakdown by creditor (with differently-spelled versions of the
same creditor totalled together) and by type of debt.

**Assess affordability.** Captures income and living expenses, then reports
disposable income, debt-to-income, instalment-to-income, and the indicators of
over-indebtedness under section 79 of the National Credit Act — with its
reasoning shown, because the determination is the debt counsellor's to make, not
the software's.

**Model a restructure.** Distributes available income across creditors pro-rata
to balance, holds secured accounts (home, vehicle) at their contractual
instalment where the income allows, and amortises each account to a term. It
flags plans that would never settle a debt and plans that run past the usual
five-year guideline.

---

## What it is not

- **Not a bureau contract.** Running live enquiries needs a signed subscriber
  agreement with the bureau, credentials, and NCR registration as a debt
  counsellor. The adapters are written and ready; they activate when credentials
  are present. Until then the tool runs against a built-in simulated bureau, and
  everything it produces is badged **SIMULATED** in the interface.
- **Not a binding proposal.** The restructure is a model. What actually binds is
  what creditors accept or a magistrate orders under section 87 of the NCA.
- **Not client-facing.** There is no public sign-up. Staff accounts only.

---

## Getting started

```bash
cd debt-tool
npm install

cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste into APP_SECRET

npm run seed     # creates the first admin and prints its password once
npm start        # http://localhost:4000
```

Outside production, `npm run seed` also creates a demonstration client with a
simulated profile so you can see the tool working before any bureau contract
exists.

```bash
npm test         # 99 tests
npm run dev      # restarts on file changes
```

Requires Node 22.5 or newer — the database layer uses the built-in `node:sqlite`,
so there is nothing to compile.

---

## Connecting a real credit bureau

Fill in the credentials for whichever bureau you have a contract with and
restart. The provider appears on the enquiry form as soon as its settings are
complete; **Settings → Credit bureaus** shows what is still missing.

| Bureau | Environment variables |
| --- | --- |
| TransUnion | `TRANSUNION_BASE_URL`, `TRANSUNION_CLIENT_ID`, `TRANSUNION_CLIENT_SECRET`, `TRANSUNION_SUBSCRIBER_CODE` |
| Experian | `EXPERIAN_BASE_URL`, `EXPERIAN_USERNAME`, `EXPERIAN_PASSWORD`, `EXPERIAN_SUBSCRIBER_CODE` |
| XDS | `XDS_BASE_URL`, `XDS_USERNAME`, `XDS_PASSWORD` |

Then set `BUREAU_DEFAULT` to that bureau and `BUREAU_ALLOW_MOCK=false`.

The adapters are built against each bureau's documented request shape and read
every response field from a list of candidate keys, because field names vary by
product tier. When your live specification arrives, the response mapping in
`normalise()` in `src/bureaus/<bureau>.js` is the only place that should need
editing — nothing above that layer knows which bureau a balance came from.

Adding a fourth bureau means subclassing `BureauProvider`
(`src/bureaus/provider.js`) and registering it in `src/bureaus/index.js`.

---

## Compliance

This tool holds ID numbers and credit records, which makes it a POPIA
responsibility as much as a piece of software. What is built in:

- **Consent is enforced, not assumed.** A bureau enquiry is refused unless a
  live, unrevoked, unexpired consent for `bureau_enquiry` is on the client's
  file. The check lives in one place (`src/services/consent.js`) and every
  enquiry path calls it, so a new route cannot forget it.
- **ID numbers are encrypted at rest** (AES-256-GCM), searchable through a keyed
  blind index rather than by decrypting. Only the last four digits appear in the
  interface, and the API never returns the full number.
- **Every access is logged** — who viewed which file, who ran which enquiry, who
  changed what. The audit log is append-only; nothing in the application updates
  or deletes it.
- **Uploaded reports are never written to disk.** They are parsed in memory and
  discarded; only the confirmed accounts are stored.
- **Simulated data is unmistakable.** Mock pulls are flagged on the snapshot,
  badged in the interface, and `BUREAU_ALLOW_MOCK=false` disables them entirely.

Before going live, three things are yours rather than the software's:

1. **NCR registration.** Debt counselling and bureau enquiries for debt review
   are regulated activities.
2. **The living-expense figures.** `LIVING_EXPENSE_BANDS` in
   `src/services/affordability.js` mirrors the structure of the NCR
   affordability guidelines, but the published amounts are revised periodically.
   Check them against the current notice before relying on them in a section 86
   application.
3. **Backups and hosting.** The database is a single encrypted-fields SQLite
   file. Back it up somewhere encrypted, and keep `APP_SECRET` safe and separate
   — losing it makes every stored ID number unreadable.

The application refuses to start in production if `APP_SECRET` is unset,
`COOKIE_SECURE` is off, or the simulated bureau is still enabled.

---

## How it is put together

```
src/
  config.js              settings, and the production safety checks
  app.js / server.js     express wiring
  db/
    schema.sql           tables; all money is integer cents
    crypto.js            field encryption, blind index, password hashing
  bureaus/
    provider.js          the interface every bureau adapter implements
    transunion.js        live adapters, built to each documented contract
    experian.js
    xds.js
    mock.js              simulated bureau, deterministic per ID number
    normalise.js         maps any bureau's payload to one canonical account
  ingest/
    pdfReport.js         reads accounts out of a bureau report PDF
  services/
    clients.js           client records, SA ID validation
    consent.js           the consent gate
    snapshots.js         runs enquiries, stores immutable snapshots
    debtProfile.js       totals, per-creditor, per-type
    affordability.js     disposable income, DTI, over-indebtedness
    restructure.js       the proposed plan
    audit.js             append-only access log
    clientView.js        assembles the dashboard, shared by HTML and JSON
  routes/                auth, clients, ingest, admin, api
  views/                 EJS templates, styled to match the public site
test/                    99 tests
```

Two decisions worth knowing about:

**Money is integer cents everywhere.** Rands only appear at the edges — form
input and rendered output. Floating-point drift on a debt balance is a
compliance problem, not a rounding quirk.

**Timestamps go through `src/lib/dates.js`.** SQLite has no date type, so
comparisons against `datetime('now')` are string comparisons. An ISO-8601 value
written straight from JavaScript sorts *after* SQLite's own format, which
silently broke the consent check — consent recorded a second ago read as not yet
in force. Everything written to a datetime column goes through `toSqlDateTime`.

---

## JSON API

The same data as the staff interface, authenticated with the same session
cookie. Useful for reporting scripts.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/clients?q=` | search clients, with each one's total owed |
| `GET /api/clients/:id` | the full debt picture: accounts, affordability, restructure |
| `GET /api/clients/:id?snapshot=:sid` | the same, as at an earlier pull |
| `POST /api/clients/:id/pull` | run a bureau enquiry (consent still enforced) |
| `GET /api/providers` | which bureaus are configured |

---

## Roles

| Role | Can do |
| --- | --- |
| `readonly` | view client files and their figures |
| `consultant` | the above, plus create clients, capture consent and income, run enquiries, import reports |
| `admin` | the above, plus staff accounts, the audit log, and settings |
