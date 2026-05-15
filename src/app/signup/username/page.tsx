import { redirect } from "next/navigation";

/** Legacy route — username is collected on `/signup`. */
export default function SignupUsernameRedirectPage() {
  redirect("/signup");
}
