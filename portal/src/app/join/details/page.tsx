import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { AUTH_METHOD_LABEL } from "@/lib/domain/constants";
import { createClient } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { DetailsForm } from "./details-form";

export const metadata: Metadata = { title: "About you" };

export default async function DetailsPage() {
  const v = await requireViewer();
  if (v.client || v.coach || v.profile?.is_owner) redirect("/");

  // Google and the others may give us a name already; the person can change it.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const meta = (data.user?.user_metadata || {}) as { full_name?: string; name?: string };
  const defaultName = v.profile?.full_name || meta.full_name || meta.name || "";

  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="suwrap">
        <DetailsForm providerLabel={v.provider !== "email" ? AUTH_METHOD_LABEL[v.provider] || null : null} defaultName={defaultName} />
        <p className="note" style={{ marginTop: 18 }}>
          Here to coach instead? <Link href="/apply">Apply to coach with MFG</Link>.
        </p>
      </div>
    </>
  );
}
