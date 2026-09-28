// Tracker data as the screens hold it (numbers kept as typed text) and how it maps to the calculations.
import { otherNameProblem, parseAmount, type Debt, type DebtStatus, type Groups } from "@/lib/calc/tracker";

export const DEBT_TYPES = [
  "Credit card",
  "Store account",
  "Personal loan",
  "Micro / short-term loan",
  "Vehicle finance",
  "Home loan",
  "Overdraft",
  "Pay later",
  "Cellphone contract",
  "Informal lender (mashonisa)",
  "Money owed to family",
  "Other",
] as const;

export const STATUSES: [DebtStatus, string][] = [
  ["current", "Up to date"],
  ["arrears", "Behind on payments"],
  ["attorneys", "With attorneys"],
  ["review", "Under debt review"],
];

export const GROUPS = [
  ["critical", "Critical", "Must pay: rent, electricity, water, groceries, transport to work"],
  ["important", "Important", "Try to pay: insurance, medical aid, school fees"],
  ["reduce", "Reduce", "Cut hard: clothing, entertainment, eating out, extra data"],
  ["eliminate", "Eliminate", "Stop tonight: subscriptions you barely use, luxuries, all new credit"],
] as const;
export type GroupKey = (typeof GROUPS)[number][0];

// Starting items for a new budget (§7.2).
export const DEFAULT_ITEMS: [GroupKey, string][] = [
  ["critical", "Rent"],
  ["critical", "Electricity and water"],
  ["critical", "Groceries"],
  ["critical", "Transport to work"],
  ["important", "Insurance and funeral cover"],
  ["important", "Medical aid"],
  ["important", "School fees"],
  ["reduce", "Clothing"],
  ["reduce", "Eating out and takeaways"],
  ["reduce", "Entertainment"],
  ["reduce", "Extra data and airtime"],
  ["eliminate", "Subscriptions you barely use"],
];

export const RED_LINE_QUESTIONS = [
  ["borrowing", "Are you borrowing to pay other debts?"],
  ["missedThree", "Three or more missed payments in the last six months?"],
  ["noSavings", "Do you have NO emergency fund or savings at all?"],
  ["minOnlyHigh", "Are you paying only the minimum on debt charging 20% or more?"],
] as const;
export type RedLineKey = (typeof RED_LINE_QUESTIONS)[number][0];

export type Institution = { id: string; type: string; name: string };

export type TDebt = {
  id: string;
  type: string;
  institutionId: string | null;
  useOther: boolean; // the "Other" tile is chosen (or the type has no list)
  otherName: string;
  familyWho: string;
  balance: string;
  rate: string;
  minimum: string;
  status: DebtStatus;
  otherConfirmed: boolean;
};

export type TItem = { id: string; grp: GroupKey; label: string; amount: string };
export type TBudget = { month: string | null; takeHome: string; gross: string; items: TItem[] };
export type TRedLines = Record<RedLineKey, boolean | null>;
export type TAttack = { method: "avalanche" | "snowball"; extra: string };
export type TProgress = { month: string; total: number };

export type TrackerData = {
  debts: TDebt[];
  budget: TBudget;
  redLines: TRedLines;
  attack: TAttack;
  progress: TProgress[];
};

export const hasList = (type: string, institutions: Institution[]) => institutions.some((i) => i.type === type);

/** Who the debt is with, as a person would say it. "" if not known yet. */
export function lenderName(d: TDebt, institutions: Institution[]): string {
  if (d.type === "Informal lender (mashonisa)") return "Informal lender";
  if (d.type === "Money owed to family") return d.familyWho.trim() ? `Family: ${d.familyWho.trim()}` : "";
  if (d.institutionId) return institutions.find((i) => i.id === d.institutionId)?.name || "";
  if ((d.useOther || !hasList(d.type, institutions)) && !otherNameProblem(d.otherName)) return d.otherName.trim();
  return "";
}

export function debtLabel(d: TDebt, institutions: Institution[]): string {
  const who = lenderName(d, institutions);
  return who ? `${who} · ${d.type}` : d.type;
}

export function nameMissing(d: TDebt, institutions: Institution[]): boolean {
  if (d.type === "Informal lender (mashonisa)") return false;
  return lenderName(d, institutions) === "";
}

export function toCalcDebt(d: TDebt, institutions: Institution[]): Debt {
  return {
    id: d.id,
    type: d.type,
    label: debtLabel(d, institutions),
    balance: parseAmount(d.balance),
    rate: parseAmount(d.rate),
    minimum: parseAmount(d.minimum),
    status: d.status,
    nameMissing: nameMissing(d, institutions),
  };
}

export function groupTotals(items: TItem[]): Groups {
  const g: Groups = { critical: 0, important: 0, reduce: 0, eliminate: 0 };
  for (const it of items) g[it.grp] += parseAmount(it.amount) ?? 0;
  return g;
}

export const newDebt = (id: string): TDebt => ({
  id,
  type: "Credit card",
  institutionId: null,
  useOther: false,
  otherName: "",
  familyWho: "",
  balance: "",
  rate: "",
  minimum: "",
  status: "current",
  otherConfirmed: false,
});

export const numText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(Number(n)));
