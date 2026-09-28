import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ownerEmails } from "@/lib/env";
export { safeNext } from "@/lib/safe-next";

/**
 * Makes sure the user has a profile row, and sets the owner flag from OWNER_EMAILS.
 * The owner flag needs a verified email. Runs with the secret key because users
 * may not write `is_owner` themselves (column grant in the migration).
 * Called after every successful sign-in, confirmation or OAuth callback.
 */
export async function syncAccount(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error("Could not load the signed-in user.");

  const email = (data.user.email || "").toLowerCase();
  const verified = Boolean(data.user.email_confirmed_at);
  const isOwner = verified && email !== "" && ownerEmails().includes(email);

  const { error: upsertError } = await admin
    .from("profiles")
    .upsert({ id: userId, email, is_owner: isOwner, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (upsertError) throw new Error("Could not save the profile.");
}


