import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET is used for the automatic inactivity sign-out; POST for the Log out button.
async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = new URL(request.url).searchParams.get("reason");
  const to = new URL(reason === "idle" ? "/login?reason=idle" : "/login", request.url);
  return NextResponse.redirect(to, { status: 303 });
}

export const GET = signOut;
export const POST = signOut;
