import type { Metadata } from "next";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Terms of use" };

// Placeholder (§4). The real text must be written and checked by an attorney.
export default function Page() {
  return (
    <>
      <Brand />
      <div className="suwrap">
        <div className="eyebrow">Mlinjana Financial Group</div>
        <h1>Terms of use</h1>
        <div className="placeholder">[TO BE WRITTEN AND CHECKED BY AN ATTORNEY]</div>
      </div>
    </>
  );
}
