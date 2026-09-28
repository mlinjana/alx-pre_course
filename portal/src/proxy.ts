import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { IDLE_HEADER, SEEN_COOKIE } from "@/lib/idle";

// Runs before every page request:
// 1. refreshes the Supabase session cookie (per the Supabase SSR guide), and
// 2. tracks the last request time, so staff pages can sign out after inactivity.
//    The time since the previous request is passed on as the `x-mfg-idle-ms` header.

export async function proxy(request: NextRequest) {
  const now = Date.now();
  const lastSeen = Number(request.cookies.get(SEEN_COOKIE)?.value || 0);
  const idleMs = lastSeen > 0 ? Math.max(0, now - lastSeen) : 0;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(IDLE_HEADER, String(idleMs));

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Refresh the session early, before anything else runs.
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    response.cookies.set(SEEN_COOKIE, String(now), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    // Everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
