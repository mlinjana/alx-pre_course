import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand, LogoutButton } from "@/components/brand";
import { firstName } from "@/lib/domain/signup";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Application received" };

export default async function ThanksPage() {
  const v = await requireViewer();
  if (v.coach) redirect("/coach");
  if (!v.application) redirect("/apply");
  const declined = v.application === "declined";

  return (
    <>
      <Brand right={<LogoutButton />} />
      <div className="suwrap">
        <div className="eyebrow">{declined ? "Your application" : "Application received"}</div>
        {declined ? (
          <>
            <h1>
              Thank you for <u>applying.</u>
            </h1>
            <div className="card">
              <p style={{ margin: 0 }}>MFG isn&apos;t taking your application further right now. We&apos;ve sent you an email.</p>
            </div>
          </>
        ) : (
          <>
            <h1>
              Thank you, {firstName(v.profile?.full_name)}. <u>We&apos;ll be in touch.</u>
            </h1>
            <div className="card">
              <h3>What happens next</h3>
              <ol className="steps">
                <li>
                  <b>MFG reviews your application</b> and contacts you on WhatsApp.
                </li>
                <li>
                  <b>If approved, you start training:</b> read the book, learn the Coach Manual, observe sessions, co-deliver
                  with a lead coach, then pass six role-plays.
                </li>
                <li>
                  <b>Once certified,</b> your coach area opens and MFG starts matching clients to you.
                </li>
              </ol>
            </div>
          </>
        )}
      </div>
    </>
  );
}
