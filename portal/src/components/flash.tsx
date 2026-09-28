"use client";

import { useEffect, useState } from "react";

type Msg = { text: string; tone: "ok" | "warn" };

/** Show a message that outlives the row it came from (e.g. a waiting-room row that disappears after assigning). */
export function flash(text: string, tone: Msg["tone"] = "ok") {
  window.dispatchEvent(new CustomEvent<Msg>("mfg:flash", { detail: { text, tone } }));
}

export function FlashArea() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<Msg>).detail;
      setMsgs((prev) => [...prev, m].slice(-3));
      setTimeout(() => setMsgs((prev) => prev.filter((x) => x !== m)), 8000);
    };
    window.addEventListener("mfg:flash", on);
    return () => window.removeEventListener("mfg:flash", on);
  }, []);
  return (
    <div role="status" aria-live="polite" className="toast" style={{ display: msgs.length ? "flex" : "none", flexDirection: "column", gap: 6 }}>
      {msgs.map((m, i) => (
        <span key={i} style={m.tone === "warn" ? { color: "#8a4b00" } : undefined}>
          {m.text}
        </span>
      ))}
    </div>
  );
}
