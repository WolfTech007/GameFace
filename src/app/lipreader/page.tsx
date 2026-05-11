import { redirect } from "next/navigation";

/** Legacy URL → canonical Charades route. */
export default function LipReaderRedirectPage() {
  redirect("/charades");
}
