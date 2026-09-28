"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { checkAboutYou, checkWhereYouAre, stageFromAnswers, type Answers } from "@/lib/domain/signup";

export type DetailsState = { error?: string; step?: 2 | 3; values?: Record<string, string> };

const AUTH_METHODS = ["email", "google", "apple", "facebook", "linkedin"] as const;

// Screens 2 and 3 are sent together, so nobody lands in the waiting room half signed up.
export async function completeSignup(_: DetailsState, fd: FormData): Promise<DetailsState> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (v.client || v.coach || v.profile?.is_owner) redirect("/");

  const s = (k: string) => String(fd.get(k) ?? "").trim();
  // Sent back on error so the form can put everything back (React resets forms after an action).
  const values: Record<string, string> = {};
  for (const k of ["name", "whatsapp", "need", "heard", "q1", "q2", "q3", "q4", "consent", "terms"]) values[k] = s(k);
  const about = { name: s("name").replace(/\s+/g, " "), whatsapp: s("whatsapp"), need: s("need"), heard: s("heard") };
  const aboutProblem = checkAboutYou(about);
  if (aboutProblem) return { error: aboutProblem, step: 2, values };

  const answers: Answers = { q1: s("q1"), q2: s("q2"), q3: s("q3"), q4: s("q4") };
  const whereProblem = checkWhereYouAre(answers, fd.get("terms") === "on");
  if (whereProblem) return { error: whereProblem, step: 3, values };

  // The stage is worked out here, on the server. The four answers are not stored (§4 default).
  const stage = stageFromAnswers(answers);
  const provider = v.provider === "linkedin_oidc" ? "linkedin" : v.provider;
  const authMethod = (AUTH_METHODS as readonly string[]).includes(provider) ? provider : "email";
  const now = new Date().toISOString();

  const supabase = await createClient();
  const profile = await supabase
    .from("profiles")
    .update({ full_name: about.name, whatsapp: about.whatsapp, updated_at: now })
    .eq("id", v.userId);
  if (profile.error) return { error: "We couldn't save your details. Try again in a moment.", step: 2, values };

  const client = await supabase.from("clients").insert({
    id: v.userId,
    need: about.need,
    heard_from: about.heard,
    auth_method: authMethod,
    stage_start: stage,
    consent: fd.get("consent") === "on",
    terms_at: now,
  });
  if (client.error) return { error: "We couldn't finish your sign-up. Try again in a moment.", step: 3, values };

  redirect("/welcome");
}
