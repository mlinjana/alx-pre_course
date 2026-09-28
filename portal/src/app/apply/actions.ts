"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { checkCoachApplication, type CoachApplication } from "@/lib/domain/signup";

export type ApplyState = { error?: string; values?: Partial<CoachApplication> };

export async function submitApplication(_: ApplyState, fd: FormData): Promise<ApplyState> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (v.client || v.coach) redirect("/");
  if (v.application === "pending") redirect("/apply/thanks");

  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const a: CoachApplication = {
    name: s("name").replace(/\s+/g, " "),
    email: v.email, // their login is the account they applied with
    whatsapp: s("whatsapp"),
    province: s("province"),
    experience: s("experience"),
    readBook: s("readBook"),
    capacity: s("capacity"),
    why: s("why"),
    qualifications: s("qualifications"),
    agreed: fd.get("agreed") === "on",
  };
  const problem = checkCoachApplication(a);
  if (problem) return { error: problem, values: a };

  const supabase = await createClient();
  const { error } = await supabase.from("coach_applications").insert({
    full_name: a.name,
    email: a.email,
    whatsapp: a.whatsapp,
    province: a.province,
    experience: a.experience,
    read_book: a.readBook,
    capacity: Number(a.capacity),
    why: a.why,
    qualifications: a.qualifications || null,
    agreed_protocol: a.agreed,
  });
  if (error) return { error: "We couldn't send your application. Try again in a moment.", values: a };

  await supabase.from("profiles").update({ full_name: a.name, whatsapp: a.whatsapp }).eq("id", v.userId);
  redirect("/apply/thanks");
}
