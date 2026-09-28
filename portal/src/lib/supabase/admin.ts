import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";

// SECRET-KEY CLIENT. Bypasses RLS. Only for the few jobs that need it:
// setting the owner flag, creating profiles, sending coach invites.
// Never pass its results to the browser without checking who is asking.
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Missing environment variable SUPABASE_SECRET_KEY. See .env.example.");
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
