// Only allow redirects to pages on this site. Accepts a path ("/apply") or a
// full URL on the same site (Supabase email links pass the full redirect URL).
export function safeNext(next: string | null | undefined, fallback = "/", site?: string): string {
  if (!next) return fallback;
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  if (site) {
    try {
      const url = new URL(next);
      if (url.origin === new URL(site).origin) return url.pathname + url.search;
    } catch {
      // not a URL
    }
  }
  return fallback;
}
