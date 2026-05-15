"use client";

import StackUp from "@/components/StackUp";
import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";

export default function StackUpPlayPage() {
  return (
    <GamePlayEntrance>
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <StackUp
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introSlug="stack-up"
        />
      )}
    </GamePlayEntrance>
  );
}
