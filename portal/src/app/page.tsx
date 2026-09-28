import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/viewer";

export default async function Home() {
  const v = await getViewer();
  redirect(v ? homeFor(v) : "/join");
}
