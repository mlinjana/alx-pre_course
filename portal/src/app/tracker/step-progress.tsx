"use client";

import { useState } from "react";
import { DebtChart } from "@/components/debt-chart";
import { currentMonth, monthLabel, rand } from "@/lib/format";
import { deleteProgress, logProgress } from "./actions";
import type { StepProps } from "./tracker";

export function StepProgress({
  data,
  setData,
  institutions,
  calc,
  flush,
  clientName,
}: StepProps & { flush: () => Promise<void>; clientName: string }) {
  const [month, setMonth] = useState(currentMonth().slice(0, 7));
  const [total, setTotal] = useState(calc.totals.total ? String(Math.round(calc.totals.total)) : "");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function log() {
    setBusy(true);
    const r = await logProgress(month, total);
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    const t = Number(total.replace(/[^\d.]/g, ""));
    const m = `${month}-01`;
    setData({ ...data, progress: [...data.progress.filter((p) => p.month !== m), { month: m, total: t }] });
    setMsg({ tone: "ok", text: `Logged ${monthLabel(m)}: ${rand(t)}` });
  }

  async function remove(m: string) {
    if (!window.confirm(`Remove ${monthLabel(m)} from your log?`)) return;
    const r = await deleteProgress(m);
    if (!r.ok) return setMsg({ tone: "err", text: r.error });
    setData({ ...data, progress: data.progress.filter((p) => p.month !== m) });
  }

  async function pdf() {
    setBusy(true);
    setMsg(null);
    try {
      await flush();
      const { makeSummaryPdf } = await import("./pdf");
      await makeSummaryPdf(data, institutions, calc, clientName);
    } catch {
      setMsg({ tone: "err", text: "The PDF couldn't be made. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...data.progress].sort((a, b) => a.month.localeCompare(b.month));

  return (
    <>
      <div className="section">
        <div className="card">
          <div className="chartbox">
            <DebtChart points={data.progress} />
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Log this month</h2>
        <div className="grid2">
          <label className="f">
            Month
            <input type="month" value={month} max={currentMonth().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="f">
            Total debt (R)
            <input className="num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </label>
        </div>
        <div>
          <button className="btn gold small" onClick={log} disabled={busy}>
            Log it
          </button>
        </div>
        {msg && (
          <div className={msg.tone === "ok" ? "okbox" : "suerr"} role={msg.tone === "ok" ? "status" : "alert"}>
            {msg.text}
          </div>
        )}
        <div className="log">
          {sorted.length === 0 ? (
            <p className="note">Nothing logged yet. Log your first total above: that&apos;s your starting bar.</p>
          ) : (
            sorted.map((p) => (
              <div className="logrow" key={p.month}>
                <span style={{ fontFamily: "var(--mono)" }}>{monthLabel(p.month)}</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--gold2)" }}>{rand(p.total)}</span>
                <button className="x" onClick={() => remove(p.month)} aria-label={`Remove ${monthLabel(p.month)}`}>
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="section">
        <h2>My summary</h2>
        <p className="note">Everything in your Tracker on one branded page, to keep or print.</p>
        <div>
          <button className="btn gold" onClick={pdf} disabled={busy}>
            Download my summary (PDF)
          </button>
        </div>
      </div>
    </>
  );
}
