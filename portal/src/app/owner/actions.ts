"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/account";
import { siteUrl } from "@/lib/env";
import { sendTemplate } from "@/lib/email";
import { parseTemplate } from "@/lib/email-template";
import { firstName, digitCount, isPositiveWhole, wordCount } from "@/lib/domain/signup";
import { shortName } from "@/lib/domain/assignment";
import { getViewer } from "@/lib/viewer";

export type ActionResult = { ok?: string; error?: string; warn?: string };

// Every owner action checks here, and the database checks again (RLS needs owner + two-step login).
async function ownerClient() {
  const v = await getViewer();
  if (!v?.profile?.is_owner || v.aal !== "aal2") return null;
  return { v, supabase: await createClient() };
}

const NOT_OWNER: ActionResult = { error: "Only the owner can do this. Log in again with two-step login." };

async function template(supabase: Awaited<ReturnType<typeof createClient>>, key: string) {
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return parseTemplate(data?.value);
}

function done(ok: string, emailNote?: string): ActionResult {
  revalidatePath("/owner");
  return emailNote ? { ok, warn: emailNote } : { ok };
}

// ---------------------------------------------------------------- assignment

export async function assignClient(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { supabase } = ctx;
  const clientId = String(fd.get("client") || "");
  const coachId = String(fd.get("coach") || "");
  if (!clientId || !coachId) return { error: "Choose a coach first." };

  const { error } = await supabase.rpc("assign_client", { p_client: clientId, p_coach: coachId });
  if (error) {
    // The database's own messages are written for people ("Nomsa D. is full. Pick another coach…").
    const known = /is full|certified coaches|Only the owner/.test(error.message);
    return { error: known ? error.message : "We couldn't assign this client. Try again." };
  }

  const [{ data: client }, { data: coach }] = await Promise.all([
    supabase.from("profiles").select("email, full_name").eq("id", clientId).single(),
    supabase.from("profiles").select("full_name").eq("id", coachId).single(),
  ]);
  const coachName = shortName(coach?.full_name || "your coach");
  const result = client?.email
    ? await sendTemplate(client.email, await template(supabase, "email_client_assigned"), {
        first_name: firstName(client.full_name),
        coach_name: coachName,
        login_url: `${siteUrl()}/login`,
      })
    : { sent: false as const, reason: "The client has no email address." };

  return done(
    `${client?.full_name || "Client"} is now with ${coachName}.`,
    result.sent ? undefined : `No email was sent: ${result.reason}`,
  );
}

// ---------------------------------------------------------------- applications

export async function approveApplication(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { v, supabase } = ctx;
  const id = String(fd.get("application") || "");
  const { data: app } = await supabase.from("coach_applications").select("*").eq("id", id).maybeSingle();
  if (!app || app.status !== "pending") return { error: "That application has already been dealt with." };

  const { error: coachError } = await supabase.from("coaches").insert({
    id: app.applicant_id,
    status: "training",
    capacity: app.capacity,
    province: app.province,
    experience: app.experience,
    application_id: app.id,
  });
  if (coachError) return { error: "We couldn't start their training record. Are they already a coach?" };

  await supabase
    .from("coach_applications")
    .update({ status: "approved", decided_by: v.userId, decided_at: new Date().toISOString() })
    .eq("id", id);

  const result = await sendTemplate(app.email, await template(supabase, "email_coach_approved"), {
    first_name: firstName(app.full_name),
    login_url: `${siteUrl()}/login`,
  });
  return done(`${app.full_name} is approved for training.`, result.sent ? undefined : `No email was sent: ${result.reason}`);
}

export async function declineApplication(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { v, supabase } = ctx;
  const id = String(fd.get("application") || "");
  const { data: app } = await supabase.from("coach_applications").select("*").eq("id", id).maybeSingle();
  if (!app || app.status !== "pending") return { error: "That application has already been dealt with." };

  await supabase
    .from("coach_applications")
    .update({ status: "declined", decided_by: v.userId, decided_at: new Date().toISOString() })
    .eq("id", id);

  const result = await sendTemplate(app.email, await template(supabase, "email_declined_coach"), {
    first_name: firstName(app.full_name),
  });
  return done(`${app.full_name}'s application is declined.`, result.sent ? undefined : `No email was sent: ${result.reason}`);
}

