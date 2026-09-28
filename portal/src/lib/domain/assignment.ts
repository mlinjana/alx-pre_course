// Waiting room and assignment rules (§6).

export type CoachLoad = { id: string; name: string; status: string; capacity: number; clients: number };

/** Short display name for the dropdown: "Kagiso Phiri" → "Kagiso P." */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "Kagiso P. · 3/8" */
export function loadLabel(c: CoachLoad): string {
  return `${shortName(c.name)} · ${c.clients}/${c.capacity}`;
}

export function isFull(c: CoachLoad): boolean {
  return c.clients >= c.capacity;
}

/**
 * Least busy certified coach with space: lowest clients ÷ capacity.
 * Ties go to the coach with more free places, then by name, so the choice is stable.
 */
export function leastBusyCoach(coaches: CoachLoad[]): CoachLoad | null {
  const open = coaches.filter((c) => c.status === "certified" && c.capacity > 0 && !isFull(c));
  if (open.length === 0) return null;
  return [...open].sort(
    (a, b) =>
      a.clients / a.capacity - b.clients / b.capacity ||
      b.capacity - b.clients - (a.capacity - a.clients) ||
      a.name.localeCompare(b.name),
  )[0];
}

/** Whole days since sign-up, by calendar date in South African time. */
export function daysWaiting(signedUpAt: Date, now: Date): number {
  const day = (d: Date) => {
    const s = d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }); // YYYY-MM-DD
    return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  };
  return Math.max(0, Math.round((day(now) - day(signedUpAt)) / 86_400_000));
}

/** Green today, amber 1–2 days, red 3+ (§6). */
export function waitingColour(days: number): "green" | "amber" | "red" {
  if (days <= 0) return "green";
  if (days <= 2) return "amber";
  return "red";
}

export function waitingLabel(days: number): string {
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** Capacity colour for the coaches table (§10): green, amber at 80% or more, red when full. */
export function capacityColour(clients: number, capacity: number): "green" | "amber" | "red" {
  if (capacity <= 0 || clients >= capacity) return "red";
  if (clients / capacity >= 0.8) return "amber";
  return "green";
}
