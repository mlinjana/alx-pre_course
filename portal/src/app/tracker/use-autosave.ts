"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveResult } from "./actions";

export type SaveStatus = { state: "saved" | "saving" | "error"; message?: string };

/**
 * Saves each piece of the Tracker shortly after the person stops typing.
 * - One timer per key (e.g. "debt:<id>", "budget"): only the latest version is sent.
 * - Saves run one after another, so an older save never lands after a newer one.
 * - If the page is closed with saves waiting, the browser asks first.
 */
export function useAutosave(delay = 700) {
  const [status, setStatus] = useState<SaveStatus>({ state: "saved" });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const jobs = useRef(new Map<string, () => Promise<SaveResult>>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const run = useCallback((key: string) => {
    const job = jobs.current.get(key);
    jobs.current.delete(key);
    timers.current.delete(key);
    if (!job) return;
    chain.current = chain.current.then(async () => {
      let result: SaveResult;
      try {
        result = await job();
      } catch {
        result = { ok: false, error: "Not saved. Check your connection and try again." };
      }
      pending.current--;
      if (!result.ok) setStatus({ state: "error", message: result.error });
      else if (pending.current === 0) setStatus({ state: "saved" });
    });
  }, []);

  const schedule = useCallback(
    (key: string, job: () => Promise<SaveResult>, now = false) => {
      if (!jobs.current.has(key)) pending.current++;
      jobs.current.set(key, job);
      setStatus({ state: "saving" });
      const t = timers.current.get(key);
      if (t) clearTimeout(t);
      if (now) run(key);
      else timers.current.set(key, setTimeout(() => run(key), delay));
    },
    [delay, run],
  );

  /** Send everything waiting right away (e.g. before changing step or making the PDF). */
  const flush = useCallback(async () => {
    for (const key of [...timers.current.keys()]) {
      clearTimeout(timers.current.get(key)!);
      run(key);
    }
    await chain.current;
  }, [run]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { status, schedule, flush };
}
