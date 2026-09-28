import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Debt Ladder Tracker" };

// Placeholder until Phase 2 builds the Tracker (§7).
export default async function TrackerPage() {
  const v = await requireViewer();
  if (!v.client) redirect("/");
  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="suwrap">
        <div className="eyebrow">Debt Ladder Tracker</div>
        <h1>
          Every debt. <u>Exactly.</u>
        </h1>
        <div className="placeholder">The Tracker opens here soon. Your account is ready for it.</div>
        <Link className="btn ghost" href="/home" style={{ alignSelf: "flex-start" }}>
          ← My climb
        </Link>
      </div>
    </>
  );
}
