import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { createClient } from "@/lib/supabase/server";
import { loadTracker } from "@/lib/tracker/load";
import { requireViewer } from "@/lib/viewer";
import { Tracker } from "./tracker";
import "./tracker.css";

export const metadata: Metadata = { title: "Debt Ladder Tracker" };

export default async function TrackerPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const v = await requireViewer();
  if (!v.client) redirect("/");
  const supabase = await createClient();
  const { data, institutions } = await loadTracker(supabase, v.userId);
  const s = Number((await searchParams).step);

  return (
    <>
      <Brand
        right={
          <div className="row">
            <Link className="btn ghost small" href="/home">
              My climb
            </Link>
            <LogoutButton />
          </div>
        }
      />
      <p className="note" style={{ marginTop: 12 }}>
        {v.client.consent
          ? "Saved to your account. Sharing is on, so your MFG coach can see these numbers."
          : "Saved to your account. Only you can see these numbers: sharing with your coach is off."}
      </p>
      <Tracker initial={data} institutions={institutions} clientName={v.profile?.full_name || ""} initialStep={s >= 1 && s <= 5 ? s : 1} />
    </>
  );
}
