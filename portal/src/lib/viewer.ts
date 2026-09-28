import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/account";
import { staffIdleTimeoutMs } from "@/lib/env";
import { IDLE_HEADER } from "@/lib/idle";

export type Viewer = {
  userId: string;
  email: string;
  aal: "aal1" | "aal2";
  provider: string;
  profile: { full_name: string | null; whatsapp: string | null; is_owner: boolean } | null;
  client: { status: string; stage_start: number; consent: boolean } | null;
  coach: { status: string; capacity: number } | null;
  application: string | null; // 'pending' | 'approved' | 'declined' | null
};

/** The signed-in person, read through RLS (their own rows only). Null when signed out. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const userId = claims.sub;
  const load = () =>
    Promise.all([
      supabase.from("profiles").select("full_name, whatsapp, is_owner").eq("id", userId).maybeSingle(),
      supabase.from("clients").select("status, stage_start, consent").eq("id", userId).maybeSingle(),
      supabase.from("coaches").select("status, capacity").eq("id", userId).maybeSingle(),
      supabase.rpc("my_application_status"),
    ]);

  let [profile, client, coach, application] = await load();
  if (!profile.data) {
    await syncAccount(userId);
    [profile, client, coach, application] = await load();
  }

  const appMeta = (claims.app_metadata || {}) as { provider?: string };
  return {
    userId,
    email: String(claims.email || ""),
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    provider: appMeta.provider || "email",
    profile: profile.data,
    client: client.data,
    coach: coach.data,
    application: (application.data as string | null) ?? null,
  };
});

export function isStaff(v: Viewer): boolean {
  return Boolean(v.profile?.is_owner || v.coach);
}

/** Where a signed-in person belongs. */
export function homeFor(v: Viewer): string {
  if (isStaff(v) && v.aal !== "aal2") return "/mfa";
  if (v.profile?.is_owner) return "/owner";
  if (v.coach) return "/coach";
  if (v.client) return "/home";
  if (v.application) return "/apply/thanks";
  return "/join/details";
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}

/**
 * Owner and coach pages: two-step login and the 30-minute inactivity rule (§11.2).
 * The database also refuses owner and coach access without two-step login.
 */
export async function requireStaff(kind: "owner" | "coach", path: string): Promise<Viewer> {
  const v = await requireViewer();
  const idle = Number((await headers()).get(IDLE_HEADER) || 0);
  if (idle > staffIdleTimeoutMs()) redirect("/logout?reason=idle");
  if (kind === "owner" && !v.profile?.is_owner) redirect(homeFor(v));
  if (kind === "coach" && !v.coach) redirect(homeFor(v));
  if (v.aal !== "aal2") redirect(`/mfa?next=${encodeURIComponent(path)}`);
  return v;
}
