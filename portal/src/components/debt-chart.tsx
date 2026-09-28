import { monthLabel, rand } from "@/lib/format";

export type ChartPoint = { month: string; total: number };

/** Round a maximum up to 1, 2 or 5 × a power of ten, so gridlines land on easy numbers. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

/**
 * Total debt by month, as bars drawn to scale from zero (§7.5).
 * The latest bar is gold; the line under the chart gives the change since the first month.
 */
export function DebtChart({ points }: { points: ChartPoint[] }) {
  const P = [...points].sort((a, b) => a.month.localeCompare(b.month));
  if (!P.length) return <p className="note" style={{ margin: 0 }}>Your chart appears here once you log your first month.</p>;

  const W = Math.max(320, P.length * 72 + 60);
  const H = 240;
  const pl = 64;
  const pb = 30;
  const pt = 22;
  const top = niceMax(Math.max(...P.map((p) => p.total)));
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / top);
  const slot = (W - pl - 10) / P.length;
  const bw = Math.min(44, slot * 0.6);
  const first = P[0];
  const last = P[P.length - 1];
  const diff = first.total - last.total;

  return (
    <>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Total debt by month, from ${rand(first.total)} in ${monthLabel(first.month)} to ${rand(last.total)} in ${monthLabel(last.month)}`}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (top * i) / 4;
          return (
            <g key={i}>
              <line x1={pl} x2={W - 10} y1={y(v)} y2={y(v)} stroke="rgba(245,240,228,.08)" />
              <text x={pl - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#A7AFC0">
                {rand(v)}
              </text>
            </g>
          );
        })}
        {P.map((p, i) => {
          const cx = pl + (i + 0.5) * slot;
          const isLast = i === P.length - 1;
          return (
            <g key={p.month}>
              <rect x={cx - bw / 2} y={y(p.total)} width={bw} height={Math.max(0, H - pb - y(p.total))} rx="2" fill={isLast ? "#E3B341" : "rgba(227,179,65,.42)"} />
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" fill="#A7AFC0">
                {monthLabel(p.month)}
              </text>
              {isLast && (
                <text x={cx} y={y(p.total) - 6} textAnchor="middle" fontSize="12" fontWeight="700" fill="#F2D188">
                  {rand(p.total)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {P.length > 1 && (
        <p className="note" style={{ margin: "8px 0 0" }}>
          {diff > 0
            ? `Down ${rand(diff)} since ${monthLabel(first.month)}. You're winning slowly.`
            : diff < 0
              ? `Up ${rand(-diff)} since ${monthLabel(first.month)}. Look for new credit and talk to your coach.`
              : "Holding steady."}
        </p>
      )}
    </>
  );
}
