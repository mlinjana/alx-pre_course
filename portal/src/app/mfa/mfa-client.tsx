"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = { kind: "loading" } | { kind: "verify"; factorId: string } | { kind: "enrol"; factorId: string; qr: string; secret: string } | { kind: "error"; message: string };

// Two-step login with an authenticator app (TOTP), required for owner and coaches (§11.2).
export function MfaClient({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setMode({ kind: "error", message: "We couldn't load your two-step login. Refresh the page." });
      const verified = data.totp[0];
      if (verified) return setMode({ kind: "verify", factorId: verified.id });

      // Clear any half-finished set-up, then start a fresh one.
      for (const f of data.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrol = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app", issuer: "MFG Portal" });
      if (enrol.error) return setMode({ kind: "error", message: "We couldn't start the set-up. Refresh the page." });
      setMode({ kind: "enrol", factorId: enrol.data.id, qr: enrol.data.totp.qr_code, secret: enrol.data.totp.secret });
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind !== "verify" && mode.kind !== "enrol") return;
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) return setError("Type the 6-digit code from your authenticator app.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: clean });
    setBusy(false);
    if (error) {
      setCode("");
      return setError("That code didn't work. Codes change every 30 seconds: type the one showing now.");
    }
    window.location.assign(next);
  }

  if (mode.kind === "loading") return <p className="note">Loading…</p>;
  if (mode.kind === "error") return <div className="suerr" role="alert">{mode.message}</div>;

  return (
    <form onSubmit={submit} className="stack">
      {mode.kind === "enrol" && (
        <div className="card ticks stack">
          <h3>Set up once</h3>
          <ol className="steps">
            <li>Install an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.</li>
            <li>In the app, add an account and scan this code.</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          <div className="qr">
            {/* Supabase returns the QR code as an SVG data URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mode.qr} alt="QR code for your authenticator app" />
          </div>
          <p className="note">
            Can&apos;t scan? Type this key into the app instead: <code style={{ fontFamily: "var(--mono)", overflowWrap: "anywhere" }}>{mode.secret}</code>
          </p>
        </div>
      )}
      <label className="f">
        6-digit code
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={7}
          style={{ fontFamily: "var(--mono)", fontSize: 22, letterSpacing: ".3em" }}
          autoFocus
        />
      </label>
      {error && <div className="suerr" role="alert">{error}</div>}
      <button className="btn gold" type="submit" disabled={busy}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
