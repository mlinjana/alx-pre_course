"use server";

// Tracker saving (§7). Every write goes through RLS as the signed-in client.
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { otherNameProblem, parseAmount } from "@/lib/calc/tracker";
import { currentMonth } from "@/lib/format";
import {
  DEBT_TYPES,
  GROUPS,
  RED_LINE_QUESTIONS,
  STATUSES,
  type TAttack,
  type TBudget,
  type TDebt,
  type TRedLines,
} from "@/lib/tracker/model";

export type SaveResult = { ok: true } | { ok: false; error: string };

const FAIL: SaveResult = { ok: false, error: "Not saved. Check your connection and try again." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 1_000_000_000; // R1 billion: anything bigger is a typing slip

async function clientContext() {
  const v = await getViewer();
  if (!v?.client) return null;
  return { clientId: v.userId, supabase: await createClient() };
}

function amount(raw: string, max = MAX_AMOUNT): number | null | "bad" {
  const n = parseAmount(raw);
  if (n === null) return null;
  return n < 0 || n > max ? "bad" : Math.round(n * 100) / 100;
}

export async function saveDebt(d: TDebt, sort: number): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx) return FAIL;
  if (!UUID.test(d.id)) return FAIL;
  if (!(DEBT_TYPES as readonly string[]).includes(d.type)) return { ok: false, error: "Choose what kind of debt this is." };
  if (!STATUSES.some(([s]) => s === d.status)) return FAIL;

  const balance = amount(d.balance);
  const rate = amount(d.rate, 1000);
  const minimum = amount(d.minimum);
  if (balance === "bad" || minimum === "bad") return { ok: false, error: "That amount looks too big. Check it against your statement." };
  if (rate === "bad") return { ok: false, error: "Check the interest rate: it's the % a year on your statement." };

  // One way of naming the lender, and "Other" names only when they pass the §7.1 rules.
  const family = d.type === "Money owed to family";
  const informal = d.type === "Informal lender (mashonisa)";
  const other = !family && !informal && !d.institutionId && !otherNameProblem(d.otherName) ? d.otherName.trim().slice(0, 120) : null;
  const row = {
    debt_type: d.type,
    institution_id: family || informal ? null : d.institutionId && UUID.test(d.institutionId) ? d.institutionId : null,
    other_name: other,
    family_who: family && d.familyWho.trim() ? d.familyWho.trim().slice(0, 120) : null,
    balance,
    rate,
    minimum,
    status: d.status,
    sort,
  };

  const upd = await ctx.supabase.from("debts").update(row).eq("id", d.id).eq("client_id", ctx.clientId).select("id");
  if (upd.error) return upd.error.message.includes("institution") ? { ok: false, error: "Pick the institution again." } : FAIL;
  if (upd.data.length === 0) {
    const ins = await ctx.supabase.from("debts").insert({ id: d.id, client_id: ctx.clientId, ...row });
    if (ins.error) return FAIL;
  }
  return { ok: true };
}

export async function deleteDebt(id: string): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx || !UUID.test(id)) return FAIL;
  const { error } = await ctx.supabase.from("debts").delete().eq("id", id).eq("client_id", ctx.clientId);
  return error ? FAIL : { ok: true };
}

/**
 * Saves Step 2 into this month's budget. A new month starts as a copy of the last one,
 * so every month's picture is kept.
 */
export async function saveBudget(b: Omit<TBudget, "month">): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx) return FAIL;
  const takeHome = amount(b.takeHome);
  const gross = amount(b.gross);
  if (takeHome === "bad" || gross === "bad") return { ok: false, error: "That pay figure looks too big. Check it." };
  const groups = GROUPS.map(([k]) => k as string);
  const items = b.items.slice(0, 80).map((it, i) => {
    const a = amount(it.amount);
    return { grp: it.grp, label: it.label.trim().slice(0, 80), amount: a === "bad" ? null : a, sort: i };
  });
  if (items.some((it) => !groups.includes(it.grp))) return FAIL;

  const month = currentMonth();
  const { data: existing, error: findError } = await ctx.supabase
    .from("month_budget")
    .select("id")
    .eq("client_id", ctx.clientId)
    .eq("month", month)
    .maybeSingle();
  if (findError) return FAIL;

  let budgetId = existing?.id as string | undefined;
  if (budgetId) {
    const { error } = await ctx.supabase.from("month_budget").update({ take_home: takeHome, gross }).eq("id", budgetId);
    if (error) return FAIL;
  } else {
    const { data, error } = await ctx.supabase
      .from("month_budget")
      .insert({ client_id: ctx.clientId, month, take_home: takeHome, gross })
      .select("id")
      .single();
    if (error) return FAIL;
    budgetId = data.id;
  }

  const del = await ctx.supabase.from("budget_items").delete().eq("budget_id", budgetId);
  if (del.error) return FAIL;
  if (items.length) {
    const ins = await ctx.supabase
      .from("budget_items")
      .insert(items.map((it) => ({ ...it, budget_id: budgetId, client_id: ctx.clientId })));
    if (ins.error) return FAIL;
  }
  return { ok: true };
}

export async function saveRedLines(rl: TRedLines): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx) return FAIL;
  const v = (k: (typeof RED_LINE_QUESTIONS)[number][0]) => (rl[k] === true ? true : rl[k] === false ? false : null);
  const { error } = await ctx.supabase.from("red_lines").upsert(
    {
      client_id: ctx.clientId,
      month: currentMonth(),
      borrowing: v("borrowing"),
      missed_three: v("missedThree"),
      no_savings: v("noSavings"),
      min_only_high: v("minOnlyHigh"),
    },
    { onConflict: "client_id,month" },
  );
  return error ? FAIL : { ok: true };
}

export async function saveAttack(a: TAttack): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx) return FAIL;
  const extra = amount(a.extra);
  if (extra === "bad") return { ok: false, error: "That extra amount looks too big. Check it." };
  const { error } = await ctx.supabase.from("attack_plan").upsert(
    {
      client_id: ctx.clientId,
      method: a.method === "snowball" ? "snowball" : "avalanche",
      extra,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  return error ? FAIL : { ok: true };
}

/** Step 5: log the total debt for a month. Month is "YYYY-MM". */
export async function logProgress(month: string, total: string): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx) return FAIL;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Add a month and a total first." };
  if (`${month}-01` > currentMonth()) return { ok: false, error: "You can't log a month that hasn't started yet." };
  const t = amount(total);
  if (t === null) return { ok: false, error: "Add a month and a total first." };
  if (t === "bad") return { ok: false, error: "That total looks too big. Check it." };
  const { error } = await ctx.supabase
    .from("monthly_updates")
    .upsert({ client_id: ctx.clientId, month: `${month}-01`, total: t }, { onConflict: "client_id,month" });
  return error ? FAIL : { ok: true };
}

export async function deleteProgress(month: string): Promise<SaveResult> {
  const ctx = await clientContext();
  if (!ctx || !/^\d{4}-\d{2}-01$/.test(month)) return FAIL;
  const { error } = await ctx.supabase.from("monthly_updates").delete().eq("client_id", ctx.clientId).eq("month", month);
  return error ? FAIL : { ok: true };
}
