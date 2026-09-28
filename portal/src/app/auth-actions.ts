"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/account";
import { siteUrl } from "@/lib/env";
import { checkEmailPassword } from "@/lib/domain/signup";

export type FormState = { error?: string; sent?: boolean; email?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function signInWithEmail(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Confirm your email first. Check your inbox for the link from MFG.", email };
    }
    if (error.status === 429) return { error: "Too many tries. Wait a few minutes and try again.", email };
    return { error: "That email and password don't match. Try again, or reset your password.", email };
  }
  await syncAccount(data.user.id);
  redirect("/");
}

export async function signUpWithEmail(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  const password = String(fd.get("password") ?? "");
  const asCoach = fd.get("as") === "coach";
  const problem = checkEmailPassword(email, password);
  if (problem) return { error: problem, email };

  const next = asCoach ? "/apply" : "/join/details";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl()}${next}` },
  });
  if (error) {
    if (error.status === 429) return { error: "Too many sign-ups from here. Wait a few minutes and try again.", email };
    if (error.code === "weak_password") return { error: "Choose a stronger password: 8 or more characters, not a common one.", email };
    return { error: "We couldn't create your account. Check your email address and try again.", email };
  }
  if (data.session && data.user) {
    // Email confirmation is switched off in this Supabase project: carry straight on.
    await syncAccount(data.user.id);
    redirect(next);
  }
  // Same message whether or not the email already has an account, so we don't reveal who is a member.
  return { sent: true, email };
}

export async function requestPasswordReset(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address, like name@example.com.", email };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/account/update-password`,
  });
  if (error?.status === 429) return { error: "Too many requests. Wait a few minutes and try again.", email };
  return { sent: true, email };
}

export async function updatePassword(_: FormState, fd: FormData): Promise<FormState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return { error: "Your password needs 8 or more characters." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "Choose a password you haven't used here before." };
    if (error.code === "insufficient_aal") return { error: "Finish your two-step login first, then change your password." };
    return { error: "We couldn't change your password. Open the link in your email again." };
  }
  redirect("/");
}
