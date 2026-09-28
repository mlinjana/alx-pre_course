import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext, syncAccount } from "@/lib/account";
import { siteUrl } from "@/lib/env";

// Links in Supabase emails (sign-up, password reset, invite) land here.
// Email templates must point to:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<where to go>
// (Supabase docs: Auth → Passwords, PKCE flow.) See docs/SETUP.md.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/account/update-password" : type === "invite" ? "/account/update-password?welcome=1" : "/";
  const next = safeNext(searchParams.get("next"), fallback, siteUrl());

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      await syncAccount(data.user.id);
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
