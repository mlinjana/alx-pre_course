import type { NextRequest } from "next/server";
import { isPayday, ordinal, paydayDue, saDate } from "@/lib/calc/climb";
import { shortName } from "@/lib/domain/assignment";
import { firstName } from "@/lib/domain/signup";
import { siteUrl } from "@/lib/env";
import { sendTemplate } from "@/lib/email";
import { parseTemplate } from "@/lib/email-template";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Payday reminder emails (§8), run once a day by Vercel Cron (see vercel.json).
 * Secured with CRON_SECRET, as in Vercel's docs. Safe to run twice: each client is
 * reminded at most once per payday (clients.payday_reminded_for). No figures in the email.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const today = saDate(new Date());

  const [{ data: settings }, { data: clients, error }] = await Promise.all([
    admin.from("settings").select("value").eq("key", "email_payday_reminder").maybeSingle(),
    admin
      .from("clients")
      .select("id, payday, payday_reminded_for, profiles(email, full_name)")
      .eq("status", "active"),
  ]);
  if (error) return Response.json({ ok: false, error: "Could not read clients." }, { status: 500 });
  const template = parseTemplate(settings?.value);

  const dueToday = (clients || []).filter((c) => isPayday(c.payday, today) && c.payday_reminded_for !== today);
  let sent = 0;
  const skipped: string[] = [];

  for (const c of dueToday) {
    const [{ data: updates }, { data: assignment }] = await Promise.all([
      admin.from("monthly_updates").select("updated_at").eq("client_id", c.id).order("updated_at", { ascending: false }).limit(1),
      admin.from("assignments").select("coach_id").eq("client_id", c.id).is("ended_at", null).maybeSingle(),
    ]);
    const lastUpdate = updates?.[0] ? saDate(new Date(updates[0].updated_at)) : null;
    if (!paydayDue(lastUpdate, c.payday, today)) continue; // already updated since payday
    if (!assignment) continue;

    const { data: coach } = await admin.from("profiles").select("full_name").eq("id", assignment.coach_id).maybeSingle();
    const person = (Array.isArray(c.profiles) ? c.profiles[0] : c.profiles) as { email: string; full_name: string | null } | null;
    if (!person?.email) continue;

    const result = await sendTemplate(person.email, template, {
      first_name: firstName(person.full_name),
      payday: ordinal(c.payday),
      coach_name: coach?.full_name ? shortName(coach.full_name) : "your coach",
      login_url: `${siteUrl()}/login`,
    });
    if (result.sent) {
      sent++;
      await admin.from("clients").update({ payday_reminded_for: today }).eq("id", c.id);
    } else {
      skipped.push(result.reason);
    }
  }

  return Response.json({ ok: true, today, checked: dueToday.length, sent, notSent: skipped.length, reason: skipped[0] ?? null });
}
