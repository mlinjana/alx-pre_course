// Display formats shared by the Tracker, the PDF and (later) the dashboards.

/** R12,345 · −R200 · +R200 (signed). Null → "—". */
export function rand(v: number | null, signed = false): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const n = Math.round(Math.abs(v));
  const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = v < 0 && n !== 0 ? "−" : signed && v > 0 && n !== 0 ? "+" : "";
  return `${sign}R${s}`;
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${(Math.round(v * 10) / 10).toFixed(1)}%`;
}

/** 7 → "7 months", 30 → "2 yrs 6 mo". */
export function monthsText(n: number | null): string {
  if (n === null) return "—";
  if (n < 12) return `${n} month${n === 1 ? "" : "s"}`;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return `${y} yr${y > 1 ? "s" : ""}${m ? ` ${m} mo` : ""}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-01" or "2026-09" → "Sep 26". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MON[m - 1]} ${String(y).slice(2)}`;
}

/** First day of the current month in South Africa, as YYYY-MM-01. */
export function currentMonth(now = new Date()): string {
  const s = now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  return `${s.slice(0, 7)}-01`;
}

export function longDate(d = new Date()): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
}
