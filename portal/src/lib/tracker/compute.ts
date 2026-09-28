// Tracker figures worked out from the saved data. Used by the Tracker screens, the PDF,
// the monthly update and (later) the coach portal, so every screen shows the same numbers.
import { attackOrders, debtTotals, monthNumbers, parseAmount } from "@/lib/calc/tracker";
import { groupTotals, toCalcDebt, type Institution, type TrackerData } from "./model";

export function computeCalc(data: TrackerData, institutions: Institution[]) {
  const debts = data.debts.map((d) => toCalcDebt(d, institutions));
  const totals = debtTotals(debts);
  const groups = groupTotals(data.budget.items);
  const takeHome = parseAmount(data.budget.takeHome);
  const gross = parseAmount(data.budget.gross);
  return {
    debts,
    totals,
    groups,
    takeHome,
    gross,
    numbers: monthNumbers(takeHome, gross, groups, totals.minimums),
    orders: attackOrders(debts),
  };
}

export type Calc = ReturnType<typeof computeCalc>;
