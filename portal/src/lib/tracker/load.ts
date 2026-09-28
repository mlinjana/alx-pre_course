import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ITEMS, numText, type Institution, type TDebt, type TItem, type TrackerData } from "./model";

/** Everything the Tracker shows, for one client, read through RLS. */
export async function loadTracker(supabase: SupabaseClient, clientId: string): Promise<{ data: TrackerData; institutions: Institution[] }> {
  const [inst, debts, budget, redLines, attack, progress] = await Promise.all([
    supabase.from("institutions").select("id, debt_type, name").eq("active", true).order("debt_type").order("sort"),
    supabase
      .from("debts")
      .select("id, debt_type, institution_id, other_name, family_who, balance, rate, minimum, status, other_confirmed")
      .eq("client_id", clientId)
      .is("closed_at", null)
      .order("sort")
      .order("created_at"),
    supabase
      .from("month_budget")
      .select("id, month, take_home, gross, budget_items(id, grp, label, amount, sort)")
      .eq("client_id", clientId)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("red_lines")
      .select("borrowing, missed_three, no_savings, min_only_high")
      .eq("client_id", clientId)
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("attack_plan").select("method, extra").eq("client_id", clientId).maybeSingle(),
    supabase.from("monthly_updates").select("month, total").eq("client_id", clientId).order("month"),
  ]);
  const failed = [inst, debts, budget, redLines, attack, progress].find((r) => r.error);
  if (failed?.error) throw new Error("Could not load the Tracker.");

  const institutions: Institution[] = (inst.data || []).map((i) => ({ id: i.id, type: i.debt_type, name: i.name }));

  const tDebts: TDebt[] = (debts.data || []).map((d) => ({
    id: d.id,
    type: d.debt_type,
    institutionId: d.institution_id,
    useOther: d.other_name !== null,
    otherName: d.other_name || "",
    familyWho: d.family_who || "",
    balance: numText(d.balance),
    rate: numText(d.rate),
    minimum: numText(d.minimum),
    status: d.status,
    otherConfirmed: d.other_confirmed,
  }));

  type Row = { id: string; grp: TItem["grp"]; label: string; amount: number | null; sort: number };
  const b = budget.data as (typeof budget.data & { budget_items: Row[] }) | null;
  const items: TItem[] = b
    ? [...b.budget_items].sort((x, y) => x.sort - y.sort).map((i) => ({ id: i.id, grp: i.grp, label: i.label, amount: numText(i.amount) }))
    : DEFAULT_ITEMS.map(([grp, label]) => ({ id: crypto.randomUUID(), grp, label, amount: "" }));

  return {
    institutions,
    data: {
      debts: tDebts,
      budget: { month: b?.month ?? null, takeHome: numText(b?.take_home), gross: numText(b?.gross), items },
      redLines: {
        borrowing: redLines.data?.borrowing ?? null,
        missedThree: redLines.data?.missed_three ?? null,
        noSavings: redLines.data?.no_savings ?? null,
        minOnlyHigh: redLines.data?.min_only_high ?? null,
      },
      attack: { method: attack.data?.method === "snowball" ? "snowball" : "avalanche", extra: numText(attack.data?.extra) },
      progress: (progress.data || []).map((p) => ({ month: p.month, total: Number(p.total) })),
    },
  };
}