// ---------------------------------------------------------------- coaches

export async function markCertified(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { supabase } = ctx;
  const id = String(fd.get("coach") || "");
  const { error } = await supabase
    .from("coaches")
    .update({ status: "certified", certified_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "training");
  if (error) return { error: "We couldn't mark this coach certified." };
  return done("Marked certified. They can now be assigned clients.");
}

export async function setCoachActive(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { supabase } = ctx;
  const id = String(fd.get("coach") || "");
  const pause = fd.get("pause") === "1";
  const { data: coach } = await supabase.from("coaches").select("status, certified_at").eq("id", id).single();
  if (!coach) return { error: "Coach not found." };
  const status = pause ? "inactive" : coach.certified_at ? "certified" : "training";
  const { error } = await supabase.from("coaches").update({ status }).eq("id", id);
  if (error) return { error: "We couldn't change this coach's status." };
  return done(pause ? "Coach paused. They can't see any client until you switch them back on." : "Coach switched back on.");
}

export async function setCapacity(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { supabase } = ctx;
  const id = String(fd.get("coach") || "");
  const raw = String(fd.get("capacity") || "");
  if (!isPositiveWhole(raw)) return { error: "Capacity must be a whole number above 0." };
  const capacity = Number(raw);
  const { count } = await supabase
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("coach_id", id)
    .is("ended_at", null);
  if ((count ?? 0) > capacity) {
    return { error: `This coach has ${count} clients. Move some first, or choose ${count} or more.` };
  }
  const { error } = await supabase.from("coaches").update({ capacity }).eq("id", id);
  if (error) return { error: "We couldn't change the capacity." };
  return done(`Capacity is now ${capacity}.`);
}

/**
 * "Add a coach directly" (§5): creates a certified coach and sends the invite.
 * Uses the secret key only to invite the new login; everything else goes through RLS as the owner.
 */
export async function addCoachDirectly(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await ownerClient();
  if (!ctx) return NOT_OWNER;
  const { supabase } = ctx;
  const name = String(fd.get("name") || "").trim().replace(/\s+/g, " ");
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const whatsapp = String(fd.get("whatsapp") || "").trim();
  const capacityRaw = String(fd.get("capacity") || "");
  if (wordCount(name) < 2) return { error: "Add their first name and surname." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (digitCount(whatsapp) < 9) return { error: "Add their WhatsApp number." };
  if (!isPositiveWhole(capacityRaw)) return { error: "Say how many clients they can take." };

  const { data: existing } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  let userId = existing?.id as string | undefined;
  let invited = false;

  if (userId) {
    const [{ data: isClient }, { data: isCoach }] = await Promise.all([
      supabase.from("clients").select("id").eq("id", userId).maybeSingle(),
      supabase.from("coaches").select("id").eq("id", userId).maybeSingle(),
    ]);
    if (isClient) return { error: "That email belongs to a client account. Use a different email for coaching." };
    if (isCoach) return { error: "That person is already a coach. Change their status in the table." };
  } else {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl()}/account/update-password?welcome=1`,
      data: { full_name: name },
    });
    if (error || !data.user) {
      return { error: error?.status === 429 ? "Too many invites just now. Wait a few minutes." : "We couldn't send the invite. Check the email address." };
    }
    userId = data.user.id;
    invited = true;
    await syncAccount(userId);
  }

  await supabase.from("profiles").update({ full_name: name, whatsapp }).eq("id", userId);
  const now = new Date().toISOString();
  const { error } = await supabase.from("coaches").insert({
    id: userId,
    status: "certified",
    capacity: Number(capacityRaw),
    certified_at: now,
    invite_sent_at: invited ? now : null,
  });
  if (error) return { error: "The login was created, but we couldn't save the coach. Try again." };
  return done(invited ? `${name} is added as a certified coach. Their invite email is on its way.` : `${name} is added as a certified coach.`);
}
