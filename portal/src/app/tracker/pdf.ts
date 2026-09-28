// "Download my summary (PDF)" (§7.5). Made in the browser with jsPDF; nothing is sent anywhere.
import { jsPDF } from "jspdf";
import { MATHS_BROKEN, loadBand, payoff, simulatePlan } from "@/lib/calc/tracker";
import { longDate, monthLabel, monthsText } from "@/lib/format";
import { GROUPS, RED_LINE_QUESTIONS, STATUSES, type Institution, type TrackerData } from "@/lib/tracker/model";
import type { Calc } from "./tracker";

const FOOTER =
  "Education, not financial advice. Mlinjana Financial Group teaches money skills; we do not give financial advice or sell financial products.";

type RGB = [number, number, number];
const NAVY: RGB = [13, 21, 38];
const GOLD: RGB = [227, 179, 65];
const INK: RGB = [20, 26, 38];
const GREY: RGB = [105, 112, 128];
const RED: RGB = [178, 59, 46];
const GREEN: RGB = [47, 130, 78];

// The built-in PDF fonts cover basic Latin only, so money uses a plain hyphen for minus.
const money = (v: number | null) =>
  v === null ? "-" : `${v < 0 && Math.round(Math.abs(v)) !== 0 ? "-" : ""}R${Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const pct = (v: number | null) => (v === null ? "-" : `${(Math.round(v * 10) / 10).toFixed(1)}%`);
const plain = (s: string) => s.replace(/[−–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/÷/g, "/");

export async function makeSummaryPdf(data: TrackerData, _institutions: Institution[], calc: Calc, clientName: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  const BOTTOM = 276;
  let y = 0;

  const need = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = 18;
    }
  };
  const h2 = (s: string) => {
    need(14);
    y += 6;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...NAVY);
    doc.text(s.toUpperCase(), M, y);
    doc.setDrawColor(...GOLD).setLineWidth(0.6).line(M, y + 1.6, M + 22, y + 1.6);
    y += 7;
  };
  // A label on the left (wraps if long) and its value on the right.
  const line = (k: string, v: string, col?: RGB) => {
    doc.setFont("helvetica", "bold").setFontSize(10);
    const vw = doc.getTextWidth(plain(v));
    doc.setFont("helvetica", "normal");
    const L = doc.splitTextToSize(plain(k), W - 2 * M - vw - 6);
    need(L.length * 4.6 + 2);
    doc.setTextColor(...GREY).text(L, M, y);
    doc.setFont("helvetica", "bold").setTextColor(...(col || INK));
    doc.text(plain(v), W - M, y, { align: "right" });
    y += L.length * 4.6 + 1.4;
  };
  const para = (s: string, col?: RGB) => {
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...(col || GREY));
    const L = doc.splitTextToSize(plain(s), W - 2 * M);
    need(L.length * 4.6 + 2);
    doc.text(L, M, y);
    y += L.length * 4.6 + 1;
  };

  // Header band
  doc.setFillColor(...NAVY).rect(0, 0, W, 34, "F");
  doc.setFillColor(...GOLD).rect(0, 34, W, 1.2, "F");
  doc.setTextColor(...GOLD).setFont("helvetica", "bold").setFontSize(9).text("MLINJANA FINANCIAL GROUP", M, 11);
  doc.setTextColor(245, 240, 228).setFontSize(20).text("My Debt Ladder Summary", M, 22);
  doc.setFontSize(9).setFont("helvetica", "normal");
  doc.text(plain(`${clientName ? clientName + "  ·  " : ""}Prepared ${longDate()}  ·  Restructure. Rebuild. Rise.`), M, 29);
  y = 44;

  // Step 1
  h2("My debts");
  // Column starts and widths (mm); cells wrap within their width.
  const cols = [M, M + 50, M + 74, M + 90, M + 110, M + 140];
  const widths = [48, 22, 14, 18, 28, W - M - (M + 140)];
  need(8);
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(...GREY);
  ["Creditor", "Balance", "Rate", "Minimum", "Status", "Cost at minimum"].forEach((h, i) => doc.text(h, cols[i], y));
  y += 2;
  doc.setDrawColor(210, 210, 215).setLineWidth(0.2).line(M, y, W - M, y);
  y += 5;
  if (!calc.debts.length) para("No debts listed.");
  calc.debts.forEach((d, i) => {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
    const p = d.nameMissing ? null : payoff(d.balance, d.rate, d.minimum);
    const status = STATUSES.find(([s]) => s === data.debts[i].status)?.[1] || "";
    const cells = [
      plain(d.nameMissing ? `${d.label} (name UNKNOWN)` : d.label),
      d.balance === null ? "UNKNOWN" : money(d.balance),
      d.rate === null ? "UNKNOWN" : `${d.rate}%`,
      d.minimum === null ? "UNKNOWN" : money(d.minimum),
      status,
      p === null ? "Needs all figures" : "never" in p ? "Never clears" : `${monthsText(p.months)}, ${money(p.interest)}`,
    ].map((c, j) => doc.splitTextToSize(c, widths[j]) as string[]);
    const rows = Math.max(...cells.map((c) => c.length));
    need(rows * 4.2 + 2.5);
    cells.forEach((c, j) => doc.text(c, cols[j], y));
    y += rows * 4.2 + 2.2;
  });
  y += 1;
  line(`Total owed (${longDate()})`, money(calc.totals.total), NAVY);
  line("Minimum payments each month", money(calc.totals.minimums));
  if (calc.totals.unknown) para(`${calc.totals.unknown} debt(s) have unknown figures. These totals are only as complete as the list. We never guess.`);

  // Step 2
  h2("My month");
  line("Take-home pay", money(calc.takeHome));
  line("Pay before deductions", money(calc.gross));
  GROUPS.forEach(([k, l]) => line(l, money(calc.groups[k])));
  line("Minimum debt payments", money(calc.totals.minimums));
  const { gapNow, gapAfterCuts, debtLoad } = calc.numbers;
  line("Gap this month", gapNow === null ? "-" : money(gapNow), gapNow !== null && gapNow < 0 ? RED : GREEN);
  line("Gap after cuts (Reduce and Eliminate at zero)", gapAfterCuts === null ? "-" : money(gapAfterCuts), gapAfterCuts !== null && gapAfterCuts < 0 ? RED : GREEN);

  // Step 3
  h2("My numbers");
  const band = loadBand(debtLoad);
  line("Debt load (minimums / pay before deductions)", debtLoad === null ? "Add pay before deductions" : pct(debtLoad), band?.tone === "red" ? RED : undefined);
  if (band) para(band.text);
  const rl: [string, boolean | null][] = [
    ["More than half of pay goes to debt", debtLoad === null ? null : debtLoad > 50],
    ...RED_LINE_QUESTIONS.map(([k, q]) => [q, data.redLines[k]] as [string, boolean | null]),
  ];
  rl.forEach(([q, v], i) => line(`Red Line ${i + 1}: ${q}`, v === null ? "Not answered" : v ? "FLASHING" : "Clear", v ? RED : v === false ? GREEN : GREY));
  if (gapAfterCuts !== null && gapAfterCuts < 0) para(`The maths is broken, not you. ${MATHS_BROKEN}`, RED);

  // Step 4
  h2("My attack plan");
  const extra = Number(data.attack.extra.replace(/[^\d.]/g, "")) || 0;
  const order = data.attack.method === "avalanche" ? calc.orders.byRate : calc.orders.byBalance;
  line("Method", data.attack.method === "avalanche" ? "Avalanche (highest rate first)" : "Snowball (smallest balance first)");
  line("Extra each month on top of minimums", money(extra));
  order.forEach((d, i) => line(`${i + 1}. ${d.label}`, `${money(d.balance)}${d.rate !== null ? `  ·  ${d.rate}%` : ""}`, i === 0 ? NAVY : undefined));
  const plan = simulatePlan(order, extra);
  if (plan && !("never" in plan)) para(`Estimated debt-free in about ${monthsText(plan.months)}, with about ${money(plan.interest)} in total interest. Estimates only: they assume rates and payments stay the same.`);
  else if (plan) para("At this budget the plan never clears. The payments must be bigger than the interest.", RED);
  else if (order.length) para("Add every rate and minimum to see a debt-free estimate.");

  // Step 5
  if (data.progress.length) {
    h2("My progress");
    const P = [...data.progress].sort((a, b) => a.month.localeCompare(b.month));
    P.forEach((p) => line(monthLabel(p.month), money(p.total)));
    if (P.length > 1) {
      const diff = P[0].total - P[P.length - 1].total;
      para(diff > 0 ? `Down ${money(diff)} since ${monthLabel(P[0].month)}.` : diff < 0 ? `Up ${money(-diff)} since ${monthLabel(P[0].month)}.` : "Holding steady.");
    }
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GOLD).setLineWidth(0.4).line(M, 282, W - M, 282);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GREY);
    doc.text(doc.splitTextToSize(FOOTER, W - 2 * M - 16), M, 286);
    doc.text(`${i}/${pages}`, W - M, 286, { align: "right" });
  }

  doc.save(`Debt-Ladder-Summary-${new Date().toISOString().slice(0, 10)}.pdf`);
}
