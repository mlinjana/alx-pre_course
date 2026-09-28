import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { getViewer } from "@/lib/viewer";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Coach with MFG" };

export default async function ApplyPage() {
  const v = await getViewer();
  if (!v) redirect("/join?as=coach");
  if (v.client || v.coach || v.profile?.is_owner) redirect("/");
  if (v.application === "pending") redirect("/apply/thanks");

  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="suwrap">
        <div className="eyebrow">Coach with MFG</div>
        <h1>
          Help people <u>climb.</u>
        </h1>
        <p className="note">
          MFG coaches teach the method in <i>The Debt Millionaire</i>. Every coach is approved and trained before taking
          clients.
        </p>
        <ApplyForm email={v.email} defaultName={v.profile?.full_name || ""} />
      </div>
    </>
  );
}
