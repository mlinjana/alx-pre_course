# Putting the debt tool online

The tool is a server application. It cannot run on a phone, and there is no app
to install — something has to host it and give it a web address. This guide
covers doing that from a phone browser, with no terminal.

Read the warning at the bottom before you put a real client on it.

---

## Deploying from a phone (Render)

Render can build and host straight from the GitHub repository, all through its
website. The repository already contains the two files it needs: `render.yaml`
at the root and `debt-tool/Dockerfile`.

1. **Merge the branch first.** Render reads the blueprint from your default
   branch. Open the repository on GitHub, merge
   `claude/mlinjana-client-debt-tool-wraw2h` into `main`.
2. Go to **render.com**, sign in with GitHub, and grant it access to
   `mlinjana/alx-pre_course`.
3. Choose **New → Blueprint**, pick the repository, and Render will read
   `render.yaml` and show one service, `mfg-debt-tool`.
4. Approve it. The build takes a few minutes.
5. Open the service's **Logs** tab and look for this block:

   ```
   ────────────────────────────────────────────────
     No staff accounts existed, so an administrator was created:
       Email:    admin@mlinjana.co.za
       Password: LUIQjbGpLnwwVUv3
   ────────────────────────────────────────────────
   ```

6. Open the service URL, sign in with those details. You will be taken straight
   to the change-password screen — that is deliberate, the logged password is
   only good once.

The blueprint is not on Render's free plan, because the free plan has no
persistent disk, and without one the database is erased on every restart.

Fly.io and Railway work the same way from the same `Dockerfile`; the settings to
carry across are in the table below.

---

## What the blueprint sets, and why

| Setting | Value | Why |
| --- | --- | --- |
| `APP_SECRET` | generated once | Signs sessions and derives the key that encrypts ID numbers. **Never change it** on a database holding real clients — every stored ID number becomes unreadable. |
| Disk at `/data` | 1 GB | The database is a single SQLite file. No disk means total data loss on every redeploy. |
| `COOKIE_SECURE` | `true` | Session cookies over HTTPS only. |
| `NODE_ENV` | `staging` | Keeps the amber non-production banner visible. |
| `BUREAU_ALLOW_MOCK` | `true` | Lets you click around with simulated data before a bureau contract exists. |

---

## Turning it into a real instance

The blueprint deploys a **demonstration** instance on purpose. Everything it
shows is fictional and badged as such. To use it with real clients:

1. Get your NCR registration and a bureau subscriber agreement in place.
2. In Render's **Environment** tab, add the credentials for your bureau — see
   the table in `README.md` for which variables each one needs.
3. Change `BUREAU_DEFAULT` from `mock` to that bureau.
4. Set `BUREAU_ALLOW_MOCK` to `false`.
5. Set `NODE_ENV` to `production`.

Step 5 activates a startup check: the app will refuse to boot if `APP_SECRET` is
missing, cookies are not HTTPS-only, or the simulated bureau is still enabled.
That refusal is the feature — a misconfigured instance stops, rather than
quietly serving fake debt figures to a real client.

Then, before anyone's file goes on it:

- **Set up backups.** Render's disk snapshots are a start. The database holds
  encrypted ID numbers and credit records; back it up somewhere encrypted.
- **Store `APP_SECRET` somewhere safe and separate** from the backups. Losing it
  is unrecoverable. Having it stored *with* the backup defeats the encryption.
- **Rotate the bootstrap password.** It is sitting in your deploy logs.
- **Add real staff accounts** under Staff, and stop sharing the admin login.

---

## Honest limitations

**I could not build the container image here** — this environment has no Docker
daemon. What I did verify: `npm ci --omit=dev` installs cleanly, the app boots
under exactly the environment variables the blueprint sets, it honours an
injected `PORT`, the first-boot administrator is created and printed, signing in
with that password forces a change, the `Secure` cookie flag is set, and a
restart does not create a second administrator. The Dockerfile itself is
straightforward — copy, `npm ci`, run — but it has not been through a real build.

**Hosting client credit data is a decision, not a step.** Once this is on the
internet it is holding South African ID numbers and credit records, which makes
it a POPIA responsibility. The tool does its part — consent gating, encryption
at rest, an append-only audit log, no ID numbers over the API. The rest is
yours: who has accounts, where backups live, and who is accountable if the
hosting account is compromised. If you are not ready for that, keep the demo
instance and put nothing real on it.
