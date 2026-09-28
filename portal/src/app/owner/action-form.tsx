"use client";

import { useActionState } from "react";
import { flash } from "@/components/flash";
import type { ActionResult } from "./actions";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

// A small form around one owner action, showing its result right under it.
export function ActionForm({
  action,
  children,
  className = "row",
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  // Announce the result page-wide as soon as it arrives: the row holding this form may
  // disappear in the same update (e.g. a waiting-room row after assigning).
  const [state, run, pending] = useActionState<ActionResult, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.ok) flash(result.ok);
    if (result.warn) flash(result.warn, "warn");
    return result;
  }, {});
  return (
    <form
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      aria-busy={pending}
    >
      {children}
      {pending && <span className="note">Working…</span>}
      {state.error && (
        <span className="chip red" role="alert" style={{ whiteSpace: "normal" }}>
          {state.error}
        </span>
      )}
      {state.ok && !pending && (
        <span className="chip green" role="status" style={{ whiteSpace: "normal" }}>
          {state.ok}
        </span>
      )}
      {state.warn && !pending && (
        <span className="chip amber" role="status" style={{ whiteSpace: "normal" }}>
          {state.warn}
        </span>
      )}
    </form>
  );
}
