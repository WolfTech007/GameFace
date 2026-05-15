"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PlayRouteFallback } from "./PlayRouteFallback";

type GamePlayEntranceProps = {
  /** Legacy prop — kept for call-site compatibility; arena always mounts on `/play`. */
  introHref?: string;
  children: (opts: { autoJoinPublicQueue: boolean; fromRandomMatch: boolean }) => ReactNode;
};

function GamePlayEntranceInner({ children }: GamePlayEntranceProps) {
  const sp = useSearchParams();
  const queue = sp.get("queue") === "1";
  const gf = sp.get("gf") === "1";

  return <>{children({ autoJoinPublicQueue: queue, fromRandomMatch: gf })}</>;
}

export function GamePlayEntrance(props: GamePlayEntranceProps) {
  return (
    <Suspense fallback={<PlayRouteFallback />}>
      <GamePlayEntranceInner {...props} />
    </Suspense>
  );
}
