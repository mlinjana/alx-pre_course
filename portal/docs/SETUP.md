# Setting up the MFG Portal

Plain steps for Chuma. Each step says where to click. Where a name on screen differs from what's written here, trust the screen and tell Claude.

## A. Supabase (database and logins)

1. Go to supabase.com and create a **new project**.
   - Name: `mfg-portal`.
   - Region: choose with your attorney (POPIA and cross-border transfer).
   - Save the database password in a password manager.
2. **Run the database set-up.**
   - Open **SQL Editor**.
   - Paste the whole of `supabase/migrations/20260928000000_initial_schema.sql` and run it.
   - Then paste `supabase/seed.sql` and run it. This loads the institution lists.
   - (Or Claude can run it for you with the Supabase CLI once the project is linked.)
3. **Authentication → Sign In / Providers:**
   - Email: on, with **Confirm email** on.
   - Minimum password length: 8.
4. **Authentication → URL Configuration:**
   - Site URL: `https://portal.mlinjanafinancialgroup.com`
   - Redirect URLs: add `https://portal.mlinjanafinancialgroup.com/**`, and while testing also the Vercel preview address, for example `https://*-mfg.vercel.app/**`.
5. **Authentication → Emails → Templates.** For each of **Confirm signup**, **Reset password** and **Invite user**:
   - replace the message body with the matching file in `supabase/templates/` (`confirmation.html`, `recovery.html`, `invite.html`)
   - set the subject lines shown in `supabase/config.toml`

   This makes every link go through `/auth/confirm`, which is how Supabase recommends it for Next.js.
6. **Two-step login:** TOTP is on by default in every Supabase project, per the Supabase docs. Nothing to do.
7. **Project Settings → API keys.** Copy:
   - the **Project URL**
   - the **Publishable key**
   - the **Secret key**: keep this private. It only goes into Vercel.

## B. Google sign-in

1. In Google Cloud Console, create an **OAuth client ID** of type **Web application**.
2. Under **Authorised redirect URIs**, add the callback URL that Supabase shows on its Google provider page (it ends in `/auth/v1/callback`).
3. In Supabase → Authentication → Providers → **Google**:
   - paste the Client ID and Client secret
   - switch it on

## C. Resend (email)

1. Create a Resend account.
2. Add the domain `mlinjanafinancialgroup.com` and add the DNS records it shows at your domain host. Wait for "Verified".
3. Create an **API key** with sending access.
4. In Supabase → Authentication → Emails → **SMTP Settings**, switch on custom SMTP with Resend's SMTP details from Resend's docs. The sender can be, for example, `portal@mlinjanafinancialgroup.com`.
   - Without this, Supabase only sends about 2 auth emails an hour (per the Supabase docs).

## D. Vercel (hosting)

1. **Add New → Project** and import the portal repository.
   - Set **Root Directory** to `portal` while the code is still inside `alx-pre_course`. Once it moves to `mfg-portal`, leave it blank.
2. **Environment Variables:** add everything in `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
   - `OWNER_EMAILS`: your email(s)
   - `NEXT_PUBLIC_SITE_URL`
   - `NEXT_PUBLIC_AUTH_GOOGLE=true`
   - `EMAIL_API_KEY` (Resend key) and `EMAIL_FROM`, for example `MFG Portal <portal@mlinjanafinancialgroup.com>`
   - `STAFF_IDLE_TIMEOUT_MINUTES=30`
   - `CRON_SECRET`: a random string of at least 16 characters (per Vercel's docs). The daily payday-reminder job in `vercel.json` checks it.
3. Deploy.
4. **Settings → Domains:** add `portal.mlinjanafinancialgroup.com` and follow the DNS instructions.
5. Check Vercel's current terms: a business site needs a plan that allows commercial use.

## E. First log-in as owner

1. Open the portal and choose **I want help with my money**. This is only to create your login: use the email that's in `OWNER_EMAILS`.
2. Confirm your email from the link.
3. You'll go straight to **two-step login**:
   - scan the QR code with Google Authenticator or Microsoft Authenticator
   - type the 6-digit code
4. You're in the **Owner view**.
