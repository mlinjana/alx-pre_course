"use server";

import { revalidatePath } from "next/cache";
import { climbScore, rungOf, stageOf, EF_OPTIONS } from "@/lib/calc/climb";
import { parseAmount } from "@/lib/calc/tracker";
import { currentMonth } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { computeCalc } from "@/lib/tracker/compute";
import { loadTracker } from "@/lib/tracker/load";
import { getViewer } from "@/lib/viewer";

export type UpdateState = { error?: string; ok?: string; savedAt?: number; values?: Record<string, string> };

const MAX = 1_000_000_000;

/**
 * The monthly update (§8). Stage, rung and Climb score are worked out here on the server,
 * from the form and the client's Tracker, then saved with the month.
 */
export async function submitMonthlyUpdate(_: UpdateState, fd: FormData): Promise<UpdateState> {
  const v = await getViewer();
  if (!v?.client) return { error: "Log in again to save your update." };
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const values = Object.fromEntries(["total", "openAccounts", "minimums", "gross", "newCredit", "borrowing", "payday", "ef", "assetIncome"].map((k) => [k, s(k)]));
  const fail = (error: string): UpdateState => ({ error, values });

  const total = parseAmount(values.total);
  const minimums = parseAmount(values.minimums);
  const gross = parseAmount(values.gross);
  const assetIncome = values.assetIncome ? parseAmount(values.assetIncome) : 0;
  const open = /^\d{1,3}$/.test(values.openAccounts) ? Number(values.openAccounts) : null;
  const payday = /^\d{1,2}$/.test(values.payday) ? Number(values.payday) : null;
  const ef = Number(values.ef);

  if (total === null || total > MAX) return fail("Add your total debt now. If it's paid off, type 0.");
  if (open === null) return fail("Add how many accounts are still open. If none, type 0.");
  if (minimums === null || minimums > MAX) return fail("Add your minimum debt payments this month. If none, type 0.");
  if (gross === null || gross <= 0 || gross > MAX) return fail("Add your pay before deductions (the top of your payslip).");
  if (values.newCredit !== "yes" && values.newCredit !== "no") return fail("Say whether you took any new credit this month.");
  if (values.borrowing !== "yes" && values.borrowing !== "no") return fail("Say whether you borrowed to pay a debt.");
  if (payday === null || payday < 1 || payday > 31) return fail("Your payday is a day of the month, from 1 to 31.");
  if (!EF_OPTIONS.some(([n]) => n === ef)) return fail("Choose how many months of emergency savings you have.");
  if (assetIncome === null || assetIncome > MAX) return fail("Check the amount your assets pay you each month, or leave it empty.");

  const supabase = await createClient();
  // Gap after cuts = take-home − (Critical + Important + minimums), from the Tracker's month (§7.3).
  const tracker = await loadTracker(supabase, v.userId);
  const calc = computeCalc(tracker.data, tracker.institutions);
  if (calc.takeHome === null) {
    return fail("Add your take-home pay in My month in your Debt Ladder Tracker first. We need it to work out your stage.");
  }
  const gapAfterCuts = calc.takeHome - (calc.groups.critical + calc.groups.important + minimums);
  const newCredit = values.newCredit === "yes";
  const borrowing = values.borrowing === "yes";

  const stage = stageOf({ gapAfterCuts, newCredit, borrowing, totalDebt: total, efMonths: ef, assetIncome });
  const rung = rungOf((minimums / gross) * 100);
  if (stage === null || rung === null) return fail("We couldn't work out your stage. Check your numbers.");

  const { error } = await supabase.from("monthly_updates").upsert(
    {
      client_id: v.userId,
      month: currentMonth(),
      total,
      open_accounts: open,
      minimums,
      gross,
      new_credit: newCredit,
      borrowing,
      ef_months: ef,
      asset_income: assetIncome,
      gap_after_cuts: Math.round(gapAfterCuts * 100) / 100,
      stage,
      rung,
      climb: climbScore(stage, rung),
    },
    { onConflict: "client_id,month" },
  );
  if (error) return fail("Your update wasn't saved. Check your connection and try again.");

  const paydayResult = await supabase.from("clients").update({ payday }).eq("id", v.userId);
  if (paydayResult.error) return fail("Your update was saved, but not your payday. Try again.");

  revalidatePath("/home");
  return { ok: "Saved. Your stage and Climb score are up to date.", savedAt: Date.now() };
}

/** The sharing switch. Coach access stops the moment it's off (enforced by RLS). */
export async function setConsent(consent: boolean): Promise<{ ok: boolean }> {
  const v = await getViewer();
  if (!v?.client) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ consent }).eq("id", v.userId);
  revalidatePath("/home");
  return { ok: !error };
}

export async function tickHomework(id: string, done: boolean): Promise<{ ok: boolean }> {
  const v = await getViewer();
  if (!v?.client || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("homework")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("client_id", v.userId);
  return { ok: !error };
}
