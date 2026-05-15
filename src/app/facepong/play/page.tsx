"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import FacePong from "@/components/FacePong";

export default function FacePongPlayPage() {
  return (
    <GamePlayEntrance>
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <FacePong
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introSlug="facepong"
        />
      )}
    </GamePlayEntrance>
  );
}
