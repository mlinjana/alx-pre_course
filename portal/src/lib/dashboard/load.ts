import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saDate } from "@/lib/calc/climb";
import { computeCalc } from "@/lib/tracker/compute";
import { loadTracker } from "@/lib/tracker/load";

export type MonthlyUpdate = {
  month: string;
  total: number;
  open_accounts: number | null;
  minimums: number | null;
  gross: number | null;
  new_credit: boolean | null;
  borrowing: boolean | null;
  ef_months: number | null;
  asset_income: number | null;
  gap_after_cuts: number | null;
  stage: number | null;
  rung: number | null;
  climb: number | null;
  updated_at: string;
};

export type Note = {
  id: string;
  call_date: string;
  next_session: string | null;
  covered: string;
  message: string | null;
  homework: { id: string; text: string; done: boolean; sort: number }[];
};

/** Everything the client dashboard shows, read through RLS as the client. */
export async function loadDashboard(supabase: SupabaseClient, clientId: string) {
  const [client, assignment, programme, updates, note, tracker] = await Promise.all([
    supabase.from("clients").select("payday, consent, stage_start, status").eq("id", clientId).single(),
    supabase.from("assignments").select("coach_id").eq("client_id", clientId).is("ended_at", null).maybeSingle(),
    supabase.from("programme").select("week").eq("client_id", clientId).maybeSingle(),
    supabase
      .from("monthly_updates")
      .select("month, total, open_accounts, minimums, gross, new_credit, borrowing, ef_months, asset_income, gap_after_cuts, stage, rung, climb, updated_at")
      .eq("client_id", clientId)
      .order("month"),
    supabase
      .from("notes")
      .select("id, call_date, next_session, covered, message, homework(id, text, done, sort)")
      .eq("client_id", clientId)
      .order("call_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadTracker(supabase, clientId),
  ]);
  if (client.error || updates.error) throw new Error("Could not load the dashboard.");

  const coach = assignment.data
    ? (await supabase.from("profiles").select("full_name").eq("id", assignment.data.coach_id).maybeSingle()).data
    : null;

  const history = (updates.data || []) as MonthlyUpdate[];
  const rated = history.filter((u) => u.stage !== null && u.rung !== null);
  const latest = rated.at(-1) ?? null;
  const previous = latest ? (rated.filter((u) => u.month < latest.month).at(-1) ?? null) : null;
  const lastUpdate = history.length ? saDate(new Date(history.map((u) => u.updated_at).sort().at(-1)!)) : null;

  const calc = computeCalc(tracker.data, tracker.institutions);
  const n = note.data as (Note & { homework: Note["homework"] }) | null;

  return {
    client: client.data,
    coachName: coach?.full_name ?? null,
    week: programme.data?.week ?? 1,
    history,
    latest,
    previous,
    lastUpdate,
    note: n ? { ...n, homework: [...n.homework].sort((a, b) => a.sort - b.sort) } : null,
    // Most of the monthly update comes from the Tracker (§8).
    prefill: {
      total: calc.totals.total,
      openAccounts: tracker.data.debts.length,
      minimums: calc.totals.minimums,
      gross: calc.gross,
      takeHomeKnown: calc.takeHome !== null,
      borrowing: tracker.data.redLines.borrowing,
    },
  };
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
