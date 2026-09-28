"use client";

import { useState } from "react";
import type { Provider } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Flags = { google: boolean; apple: boolean; facebook: boolean; linkedin: boolean };

// Each provider is switched on by an environment flag (§4).
// LinkedIn uses Supabase's "linkedin_oidc" provider (the old "linkedin" one is deprecated).
export function SsoButtons({ flags, next }: { flags: Flags; next: string }) {
  const [error, setError] = useState<string | null>(null);

  async function go(provider: Provider) {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) setError("That sign-in option isn't working right now. Try email instead.");
  }

  if (!flags.google && !flags.apple && !flags.facebook && !flags.linkedin) return null;
  return (
    <>
      {flags.google && (
        <button type="button" className="sso" onClick={() => go("google")}>
          <b aria-hidden>G</b>Continue with Google
        </button>
      )}
      {flags.apple && (
        <button type="button" className="sso" onClick={() => go("apple")}>
          <b aria-hidden></b>Continue with Apple
        </button>
      )}
      {(flags.facebook || flags.linkedin) && (
        <div className="two">
          {flags.facebook && (
            <button type="button" className="sso" onClick={() => go("facebook")}>
              <b aria-hidden>f</b>Facebook
            </button>
          )}
          {flags.linkedin && (
            <button type="button" className="sso" onClick={() => go("linkedin_oidc")}>
              <b aria-hidden>in</b>LinkedIn
            </button>
          )}
        </div>
      )}
      {error && <div className="suerr" role="alert">{error}</div>}
      <div className="or">
        <span>or use your email</span>
      </div>
    </>
  );
}
