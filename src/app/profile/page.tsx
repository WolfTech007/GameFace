"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { GFBottomNav } from "@/components/gameface";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { profileViewPath } from "@/lib/gameface/profileRoutes";

function isSignedInProfile(username: string | undefined): boolean {
  if (!username) return false;
  return !username.startsWith("guest_");
}

/** Bottom nav and legacy links land here; forward to public profile view. */
export default function ProfileIndexPage() {
  const router = useRouter();
  const { profile } = useGameFaceProfile();

  useEffect(() => {
    if (isSignedInProfile(profile.username)) {
      router.replace(profileViewPath(profile.username));
      return;
    }
    router.replace("/login?redirect=/profile");
  }, [profile.username, router]);

  return (
    <>
      <p style={{ padding: 24, color: "var(--gf-text-muted)" }}>Loading profile…</p>
      <GFBottomNav activeHref="/profile" />
    </>
  );
}
