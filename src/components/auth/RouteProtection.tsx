"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isGuestPlayAllowed, isProtectedPath, isPublicPath } from "@/lib/auth/routeAccess";

export function RouteProtection({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const guestOk = isGuestPlayAllowed();
  const pub = isPublicPath(pathname);
  const prot = isProtectedPath(pathname);

  useEffect(() => {
    if (guestOk || pub || !prot) return;
    if (isLoading) return;
    if (user) return;
    const qs = typeof window !== "undefined" ? window.location.search ?? "" : "";
    router.replace(`/login?redirect=${encodeURIComponent(pathname + qs)}`);
  }, [guestOk, pub, prot, isLoading, user, pathname, router]);

  if (guestOk || pub || !prot) {
    return <>{children}</>;
  }
  if (isLoading || !user) {
    return null;
  }
  return <>{children}</>;
}
