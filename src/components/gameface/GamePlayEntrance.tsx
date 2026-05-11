"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { PlayRouteFallback } from "./PlayRouteFallback";

type GamePlayEntranceProps = {
  introHref: string;
  children: (opts: { autoJoinPublicQueue: boolean; fromRandomMatch: boolean }) => ReactNode;
};

function GamePlayEntranceInner({ introHref, children }: GamePlayEntranceProps) {
  const sp = useSearchParams();
  const router = useRouter();
  const queue = sp.get("queue") === "1";
  const gf = sp.get("gf") === "1";

  useEffect(() => {
    if (!queue && !gf) router.replace(introHref);
  }, [queue, gf, router, introHref]);

  if (!queue && !gf) return null;

  return <>{children({ autoJoinPublicQueue: queue, fromRandomMatch: gf })}</>;
}

export function GamePlayEntrance(props: GamePlayEntranceProps) {
  return (
    <Suspense fallback={<PlayRouteFallback />}>
      <GamePlayEntranceInner {...props} />
    </Suspense>
  );
}
