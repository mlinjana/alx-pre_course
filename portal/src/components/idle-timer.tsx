"use client";

import { useEffect } from "react";

// Staff pages: log out after the set minutes without mouse, keyboard or touch (§11.2).
// The server also checks the time since the last request (see src/proxy.ts), so
// a tab left closed can't come back signed in.
export function IdleTimer({ timeoutMs }: { timeoutMs: number }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lastPing = Date.now();
    const reset = () => {
      clearTimeout(timer);
      // Typing a long note makes no requests; tell the server the person is still here.
      if (Date.now() - lastPing > 5 * 60_000) {
        lastPing = Date.now();
        fetch("/keepalive", { cache: "no-store" }).catch(() => {});
      }
      // /logout is a route handler that clears the session cookie, so it needs a full page load.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      timer = setTimeout(() => window.location.assign("/logout?reason=idle"), timeoutMs);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [timeoutMs]);
  return null;
}
