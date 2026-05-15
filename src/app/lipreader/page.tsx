import { redirect } from "next/navigation";

/** Legacy URL → canonical Charades arena. */
export default function LipReaderRedirectPage() {
  redirect("/charades/play");
}
